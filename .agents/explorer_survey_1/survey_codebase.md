# Comprehensive Codebase Survey: dotify

**Date**: 2026-09-19  
**Explorer Agent**: `explorer_survey_1`  
**Target Repository**: `c:\Users\monty\Documents\AB\notify`  
**Reference Document**: `c:\Users\monty\Documents\AB\notify\ORIGINAL_REQUEST.md` (including 2026-09-19 Follow-up)

---

## Executive Summary

dotify is a cross-platform Spotify-style web application built on **Vite 6 + React 18 + TypeScript 5.7 + Tailwind CSS 3.4**, paired with a **Node.js Express + WebSockets backend** and a **Tauri 2.0 (Rust/Android)** desktop/mobile packaging layer. 

The existing codebase implements the foundational features from the Initial Request (3-column desktop layout, mobile view with mini-player and full-screen sheet, 10-band graphic equalizer with peaking BiquadFilterNodes, CSS theme token switcher with 5 presets, unified track model, and multi-source streaming via Audius, Internet Archive, Radio-Browser, Deezer/YouTube track resolver, and WebTorrent P2P streaming).

However, **critical gaps exist when measured against the authoritative Follow-up requirements of 2026-09-19**:
1. **R1 (Low-Latency & Queue/Playlists)**: No multi-tier audio caching (Cache API/IndexedDB blob cache) or secondary pre-buffered audio element; no dedicated Artist View (clicking an artist name in UI does not navigate to an artist profile); queue lacks "Play Next" and reordering capabilities; custom playlists lack rename, reordering, and dedicated in-library Spotify URL importer with preview.
2. **R2 (Private Listening Profile & Recommendations)**: Zero IndexedDB implementation (only synchronous `localStorage` exists); no telemetry tracking completion rates, skips, replays, or listening sessions; no personalized recommendation shelves on Home ("Discover Weekly", "Daily Mix", "Heavy Rotation", "Forgotten Favorites"); no queue-end infinite autoplay.
3. **R3 (Cross-Device Sync & Remote Control / Spotify Connect)**: An existing `jamServer.js` and `jamStore.ts` provides listening room party codes, but lacks local device discovery ("Connect to a Device" menu), device roles (remote controller vs active player), remote playback command RPCs without local audio playback, and millisecond-accurate playback handoff.
4. **R4 (Google Cast / Smart Speaker Casting)**: Completely missing Google Cast Web SDK (`cast_sender.js`), cast button, cast session management, and media state synchronization.
5. **R5 (Tauri / PWA Packaging)**: `public/sw.js` is currently a self-clearing dummy script with no offline app shell caching; Tauri 2.0 configuration is present but requires verification with new views.

---

## 1. Build Setup, Dependencies & Test Infrastructure

### 1.1 Package Manifest (`package.json`)
- **Name**: `notify` (version `1.0.0`, type `module`)
- **Runtime Dependencies**:
  - Web & State: `react` (^18.3.1), `react-dom` (^18.3.1), `zustand` (^5.0.3), `clsx` (^2.1.1), `tailwind-merge` (^3.0.1), `lucide-react` (^0.475.0), `qrcode` (^1.5.4)
  - Backend & Networking: `express` (^4.21.2), `cors` (^2.8.5), `ws` (^8.21.3)
  - Audio & Media Resolvers: `webtorrent` (^3.0.21), `@distube/ytdl-core` (^4.15.9), `play-dl` (^1.9.7), `youtube-dl-exec` (^3.1.15), `yt-search` (^2.13.1)
  - Tauri: `@tauri-apps/api` (^2.11.1), `@tauri-apps/plugin-http` (^2.6.1)
- **Dev Dependencies**:
  - `typescript` (^5.7.3), `vite` (^6.1.0), `@vitejs/plugin-react` (^4.3.4), `tailwindcss` (^3.4.17), `postcss` (^8.5.2), `autoprefixer` (^10.4.20)
  - Testing: `vitest` (^4.1.11), `jsdom` (^27.0.1), `@testing-library/react` (^16.3.3), `@playwright/test` (^1.63.0)
  - Tauri CLI: `@tauri-apps/cli` (^2.11.4)
  - Utilities: `concurrently` (^9.1.2)

