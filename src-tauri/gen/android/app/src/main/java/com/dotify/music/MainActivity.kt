package com.dotify.music

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : TauriActivity() {
  private var currentWebView: WebView? = null
  private var pendingAuthUri: String? = null
  private var pendingUpdateApkFile: File? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    activeInstance = this
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val webView = currentWebView
        if (webView != null) {
          webView.evaluateJavascript("window.__dotifyHandleBack ? window.__dotifyHandleBack() : false") { result ->
            val handled = result?.replace("\"", "")?.trim() == "true"
            if (!handled) {
              moveTaskToBack(true)
            }
          }
        } else {
          moveTaskToBack(true)
        }
      }
    })

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1002)
      }
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      window.attributes.layoutInDisplayCutoutMode =
        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }

    intent?.data?.let { uri ->
      if (uri.scheme == "dotify") {
        pendingAuthUri = uri.toString()
      }
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    if (activeInstance == this) {
      activeInstance = null
    }
  }

  override fun onResume() {
    super.onResume()
    val pendingApk = pendingUpdateApkFile
    if (pendingApk != null && pendingApk.exists()) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls()) {
        pendingUpdateApkFile = null
        launchPackageInstaller(pendingApk)
      }
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    currentWebView = webView

    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun openBrowser(url: String): Boolean {
        return try {
          val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
          intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          this@MainActivity.startActivity(intent)
          true
        } catch (e: Exception) {
          e.printStackTrace()
          false
        }
      }
    }, "AndroidNativeAuth")

    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun setAppIcon(themeKey: String): Boolean {
        return changeAppIcon(themeKey)
      }

      @JavascriptInterface
      fun getCurrentAppIcon(): String {
        return getActiveAppIcon()
      }
    }, "AndroidNativeTheme")

    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun searchYouTubeCandidates(query: String): String {
        return try {
          val encoded = java.net.URLEncoder.encode(query, "UTF-8")
          val url = URL("https://www.youtube.com/results?search_query=$encoded")
          val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 7000
            readTimeout = 7000
            setRequestProperty(
              "User-Agent",
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
            )
            setRequestProperty("Accept-Language", "en-US,en;q=0.9")
          }

          val html = conn.inputStream.bufferedReader().use { it.readText() }
          conn.disconnect()

          val match = Regex("""ytInitialData\s*=\s*(\{.+?\});(?:var|\s*</script>)""").find(html)
          if (match != null) {
            val jsonStr = match.groupValues[1]
            val root = org.json.JSONObject(jsonStr)
            val contents = root.optJSONObject("contents")
              ?.optJSONObject("twoColumnSearchResultsRenderer")
              ?.optJSONObject("primaryContents")
              ?.optJSONObject("sectionListRenderer")
              ?.optJSONArray("contents")

            val array = org.json.JSONArray()
            if (contents != null) {
              for (i in 0 until contents.length()) {
                val section = contents.optJSONObject(i)?.optJSONObject("itemSectionRenderer")?.optJSONArray("contents")
                if (section != null) {
                  for (j in 0 until section.length()) {
                    val vr = section.optJSONObject(j)?.optJSONObject("videoRenderer")
                    if (vr != null && vr.has("videoId")) {
                      val item = org.json.JSONObject()
                      val vid = vr.getString("videoId")
                      item.put("videoId", vid)

                      val runs = vr.optJSONObject("title")?.optJSONArray("runs")
                      var title = ""
                      if (runs != null) {
                        for (k in 0 until runs.length()) {
                          title += runs.getJSONObject(k).optString("text", "")
                        }
                      } else {
                        title = vr.optJSONObject("title")?.optString("simpleText", "") ?: ""
                      }
                      item.put("title", title)

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
                      item.put("duration", durSec)
                      array.put(item)
                    }
                  }
                }
              }
            }
            return array.toString()
          }
          "[]"
        } catch (e: Exception) {
          e.printStackTrace()
          "[]"
        }
      }
    }, "AndroidNativeYouTube")

    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun getVersionName(): String {
        return try {
          packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0.0"
        } catch (e: Exception) {
          "1.0.0"
        }
      }

      @JavascriptInterface
      fun downloadAndInstallApk(apkUrl: String): Boolean {
        Thread {
          try {
            emitUpdateProgress(6, "Connecting to release server...", null)

            var currentUrl = apkUrl
            var connection: HttpURLConnection? = null
            var redirects = 0
            while (redirects < 8) {
              val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 15000
                readTimeout = 30000
                setRequestProperty("User-Agent", "Dotify-Android-Updater/1.0")
              }
              val code = conn.responseCode
              if (code in 300..399) {
                val loc = conn.getHeaderField("Location")
                conn.disconnect()
                if (loc.isNullOrBlank()) break
                currentUrl = URL(URL(currentUrl), loc).toString()
                redirects++
              } else {
                connection = conn
                break
              }
            }

            val activeConn = connection
              ?: throw Exception("Too many redirects while resolving APK URL")

            if (activeConn.responseCode !in 200..299) {
              throw Exception("Server returned HTTP ${activeConn.responseCode}")
            }

            val totalBytes = activeConn.contentLengthLong.takeIf { it > 0 } ?: 42_000_000L
            val outFile = File(cacheDir, "dotify-update.apk")
            if (outFile.exists()) {
              outFile.delete()
            }

            activeConn.inputStream.use { input ->
              FileOutputStream(outFile).use { output ->
                val buffer = ByteArray(32768)
                var downloaded = 0L
                var lastEmitTime = 0L
                var read: Int
                while (input.read(buffer).also { read = it } != -1) {
                  output.write(buffer, 0, read)
                  downloaded += read
                  val now = System.currentTimeMillis()
                  if (now - lastEmitTime >= 150) {
                    lastEmitTime = now
                    val ratio = (downloaded.toDouble() / totalBytes.toDouble()).coerceIn(0.0, 0.95)
                    val pct = (10 + (ratio * 82.0)).toInt()
                    val mb = String.format("%.1f", downloaded.toDouble() / (1024.0 * 1024.0))
                    emitUpdateProgress(pct, "Downloading APK ($mb MB)...", null)
                  }
                }
                output.flush()
              }
            }
            activeConn.disconnect()

            // Verify valid ZIP/APK header ("PK\x03\x04") and size > 1 MB
            val isValidApk = if (outFile.exists() && outFile.length() > 1_000_000L) {
              val header = ByteArray(4)
              FileInputStream(outFile).use { fis ->
                fis.read(header) == 4 &&
                  header[0] == 0x50.toByte() &&
                  header[1] == 0x4B.toByte() &&
                  header[2] == 0x03.toByte() &&
                  header[3] == 0x04.toByte()
              }
            } else {
              false
            }

            if (!isValidApk) {
              outFile.delete()
              throw Exception("Downloaded APK file was incomplete or corrupted.")
            }

            emitUpdateProgress(96, "Launching Android package installer...", null)
            runOnUiThread {
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
                pendingUpdateApkFile = outFile
                emitUpdateProgress(
                  98,
                  "Allow 'Install unknown apps' for Dotify to finish updating...",
                  null
                )
                try {
                  val permIntent = Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:$packageName")
                  )
                  permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                  startActivity(permIntent)
                } catch (e: Exception) {
                  launchPackageInstaller(outFile)
                }
              } else {
                launchPackageInstaller(outFile)
              }
            }
          } catch (e: Exception) {
            e.printStackTrace()
            emitUpdateProgress(0, "Update failed", e.message ?: "Failed to download APK")
          }
        }.start()
        return true
      }
    }, "AndroidNativeUpdater")

    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun updateTrack(
        title: String,
        artist: String,
        album: String,
        artworkUrl: String,
        durationMs: Long,
        positionMs: Long,
        isPlaying: Boolean
      ) {
        try {
          val intent = Intent(this@MainActivity, DotifyMediaService::class.java).apply {
            action = DotifyMediaService.ACTION_UPDATE_TRACK
            putExtra(DotifyMediaService.EXTRA_TITLE, title)
            putExtra(DotifyMediaService.EXTRA_ARTIST, artist)
            putExtra(DotifyMediaService.EXTRA_ALBUM, album)
            putExtra(DotifyMediaService.EXTRA_ARTWORK, artworkUrl)
            putExtra(DotifyMediaService.EXTRA_DURATION, durationMs)
            putExtra(DotifyMediaService.EXTRA_POSITION, positionMs)
            putExtra(DotifyMediaService.EXTRA_IS_PLAYING, isPlaying)
          }
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
          } else {
            startService(intent)
          }
        } catch (e: Exception) {
          e.printStackTrace()
        }
      }

      @JavascriptInterface
      fun updatePlaybackState(isPlaying: Boolean, positionMs: Long) {
        try {
          val intent = Intent(this@MainActivity, DotifyMediaService::class.java).apply {
            action = DotifyMediaService.ACTION_UPDATE_PLAYBACK_STATE
            putExtra(DotifyMediaService.EXTRA_IS_PLAYING, isPlaying)
            putExtra(DotifyMediaService.EXTRA_POSITION, positionMs)
          }
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
          } else {
            startService(intent)
          }
        } catch (e: Exception) {
          e.printStackTrace()
        }
      }

      @JavascriptInterface
      fun stop() {
        try {
          val intent = Intent(this@MainActivity, DotifyMediaService::class.java).apply {
            action = DotifyMediaService.ACTION_STOP
          }
          startService(intent)
        } catch (e: Exception) {
          e.printStackTrace()
        }
      }
    }, "AndroidNativeMediaSession")

    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun minimizeApp(): Boolean {
        runOnUiThread {
          moveTaskToBack(true)
        }
        return true
      }

      @JavascriptInterface
      fun exitApp(): Boolean {
        runOnUiThread {
          finish()
        }
        return true
      }
    }, "AndroidNativeApp")

    pendingAuthUri?.let { uri ->
      deliverAuthUri(uri)
      pendingAuthUri = null
    }
  }

  private fun launchPackageInstaller(apkFile: File) {
    try {
      val apkUri = FileProvider.getUriForFile(
        this@MainActivity,
        "${packageName}.fileprovider",
        apkFile
      )
      val installIntent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(apkUri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      emitUpdateProgress(100, "Opening Android installer...", null)
      startActivity(installIntent)
    } catch (e: Exception) {
      e.printStackTrace()
      emitUpdateProgress(0, "Installer error", e.message ?: "Could not launch APK installer")
    }
  }

  private fun emitUpdateProgress(percent: Int, status: String, error: String?) {
    currentWebView?.post {
      val payload = JSONObject().apply {
        put("percent", percent)
        put("status", status)
        if (error != null) {
          put("error", error)
        } else {
          put("error", JSONObject.NULL)
        }
      }
      val js = "if (window.__onAndroidUpdateProgress) { window.__onAndroidUpdateProgress(${payload}); }"
      currentWebView?.evaluateJavascript(js, null)
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    intent.data?.let { uri ->
      if (uri.scheme == "dotify") {
        deliverAuthUri(uri.toString())
      }
    }
  }

  private fun deliverAuthUri(uriString: String) {
    currentWebView?.post {
      val quoted = JSONObject.quote(uriString)
      val js = "if (window.__handleGoogleAuthDeepLink) { window.__handleGoogleAuthDeepLink($quoted); } else { window.__pendingGoogleAuthDeepLink = $quoted; }"
      currentWebView?.evaluateJavascript(js, null)
    } ?: run {
      pendingAuthUri = uriString
    }
  }

  companion object {
    private var activeInstance: MainActivity? = null

    fun dispatchMediaAction(action: String, data: Long? = null) {
      activeInstance?.let { activity ->
        activity.currentWebView?.post {
          val js = if (data != null) {
            "if (window.__dotifyNativeMediaAction) { window.__dotifyNativeMediaAction('$action', $data); }"
          } else {
            "if (window.__dotifyNativeMediaAction) { window.__dotifyNativeMediaAction('$action'); }"
          }
          activity.currentWebView?.evaluateJavascript(js, null)
        }
      }
    }

    private val ALIAS_MAP = mapOf(
      "green" to "MainActivityDefault",
      "cyan" to "MainActivityCyan",
      "purple" to "MainActivityPurple",
      "pink" to "MainActivityPink",
      "orange" to "MainActivityOrange",
      "amber" to "MainActivityAmber",
      "red" to "MainActivityRed",
      "blue" to "MainActivityBlue"
    )
  }

  private fun changeAppIcon(themeKey: String): Boolean {
    return try {
      val normalized = themeKey.trim().lowercase()
      val targetAliasSuffix = ALIAS_MAP[normalized] ?: ALIAS_MAP["green"]!!
      val pm = packageManager
      val pkg = packageName
      val targetCompName = ComponentName(pkg, "$pkg.$targetAliasSuffix")

      val currentSetting = pm.getComponentEnabledSetting(targetCompName)
      if (currentSetting == PackageManager.COMPONENT_ENABLED_STATE_ENABLED ||
          (currentSetting == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && targetAliasSuffix == "MainActivityDefault")) {
        return true
      }

      // Step 1: Enable the target alias first so the launcher always sees an active component
      pm.setComponentEnabledSetting(
        targetCompName,
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
        PackageManager.DONT_KILL_APP
      )

      // Step 2: Disable all other aliases
      for ((_, aliasSuffix) in ALIAS_MAP) {
        if (aliasSuffix != targetAliasSuffix) {
          val comp = ComponentName(pkg, "$pkg.$aliasSuffix")
          if (pm.getComponentEnabledSetting(comp) != PackageManager.COMPONENT_ENABLED_STATE_DISABLED) {
            pm.setComponentEnabledSetting(
              comp,
              PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
              PackageManager.DONT_KILL_APP
            )
          }
        }
      }
      true
    } catch (e: Exception) {
      e.printStackTrace()
      false
    }
  }

  private fun getActiveAppIcon(): String {
    try {
      val pm = packageManager
      val pkg = packageName
      for ((key, aliasSuffix) in ALIAS_MAP) {
        val comp = ComponentName(pkg, "$pkg.$aliasSuffix")
        val setting = pm.getComponentEnabledSetting(comp)
        if (setting == PackageManager.COMPONENT_ENABLED_STATE_ENABLED ||
            (setting == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && aliasSuffix == "MainActivityDefault")) {
          return key
        }
      }
    } catch (e: Exception) {
      e.printStackTrace()
    }
    return "green"
  }
}
