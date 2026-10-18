package com.dotify.music

import android.util.Log
import org.json.JSONObject
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.stream.StreamInfo
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

/**
 * On-device YouTube stream URL resolver for native background playback.
 *
 * Tier 1: NewPipeExtractor (same engine NewPipe/RiMusic bundle) — resolves
 *         progressive audio URLs for a known videoId directly from YouTube.
 * Tier 2: Public Piped instances (plain JSON) — reliable fallback when the
 *         extractor is temporarily broken by a YouTube layout change.
 * Tier 3: Piped search (artist + title + duration match) when no videoId is
 *         known, then tiers 1/2 run again for the found id.
 *
 * Everything is cached in-memory for 4 hours (googlevideo URLs typically live
 * ~6 hours). All resolution is BLOCKING — callers must invoke off the main
 * thread (NativePlayerEngine does exactly that).
 */
object YtStreamResolver {

    private const val TAG = "DotifyYtResolver"
    private const val CACHE_TTL_MS = 4L * 60L * 60L * 1000L
    private const val HTTP_TIMEOUT_MS = 9000

    private const val BROWSER_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"

    data class ResolvedStream(
        val url: String,
        val mimeType: String,
        val bitrateKbps: Int,
        val videoId: String
    )

    private class CacheEntry(val videoId: String, val url: String, val mimeType: String, val bitrateKbps: Int, val createdAt: Long)
    private class SearchEntry(val videoId: String, val createdAt: Long)

    private val cache = ConcurrentHashMap<String, CacheEntry>()
    private val searchCache = ConcurrentHashMap<String, SearchEntry>()

    private val PIPED_INSTANCES = listOf(
        "https://pipedapi.kavin.rocks",
        "https://pipedapi.adminforge.de",
        "https://api.piped.private.coffee",
        "https://pipedapi.reallyaweso.me",
        "https://pipedapi.ducks.party"
    )

    @Volatile
    private var newPipeReady = false

    /**
     * Resolve a playable audio URL for a YouTube track.
     *
     * @param videoId exact YouTube id when known (may be empty)
     * @param artist  artist name for the on-device search fallback
     * @param title   track title for the on-device search fallback
     * @param expectedDurationSec target duration used to score search results
     * @param forceRefresh bypass the in-memory cache (used after a stream error)
     */
    fun resolve(
        videoId: String?,
        artist: String,
        title: String,
        expectedDurationSec: Long,
        forceRefresh: Boolean
    ): ResolvedStream? {
        val query = ("$artist $title").trim()
        val candidateId = videoId?.takeIf { it.isNotBlank() }

        // 1. Fresh cache
        if (!forceRefresh) {
            val now = now()
            candidateId?.let { id -> cache[id]?.takeIf { now - it.createdAt < CACHE_TTL_MS }?.let { return entryToResolved(it) } }
            if (query.isNotEmpty()) {
                cache["q:$query"]?.takeIf { now - it.createdAt < CACHE_TTL_MS }?.let { return entryToResolved(it) }
            }
        }

        // 2. Extractor on known id
        if (candidateId != null) {
            resolveViaExtractor(candidateId, forceRefresh)?.let { cached(it, candidateId, query); return it }
        }

        // 3. Piped streams on known id
        if (candidateId != null) {
            resolveViaPiped(candidateId)?.let { cached(it, candidateId, query); return it }
        }

        // 4. On-device search for artist+title, then extraction for the found id
        if (query.isNotEmpty()) {
            val found = searchVideoId(query, expectedDurationSec)
            if (found != null && found != candidateId) {
                resolveViaExtractor(found, true)?.let { cached(it, found, query); return it }
                resolveViaPiped(found)?.let { cached(it, found, query); return it }
            }
        }

        return null
    }

    private fun entryToResolved(entry: CacheEntry): ResolvedStream =
        ResolvedStream(entry.url, entry.mimeType, entry.bitrateKbps, entry.videoId)

    private fun cached(resolved: ResolvedStream, keyId: String, query: String) {
        cache[keyId] = CacheEntry(resolved.videoId, resolved.url, resolved.mimeType, resolved.bitrateKbps, now())
        if (query.isNotEmpty()) {
            cache["q:$query"] =
                CacheEntry(resolved.videoId, resolved.url, resolved.mimeType, resolved.bitrateKbps, now())
        }
    }

    private fun now(): Long = System.currentTimeMillis()

    // ---------------------------------------------------------------------
    // Tier: NewPipeExtractor
    // ---------------------------------------------------------------------

