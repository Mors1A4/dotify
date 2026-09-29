# Handoff Report: Exhaustive Survey of dotify Codebase

**Agent**: `explorer_survey_1`  
**Parent**: `orchestrator_2` (Conversation ID: `4f3d93f4-0f89-4383-91a9-37f4029b36ac`)  
**Working Directory**: `c:\Users\monty\Documents\AB\notify\.agents\explorer_survey_1`  
**Date**: 2026-09-19  

---

## 1. Observation

1. **Build & Test Infrastructure**:
   - `package.json` specifies `"type": "module"`, `"scripts": { "build": "tsc && vite build", "test": "vitest run", "test:unit": "vitest run", "test:e2e": "playwright test" }`.
   - Tool Command: `npm test` executed `vitest run`.
     - Result: `Test Files: 4 passed (4)`, `Tests: 22 passed (22)`, Duration: 708ms.
   - Tool Command: `npm run build` executed `tsc && vite build`.
     - Result: Exited with code 0 in 8.87s. Generated `dist/index.html` (1.44 kB), `dist/assets/index-As30HDO6.css` (29.98 kB), `dist/assets/index-Dc4O3p7J.js` (298.74 kB).
   - Dependencies: `zustand` (^5.0.3), `express` (^4.21.2), `ws` (^8.21.3), `webtorrent` (^3.0.21), `qrcode` (^1.5.4), `@distube/ytdl-core` (^4.15.9), `@tauri-apps/api` (^2.11.1), `lucide-react` (^0.475.0).

2. **Audio Playback Engine**:
   - In `src/audio/audioEngine.ts` (lines 7–34, 143–159):
     - Uses a single `HTMLAudioElement`: `this.audio = new Audio(); this.audio.crossOrigin = 'anonymous'; this.audio.preload = 'auto';`.
     - `playTrack(track: Track)` assigns `this.audio.src = track.streamUrl; this.audio.load(); await this.audio.play();`.
     - Web Audio graph connects: `sourceNode -> preAmpNode -> 10 peaking filterNodes -> analyserNode -> masterGainNode -> destination`.
     - No multi-tier audio caching (no Cache API or IndexedDB audio blob cache), no dual audio element pre-warming, and no pre-buffering of upcoming track audio bytes.
   - In `src/utils/prefetch.ts` (lines 9–22):
     - `prefetchTrack` sends a low-priority GET request to `${track.streamUrl}?preload=true`.
     - In `server/trackResolver.js` (lines 27–32), `preload === 'true'` returns `{ cached: true }` without downloading or caching media chunks client-side.

3. **Artist View & Navigation**:
   - In `src/store/playerStore.ts` (line 8): `export type AppView = 'home' | 'search' | 'radio' | 'archive' | 'torrents' | 'library';`. There is no `'artist'` view defined.
   - In `src/App.tsx` (lines 22–38): `renderActiveView` handles `'home'`, `'search'`, `'archive'`, `'radio'`, `'torrents'`, `'library'`. No case for `'artist'`.
   - In `src/components/views/HomeView.tsx` (lines 73–83): Clicking an artist in "Popular Artists" calls `handleArtistClick(artist)` which fetches top tracks and immediately invokes `playTrack(tracks[0], tracks)`. It does not navigate to an artist profile.
   - In `src/components/layout/PlayerBar.tsx` (line 156): Artist name rendered as `<span className="text-xs text-secondary truncate hover:underline cursor-pointer">{currentTrack.artist}</span>` with no click handler.

4. **Queue Management & Playlists**:
   - In `src/store/playerStore.ts`:
     - Line 219: `addToQueue: (track) => set((state) => ({ queue: [...state.queue, track] }))` (adds to end only; no `playNext` action).
     - No queue reordering method (`reorderQueue`).
     - Line 94–102: `onTrackEnd` calls `nextTrack()`. When `nextIndex >= queue.length`, line 177 returns without autoplay fallback.
     - Playlists have `createPlaylist`, `deletePlaylist`, `addTrackToPlaylist`, `removeTrackFromPlaylist`. There is no `renamePlaylist` or `reorderPlaylist`.
   - In `src/components/player/QueueDrawer.tsx`:
     - Tracks are rendered in a static list with a remove button (`removeFromQueue(idx)`). There are no reorder drag handles or controls.
   - In `src/components/views/LibraryView.tsx`:
     - Shows liked tracks and custom playlists. No Spotify importer UI exists to paste a Spotify playlist link, preview tracks, and import them into Dotify playlists.

5. **Telemetry & Recommendations**:
   - In `src/utils/storage.ts`: Storage is handled solely by `SafeStorage` wrapping `localStorage` with prefix `dotify_v1_`.
   - Search across `src/`: Grep search for `indexedDB` or `IDBDatabase` returned 0 results. No IndexedDB telemetry database exists for logging completion rates, skips, or replay counts.
   - In `src/components/views/HomeView.tsx`: Contains sections for Global Top Hits, Popular Artists, Audius Trending, Archive Concerts, and Radio Stations. No personalized shelves ("Discover Weekly", "Daily Mix", "Heavy Rotation", "Forgotten Favorites", "Made For You").