### 1.2 Build Configuration & Verification
- **`tsconfig.json`**: Targets `ES2022`, module `ESNext`, module resolution `bundler`, `strict: true`, path alias `"@/*": ["src/*"]`.
- **`vite.config.ts`**: Configured on port 5173 with API proxies (`/api` -> `http://localhost:3001`, `/ws` -> `ws://localhost:3001`).
- **Production Build Execution**:
  - Ran `npm run build` (`tsc && vite build`).
  - **Result**: Built successfully in 8.87 seconds with **0 errors**. Produced `dist/index.html` (1.44 kB), `dist/assets/index-As30HDO6.css` (29.98 kB), `dist/assets/index-Dc4O3p7J.js` (298.74 kB).

### 1.3 Test Setup & Pass/Fail Status
- **Unit Runner**: `vitest` (configured in `vitest.config.ts`, environment `node`, setup file `tests/fixtures/vitest.setup.ts`).
- **Unit Test Execution**:
  - Ran `npm test` (`vitest run`).
  - **Result**: **4 test files passed, 22 tests passed** (708ms):
    - `tests/unit/contrast.spec.ts`: WCAG contrast algorithms
    - `tests/unit/dsp.spec.ts`: BiquadFilter cascade math, linear gain conversions
    - `tests/unit/storage.spec.ts`: SafeStorage prefix and fallback behavior
    - `tests/unit/trackModel.spec.ts`: Unified Track model structure
- **E2E Runner**: Playwright (`playwright.config.ts`), configured for Desktop Chrome (1280x800) and Mobile Pixel 5 (393x851).
  - Tiers 1-4 specs exist under `tests/e2e/`.

---

## 2. Source Code Architecture & Directory Mapping

```
c:\Users\monty\Documents\AB\notify\
├── public/
│   ├── favicon.svg             # App SVG icon
│   ├── manifest.json           # Web App Manifest (standalone, theme #121212)
│   └── sw.js                   # Development dummy service worker (clears caches)
├── server/
│   ├── index.js                # Express app entry: /api/stream/proxy, /api/stream/track, /api/charts, /api/spotify/resolve
│   ├── jamServer.js            # WebSocket server on /ws/jam (room codes, host/guest sync)
│   ├── spotifyResolver.js      # Scrapes Spotify oEmbed & public embed JSON without API keys
│   ├── streamProxy.js          # Byte-range HTTP proxy (206 Partial Content, CORS headers)
│   ├── torrentEngine.js        # WebTorrent client, sequential file streaming
│   └── trackResolver.js        # YouTube audio extractor with lowest-bitrate format + in-memory cache
├── src/
│   ├── audio/
│   │   ├── audioEngine.ts      # Web Audio singleton (HTMLAudioElement, 10 BiquadFilters, AnalyserNode, masterGain)
│   │   └── mediaSession.ts     # navigator.mediaSession handler integration
│   ├── components/
│   │   ├── jam/
│   │   │   └── JamModal.tsx    # Listening party room modal (QR code, room code, Spotify import preview)
│   │   ├── layout/
│   │   │   ├── MobileBottomNav.tsx   # 5-tab mobile navigation (48px tap targets)
│   │   │   ├── MobileMiniPlayer.tsx  # Floating mini player above mobile nav
│   │   │   ├── PlayerBar.tsx         # 3-column desktop bottom player with 0ms direct-DOM seekbar
│   │   │   ├── RightDrawer.tsx       # Desktop collapsible drawer (Queue or Equalizer)
│   │   │   ├── Sidebar.tsx           # Collapsible desktop left sidebar
│   │   │   └── TopBar.tsx            # Navigation arrows, search input, filter pills, tool toggles
│   │   ├── player/
│   │   │   ├── EqualizerDrawer.tsx   # 10 vertical sliders, pre-amp slider, preset dropdown
│   │   │   ├── MobileNowPlayingSheet.tsx # Fullscreen mobile sheet (Art, Visualizer, EQ)
│   │   │   ├── QueueDrawer.tsx       # Queue listing with clear and remove buttons
│   │   │   ├── VisualizerCanvas.tsx  # 60 FPS requestAnimationFrame canvas (bars or wave)
│   │   │   └── VisualizerModal.tsx   # Fullscreen visualizer modal
│   │   ├── settings/
│   │   │   └── ThemeModal.tsx        # Preset chooser + live color input
│   │   └── views/
│   │       ├── HomeView.tsx          # Hero banner, charts, popular artists, Audius trending, archive, radio
│   │       ├── LibraryView.tsx       # Liked songs tab, custom playlists tab
│   │       ├── RadioView.tsx         # Radio-Browser genre tags and station grid
│   │       ├── SearchView.tsx        # Cross-feed search with keyword ranking
│   │       └── TorrentView.tsx       # Magnet link input, swarm metadata inspect, sequential audio playback
│   ├── dsp/
│   │   └── types.ts            # EqualizerBandConfig, EQ_FREQUENCIES, EQ_PRESET_GAINS
│   ├── services/
│   │   ├── archiveApi.ts       # Internet Archive search & concert streams
│   │   ├── audiusApi.ts        # Audius trending & search
│   │   ├── chartsApi.ts        # Deezer top tracks, top artists, artist top tracks
│   │   ├── radioApi.ts         # Radio-Browser top stations and bytag search
│   │   ├── spotifyApi.ts       # Frontend client for /api/spotify/resolve
│   │   └── torrentApi.ts       # Frontend client for /api/torrent/info and stream URLs
│   ├── store/
│   │   ├── jamStore.ts         # WebSocket state for Jam listening parties
│   │   ├── playerStore.ts      # Core Zustand store (playback, queue, history, view, playlists, liked)
│   │   └── themeStore.ts       # CSS variables injector and theme preset state
│   ├── types/
│   │   ├── theme.ts            # ThemePresets, ThemeColors
│   │   └── track.ts            # Unified Track interface
│   ├── utils/
│   │   ├── prefetch.ts         # Pre-warm stream URLs via /api/stream/track?preload=true
│   │   └── storage.ts          # SafeStorage wrapper for localStorage (prefix dotify_v1_)
│   ├── App.tsx                 # Top-level layout shell and active view switcher
│   ├── index.css               # Tailwind directives, CSS token variables, custom range styling
│   └── main.tsx                # React root mount with ErrorBoundary
├── src-tauri/                  # Tauri 2.0 Rust project & Android gradle scaffolding
├── tests/
│   ├── e2e/                    # Playwright tiers 1-4
│   ├── fixtures/               # Mock audio WAV base64, mock data, route interceptors
│   └── unit/                   # Vitest unit specs
```

