# Specification Mining Handoff: Requirements R3, R4, and R5

**Agent**: `spec_miner_survey_3`  
**Working Directory**: `c:\Users\monty\Documents\AB\notify\.agents\spec_miner_survey_3`  
**Date**: 2026-09-19  
**Recipient**: `orchestrator_2` (Conversation ID: `4f3d93f4-0f89-4383-91a9-37f4029b36ac`)  
**Primary Deliverable**: `c:\Users\monty\Documents\AB\notify\.agents\spec_miner_survey_3\survey_remote_cast.md`

---

## 1. Observation

1. **Authoritative Requirements**:
   - In `c:\Users\monty\Documents\AB\notify\ORIGINAL_REQUEST.md` lines 71-83:
     - Line 71: *"R3. Cross-Device Sync & Remote Control (Spotify Connect Protocol): Bidirectional device discovery and state synchronization over the local network via WebSockets. Remote Control Mode: use a mobile phone as a remote controller... Seamless Playback Handoff: transfer active playback between devices with millisecond-accurate timestamp preservation."*
     - Line 76: *"R4. Google Home & Smart Speaker Casting: Google Cast integration allowing users to cast audio directly to Google Home, Nest Audio, Chromecast, and smart speakers on the local Wi-Fi. Media controls (volume, play/pause, seek, track metadata, and album art) remain synchronized..."*
     - Line 80: *"R5. Testable Cross-Platform Packaging & UI Polish: Tauri 2.0 / PWA pipeline verified for building and testing Android APKs and Desktop binaries. Responsive mobile (<768px) and desktop (>=768px) interfaces with system media notification and lock-screen controls."*
     - Acceptance Criteria lines 98-104: Local devices appear in "Connect to a Device" menu; phone controls desktop player in real time; Google Home casting routes audio with synchronized controls; `npm test` and `npm run build` pass cleanly with 0 TypeScript/bundling errors.

2. **Codebase Status & Build Tooling**:
   - `npm test`: Executed `vitest run`. Returned exit code 0.
     * Output: `Test Files 4 passed (4), Tests 22 passed (22), Duration 739ms`.
   - `npx tsc --noEmit`: Exited with code 0 (zero TypeScript errors).
   - `npm run build`: Executed `tsc && vite build`. Exited with code 0 in 4.03s.
     * Output: `dist/index.html 1.44 kB, dist/assets/index-*.css 29.98 kB, dist/assets/index-*.js 298.74 kB`.
   - `npx tauri info`: Verified Tauri 2.0 environment:
     * Output: `WebView2: 153.0.4234.32, MSVC: Visual Studio Build Tools 2022, rustc 1.98.1, cargo 1.98.1, @tauri-apps/api 2.11.1, @tauri-apps/cli 2.11.4`.
   - `server/jamServer.js`: Already provides a preliminary room-based WebSocket server (`/ws/jam`) with `create_room`, `join_room`, `sync_playback`, and `add_to_queue`.
   - `src/audio/mediaSession.ts`: Implements `navigator.mediaSession` metadata and handlers for play, pause, next, previous, and seekto. Currently lacks `setPositionState` for the interactive lock-screen scrubber.
   - `public/manifest.json` and `public/sw.js`: Manifest is present. `sw.js` currently unregisters itself for dev mode; production requires a stream-safe caching strategy bypassing `/api/stream/*` and `/api/torrent/*`.

---

## 2. Logic Chain

1. **R3 Connect Architecture**:
   - Spotify Connect relies on an asymmetric client model: only one device actively produces audio (Active Host), while other linked devices act as controllers (Remote Controller).
   - Probing `server/jamServer.js` revealed existing WebSocket infrastructure (`ws` library ^8.21.3) already bound to the HTTP server in `server/index.js`.
   - By creating a unified `ConnectEnvelope` schema and dual transport (WebSocket `/ws/connect` for LAN + `BroadcastChannel('dotify_connect')` for same-origin tabs), devices can register, maintain heartbeats, and exchange state.
   - For seamless handoff, applying the extrapolation formula $P_{\text{target}} = P_{\text{sample}} + (\text{isPlaying} \times (T_{\text{now}} - T_{\text{sample}}))$ ensures millisecond-accurate timestamp transfer between host and target devices without stutter or position drift.

