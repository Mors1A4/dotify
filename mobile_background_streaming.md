# Mobile Background & Screen-Off Streaming: Complete Investigation, Attempts, and Architectural Analysis

> **Document Version:** 1.0.0  
> **Target Project:** Dotify (`notify`) — Tauri v2 Android & Desktop Music Streaming Application  
> **Date:** October 18, 2026  
> **Status:** Active Reference & Architectural Post-Mortem  

---

## 1. Executive Summary & Problem Definition

### The Goal
In Dotify on mobile Android, when a user starts streaming a song and either:
1. **Locks the phone / turns off the screen** (power button press), or
2. **Minimizes the app / switches to another application** (home gesture, multitasking),

**the music must continue streaming persistently, seamlessly, and indefinitely** through the device speakers, connected Bluetooth headphones, or wired headsets.

### The Symptom
Despite extensive iterative attempts from version `1.0.30` through `1.0.38`:
- When the screen is turned off or the app is minimized, **audio output cuts off or mutes**.
- In the Android notification shade and lock screen, `DotifyMediaService` remains visible, the ongoing notification displays the song title, artist, and artwork, and the playback state says **"Playing"** with active playback controls.
- However, **no audio is rendered to the device hardware**.
- In several intermediate versions, attempting to force playback caused an **"instant pause after 1 millisecond"** stutter loop.

This document records the exhaustive technical details of every hypothesis formulated, every code change made across versions `1.0.30` through `1.0.38`, why each attempt failed at the Android OS and Chromium level, and the definitive architectural solution required to permanently solve mobile background streaming.

---

## 2. Core Architecture of Dotify's Audio Subsystem

To understand why the attempted workarounds failed, it is necessary to examine how audio playback is wired in Dotify:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Android OS (Linux Kernel, AudioFlinger, SurfaceFlinger, PowerManager) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
         ┌──────────────────────────┴──────────────────────────┐
         │                                                     │
         ▼                                                     ▼
┌────────────────────────────────┐         ┌────────────────────────────────┐
│      MainActivity.kt           │         │     DotifyMediaService.kt      │
│  (Android Activity / UI layer) │         │ (Android ForegroundService)    │
├────────────────────────────────┤         ├────────────────────────────────┤
│ • Hosts RustWebView (Chromium) │         │ • FOREGROUND_SERVICE_MEDIA     │
│ • Runs React / TypeScript UI   │         │ • MediaSessionCompat           │
│ • AudioEngine.ts               │         │ • System Notification shade    │
│ • YouTubeIframeBridge.ts       │         │ • WakeLock (PARTIAL_WAKE_LOCK) │
│ • Embedded YouTube <iframe>    │         │ • WifiLock (LOW_LATENCY)       │
│ • HTML5 <video> / <audio> tags │         │ • AudioManager (AUDIOFOCUS)    │
│                                │         │                                │
│ ⚠️ TIED TO WINDOW DISPLAY      │         │ ⚠️ DOES NOT ACTUALLY PLAY      │
│    SURFACE (Destroyed on lock) │         │    AUDIO (Notification only)   │
└────────────────────────────────┘         └────────────────────────────────┘
```

1. **The UI and Playback Engine (`MainActivity` / `RustWebView`):**
   - The user interface is a web application written in React 18 and TypeScript, packaged into an Android APK via Tauri v2.
   - Playback of standard tracks is driven by [`AudioEngine.ts`](file:///c:/Users/monty/Documents/AB/notify/src/audio/audioEngine.ts) and [`youtubeIframeBridge.ts`](file:///c:/Users/monty/Documents/AB/notify/src/audio/youtubeIframeBridge.ts).
   - Because raw YouTube Innertube player APIs block automated, non-browser clients (requiring complex PoToken / BotGuard execution), Dotify uses YouTube's official IFrame Player API (`https://www.youtube.com/iframe_api`).
   - The iframe creates an internal HTML5 `<video>` element inside the Chromium WebView to stream encrypted video/audio chunks from Google's CDN (`googlevideo.com`).

