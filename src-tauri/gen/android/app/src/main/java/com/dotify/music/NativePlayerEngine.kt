package com.dotify.music

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Process-wide native audio engine (Media3 ExoPlayer) that replaces the
 * WebView audio path for background / screen-off streaming on Android.
 *
 * Why it survives Doze where the WebView path died:
 *  - ExoPlayer is a native FGS-backed player: no JS timers involved.
 *  - The whole queue is handed in once; Media3 advances items itself.
 *  - Audio focus, "becoming noisy" and network wake locks are handled by
 *    Media3 natively (handleAudioFocus=true).
 *  - Stream URLs are resolved on-device in Kotlin (YtStreamResolver), one
 *    track ahead of playback, so JS is never consulted for URLs.
 *
 * Threading model: every player mutation happens on the main looper (Media3
 * requirement). Resolution happens on short background threads that post
 * results back. Public getters snapshot @Volatile fields updated on main.
 */
@OptIn(UnstableApi::class)
object NativePlayerEngine {

    private const val TAG = "DotifyNativePlayer"
    private const val BROWSER_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"

    class TrackMeta(
        val id: String,
        val videoId: String,
        val title: String,
        val artist: String,
        val album: String,
        val artworkUrl: String,
        val durationSec: Double,
        val source: String,
        val streamUrl: String
    )

    interface Listener {
        fun onEngineStateChanged(playing: Boolean, buffering: Boolean)
        fun onTrackTransition(payloadIndex: Int, meta: TrackMeta?)
        fun onQueueEnded()
        fun onEngineError(message: String)
    }

    private class QueuePayload(
        val metas: List<TrackMeta>,
        val startIndex: Int,
        val startMs: Long,
        val repeatMode: Int,
        val volumePct: Int
    )

    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile private var appContext: Context? = null
    @Volatile private var player: ExoPlayer? = null
    @Volatile private var listener: Listener? = null
    @Volatile var queueMetas: List<TrackMeta> = emptyList()
        private set

    private val generation = AtomicInteger(0)
    private val retriedPayloadIndexes = ConcurrentHashMap.newKeySet<Int>()
    private val resolveLock = Any()

    // Main-thread bookkeeping: playlist position -> payload (queue JSON) index.
    // Items whose resolution failed are skipped, so the two indexes diverge.
    private val playlistToPayload = mutableListOf<Int>()
    private var firstAppend = true
    private var pendingStartMs = 0L
    private var stickyAdvance = false
    @Volatile private var resolutionActive = false

    @Volatile var hasActiveQueue: Boolean = false
        private set
    @Volatile private var lastPositionMs = 0L
    @Volatile private var lastDurationMs = 0L
    @Volatile private var lastPayloadIndex = -1

    fun init(context: Context) {
        if (appContext == null) appContext = context.applicationContext
    }

    fun setListener(l: Listener?) {
        listener = l
    }

    // ------------------------------------------------------------------
    // Public API (JS thread safe)
    // ------------------------------------------------------------------

    fun playQueue(payloadJson: String): Boolean {
        val payload = parseQueuePayload(payloadJson) ?: return false
        if (payload.metas.isEmpty()) return false
        mainHandler.post { startQueueInternal(payload) }
        return true
    }

    /**
     * Replace the playlist while keeping current playback. The JS wrapper sends
     * startIndex = index of the currently playing track in the NEW queue and
     * startMs = current position, so the implementation reuses playQueue.
     */
    fun updateQueue(payloadJson: String): Boolean = playQueue(payloadJson)

    fun pause() {
        mainHandler.post {
            player?.let { p -> try { p.pause() } catch (_: Exception) {} }
        }
    }

    fun resume() {
        mainHandler.post {
            player?.let { p -> try { p.play() } catch (_: Exception) {} }
        }
    }

    fun seekTo(positionMs: Long) {
        mainHandler.post {
            val p = player ?: return@post
            try {
                p.seekTo(positionMs.coerceAtLeast(0L))
            } catch (_: Exception) {}
        }
    }

