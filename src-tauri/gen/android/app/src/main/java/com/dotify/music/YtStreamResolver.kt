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

    data class Candidate(
        val videoId: String,
        val title: String,
        val duration: Long,
        val uploader: String = ""
    )

    fun searchCandidates(query: String): List<Candidate> {
        val q = query.trim()
        if (q.isEmpty()) return emptyList()
        val extractorList = try {
            ensureNewPipe()
            val handler = ServiceList.YouTube.searchQHFactory
                .fromQuery(q, listOf("videos"), "")
            val info = SearchInfo.getInfo(ServiceList.YouTube, handler)
            val list = mutableListOf<Candidate>()
            for (item in info.relatedItems) {
                if (item !is StreamInfoItem) continue
                val id = try { extractVideoId(item.url) } catch (_: Throwable) { null } ?: continue
                val duration = try { item.duration } catch (_: Throwable) { 0L }
                val uploader = try { item.uploaderName ?: "" } catch (_: Throwable) { "" }
                list.add(Candidate(id, item.name ?: "", if (duration > 0L) duration else 0L, uploader))
            }
            list
        } catch (e: Throwable) {
            e.printStackTrace()
            try { Log.w(TAG, "searchCandidates via NewPipe failed: ${e.message}") } catch (_: Throwable) {}
            emptyList()
        }
        if (extractorList.isNotEmpty()) return extractorList

        return searchCandidatesViaWebScraper(q)
    }

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
            var found = searchVideoId(query, expectedDurationSec)
            if (found == null && title.isNotBlank()) {
                val cleanTitle = title.trim()
                val cleanArtist = artist.trim()
                if (cleanArtist.isNotEmpty() && "$cleanTitle $cleanArtist" != query) {
                    found = searchVideoId("$cleanTitle $cleanArtist", expectedDurationSec)
                }
                if (found == null && cleanTitle != query) {
                    found = searchVideoId(cleanTitle, expectedDurationSec)
                }
            }
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

        val hasNonLatin = containsNonLatin(actual) || containsNonLatin(expected)

        if (expectedDurationSec > 0L && resolved.actualDurationSec > 0L) {
            val diff = abs(expectedDurationSec - resolved.actualDurationSec)
            return when {
                diff <= 45L -> true // duration is the strongest signal, allow intro/outro variance
                diff <= 240L -> sim >= 0.20 || hasNonLatin
                else -> sim >= 0.45
            }
        }
        return sim >= 0.20 || hasNonLatin
    }

    private fun containsNonLatin(s: String): Boolean =
        s.any { it.code > 0x0250 } // Non-basic Latin: CJK, Hangul, Cyrillic, Greek, etc.

    private fun normalizeForCompare(raw: String): String = raw
        .lowercase(Locale.US)
        .replace(Regex("\\(.*?\\)|\\[.*?\\]"), " ")
        .replace(
            Regex("(official|lyrics?|video|audio|visualizer|hd|hq|mv|remaster(ed)?|album|version|extended|e\\/s|c\\/w)"),
            " "
        )
        .replace(Regex("[^\\p{L}\\p{N} ]+"), " ")
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
            e.printStackTrace()
            try { Log.w(TAG, "extractor resolve failed for $videoId: ${e.message}") } catch (_: Throwable) {}
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

        // 1. NewPipeExtractor search on-device
        searchVideoIdViaExtractor(q, expectedDurationSec)?.let {
            searchCache[q] = SearchEntry(it, now())
            return it
        }

        // 2. Direct YouTube web search scraper fallback
        searchVideoIdViaWebScraper(q, expectedDurationSec)?.let {
            searchCache[q] = SearchEntry(it, now())
            return it
        }

        // 3. Piped search fallback (opportunistic; fleet mostly unreachable).
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
     * Shared scoring function for candidate YouTube items against a query and expected duration.
     */
    fun scoreCandidate(
        query: String,
        expectedDurationSec: Long,
        candidateTitle: String,
        candidateUploader: String,
        candidateDurationSec: Long
    ): Int {
        val expectedTokens = normalizeForCompare(query)
        val titleTokens = normalizeForCompare(candidateTitle)
        val uploaderTokens = if (candidateUploader.isNotBlank()) normalizeForCompare(candidateUploader) else ""
        val combinedActual = if (uploaderTokens.isNotEmpty()) "$uploaderTokens $titleTokens" else titleTokens

        val titleSim = tokenSimilarity(expectedTokens, combinedActual)
        val exactTitleBonus = if (expectedTokens.contains(titleTokens) || (titleTokens.length > 3 && titleTokens.contains(expectedTokens))) 200_000 else 0
        val titleScore = (500_000 * titleSim).toInt()

        val hasNonLatin = containsNonLatin(query) || containsNonLatin(candidateTitle)
        val nonLatinBonus = if (hasNonLatin) {
            val qChars = query.filter { it.code > 0x0250 }.toSet()
            val actualChars = (candidateTitle + " " + candidateUploader).filter { it.code > 0x0250 }.toSet()
            if (qChars.isNotEmpty() && actualChars.isNotEmpty()) {
                val overlap = qChars.intersect(actualChars).size.toDouble() / minOf(qChars.size, actualChars.size).toDouble()
                (250_000 * overlap).toInt()
            } else 0
        } else 0

        val durationScore: Int = if (expectedDurationSec <= 0L) {
            50_000
        } else {
            val diff = abs(candidateDurationSec - expectedDurationSec)
            when {
                diff <= 5L -> 300_000 - (diff * 2_000).toInt()
                diff <= 15L -> 250_000 - (diff * 2_000).toInt()
                diff <= 45L -> 150_000 - (diff * 1_000).toInt()
                diff <= 120L -> 50_000 - (diff * 200).toInt()
                else -> -200_000
            }
        }

        return titleScore + exactTitleBonus + nonLatinBonus + durationScore
    }

    fun searchCandidatesViaWebScraper(query: String): List<Candidate> {
        val q = query.trim()
        if (q.isEmpty()) return emptyList()
        return try {
            val encoded = URLEncoder.encode(q, "UTF-8")
            val url = URL("https://www.youtube.com/results?search_query=$encoded&hl=en")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 8000
                readTimeout = 8000
                setRequestProperty("User-Agent", BROWSER_UA)
                setRequestProperty("Accept-Language", "en-US,en;q=0.9")
                setRequestProperty("Cookie", "CONSENT=YES+cb.20210328-17-p0.en+FX+478; SOCS=CAESEwgDEgk0ODEzNzk5NDIaAmVuIAEaBgiA_LyaBg")
            }
            if (conn.responseCode !in 200..299) {
                println("DEBUG CODE: ${conn.responseCode}")
                return emptyList()
            }
            val rawStream = conn.inputStream
            val bytes = rawStream?.use { it.readBytes() } ?: ByteArray(0)
            val isGzip = bytes.size >= 2 && (bytes[0].toInt() and 0xFF) == 0x1F && (bytes[1].toInt() and 0xFF) == 0x8B
            val html = if (isGzip) {
                try {
                    java.util.zip.GZIPInputStream(bytes.inputStream()).bufferedReader(Charsets.UTF_8).use { it.readText() }
                } catch (_: Throwable) {
                    String(bytes, Charsets.UTF_8)
                }
            } else {
                String(bytes, Charsets.UTF_8)
            }
            conn.disconnect()

            val startIdx = html.indexOf("ytInitialData")
            if (startIdx == -1) return emptyList()
            val braceIdx = html.indexOf('{', startIdx)
            if (braceIdx == -1) return emptyList()
            val scriptEnd = html.indexOf("</script>", braceIdx)
            if (scriptEnd == -1) return emptyList()

            var rawJson = html.substring(braceIdx, scriptEnd).trim()
            if (rawJson.endsWith(";")) {
                rawJson = rawJson.substring(0, rawJson.length - 1).trim()
            }
            // Some pages have trailing JS assignments after the JSON like ";var meta = ..."
            val semiVarIdx = rawJson.indexOf(";var ")
            if (semiVarIdx != -1) {
                rawJson = rawJson.substring(0, semiVarIdx).trim()
            }

            val root = JSONObject(rawJson)
            val contents = root.optJSONObject("contents")
                ?.optJSONObject("twoColumnSearchResultsRenderer")
                ?.optJSONObject("primaryContents")
                ?.optJSONObject("sectionListRenderer")
                ?.optJSONArray("contents") ?: return emptyList()

            val candidates = mutableListOf<Candidate>()
            for (i in 0 until contents.length()) {
                val section = contents.optJSONObject(i)?.optJSONObject("itemSectionRenderer")?.optJSONArray("contents") ?: continue
                for (j in 0 until section.length()) {
                    val vr = section.optJSONObject(j)?.optJSONObject("videoRenderer") ?: continue
                    val vid = vr.optString("videoId", "")
                    if (vid.length != 11) continue

                    val runs = vr.optJSONObject("title")?.optJSONArray("runs")
                    var title = ""
                    if (runs != null) {
                        for (k in 0 until runs.length()) {
                            title += runs.optJSONObject(k)?.optString("text", "") ?: ""
                        }
                    } else {
                        title = vr.optJSONObject("title")?.optString("simpleText", "") ?: ""
                    }

                    val durStr = vr.optJSONObject("lengthText")?.optString("simpleText", "") ?: ""
                    var durSec = 0L
                    if (durStr.isNotEmpty()) {
                        val parts = durStr.split(":").mapNotNull { it.trim().toLongOrNull() }
                        if (parts.size == 2) {
                            durSec = parts[0] * 60 + parts[1]
                        } else if (parts.size == 3) {
                            durSec = parts[0] * 3600 + parts[1] * 60 + parts[2]
                        }
                    }

                    val uploader = vr.optJSONObject("ownerText")?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "")
                        ?: vr.optJSONObject("shortBylineText")?.optJSONArray("runs")?.optJSONObject(0)?.optString("text", "")
                        ?: ""

                    candidates.add(Candidate(vid, title, durSec, uploader))
                }
            }
            candidates
        } catch (e: Throwable) {
            println("DEBUG EXCEPTION: $e")
            Log.w(TAG, "searchCandidatesViaWebScraper failed: ${e.message}")
            emptyList()
        }
    }

    private fun searchVideoIdViaWebScraper(query: String, expectedDurationSec: Long): String? {
        val candidates = searchCandidatesViaWebScraper(query)
        if (candidates.isEmpty()) return null
        var bestId: String? = null
        var bestScore = Int.MIN_VALUE
        for (c in candidates) {
            if (c.duration <= 0L || c.duration > 1800L) continue
            val score = scoreCandidate(query, expectedDurationSec, c.title, c.uploader, c.duration)
            if (score > bestScore) {
                bestScore = score
                bestId = c.videoId
            }
        }
        return bestId
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

            var bestId: String? = null
            var bestScore = Int.MIN_VALUE
            for (item in info.relatedItems) {
                if (item !is StreamInfoItem) continue
                val id = try { extractVideoId(item.url) } catch (_: Throwable) { null } ?: continue
                val duration = try { item.duration } catch (_: Throwable) { -1L }
                if (duration <= 0L || duration > 1800L) continue // skip live / 30-min+ items

                val uploader = try { item.uploaderName ?: "" } catch (_: Throwable) { "" }
                val score = scoreCandidate(query, expectedDurationSec, item.name ?: "", uploader, duration)

                if (score > bestScore) {
                    bestScore = score
                    bestId = id
                }
            }
            bestId
        } catch (e: Throwable) {
            e.printStackTrace()
            try { Log.w(TAG, "extractor search failed: ${e.message}") } catch (_: Throwable) {}
            null
        }
    }

    private fun diffOf(a: Long, b: Long): Long = abs(a - b)

    private fun extractVideoId(url: String): String? {
        if (url.contains("v=")) {
            val raw = url.substringAfter("v=")
            val end = raw.indexOfFirst { it == '&' || it == '#' }
            val id = if (end == -1) raw else raw.substring(0, end)
            if (id.length == 11) return id
        }
        if (url.contains("youtu.be/")) {
            val raw = url.substringAfter("youtu.be/")
            val end = raw.indexOfFirst { it == '?' || it == '&' || it == '#' }
            val id = if (end == -1) raw else raw.substring(0, end)
            if (id.length == 11) return id
        }
        return null
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
            val rawStream = conn.inputStream
            val bytes = try {
                rawStream?.use { it.readBytes() } ?: return null
            } catch (_: Throwable) {
                return null
            }
            val isGzip = bytes.size >= 2 && (bytes[0].toInt() and 0xFF) == 0x1F && (bytes[1].toInt() and 0xFF) == 0x8B
            val body = if (isGzip) {
                try {
                    java.util.zip.GZIPInputStream(bytes.inputStream()).bufferedReader(Charsets.UTF_8).use { it.readText() }
                } catch (_: Throwable) {
                    String(bytes, Charsets.UTF_8)
                }
            } else {
                String(bytes, Charsets.UTF_8)
            }
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
            val rawStream = if (code in 200..299) conn.inputStream else conn.errorStream
            val bytes = try {
                rawStream?.use { it.readBytes() } ?: ByteArray(0)
            } catch (_: Throwable) {
                ByteArray(0)
            }
            val isActuallyGzip = bytes.size >= 2 &&
                (bytes[0].toInt() and 0xFF) == 0x1F &&
                (bytes[1].toInt() and 0xFF) == 0x8B
            val body = if (isActuallyGzip) {
                try {
                    java.util.zip.GZIPInputStream(bytes.inputStream()).bufferedReader(Charsets.UTF_8).use { it.readText() }
                } catch (_: Throwable) {
                    String(bytes, Charsets.UTF_8)
                }
            } else {
                String(bytes, Charsets.UTF_8)
            }
            val headerFields = conn.headerFields.filterKeys { it != null }
            val latestUrl = conn.url.toString()
            return Response(code, conn.responseMessage, headerFields, body, latestUrl)
        } finally {
            try { conn?.disconnect() } catch (_: Throwable) {}
        }
    }
}