---

## 3. Audio Playback Engine Deep Dive

### 3.1 Web Audio DSP Graph & Node Lifecycle (`src/audio/audioEngine.ts`)
1. **Singleton Instance**: `AudioEngine.getInstance()`.
2. **Audio Element**: Instantiates `new Audio()`, configured with `crossOrigin = 'anonymous'` and `preload = 'auto'`.
3. **Web Audio Graph Topology**:
   ```
   HTMLAudioElement
          │
          ▼
   MediaElementAudioSourceNode
          │
          ▼
       GainNode (Pre-Amp: -12dB to +12dB)
          │
          ▼
   10 x BiquadFilterNode (type: 'peaking', Q=1.4142, frequencies: 32Hz, 64Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz)
          │
          ▼
      AnalyserNode (fftSize: 256, smoothingTimeConstant: 0.8)
          │
          ▼
      GainNode (Master Volume: exponential curve volume^1.8)
          │
          ▼
   AudioContext.destination
   ```
4. **Event Handling & Decoupled State**:
   - `timeupdate` fires callbacks registered via `onTimeUpdate`.
   - `play`, `pause`, `waiting`, `playing`, `ended`, `error` notify `onStateChange` (`isPlaying`, `isBuffering`).
   - Direct-DOM seekbars in `PlayerBar.tsx` and `MobileNowPlayingSheet.tsx` bypass React state updates to achieve 0ms seekbar scrubbing latency.

### 3.2 Provider Streaming Implementations
1. **Audius**:
   - Discovered through `/api/audius/tracks/trending` and `/api/audius/tracks/search`.
   - Streamed via `/api/audius/tracks/:id/stream`, which proxies upstream MP3 audio with CORS headers.
2. **Internet Archive**:
   - Searched via `/api/archive/advancedsearch.php`.
   - Streamed via `/api/archive/stream/:identifier`, which resolves the item metadata, selects public `.mp3`/`.ogg` audio files, and pipes byte ranges.
3. **Radio-Browser**:
   - Searched via `/api/radio/stations/bytag/:tag` or `topclick`.
   - Streamed via `/api/stream/proxy?url=...` with `Accept-Ranges: bytes` and CORS bypass for Icecast/Shoutcast streams.