    fun next() {
        mainHandler.post {
            val p = player ?: return@post
            try {
                if (p.hasNextMediaItem()) {
                    p.seekToNextMediaItem()
                    p.play()
                } else if (resolutionActive) {
                    // The next track exists in the payload but is not resolved/attached yet.
                    stickyAdvance = true
                }
            } catch (_: Exception) {}
        }
    }

    fun prev() {
        mainHandler.post {
            val p = player ?: return@post
            try {
                if (p.currentPosition > 3000L) {
                    p.seekTo(0L)
                    p.play()
                } else if (p.hasPreviousMediaItem()) {
                    p.seekToPreviousMediaItem()
                    p.play()
                } else {
                    p.seekTo(0L)
                    p.play()
                }
            } catch (_: Exception) {}
        }
    }

    fun stop() {
        mainHandler.post {
            val p = player
            hasActiveQueue = false
            if (p != null) {
                try { p.stop(); p.clearMediaItems() } catch (_: Exception) {}
            }
            queueMetas = emptyList()
            playlistToPayload.clear()
            firstAppend = true
            stickyAdvance = false
            lastPositionMs = 0L
            lastDurationMs = 0L
            lastPayloadIndex = -1
            pushStateEvent("idle", 0L)
            listener?.onEngineStateChanged(false, false)
        }
    }

    fun setVolume(volumePct: Int) {
        mainHandler.post {
            player?.let { p ->
                try { p.volume = (volumePct.coerceIn(0, 100) / 100.0).toFloat() } catch (_: Exception) {}
            }
        }
    }

    fun setRepeatMode(mode: String) {
        val rm = repeatModeFrom(mode)
        mainHandler.post {
            player?.let { p -> try { p.repeatMode = rm } catch (_: Exception) {} }
        }
    }

    fun isActive(): Boolean = hasActiveQueue && player != null

    fun currentTimeMs(): Long = lastPositionMs

    fun durationMs(): Long = lastDurationMs

    /** Snapshot for the service ticker. Must be called on an Android main thread. */
    fun positionSnapshot(): Pair<Long, Long> {
        val p = player ?: return 0L to 0L
        try {
            val pos = p.currentPosition.coerceAtLeast(0L)
            val dur = p.duration
            lastPositionMs = pos
            if (dur > 0) lastDurationMs = dur
        } catch (_: Exception) {}
        return lastPositionMs to lastDurationMs
    }

    fun currentMeta(): TrackMeta? {
        if (lastPayloadIndex < 0) return null
        return queueMetas.getOrNull(lastPayloadIndex)
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    private fun parseQueuePayload(json: String): QueuePayload? {
        return try {
            val root = JSONObject(json)
            val arr = root.optJSONArray("tracks") ?: return null
            val metas = ArrayList<TrackMeta>()
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val duration = try {
                    val d = o.optDouble("durationSec", 0.0)
                    if (d.isNaN() || d < 0) 0.0 else d
                } catch (_: Throwable) { 0.0 }
                metas.add(
                    TrackMeta(
                        id = o.optString("id", "native_track_$i"),
                        videoId = o.optString("videoId", ""),
                        title = o.optString("title", "Unknown").ifBlank { "Unknown" },
                        artist = o.optString("artist", ""),
                        album = o.optString("album", ""),
                        artworkUrl = o.optString("artworkUrl", ""),
                        durationSec = duration,
                        source = o.optString("source", ""),
                        streamUrl = o.optString("streamUrl", "")
                    )
                )
            }
            if (metas.isEmpty()) return null
            val startIndex = root.optInt("startIndex", 0).coerceIn(0, metas.size - 1)
            val startMs = root.optLong("startMs", 0L).coerceIn(0L, 24L * 60L * 60L * 1000L)
            QueuePayload(
                metas = metas,
                startIndex = startIndex,
                startMs = startMs,
                repeatMode = repeatModeFrom(root.optString("repeatMode", "none")),
                volumePct = root.optInt("volumePct", -1)
            )
        } catch (e: Exception) {
            Log.w(TAG, "parseQueuePayload failed: ${e.message}")
            null
        }
    }

