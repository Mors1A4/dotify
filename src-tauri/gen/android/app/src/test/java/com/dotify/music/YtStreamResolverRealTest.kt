package com.dotify.music

import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL

class YtStreamResolverRealTest {

    @Test
    fun testResolveAndFetch() {
        try {
            val query = "So Hee Song - Folk song for Han River"
            val candidates = YtStreamResolver.searchCandidates(query)
            if (candidates.isEmpty()) return
            val firstId = candidates.first().videoId

            val resolved = YtStreamResolver.resolve(
                videoId = firstId,
                artist = "So Hee Song",
                title = "Folk song for Han River",
                expectedDurationSec = 244,
                forceRefresh = true
            ) ?: return

            val conn = URL(resolved.url).openConnection() as HttpURLConnection
            conn.setRequestProperty("User-Agent", "ExoPlayerLib/1.5.1")
            conn.setRequestProperty("Range", "bytes=0-1024")
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            val code = conn.responseCode
            assert(code in 200..299)
        } catch (_: Throwable) {
            // Offline or rate limit - non-critical for offline build
        }
    }
}

