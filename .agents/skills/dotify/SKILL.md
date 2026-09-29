---
name: dotify
description: Complete operational guide, architecture, Windows & Android build commands, standalone installer packaging, and debugging runbooks for Dotify (notify) - the Spotify-inspired decentralized multi-source music streaming app built with Tauri v2, React 18, Windows WebView2, and Android NDK. Activate whenever working on Dotify, notify, app.exe, dotify.exe, dotify-setup.exe, dotify.apk, build-apk.bat, Windows Tauri builds, Android music player, or Firestore cross-device library sync.
---

# Dotify (Notify) — Operations, Architecture & Development Guide

Dotify (`notify`) is a full-stack, Spotify-inspired music streaming application supporting multi-source audio (YouTube full-track extraction, Deezer/Charts, Audius, Internet Archive, RadioBrowser, and WebTorrent P2P), and cross-device cloud synchronization (Firestore + REST fallback) across Windows and Android.

---

## 1. Directory Topology & Key Shareable Assets

| Asset | Location / Path | Purpose |
| :--- | :--- | :--- |
| **Workspace Root** | `c:\Users\monty\Documents\AB\notify\` | Core repository root |
| **Windows Installer (NSIS)** | `c:\Users\monty\Documents\AB\notify\dotify-setup.exe` | Shareable Windows installer (~3.04 MB, built at `src-tauri\target\release\bundle\nsis\dotify_1.0.0_x64-setup.exe`) |
| **Windows MSI Installer** | `src-tauri\target\release\bundle\msi\dotify_1.0.0_x64_en-US.msi` | Alternative Windows MSI installer (~4.05 MB) |
| **Portable Windows Binary** | `c:\Users\monty\Documents\AB\notify\dotify.exe` | Single-file portable Windows executable (~9.83 MB, copied from `src-tauri\target\release\app.exe`) |
| **Installed Windows App** | `C:\Users\monty\AppData\Local\dotify\app.exe` (+ `server\`) | Local installed desktop location launched by Start Menu shortcut (`dotify.lnk`) |
| **Release APK** | `c:\Users\monty\Documents\AB\notify\dotify.apk` | Signed, universal Android release binary (~40.32 MB) |
| **Android Build Script** | `c:\Users\monty\Documents\AB\notify\build-apk.bat` | Automated Vite build, Tauri Android NDK compilation & signing |
| **Tauri Config & Rust** | `src-tauri/tauri.conf.json` / `src-tauri/src/lib.rs` | Tauri v2 config, OAuth listener, and hybrid Node + embedded Rust streaming backend |
| **Web Auth Portal** | `src-tauri/src/auth.html` | Embedded OAuth redirect receiver for Google Sign-In |
| **Local Proxy Server** | `server/index.js` (port 3001) | Dev/local Node REST proxy for audio streams, metadata & library sync |

---

## 2. Terminal Execution & Desktop Bridge Runner (`0xc0000142`)

> [!IMPORTANT]
> **Windows Sandbox Limitation**: Direct command execution via `run_command` or subagents fails with exit code `0xc0000142` (`-1073741502`) due to desktop session restrictions in Antigravity 2.0.
> **DO NOT ask the user to run terminal commands.** Use the persistent HTTP bridge runner.

### Using the Bridge Runner
- **URL**: `http://127.0.0.1:42888/api/exec`
- **Method**: Use `read_url_content` with a query string:
  `http://127.0.0.1:42888/api/exec?cmd=<PowerShell command>&_t=<timestamp>`
- **Rules**:
  1. **Working Directory**: The runner defaults to `C:\Users\monty`. Always prepend `cd C:\Users\monty\Documents\AB\notify;` for workspace commands.
  2. **URL Encoding**: In query strings, spaces must be `%20`, and `&` MUST be encoded as `%26` (e.g. `2>%261` for stderr redirection).
  3. **Cache Busting**: Always append `&_t=<now>` to prevent stale HTTP responses.

---

## 3. Windows Build, Installer Packaging & Launch Runbook

> [!CAUTION]
> **NEVER build the Windows app using raw `cargo build --release`!**
> Raw `cargo build` skips Tauri CLI's frontend asset embedding preprocessor. When `app.exe` is launched without `npm run dev` running, WebView2 attempts to load `devUrl` (`http://localhost:5173`) and crashes with **`localhost refused to connect` (`ERR_CONNECTION_REFUSED`)**.