4. **P2P WebTorrent Swarms**:
   - Server-side WebTorrent engine (`server/torrentEngine.js`).
   - Inspects metadata via `/api/torrent/info?torrent=...`.
   - Streams audio files sequentially via `/api/torrent/stream?torrent=...&fileIndex=...` supporting HTTP 206 range requests.
5. **Universal Charts / Mainstream Tracks**:
   - Track metadata sourced from Deezer API (`/api/charts/*`).
   - Audio resolved via `server/trackResolver.js`, which searches YouTube, extracts the lowest-bitrate stream (Opus 48kbps or AAC 48kbps), and streams through `streamProxy.js` with fallback to official 30s audio previews.

### 3.3 Existing Buffering & Pre-Warming Behavior
- `src/utils/prefetch.ts` provides `prefetchTrack(track)` which sends a low-priority GET to `/api/stream/track?preload=true`.
- In `server/trackResolver.js`, `preload=true` causes the server to resolve the stream URL and populate its in-memory `streamCache`.
- **Limitation**: This only pre-resolves the HTTP URL on the server; the browser does **not** pre-buffer audio bytes or cache media chunks locally. When `playTrack` is invoked, `audio.src = track.streamUrl` is assigned and network buffering begins from scratch.

---

## 4. State Management Analysis

### 4.1 Player Store (`src/store/playerStore.ts`)
- Implemented with **Zustand** (`create<PlayerStoreState>`).
- Manages:
  - `currentTrack`: Active `Track | null`.
  - `queue`: `Track[]`.
  - `history`: `Track[]` (capped at 40 tracks).
  - `isPlaying`, `isBuffering`, `volume`, `repeatMode` ('off' | 'all' | 'one'), `shuffle` (boolean).
  - Navigation state: `activeView` ('home' | 'search' | 'radio' | 'archive' | 'torrents' | 'library'), `searchQuery`, `sourceFilter`.
  - Overlays: `isRightDrawerOpen`, `rightDrawerTab` ('queue' | 'equalizer'), `isMobileSheetOpen`, `isVisualizerOpen`, `isSidebarCollapsed`, `isJamModalOpen`.
  - Library collections: `likedTracks` (`Track[]`), `playlists` (`Playlist[]`).
- **Persistence**:
  - Uses `safeStorage` (`src/utils/storage.ts`) wrapping `localStorage` with prefix `dotify_v1_`:
    - `dotify_v1_liked`: Array of liked tracks
    - `dotify_v1_user_playlists`: Array of user playlists
    - `dotify_v1_audio_volume`: Number (0.0 to 1.0)
- **Current Limitations in `playerStore.ts`**:
  - `addToQueue(track)` only appends to the end (`[...state.queue, track]`). No `playNext` method.
  - No queue reordering method (`reorderQueue(fromIndex, toIndex)`).
  - No playlist renaming (`renamePlaylist(id, newName)`).
  - No playlist reordering (`reorderPlaylist(id, fromIndex, toIndex)`).
  - No Spotify import action that directly persists imported playlists into `playlists`.
  - In `nextTrack()`, when `nextIndex >= queue.length`, it terminates without any autoplay recommendation fallback.
  - `AppView` union does not include `'artist'`.

### 4.2 Theme Store (`src/store/themeStore.ts`)
- Manages:
  - `activePreset`: 'spotify-oled' | 'nord-frost' | 'cyberpunk-neon' | 'retro-winamp' | 'rose-pine' | 'custom'.
  - `colors`: Object containing 15 CSS color tokens (`bgBase`, `bgSurface`, `bgElevated`, `bgHighlight`, `textPrimary`, `textSecondary`, `textMuted`, `accent`, `accentHover`, `accentContent`, `border`, `playerBg`, `seekbarBg`, `seekbarBuffered`, `seekbarFill`).
- Directly updates DOM CSS custom properties on `document.documentElement` (`applyThemeToDOM`), enabling zero-reload instant theme updates.
- Persisted to `localStorage` under `dotify_v1_theme` and `dotify_v1_theme_colors`.

### 4.3 Jam Store (`src/store/jamStore.ts`)
- Connects to `/ws/jam` over WebSockets.
- Supports creating a room (`roomCode` of 6 alphanumeric characters) or joining an existing room.
- Synchronizes playback state (`currentTrack`, `isPlaying`, `playbackPosition`) and shared queue among participants.
- Does **not** implement device discovery, device roles, remote control RPCs without local playback, or millisecond playback handoff between user devices.

