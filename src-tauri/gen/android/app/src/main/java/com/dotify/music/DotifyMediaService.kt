package com.dotify.music

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class DotifyMediaService : Service() {

    private lateinit var mediaSession: MediaSessionCompat
    private var currentTitle: String = "Dotify"
    private var currentArtist: String = "No track playing"
    private var currentAlbum: String = "Dotify"
    private var currentArtworkUrl: String = ""
    private var currentArtworkBitmap: Bitmap? = null
    private var currentDurationMs: Long = 0L
    private var currentPositionMs: Long = 0L
    private var isPlaying: Boolean = false

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null

    private val screenReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val action = intent?.action ?: return
            if (action == Intent.ACTION_SCREEN_OFF || action == Intent.ACTION_SCREEN_ON || action == Intent.ACTION_USER_PRESENT) {
                MainActivity.refreshWebViewState()
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        initMediaSession()
        initWakeLocks()
        initAudioRouting()
        NativePlayerEngine.init(applicationContext)
        NativePlayerEngine.setListener(engineListener)
        try {
            val filter = android.content.IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_OFF)
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_USER_PRESENT)
            }
            registerReceiver(screenReceiver, filter)
        } catch (_: Exception) {}
    }

    private fun initWakeLocks() {
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
            wakeLock = powerManager?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Dotify:MediaPlaybackWakeLock")
            wakeLock?.setReferenceCounted(false)

            val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                wifiLock = wifiManager?.createWifiLock(WifiManager.WIFI_MODE_FULL_LOW_LATENCY, "Dotify:MediaPlaybackWifiLock")
            } else {
                @Suppress("DEPRECATION")
                wifiLock = wifiManager?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Dotify:MediaPlaybackWifiLock")
            }
            wifiLock?.setReferenceCounted(false)
        } catch (_: Exception) {}
    }

    private fun initAudioRouting() {
        try {
            audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        } catch (_: Exception) {}
    }

    private fun requestAudioFocus() {
        if (NativePlayerEngine.hasActiveQueue || NativePlayerEngine.isActive()) {
            return
        }
        try {
            val am = audioManager ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (audioFocusRequest == null) {
                    val audioAttributes = AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                    audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(audioAttributes)
                        .setAcceptsDelayedFocusGain(true)
                        .setOnAudioFocusChangeListener { focusChange ->
                            when (focusChange) {
                                AudioManager.AUDIOFOCUS_LOSS,
                                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                                    if (!NativePlayerEngine.hasActiveQueue && !NativePlayerEngine.isActive()) {
                                        MainActivity.dispatchMediaAction("pause")
                                    }
                                }
                                AudioManager.AUDIOFOCUS_GAIN -> {
                                    // Audio focus regained
                                }
                            }
                        }
                        .build()
                }
                audioFocusRequest?.let { am.requestAudioFocus(it) }
            } else {
                @Suppress("DEPRECATION")
                am.requestAudioFocus(
                    { focusChange ->
                        if (focusChange == AudioManager.AUDIOFOCUS_LOSS || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                            if (!NativePlayerEngine.hasActiveQueue && !NativePlayerEngine.isActive()) {
                                MainActivity.dispatchMediaAction("pause")
                            }
                        }
                    },
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN
                )
            }
        } catch (_: Exception) {}
    }

    private fun abandonAudioFocus() {
        try {
            val am = audioManager ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioFocusRequest?.let { am.abandonAudioFocusRequest(it) }
            } else {
                @Suppress("DEPRECATION")
                am.abandonAudioFocus(null)
            }
        } catch (_: Exception) {}
    }

    /**
     * Native engine events (playing/buffering/transition/ended). These are the
     * source of truth during native playback; the legacy JS pushes only mirror
     * the WebView path and are gated in onStartCommand.
     */
    private val engineListener = object : NativePlayerEngine.Listener {
        override fun onEngineStateChanged(playing: Boolean, buffering: Boolean) {
            isPlaying = playing
            updateLocks()
            syncStateAndNotification()
            if (playing) startTicker() else stopTicker()
        }

        override fun onTrackTransition(payloadIndex: Int, meta: NativePlayerEngine.TrackMeta?) {
            if (meta != null) {
                currentTitle = meta.title
                currentArtist = meta.artist.ifBlank { "Dotify" }
                currentAlbum = meta.album.ifBlank { "Dotify" }
                currentDurationMs = if (meta.durationSec > 0) (meta.durationSec * 1000.0).toLong() else 0L
                if (meta.artworkUrl.isNotBlank()) {
                    if (currentArtworkBitmap == null || meta.artworkUrl != currentArtworkUrl) {
                        currentArtworkUrl = meta.artworkUrl
                        loadArtworkAsync(meta.artworkUrl)
                    }
                } else {
                    currentArtworkBitmap = null
                }
            }
            currentPositionMs = 0L
            syncStateAndNotification()
        }

        override fun onQueueEnded() {
            isPlaying = false
            stopTicker()
            syncStateAndNotification()
        }

        override fun onEngineError(message: String) {
            MainActivity.pushNativePlayerEvent(
                "error",
                JSONObject().put("message", message).toString()
            )
        }
    }

    private val tickerHandler = Handler(Looper.getMainLooper())
    private val tickerRunnable = object : Runnable {
        override fun run() {
            if (!isPlaying) return
            try {
                val snap = NativePlayerEngine.positionSnapshot()
                currentPositionMs = snap.first
                if (snap.second > 0) currentDurationMs = snap.second
                updateSessionPlaybackStateOnly()
                MainActivity.pushNativePlayerEvent(
                    "position",
                    JSONObject()
                        .put("positionMs", currentPositionMs)
                        .put("durationMs", currentDurationMs)
                        .toString()
                )
            } catch (_: Exception) {}
            tickerHandler.postDelayed(this, TICK_INTERVAL_MS)
        }
    }

    private fun startTicker() {
        tickerHandler.removeCallbacks(tickerRunnable)
        tickerHandler.postDelayed(tickerRunnable, TICK_INTERVAL_MS)
    }

    private fun stopTicker() {
        tickerHandler.removeCallbacks(tickerRunnable)
    }

    private fun updateLocks() {
        try {
            if (isPlaying) {
                // The native engine (ExoPlayer handleAudioFocus=true) manages focus
                // itself during native playback — a second manual request here would
                // double-handle focus loss. Keep it only for the WebView audio path.
                if (!NativePlayerEngine.hasActiveQueue && !NativePlayerEngine.isActive()) {
                    requestAudioFocus()
                }
                if (wakeLock?.isHeld != true) {
                    wakeLock?.acquire(24 * 60 * 60 * 1000L) // 24hr safety timeout
                }
                if (wifiLock?.isHeld != true) {
                    wifiLock?.acquire()
                }
            } else {
                abandonAudioFocus()
                if (wakeLock?.isHeld == true) {
                    wakeLock?.release()
                }
                if (wifiLock?.isHeld == true) {
                    wifiLock?.release()
                }
            }
        } catch (_: Exception) {}
    }

    private fun releaseLocks() {
        try {
            abandonAudioFocus()
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
            if (wifiLock?.isHeld == true) {
                wifiLock?.release()
            }
        } catch (_: Exception) {}
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Dotify Music Playback",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows currently playing song and playback controls"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun initMediaSession() {
        mediaSession = MediaSessionCompat(this, "DotifyMediaSession").apply {
            setFlags(
                MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
            )

            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    if (NativePlayerEngine.isActive()) NativePlayerEngine.resume()
                    else MainActivity.dispatchMediaAction("play")
                }

                override fun onPause() {
                    if (NativePlayerEngine.isActive()) NativePlayerEngine.pause()
                    else MainActivity.dispatchMediaAction("pause")
                }

                override fun onSkipToNext() {
                    if (NativePlayerEngine.isActive()) NativePlayerEngine.next()
                    else MainActivity.dispatchMediaAction("next")
                }

                override fun onSkipToPrevious() {
                    if (NativePlayerEngine.isActive()) NativePlayerEngine.prev()
                    else MainActivity.dispatchMediaAction("prev")
                }

                override fun onSeekTo(pos: Long) {
                    if (NativePlayerEngine.isActive()) NativePlayerEngine.seekTo(pos)
                    else MainActivity.dispatchMediaAction("seek", pos)
                }

                override fun onStop() {
                    if (NativePlayerEngine.isActive()) NativePlayerEngine.stop()
                    MainActivity.dispatchMediaAction("pause")
                    stopForegroundService()
                }
            })

            isActive = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_UPDATE_TRACK -> {
                val pushedTitle = intent.getStringExtra(EXTRA_TITLE)
                val nativeMeta = NativePlayerEngine.currentMeta()
                if (NativePlayerEngine.isActive() && nativeMeta != null && pushedTitle != nativeMeta.title) {
                    // Stale WebView-driven metadata push racing a native transition.
                    // Ignore the payload but keep the foreground contract satisfied.
                    syncStateAndNotification()
                } else {
                    currentTitle = pushedTitle ?: "Dotify"
                    currentArtist = intent.getStringExtra(EXTRA_ARTIST) ?: ""
                    currentAlbum = intent.getStringExtra(EXTRA_ALBUM) ?: "Dotify"
                    val artwork = intent.getStringExtra(EXTRA_ARTWORK) ?: ""
                    currentDurationMs = intent.getLongExtra(EXTRA_DURATION, 0L)
                    currentPositionMs = intent.getLongExtra(EXTRA_POSITION, 0L)
                    isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, true)

                    // Enter foreground and acquire locks immediately without blocking on artwork download
                    syncStateAndNotification()

                    if (artwork != currentArtworkUrl) {
                        currentArtworkUrl = artwork
                        loadArtworkAsync(artwork)
                    }
                }
            }

            ACTION_UPDATE_PLAYBACK_STATE -> {
                // During native playback the engine is the source of truth for play/pause;
                // JS pushes only drive the WebView (HTML5) path.
                if (!NativePlayerEngine.hasActiveQueue && !NativePlayerEngine.isActive()) {
                    isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, false)
                    currentPositionMs = intent.getLongExtra(EXTRA_POSITION, currentPositionMs)
                    syncStateAndNotification()
                }
            }

            ACTION_ENGINE_SYNC -> syncStateAndNotification()

            ACTION_PLAY -> {
                if (NativePlayerEngine.isActive()) NativePlayerEngine.resume()
                else MainActivity.dispatchMediaAction("play")
            }
            ACTION_PAUSE -> {
                if (NativePlayerEngine.isActive()) NativePlayerEngine.pause()
                else MainActivity.dispatchMediaAction("pause")
            }
            ACTION_PREVIOUS -> {
                if (NativePlayerEngine.isActive()) NativePlayerEngine.prev()
                else MainActivity.dispatchMediaAction("prev")
            }
            ACTION_NEXT -> {
                if (NativePlayerEngine.isActive()) NativePlayerEngine.next()
                else MainActivity.dispatchMediaAction("next")
            }
            ACTION_STOP -> {
                if (NativePlayerEngine.isActive()) NativePlayerEngine.stop()
                MainActivity.dispatchMediaAction("pause")
                stopForegroundService()
            }
        }

        return START_STICKY
    }

    private fun loadArtworkAsync(urlStr: String) {
        if (urlStr.isBlank()) {
            currentArtworkBitmap = null
            syncStateAndNotification()
            return
        }

        thread {
            try {
                val conn = URL(urlStr).openConnection() as HttpURLConnection
                conn.connectTimeout = 5000
                conn.readTimeout = 8000
                conn.doInput = true
                conn.connect()
                val input = conn.inputStream
                val bitmap = BitmapFactory.decodeStream(input)
                conn.disconnect()
                currentArtworkBitmap = bitmap
            } catch (e: Exception) {
                currentArtworkBitmap = null
            }
            syncStateAndNotification()
        }
    }

    private fun buildPlaybackStateCompat(): PlaybackStateCompat {
        return PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_SEEK_TO or
                PlaybackStateCompat.ACTION_STOP
            )
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                currentPositionMs,
                if (isPlaying) 1.0f else 0.0f,
                SystemClock.elapsedRealtime()
            )
            .build()
    }

    /**
     * Light-weight 1 Hz ticker update: refresh the session position without
     * re-posting the notification (avoids notification churn during playback).
     */
    private fun updateSessionPlaybackStateOnly() {
        try {
            mediaSession.setPlaybackState(buildPlaybackStateCompat())
        } catch (_: Exception) {}
    }

    private fun syncStateAndNotification() {
        updateLocks()
        mediaSession.setPlaybackState(buildPlaybackStateCompat())

        val metaBuilder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs)

        if (currentArtworkBitmap != null) {
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, currentArtworkBitmap)
            metaBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, currentArtworkBitmap)
        }

        mediaSession.setMetadata(metaBuilder.build())

        val notification = buildNotification()

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val prevPendingIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, DotifyMediaService::class.java).apply { action = ACTION_PREVIOUS },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val playPausePendingIntent = PendingIntent.getService(
            this,
            2,
            Intent(this, DotifyMediaService::class.java).apply {
                action = if (isPlaying) ACTION_PAUSE else ACTION_PLAY
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val nextPendingIntent = PendingIntent.getService(
            this,
            3,
            Intent(this, DotifyMediaService::class.java).apply { action = ACTION_NEXT },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val playPauseIcon = if (isPlaying) R.drawable.ic_pause else R.drawable.ic_play_arrow
        val playPauseTitle = if (isPlaying) "Pause" else "Play"

        val style = MediaStyle()
            .setMediaSession(mediaSession.sessionToken)
            .setShowActionsInCompactView(0, 1, 2)

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist)
            .setSubText(currentAlbum)
            .setContentIntent(contentPendingIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setOngoing(isPlaying)
            .addAction(R.drawable.ic_skip_previous, "Previous", prevPendingIntent)
            .addAction(playPauseIcon, playPauseTitle, playPausePendingIntent)
            .addAction(R.drawable.ic_skip_next, "Next", nextPendingIntent)
            .setStyle(style)

        if (currentArtworkBitmap != null) {
            builder.setLargeIcon(currentArtworkBitmap)
        }

        return builder.build()
    }

    private fun stopForegroundService() {
        releaseLocks()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
        } catch (_: Exception) {}
        mediaSession.isActive = false
        stopSelf()
    }

    override fun onDestroy() {
        super.onDestroy()
        stopTicker()
        NativePlayerEngine.setListener(null)
        try {
            unregisterReceiver(screenReceiver)
        } catch (_: Exception) {}
        releaseLocks()
        mediaSession.release()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL_ID = "dotify_playback_channel"
        const val NOTIFICATION_ID = 2001
        private const val TICK_INTERVAL_MS = 1000L

        const val ACTION_PLAY = "com.dotify.music.ACTION_PLAY"
        const val ACTION_PAUSE = "com.dotify.music.ACTION_PAUSE"
        const val ACTION_PREVIOUS = "com.dotify.music.ACTION_PREVIOUS"
        const val ACTION_NEXT = "com.dotify.music.ACTION_NEXT"
        const val ACTION_STOP = "com.dotify.music.ACTION_STOP"
        const val ACTION_UPDATE_TRACK = "com.dotify.music.ACTION_UPDATE_TRACK"
        const val ACTION_UPDATE_PLAYBACK_STATE = "com.dotify.music.ACTION_UPDATE_PLAYBACK_STATE"
        const val ACTION_ENGINE_SYNC = "com.dotify.music.ACTION_ENGINE_SYNC"

        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_ARTIST = "extra_artist"
        const val EXTRA_ALBUM = "extra_album"
        const val EXTRA_ARTWORK = "extra_artwork"
        const val EXTRA_DURATION = "extra_duration"
        const val EXTRA_POSITION = "extra_position"
        const val EXTRA_IS_PLAYING = "extra_is_playing"
    }
}
