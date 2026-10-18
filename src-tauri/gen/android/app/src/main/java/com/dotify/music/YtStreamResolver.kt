package com.dotify.music

import android.util.Log
import org.json.JSONObject
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.localization.Localization
import org.schabi.newpipe.extractor.search.SearchInfo
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.abs

/**
 * On-device YouTube stream URL resolver for native background playback.
 *
 * Tier 1: fresh in-memory cache (4h TTL).
 * Tier 2: NewPipeExtractor on the known videoId (v0.26.5 — the SABR-capable
 *         generation), validated so a stale/odd id cannot make the app play a
 *         completely different song (e.g. a remix).
 * Tier 3: Piped /streams on known id — the public fleet has been behind
 *         YouTube's anti-bot wall since 2026; kept as cheap opportunism.
 * Tier 4: on-device search for artist+title (extractor search first, Piped
 *         search only if the fleet recovers), then extraction of the found id.
 *
 * All resolution is BLOCKING — callers must invoke off the main thread
 * (NativePlayerEngine does exactly that).
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
        val videoId: String,
        /** Title reported by the resolved video — used by plausibility checks. */
        val actualTitle: String = "",
        /** Duration reported by the resolved video — used by plausibility checks. */
        val actualDurationSec: Long = 0L
    )

    private class CacheEntry(
        val videoId: String,
        val url: String,
        val mimeType: String,
        val bitrateKbps: Int,
        val title: String,
        val durationSec: Long,
        val createdAt: Long
    )

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

        // 2. Extractor on known id — preferred path. Plausibility only STEERS
        //    here: a stale cache/ranking winner is demoted in favour of the
        //    fresh search below, but if the two CONCUR (search returns the
        //    same id) the extractor result is accepted — our metadata can be
        //    wrong (localized titles, drifted durations) while the video is
        //    exactly right, and treating the gate as a veto would fail to
        //    find sources for playable songs.
        if (candidateId != null) {
            val viaExtractor =
                resolveViaExtractor(candidateId, forceRefresh, artist, title, expectedDurationSec)
            if (viaExtractor != null && isPlausibleMatch(viaExtractor, artist, title, expectedDurationSec)) {
                cached(viaExtractor, candidateId, query)
                return viaExtractor
            }
            if (viaExtractor != null) {
                Log.w(
                    TAG,
                    "implausible match for $candidateId ('${viaExtractor.actualTitle}', " +
                        "${viaExtractor.actualDurationSec}s) — cross-checking via search"
                )
                val searchBest = if (query.isNotEmpty()) searchVideoId(query, expectedDurationSec) else null
                if (searchBest == null) {
                    // No better opinion available: play what the extractor found.
                    cached(viaExtractor, candidateId, query)
                    return viaExtractor
                }
                if (searchBest == candidateId) {
                    // Concordance — both ranking paths agree; metadata is likely
                    // at fault, not the choice.
                    cached(viaExtractor, candidateId, query)
                    return viaExtractor
                }
                resolveViaExtractor(searchBest, true, artist, title, expectedDurationSec)?.let { alt ->
                    cached(alt, searchBest, query)
                    return alt
                }
                // Search id failed to yield streams: fall back to the original.
                Log.w(TAG, "search id $searchBest unresolvable — keeping $candidateId")
                cached(viaExtractor, candidateId, query)
                return viaExtractor
            }
        }

        // 3. Piped streams on known id (filler tier, mostly dead since 2026)
        if (candidateId != null) {
            resolveViaPiped(candidateId)?.let { cached(it, candidateId, query); return it }
        }

        // 4. On-device search for artist+title, then extraction for the found
        //    id. Runs whenever the extractor did not already deliver a playable
        //    URL for the known id (no id given, or extraction of it failed).
        //    The search result is accepted directly — it is ranked from the
        //    golden store metadata, the same class of choice the TS resolver
        //    made pre-native.
        if (query.isNotEmpty()) {
            val found = searchVideoId(query, expectedDurationSec)
            if (found != null && found != candidateId) {
                resolveViaExtractor(found, true, artist, title, expectedDurationSec)?.let {
                    cached(it, found, query)
                    return it
                }
                resolveViaPiped(found)?.let { cached(it, found, query); return it }
            }
        }

        return null
    }

    private fun entryToResolved(entry: CacheEntry): ResolvedStream =
        ResolvedStream(entry.url, entry.mimeType, entry.bitrateKbps, entry.videoId, entry.title, entry.durationSec)

    private fun cached(resolved: ResolvedStream, keyId: String, query: String) {
        val entry = CacheEntry(
            resolved.videoId,
            resolved.url,
            resolved.mimeType,
            resolved.bitrateKbps,
            resolved.actualTitle,
            resolved.actualDurationSec,
            now()
        )
        cache[keyId] = entry
        if (query.isNotEmpty()) {
            cache["q:$query"] = entry
        }
    }

    private fun now(): Long = System.currentTimeMillis()

    // ---------------------------------------------------------------------
    // Plausibility checks (wrong-song guard)
    // ---------------------------------------------------------------------

    /**
     * Rejects extracted videos that plainly are not the requested song. This is
     * the safety net against stale search caches and ranking misses that would
     * otherwise make the app play, e.g., a comedy remix under the user's title.
     */
    private fun isPlausibleMatch(
        resolved: ResolvedStream,
        artist: String,
        title: String,
        expectedDurationSec: Long
    ): Boolean {
        if (resolved.actualTitle.isBlank() && resolved.actualDurationSec <= 0L) return true

        val expected = normalizeForCompare("$artist $title")
        val actual = normalizeForCompare(resolved.actualTitle)
        val sim = if (expected.isNotEmpty() && actual.isNotEmpty()) {
            tokenSimilarity(expected, actual)
        } else 0.0

        if (expectedDurationSec > 0L && resolved.actualDurationSec > 0L) {
            val diff = abs(expectedDurationSec - resolved.actualDurationSec)
            return when {
                diff <= 20L -> true // duration is the strongest signal
                diff <= 240L -> sim >= 0.35
                else -> sim >= 0.60
            }
        }
        return sim >= 0.30
    }

    private fun normalizeForCompare(raw: String): String = raw
        .lowercase(Locale.US)
        .replace(Regex("\\(.*?\\)|\\[.*?\\]"), " ")
        .replace(
            Regex("(official|lyrics?|video|audio|visualizer|hd|hq|mv|remaster(ed)?|album|version|extended|e\\/s|c\\/w)"),
            " "
        )
        .replace(Regex("[^a-z0-9\\u00c0-\\u024f\\u0400-\\u04ff ]+"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()

    private fun tokenSimilarity(a: String, b: String): Double {
        val ta = a.split(' ').filter { it.isNotBlank() }.toSet()
        val tb = b.split(' ').filter { it.isNotBlank() }.toSet()
        if (ta.isEmpty() || tb.isEmpty()) return 0.0
        return ta.intersect(tb).size.toDouble() / minOf(ta.size, tb.size).toDouble()
    }

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

    private fun resolveViaExtractor(
        videoId: String,
        forceRefresh: Boolean,
        artist: String = "",
        title: String = "",
        expectedDurationSec: Long = 0L
    ): ResolvedStream? {
        if (!forceRefresh) {
            cache[videoId]?.takeIf { now() - it.createdAt < CACHE_TTL_MS }?.let { return entryToResolved(it) }
        }
        // artist/title/expectedDurationSec are carried for signature symmetry
        // with resolve(); validation runs there via isPlausibleMatch().
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

            ResolvedStream(
                best.url,
                mimeToUse,
                best.bitrate / 1000,
                videoId,
                try { info.name } catch (_: Throwable) { "" },
                try { info.duration } catch (_: Throwable) { 0L }
            )
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
    // Tier: on-device search (artist + title / duration matching)
    // ---------------------------------------------------------------------

    private fun searchVideoId(query: String, expectedDurationSec: Long): String? {
        val q = query.trim()
        if (q.isEmpty()) return null

        searchCache[q]?.takeIf { now() - it.createdAt < CACHE_TTL_MS }?.let { return it.videoId }

        // NewPipeExtractor search first: it works on-device with the v0.26.x
        // player clients, while the public Piped /search fleet has been behind
        // YouTube's anti-bot wall since 2026.
        searchVideoIdViaExtractor(q, expectedDurationSec)?.let {
            searchCache[q] = SearchEntry(it, now())
            return it
        }

        // Piped search fallback (opportunistic; fleet mostly unreachable).
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

    /**
     * Searches YouTube on-device through the NewPipeExtractor video search and
     * scores items by duration match and title similarity. This is the primary
     * identification fallback when (a) the WebView/TS layer produced no videoId
     * for a queue entry or (b) the extractor rejected a given id as implausible.
     */
    private fun searchVideoIdViaExtractor(query: String, expectedDurationSec: Long): String? {
        return try {
            ensureNewPipe()
            val handler = ServiceList.YouTube.searchQHFactory
                .fromQuery(query, listOf("videos"), "")
            val info = SearchInfo.getInfo(ServiceList.YouTube, handler)

            val expectedTokens = normalizeForCompare(query)
            var bestId: String? = null
            var bestScore = Int.MIN_VALUE
            for (item in info.relatedItems) {
                if (item !is StreamInfoItem) continue
                val id = try { extractVideoId(item.url) } catch (_: Throwable) { null } ?: continue
                val duration = try { item.duration } catch (_: Throwable) { -1L }
                if (duration <= 0L || duration > 1800L) continue // skip live / 30-min+ items

                val durationScore: Int = if (expectedDurationSec <= 0L) {
                    50_000
                } else {
                    val diff = abs(duration - expectedDurationSec)
                    (if (diff <= 45L) 1_000_000 else if (diff <= 150L) 150_000 else 100_000) - diff.toInt()
                }

                val titleSim = tokenSimilarity(expectedTokens, normalizeForCompare(item.name))
                val score = durationScore + (500 * titleSim).toInt()

                if (score > bestScore) {
                    bestScore = score
                    bestId = id
                }
            }
            bestId
        } catch (e: Throwable) {
            Log.w(TAG, "extractor search failed: ${e.message}")
            null
        }
    }

    private fun diffOf(a: Long, b: Long): Long = abs(a - b)

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
