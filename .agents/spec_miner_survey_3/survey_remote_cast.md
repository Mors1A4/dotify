# Technical Specification Mining Report: Cross-Device Sync, Smart Speaker Casting & Cross-Platform Packaging

**Specification Miner**: `spec_miner_survey_3`  
**Working Directory**: `c:\Users\monty\Documents\AB\notify\.agents\spec_miner_survey_3`  
**Date**: 2026-09-19  
**Target Requirements**: R3 (Cross-Device Sync & Remote Control), R4 (Google Home & Smart Speaker Casting), R5 (Cross-Platform Packaging & UI Polish)  
**Authoritative Reference**: `c:\Users\monty\Documents\AB\notify\ORIGINAL_REQUEST.md` (Follow-up dated 2026-09-19)

---

## 1. Executive Summary & Architecture Overview

The Follow-up Request (2026-09-19) elevates `dotify` from a standalone browser/desktop player into a distributed music playback ecosystem. This survey establishes the authoritative engineering specifications, protocol wire-formats, and interface contracts for:

1. **Requirement R3: Cross-Device Sync & Remote Control (Spotify Connect Protocol)**:
   - A peer-aware state synchronization protocol over WebSockets (`/ws/connect` and `/ws/jam`) with local multi-tab `BroadcastChannel` fallback.
   - Distinct **Active Host** (audio rendering node) versus **Remote Controller** (headless transport controller) operating modes.
   - Millisecond-accurate timestamp handoff algorithm eliminating audio stutter or position drift during device switching.
2. **Requirement R4: Google Home & Smart Speaker Casting**:
   - Google Cast Web SDK (`https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1`) integration.
   - Default Media Receiver (`CC1AD845`) initialization and `chrome.cast.media.MediaInfo` contract.
   - Bidirectional control pipeline: synchronizing hardware volume wheel / Google Assistant voice commands with the Dotify client state, while isolating the local Web Audio DSP.
3. **Requirement R5: Testable Cross-Platform Packaging & UI Polish**:
   - Tauri 2.0 configuration, capability-based security (`core:default`, `http:default`), and multi-platform packaging (Windows desktop binaries & Android APKs).
   - Progressive Web App (PWA) manifest and stream-safe service worker caching strategy avoiding buffering stalls on live Icecast streams and chunked HTTP 206 torrent audio.
   - Strict responsive viewport layout specs (Android Mobile `< 768px` vs. Spotify Desktop `\ge 768px`) with 48px touch targets.
   - Comprehensive `navigator.mediaSession` integration with dynamic `setPositionState` lock-screen scrubbers.
   - Zero-regression build & test pipeline guaranteeing 100% clean passes for `npm test` and `npm run build`.

