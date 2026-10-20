package com.dotify.music

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
        if (candidates.isEmpty()) return
        val firstId = candidates.first().videoId

        val resolved = YtStreamResolver.resolve(
            videoId = firstId,
            artist = "So Hee Song",
            title = "Folk song for Han River",
            expectedDurationSec = 244,
            forceRefresh = true
        )
        println("Resolved: $resolved")
        if (resolved == null) return

        val conn = URL(resolved.url).openConnection() as HttpURLConnection
        conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36")
        conn.setRequestProperty("Range", "bytes=0-1024")
        conn.connectTimeout = 8000
        conn.readTimeout = 8000
        val code = conn.responseCode
        println("HTTP response code: $code, content-type: ${conn.contentType}")
        assert(code in 200..299)
    }
}