2. **The Background Service (`DotifyMediaService`):**
   - An Android `Service` declared with `android:foregroundServiceType="mediaPlayback"`.
   - Manages lock-screen transport controls and notification metadata via AndroidX `MediaSessionCompat` and `NotificationCompat.MediaStyle`.
   - Holds a `PowerManager.WakeLock` (`PARTIAL_WAKE_LOCK`) and a `WifiManager.WifiLock`.
   - **Crucial Architectural Disconnect:** `DotifyMediaService` was implemented solely as a metadata and notification coordinator. The actual audio decoding and stream playback remained entirely inside the WebView of `MainActivity`.

---

## 3. Chronological History of Everything Attempted (v1.0.30 – v1.0.38)

Here is the complete record of every approach tested, the exact code modifications deployed, and the precise failure mode encountered on real Android devices.

---

### Attempt 1: Foreground Service, WakeLocks & Basic Auto-Resume
**Version:** `1.0.30` (`ffce1e3`)  
**Target Files:** `DotifyMediaService.kt`, `MainActivity.kt`, `youtubeIframeBridge.ts`, `AndroidManifest.xml`

#### Hypotheses:
1. Android OS puts the application CPU to sleep when the screen turns off.
2. The YouTube iframe player pauses when minimized; automatically calling `player.playVideo()` on pause will keep it playing.

#### Implementation:
- Declared `FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK` in `AndroidManifest.xml`.
- Initialized `PowerManager.PARTIAL_WAKE_LOCK` and `WifiManager.WIFI_MODE_FULL_HIGH_PERF` inside `DotifyMediaService.kt`.
- In `youtubeIframeBridge.ts`, added auto-resume logic inside `onStateChange`:
  ```ts
  case 2: // PAUSED
    if (!this.userInitiatedPause) {
      this.player?.playVideo();
      return;
    }
  ```

#### Result & Why it Failed:
- **Audio still died on screen off.**
- While the CPU remained awake due to `PARTIAL_WAKE_LOCK`, Android's `WindowManager` paused the Activity. Chromium immediately suspended JavaScript timer execution and throttled DOM rendering, making `playVideo()` ineffective once the window was occluded.

---

### Attempt 2: AudioFocus in Service & 1×1 px Player Dimensions
**Version:** `1.0.31` (`0d06e84`)  
**Target Files:** `DotifyMediaService.kt`, `MainActivity.kt`, `youtubeIframeBridge.ts`

#### Hypotheses:
1. Android's audio daemon (`AudioFlinger`) requires system Audio Focus to keep audio tracks unmuted when an Activity loses focus.
2. Shrinking the YouTube iframe container to `1px × 1px` will prevent video rendering overhead and battery drain.

#### Implementation:
- Added `AudioManager.requestAudioFocus()` inside `DotifyMediaService.kt` using `AUDIOFOCUS_GAIN`.
- Reduced the iframe container dimensions to `width: 1px; height: 1px; opacity: 0.01;`.

#### Result & Why it Failed:
- **Instant Regression:** Songs began instantly pausing after 1 millisecond.
- **Root Cause:** 
  1. YouTube's web player script (`base.js`) includes an internal viewport check. When rendered into a container smaller than roughly $200\text{px} \times 200\text{px}$, YouTube's anti-fraud/viewability watchdog triggers an automatic pause.
  2. The Audio Focus listener in the service fired an immediate `ACTION_PAUSE` callback back to the WebView due to a transient focus change loop.

---

### Attempt 3: Removing AudioFocus Loop & Restoring 200×200 px Player
**Version:** `1.0.32` (`af6a448`)  
**Target Files:** `DotifyMediaService.kt`, `youtubeIframeBridge.ts`

#### Hypotheses:
1. Removing the conflicting Audio Focus loop will eliminate the 1-millisecond pause stutter.
2. Restoring the player container to `200px × 200px` with `opacity: 0.02` will satisfy YouTube's viewability requirements while keeping the player invisible to the user.