    private fun ensureNewPipe() {
        if (newPipeReady) return
        synchronized(this) {
            if (newPipeReady) return
            NewPipe.init(DotifyDownloader(), Localization.fromLocale(Locale.US))
            newPipeReady = true
        }
    }

    private fun resolveViaExtractor(videoId: String, forceRefresh: Boolean): ResolvedStream? {
        if (!forceRefresh) {
            cache[videoId]?.takeIf { now() - it.createdAt < CACHE_TTL_MS }?.let { return entryToResolved(it) }
        }
        return try {
            ensureNewPipe()
            val info = StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=$videoId")

            data class Candidate(val url: String, val mime: String, val bitrate: Int)

            val candidates = ArrayList<Candidate>()
            for (stream in info.audioStreams) {
                try {
                    val url = stream.url ?: continue
                    if (url.isBlank()) continue
                    val mime = try { stream.format?.mimeType ?: "" } catch (_: Throwable) { "" }
                    val bitrate = try { stream.averageBitrate } catch (_: Throwable) { 0 }
                    if (mime.isNotEmpty() && !mime.startsWith("audio/")) continue
                    candidates.add(Candidate(url, mime, bitrate))
                } catch (_: Throwable) {
                    continue
                }
            }
            if (candidates.isEmpty()) return null

            // Prefer AAC (m4a) in the 96-320 kbps sweet spot for widest codec support.
            val m4a = candidates
                .filter { it.mime.startsWith("audio/mp4") && it.bitrate in 60_000..340_000 }
                .maxByOrNull { it.bitrate }
            val best = m4a
                ?: candidates.filter { it.mime.startsWith("audio/mp4") }.maxByOrNull { it.bitrate }
                ?: candidates.maxByOrNull { it.bitrate }
                ?: candidates.first()
            val mimeToUse = if (best.mime.isNotEmpty()) best.mime else guessMimeFromUrl(best.url)

            ResolvedStream(best.url, mimeToUse, best.bitrate / 1000, videoId)
        } catch (e: Throwable) {
            Log.w(TAG, "extractor resolve failed for $videoId: ${e.message}")
            null
        }
    }

    // ---------------------------------------------------------------------
    // Tier: Piped instance streams
    // ---------------------------------------------------------------------

    private fun resolveViaPiped(videoId: String): ResolvedStream? {
        for (instance in PIPED_INSTANCES) {
            try {
                val obj = fetchJson("$instance/streams/$videoId") ?: continue
                val streams = obj.optJSONArray("audioStreams") ?: continue

                var bestUrl: String? = null
                var bestMime = "audio/mp4"
                var bestBitrate = 0
                var fallbackUrl: String? = null
                var fallbackMime = "audio/webm"

                for (i in 0 until streams.length()) {
                    val s = streams.optJSONObject(i) ?: continue
                    val url = s.optString("url", "")
                    if (url.isEmpty()) continue
                    val mime = s.optString("mimeType", "").lowercase()
                    val bitrate = s.optInt("bitrate", 0)
                    if (mime.startsWith("audio/mp4")) {
                        if (bestUrl == null || bitrate > bestBitrate) {
                            bestUrl = url
                            bestMime = if (mime.isNotEmpty()) mime else "audio/mp4"
                            bestBitrate = bitrate
                        }
                    } else if (fallbackUrl == null && (mime.isEmpty() || mime.startsWith("audio/"))) {
                        fallbackUrl = url
                        fallbackMime = if (mime.isNotEmpty()) mime else "audio/webm"
                    }
                }

                val chosenUrl = bestUrl ?: fallbackUrl ?: continue
                val chosenMime = if (bestUrl != null) bestMime else fallbackMime
                val bitrateKbps = if (bestUrl != null) bestBitrate / 1000 else 128
                return ResolvedStream(chosenUrl, chosenMime, bitrateKbps, videoId)
            } catch (e: Throwable) {
                Log.w(TAG, "piped resolve failed on $instance: ${e.message}")
            }
        }
        return null
    }

    // ---------------------------------------------------------------------
    // Tier: Piped search (artist + title / duration matching)
    // ---------------------------------------------------------------------