---

## 5. Comprehensive Gap Analysis Against Requirements (Follow-up 2026-09-19)

| Req ID | Requirement Item | Existing Implementation State | Gap / Missing Elements | Severity |
|---|---|---|---|---|
| **R1.1** | Sub-second cold-start streaming via multi-tier caching, predictive pre-warming & fast chunks | `prefetchTrack` calls `/api/stream/track?preload=true` which caches URLs on the server. `AudioEngine` uses a single `HTMLAudioElement`. | No client-side audio cache (Cache API or IndexedDB blob cache). No dual/idle audio element pre-buffering next track's actual media bytes. No low-bitrate fast chunk client-side pipeline. | HIGH |
| **R1.2** | Dedicated Artist View with top tracks, discography, albums, related artists & instant "Artist Radio" mix | Top Artists carousel in `HomeView.tsx` plays top tracks inline. `AppView` has no `'artist'` view. Artist names throughout the app lack click-to-navigate handlers. | Missing dedicated `ArtistView.tsx`. Missing `activeArtist` state in `playerStore`. Missing API endpoints/methods for artist albums, full discography, related artists, and "Artist Radio" mix generator. Artist links in `PlayerBar`, `MobileNowPlayingSheet`, `TrackItem` do not navigate. | HIGH |
| **R1.3** | Full Queue Management: "Play Next", "Add to End", drag-and-drop / reorder, track removal | `addToQueue` (appends to end only). Track removal (`removeFromQueue`) and clear (`clearQueue`) exist in `QueueDrawer.tsx`. | No "Play Next" action (inserting right after current track). No reorder action in `playerStore`. `QueueDrawer.tsx` has no reorder controls (no drag handles or up/down reorder buttons). Tracks in views lack context menu / quick buttons for Play Next vs Add to End. | HIGH |
| **R1.4** | Custom Playlists & Spotify Importer: create, rename, reorder, delete, and public Spotify playlist link importer | `createPlaylist`, `deletePlaylist`, `addTrackToPlaylist`, `removeTrackFromPlaylist` exist. `spotifyResolver.js` exists on server and in `JamModal.tsx` for immediate queuing. | Missing `renamePlaylist` and `reorderPlaylist` in `playerStore` and `LibraryView`. No Spotify importer UI in `LibraryView` allowing users to paste a Spotify playlist link, preview extracted tracks, and save directly to Dotify playlists. | HIGH |
| **R2.1** | Structured On-Device Listening Dataset in IndexedDB with exportable JSON | Only `localStorage` is used (`safeStorage.ts`). | No IndexedDB telemetry store (`dotify_telemetry_db`). No telemetry listener logging play starts, 30s threshold completions, skips, replays, listening timestamps, or genre affinity. No JSON export UI/feature for the listening profile dataset. | HIGH |
| **R2.2** | Personalized Recommendation Shelves & Infinite Autoplay | `HomeView.tsx` displays static hardcoded feeds (Hits, Audius trending, Archive concerts, Radio). When queue completes, playback stops. | No recommendation engine calculating affinity scores from the IndexedDB listening dataset. No personalized shelves on Home ("Discover Weekly", "Daily Mix", "Heavy Rotation", "Forgotten Favorites", "Made For You"). No queue-end Autoplay toggle and automatic recommendation queueing. | HIGH |
| **R3.1** | Cross-Device Sync & Remote Control (Spotify Connect) over WebSockets | `jamServer.js` and `jamStore.ts` exist for listening party room codes. | Missing Spotify Connect-style local device discovery (no device registry advertising device ID, device name, and device type: desktop/mobile/web). Missing "Connect to a Device" UI menu. Missing remote control mode (sending play/pause/seek/volume commands to active player without playing audio on controller). Missing millisecond playback handoff. | HIGH |
| **R4.1** | Google Home / Chromecast Smart Speaker Casting | No Google Cast integration. | Google Cast SDK script missing from `index.html`. No Cast manager/service. No Cast button in `PlayerBar` or `TopBar`. No audio routing or media state sync with `cast.framework.CastContext`. | HIGH |
| **R5.1** | Tauri 2.0 / PWA Packaging & UI Polish | Tauri 2.0 configuration files and Android scaffolding exist in `src-tauri/`. `manifest.json` exists. | `public/sw.js` is a development dummy that clears caches instead of caching the app shell. Verification needed for build and test pipelines across mobile and desktop viewports. | MEDIUM |

