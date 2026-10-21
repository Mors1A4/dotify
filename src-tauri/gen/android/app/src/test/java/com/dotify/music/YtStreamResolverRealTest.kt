package com.dotify.music

import androidx.media3.common.MediaItem
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.mp4.Mp4Extractor
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL

class YtStreamResolverRealTest {

    @Test
    fun testResolveHanRiver() {
        val query = "So Hee Song - Folk song for Han River"
        val candidates = YtStreamResolver.searchCandidates(query)
        println("Candidates found: ${candidates.size}")
        candidates.take(3).forEach { println(" Candidate: ${it.videoId} - ${it.title} (${it.duration}s)") }
        assert(candidates.isNotEmpty())
        val firstId = candidates.first().videoId

        val resolved = YtStreamResolver.resolve(
            videoId = firstId,
            artist = "So Hee Song",
            title = "Folk song for Han River",
            expectedDurationSec = 244,
            forceRefresh = true
        )
        println("Resolved: $resolved")
        assert(resolved != null)

        val url = resolved!!.url
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36")
        conn.setRequestProperty("Range", "bytes=0-1024")
        conn.connectTimeout = 8000
        conn.readTimeout = 8000
        val code = conn.responseCode
        println("HTTP response code: $code, content-type: ${conn.contentType}")
        assert(code in 200..299)
    }

    @Test
    fun testWebScraperHtmlFetch() {
        val query = "So Hee Song - Folk song for Han River"
        val encoded = java.net.URLEncoder.encode(query, "UTF-8")
        val url = java.net.URL("https://www.youtube.com/results?search_query=$encoded&hl=en")
        val conn = (url.openConnection() as java.net.HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 8000
            readTimeout = 8000
            setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36")
            setRequestProperty("Accept-Language", "en-US,en;q=0.9")
            setRequestProperty("Cookie", "CONSENT=YES+cb.20210328-17-p0.en+FX+478; SOCS=CAESEwgDEgk0ODEzNzk5NDIaAmVuIAEaBgiA_LyaBg")
        }
        val code = conn.responseCode
        assert(code in 200..299)
        val bytes = conn.inputStream.use { it.readBytes() }
        assert(bytes.isNotEmpty())
        val html = String(bytes, Charsets.UTF_8)
        assert(html.contains("ytInitialData"))
        println("Web scraper successfully retrieved YouTube HTML with ytInitialData (${bytes.size} bytes)")
    }

    @Test
    fun testResolveWithoutVideoId() {
        val resolved = YtStreamResolver.resolve(
            videoId = null,
            artist = "So Hee Song",
            title = "Folk song for Han River",
            expectedDurationSec = 244,
            forceRefresh = true
        )
        println("Resolved without videoId: $resolved")
        assert(resolved != null)
    }
}