#### Implementation:
- Stripped the `AudioManager.requestAudioFocus` implementation from `DotifyMediaService.kt`.
- Restored iframe styling: `width: 200px; height: 200px; opacity: 0.02; z-index: -9999;`.

#### Result & Why it Failed:
- The 1ms stutter while the app was in the foreground was resolved.
- However, background and screen-off playback remained completely broken. As soon as the screen locked, audio vanished.

---

### Attempt 4: Detaching `WryLifecycleObserver` & Deferring Battery Optimization Dialog
**Version:** `1.0.33` (`7df833e`)  
**Target Files:** `MainActivity.kt`

#### Hypotheses:
1. Tauri's native Android harness (`tao`/`wry`) attaches a `ProcessLifecycleOwner` observer (`WryLifecycleObserver`).
2. When the Activity goes to the background, `WryLifecycleObserver.onPause()` calls `Rust.pause()` and `WryLifecycleObserver.onStop()` calls `Rust.stop()`, freezing the Rust runtime and the WebView IPC event loop.
3. The battery optimization intent was stealing window focus on launch.

#### Implementation:
- In `MainActivity.onCreate()`:
  ```kotlin
  try {
    ProcessLifecycleOwner.get().lifecycle.removeObserver(WryLifecycleObserver)
  } catch (_: Exception) {}
  ```
- Deferred `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` by 3,000 ms so it would not interfere with the initial view initialization.

#### Result & Why it Failed:
- Prevented Rust from freezing its internal event loop, but **audio still cut off when the screen turned off**.
- The freeze was not occurring in Rust; it was occurring in the Android Chromium renderer process itself when the window surface was torn down by the OS.

---

### Attempt 5: Cross-Frame Page Visibility Mocking & Desktop User-Agent Spoofing
**Version:** `1.0.34` (`c82a9f9`)  
**Target Files:** `MainActivity.kt`, `youtubeIframeBridge.ts`

#### Hypotheses:
1. YouTube's player script pauses because it detects `document.visibilityState === 'hidden'` and listens to `visibilitychange` events.
2. YouTube's player enforces mobile background restrictions only when `navigator.userAgent` identifies as Android/Mobile. On Desktop Chrome (Windows), YouTube allows continuous background audio.

#### Implementation:
- Used `WebViewCompat.addDocumentStartJavaScript(webView, bgScript, setOf("*"))` to inject a start script across all main frames and cross-origin YouTube player iframes:
  ```javascript
  var fakeHidden = { get: function() { return false; }, configurable: true };
  var fakeState = { get: function() { return 'visible'; }, configurable: true };
  Object.defineProperty(document, 'hidden', fakeHidden);
  Object.defineProperty(document, 'visibilityState', fakeState);
  window.addEventListener('visibilitychange', function(e) { e.stopImmediatePropagation(); }, true);
  document.addEventListener('visibilitychange', function(e) { e.stopImmediatePropagation(); }, true);
  window.addEventListener('blur', function(e) { e.stopImmediatePropagation(); }, true);
  window.addEventListener('pagehide', function(e) { e.stopImmediatePropagation(); }, true);
  window.addEventListener('freeze', function(e) { e.stopImmediatePropagation(); }, true);
  document.hasFocus = function() { return true; };

  // Spoof Desktop Chrome for youtube.com and googlevideo.com
  var desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
  Object.defineProperty(navigator, 'userAgent', { get: function() { return desktopUA; }, configurable: true });
  Object.defineProperty(navigator, 'platform', { get: function() { return 'Win32'; }, configurable: true });
  ```

#### Result & Why it Failed:
- YouTube's JavaScript inside the iframe was successfully tricked into believing the page was visible and running on Desktop Chrome.
- **However, audio still stopped when the screen turned off.**
- **Why?** This proved conclusively that the stoppage was **not** triggered by JavaScript Page Visibility APIs. The stoppage was happening at the native C++ layer of Chromium (`media::WebMediaPlayerImpl` and `media::AudioRendererImpl`), which hooks into Android's low-level display surface state.

---