---

## 6. Detailed Architectural Recommendations for Implementation

### 6.1 Low-Latency Streaming Pipeline (`R1`)
1. **Multi-Tier Audio Caching Engine**:
   - Create `src/services/audioCache.ts`:
     - **Tier 1 (Memory / Blob URL Cache)**: Cache the first 256KB-512KB chunk of upcoming tracks in memory as Blob URLs for immediate header decoding.
     - **Tier 2 (Cache API / IndexedDB Audio Store)**: Cache frequent and upcoming audio responses under a dedicated `dotify-audio-v1` cache store.
2. **Dual-Element Pre-Warming**:
   - In `AudioEngine`, maintain an active `HTMLAudioElement` and a secondary `HTMLAudioElement` (`nextAudio`).
   - When playback passes 70% or when the next track is resolved, pre-load the next track's URL in `nextAudio`.
   - On track transition, swap active elements with 0ms delay.
3. **Fast-Chunk Proxy Optimization**:
   - Ensure `server/trackResolver.js` continues to serve low-bitrate fast headers and stream chunks so initial playback latency remains under 1 second.

### 6.2 Dedicated Artist Profile (`R1`)
1. **View & Navigation State**:
   - Extend `AppView` in `src/store/playerStore.ts`:
     ```ts
     export type AppView = 'home' | 'search' | 'radio' | 'archive' | 'torrents' | 'library' | 'artist';
     ```
   - Add `selectedArtist: { id?: number | string; name: string; picture?: string } | null` to `playerStore`.
   - Add `navigateToArtist: (artist: { id?: number | string; name: string; picture?: string }) => void`.
2. **Artist View Component (`src/components/views/ArtistView.tsx`)**:
   - Header with high-res artist banner, monthly listeners / stats badge, "Play", "Artist Radio", and "Follow" buttons.
   - **Popular / Top Tracks**: Top 10 tracks with play counts and durations.
   - **Discography / Albums**: Grid of studio albums, singles, and EPs.
   - **Related / Similar Artists**: Carousel of related artists with one-click navigation.
   - **Artist Radio Mix**: Dynamic button generating an instant queue mixing the artist's tracks and related artist tracks.
3. **Universal Artist Link Wiring**:
   - Replace plain text or non-navigating elements with clickable artist links across `PlayerBar`, `MobileNowPlayingSheet`, `TrackItem`, `QueueDrawer`, `SearchView`, `LibraryView`.

### 6.3 Enhanced Queue & Playlist Management (`R1`)
1. **Queue Store Enhancements**:
   - Add `playNext: (track: Track) => void` (inserts right after index of `currentTrack`).
   - Add `reorderQueue: (fromIndex: number, toIndex: number) => void`.
2. **Queue UI Polish**:
   - In `QueueDrawer.tsx`, add reorder controls (drag handle or Up/Down buttons) and visual distinction between "Now Playing" and upcoming items.
3. **Playlist Enhancements**:
   - Add `renamePlaylist: (id: string, newName: string) => void`.
   - Add `reorderPlaylist: (id: string, fromIndex: number, toIndex: number) => void`.
   - Add `importSpotifyPlaylist: (name: string, tracks: Track[]) => void`.
4. **Spotify Importer UI in `LibraryView.tsx`**:
   - Add an "Import from Spotify" button opening an inline modal/card.
   - Allows pasting any public Spotify playlist URL (`open.spotify.com/playlist/...`).
   - Calls `/api/spotify/resolve?url=...`, displays playlist artwork, name, and track count preview.
   - "Save as Dotify Playlist" button creates the playlist in `playerStore` with all extracted tracks.

### 6.4 Private Listening Profile & Recommendation Engine (`R2`)
1. **IndexedDB Telemetry Store (`src/services/telemetryDb.ts`)**:
   - Database name: `dotify_telemetry_db`, version `1`.
   - Object stores:
     - `playback_events`: `{ id, trackId, artist, title, genre, duration, listenedSeconds, completed, skipped, timestamp }`.
     - `artist_affinity`: `{ artist, playCount, completionRate, lastPlayed }`.
     - `genre_affinity`: `{ genre, playCount, lastPlayed }`.
   - Track playback events:
     - Log on track start.
     - When track plays > 30s, record valid listen.
     - When track skips before 30s, record `skipped = true`.
     - When track completes, record `completed = true`.
   - Export feature: `exportListeningDataset(): Promise<string>` triggering a JSON file download.