6. **Cross-Device Sync & Remote Control (Spotify Connect)**:
   - In `server/jamServer.js` (lines 20–225) & `src/store/jamStore.ts`: Implements a 6-character room code session for listening parties (`/ws/jam`).
   - Does not implement local network device discovery, device registry (device type: desktop/mobile/web), a "Connect to a Device" menu, remote command dispatch without local audio output, or millisecond-accurate playback handoff.

7. **Google Cast Integration**:
   - In `index.html` (lines 1–32): No Google Cast Web SDK (`cast_sender.js`) script tag.
   - Grep search for `cast.framework` or `chrome.cast` across `src/` returned 0 results.

8. **Tauri & PWA Packaging**:
   - `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` exist.
   - `public/manifest.json` exists with `standalone` display.
   - `public/sw.js` is a self-cleaning dummy development worker that unregisters itself and skips caching.

---

## 2. Logic Chain

1. From Observation 1, the build and unit test suites are fully functioning (`npm test` passes 22/22 unit tests, `npm run build` generates clean bundles with 0 TypeScript errors). The development baseline is stable.
2. From Observation 2, audio playback uses a single `HTMLAudioElement` without client-side audio chunk caching or secondary element pre-buffering. Therefore, initial track playback requires starting a network stream connection on every track change, preventing sub-second cold starts and gapless transitions across feeds.
3. From Observation 3, neither `AppView` nor `App.tsx` contains an artist view, and artist name elements across the UI do not route anywhere. Therefore, the requirement "clicking any artist name anywhere in the app opens their dedicated profile displaying top tracks, full discography, albums, related artists, and an instant 'Artist Radio' mix" is unmet.
4. From Observation 4, `playerStore.ts` lacks `playNext`, `reorderQueue`, `renamePlaylist`, and `reorderPlaylist`, and `QueueDrawer.tsx` lacks reordering UI. Therefore, the queue management and custom playlist requirements are partially implemented and missing key actions.
5. From Observation 4 and 5, while `server/spotifyResolver.js` exists, `LibraryView.tsx` has no interface to import Spotify playlists, and `localStorage` is used exclusively. Without IndexedDB, listening telemetry cannot be persisted or exported, and without an affinity algorithm, personalized discovery shelves and infinite autoplay cannot function.
6. From Observation 6 and 7, while collaborative Jam exists for shared room codes, it does not fulfill the Spotify Connect device discovery and remote control requirement (R3), and Google Cast is completely absent (R4).

---

## 3. Caveats

- Playwright E2E tests (`npm run test:e2e`) were not executed in full browser mode during this survey to avoid starting background headless browser processes before orchestrator direction, but the test files and configs were thoroughly inspected.
- Android APK generation via `cargo tauri android build` requires the Android SDK and NDK toolchains; the Tauri configuration files and Gradle project structure are in place in `src-tauri/`.

---

## 4. Conclusion

The existing codebase is well-scaffolded with a working Web Audio 10-band DSP engine, multi-source stream proxies, and responsive layouts. To satisfy the 2026-09-19 follow-up requirements, subsequent milestones must implement:
1. **Low-Latency & Queue/Playlists (R1)**: Client-side audio chunk cache (`audioCache.ts`), secondary element pre-buffering, dedicated `ArtistView.tsx` with top tracks/discography/related/artist radio, `playNext` and reorder in queue, playlist rename/reorder, and public Spotify playlist importer in `LibraryView`.
2. **Private Listening Profile & Discovery (R2)**: On-device IndexedDB telemetry store (`telemetryDb.ts`), JSON export, personalized recommendation engine (`recommendationEngine.ts`) powering "Discover Weekly", "Daily Mix", "Heavy Rotation", "Forgotten Favorites", and infinite queue-end autoplay.
3. **Cross-Device Remote Sync (R3)**: WebSocket local device discovery, "Connect to a Device" menu, remote controller mode (adjust volume, seek, switch tracks on target device), and millisecond playback handoff.
4. **Google Cast (R4)**: Google Cast Web SDK loader, `castService.ts`, Cast launcher button, and media state synchronization.
5. **PWA & Packaging (R5)**: Production service worker caching app shell and asset bundles.

---

## 5. Verification Method

To independently verify these findings:
1. **Verify Unit Tests**: Run `npm test` from `c:\Users\monty\Documents\AB\notify`. Expect 4 test files and 22 tests to pass.
2. **Verify Build**: Run `npm run build`. Expect 0 TypeScript errors and successful production bundling under `dist/`.
3. **Inspect Missing Artist View**: Inspect `src/store/playerStore.ts` line 8 (`AppView` type union) and `src/App.tsx` line 22 (`renderActiveView`); confirm absence of `'artist'` view.
4. **Inspect Missing IndexedDB & Recommendations**: Grep for `indexedDB` in `src/`; confirm 0 occurrences. Inspect `src/components/views/HomeView.tsx`; confirm absence of "Discover Weekly" and personalized recommendation shelves.
5. **Inspect Missing Google Cast & Device Connect**: Inspect `index.html`; confirm absence of `cast_sender.js`. Inspect `src/components/layout/PlayerBar.tsx`; confirm absence of Cast button and "Connect to a Device" menu.
