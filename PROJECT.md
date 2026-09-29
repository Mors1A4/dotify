# Project: dotify

## Architecture
dotify is an ultra-snappy, lightweight, and super-customizable cross-platform (Android and Desktop) Spotify clone that streams music completely free using open/decentralized audio feeds (Audius, Internet Archive, Radio-Browser) and instant P2P torrent audio streaming with zero UI-induced latency.

### High-Level System Architecture
```
┌──────────────────────────────────────────────────────────────────────────┐
│                             BROWSER CLIENT                               │
│                                                                          │
│  ┌─────────────────────────┐           ┌──────────────────────────────┐  │
│  │   UI / Layout Shell     │           │    Decoupled Audio State     │  │
│  │  - Desktop 3-Column     │           │  - Zustand Store (Reactive)  │  │
│  │  - Mobile Bottom Nav    │           │  - Direct-DOM Ref Pipeline   │  │
│  │  - MiniPlayer & Sheet   │           │    (Seekbar & Canvas Visual) │  │
│  └───────────┬─────────────┘           └──────────────┬───────────────┘  │
│              │                                        │                  │
│              ▼                                        ▼                  │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                   Web Audio API DSP Cascade                        │  │
│  │  <audio> (crossOrigin) ──> Pre-Amp Gain ──> 10-Band BiquadFilters  │  │
│  │  ──> AnalyserNode (60 FPS Canvas) ──> AudioContext.destination     │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│              ▲                                        ▲                  │
│              │                                        │                  │
│  ┌───────────┴─────────────┐           ┌──────────────┴───────────────┐  │
│  │   navigator.mediaSession│           │     Theme & LocalStorage     │  │
│  │  - Lockscreen / Controls│           │  - 5 Presets + Custom Color  │  │
│  │  - Hardware Media Keys  │           │  - Liked / Playlists / Queue │  │
│  └─────────────────────────┘           └──────────────────────────────┘  │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ HTTP / WS Streams
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         LOCAL EXPRESS SERVER                             │
│  - Static Asset / PWA Serving                                            │
│  - Stream Proxy (/api/stream/proxy) for Non-CORS Icecast Radio Streams   │
│  - WebTorrent Engine (/api/torrent/stream) with HTTP 206 Partial Content  │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
      ┌──────────────┬───────────────┼───────────────┬─────────────────┐
      ▼              ▼               ▼               ▼                 ▼
 Audius API   Archive.org     Radio-Browser   WebRTC Trackers   BitTorrent Swarm
 (Trending/   (Live Concerts  (35,000+ Live   (OpenWebTorrent,  (DHT / TCP / UDP)
  Search)      & Records)      Stations)       WebTorrent.dev)
```

---