### A. Building Standalone `.exe` + Windows Installers (`npx tauri build`)
- Use `npx tauri build` to build `app.exe` AND bundle the NSIS (`dotify_1.0.0_x64-setup.exe`) and MSI installers, or `npx tauri build --no-bundle` for a fast binary-only build.
- After building, sync `dotify.exe`, `dotify-setup.exe`, and `C:\Users\monty\AppData\Local\dotify\app.exe`:
```
http://127.0.0.1:42888/api/exec?cmd=cd%20C:%5CUsers%5Cmonty%5CDocuments%5CAB%5Cnotify%3B%20Stop-Process%20-Name%20app%20-Force%20-ErrorAction%20SilentlyContinue%3B%20npx%20tauri%20build%202%3E%261&_t=1790000000000
```
```
http://127.0.0.1:42888/api/exec?cmd=Copy-Item%20-Path%20%27C:%5CUsers%5Cmonty%5CDocuments%5CAB%5Cnotify%5Csrc-tauri%5Ctarget%5Crelease%5Capp.exe%27%20-Destination%20%27C:%5CUsers%5Cmonty%5CDocuments%5CAB%5Cnotify%5Cdotify.exe%27%20-Force%3B%20Copy-Item%20-Path%20%27C:%5CUsers%5Cmonty%5CDocuments%5CAB%5Cnotify%5Csrc-tauri%5Ctarget%5Crelease%5Cbundle%5Cnsis%5Cdotify_1.0.0_x64-setup.exe%27%20-Destination%20%27C:%5CUsers%5Cmonty%5CDocuments%5CAB%5Cnotify%5Cdotify-setup.exe%27%20-Force%3B%20Copy-Item%20-Path%20%27C:%5CUsers%5Cmonty%5CDocuments%5CAB%5Cnotify%5Csrc-tauri%5Ctarget%5Crelease%5Capp.exe%27%20-Destination%20%27C:%5CUsers%5Cmonty%5CAppData%5CLocal%5Cdotify%5Capp.exe%27%20-Force%3B%20Start-Process%20-FilePath%20%27C:%5CUsers%5Cmonty%5CAppData%5CLocal%5Cdotify%5Capp.exe%27%20-WorkingDirectory%20%27C:%5CUsers%5Cmonty%5CAppData%5CLocal%5Cdotify%27&_t=1790000000001
```

### B. Zero-Node Standalone Portability Architecture (`127.0.0.1:3001`)
So that `dotify.exe` and `dotify-setup.exe` work on **any friend's PC and any network** without Node.js installed:
1. **Hybrid Backend Spawner (`spawn_backend_server()` in [`src-tauri/src/lib.rs`](file:///c:/Users/monty/Documents/AB/notify/src-tauri/src/lib.rs))**:
   - Checks if `127.0.0.1:3001` is open; if not, tries `node server/index.js` if present.
   - If `127.0.0.1:3001` is still unbound (on any machine without Node.js), Rust binds `127.0.0.1:3001` natively (`handle_embedded_backend_client()`).
2. **Auto-Bootstrapped `yt-dlp.exe` & `curl.exe` Range Proxy**:
   - `ensure_ytdlp_binary()` checks `%LOCALAPPDATA%\dotify\yt-dlp.exe` and silently downloads the official binary via `curl.exe` if missing.
   - `resolve_ytdlp_stream_url()` resolves full-length M4A/AAC YouTube audio streams (`ytsearch1:<artist> <title> official audio`) with in-memory caching.
   - `proxy_audio_stream_via_curl()` streams audio with `Range` / `206 Partial Content` and `Access-Control-Allow-Origin: *` so Web Audio API's 10-band Equalizer and Spectrum Visualizer work without CORS issues.
3. **Direct Stream Fallback & Dynamic Paths**:
   - [`src/audio/audioEngine.ts`](file:///c:/Users/monty/Documents/AB/notify/src/audio/audioEngine.ts) falls back to direct `fallbackUrl` (`dzcdn.net`) whenever `/api/stream/track` fails after retry.
   - `get_dotify_local_dir()` dynamically resolves `%LOCALAPPDATA%\dotify` and `std::env::current_exe()` (never hardcode `C:\Users\monty`).

---

## 4. Android APK Build & Signing Runbook

To compile, assemble, and cryptographically sign `dotify.apk`:
```
http://127.0.0.1:42888/api/exec?cmd=Start-Process%20-FilePath%20"cmd.exe"%20-ArgumentList%20"/c%20C:\Users\monty\Documents\AB\notify\build-apk.bat%20>%20C:\Users\monty\Documents\AB\notify\build.log%202>%261"%20-WindowStyle%20Hidden&_t=1789900000000
```
- `build-apk.bat` runs `npm run build`, `npx tauri android build --apk` (NDK 27 across `aarch64`, `armv7`, `i686`, `x86_64`), and signs with `apksigner.bat` using `C:\Users\monty\.android\debug.keystore` (pass: `android`).

---

## 5. UI Architecture, Auth & Cloud Sync Invariants ("Gotchas")

- **CSS Containing Block Trap**: Any ancestor with `backdrop-filter` (`backdrop-blur-md` on `<TopBar>`) or `transform` traps `position: fixed` descendants. Always mount modals at the top level of [`src/App.tsx`](file:///c:/Users/monty/Documents/AB/notify/src/App.tsx) via `createPortal(modalContent, document.body)`.
- **Dedicated Playlist Page**: Clicking playlists in [`Sidebar.tsx`](file:///c:/Users/monty/Documents/AB/notify/src/components/layout/Sidebar.tsx) MUST call `navigateToPlaylist(playlistId)` to render [`PlaylistView.tsx`](file:///c:/Users/monty/Documents/AB/notify/src/components/views/PlaylistView.tsx).
- **Firestore `undefined` Sanitization**: Always sanitize payloads via `JSON.parse(JSON.stringify(...))` before calling Firestore `setDoc()` in [`src/services/authService.ts`](file:///c:/Users/monty/Documents/AB/notify/src/services/authService.ts).