### Attempt 6: Overriding `onPause` & `RustWebView` Visibility Methods
**Version:** `1.0.36` (`ee4d8b1`)  
**Target Files:** `RustWebView.kt`, `WryActivity.kt`, `MainActivity.kt`

#### Hypotheses:
1. Tauri's `WryActivity.kt` explicitly calls `mWebView.onPause()`:
   ```kotlin
   override fun onPause() {
       super.onPause()
       if (::mWebView.isInitialized) {
           mWebView.onPause() // <-- Suspends all WebView timers and HTML5 media!
       }
   }
   ```
2. Android `View` hierarchy propagates window visibility changes (`View.GONE`, `View.INVISIBLE`) directly into Chromium's C++ `AwContents` via `onWindowVisibilityChanged` and `dispatchWindowVisibilityChanged`.

#### Implementation:
- Modified `WryActivity.kt` to replace `mWebView.onPause()` with `mWebView.resumeTimers()`.
- Added visibility overrides to `RustWebView.kt`:
  ```kotlin
  override fun onPause() { /* swallow */ }
  override fun onWindowVisibilityChanged(visibility: Int) {
      super.onWindowVisibilityChanged(android.view.View.VISIBLE)
  }
  override fun dispatchWindowVisibilityChanged(visibility: Int) {
      super.dispatchWindowVisibilityChanged(android.view.View.VISIBLE)
  }
  override fun onVisibilityChanged(changedView: android.view.View, visibility: Int) {
      super.onVisibilityChanged(changedView, android.view.View.VISIBLE)
  }
  ```

#### Result & Why it Failed:
- **Tauri Build Pipeline Trap:** During `npx tauri android build`, Tauri's CLI regenerates all files in `src-tauri/gen/android/app/src/main/java/com/dotify/music/generated/` (including `RustWebView.kt` and `WryActivity.kt`) from internal template strings, wiping out custom Kotlin modifications.
- Even when methods were overridden in `MainActivity.kt`, the Android OS WindowManager destroyed the underlying `SurfaceView` texture upon screen lock.

---

### Attempt 7: Silent Media Keeper Loop & Screen Off/On BroadcastReceiver
**Version:** `1.0.37` (`4665f4b`)  
**Target Files:** `AudioEngine.ts`, `DotifyMediaService.kt`, `mediaSession.ts`

#### Hypotheses:
1. If the top-level HTML document plays an active HTML5 `<audio>` stream, Chromium will keep the audio pipeline open even if a subframe `<video>` element is obscured.
2. Registering an Android `BroadcastReceiver` for `ACTION_SCREEN_OFF` can proactively call `webView.onResume()` and `webView.resumeTimers()`.

#### Implementation:
- In `AudioEngine.ts`, created a 48-byte silent base64 WAV PCM keeper audio element (`silentKeeperAudio`):
  ```ts
  audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
  audio.loop = true;
  audio.volume = 0.0001;
  ```
- Started this silent loop whenever a YouTube track was loaded.
- In `DotifyMediaService.kt`, registered a receiver for `ACTION_SCREEN_OFF`, `ACTION_SCREEN_ON`, and `ACTION_USER_PRESENT` to force `MainActivity.refreshWebViewState()`.

#### Result & Why it Failed:
- **Catastrophic Failure:** Re-introduced the **instant pause after 1 millisecond** glitch.
- **Root Cause:** Android's `WebView` audio focus architecture only allows a single active HTML media stream per context unless multi-audio focus is explicitly negotiated. Calling `.play()` on the silent `<audio>` element caused Chromium to automatically pause the YouTube iframe's `<video>` element!
- On screen lock, both the silent keeper and the YouTube player were muted together.

---

### Attempt 8: Native AudioFocus (`AUDIOFOCUS_GAIN`), Frame Unthrottling (`opacity: 1`), and Keeper Removal
**Version:** `1.0.38` (`f69358b`)  
**Target Files:** `DotifyMediaService.kt`, `AudioEngine.ts`, `youtubeIframeBridge.ts`

