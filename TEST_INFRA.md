# TEST_INFRA: dotify Test Infrastructure & Methodology

## 1. Test Philosophy

dotify is tested according to a rigorous **opaque-box, requirement-driven** methodology derived directly from `ORIGINAL_REQUEST.md` and `PROJECT.md`. 

### Guiding Principles:
1. **Opaque-Box Verification**: Tests interact with dotify purely through standard observable interfaces: DOM nodes, keyboard/mouse/touch events, Web Audio API destination/node states, `navigator.mediaSession` handlers, `localStorage` contents, and HTTP responses. Tests do NOT couple to internal component implementation details or private variables.
2. **Deterministic & Isolated**: Audio tests must run deterministically in CI and headless environments. External network flakiness, rate limits (e.g. Audius API gateways, Internet Archive API, Radio-Browser servers), and BitTorrent DHT discovery latencies are decoupled via synthetic audio fixtures (1-second base64 silent WAV URI) and interceptable mock responses.
3. **Multi-Viewport & Responsive Testing**: Every view is tested across both desktop (>= 768px, e.g. 1280x800) and mobile (< 768px, e.g. 390x844 with touch emulation and 48px minimum touch targets).
4. **4-Tier Test Pyramid**:
   - **Tier 1: Feature Coverage** (>=5 tests per feature across all 19 inventory features).
   - **Tier 2: Boundary & Corner Cases** (>=5 tests per feature handling extreme inputs, empty states, zero peers, NaN/Infinity durations, offline network, and error recovery).
   - **Tier 3: Cross-Feature Combinations** (Pairwise interaction matrix: theme switching during playback, EQ tuning during seekbar scrubbing, heterogeneous playlist queues, mobile sheet gestures during background downloads).
   - **Tier 4: Real-World User Journeys** (Full end-to-end user workflows with persistence and multi-step state verification).

---

## 2. Feature Inventory & Coverage Targets

| Feature # | Feature Name | Tier 1 (Coverage) | Tier 2 (Boundaries) | Tier 3 (Pairwise) | Tier 4 (Journeys) | Target Total |
|---|---|---|---|---|---|---|
| F1 | Desktop 3-Column Layout | 5 | 5 | Pairwise | Journey 1, 2 | >=10 |
| F2 | Mobile & Android View | 5 | 5 | Pairwise | Journey 3 | >=10 |
| F3 | Tap-to-Expand Now-Playing Sheet | 5 | 5 | Pairwise | Journey 3 | >=10 |
| F4 | Base Scaffolding & PWA Shell | 5 | 5 | Pairwise | All | >=10 |
| F5 | Express Backend Skeleton | 5 | 5 | Pairwise | All | >=10 |
| F6 | Zero-Latency High-Frequency Seekbar | 5 | 5 | Pairwise | Journey 1, 4 | >=10 |
| F7 | 60 FPS Canvas Audio Visualizer | 5 | 5 | Pairwise | Journey 1 | >=10 |
| F8 | 10-Band Graphic Equalizer DSP | 5 | 5 | Pairwise | Journey 1, 4 | >=10 |
| F9 | Pre-Amp & Equalizer Presets | 5 | 5 | Pairwise | Journey 4 | >=10 |
| F10 | Audius API Integration | 5 | 5 | Pairwise | Journey 1, 5 | >=10 |
| F11 | Internet Archive Integration | 5 | 5 | Pairwise | Journey 2, 5 | >=10 |
| F12 | Radio-Browser Integration | 5 | 5 | Pairwise | Journey 5 | >=10 |
| F13 | Express Stream Proxy | 5 | 5 | Pairwise | Journey 5 | >=10 |
| F14 | WebTorrent P2P Streaming Engine | 5 | 5 | Pairwise | Journey 2, 5 | >=10 |
| F15 | Unified Track Model & Core Player | 5 | 5 | Pairwise | All Journeys | >=10 |
| F16 | Theme Engine (Presets & Live Picker) | 5 | 5 | Pairwise | Journey 1, 4 | >=10 |
| F17 | LocalStorage Library Persistence | 5 | 5 | Pairwise | Journey 1, 2, 4 | >=10 |
| F18 | System Media Integration (MediaSession) | 5 | 5 | Pairwise | Journey 3 | >=10 |
| F19 | Search & Discovery UI Feed | 5 | 5 | Pairwise | Journey 1, 2 | >=10 |
| **Total** | **19 Features** | **95+** | **95+** | **16+** | **5+** | **211+ tests** |

