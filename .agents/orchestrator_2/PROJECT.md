# Project: dotify (Upgrade Ecosystem)

## Architecture
Upgrade dotify into a feature-complete, cross-platform music streaming ecosystem with sub-second streaming latency, rich artist profiles, custom and Spotify-imported playlists, a private on-device listening dataset powering tailored algorithmic recommendations, Spotify Connect-style cross-device remote sync (phone controlling desktop), and Google Home / Chromecast speaker casting.

### High-Level System Architecture
```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                     BROWSER / PWA / TAURI                                │
│                                                                                          │
│  ┌───────────────────────┐    ┌───────────────────────────┐    ┌──────────────────────┐  │
│  │     UI / Navigation   │    │    Queue & Player Store   │    │  Artist & Playlists  │  │
│  │ - 3-Col Desktop >=768 │    │ - Play Next / Add to End  │    │ - Dedicated Profile  │  │
│  │ - Mobile Nav <768     │    │ - Reorder & Remove        │    │ - Artist Radio       │  │
│  │ - MiniPlayer & Sheet  │    │ - Autoplay Integration    │    │ - Spotify Importer   │  │
│  └───────────┬───────────┘    └─────────────┬─────────────┘    └──────────┬───────────┘  │
│              │                              │                             │              │
│              ▼                              ▼                             ▼              │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                   Web Audio API & Low-Latency Caching Engine                       │  │
│  │  - Multi-tier Cache: Memory (L1) -> CacheStorage (L2) -> Proxy (L3) -> Origin (L4)│  │
│  │  - Predictive Pre-Warming: 256KB Range Chunks for Upcoming Queue Tracks (<1s cold) │  │
│  │  - Dual Element / Pre-buffering Pipeline + 10-Band EQ + 60 FPS Visualizer          │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
│              │                              │                             │              │
│              ▼                              ▼                             ▼              │
│  ┌───────────────────────┐    ┌───────────────────────────┐    ┌──────────────────────┐  │
│  │  Private Telemetry DB │    │   Recommendation Engine   │    │ Remote Sync & Cast   │  │
│  │ - IndexedDB Schema    │    │ - Made For You            │    │ - WebSocket Connect  │  │
│  │ - Completion & Skips  │───>│ - Discover Weekly / Daily │    │ - Phone Remote Mode  │  │
│  │ - Replays & Sessions  │    │ - Heavy Rotation          │    │ - Millisecond Handoff│  │
│  │ - JSON Export/Import  │    │ - Forgotten Favorites     │    │ - Google Cast SDK    │  │
│  └───────────────────────┘    │ - Infinite Autoplay       │    │ - Smart Speaker Sync │  │
│                               └───────────────────────────┘    └──────────────────────┘  │
└──────────────────────────────────────────┬───────────────────────────────────────────────┘
                                           │ WebSocket / HTTP Range Streams
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                  LOCAL EXPRESS SERVER                                    │
│  - Static Asset / PWA Serving                                                            │
│  - Stream Proxy (/api/stream/proxy) with Range Requests for Non-CORS Feeds               │
│  - WebTorrent Engine (/api/torrent/stream) Sequential 206 Streaming                      │
│  - WebSocket Connect Hub (/ws/connect) for LAN Device Discovery & Spotify Connect Sync   │
│  - Public Spotify Embed Scraper (/api/spotify/resolve)                                   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Feature Inventory

Every feature identified during the Survey phase mapped to its assigned milestone:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Desktop 3-Column Layout | Spotify-style 3-column layout (sidebar, feed, right drawer, persistent player) for >= 768px | M5 | ORIGINAL_REQUEST § R1, Survey 1 |
| 2 | Mobile & Android View | Mobile view (<768px) with bottom nav (48px tap targets), floating mini-player | M5 | ORIGINAL_REQUEST § R1, Survey 1 |
| 3 | Tap-to-Expand Now-Playing Sheet | Fullscreen slide-up sheet on mobile with artwork, scrubber, transport controls | M5 | ORIGINAL_REQUEST § R1, Survey 1 |
| 4 | Stream-Safe PWA Service Worker | Caching strategy for offline app shell while bypassing `/api/stream/*` and `/api/torrent/*` | M5 | ORIGINAL_REQUEST § R5, Survey 3 |
| 5 | System Media Integration | Complete `navigator.mediaSession` with `setPositionState` lock-screen scrubbing | M5 | ORIGINAL_REQUEST § R5, Survey 3 |
| 6 | Sub-second Cold-Start Audio | 4-tier caching pyramid (L1-L4) & predictive pre-warming with 256KB range chunks | M1 | ORIGINAL_REQUEST § R1, Survey 2 |
| 7 | Dedicated Artist View | Artist profile view displaying top tracks, full discography, albums, and related artists | M1 | ORIGINAL_REQUEST § R1, Survey 2 |
| 8 | Instant Artist Radio | Algorithmic Artist Radio (40% anchor, 35% related, 25% genre) with golden-ratio dispersion | M1 | ORIGINAL_REQUEST § R1, Survey 2 |
| 9 | Synthetic Artist Fallback | Deterministic fallback generator aggregating tracks for niche/archive artists | M1 | Survey 2 |
| 10 | Enhanced Queue Management | Priority "Play Next", "Add to End", drag/reorder, and track removal | M1 | ORIGINAL_REQUEST § R1, Survey 2 |
| 11 | Custom Playlists Management | Create, rename, reorder, and delete custom playlists in Library | M1 | ORIGINAL_REQUEST § R1, Survey 2 |
| 12 | Public Spotify Playlist Importer | Zero-auth embed scraper resolving Spotify playlist URLs with preview and one-click import | M1 | ORIGINAL_REQUEST § R1, Survey 2 |
| 13 | Cross-Provider Track Matching | Fuzzy Jaro-Winkler token & duration matcher resolving Spotify tracks to playable streams | M1 | Survey 2 |
| 14 | Structured On-Device Telemetry | IndexedDB `dotify_telemetry_db` logging plays, completion rates, skips, replays, sessions | M2 | ORIGINAL_REQUEST § R2, Survey 2 |
| 15 | Telemetry JSON Export & Import | Export full listening history to JSON file and restore for 100% on-device privacy | M2 | ORIGINAL_REQUEST § R2, Survey 2 |
| 16 | "Made For You" Recommendation Shelf | Algorithmic shelf combining high-affinity favorites and discovered tracks on Home view | M2 | ORIGINAL_REQUEST § R2, Survey 2 |
| 17 | "Discover Weekly" Shelf | MMR-diversified novelty scoring discovering unplayed tracks from affinity genres | M2 | ORIGINAL_REQUEST § R2, Survey 2 |
| 18 | "Daily Mix" Shelves | Graph modularity genre clustering yielding 2-3 cohesive daily playlists | M2 | ORIGINAL_REQUEST § R2, Survey 2 |
| 19 | "Heavy Rotation" Shelf | Half-life exponential recency decay ($\lambda = \ln(2)/5 \text{ days}$) of repeat listens | M2 | ORIGINAL_REQUEST § R2, Survey 2 |
| 20 | "Forgotten Favorites" Shelf | Recency gap filtering (high past affinity, no plays in 21+ days) | M2 | ORIGINAL_REQUEST § R2, Survey 2 |
| 21 | Real-Time Infinite Autoplay | Real-time queue exhaustion engine cueing 5 contextual recommended tracks continuously | M2 | ORIGINAL_REQUEST § R2, Survey 2 |
| 22 | WebSocket LAN Device Discovery | `/ws/connect` server endpoint and client transport with broadcast discovery | M3 | ORIGINAL_REQUEST § R3, Survey 3 |
| 23 | Same-Origin Tab Discovery | `BroadcastChannel('dotify_connect')` discovery for multi-tab/desktop local sync | M3 | Survey 3 |
| 24 | "Connect to a Device" Menu | UI dialog displaying discovered active hosts and remote controllers | M3 | ORIGINAL_REQUEST § R3, Survey 3 |
| 25 | Spotify Connect Remote Mode | Mobile phone remote controlling desktop player (play/pause, seek, volume, next/prev) | M3 | ORIGINAL_REQUEST § R3, Survey 3 |
| 26 | Seamless Playback Handoff | Millisecond-accurate timestamp preservation handoff between active devices | M3 | ORIGINAL_REQUEST § R3, Survey 3 |
| 27 | Google Cast Web SDK Integration | `cast_sender.js` framework loader and Cast Context initialization (app ID `CC1AD845`) | M4 | ORIGINAL_REQUEST § R4, Survey 3 |
| 28 | Cast Launcher UI Button | Cast icon in PlayerBar with state indicators (available, connecting, connected) | M4 | ORIGINAL_REQUEST § R4, Survey 3 |
| 29 | Synchronized Cast Media Controls | Bidirectional sync of volume, seek, play/pause, and metadata with Google Home/Chromecast | M4 | ORIGINAL_REQUEST § R4, Survey 3 |
| 30 | Tauri 2.0 Packaging Verification | Tauri capabilities, desktop packaging, and Android build configuration verification | M5 | ORIGINAL_REQUEST § R5, Survey 3 |
| 31 | Unit & Integration Test Suite | Automated Vitest test suite covering all modules and stores (`npm test`) | M6 / E2E | ORIGINAL_REQUEST AC, Survey 1 |
| 32 | Production Build Zero Errors | Clean production compilation with 0 TypeScript/bundling errors (`npm run build`) | M6 / E2E | ORIGINAL_REQUEST AC, Survey 1 |
| 33 | E2E Testing Suite (Tiers 1-4) | Opaque-box automated test suite verifying all user requirements and edge cases | M6 / E2E | Project Pattern |
| 34 | Adversarial Coverage Hardening (Tier 5) | White-box adversarial testing stress-testing edge cases and performance limits | M6 / Phase 2| Project Pattern |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Low-Latency Streaming & Queue / Playlist Management | Audio chunk cache (`audioCache.ts`), predictive pre-warming (<1s cold start), dedicated `ArtistView.tsx` with top tracks/discography/albums/related/artist radio, full queue management ("Play Next", "Add to End", reordering, removal), custom playlist CRUD (create, rename, reorder, delete), and public Spotify playlist link importer with preview & save. | none | **DONE** |
| M2 | Private Listening Profile & Recommendation Engine | On-device IndexedDB telemetry store (`telemetryDb.ts`), JSON export/import dataset, recommendation engine (`recommendationEngine.ts`) calculating 5 shelves ("Made For You", "Discover Weekly", "Daily Mix", "Heavy Rotation", "Forgotten Favorites"), and real-time Infinite Autoplay on queue end. | M1 | **DONE** |
| M3 | Cross-Device Remote Sync (Spotify Connect Protocol) | WebSocket `/ws/connect` server and client transport, local device discovery & "Connect to a Device" menu, remote controller mode (mobile controlling desktop), and millisecond-accurate playback handoff protocol. | M1 | PLANNED |
| M4 | Google Home & Smart Speaker Casting | Google Cast Web SDK integration, receiver media session management, Cast button in UI, and bidirectional media controls and metadata synchronization with Google Home / Nest Audio / Chromecast speakers. | M1 | PLANNED |
| M5 | Cross-Platform Packaging, Media Notifications & Polish | Production stream-safe service worker (`sw.js`), responsive mobile (<768px: bottom nav, mini-player, full sheet) vs desktop (>=768px: 3-column) UI polish, `navigator.mediaSession.setPositionState` lock-screen scrubber, Tauri 2.0 capabilities and packaging verification. | M1, M2, M3, M4 | PLANNED |
| M6 | 100% E2E Test Suite Validation & Adversarial Hardening | Phase 1: 100% pass of E2E opaque-box test suite (Tiers 1-4) published in `TEST_READY.md`; Phase 2: Adversarial coverage hardening (Tier 5) with Challengers & Forensic Auditor. | M1, M2, M3, M4, M5, TEST_READY.md | PLANNED |

---

## Interface Contracts

### 1. Audio Cache & Pre-Warming (`src/audio/audioCache.ts`) [IMPLEMENTED]
- Implements `AudioCacheService` interface with L1 memory, L2 CacheStorage range chunks, quota eviction, and prebuffer integration.

### 2. Artist Profile & Artist Radio (`src/types/artist.ts`, `artistService.ts`) [IMPLEMENTED]
- Full `ArtistProfile` schema, 4-tier fallback hierarchy, and golden-ratio Artist Radio generation.

### 3. Queue State & Transitions (`src/store/playerStore.ts`) [IMPLEMENTED]
- `playNext`, `addToEnd`, `reorderQueue`, non-destructive `clearQueue`.

### 4. Custom Playlists & Spotify Importer (`src/types/playlist.ts`, `spotifyImporter.ts`) [IMPLEMENTED]
- Custom playlist CRUD and zero-auth Spotify URL resolution.

### 5. Private Telemetry & IndexedDB Schema (`src/services/telemetryDb.ts`) [PLANNED M2]
```ts
export interface ListeningSessionRecord {
  sessionId: string;
  startTime: number;
  endTime?: number;
  deviceType: 'desktop' | 'mobile' | 'web';
  totalDurationMs: number;
}

export interface TrackPlayRecord {
  playId: string;
  sessionId: string;
  trackId: string;
  title: string;
  artist: string;
  genre?: string;
  source: TrackSource;
  startTime: number;
  durationPlayedMs: number;
  totalDurationMs: number;
  completionRate: number; // 0.0 to 1.0
  skipped: boolean;
  replayed: boolean;
}

export interface GenreAffinityRecord {
  genre: string;
  playCount: number;
  totalTimePlayedMs: number;
  affinityScore: number;
  lastUpdated: number;
}

export interface ExportableTelemetryDataset {
  schemaVersion: 1;
  exportedAt: number;
  sessions: ListeningSessionRecord[];
  plays: TrackPlayRecord[];
  genreAffinities: GenreAffinityRecord[];
}
```

### 6. Recommendation Engine Contract (`src/services/recommendationEngine.ts`) [PLANNED M2]
```ts
export interface RecommendationShelves {
  madeForYou: Track[];
  discoverWeekly: Track[];
  dailyMixes: { id: string; title: string; genre: string; tracks: Track[] }[];
  heavyRotation: Track[];
  forgottenFavorites: Track[];
}
```

### 7. Connect Protocol & Remote Control (`src/types/connect.ts`) [PLANNED M3]
```ts
export type DeviceRole = 'active_host' | 'remote_controller';

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType: 'desktop' | 'mobile' | 'tv' | 'cast';
  role: DeviceRole;
  isCurrentDevice: boolean;
  lastSeen: number;
}
```

---

## Code Layout
```
c:\Users\monty\Documents\AB\notify\
├── public/
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
├── server/
│   ├── index.js
│   ├── connectServer.js
│   ├── spotifyResolver.js
│   ├── trackResolver.js
│   ├── streamProxy.js
│   └── torrentEngine.js
├── src/
│   ├── audio/
│   │   ├── audioEngine.ts
│   │   ├── audioCache.ts
│   │   └── mediaSession.ts
│   ├── components/
│   │   ├── layout/
│   │   ├── player/
│   │   ├── views/
│   │   │   ├── HomeView.tsx
│   │   │   ├── ArtistView.tsx
│   │   │   ├── LibraryView.tsx
│   │   │   └── SearchView.tsx
│   │   ├── connect/
│   │   └── cast/
│   ├── services/
│   │   ├── telemetryDb.ts
│   │   ├── recommendationEngine.ts
│   │   ├── artistService.ts
│   │   ├── connectClient.ts
│   │   ├── castService.ts
│   │   └── spotifyImporter.ts
│   ├── store/
│   │   ├── playerStore.ts
│   │   ├── connectStore.ts
│   │   └── themeStore.ts
│   └── App.tsx
├── tests/
│   ├── unit/
│   └── e2e/
```