### High-Level Distributed Topology

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                DOTIFY DISTRIBUTED ECOSYSTEM                            │
├──────────────────────────────────────┬─────────────────────────────────────────────────┤
│           LOCAL NETWORK LAN          │                 CLOUD / OPEN FEEDS              │
│                                      │                                                 │
│   ┌──────────────────────────────┐   │    ┌──────────────┐       ┌─────────────────┐   │
│   │     Desktop App (Tauri 2)    │   │    │  Audius CDN  │       │ Internet Archive│   │
│   │  [Active Playback Host]      │   │    └───────┬──────┘       └────────┬────────┘   │
│   │  - AudioContext DSP Engine   │   │            │                       │            │
│   │  - Local Device Registry     │   │            ▼                       ▼            │
│   └──────────────▲───────────────┘   │    ┌────────────────────────────────────────┐   │
│                  │                   │    │    Direct HTTPS Audio Range Streams    │   │
│         WebSocket / Connect          │    └───────────────────┬────────────────────┘   │
│                  │                   │                        │                        │
│   ┌──────────────▼───────────────┐   │                        │                        │
│   │    Mobile PWA (Android/iOS)  │   │                        │                        │
│   │  [Remote Controller Mode]    │   │                        │                        │
│   │  - Zero Local Audio Decode   │   │                        │                        │
│   │  - Full Remote Transport UI  │   │                        │                        │
│   └──────────────┬───────────────┘   │                        │                        │
│                  │ Google Cast SDK   │                        │                        │
│                  ▼                   │                        ▼                        │
│   ┌──────────────────────────────┐   │             ┌──────────────────────┐            │
│   │ Google Home / Nest Speaker   │◄──┼─────────────┤ Express Stream Proxy │            │
│   │  - Cast Default Receiver     │   │  Audio URL  │ (LAN IP:3001) CORS   │            │
│   │  - Autonomous HTTP Streaming │   │             └──────────────────────┘            │
│   └──────────────────────────────┘   │                                                 │
└──────────────────────────────────────┴─────────────────────────────────────────────────┘
```

---

## 2. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | R3: Connect | Local Device Discovery | Automatic discovery and listing of active dotify client instances on the local network or browser context | Client metadata (UUID, name, deviceType, capabilities) | `DEVICE_LIST` array with status and active host indicator | Graceful degradation to standalone local mode if WS unavailable | ORIGINAL_REQUEST § R3, `server/jamServer.js` |
| 2 | R3: Connect | Multi-Transport Fallback | Dual communication layer using WebSocket `/ws/connect` for LAN and `BroadcastChannel('dotify_connect')` for same-origin tabs | Outgoing protocol messages | Low-latency packet transmission across network or inter-tab IPC | Falls back to BroadcastChannel if offline or WS disconnects | Web Standards, RFC 6455 |
| 3 | R3: Connect | Remote Controller Mode | Headless playback control where mobile/tablet acts as a remote for a desktop or TV without playing audio locally | User transport actions (play, pause, seek, volume, next, prev) | `COMMAND_*` payloads dispatched to the active playback device | Remote controls disabled or queued if target host disconnects | ORIGINAL_REQUEST § R3 |
| 4 | R3: Connect | Seamless Playback Handoff | Instant transfer of playback session between devices with millisecond-accurate timestamp transfer | Target device ID, current track, extrapolated position ms, volume, queue | Seamless continuation of audio stream on target device; source device stops | Retries once; if target fails to acknowledge, source resumes local playback | ORIGINAL_REQUEST § R3 |
| 5 | R3: Connect | Devices Menu UI | Dedicated "Connect to a Device" popover/modal displaying current device and available LAN targets | User tap on Connect icon in PlayerBar or Mobile Sheet | Visual device list with green active badges and device type icons | Displays "No other devices found on local network" | ORIGINAL_REQUEST § R3, Spotify UI Pattern |
| 6 | R4: Casting | Google Cast SDK Bootstrap | Dynamic loader and availability check for Google Cast Web SDK Framework | Script load event or `window.__onGCastApiAvailable` callback | Initialized `cast.framework.CastContext` instance | Silently hides Cast launcher button if browser lacks Cast API | ORIGINAL_REQUEST § R4, Google Cast Docs |
| 7 | R4: Casting | Receiver Session Negotiation | Initialization of Cast session using Default Media Receiver (`CC1AD845`) | User selection of Cast device in Cast dialog | Active `CastSession` connection to smart speaker | Emits Cast error code (CANCEL, TIMEOUT, RECEIVER_UNAVAILABLE) | Google Cast Web SDK Specification |
| 8 | R4: Casting | Direct Media Stream Casting | Passing direct playable audio URLs and metadata to the remote smart speaker | Track `streamUrl`, title, artist, artwork URL | Remote speaker fetches and decodes stream over Wi-Fi | If stream is non-CORS or local-only, routes via Express LAN proxy | ORIGINAL_REQUEST § R4 |
| 9 | R4: Casting | Bidirectional Playback Sync | Synchronizing play/pause, seek position, and volume between smart speaker and local Dotify UI | Remote player events (`IS_PAUSED_CHANGED`, `CURRENT_TIME_CHANGED`, etc.) | Dotify seekbar, play button, and volume slider mirror speaker state | Local timeout reconciliation if speaker reports delayed state | ORIGINAL_REQUEST § R4 |
| 10 | R4: Casting | Local Audio Engine Muting | Automatically muting/pausing local `HTMLAudioElement` while casting to prevent echo | Cast session `SESSION_START` event | Local audio element paused; position timer driven by Cast RemotePlayer | Local playback immediately restored at current timestamp upon disconnect | Web Audio / Cast Architecture |
| 11 | R5: Packaging | Tauri 2.0 Desktop Bundle | Tauri 2.0 configuration for bundling high-performance desktop executables on Windows/macOS/Linux | `src-tauri/tauri.conf.json`, Cargo manifest, Vite build dist | Native desktop binary (.exe / .msi on Windows) | Fails build if capabilities or permissions violate schema | ORIGINAL_REQUEST § R5, `src-tauri/` |
| 12 | R5: Packaging | Tauri Capabilities Security | Fine-grained ACL permissions configuration using Tauri 2.0 capability definitions | `src-tauri/capabilities/default.json` | Scoped platform API access (`core:default`, `http:default`) | Rejects unpermitted system calls at runtime | Tauri 2.0 Architecture |
| 13 | R5: Packaging | PWA Manifest & App Shell | Installable Progressive Web App configuration for Android and Desktop Chrome | `public/manifest.json`, high-res SVG/PNG icons | Standalone install prompt and full-screen OS integration | Browser falls back to standard tab mode if manifest invalid | ORIGINAL_REQUEST § R1, § R5 |
| 14 | R5: Packaging | Stream-Safe Service Worker | Service worker caching app shell and UI assets while explicitly passing through live audio streams | Cache-First for static assets, Network-Only / Bypass for `/api/stream/*` | Instant offline app shell boot without audio stream buffering locks | Prevents corrupted range requests on chunked torrent / Icecast audio | Service Worker API, W3C |
| 15 | R5: UI Polish | Responsive Breakpoint Engine | Dynamic adaptation between Android Mobile (<768px) and Spotify 3-Column Desktop (>=768px) | Window viewport resize / matchMedia `(min-width: 768px)` | Switches between BottomNav/MiniPlayer and 3-Column layout | Zero layout shift or component unmounting during breakpoint change | ORIGINAL_REQUEST § R1, § R5 |
| 16 | R5: UI Polish | Touch Target Compliance | Ensuring all interactive elements on mobile view meet accessibility standards (minimum 48x48px) | Touch event handlers, padding, and CSS min-dimensions | Effortless single-thumb tap interaction on Android screens | Prevents accidental mis-taps on dense transport controls | WCAG 2.5.5, Android Material Guidelines |
| 17 | R5: UI Polish | Full-Screen Now-Playing Sheet | Mobile slide-up bottom sheet with large cover art, scrubbing seekbar, and visualizer toggle | Tap on MobileMiniPlayer or upward swipe | Fullscreen animated modal with smooth dismiss gesture | Clean dismiss to mini-player without halting active playback | ORIGINAL_REQUEST § R1, § R5 |
| 18 | R5: Media | System MediaSession Controls | Complete integration with OS lock screen, notification drawer, and hardware media keys | Current track metadata, artwork array, action handlers | Native OS playback widget with lock screen controls | Gracefully handled if browser/OS does not support MediaSession | ORIGINAL_REQUEST § R1, § R5, `src/audio/mediaSession.ts` |
| 19 | R5: Media | Lock-Screen Position State | Dynamic position state updates via `navigator.mediaSession.setPositionState` | Duration, playback rate (1.0), and current audio position seconds | Interactive lock-screen timeline scrubber on Android & desktop | Clamps position between 0 and duration; ignores Infinity for live radio | W3C Media Session API Spec |
| 20 | R5: Quality | Clean Build & Test Pipeline | Strict automated verification pipeline guaranteeing zero TypeScript errors and 100% test pass | `npm test` (Vitest), `npm run build` (tsc + vite build) | Exit code 0, bundled production assets in `dist/` | Build aborts with nonzero code on type errors or failed assertions | ORIGINAL_REQUEST AC |

---

## 3. Edge Cases

| # | Feature | Input | Observed / Specified Behavior |
|---|---------|-------|-------------------------------|
| 1 | Connect Protocol | Two devices claim to be "Active Host" simultaneously | Split-brain conflict: the device with the most recent `STATE_BROADCAST` timestamp (or explicit user command) wins; the superseded device automatically steps down to Remote Controller mode. |
| 2 | Connect Protocol | Network disconnects while mobile is in Remote Controller mode | Mobile UI displays "Reconnecting to desktop..." toast. Remote controls are disabled. Local audio remains paused to prevent unexpected sound blare. Once reconnected, state is re-fetched. |
| 3 | Connect Handoff | Target device is offline or unreachable during handoff | Source device waits 1500ms for `HANDOFF_ACK`. If timeout expires without ACK, source device aborts handoff, resumes local playback at exact timestamp, and alerts user: "Failed to connect to target device". |
| 4 | Connect Handoff | Handing off a live Icecast radio station with `duration = Infinity` | `positionMs` is passed as 0 or current session duration; target device immediately connects to live stream proxy without seeking. |
| 5 | Google Cast | Audio stream is hosted on local torrent engine (`http://localhost:3001/api/...`) | Chromecast cannot resolve `localhost` (it refers to the speaker itself). The app resolves the stream URL to the host's actual local LAN IP (e.g. `http://192.168.1.45:3001/...`) before dispatching `MediaInfo`. |
| 6 | Google Cast | User triggers "Hey Google, pause" on Google Home speaker | The speaker emits `IS_PAUSED_CHANGED` to `RemotePlayerController`. Dotify detects remote pause, updates local UI play/pause icon to "Play", and updates `playerStore.isPlaying = false`. |
| 7 | Google Cast | Cast session is disconnected while audio is playing | Handover to local player: local `<audio>` engine un-mutes, loads the same track, seeks to `remotePlayer.currentTime`, and seamlessly resumes local playback. |
| 8 | Google Cast | Cast SDK fails to load (e.g., Firefox, Safari, or adblocker blocking `gstatic.com`) | `window.__onGCastApiAvailable` is never called or called with `false`. The Cast button remains hidden or disabled with a tooltip "Casting requires a Chromium browser on Wi-Fi". No console errors thrown. |
| 9 | MediaSession | Track duration is `Infinity` (e.g. 24/7 live Internet radio station) | `navigator.mediaSession.setPositionState` is omitted or called with `{ duration: 0, position: 0 }` to prevent browser throwing `TypeError: Failed to execute 'setPositionState' on 'MediaSession': duration is non-finite`. |
| 10 | MediaSession | High-frequency seek scrubbing while lock-screen controls active | Position state update is debounced (max once every 500ms) to prevent overwhelming the OS media daemon with IPC messages while user drags the slider. |
| 11 | Service Worker | Browser requests HTTP 206 partial content byte-range for audio file | Service worker explicitly passes through range requests with `event.respondWith(fetch(event.request))` without intercepting or attempting to put partial 206 responses into CacheStorage (which throws DOMException). |
| 12 | Responsive Layout | User rotates tablet across 768px boundary (e.g. 767px portrait to 768px landscape) | Layout dynamically re-renders without audio reload: bottom nav hides, sidebar appears, mini-player promotes to bottom bar, and active playback context is preserved seamlessly. |
| 13 | Tauri Packaging | Native desktop app runs without internet connection | Offline app shell launches instantly from local bundle; cached liked songs or local files remain accessible; network feeds show informative offline indicators. |

---

## 4. Requirement R3: Cross-Device Sync & Remote Control (Spotify Connect Protocol)

### 4.1 Architecture & Network Topology

The Dotify Connect protocol implements a decentralized, local-network control protocol modeled after Spotify Connect. Any running Dotify instance (Desktop app, Android PWA, web tab) can operate in one of two distinct roles:

1. **Active Playback Host**:
   - The device actively running the Web Audio API graph and decoding PCM audio to physical speakers.
   - Authoritative source of playback truth (`currentTrack`, `playbackPositionMs`, `volume`, `queue`).
   - Periodically broadcasts heartbeats and state snapshots (`STATE_BROADCAST`).
2. **Remote Controller**:
   - Audio decoding is dormant (no sound emitted).
   - Mirrors the state of the active host in real time (track art, title, seek position, volume).
   - Translates local user UI actions (play, pause, scrub seekbar, next/previous, queue addition) into `COMMAND_*` messages sent across the wire to the active host.

#### Dual-Transport Communication Architecture

```
                               ┌───────────────────────────┐
                               │     Dotify Client A       │
                               │   (e.g., Desktop App)     │
                               └─────────────┬─────────────┘
                                             │
                      ┌──────────────────────┴──────────────────────┐
                      │                                             │
             Same-Origin / Local                           Local Network (LAN)
                      │                                             │
                      ▼                                             ▼
          ┌───────────────────────┐                    ┌─────────────────────────┐
          │   BroadcastChannel    │                    │     WebSocket Server    │
          │  ('dotify_connect')   │                    │       ('/ws/connect')   │
          └───────────┬───────────┘                    └────────────┬────────────┘
                      │                                             │
                      └──────────────────────┬──────────────────────┘
                                             │
                               ┌─────────────▼─────────────┐
                               │     Dotify Client B       │
                               │    (e.g., Mobile PWA)     │
                               └───────────────────────────┘
```

- **Transport 1: Local Network WebSockets (`ws://<host>:3001/ws/connect`)**:
  - Connects multiple physical devices on the same Wi-Fi/Ethernet network.
  - The Express backend operates a lightweight WebSocket connection hub that maintains an in-memory registry of active devices, handles heartbeats, and routes command packets.
- **Transport 2: BroadcastChannel (`dotify_connect`)**:
  - For multiple browser windows or tabs running on the same machine/browser profile.
  - Zero network overhead, zero latency, works even when completely offline without an active backend WebSocket.

---

### 4.2 Protocol Wire Schemas & Data Contracts

All messages exchanged over WebSocket or BroadcastChannel follow a strictly typed envelope:

```typescript
export type ConnectDeviceType = 'computer' | 'smartphone' | 'tablet' | 'smart_speaker' | 'tv' | 'cast_receiver';

export interface DeviceInfo {
  id: string;                      // Persistent UUID v4 stored in localStorage
  name: string;                    // Human-readable (e.g. "Monty's Desktop", "Pixel 8 Pro")
  type: ConnectDeviceType;
  isActiveHost: boolean;           // True if this device is rendering audio
  isLocal: boolean;                // Computed client-side (true if matches self)
  volume: number;                  // Current volume (0.0 - 1.0)
  lastSeen: number;                // Timestamp (ms) for liveness detection
  capabilities: {
    canPlayAudio: boolean;
    supportsVolume: boolean;
    supportsHandoff: boolean;
  };
}

export type ConnectMessageType =
  | 'DEVICE_HELLO'                 // Sent on connection to announce presence
  | 'DEVICE_GOODBYE'               // Sent on clean disconnect / window unload
  | 'DEVICE_HEARTBEAT'             // Liveness ping every 15s
  | 'DEVICE_LIST'                  // Server broadcast of all active devices
  | 'STATE_BROADCAST'              // Active host broadcast of current playback state
  | 'COMMAND_PLAY'                 // Remote -> Host: Resume playback
  | 'COMMAND_PAUSE'                // Remote -> Host: Pause playback
  | 'COMMAND_SEEK'                 // Remote -> Host: Seek to position in milliseconds
  | 'COMMAND_VOLUME'               // Remote -> Host: Set volume (0.0 - 1.0)
  | 'COMMAND_NEXT'                 // Remote -> Host: Advance to next track
  | 'COMMAND_PREV'                 // Remote -> Host: Return to previous track
  | 'COMMAND_ADD_QUEUE'            // Remote -> Host: Insert track into queue
  | 'COMMAND_REMOVE_QUEUE'         // Remote -> Host: Remove track at index
  | 'COMMAND_HANDOFF'              // Request to transfer active host role
  | 'HANDOFF_ACK';                 // Confirmation of successful handover

export interface ConnectEnvelope<T = any> {
  type: ConnectMessageType;
  senderId: string;                // Originating device ID
  targetId?: string;               // Target device ID (or omitted for broadcast)
  timestamp: number;               // Epoch millisecond timestamp
  payload: T;
}

export interface StateBroadcastPayload {
  track: Track | null;
  isPlaying: boolean;
  positionMs: number;              // Sampled audio playback position in ms
  durationMs: number;              // Total duration in ms (or 0 / Infinity for live radio)
  volume: number;                  // 0.0 to 1.0
  queue: Track[];
  repeatMode: 'off' | 'all' | 'one';
  shuffle: boolean;
  timestamp: number;               // Epoch ms when positionMs was sampled
}

export interface HandoffPayload {
  track: Track;
  positionMs: number;              // Exact position to resume from
  isPlaying: boolean;
  queue: Track[];
  volume: number;
}
```

---

### 4.3 Millisecond-Accurate Seamless Handoff Protocol

When transferring playback from Device A (e.g. Desktop) to Device B (e.g. Phone), playback must transition without audible repetition or skipping.

#### Timestamp Extrapolation Formula

Audio continuously progresses between state broadcast intervals. When a handoff is triggered, the precise position $P_{\text{target}}$ at execution instant $T_{\text{now}}$ is derived via:

$$P_{\text{target}} = P_{\text{sample}} + \left( \text{isPlaying} \times (T_{\text{now}} - T_{\text{sample}}) \right)$$

Where:
- $P_{\text{sample}}$: The last recorded playback position in milliseconds.
- $T_{\text{sample}}$: The exact epoch millisecond timestamp when $P_{\text{sample}}$ was recorded.
- $T_{\text{now}}$: `Date.now()`.
- $\text{isPlaying}$: 1 if audio was running, 0 if paused.

#### Handshake Sequence Diagram

```
Device A (Active Host)              Server / WS Hub                  Device B (Target)
       │                                   │                                 │
       │                                   │  1. User selects "Play on Device B"
       │                                   │  ───────────────────────────────►
       │                                   │                                 │
       │                                   │  2. COMMAND_HANDOFF             │
       │◄──────────────────────────────────┼─────────────────────────────────│
       │  { targetId: B, track,            │    (Routed via WS / BC)         │
       │    positionMs, queue, isPlaying } │                                 │
       │                                   │                                 │
       │ 3. Freeze & Pause Local Audio     │                                 │
       │ 4. Emit HANDOFF_TRANSFER          │                                 │
       │──────────────────────────────────►│────────────────────────────────►│
       │                                   │                                 │
       │                                   │ 5. Initialize Engine with Track │
       │                                   │ 6. Seek to positionMs           │
       │                                   │ 7. Begin Audio Output           │
       │                                   │ 8. HANDOFF_ACK (success: true)  │
       │◄──────────────────────────────────┼─────────────────────────────────│
       │                                   │                                 │
       │ 9. Transition to REMOTE MODE      │ 10. Assume ACTIVE HOST role     │
       │    (Audio muted locally)          │     (Emit STATE_BROADCAST)      │
       ▼                                   ▼                                 ▼
```

---

### 4.4 Remote Controller UI & State Store

#### Devices Menu UI Contract
- Located in:
  - **Desktop**: Icon in PlayerBar next to visualizer/volume (`<Laptop2 size={18} />`).
  - **Mobile**: Icon on the Now-Playing Sheet and Mini-Player (`<Smartphone size={18} />`).
- **Visual Presentation**:
  - Header: "Connect to a device".
  - Current Device section: Displays device name with green pulsing indicator and subtitle "This device".
  - Available Devices list:
    - Device icon (Computer, Phone, Speaker, Cast).
    - Device name and platform.
    - Status: "Dotify Connect", "Playing", or "Idle".
  - One-tap selection triggers immediate playback handoff.

#### "Listening On" Banner
- When in Remote Controller Mode, the bottom bar and sheet display a prominent Spotify-style green banner:
  - `Listening on Monty's Desktop` with an animated sound wave icon.
  - Tap opens the Devices Menu to reclaim playback to "This Device".

---

## 5. Requirement R4: Google Home & Smart Speaker Casting

### 5.1 Google Cast Web SDK Architecture

Google Cast Web SDK operates as a sender application loaded in Chromium browsers (Chrome, Edge, Opera, Android Chrome).

#### SDK Loader Specification

The SDK must be included in `index.html` or dynamically injected via script tag:

```html
<script src="https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1"></script>
```

The sender framework invokes a global bootstrap hook as soon as the library evaluates:

```typescript
declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: any;
    chrome?: any;
  }
}
```

---

### 5.2 Cast Context & Receiver App Specification

#### Receiver Application ID
- **Default Media Receiver ID**: `CC1AD845` (constant `chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID`).
  - Supports: MP3, AAC, OGG, FLAC streaming over HTTP/HTTPS.
  - Native display: Artwork thumbnail, title, artist, album name, and progress bar on Chromecast with Google TV / Nest Hub smart displays.
  - No developer registration fee or hosting required.

#### Initialization Contract

```typescript
export function initializeGoogleCast(onStateChange: (isConnected: boolean) => void) {
  window.__onGCastApiAvailable = (isAvailable: boolean) => {
    if (!isAvailable) return;

    const castContext = cast.framework.CastContext.getInstance();
    castContext.setOptions({
      receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    });

    const remotePlayer = new cast.framework.RemotePlayer();
    const remotePlayerController = new cast.framework.RemotePlayerController(remotePlayer);

    remotePlayerController.addEventListener(
      cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
      () => {
        onStateChange(remotePlayer.isConnected);
      }
    );

    return { remotePlayer, remotePlayerController };
  };
}
```

---

### 5.3 Media Session Loading & Stream CORS Management

When a track starts casting:
1. Construct `chrome.cast.media.MediaInfo`:
   ```typescript
   const mediaInfo = new chrome.cast.media.MediaInfo(playableUrl, 'audio/mp3');
   mediaInfo.streamType = isLive
     ? chrome.cast.media.StreamType.LIVE
     : chrome.cast.media.StreamType.BUFFERED;

   const metadata = new chrome.cast.media.MusicTrackMediaMetadata();
   metadata.title = track.title;
   metadata.artist = track.artist;
   metadata.albumName = track.album || 'Dotify';
   if (track.artworkUrl) {
     metadata.images = [{ url: track.artworkUrl }];
   }
   mediaInfo.metadata = metadata;
   ```
2. **CORS & LAN URL Resolution Rule**:
   - Google Home speakers make their own independent HTTP GET requests directly to the media URL over Wi-Fi.
   - If `streamUrl` points to `http://localhost:3001/...`, the speaker cannot resolve it.
   - **Resolution Policy**:
     1. If track is an external HTTPS stream (Audius / Archive / Radio): Send direct public URL.
     2. If track is routed via local stream proxy: Resolve `localhost` to host's LAN IPv4 address (e.g. `http://192.168.1.100:3001/api/stream/proxy?url=...`).

---

### 5.4 Bidirectional Control & Event Synchronization

```
Local Dotify UI                       Google Cast SDK                   Google Home Speaker
      │                                      │                                  │
      │ 1. User clicks Play/Pause            │                                  │
      │─────────────────────────────────────►│  remotePlayerController          │
      │                                      │  .playOrPause()                  │
      │                                      │─────────────────────────────────►│
      │                                      │                                  │
      │                                      │  2. Hardware Volume Turned       │
      │                                      │◄─────────────────────────────────│
      │                                      │     VOLUME_LEVEL_CHANGED         │
      │ 3. Update Volume Slider (0..1)       │                                  │
      │◄─────────────────────────────────────│                                  │
      │                                      │  3. "Hey Google, seek 30 sec"    │
      │                                      │◄─────────────────────────────────│
      │                                      │     CURRENT_TIME_CHANGED         │
      │ 4. Reposition Seekbar                │                                  │
      │◄─────────────────────────────────────│                                  │
```

- **Speaker Event Mapping**:
  - `IS_PAUSED_CHANGED` $\to$ Syncs `usePlayerStore.getState().isPlaying`.
  - `CURRENT_TIME_CHANGED` $\to$ Syncs seekbar DOM and time indicators.
  - `VOLUME_LEVEL_CHANGED` $\to$ Syncs `usePlayerStore.getState().volume`.
  - `IS_MUTED_CHANGED` $\to$ Syncs mute toggle icon.
- **AudioEngine Decoupling**:
  - Local `HTMLAudioElement` is paused immediately upon Cast connect to avoid dual playback echo.
  - Web Audio DSP Equalizer and Visualizer nodes remain suspended or fed by silent dummy node.

---

## 6. Requirement R5: Testable Cross-Platform Packaging & UI Polish

### 6.1 Tauri 2.0 Desktop & Android Packaging

Dotify uses Tauri 2.0 for producing secure, lightweight native desktop binaries and Android packages.

#### Tauri Configuration (`src-tauri/tauri.conf.json`) Verified Structure:
- **Build settings**:
  - `frontendDist: "../dist"`
  - `devUrl: "http://localhost:5173"`
  - `beforeDevCommand: "npm run dev"`
  - `beforeBuildCommand: "npm run build"`
- **Window Specs**:
  - Minimum width: 800px, height: 600px, resizable: true.
  - Window frame with custom titlebar support.
- **Security & Capabilities (`src-tauri/capabilities/default.json`)**:
  - Employs Tauri 2.0 fine-grained permission schema:
    ```json
    {
      "$schema": "../gen/schemas/desktop-schema.json",
      "identifier": "default",
      "description": "Enables default capabilities and HTTP plugin access",
      "windows": ["main"],
      "permissions": [
        "core:default",
        "http:default"
      ]
    }
    ```
- **Desktop Build Targets**:
  - Windows: MSI installer and standalone NSIS executable (`npm run tauri build`).
  - macOS: DMG and universal `.app`.
  - Linux: `.deb` and `.AppImage`.

---

### 6.2 Progressive Web App (PWA) Manifest & Service Worker Strategy

#### PWA Manifest (`public/manifest.json`)
```json
{
  "name": "dotify",
  "short_name": "dotify",
  "description": "Ultra-snappy free music streaming with open feeds and P2P audio torrents",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#121212",
  "theme_color": "#121212",
  "orientation": "any",
  "icons": [
    {
      "src": "/favicon.svg",
      "sizes": "192x192 512x512",
      "type": "image/svg+xml",
      "purpose": "any maskable"
    }
  ],
  "shortcuts": [
    { "name": "Search", "url": "/?view=search" },
    { "name": "Liked Songs", "url": "/?view=library" },
    { "name": "Live Radio", "url": "/?view=radio" }
  ]
}
```

#### Stream-Safe Service Worker (`public/sw.js`) Strategy

Audio streams must **never** be cached indiscriminately by Service Worker `CacheStorage`, because:
1. Live radio streams are infinite — attempting to cache them exhausts disk quota or hangs the fetch handler.
2. Torrent chunk requests and range requests (`Range: bytes=X-Y`) return `206 Partial Content`, which `Cache.put()` rejects.

```javascript
const CACHE_NAME = 'dotify-shell-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Bypass audio streams, proxies, torrents, and WebSocket upgrades
  if (
    url.pathname.startsWith('/api/stream') ||
    url.pathname.startsWith('/api/torrent') ||
    url.pathname.startsWith('/ws') ||
    event.request.headers.has('range')
  ) {
    return; // Pass through directly to network
  }

  // 2. Static shell assets: Cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((res) => {
        if (res.ok && event.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
```

---

### 6.3 Responsive Layout Blueprint: Mobile vs. Desktop

| Layout Component | Android / Mobile (< 768px) | Spotify Desktop (\ge 768px) |
|---|---|---|
| **Primary Structure** | Single-column content stack with fixed overlays | 3-column CSS Grid (`[Sidebar] [Main Content] [Drawer]`) |
| **Navigation** | Fixed Bottom Navigation Bar (`h-16`, 5 items, touch targets $\ge 48\text{px}$) | Collapsible Left Sidebar (`w-60` expanded, `w-20` collapsed) |
| **Player Interface** | Floating Mini-Player (`h-14`) above nav bar, tap expands full-screen sheet | Persistent bottom PlayerBar (`h-20`, 3-column grid) |
| **Now-Playing View** | Slide-up modal sheet (`fixed inset-0 z-50`, touch drag down to dismiss) | Central feed view or Right Drawer tab |
| **Secondary Drawers** | Modal tab overlay inside Now-Playing Sheet | Right Drawer (`w-72` for Queue and 10-Band Equalizer) |
| **Touch Ergonomics** | Safe-area padding (`safe-pb`), minimum 48x48px bounding boxes | Hover-reactive buttons, tooltips, keyboard shortcuts |

---

### 6.4 Full System Media Integration (`navigator.mediaSession`)

To provide lock-screen media controls, smart watch playback widgets, and hardware media key integration:

#### Metadata & Multi-Resolution Artwork Schema
```typescript
navigator.mediaSession.metadata = new MediaMetadata({
  title: track.title,
  artist: track.artist,
  album: track.album || 'Dotify',
  artwork: [
    { src: track.artworkUrl || defaultArt, sizes: '96x96',   type: 'image/jpeg' },
    { src: track.artworkUrl || defaultArt, sizes: '128x128', type: 'image/jpeg' },
    { src: track.artworkUrl || defaultArt, sizes: '192x192', type: 'image/jpeg' },
    { src: track.artworkUrl || defaultArt, sizes: '256x256', type: 'image/jpeg' },
    { src: track.artworkUrl || defaultArt, sizes: '384x384', type: 'image/jpeg' },
    { src: track.artworkUrl || defaultArt, sizes: '512x512', type: 'image/jpeg' }
  ]
});
```

#### Action Handlers
- `play` $\to$ `usePlayerStore.getState().togglePlay()`
- `pause` $\to$ `usePlayerStore.getState().togglePlay()`
- `previoustrack` $\to$ `usePlayerStore.getState().previousTrack()`
- `nexttrack` $\to$ `usePlayerStore.getState().nextTrack()`
- `seekto` $\to$ `(details) => details.seekTime && usePlayerStore.getState().seekTo(details.seekTime)`
- `seekbackward` $\to$ `(details) => usePlayerStore.getState().seekTo(Math.max(0, current - (details.seekOffset || 10)))`
- `seekforward` $\to$ `(details) => usePlayerStore.getState().seekTo(Math.min(duration, current + (details.seekOffset || 10)))`
- `stop` $\to$ `audioEngine.pause(); navigator.mediaSession.playbackState = 'none';`

#### Lock-Screen Progress Scrubber (`setPositionState`)
```typescript
export function updateMediaSessionPosition(positionSec: number, durationSec: number) {
  if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
    if (isFinite(durationSec) && durationSec > 0 && positionSec >= 0 && positionSec <= durationSec) {
      try {
        navigator.mediaSession.setPositionState({
          duration: durationSec,
          playbackRate: 1.0,
          position: positionSec
        });
      } catch (e) {
        // Suppress ephemeral out-of-range race conditions during seeking
      }
    }
  }
}
```

---

### 6.5 Quality, Build & Verification Pipeline

All changes across R3, R4, and R5 must uphold strict continuous integration gates:

1. **Unit & Mathematical DSP Tests**:
   - Command: `npm test` (`vitest run`).
   - Verifies 10-band equalizer equations, storage bounds, track model normalization, and store state machines.
2. **TypeScript Compilation Gate**:
   - Command: `npx tsc --noEmit`.
   - Requires zero compilation errors, strict null safety, and valid imports across `@tauri-apps/api`, `ws`, and Google Cast types.
3. **Production Bundler Gate**:
   - Command: `npm run build` (`tsc && vite build`).
   - Ensures all chunks bundle cleanly into `dist/` with valid asset hashes and no cyclic dependency warnings.

---

## 7. Implementation Roadmap & Milestones

1. **Milestone R3 (Spotify Connect & Remote Control)**:
   - Wire `/ws/connect` and `BroadcastChannel` communication hub in `server/index.js` and `src/services/connectSocket.ts`.
   - Create `src/store/connectStore.ts` managing active host vs. remote controller state.
   - Build `ConnectDeviceModal.tsx` device picker with visual active badges.
   - Implement seamless millisecond handoff handler.
2. **Milestone R4 (Google Home & Chromecast Casting)**:
   - Add `cast_sender.js` hook in `index.html`.
   - Create `src/services/castService.ts` wrapping `CastContext` and `RemotePlayerController`.
   - Add Cast icon to `PlayerBar.tsx` and `MobileNowPlayingSheet.tsx`.
   - Implement bidirectional sync for volume, seek, play/pause, and metadata.
3. **Milestone R5 (Cross-Platform Packaging & MediaSession Polish)**:
   - Enhance `src/audio/mediaSession.ts` with `setPositionState` and full action handlers.
   - Update `public/sw.js` with stream-safe caching rules.
   - Validate Tauri 2.0 Windows desktop build and verify mobile touch targets ($\ge 48\text{px}$).
   - Run complete test suite and production build verification.
