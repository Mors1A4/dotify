package com.dotify.music

import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap

/**
 * Lightweight, direct-to-cloud mobile error logger.
 * Posts error events to Firestore `mobile_diagnostics` via REST so diagnostics
 * are captured even if the app screen is locked, in background, or WebView is unavailable.
 */
object CloudDiagnostics {

    private const val TAG = "DotifyCloudDiag"
    private const val FIREBASE_PROJECT_ID = "dotify-11e01"
    private const val ENDPOINT =
        "https://firestore.googleapis.com/v1/projects/$FIREBASE_PROJECT_ID/databases/(default)/documents/mobile_diagnostics"

    private val recentEvents = ConcurrentHashMap<String, Long>()

    fun log(
        category: String,
        message: String,
        level: String = "error",
        trackTitle: String = "",
        trackArtist: String = "",
        trackId: String = "",
        videoId: String = "",
        resolveError: String = "",
        details: Map<String, Any> = emptyMap()
    ) {
        val now = System.currentTimeMillis()
        val dedupKey = "$category:$message:$trackTitle"
        val last = recentEvents[dedupKey] ?: 0L
        if (now - last < 8000L) return
        recentEvents[dedupKey] = now

        // Purge old keys if map grows
        if (recentEvents.size > 50) {
            recentEvents.entries.removeIf { now - it.value > 60000L }
        }

        Thread {
            var conn: HttpURLConnection? = null
            try {
                val versionName = MainActivity.getAppVersion()

                val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                    timeZone = TimeZone.getTimeZone("UTC")
                }

                val fields = JSONObject()
                fields.put("timestamp", JSONObject().put("integerValue", now.toString()))
                fields.put("isoTime", JSONObject().put("stringValue", isoFormat.format(Date(now))))
                fields.put("level", JSONObject().put("stringValue", level))
                fields.put("category", JSONObject().put("stringValue", category))
                fields.put("message", JSONObject().put("stringValue", message.take(500)))
                fields.put("appVersion", JSONObject().put("stringValue", versionName))
                fields.put("platform", JSONObject().put("stringValue", "Android"))
                fields.put("deviceModel", JSONObject().put("stringValue", "${Build.MANUFACTURER} ${Build.MODEL} (SDK ${Build.VERSION.SDK_INT})"))
                fields.put("source", JSONObject().put("stringValue", "AndroidNative"))

                if (trackTitle.isNotBlank()) fields.put("trackTitle", JSONObject().put("stringValue", trackTitle.take(200)))
                if (trackArtist.isNotBlank()) fields.put("trackArtist", JSONObject().put("stringValue", trackArtist.take(200)))
                if (trackId.isNotBlank()) fields.put("trackId", JSONObject().put("stringValue", trackId.take(100)))
                if (videoId.isNotBlank()) fields.put("videoId", JSONObject().put("stringValue", videoId.take(50)))
                if (resolveError.isNotBlank()) fields.put("resolveError", JSONObject().put("stringValue", resolveError.take(500)))

                if (details.isNotEmpty()) {
                    val sub = JSONObject()
                    for ((k, v) in details) {
                        sub.put(k, JSONObject().put("stringValue", v.toString().take(200)))
                    }
                    fields.put("details", JSONObject().put("mapValue", JSONObject().put("fields", sub)))
                }

                val rootBody = JSONObject().put("fields", fields).toString()

                val url = URL(ENDPOINT)
                conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 7000
                    readTimeout = 7000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
                conn.outputStream.use { os ->
                    os.write(rootBody.toByteArray(Charsets.UTF_8))
                    os.flush()
                }

                val code = conn.responseCode
                Log.d(TAG, "Shipped diagnostic to Firestore ($code): $category - $message")
            } catch (t: Throwable) {
                Log.w(TAG, "Failed to ship diagnostic to Firestore: ${t.message}")
            } finally {
                try { conn?.disconnect() } catch (_: Throwable) {}
            }
        }.apply {
            name = "dotify-cloud-diag"
            start()
        }
    }
}