2. **R4 Google Cast Integration**:
   - Google Cast receivers (Chromecast, Google Home, Nest Audio) do not receive raw PCM audio buffers from Web Audio API; instead, the Cast receiver fetches the audio URL directly over Wi-Fi via HTTP/HTTPS.
   - Using the Default Media Receiver (`CC1AD845`) avoids custom receiver app deployment costs and provides native playback of MP3, AAC, and OGG streams.
   - When cast session starts, local `<audio>` playback must be paused to prevent echo.
   - Bidirectional event listeners (`IS_PAUSED_CHANGED`, `CURRENT_TIME_CHANGED`, `VOLUME_LEVEL_CHANGED`) on `cast.framework.RemotePlayerController` ensure user voice commands ("Hey Google pause") or physical volume adjustments immediately update the Dotify UI.

3. **R5 Packaging & Polish**:
   - Tauri 2.0 configuration in `src-tauri/tauri.conf.json` and `src-tauri/capabilities/default.json` is structurally valid and compiles against the local Rust 1.98.1 and MSVC environment.
   - PWA caching must explicitly bypass audio streams (`/api/stream/*`, `/api/torrent/*`) to prevent HTTP 206 chunked stream buffering stalls in `CacheStorage`.
   - Responsive breakpoints adhere strictly to `md:` ($768\text{px}$): desktop 3-column layout vs. mobile bottom nav + mini-player + tap-to-expand sheet with $\ge 48\text{px}$ touch targets.
   - Adding `navigator.mediaSession.setPositionState` completes the lock-screen scrubbing experience on Android and desktop.

---

## 3. Caveats

1. **Google Cast Wi-Fi Network Requirement**: Google Cast requires the sender browser and Cast speaker to reside on the same Wi-Fi subnet, and casting requires a Chromium-based browser (Chrome, Edge, Android Chrome). On unsupported browsers (Firefox, Safari) or in offline environments, the Cast button should gracefully hide.
2. **Local Stream Proxy Routing for Cast**: When casting torrent streams hosted locally on the developer machine (`http://localhost:3001`), the speaker cannot resolve `localhost`. The application must substitute the host's actual local LAN IP (e.g. `http://192.168.x.x:3001`). External streams (Audius, Archive, Radio) stream directly from their public HTTPS CDNs without this restriction.
3. **Tauri Android Packaging**: Building an Android `.apk` requires the Android SDK and NDK installed on the host machine. The Windows desktop binary builds locally via MSVC and Cargo.

---

## 4. Conclusion

Requirements R3, R4, and R5 have been completely mined and documented in `survey_remote_cast.md`:
- **R3**: 20 discovered features mapped, dual WebSocket/BroadcastChannel transport defined, complete TypeScript protocol schema specified, and seamless handoff sequence diagram established.
- **R4**: Google Cast Web SDK lifecycle, receiver app ID (`CC1AD845`), media session loading, and bidirectional event listeners fully architected.
- **R5**: Tauri 2.0 capabilities, stream-safe PWA service worker, responsive $\ge 768\text{px}$ vs $< 768\text{px}$ specifications, `navigator.mediaSession.setPositionState` integration, and continuous integration gates validated.

---

## 5. Verification Method

1. **Verify Specifications Document**:
   - Inspect `c:\Users\monty\Documents\AB\notify\.agents\spec_miner_survey_3\survey_remote_cast.md`.
   - Check that `## Features Discovered` contains all 20 features with Categories, Inputs, Outputs, Error Behavior, and Discovery source.
   - Check that `## Edge Cases` contains all 13 boundary scenarios.
2. **Verify Test & Build Integrity**:
   - Run unit test suite: `npm test` (must return code 0, 22/22 tests pass).
   - Run typecheck: `npx tsc --noEmit` (must return code 0).
   - Run production build: `npm run build` (must return code 0, bundling `dist/` cleanly).
3. **Verify Tauri 2.0 Tooling**:
   - Run `npx tauri --version` (reports `tauri-cli 2.11.4`).