    private fun searchVideoId(query: String, expectedDurationSec: Long): String? {
        val q = query.trim()
        if (q.isEmpty()) return null

        searchCache[q]?.takeIf { now() - it.createdAt < CACHE_TTL_MS }?.let { return it.videoId }

        for (instance in PIPED_INSTANCES) {
            try {
                val encoded = URLEncoder.encode(q, "UTF-8")
                val obj = fetchJson("$instance/search?q=$encoded&filter=videos") ?: continue
                val items = obj.optJSONArray("items") ?: continue

                var bestItem: JSONObject? = null
                var bestScore = Int.MIN_VALUE
                for (i in 0 until items.length()) {
                    val o = items.optJSONObject(i) ?: continue
                    val url = o.optString("url", "")
                    val id = extractVideoId(url) ?: continue
                    val duration = o.optLong("duration", -1L)
                    if (duration <= 0L || duration > 1800L) continue // skip live / 30-min+ items

                    val score = if (expectedDurationSec > 0L) {
                        val diff = Math.abs(duration - expectedDurationSec)
                        if (diff <= 45L) 1_000_000 - diff.toInt() else 100_000 - diff.toInt()
                    } else {
                        50_000
                    }
                    if (score > bestScore) {
                        bestScore = score
                        bestItem = JSONObject().put("id", id)
                    }
                }

                val chosen = bestItem
                if (chosen != null) {
                    val id = chosen.getString("id")
                    searchCache[q] = SearchEntry(id, now())
                    return id
                }
            } catch (e: Throwable) {
                Log.w(TAG, "piped search failed on $instance: ${e.message}")
            }
        }
        return null
    }

    private fun extractVideoId(url: String): String? {
        val marker = "v="
        val index = url.indexOf(marker)
        if (index == -1) return null
        val raw = url.substring(index + marker.length)
        val end = raw.indexOfFirst { it == '&' || it == '#' }
        val id = if (end == -1) raw else raw.substring(0, end)
        return if (id.length == 11) id else null
    }

    private fun guessMimeFromUrl(url: String): String = when {
        url.contains(".m4a", ignoreCase = true) -> "audio/mp4"
        url.contains(".mp3", ignoreCase = true) -> "audio/mpeg"
        url.contains(".ogg", ignoreCase = true) || url.contains(".opus", ignoreCase = true) -> "audio/ogg"
        url.contains(".webm", ignoreCase = true) -> "audio/webm"
        else -> ""
    }

    // ---------------------------------------------------------------------
    // HTTP plumbing
    // ---------------------------------------------------------------------

    private fun fetchJson(url: String): JSONObject? {
        var conn: HttpURLConnection? = null
        try {
            conn = URL(url).openConnection() as HttpURLConnection
            conn.apply {
                requestMethod = "GET"
                connectTimeout = HTTP_TIMEOUT_MS
                readTimeout = HTTP_TIMEOUT_MS
                setRequestProperty("User-Agent", BROWSER_UA)
                setRequestProperty("Accept", "application/json")
            }
            if (conn.responseCode !in 200..299) return null
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            return JSONObject(body)
        } catch (e: Throwable) {
            Log.w(TAG, "fetchJson failed ($url): ${e.message}")
            return null
        } finally {
            try { conn?.disconnect() } catch (_: Throwable) {}
        }
    }
}

/**
 * HttpURLConnection-backed Downloader for NewPipeExtractor. The extractor sets
 * its own client headers (User-Agent, X-YouTube-* etc.) per request — we only
 * execute them faithfully.
 */
class DotifyDownloader : Downloader() {

    override fun execute(request: Request): Response {
        var conn: HttpURLConnection? = null
        try {
            conn = URL(request.url()).openConnection() as HttpURLConnection
            conn.requestMethod = request.httpMethod()
            conn.connectTimeout = 10000
            conn.readTimeout = 10000
            conn.instanceFollowRedirects = true

            val headers = request.headers()
            if (headers != null) {
                for ((key, values) in headers) {
                    if (key == null) continue
                    for (value in values) {
                        try { conn.setRequestProperty(key, value) } catch (_: Throwable) {}
                    }
                }
            }

            val data = request.dataToSend()
            if (data != null && data.isNotEmpty()) {
                conn.doOutput = true
                val os = conn.outputStream
                os.write(data)
                os.flush()
            }

            val code = conn.responseCode
            val body = try {
                if (code in 200..299) {
                    conn.inputStream.bufferedReader().use { it.readText() }
                } else {
                    conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                }
            } catch (_: Throwable) {
                ""
            }
            val headerFields = conn.headerFields.filterKeys { it != null }
            val latestUrl = conn.url.toString()
            return Response(code, conn.responseMessage, headerFields, body, latestUrl)
        } finally {
            try { conn?.disconnect() } catch (_: Throwable) {}
        }
    }
}