---

## 3. Test Architecture & Directory Layout

```
tests/
├── fixtures/
│   ├── mockAudio.ts          # Base64 1-sec silent WAV URI & audio element event mocks
│   ├── mockData.ts           # Mock tracks (Audius, Archive, Radio, P2P torrent)
│   └── testHelpers.ts        # Storage clearers, viewport setup, route interceptors
├── unit/                     # Vitest unit test suite
│   ├── dsp.spec.ts           # BiquadFilter cascade, Q=1.4142, +/-12dB gain math
│   ├── trackModel.spec.ts    # Unified Track normalization & ID scheme validation
│   ├── storage.spec.ts       # LocalStorage dotify_v1_* safe serialization
│   ├── stores.spec.ts        # PlayerStore, ThemeStore, LibraryStore, DspStore
│   └── contrast.spec.ts      # WCAG contrast calculation for custom theme colors
├── e2e/                      # Playwright E2E test suite
│   ├── tier1-features/
│   │   ├── layout-shell.spec.ts       # F1 (Desktop 3-Col), F2 (Mobile View), F3 (Sheet), F4 (PWA), F5 (Backend)
│   │   ├── dsp-engine.spec.ts         # F6 (Seekbar), F7 (Visualizer), F8 (10-Band EQ), F9 (Pre-Amp & Presets)
│   │   ├── feeds-streaming.spec.ts    # F10 (Audius), F11 (Archive), F12 (Radio), F13 (Proxy), F14 (Torrent), F15 (Player Core)
│   │   └── theme-persistence.spec.ts  # F16 (Themes), F17 (Persistence), F18 (MediaSession), F19 (Search UI)
│   ├── tier2-boundaries/
│   │   ├── layout-boundaries.spec.ts  # Responsive boundaries (767px vs 768px, safe-area, long titles)
│   │   ├── dsp-boundaries.spec.ts     # Extreme dB values, zero pre-amp, AudioContext suspension, rapid scrubbing
│   │   ├── stream-boundaries.spec.ts  # 0 peers torrent, 404 stream, offline network, NaN/Infinity radio duration
│   │   └── storage-boundaries.spec.ts # QuotaExceededError, corrupted localStorage JSON, special characters in theme
│   ├── tier3-combinations/
│   │   └── pairwise-interactions.spec.ts # Pairwise combination matrix (theme during playback, EQ while scrubbing, etc.)
│   └── tier4-journeys/
│       └── user-journeys.spec.ts      # 5 complete real-world user scenarios
├── playwright.config.ts      # Playwright browser runner configuration
└── vitest.config.ts          # Vitest unit runner configuration
```

---

## 4. Synthetic Audio & Deterministic Fixtures

To ensure zero dependencies on external media servers or live networks during test execution:
- **Base64 Silent WAV**: `data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA`
  A valid 1-second 8kHz 16-bit mono PCM WAV that Web Audio API and HTMLAudioElement can decode and play without network requests.
- **Route Mocking**: Playwright `page.route` intercepts:
  - `/api/audius/*` -> Returns synthetic trending and stream URLs with mock data.
  - `/api/archive/*` -> Returns synthetic public domain concert tracks with base64 audio.
  - `/api/radio/*` -> Returns synthetic radio station streams.
  - `/api/torrent/*` -> Returns simulated torrent metadata and HTTP 206 stream ranges.
  - `/api/stream/proxy*` -> Intercepts proxy streaming requests and returns synthetic audio headers.

---

## 5. Test Execution & Reporting

- **Unit & Contract Tests**: `npx vitest run`
- **E2E Browser Tests**: `npx playwright test`
- **Full Verification**: `npm test`