## Feature Inventory
Every feature identified during the Survey phase mapped to its assigned milestone:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Desktop 3-Column Layout | Spotify-style 3-column layout (collapsible sidebar, content feed, right drawer, persistent player bar) for >= 768px | M1 | ORIGINAL_REQUEST § R1, Survey 2 |
| 2 | Mobile & Android View | Mobile view (<768px) with bottom nav (48px tap targets), floating mini-player, and safe area insets | M1 | ORIGINAL_REQUEST § R1, Survey 2 |
| 3 | Tap-to-Expand Now-Playing Sheet | Fullscreen slide-up sheet on mobile with large artwork, scrubber, transport controls, and dismiss gesture | M1 | ORIGINAL_REQUEST § R1, Survey 2 |
| 4 | Base Scaffolding & PWA Shell | Vite + React + TypeScript + Tailwind configuration, PWA manifest, service worker app shell caching | M1 | Survey 2 & 3 |
| 5 | Express Backend Skeleton | Express server with CORS middleware and API route scaffolding | M1 | Survey 1 & 3 |
| 6 | Zero-Latency High-Frequency Seekbar | Direct DOM ref manipulation for seekbar scrubbing at 100ms without parent component re-renders | M2 | ORIGINAL_REQUEST § R1, Survey 2 |
| 7 | 60 FPS Canvas Audio Visualizer | Web Audio AnalyserNode connected to decoupled requestAnimationFrame canvas loop (frequency bars & waveform) | M2 | ORIGINAL_REQUEST § R1, Survey 2 & 3 |
| 8 | 10-Band Graphic Equalizer DSP | Web Audio cascade of 10 peaking BiquadFilterNodes (32Hz to 16kHz, Q=1.4142, +/-12dB) with de-clicking automation | M2 | ORIGINAL_REQUEST § R3, Survey 3 |
| 9 | Pre-Amp & Equalizer Presets | Pre-amp GainNode (-12dB to +12dB) and presets (Bass Boost, Vocal Clarity, Rock, Electronic, Flat, Custom) | M2 | ORIGINAL_REQUEST § R3, Survey 3 |
| 10 | Audius API Integration | Trending charts (genre & time filters), search, and direct MP3 audio stream resolution | M3 | ORIGINAL_REQUEST § R2, Survey 1 |
| 11 | Internet Archive Integration | Advanced search (mediatype:audio, live concerts, public domain), metadata extraction, and direct 206 streaming | M3 | ORIGINAL_REQUEST § R2, Survey 1 |
| 12 | Radio-Browser Integration | Live radio station discovery, top clicked stations, multi-criteria search, and continuous streaming | M3 | ORIGINAL_REQUEST § R2, Survey 1 |
| 13 | Express Stream Proxy | Backend stream proxy (`/api/stream/proxy`) providing CORS headers and HTTP range streaming for Icecast stations | M3 | Survey 1 & 3 |
| 14 | WebTorrent P2P Streaming Engine | Magnet link parsing & .torrent file upload, audio track inspection, sequential HTTP 206 streaming | M3 | ORIGINAL_REQUEST § R2, Survey 1 |
| 15 | Unified Track Model & Core Player | Normalized Track schema across all 4 sources, playback queue management, shuffle, repeat, autoplay | M3 | Survey 1 & 2 |
| 16 | Theme Engine (Presets & Live Picker) | CSS Custom Properties token switcher with 5 presets (Spotify OLED, Nord, Cyberpunk, Winamp, Rose Pine) & live color picker | M4 | ORIGINAL_REQUEST § R3, Survey 2 |
| 17 | LocalStorage Library Persistence | Persistent Liked Songs, cross-source Custom Playlists, Queue, History, and Audio Settings in `localStorage` | M4 | ORIGINAL_REQUEST § R4, Survey 2 |
| 18 | System Media Integration | Complete `navigator.mediaSession` integration with metadata, multi-size artwork, action handlers, and hardware media keys | M4 | ORIGINAL_REQUEST § R1, Survey 2 |
| 19 | Search & Discovery UI Feed | Rich search UI with source filter pills ('All', 'Audius', 'Archive', 'Radio', 'Torrents') and responsive grid | M4 | Survey 1 & 2 |
| 20 | E2E Testing Suite (Tiers 1-4) | Opaque-box automated test suite verifying playback, responsiveness, DSP, themes, and persistence | M5 / E2E Track | ORIGINAL_REQUEST AC, Survey 3 |
| 21 | Adversarial Coverage Hardening (Tier 5) | White-box adversarial testing stress-testing edge cases, error resilience, and performance limits | M5 (Phase 2) | Project Pattern |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Project Scaffolding & Responsive Layout Shell | Setup Vite/TS/Tailwind/PWA, Express backend skeleton, Desktop 3-column Spotify layout, Mobile bottom nav + mini-player + sheet shell, theme CSS tokens base | none | PLANNED |
| M2 | Audio Engine Core, 10-Band EQ DSP & 60 FPS Visualizer | Audio element singleton, 10-band peaking BiquadFilter cascade (Q=1.4142), Pre-amp gain, EQ presets, decoupled 60 FPS Canvas visualizer, zero-latency direct-DOM seekbar | M1 | PLANNED |
| M3 | Multi-Source Streaming Feeds & P2P Torrent Engine | Audius API, Internet Archive API, Radio-Browser API, Express CORS Stream Proxy, WebTorrent magnet/file inspection & HTTP 206 sequential streaming, unified Track queue | M1, M2 | PLANNED |
| M4 | Themes, Persistence, Library & MediaSession Integration | 5 Theme presets + live custom color picker, LocalStorage persistence (Liked, Playlists, Queue, History), MediaSession lock screen & hardware keys, Search/Filter UI | M2, M3 | PLANNED |
| M5 | E2E Test Suite Validation (Tiers 1-4) & Adversarial Hardening (Tier 5) | Phase 1: 100% pass of E2E opaque-box test suite published in TEST_READY.md; Phase 2: Adversarial coverage hardening | M1, M2, M3, M4, TEST_READY.md | PLANNED |

---

## Interface Contracts

### 1. Unified Track Interface (`src/types/track.ts`)
```ts
export type TrackSource = 'audius' | 'archive' | 'radio' | 'p2p';

export interface Track {
  id: string; // Globally unique: `audius:${id}` | `archive:${id}` | `radio:${stationuuid}` | `p2p:${infoHash}:${fileIndex}`
  source: TrackSource;
  title: string;
  artist: string;
  album?: string;
  duration: number; // In seconds. Live radio is Infinity or 0.
  streamUrl: string; // Direct audio URL or proxy URL (/api/stream/proxy?url=... or /api/torrent/stream?...)
  artworkUrl?: string; // HTTPS image URL or SVG data-URI
  sourceMetadata: {
    genre?: string;
    year?: string;
    bitrate?: number;
    format?: 'mp3' | 'aac' | 'flac' | 'ogg';
    license?: string;
    stationCountry?: string;
    stationCodec?: string;
    infoHash?: string;
    fileIndex?: number;
    fileName?: string;
    fileSize?: number;
  };
}
```