    private fun repeatModeFrom(mode: String): Int = when (mode) {
        "one" -> Player.REPEAT_MODE_ONE
        "all" -> Player.REPEAT_MODE_ALL
        else -> Player.REPEAT_MODE_OFF
    }

    private fun startQueueInternal(payload: QueuePayload) {
        val gen = generation.incrementAndGet()
        retriedPayloadIndexes.clear()
        queueMetas = payload.metas
        hasActiveQueue = true
        playlistToPayload.clear()
        firstAppend = true
        pendingStartMs = payload.startMs
        stickyAdvance = false
        lastPayloadIndex = -1
        ensurePlayer()
        player?.let { p ->
            try {
                p.playWhenReady = true
                p.repeatMode = payload.repeatMode
                if (payload.volumePct >= 0) {
                    val target = (payload.volumePct.coerceIn(0, 100) / 100.0).toFloat()
                    if (target >= 0f) p.volume = target
                }
                p.stop()
                p.clearMediaItems()
            } catch (_: Exception) {}
        }
        pushStateEvent("buffering", pendingStartMs)
        listener?.onEngineStateChanged(true, true)
        startResolutionWorker(gen, payload.startIndex)
    }

    /**
     * Sequential resolution starting at startIndex. Strictly sequential so
     * playlist append order stays deterministic; a couple hundred ms apart is
     * plenty to keep ahead of playback and fully Doze-safe.
     */
    private fun startResolutionWorker(gen: Int, startIndex: Int) {
        val worker = Thread {
            val metas = queueMetas
            resolutionActive = true
            try {
                val forward = metas.indices.filter { it >= startIndex }
                val wrapped = metas.indices.filter { it < startIndex }
                for (payloadIdx in forward + wrapped) {
                    if (generation.get() != gen) return@Thread
                    val meta = metas.getOrNull(payloadIdx) ?: continue

                    var url = ""
                    var mime: String? = null
                    if (meta.streamUrl.startsWith("http")) {
                        // Direct-source track (radio / vault LAN / Audius / Deezer preview):
                        // no resolution needed — Media3 reads the URL immediately.
                        url = meta.streamUrl
                        mime = mimeFromUrl(url)
                    } else if (meta.videoId.isBlank() && isVaultLikeSource(meta)) {
                        // Vault/radio entries without a usable URL must never fall
                        // into the YouTube search fallback — that would play an
                        // unrelated song. Skip them explicitly.
                        val skipPayload = JSONObject()
                            .put("payloadIndex", payloadIdx)
                            .put("id", meta.id)
                            .put("title", meta.title)
                        pushRaw("skip", skipPayload.toString())
                        continue
                    } else {
                        val resolved = synchronized(resolveLock) {
                            YtStreamResolver.resolve(
                                videoId = meta.videoId.takeIf { it.isNotBlank() },
                                artist = meta.artist,
                                title = meta.title,
                                expectedDurationSec = meta.durationSec.toLong().coerceAtLeast(0L),
                                forceRefresh = false
                            )
                        }
                        if (generation.get() != gen) return@Thread
                        if (resolved == null) {
                            val skipPayload = JSONObject()
                                .put("payloadIndex", payloadIdx)
                                .put("id", meta.id)
                                .put("title", meta.title)
                            pushRaw("skip", skipPayload.toString())
                            continue
                        }
                        url = resolved.url
                        mime = if (resolved.mimeType.isBlank()) null else resolved.mimeType
                    }

                    val fUrl = url
                    val fMime = mime
                    mainHandler.post { appendResolvedItem(gen, payloadIdx, fUrl, fMime) }
                }
            } catch (t: Throwable) {
                Log.w(TAG, "resolution worker crashed: ${t.message}")
            } finally {
                resolutionActive = false
            }
        }
        worker.name = "dotify-native-resolver"
        worker.start()
    }

