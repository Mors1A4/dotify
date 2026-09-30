---
name: dotify
description: Complete architecture, operational runbook, build commands, auto-updater release pipeline, and debugging invariants for Dotify (notify) - the Spotify-inspired decentralized multi-source music streaming app built with Tauri v2, React 18, Windows WebView2, and Android NDK. Activate whenever working on Dotify, notify, app.exe, dotify.exe, dotify-setup.exe, dotify.apk, build-apk.bat, release.mjs, auto-updater, visualizer silence, or Android builds.
---

# Dotify (Notify) — Operational Architecture & Engineering Guide

Dotify (`notify`) is a full-stack, Spotify-inspired music streaming application supporting multi-source audio (YouTube full-track extraction via yt-dlp/curl, Deezer/Charts, Audius, Internet Archive, RadioBrowser, and WebTorrent P2P), real-time collaborative Jams, and cross-device cloud synchronization across Windows Desktop and Android.

---

## 1. Directory Topology & Release Artifacts

| Asset | Location / Path | Purpose |
| :--- | :--- | :--- |
| **Workspace Root** | `c:\Users\monty\Documents\AB\notify\` | Core repository root |
| **Release Publisher CLI** | `scripts/release.mjs` | Version bumper, builds Desktop & Android, uploads to GitHub & Firestore |
| **Release GitHub Repo** | `https://github.com/Mors1A4/dotify-releases` | Public GitHub release repository hosting binaries and `latest.json` |
| **Cloud Config (Firestore)** | `app_config/release` on `dotify-11e01` | Real-time release manifest tracked by client apps |
| **Windows Standalone (.exe)** | `dotify.exe` | Portable Windows single binary (~10.7 MB, from `src-tauri/target/release/app.exe`) |
| **Windows Setup Installer** | `dotify-setup.exe` | NSIS standalone installer wizard (~3.3 MB, from `bundle/nsis/`) |
| **Installed Desktop App** | `C:\Users\monty\AppData\Local\dotify\app.exe` | Local installed location executed by Windows Start Menu shortcut |
| **Signed Android APK** | `dotify.apk` | Universal release APK signed with debug keystore (~44.4 MB) |
| **Android Build Script** | `build-apk.bat` | Automated Vite build, NDK 27 compilation across 4 ABIs, and APK signing |
| **Tauri Config & Backend** | `src-tauri/tauri.conf.json` / `src-tauri/src/lib.rs` | Tauri v2 config, embedded Rust proxy, yt-dlp downloader, and in-place updater |
| **In-App Upgrades Service** | `server/upgradeWorker.js` / `HelpUpgradeModal.tsx` | In-app OpenCode AI chat fork merge and 1-click update release system |

---

## 2. Universal Release & Auto-Updater Pipeline

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

## 3. Build & Compilation Runbook

### A. Windows Desktop Build (`npx tauri build`)
```bash
Stop-Process -Name app -Force -ErrorAction SilentlyContinue
npx tauri build
```
- Outputs: `src-tauri/target/release/app.exe` and `src-tauri/target/release/bundle/nsis/dotify_*_x64-setup.exe`.
- Automatically synced to `dotify.exe` and `dotify-setup.exe` in project root.

### B. Android APK Build (`build-apk.bat`)
```bash
cmd.exe /c build-apk.bat
```
- **Java 21 Requirement**: Android Studio JBR (`C:\Program Files\Android\Android Studio\jbr`) MUST be used. Set `org.gradle.java.home=C:/Program Files/Android/Android Studio/jbr` in `src-tauri/gen/android/gradle.properties` (Oracle JDK 23 causes Kotlin daemon crashes).
- **Clean Build Directory**: `build-apk.bat` purges `src-tauri/gen/android/app/build` before invoking Gradle to avoid Windows `AccessDeniedException` on generated `BuildConfig`.
- **Target Architectures**: Compiles native Rust cdylib (`libapp_lib.so`) for `arm64-v8a`, `armeabi-v7a`, `x86`, and `x86_64` using NDK 27 (`27.0.12077973`).
- **Signing**: Automatically signed via `apksigner.bat` using Android debug keystore (`C:\Users\monty\.android\debug.keystore`, pass: `android`).

---

## 4. Audio Engine & Silence Invariant

- **Silence-Aware Reactivity**: Soundwave icons and equalizer bars ([`src/components/common/VisualizerIcon.tsx`](file:///c:/Users/monty/Documents/AB/notify/src/components/common/VisualizerIcon.tsx), [`src/components/player/QueueDrawer.tsx`](file:///c:/Users/monty/Documents/AB/notify/src/components/player/QueueDrawer.tsx)) **MUST NEVER animate during audio silence** (track start, pre-roll, buffering, seeking, mute, or pause).
- **Audio Energy Sampling**: [`src/hooks/useAudioActive.ts`](file:///c:/Users/monty/Documents/AB/notify/src/hooks/useAudioActive.ts) queries `audioEngine.isAudioActive(5)`:
  - Samples Web Audio `AnalyserNode.getByteFrequencyData()`.
  - Skips bin 0 (DC offset/electrical ground bias).
  - Returns 0 if paused, buffering, seeking, muted, volume <= 0.001, or audio context suspended.
- **Zero-Node Audio Streaming**: Rust embedded backend in `src-tauri/src/lib.rs` binds `127.0.0.1:3001` if Node is absent, automatically downloads official `yt-dlp.exe` to `%LOCALAPPDATA%\dotify\yt-dlp.exe` via `curl.exe`, and proxies audio with `Range` / `206 Partial Content` and CORS headers.

---

## 5. UI Architecture & Modal Invariants ("Gotchas")

- **CSS Containing Block Trap**: Any DOM ancestor with `backdrop-filter` (e.g. `backdrop-blur-md` on `<TopBar>`) or CSS `transform` traps `position: fixed` descendants. Modals MUST be mounted via `createPortal(modalContent, document.body)` at the top level of [`src/App.tsx`](file:///c:/Users/monty/Documents/AB/notify/src/App.tsx).
- **Navigation Invariant**: Clicking playlists or albums in [`Sidebar.tsx`](file:///c:/Users/monty/Documents/AB/notify/src/components/layout/Sidebar.tsx) MUST call `navigateToPlaylist(playlistId)` or `navigateToAlbum(albumId)`.
- **Firestore Sanitization**: Always serialize/deserialize data with `JSON.parse(JSON.stringify(...))` before calling Firestore `setDoc()` to strip `undefined` fields.
