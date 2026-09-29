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
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

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