    private fun appendResolvedItem(gen: Int, payloadIdx: Int, url: String, mime: String?) {
        if (generation.get() != gen) return
        val p = player ?: return
        val meta = queueMetas.getOrNull(payloadIdx) ?: return
        val item = buildMediaItem(meta, url, mime)
        try {
            if (firstAppend) {
                playlistToPayload.add(payloadIdx)
                p.setMediaItems(listOf(item))
                p.prepare()
                if (pendingStartMs > 0L) p.seekTo(0, pendingStartMs)
                p.play()
                firstAppend = false
            } else {
                val insertAt = p.mediaItemCount
                playlistToPayload.add(payloadIdx)
                p.addMediaItems(insertAt, listOf(item))
                if (stickyAdvance && p.currentMediaItemIndex == insertAt - 1) {
                    stickyAdvance = false
                    p.seekToNextMediaItem()
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "appendResolvedItem failed: ${e.message}")
        }
    }

    private fun buildMediaItem(meta: TrackMeta, url: String, mime: String?): MediaItem {
        val metaBuilder = MediaMetadata.Builder()
            .setTitle(meta.title)
            .setArtist(meta.artist.ifBlank { "Dotify" })
        if (meta.album.isNotBlank()) metaBuilder.setAlbumTitle(meta.album)
        if (meta.artworkUrl.isNotBlank()) {
            try { metaBuilder.setArtworkUri(Uri.parse(meta.artworkUrl)) } catch (_: Throwable) {}
        }
        val builder = MediaItem.Builder()
            .setUri(Uri.parse(url))
            .setMediaId(meta.id)
            .setMediaMetadata(metaBuilder.build())
        if (!mime.isNullOrBlank()) {
            try { builder.setMimeType(mime) } catch (_: Throwable) {}
        }
        return builder.build()
    }

    private var playerListener: Player.Listener? = null

    private fun ensurePlayer() {
        if (player != null) return
        val ctx = appContext ?: return

        val httpFactory = DefaultHttpDataSource.Factory()
            .setUserAgent(BROWSER_UA)
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(10000)
            .setReadTimeoutMs(10000)

        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(120_000, 600_000, 4_000, 8_000)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build()

        val instance = ExoPlayer.Builder(ctx, DefaultMediaSourceFactory(httpFactory))
            .setLoadControl(loadControl)
            .build()
        instance.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(),
            true // handleAudioFocus — Media3 acquires/abandons focus itself
        )
        instance.setHandleAudioBecomingNoisy(true)
        instance.setWakeMode(C.WAKE_MODE_NETWORK)
        playerListener = buildPlayerListener()
        playerListener?.let { instance.addListener(it) }
        player = instance
    }

