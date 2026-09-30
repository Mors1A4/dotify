---
name: dotify
description: Complete architecture, operational runbook, build commands, auto-updater release pipeline, audio engine, zero-node streaming, and debugging invariants for Dotify (notify) - the Spotify-inspired decentralized multi-source music streaming app built with Tauri v2, React 18, Windows WebView2, and Android NDK. Activate whenever working on Dotify, notify, app.exe, dotify.exe, dotify-setup.exe, dotify.apk, build-apk.bat, release.mjs, auto-updater, visualizer silence, audio engine, or Android builds.
---

# Dotify (Notify) — Operations, Architecture & Development Guide

Dotify (`notify`) is a full-stack, Spotify-inspired music streaming application supporting multi-source audio (YouTube full-track extraction via yt-dlp/curl, Deezer/Charts, Audius, Internet Archive, RadioBrowser, and WebTorrent P2P), real-time collaborative Jams, and cross-device cloud synchronization (Firestore + REST fallback) across Windows Desktop and Android.

---

## 1. Directory Topology & Key Shareable Assets

| Asset | Location / Path | Purpose |
| :--- | :--- | :--- |
| **Workspace Root** | `c:\Users\monty\Documents\AB\notify\` | Core repository root |
| **Release Publisher CLI** | `scripts/release.mjs` | Version bumper, compiles Desktop & Android, publishes to GitHub & Firestore |
| **Release GitHub Repo** | `https://github.com/Mors1A4/dotify-releases` | Public release repo hosting `dotify.exe`, `dotify-setup.exe`, `dotify.apk`, `latest.json` |
| **Cloud Config (Firestore)**| `app_config/release` on `dotify-11e01` | Real-time release manifest tracked by client apps |
| **Windows Standalone (.exe)**| `c:\Users\monty\Documents\AB\notify\dotify.exe` | Single-file portable Windows executable (~10.7 MB, from `src-tauri\target\release\app.exe`) |
| **Windows Setup (NSIS)** | `c:\Users\monty\Documents\AB\notify\dotify-setup.exe` | Shareable Windows NSIS installer (~3.3 MB, from `bundle\nsis\`) |
| **Windows MSI Installer** | `src-tauri\target\release\bundle\msi\dotify_*.msi` | Alternative Windows MSI enterprise installer |
| **Installed Windows App** | `C:\Users\monty\AppData\Local\dotify\app.exe` (+ `server\`) | Local desktop install launched by Windows Start Menu shortcut (`dotify.lnk`) |
| **Release Android APK** | `c:\Users\monty\Documents\AB\notify\dotify.apk` | Signed, universal Android release binary (~44.4 MB) |
| **Android Build Script** | `c:\Users\monty\Documents\AB\notify\build-apk.bat` | Automated Vite build, Tauri Android NDK compilation across 4 ABIs & signing |
| **Tauri Config & Backend** | `src-tauri/tauri.conf.json` / `src-tauri/src/lib.rs` | Tauri v2 config, embedded Rust proxy, yt-dlp downloader, and in-place updater |
| **Web Auth Portal** | `src-tauri/src/auth.html` | Embedded OAuth redirect receiver for Google Sign-In |
| **Local Proxy Server** | `server/index.js` (port 3001) | Dev/local Node REST proxy for audio streams, metadata & library sync |
| **In-App Upgrades Service**| `server/upgradeWorker.js` / `HelpUpgradeModal.tsx` | In-app OpenCode AI chat fork merge and 1-click update release system |

---

## 2. Terminal Execution & Desktop Bridge Runner (`0xc0000142`)

> [!IMPORTANT]
> **Windows Sandbox Limitation**: Direct command execution via `run_command` or subagents may fail with exit code `0xc0000142` (`-1073741502`) due to desktop session restrictions in Antigravity.
> When `0xc0000142` occurs, **DO NOT ask the user to run terminal commands.** Use the persistent HTTP bridge runner.

### Using the Bridge Runner
- **URL**: `http://127.0.0.1:42888/api/exec`
- **Method**: Use `read_url_content` with a query string:
  `http://127.0.0.1:42888/api/exec?cmd=<PowerShell command>&_t=<timestamp>`
- **Rules**:
  1. **Working Directory**: The runner defaults to `C:\Users\monty`. Always prepend `cd C:\Users\monty\Documents\AB\notify;` for workspace commands.
  2. **URL Encoding**: In query strings, spaces must be `%20`, and `&` MUST be encoded as `%26` (e.g. `2>%261` for stderr redirection).
  3. **Cache Busting**: Always append `&_t=<now>` to prevent stale HTTP responses.

---

## 3. Windows Build, Installer Packaging & Portability Architecture

> [!CAUTION]
> **NEVER build the Windows app using raw `cargo build --release`!**
> Raw `cargo build` skips Tauri CLI's frontend asset embedding preprocessor. When `app.exe` is launched without `npm run dev` running, WebView2 attempts to load `devUrl` (`http://localhost:5173`) and crashes with **`localhost refused to connect` (`ERR_CONNECTION_REFUSED`)**.

### A. Building Standalone `.exe` + Windows Installers (`npx tauri build`)
```bash
Stop-Process -Name app -Force -ErrorAction SilentlyContinue
npx tauri build
```
- Outputs: `src-tauri/target/release/app.exe` and `src-tauri/target/release/bundle/nsis/dotify_*_x64-setup.exe`.
- Automatically synced to `dotify.exe` and `dotify-setup.exe` in project root.

### B. Zero-Node Standalone Portability Architecture (`127.0.0.1:3001`)
So that `dotify.exe` and `dotify-setup.exe` work on **any friend's PC and any network** without Node.js installed:
1. **Hybrid Backend Spawner (`spawn_backend_server()` in [`src-tauri/src/lib.rs`](file:///c:/Users/monty/Documents/AB/notify/src-tauri/src/lib.rs))**:
   - Checks if `127.0.0.1:3001` is open; if not, tries `node server/index.js` if present.
   - If `127.0.0.1:3001` is still unbound (on any machine without Node.js), Rust binds `127.0.0.1:3001` natively (`handle_embedded_backend_client()`).
2. **Auto-Bootstrapped `yt-dlp.exe` & `curl.exe` Range Proxy**:
   - `ensure_ytdlp_binary()` checks `%LOCALAPPDATA%\dotify\yt-dlp.exe` and silently downloads the official binary via `curl.exe` if missing.
   - `resolve_ytdlp_stream_url()` resolves full-length M4A/AAC YouTube audio streams (`ytsearch4:<artist> <title> official audio`) with in-memory caching.
   - `proxy_audio_stream_via_curl()` streams audio with `Range` / `206 Partial Content` and `Access-Control-Allow-Origin: *` so Web Audio API's 10-band Equalizer and Spectrum Visualizer work without CORS issues.
3. **Direct Stream Fallback & Dynamic Paths**:
   - [`src/audio/audioEngine.ts`](file:///c:/Users/monty/Documents/AB/notify/src/audio/audioEngine.ts) falls back to direct `fallbackUrl` (`dzcdn.net`) whenever `/api/stream/track` fails after retry.
   - `get_dotify_local_dir()` dynamically resolves `%LOCALAPPDATA%\dotify` and `std::env::current_exe()` (never hardcode `C:\Users\monty`).

---

## 4. Android APK Build & Signing Runbook

To compile, assemble, and cryptographically sign `dotify.apk`:
```bash
cmd.exe /c build-apk.bat
```
*(Or asynchronously via bridge runner: `Start-Process -FilePath "cmd.exe" -ArgumentList "/c C:\Users\monty\Documents\AB\notify\build-apk.bat > C:\Users\monty\Documents\AB\notify\build.log 2>&1" -WindowStyle Hidden`)*

### Key Android Invariants:
1. **Java 21 Requirement**: Android Studio JBR (`C:\Program Files\Android\Android Studio\jbr`) MUST be used. Set `org.gradle.java.home=C:/Program Files/Android/Android Studio/jbr` in `src-tauri/gen/android/gradle.properties` (Oracle JDK 23 causes Kotlin daemon crashes).
2. **Clean Build Directory**: `build-apk.bat` purges `src-tauri/gen/android/app/build` before invoking Gradle to avoid Windows `AccessDeniedException` on generated `BuildConfig`.
3. **Target Architectures**: Cross-compiles native Rust cdylib (`libapp_lib.so`) for `arm64-v8a`, `armeabi-v7a`, `x86`, and `x86_64` using NDK 27 (`27.0.12077973`).
4. **Signing**: Automatically signed via `apksigner.bat` using Android debug keystore (`C:\Users\monty\.android\debug.keystore`, pass: `android`).

---

## 5. Universal Release Pipeline & Auto-Updater

### A. Publishing a Live Update (`scripts/release.mjs`)
Publishing an update synchronizes `package.json`, `tauri.conf.json`, `Cargo.toml`, `version.ts`, and Android `tauri.properties`, compiles binaries, tags GitHub releases, and syncs Firestore:
```bash
# Standard release: bumps patch version (e.g. 1.0.3 -> 1.0.4), builds Desktop + Android, and publishes live:
npm run release -- --notes "Release notes summary"

# Specific targets:
npm run release:desktop                          # Windows Desktop only
npm run release:android                          # Android APK only
node scripts/release.mjs 1.1.0 --notes "Major update"
```

### B. Client Self-Update Mechanisms
- **Windows Desktop (`lib.rs:install_windows_update`)**:
  - Downloads `dotify.exe` to `%LOCALAPPDATA%\dotify\dotify-update.exe.tmp` using native `curl.exe` with progress events (`update-download-progress`).
  - Verifies Windows PE header (`MZ`) and file length > 1 MB.
  - Renames running `app.exe` -> `app.exe.old`, copies `tmp` -> `app.exe`, spawns new executable, and terminates old process.
  - Fallback: Downloads and runs NSIS `dotify-setup.exe` if in-place replacement is restricted.
- **Android Native Updater (`AndroidNativeUpdater.downloadAndInstallApk()`)**:
  - Downloads APK to external cache directory with native download notification bar.
  - Triggers Android Package Installer intent (`ACTION_INSTALL_PACKAGE` / `FileProvider`).

### C. Anti-Loop Protection Invariants
- **Never publish with stale binaries**: `release.mjs` automatically deletes root binaries (`dotify.exe`, `dotify-setup.exe`, `dotify.apk`) before compiling to guarantee only freshly built binaries are uploaded.
- **30-Minute Attempt Guard**: [`src/store/updateStore.ts`](file:///c:/Users/monty/Documents/AB/notify/src/store/updateStore.ts) records `dotify_update_attempt_version` and timestamp. If the app restarts into the same version, background checks suppress auto-opening the update modal to prevent endless restart loops.
- **Persistent "Later" Dismissal**: Clicking "Later" records `dotify_update_dismissed_version`, keeping the update badge in TopBar/Sidebar without blocking user navigation.
- **Native Version Truth**: [`src/services/updateService.ts`](file:///c:/Users/monty/Documents/AB/notify/src/services/updateService.ts) queries `tauri.app.getVersion()` directly from the running binary rather than stale static constants.

---

## 6. Audio Engine, Multi-Source Streaming & Silence Invariant

- **Dual-Deck Audio Engine**: [`src/audio/audioEngine.ts`](file:///c:/Users/monty/Documents/AB/notify/src/audio/audioEngine.ts) combines HTML5 Audio, Web Audio API, a 10-band peaking equalizer, and real-time spectrum visualizer.
- **Silence-Aware Reactivity**: Soundwave icons and equalizer bars ([`src/components/common/VisualizerIcon.tsx`](file:///c:/Users/monty/Documents/AB/notify/src/components/common/VisualizerIcon.tsx), [`src/components/player/QueueDrawer.tsx`](file:///c:/Users/monty/Documents/AB/notify/src/components/player/QueueDrawer.tsx)) **MUST NEVER animate during audio silence** (track start, pre-roll, buffering, seeking, mute, or pause).
- **Audio Energy Sampling**: [`src/hooks/useAudioActive.ts`](file:///c:/Users/monty/Documents/AB/notify/src/hooks/useAudioActive.ts) queries `audioEngine.isAudioActive(5)`:
  - Samples Web Audio `AnalyserNode.getByteFrequencyData()`.
  - Skips bin 0 (DC offset/electrical ground bias).
  - Returns 0 if paused, buffering, seeking, muted, volume <= 0.001, or audio context suspended.
- **Albums & Playlists**:
  - Albums function as playlists ([`AlbumView.tsx`](file:///c:/Users/monty/Documents/AB/notify/src/components/views/AlbumView.tsx)). Tapping an album card browses its full tracklist, allowing users to Play, Shuffle, and tap **+ Add to Library** (saving the album as a synced custom playlist).
- **Mobile Now-Playing**:
  - [`MobileNowPlayingSheet.tsx`](file:///c:/Users/monty/Documents/AB/notify/src/components/player/MobileNowPlayingSheet.tsx) provides a full-screen mobile player with album artwork, visualizer, scrubber, device picker, and an integrated **Up Next / Queue** list directly below the playback controls.

---

## 7. Authentication & Cloud Library Synchronization

Dotify supports dual sign-in paths in [`AuthModal.tsx`](file:///c:/Users/monty/Documents/AB/notify/src/components/auth/AuthModal.tsx):

1. **1-Click Fast Profile (Primary, 0 Passwords)**:
   - User types a nickname or email (e.g. `monty` or friend's name) and clicks **Connect & Sync**.
   - Generates deterministic UID (`usr_<hash>`). Zero passwords to remember, zero verification emails, instant in-app setup.
2. **Continue with Google**:
   - Opens `auth.html` on localhost. On mobile browsers, `signInWithRedirect` is used to prevent popup blocking. Returns credentials to Dotify via `dotify://auth?...` deep link or `google-auth-success` IPC.
   - `window.location.replace` must never be called on page return as it wipes OAuth URL hash/query parameters.

### Cloud Library Synchronization
- Syncs: **Liked Tracks**, **Custom Playlists**, and **Listening History** across devices in real time.
- Managed in [`src/store/playerStore.ts`](file:///c:/Users/monty/Documents/AB/notify/src/store/playerStore.ts) via debounced sync (`scheduleCloudLibrarySync`) using Firestore real-time listeners and REST fallback (`/api/user/:userId/library`).

---

## 8. UI Architecture & Modal Invariants ("Gotchas")

- **CSS Containing Block Trap**: Any DOM ancestor with `backdrop-filter` (e.g. `backdrop-blur-md` on `<TopBar>`) or CSS `transform` creates a new containing block that traps `position: fixed` descendants. Modals MUST be mounted via `createPortal(modalContent, document.body)` at the top level of [`src/App.tsx`](file:///c:/Users/monty/Documents/AB/notify/src/App.tsx).
- **Dedicated Playlist Page**: Clicking playlists or albums in [`Sidebar.tsx`](file:///c:/Users/monty/Documents/AB/notify/src/components/layout/Sidebar.tsx) MUST call `navigateToPlaylist(playlistId)` or `navigateToAlbum(albumId)`.
- **Spotify OLED Dark Aesthetic**: Use `bg-surface`, `bg-elevated`, `border-customBorder`, `bg-accent`, `text-accent`. Never use hardcoded Tailwind slate/navy palettes (`#121622`, `border-slate-800`).
- **Firestore Sanitization**: Always serialize/deserialize data with `JSON.parse(JSON.stringify(...))` before calling Firestore `setDoc()` to strip `undefined` fields.
