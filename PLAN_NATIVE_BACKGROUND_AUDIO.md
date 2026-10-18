# Foolproof Plan: Native Background & Screen-Off Audio Streaming for Dotify (Android)

> **STATUS (2026-10-18): IMPLEMENTED & SHIPPED as v1.0.39.** See commit `c1eda30`
> (`NativePlayerEngine.kt`, `YtStreamResolver.kt`, `DotifyMediaService.kt`,
> `MainActivity.kt` bridge, `build-apk.bat` guard) and the live release at
> <https://github.com/Mors1A4/dotify-releases/releases/tag/v1.0.39>.
>
> **FOLLOW-UP (2026-10-18, shipped as v1.0.40):** on-device resolution with the
> pinned NewPipeExtractor **v0.24.5 returned no streams**: YouTube's 2026 SABR
> enforcement requires the player-client workaround landed in extractor
> **v0.26.3**, and the entire public Piped instance fleet is hit by the same
> wall ("Sign in to confirm you're not a bot"), killing the Piped fallback
> tiers. Dependency bumped to **v0.26.5** (PC-side harness re-verified both:
> real googlevideo URLs for multiple videoIds via `StreamInfo.getInfo`).
>
> **FOLLOW-UP 2 (2026-10-18, shipped as v1.0.41):** field symptoms on device —
> wrong song played ("funny remix") and queue-wide skip chains. Causes: (a)
> the meta passed for non-target queue entries carries no videoId, and the
> previous tier-4 fallback searched the now-dead Piped fleet → `resolve()`
> null → skip for every item; (b) the tapped track's id came from the TS
> resolver whose persistent winners were never re-validated (stale localStorage
> mapping can point at a different video). Fixes, both in Kotlin:
> extractor-based YouTube search (`SearchInfo.getInfo`, duration + title
> scoring) replaces the Piped search as primary identification; and tier-2
> results are now plausibility-checked against artist/title/duration — an
> implausible match is dropped and the search tiers resolve the real video.
> PC harness verified search outputs for 3 known songs all return canonical
> uploads and resolve with full audio streams.
>
> **FOLLOW-UP 3 (2026-10-18, shipped as v1.0.42):** cast/controller desync —
> the phone kept playing local audio after handing playback to a speaker.
> Cause: `audioEngine.setControllerMode(true)` silenced only the WebView-side
> paths (iframe + HTML5 elements); the native ExoPlayer engine was left
> running, so "pause" as a controller did nothing audible on the phone and the
> two streams drifted apart. Additionally `NativePlayerEngine.updateQueue`
> was aliased to `playQueue`, so store-side queue syncs (which the store
> performs most when the user is casting = assuming no local audio) would
> RESTART local playback. Fixes: setControllerMode stops the native engine
> and clears native ownership; `syncNativeQueue` no-ops in controller mode;
> Kotlin `updateQueue` is now bookkeeping-only (idle: refresh metas, active:
> leave the running playlist untouched).
>
> **FOLLOW-UP 4 (2026-10-18, shipped as v1.0.44):** logic-audit fixes. (1)
> `NativePlayerEngine.stop()` never invalidated the background resolution
> worker — an append/retry landing right after a stop re-attached the
> playlist and `play()`ed again (the remaining "phone keeps playing after
> stop" class during cast transfers/lockscreen stops on cold queues); stop
> now bumps the generation and append/retry are `hasActiveQueue`-guarded.
> (2) cast-transfer failure rollback resumed with a bare `resume()` against
> the emptied engine (dead play button); it now restarts the track via
> `playTrackAtPosition`. (3) native `idle` state events never cleared
> `isUsingNativeEngine`, leaving stop-driven dead controls; `idle` now
> clears ownership like `ended`.

> **Version:** 1.0.0 · **Date:** 2026-10-18
> **Precondition:** v1.0.30–v1.0.38 WebView-rescue attempts documented in `MOBILE-BACKGROUND-STREAMING-POST-MORTEM.md` all failed for one root cause: **the audio source lives in the Chromium WebView, which Android suspends when the Activity's display surface is destroyed.** No web-level trick survives that.
> **This plan stops rescuing the WebView and moves the audio engine out of it.**

---

## 0. Verdict (read this first)

The WebView-rescue era is over. **All audio on Android will be decoded and rendered by a native Android media player running inside `DotifyMediaService` (a foreground service), fed by an on-device stream resolver.** The WebView/React UI becomes a *remote control* that sends playback commands to the service and paints state it reports back.

- **Player:** AndroidX Media3 `ExoPlayer` (drop-in dependency, works with minSdk 24 and jvmTarget 1.8 with no config changes).
- **YouTube stream resolution (the hard part):** an on-device Kotlin resolver, tiered: **NewPipe Extractor (primary) → direct-source sources that already have plain HTTPS URLs (radio, Audius, LAN vault, Deezer preview) → local URL cache → (contingency only) WebView iframe URL interception.**
- **Why not Piped/Invidious public instances as primary:** flaky, rate-limited, and you don't control uptime. Used at most as a fallback tier.
- **Why not `shouldInterceptRequest` sniffing as primary:** the iframe hands over at an arbitrary moment, produces double-audio races, and fails when the iframe requests a muxed format. It is retained only as an emergency last tier.
- **Verified repo facts this plan relies on** (inspected 2026-10-18):
  - `src-tauri/gen/android/app/build.gradle.kts` deps already include `androidx.media:media:1.7.0` (MediaSessionCompat exists today) and appcompat — custom deps in this file **have persisted across builds v1.0.30–v1.0.38**.
  - `src-tauri/gen/android/app/src/main/AndroidManifest.xml` already has `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `WAKE_LOCK`, `POST_NOTIFICATIONS`, and the service declared with `foregroundServiceType="mediaPlayback"`.
  - `MainActivity.kt` and `DotifyMediaService.kt` live at `src-tauri/gen/android/app/src/main/java/com/dotify/music/` — **not** in the regenerated `generated/` package — and every hack added to them since v1.0.30 survives builds. The regeneration trap (v1.0.36) only bit files inside the `TauriActivity`-generated set (`WryActivity`/`RustWebView`). This plan never touches those.
  - The embedded Rust backend on Android serves **only** `/api/search/youtube` (`src-tauri/src/lib.rs:373`), so `/api/stream/track` (Audius/vault resolution in `server/trackResolver.js`) is **not reliably available on-device** → resolution must happen in Kotlin.
  - The 1 ms pause stutter seen in v1.0.31/v1.0.37 came from **two media elements colliding inside the WebView** (silent keeper vs. iframe) — it cannot recur once exactly one native player exists, but the iframe's auto-resume loop (`src/audio/youtubeIframeBridge.ts` lines 169–184) must be gated so the loupe can't fight the native takeover.

---

## 1. Target architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ React / WebView (remote control only when Android bridge present)  │
│  • search, playlists, artwork, queue editing                        │
│  • calls window.AndroidNativePlayer.playQueue(trackJson, ...)       │
│  • listens window.__dotifyNativePlaybackEvent(type, json)           │
│  • NO HTML5 audio on Android (desktop/Web keeps Web Audio engine)   │
└──────────────────────────────────┬─────────────────────────────────┘
                                   │  @JavascriptInterface (MainActivity.kt)
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│ MainActivity.kt (persists across builds — do NOT touch generated/) │
│  • forwards JSON to DotifyMediaService via Intent extras           │
└──────────────────────────────────┬─────────────────────────────────┘
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│ DotifyMediaService.kt (foreground, mediaPlayback, STOP_STICKY)      │
│  • NativePlayerEngine: ExoPlayer playlist (gapless, auto-advance)   │
│  • setAudioAttributes(USAGE_MEDIA, handleAudioFocus = true)         │
│  • setHandleAudioBecomingNoisy(true)   (headphone unplug)           │
│  • setWakeMode(C.WAKE_MODE_NETWORK)    (Wi-Fi/CPU held by player)   │
│  • MediaSessionCompat callbacks → drive ExoPlayer locally (fast,    │
│    no WebView round-trip) + mirror event to JS for UI sync          │
│  • position ticker → PlaybackState + JS event (1 Hz)                │
└──────────────────────────────────┬─────────────────────────────────┘
                                   ▼
┌────────────────────────────────────────────────────────────────────┐
│ YtStreamResolver.kt (pure Kotlin, zero server dependency)           │
│  Tier 1: NewPipe Extractor (JitPack) → direct audio URL (m4a/webm)  │
│  Tier 2: track.source === direct (radio/audius/LAN vault/preview)   │
│  Tier 3: in-memory + disk cache (videoId → parsed URL, TTL 4h)      │
│  Tier 4 (contingency): advertise-only hook for iframe interception  │
│  Each tier is independent; any failure falls to the next.           │
└────────────────────────────────────────────────────────────────────┘
```

**Core guarantee:** once cl, the `AudioTrack`/AAudio stream is created by `AudioFlinger` on behalf of a *foreground service process context*, not an Activity window. The lock-screen surface teardown that killed the WebView pipeline (post-mortem §4.1–§4.2) is physically irrelevant to it. This is the same engine direction every production app in the post-mortem's table (§5) uses.

---

## 2. Design decisions (non-negotiable)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Keep `DotifyMediaService` as a plain `Service` + existing `MediaSessionCompat`.** Do **not** migrate to Media3 `MediaSessionService`. | The notification/Lockscreen/flag plumbing already works and survived 9 versions. Migrating it is risk with zero gain for this fix. |
| D2 | **New native code goes into NEW files** (`NativePlayerEngine.kt`, `YtStreamResolver.kt`, `AndroidNativePlayer🗋Bridge.kt`); edits to existing Kotlin confined to `MainActivity.kt`, `DotifyMediaService.kt`, `build.gradle.kts`, `AndroidManifest.xml`. **Never edit anything in a `generated/` package or Tauri-generated base classes** (`WryActivity`, `RustWebView`, `TauriActivity`). | Avoids the v1.0.36 wipe-out. All four listed files have demonstrably persisted across builds. |
| D3 | **Media session callbacks act on the player directly.** When the WebView is alive, they *also* mirror an event to JS (existing `evaluateJavascript` pattern, cf. `dispatchMediaAction`, `MainActivity.kt:820`). | UI must never be the source of truth; it must survive the WebView being frozen. |
| D4 | **The whole queue is handed to the service as JSON up front.** Auto-advance, shuffle state (if any), and queue navigation happen inside ExoPlayer. JS is only notified. | In Doze, JS timers are throttled to near-zero. A naive "JS tells native to play next on ENDED" design will stall for 10–60 s per track — the exact class of bug this plan exists to kill. |
| D5 | **Exactly one audio element per device at a time.** On Android, when the native engine owns a track, the iframe bridge is not loaded for that track (no `loadVideoById` call → no PAUSED state → no auto-resume loop → no 1 ms stutter). Desktop/Web keeps the current engine untouched. | The auto-resume loop at `youtubeIframeBridge.ts:169–184` is the stutter generator (v1.0.31, v1.0.37). Removing the collision class entirely. |
| D6 | **Tiered resolver, offline-capable resolution.** Primary = NewPipe Extractor on-device. No dependency on the desktop app or local Node server being reachable. | Verified above: embedded backend only serves search. Anything resolver-dependent through LAN will break road-trip usage. |
| D7 | **ExoPlayer handles audio focus itself** (`setAudioAttributes(attrs, true)`), plus `setHandleAudioBecomingNoisy(true)` and `setWakeMode(C.WAKE_MODE_NETWORK)`. Remove the service's manual `AudioFocusRequest` wiring (`DotifyMediaService.kt:95–146`) — keep the method but make it return early / no-op, since ExoPlayer now owns focus and the old listener dispatched `pause` to the WebView (which caused the v1.0.31/v1.0.38 focus-echo). | The service's manual focus listener projects WebView logic. Deleting the path removes the double-owner problem. |
| D8 | **Gradle dependency + manifest + interface markers guarded by an idempotent ensure-script** that runs inside `build-apk.bat` before Gradle, verifies presence of (a) media3 + NewPipe deps, (b) `stopWithTask` attr, (c) `AndroidNativePlayer` interface in `MainActivity.kt`, and (re-)injects or fails the build loudly. | Makes the failed-build failure visible instead of silently shipping broken APKs after a future Tauri CLI upgrade regenerates a file. |
| D9 | **Visualizer/EQ tradeoff is accepted and announced.** Android currently uses a *synthesized* energy pulse for iframe playback (skill §7), so removing the iframe does not lose the visualizer. The 10-band Web Audio EQ on Android applies only to vault/radio tracks today; native playback loses it initially. Phase 4P adds a native `android.media.audiofx.Equalizer` attached to the player's audio session. | Honest cost accounting; avoids silent regressions. |
| D10 | **Connect/remote-control UX is preserved:** when a queue is being played to a Google Cast device or desktop peer (`activeDevice` remote), JS does NOT delegate to the native player. | Skill §6 invariant: single active audio host. Cast playback must not become local phone playback. |

---

## 3. Phase plan with hard acceptance gates

> Every phase ends with a **measurable pass/fail**, not "looks fine". Build via `cmd.exe /c build-apk.bat` and sideload; never judge these features from the simulator/emulator.

### Phase 0 — Guardrails & regression dam (½ day)

**Tasks**
1. Create feature branch `feat/native-background-audio`.
2. Write `scripts/android-native-guard.mjs` (idempotent; markers explained in D8).
3. Hook it into `build-apk.bat` immediately before the Gradle step:
   `node scripts/android-native-guard.mjs || exit /b 1`.
4. Confirm JitPack + Media3 dependency insertion points:
   - Repositories: `src-tauri/gen/android/build.gradle.kts` → `allprojects { repositories { … } }` (add `maven("https://jitpack.io")`).
   - Dependencies: `src-tauri/gen/android/app/build.gradle.kts` `dependencies {}` block (line ~67–77).

**Gate 0:** building with the guard script (no functional changes yet) produces the same APK behavior as v1.0.38; `npx vitest run --fileParallelism false` still green.

---

### Phase 1 — Native engine + direct-source tracks (1 day)

Goal: **prove the whole service→speaker pipeline** using tracks that already have HTTP(S) URLs (`source === 'radio'`, vault MP3s over LAN, Audius `discoveryprovider.../tracks/{id}/stream`, Deezer previews). No YouTube extractor yet.

**Files**
- NEW `NativePlayerEngine.kt` (package `com.dotify.music`, same dir as `MainActivity.kt`):
  - Singleton exposing `playQueue(json: String, startIndex: Int, startMs: Long)`, `pause()`, `resume()`, `seekTo(ms)`, `next()`, `previous()`, `stop()`, `setVolume(pct)`.
  - ExoPlayer with `MediaItem` list; `audioAttributes` = USAGE_MEDIA/CONTENT_TYPE_MUSIC + `handleAudioFocus=true`; `setHandleAudioBecomingNoisy(true)`; `setWakeMode(C.WAKE_MODE_NETWORK)`.
  - Listener → snap `Player.STATE_*` + ENDED events to the service.
- MODIFY `MainActivity.kt`: add `AndroidNativePlayer` JS interface with `@JavascriptInterface` methods:
  ```kotlin
  fun playQueue(trackMetaJson: String, queueJson: String, startIndex: Int, startMs: Long)
  fun pause(); fun resume(); fun seek(toMs: Long); fun next(); fun prev(); fun stop()
  fun isNativePlaying(): Boolean; fun nativePosition(): Long
  ```
  Forward into `NativePlayerEngine`; start `DotifyMediaService` foreground first (pattern already used by `updateTrack`, MainActivity.kt:443–458).
- MODIFY `DotifyMediaService.kt`:
  - Engine wiring + a 500 ms position ticker → today's `PlaybackState`/`MediaMetadata` sync (replace the fields currently fed only to notification data).
  - MediaSession `onPlay/onPause/onSkipToNext/...` callbacks call `NativePlayerEngine` directly, then forward the same event to JS (`window.__dotifyNativeMediaAction` already exists and works).
- MODIFY `AndroidManifest.xml`: add `android:stopWithTask="false"` to the `<service>` tag (line ~188). Swipe-from-recents on most ROMs otherwise kills the service with the task.
- MODIFY `src/audio/audioEngine.ts`: at the top of `play(track)`, if `platform === 'android' && window.AndroidNativePlayer && !isRemoteHostSelected() && !visualizerNeedsWebAudio` → serialize `{ id, source, title, artist, album, artwork, durationSec, streamUrl? }` + current queue and call `playQueue`; mark `nativeOwner = true` (suppress iframe + HTML5 paths); return.
- NEW `src/audio/androidNativePlayback.ts`: typed wrapper + `__dotifyNativePlaybackEvent` listener (state/position/index/error) that publishes into `cleanPlayerStore`-friendly events.

**Gate 1 (hands-on, minutes 0–30 of a session):**
- Play a radio track → lock phone → sound continues ≥ 10 min.
- `'Ready' AudioTrack` for `com.dotify.music` appears: `adb shell dumpsys media.audio_flinger | grep -i dotify`.
- Foreground service alive in Doze: `adb shell dumpsys battery | grep "Idle mode disabled"` / `dumpsys deviceidle whitelist | findstr dotify`.
- Lock-screen scrub skips & seeks feel instant (< 300 ms) because callbacks run natively.

---

### Phase 2 — YouTube catalog: on-device extractor + queue engine (2–3 days) — **the actual cure**

**Files**
- NEW `YtStreamResolver.kt`:
  - Tier 1: NewPipe Extractor (`com.github.TeamNewPipe:NewPipeExtractor:<latest>` via JitPack). Creators update it against YouTube changes; bundling it on-device is exactly how NewPipe/RiMusic/ViMusic ship YouTube playback.
  - Implement its `Downloader` interface with a minimal OkHttp or `HttpURLConnection` client; desktop-ish mobile UA; cookies not required for audio-only extraction. Use the extractor client order: ANDROID → WebView/web → fallback `TVHTML5_SIMPLY_EMBEDDED_PLAYER`, pick the first stream with `it.audioStreams` + highest bitrate non-muxed; fall back to muxed if none.
  - Tier 2: if `track.source` already has a URL (radio/audius/vault/preview), use it directly.
  - Tier 3: LRU disk cache `videoId → { url, mime, expiresAt }`, TTL 4 h (mirrors `trackResolver.js` cache TTL), re-resolve on `403` / `LOAD_ERROR`.
- MODIFY `NativePlayerEngine`: receives pre-resolved URL from service; on ExoPlayer load error, calls back into resolver for a fresh URL (max 1 retry) before failing to JS.
- MODIFY `audioEngine.ts` YouTube branch: when `nativeOwner`, no `youtubeIframeBridge` load for the YouTube track at all.
- UPDATE `youtubeIframeBridge.ts`: gate the auto-resume `(case 2)` block behind `!isAndroidNativeActive()` so it can never loop against the takeover (defense in depth for D5; see `youtubeIframeBridge.ts:169–184`).
- MODIFY `DotifyMediaService` ENDED → ExoPlayer auto-advance within the handed-over MediaItems playlist; on `ENQUEUED_TRACK_END`, emit `(index, next)` event to JS so the store paints progress.

**Gate 2 (the headline acceptance test):**
- Start a song, lock the phone, stream continuously through **at least 3 auto-advanced tracks over 30+ minutes** without sound stall; notification art updates; lock-screen next/prev and BT next/prev work through the native session.
- Kill the app from Recents → service with play state persists (`stopWithTask="false"`), tap foreground notification → app restores to the *native playback position* (no double audio; iframe never restarted).
- Turn off Wi-Fi & mobile data mid-song → graceful pause + error event (no crash).

---

### Phase 3 — Desktop/Web unchanged, sync & connect hygiene (1 day)

- Verify desktop regression: iframe + Web Audio path byte-identical (gating only triggers on Android bridge presence).
- `connect`: remote controller mode continues to work from the phone while *the phone itself may also be native-playing* — ensure `applyRemotePlaybackState` (skill §6) always pauses the local native engine before adopting remote host role.
- Remove dead rescue code paths: `screenReceiver` refresh calls (`DotifyMediaService.kt:47–54`), the `onPause` self-resume triple calls in `MainActivity.kt:107–123` (now harmless but pointless — keep `stop service on stop` semantics if you want), and the deferred battery-optimization prompt triggers once at first native playback instead of 3 s after launch (nicer first-run).

**Gate 3:** full unmodified desktop; `.exe` play/resume flows and the audio engine tests unchanged.

---

### Phase 4 — Hardening, safeguards, release (1 day)

1. **Audio focus polish:** calls/notifications should duck, not kill — switch `AUDIOFOCUS_GAIN` to `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` on notifications via ExoPlayer's internal policy (it handles it; verify).
2. **Watchdog:** after takeover, if no audio progress for 10 s, retry resolver once; if still dead, emit `error` event and pause cleanly.
3. **URL expiry:** googlevideo signed URLs expire (~6 h). On 403 → auto re-resolve via Tier 1.
4. **OEM killer devices (MIUI/OneUI/Oppo):** add a one-time in-app tip "Allow autostart/battery unrestricted" behind a Settings entry; document in README; detect `isIgnoringBatteryOptimizations` = false and surface a gentle prompt (permission already declared).
5. THEN test matrix:
   - Screen off 45 min w/ Doze (dark room, no unlocking).
   - App switch away → back → seek position equality.
   - Bluetooth connect/disconnect + car BT next/prev.
   - Headphone unplug auto-pause; `AudioManager.ACTION_AUDIO_BECOMING_NOISY`.
   - Phone call mid-song → duck → resume.
   - Connect to Google Home cast → becomes remote host (phone pauses).
6. **Release (mandatory per skill §5):** stop app instances → `npm run release -- --notes "Native background/screen-off streaming engine for Android"`; commit; push.

**Gate 4 (final):** the exact original complaint is dead: song plays locked, **volume audible, hardware output continues; notification real; BT/lock controls live.**

---

## 4. Contingencies

| Condition | Fallback |
|---|---|
| Extractor gets blocked/poToken for some video | Tier 3 cache hit; else Tier 2; else (contingency) load the track in the *iframe bridge* once in the **foreground**, harvest `mime=audio` googlevideo URLs by patching `fetch`/XHR in the document-start script, then hand off. Implementation reserved for a later phase, not the default path. |
| Extractor outright fails at a future YouTube change | Pin to fix commit; bump extractor version; the resolver's version-release path lets us hot-release an update within the auto-updater cycle. |
| HAS persistent OEM-killed service | Recommend `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` already granted + autostart doc; ship Space-Menu "battery unrestricted" instructions. |
| Resolver misses exact song | Score candidates artist-computed duration‑match; keep currently silent fallback to Audius title+artist exact-duration match. |

---

## 5. Explicit do-not list (carried from the post-mortem)

- **Do not** try to keep the WebView audible under lock (`visibilitychange mocking`, UA spoofing, Wi-Fi lock magic, screen receivers, resumeTimers spam, silent keepers). Done; failed; obsolete.
- **Do not** place Kotlin into `generated/` packages or `WryActivity`/`RustWebView`/`TauriActivity`.
- **Do not** re-add a second audio element (the 1 ms stutter class of bug).
- **Do not** make MediaSession callbacks round-trip through JS for native functionality.
- **Do not** trust `/api/stream/track` availability on-device — it does not exist in the embedded backend (verified; `lib.rs:373`).

---

## 6. Build & release loop per iteration

```bash
cmd.exe /c build-apk.bat            # runs guard script, then Vite + Tauri + Gradle + apksigner
adb install -r dotify.apk
adb logcat -s DotifyMedia:V NativePlayerEngine:V ExoPlayer:W AudioManager:W
```

Followed, when green, by the mandatory release cycle in skill §5 (`npm run release -- --notes "...`") so phones receive the build via auto-update.