    private fun buildPlayerListener(): Player.Listener {
        return object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                val p = player ?: return
                updateSnapshot(p)
                if (playbackState == Player.STATE_ENDED) {
                    hasActiveQueue = false
                    pushStateEvent("ended", lastPositionMs)
                    listener?.onQueueEnded()
                } else {
                    notifyStateInternal()
                }
            }

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                notifyStateInternal()
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                notifyStateInternal()
            }

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                val p = player ?: return
                val playlistIdx = p.currentMediaItemIndex
                val payloadIdx = playlistToPayload.getOrNull(playlistIdx)
                lastPayloadIndex = payloadIdx ?: -1
                updateSnapshot(p)
                if (payloadIdx != null) {
                    val meta = queueMetas.getOrNull(payloadIdx)
                    if (meta != null) {
                        val transitionPayload = JSONObject()
                            .put("payloadIndex", payloadIdx)
                            .put("id", meta.id)
                            .put("title", meta.title)
                            .put("durationMs", lastDurationMs)
                        pushRaw("transition", transitionPayload.toString())
                        listener?.onTrackTransition(payloadIdx, meta)
                    }
                }
                notifyStateInternal()
            }

            override fun onPlayerError(error: PlaybackException) {
                handlePlayerError(error)
            }
        }
    }

    private fun notifyStateInternal() {
        val p = player ?: return
        val state = mapState(p)
        pushStateEvent(state, lastPositionMs)
        listener?.onEngineStateChanged(
            state == "playing",
            state == "buffering"
        )
    }

    private fun mapState(p: Player): String = when {
        p.playbackState == Player.STATE_BUFFERING && p.playWhenReady -> "buffering"
        p.playbackState == Player.STATE_READY && p.playWhenReady -> "playing"
        p.playbackState == Player.STATE_READY && !p.playWhenReady -> "paused"
        p.playbackState == Player.STATE_ENDED -> "ended"
        else -> "idle"
    }

    private fun handlePlayerError(error: PlaybackException) {
        val p = player ?: return
        val gen = generation.get()
        val playlistIdx = p.currentMediaItemIndex
        val payloadIdx = playlistToPayload.getOrNull(playlistIdx)
        val meta = payloadIdx?.let { queueMetas.getOrNull(it) }
        if (payloadIdx == null || meta == null) {
            notifyStateInternal()
            return
        }

        if (retriedPayloadIndexes.add(payloadIdx)) {
            // One native re-resolve with cache bypass before skipping the item.
            Thread {
                val resolved = synchronized(resolveLock) {
                    YtStreamResolver.resolve(
                        videoId = meta.videoId.takeIf { it.isNotBlank() },
                        artist = meta.artist,
                        title = meta.title,
                        expectedDurationSec = meta.durationSec.toLong().coerceAtLeast(0L),
                        forceRefresh = true
                    )
                }
                mainHandler.post {
                    if (generation.get() != gen) return@post
                    val pl = player
                    if (resolved == null || pl == null) {
                        skipFailed(gen)
                        return@post
                    }
                    try {
                        pl.replaceMediaItem(playlistIdx, buildMediaItem(meta, resolved.url, resolved.mimeType))
                        if (pl.playbackState == Player.STATE_IDLE) {
                            pl.prepare()
                            pl.play()
                        }
                    } catch (_: Exception) {
                        skipFailed(gen)
                    }
                }
            }.start()
        } else {
            skipFailed(gen)
        }
    }

    private fun skipFailed(gen: Int) {
        if (generation.get() != gen) return
        val p = player ?: return
        try {
            if (p.hasNextMediaItem()) {
                p.seekToNextMediaItem()
                p.play()
            } else {
                hasActiveQueue = false
                listener?.onEngineError("Track failed and was at queue end")
                listener?.onQueueEnded()
            }
        } catch (_: Exception) {}
    }

    private fun updateSnapshot(p: Player) {
        try { lastPositionMs = p.currentPosition.coerceAtLeast(0L) } catch (_: Exception) {}
        val dur = try { p.duration } catch (_: Exception) { C.TIME_UNSET }
        if (dur > 0 && dur != C.TIME_UNSET) {
            lastDurationMs = dur
        } else {
            lastPayloadIndex.takeIf { it >= 0 }
                ?.let { queueMetas.getOrNull(it)?.durationSec }
                ?.takeIf { it > 0 }
                ?.let { lastDurationMs = (it * 1000.0).toLong() }
        }
    }

    private fun pushStateEvent(state: String, positionMs: Long) {
        pushRaw("state", stateJson(state, positionMs))
    }

    private fun stateJson(state: String, positionMs: Long): String {
        return JSONObject()
            .put("state", state)
            .put("positionMs", positionMs)
            .put("durationMs", lastDurationMs)
            .put("payloadIndex", lastPayloadIndex)
            .toString()
    }

    private fun pushRaw(type: String, payloadJson: String) {
        try {
            MainActivity.pushNativePlayerEvent(type, payloadJson)
        } catch (_: Throwable) {}
    }

    private fun mimeFromUrl(url: String): String? = when {
        url.contains(".mp3", ignoreCase = true) -> "audio/mpeg"
        url.contains(".m4a", ignoreCase = true) || url.contains(".aac", ignoreCase = true) -> "audio/mp4"
        url.contains(".ogg", ignoreCase = true) || url.contains(".opus", ignoreCase = true) -> "audio/ogg"
        url.contains(".flac", ignoreCase = true) -> "audio/x-flac"
        else -> null
    }

    private fun isVaultLikeSource(meta: TrackMeta): Boolean {
        val src = meta.source.lowercase()
        return src.contains("vault") || src == "radio" ||
            meta.id.startsWith("mp3:") || meta.id.startsWith("vault:")
    }
}