#### Hypotheses:
1. Removing the silent keeper loop will permanently eliminate the 1ms pause collision.
2. Styling the iframe container with `opacity: 1; left: -9999px; top: -9999px;` will prevent Chromium from applying its zero-opacity subframe throttling heuristic.
3. Managing `AudioManager.AUDIOFOCUS_GAIN` with `AudioAttributes.USAGE_MEDIA` inside `DotifyMediaService` will inform `AudioFlinger` that `com.dotify.music` is the active system media owner.

#### Implementation:
- Completely removed `silentKeeperAudio` and all its hooks from `AudioEngine.ts`.
- Repositioned the iframe container in `youtubeIframeBridge.ts`:
  ```ts
  container.setAttribute(
    'style',
    'position: fixed; width: 200px; height: 200px; left: -9999px; top: -9999px; pointer-events: none; opacity: 1; z-index: 1;'
  );
  ```
- Implemented full `AudioFocusRequest` in `DotifyMediaService.kt`:
  ```kotlin
  val audioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
      .build()
  val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
      .setAudioAttributes(audioAttributes)
      .setAcceptsDelayedFocusGain(true)
      .build()
  audioManager.requestAudioFocus(focusRequest)
  ```

#### Result & Why it Failed:
- The 1ms stutter in the foreground was gone, and the app held system audio focus.
- **However, music STILL stopped when the phone screen was turned off.**
- **The decisive reason:** Even with `AUDIOFOCUS_GAIN`, `PARTIAL_WAKE_LOCK`, `WIFI_LOCK`, and a `ForegroundService`, **the audio source itself was still trapped inside the WebView**.

---

## 4. Deep Root Cause Analysis: Why WebView Audio CANNOT Survive Screen-Off on Android

Through these 8 versions of extensive experimentation, we have uncovered the exact hardware and operating system barriers that prevent WebView-based audio from functioning with the screen off:

### 1. Surface Destruction in the Android Display Pipeline
- An Android `Activity` (`MainActivity`) is a UI component tied to a physical display `Surface` managed by `SurfaceFlinger`.
- When the user presses the power button, the display panel turns off. Android's WindowManager detaches and destroys the Activity's surface.
- In Chromium on Android, the YouTube iframe player renders inside an HTML5 `<video>` element.
- Chromium's hardware video decoder pipeline (`WebMediaPlayerImpl` / `GpuVideoAcceleratorFactories`) requires an active native window surface (`android.view.Surface`).
- **When the surface is destroyed, Chromium's media pipeline halts decoding**. Because video and audio are synchronized inside the single WebM/MP4 demuxer, freezing the video decode clock immediately halts the audio clock.

### 2. Chromium C++ Audio Track Lifecycle vs. Android HAL
- When an HTML5 media element plays inside a WebView, Chromium creates an internal `AudioTrack` or opens an AAudio stream via its C++ `media::AudioRendererImpl`.
- This `AudioTrack` is attributed to the **Activity's window process**, NOT to `DotifyMediaService`.
- Android's power management kernel (`Doze` and `App Standby`) detects that the Activity hosting the window is in the `STOPPED` state.
- Even if a separate Foreground Service is running in the same process, Android's `AudioFlinger` daemon does not grant background execution immunity to audio tracks created by backgrounded Activity windows.

### 3. YouTube Embed Anti-Background Enforcement
- Google explicitly restricts background playback of YouTube videos on mobile devices (reserving it for YouTube Premium subscribers).
- Even when `document.hidden` and `navigator.userAgent` are spoofed, YouTube's web player script periodically checks:
  1. `requestAnimationFrame` and `requestVideoFrameCallback` execution intervals (which the OS completely suspends when the screen is dark).
  2. Intersection observer bounds against the screen rasterizer.
  3. Continuous frame rendering acknowledgments.
- When any of these checks fail, the player internally fires `pauseVideo()`.

---

## 5. How Real Android Music Apps Actually Work

Every production music application on Android—without exception—follows a single architecture:

| Application | Audio Engine Location | Audio Player Technology | Uses WebView for Audio? |
| :--- | :--- | :--- | :--- |
| **Spotify** | Native Android Service | Native C++ libspotify / OpenSL ES | ❌ **No** |
| **YouTube Music** | Native Android Service | AndroidX `Media3` / `ExoPlayer` | ❌ **No** |
| **Apple Music** | Native Android Service | Native Android MediaPlayer | ❌ **No** |
| **RiMusic / ViMusic** | Native Android Service | AndroidX `Media3` (`ExoPlayer`) | ❌ **No** |
| **NewPipe** | Native Android Service | AndroidX `ExoPlayer` | ❌ **No** |
| **Spotube** | Native Background Service | Flutter `just_audio` / ExoPlayer | ❌ **No** |

**Zero production music streaming apps play audio inside an Android WebView.**

In real Android apps:
1. The **UI (WebView, React, Flutter, Compose, etc.)** is only used for search, browsing playlists, displaying album art, and user controls.
2. When the user taps "Play", the UI sends the track metadata or stream URL to the **native `Service`**.
3. The **native `Service`** (`DotifyMediaService`) instantiates a native Android media player (`android.media.MediaPlayer` or AndroidX `ExoPlayer`).
4. The native player decodes and plays the audio directly through the Linux audio HAL (`AudioFlinger`).
5. Because the native player is instantiated in the `Service` and has **zero dependency on an Activity, Window, Surface, or DOM**, it is 100% immune to screen-off surface teardown.

---

## 6. The Deterministic Solution: Architectural Roadmap

To permanently fix background audio playback on mobile, Dotify must move audio decoding and streaming out of the WebView into a native Android player inside `DotifyMediaService`.

### Architecture of the Deterministic Solution

```
┌────────────────────────────────────────────────────────┐
│                   WebView / React                      │
│   • Displays UI, search, playlists, album artwork      │
│   • Resolves track / YouTube video ID                  │
│   • Calls: window.AndroidNativePlayer.playTrack(...)    │
└───────────────────────────┬────────────────────────────┘
                            │ (JavaScript Interface)
                            ▼
┌────────────────────────────────────────────────────────┐
│                   MainActivity.kt                      │
│   • Forwards play intent to DotifyMediaService         │
└───────────────────────────┬────────────────────────────┘
                            │ (Intent / Bound Service)
                            ▼
┌────────────────────────────────────────────────────────┐
│                DotifyMediaService.kt                   │
│   • Android ForegroundService (mediaPlayback)          │
│   • Holds PARTIAL_WAKE_LOCK & WIFI_LOCK                │
│   • Holds AudioManager AUDIOFOCUS_GAIN                 │
│   • Hosts: android.media.MediaPlayer or ExoPlayer      │
│   • Plays direct audio stream (HTTPS / MP3 / M4A)      │
│                                                        │
│   ✅ NO WINDOW SURFACE DEPENDENCY                      │
│   ✅ NO CHROMIUM PROCESS DEPENDENCY                    │
│   ✅ PLAYS PERSISTENTLY FOR HOURS WITH SCREEN OFF       │
└────────────────────────────────────────────────────────┘
```

### The Three Viable Implementation Paths

#### Path A: Intercepting Signed Audio Stream URLs via `RustWebViewClient`
- When the YouTube IFrame player loads in the WebView, Chromium's network stack makes an HTTPS request to `https://*.googlevideo.com/videoplayback?...mime=audio%2F...`.
- `RustWebViewClient.shouldInterceptRequest()` intercepts every network request.
- When `shouldInterceptRequest` observes a `googlevideo.com` audio stream URL:
  1. It captures that exact, signed, cryptographically valid URL.
  2. It immediately mutes the WebView iframe player.
  3. It sends the stream URL to `DotifyMediaService.playNativeStream(url, positionMs)`.
  4. Native `android.media.MediaPlayer` plays the direct audio stream in the foreground service.
- **Advantage:** Completely bypasses YouTube BotGuard/PoToken blocks because Google's official web player script in the WebView solved the cipher and generated the signed URL.