### 2. Audio DSP & Equalizer Contract (`src/dsp/types.ts`)
```ts
export interface EqualizerBandConfig {
  frequency: number; // [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
  type: 'peaking';
  Q: number; // 1.4142 (1-octave bandwidth)
  gain: number; // -12dB to +12dB
}

export type EqualizerPreset = 'flat' | 'bass-boost' | 'vocal' | 'rock' | 'electronic' | 'custom';

export interface EqualizerState {
  enabled: boolean;
  preset: EqualizerPreset;
  preAmp: number; // -12dB to +12dB
  bands: number[]; // 10 gain values in dB
}
```

### 3. Theme Contract (`src/types/theme.ts`)
```ts
export type ThemePresetId = 'spotify-oled' | 'nord-frost' | 'cyberpunk-neon' | 'retro-winamp' | 'rose-pine' | 'custom';

export interface ThemeColors {
  bgBase: string;
  bgSurface: string;
  bgElevated: string;
  bgHighlight: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  accentContent: string;
  border: string;
  playerBg: string;
  seekbarBg: string;
  seekbarBuffered: string;
  seekbarFill: string;
}
```

### 4. P2P Torrent Engine Contract (`server/torrentEngine.js` & `src/services/torrentApi.ts`)
```ts
export interface TorrentFileInfo {
  index: number;
  name: string;
  length: number; // Size in bytes
  isAudio: boolean;
  extension: string;
}

export interface TorrentMetadata {
  infoHash: string;
  name: string;
  files: TorrentFileInfo[];
  audioFiles: TorrentFileInfo[];
}

// Backend Stream Endpoint:
// GET /api/torrent/stream?torrent=<infoHashOrMagnet>&fileIndex=<index>
// Response: 206 Partial Content with byte-range piping
```

---

## Code Layout
```
c:\Users\monty\Documents\AB\notify\
├── public/
│   ├── favicon.svg
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
├── server/
│   ├── index.js             # Express server with CORS & routes
│   ├── torrentEngine.js     # WebTorrent sequential range streamer
│   └── streamProxy.js       # Icecast CORS bypass proxy
├── src/
│   ├── components/
│   │   ├── layout/          # DesktopLayout, MobileLayout, Sidebar, PlayerBar, RightDrawer
│   │   ├── player/          # Seekbar, TransportButtons, VolumeControl, NowPlayingSheet
│   │   ├── dsp/             # EqualizerDrawer, VisualizerCanvas
│   │   ├── views/           # HomeView, SearchView, LibraryView, TorrentView, PlaylistView
│   │   ├── common/          # TrackItem, TrackTable, ThemeModal, SourceBadge
│   │   └── ui/              # Button, Slider, Input, Modal
│   ├── dsp/
│   │   ├── AudioEngine.ts   # Web Audio singleton graph & node lifecycle
│   │   ├── Equalizer.ts     # 10 BiquadFilterNodes cascade & presets
│   │   └── Visualizer.ts    # Decoupled 60 FPS requestAnimationFrame canvas
│   ├── services/
│   │   ├── audius.ts        # Audius trending, search, streams
│   │   ├── archive.ts       # Internet Archive search, metadata, MP3s
│   │   ├── radio.ts         # Radio-Browser discovery, search, streams
│   │   ├── torrent.ts       # Magnet parsing, metadata, stream URL
│   │   └── mediaSession.ts  # navigator.mediaSession lifecycle & keys
│   ├── stores/
│   │   ├── playerStore.ts   # Active track, queue, playback state
│   │   ├── dspStore.ts      # EQ bands, pre-amp, visualizer mode
│   │   ├── themeStore.ts    # Active theme tokens, custom picker
│   │   └── libraryStore.ts  # Liked tracks, custom playlists, history
│   ├── utils/
│   │   ├── storage.ts       # Safe localStorage wrapper (dotify_v1_*)
│   │   ├── time.ts          # Format seconds to MM:SS
│   │   └── contrast.ts      # WCAG luminance calculation
│   ├── types/
│   │   ├── track.ts
│   │   ├── theme.ts
│   │   └── dsp.ts
│   ├── index.css            # Tailwind directives & CSS custom properties
│   ├── App.tsx
│   └── main.tsx
├── tests/
│   ├── unit/                # Vitest unit tests (DSP math, storage, stores)
│   └── e2e/                 # Playwright E2E tests (Desktop, Mobile, Streaming)
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```