2. **Personalized Discovery Engine (`src/services/recommendationEngine.ts`)**:
   - Queries `telemetryDb` to compute top genres, top artists, and forgotten favorites (tracks completed > 7 days ago not played recently).
   - Generates personalized recommendation shelves:
     - **Discover Weekly**: Unheard tracks from top genres / related artists.
     - **Daily Mix**: High-affinity tracks grouped by dominant genre.
     - **Heavy Rotation**: Most completed tracks in the past 14 days.
     - **Forgotten Favorites**: High-affinity tracks not listened to recently.
     - **Made For You**: Blended recommendations.
   - Embed shelves directly into `HomeView.tsx`.
3. **Real-time Infinite Autoplay**:
   - Add `autoplay: boolean` (default `true`) to `playerStore`.
   - In `nextTrack()`, if `nextIndex >= queue.length` and `autoplay` is enabled:
     - Trigger `recommendationEngine.getNextAutoplayTracks(currentTrack, history)`
     - Append 5 recommended tracks to `queue` and seamlessly play the first one.

### 6.5 Cross-Device Sync & Remote Control / Spotify Connect (`R3`)
1. **WebSocket Connect Protocol (`server/connectServer.js` or extending `jamServer.js`)**:
   - Channel `/ws/connect`.
   - Each client on local network registers:
     ```ts
     interface ConnectedDevice {
       id: string;
       name: string;
       type: 'desktop' | 'mobile' | 'web';
       isActivePlayer: boolean;
       volume: number;
       currentTrack: Track | null;
       position: number;
       isPlaying: boolean;
     }
     ```
   - Protocol messages:
     - `device_announce`: Register/heartbeat device.
     - `device_list`: Broadcast list of active devices on the local network.
     - `transfer_playback`: `{ targetDeviceId, position, isPlaying, track, queue }`. Target resumes audio; source pauses and becomes a controller.
     - `remote_command`: `{ targetDeviceId, action: 'play' | 'pause' | 'seek' | 'volume' | 'next' | 'previous', value }`. Target executes command; controller UI updates in real time without audio output.
2. **UI Integration (`DeviceMenu.tsx`)**:
   - "Connect to a Device" button in `PlayerBar` and `MobileNowPlayingSheet`.
   - Popup showing available devices (Desktop App, Pixel Phone, Web Browser) with green indicator for current playback device.
   - One-click transfer of playback preserving exact playback timestamp.

### 6.6 Google Home & Chromecast Casting (`R4`)
1. **Google Cast Web SDK Integration**:
   - Add Cast SDK loader in `index.html`:
     ```html
     <script src="https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1"></script>
     ```
2. **Cast Service (`src/services/castService.ts`)**:
   - Initializes `cast.framework.CastContext.getInstance().setOptions({ receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID, autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED })`.
   - Listens for `cast.framework.CastContextEventType.SESSION_STATE_CHANGED`.
   - When connected:
     - Mutes or pauses local `AudioEngine`.
     - Loads media into Cast session: `MediaInfo(track.streamUrl, 'audio/mp3')` with metadata (title, artist, album, images).
     - Syncs seek, play, pause, volume between Cast session and Dotify player store.
3. **Cast UI Button**:
   - Cast button (`google-cast-launcher` or custom Lucide `Cast` icon) in `PlayerBar` and mobile view.

### 6.7 Tauri 2.0 & PWA Packaging (`R5`)
1. **PWA Service Worker (`public/sw.js`)**:
   - Update service worker to cache core app shell (`/`, `/index.html`, assets, icons) with stale-while-revalidate for offline resilience.
2. **Tauri Packaging Verification**:
   - Verify `src-tauri` builds cleanly on desktop and Android.

---

## 7. Conclusion

The existing codebase is structurally sound, clean, and possesses an operable Web Audio DSP graph, multiple feed proxies, and a robust design system. However, the advanced requirements added on 2026-09-19 (low-latency multi-tier caching, dedicated artist profile, queue reordering, Spotify playlist importer, on-device IndexedDB telemetry, algorithmic discovery shelves, infinite autoplay, Spotify Connect cross-device remote control, and Google Cast) require systematic implementation across both frontend and backend.