#### Path B: Native Direct Stream Resolution in Android
- For non-YouTube tracks (Radio, Audius, Internet Archive, Local MP3 Vault, Deezer Preview):
  - These tracks **already have direct HTTP/HTTPS streaming URLs**.
  - Pass the URL directly to `DotifyMediaService` via a new `@JavascriptInterface`:
    `AndroidNativePlayer.playDirectStream(url, title, artist, artworkUrl)`.
  - Native `MediaPlayer` in `DotifyMediaService` plays the audio.
- For YouTube tracks:
  - Use a lightweight server or local stream resolver endpoint (`/api/stream/track` or Piped/Invidious audio format endpoint) to return the direct audio URL to the service.

#### Path C: Native ExoPlayer Integration (`androidx.media3`)
- Add `androidx.media3:media3-exoplayer` and `androidx.media3:media3-session` to `src-tauri/gen/android/app/build.gradle.kts`.
- Implement `MediaSessionService` in `DotifyMediaService.kt`.
- ExoPlayer is Google's official, highly optimized Android audio engine that supports adaptive bitrate streaming, gapless playback, lock-screen scrubbing, and zero-latency audio routing.

---

## 7. Summary Table of Attempts & Outcomes

| Attempt | Version | Strategy | What Changed | Why It Failed |
| :---: | :---: | :--- | :--- | :--- |
| **1** | `v1.0.30` | ForegroundService & WakeLocks | Added `PARTIAL_WAKE_LOCK`, `WIFI_LOCK`, auto-resume in `youtubeIframeBridge.ts` | CPU stayed awake, but Chromium renderer paused when window was occluded |
| **2** | `v1.0.31` | Service AudioFocus & 1×1 px Player | Added `AudioManager.requestAudioFocus`, shrank iframe to 1×1 px | Triggered YouTube fraud/viewability pause watchdog + audio focus loop (1ms stutter) |
| **3** | `v1.0.32` | Revert AudioFocus & Restore 200×200 px | Stripped AudioFocus loop, restored container to 200×200 px | Fixed 1ms stutter in foreground, but screen-off playback still died |
| **4** | `v1.0.33` | Detach WryLifecycleObserver | Removed observer from `ProcessLifecycleOwner` to stop `Rust.pause()` | Kept Rust event loop alive, but Chromium WebView still suspended media |
| **5** | `v1.0.34` | Page Visibility API & Desktop UA Spoof | Injected `DOCUMENT_START_SCRIPT` spoofing `visibilityState='visible'` & Desktop Chrome | Tricked YouTube JS, but OS display surface detachment still killed C++ audio renderer |
| **6** | `v1.0.36` | Subclass `RustWebView` & Swallow `onPause` | Overrode `onWindowVisibilityChanged` to return `VISIBLE` | Tauri build pipeline regenerates `generated/` files, wiping overrides on build |
| **7** | `v1.0.37` | Silent WAV Keeper & Screen BroadcastReceiver | Added silent WAV audio loop in `AudioEngine.ts` & screen-off receiver | Silent `<audio>` loop collided with YouTube `<video>` audio focus, causing 1ms pause |
| **8** | `v1.0.38` | System AudioFocus & Container `opacity: 1` | Removed keeper, set `opacity: 1; left: -9999px;`, added system `AUDIOFOCUS_GAIN` | Holds OS audio focus, but audio source is still trapped in WebView's destroyed surface |

---

## 8. Conclusion

Web-based tricks—such as faking DOM visibility, spoofing User-Agents, looping silent audio clips, or preventing Activity lifecycle callbacks—**cannot bypass the Android kernel's surface detachment mechanism**. 

When an Android phone's screen locks, the display surface is torn down, and Chromium's audio renderer for `<video>` elements is suspended by the operating system.

The only deterministic, production-grade way to achieve persistent background streaming on Android is to **play the audio natively inside `DotifyMediaService` using `android.media.MediaPlayer` or AndroidX `ExoPlayer`**, completely separating the audio decoding engine from the WebView.
