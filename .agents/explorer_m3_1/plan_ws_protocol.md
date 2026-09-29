# Milestone 3 Architecture Plan: Cross-Device Remote Sync (WebSocket Server & Protocol)

**Target Milestone**: M3 — Cross-Device Remote Sync (Spotify Connect Protocol)  
**Author**: `explorer_m3_1` (Teamwork Explorer)  
**Parent Orchestrator**: `orchestrator_2` (Conversation ID: `4f3d93f4-0f89-4383-91a9-37f4029b36ac`)  
**Date**: 2026-09-19  

---

## 1. Executive Summary & Problem Scope

Requirement **R3** of `ORIGINAL_REQUEST.md` (Follow-up dated 2026-09-19) mandates:
> **Cross-Device Sync & Remote Control (Spotify Connect Protocol)**:
> - Bidirectional device discovery and state synchronization over the local network via WebSockets.
> - Remote Control Mode: use a mobile phone as a remote controller to view what's playing, play/pause, seek, adjust volume, and switch tracks on a desktop app or TV screen.
> - Seamless Playback Handoff: transfer active playback between devices with millisecond-accurate timestamp preservation.

This plan details the full end-to-end architecture and protocol design for:
1. **Server Endpoint**: Attaching a dedicated WebSocket server (`/ws/connect`) to the existing Express HTTP server in `server/index.js` using `ws`.
2. **WebSocket Protocol**: Standardized message format supporting `HELLO / REGISTER`, `DEVICE_LIST`, `PAIR / CONNECT`, `PLAYBACK_STATE`, `REMOTE_COMMAND`, `HANDOFF`, and `HEARTBEAT / PING-PONG`, while maintaining 100% backward compatibility with existing test fixtures (`ConnectNode`, `STATE_SYNC`, `CMD_*`).
3. **Client Transport (`src/services/connectClient.ts`)**: Resilient client transport managing WebSocket connection, exponential backoff auto-reconnect, and same-origin fallback to `BroadcastChannel('dotify_connect')` for multi-tab synchronization without a server.
4. **State Management (`src/store/connectStore.ts`) & Audio Engine Integration**: Zero audio feedback on remote controllers, millisecond-accurate clock drift compensation, and seamless handoff.
5. **UI Integration**: "Connect to a Device" device picker modal and status indicators in `PlayerBar` and mobile sheets.

---

## 2. Existing Codebase Analysis & Integration Points

### 2.1 Server Architecture (`server/index.js` & `server/jamServer.js`)
- `server/index.js` creates a standard Node HTTP server:
  ```js
  const server = http.createServer(app);
  setupJamServer(server);
  server.listen(PORT, ...);
  ```
- `server/jamServer.js` attaches to the server upgrade event:
  ```js
  export function setupJamServer(server) {
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname === '/ws/jam') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    });
    ...
  }
  ```
- **Key Finding**: `jamServer.js` only consumes sockets where `url.pathname === '/ws/jam'` and does *not* terminate unhandled sockets. This allows `setupConnectServer(server)` to attach another listener to `server.on('upgrade')` specifically checking `url.pathname === '/ws/connect'` without conflicting with or modifying `jamServer.js`.

### 2.2 Existing Mock Contracts & Test Coverage
- In `tests/fixtures/ecosystemMocks.ts` and `tests/unit/tiers/tier1-features.spec.ts`:
  - Feature 7 tests already assert behavior for `ConnectNode` using:
    - Device Announcement: `DEVICE_ANNOUNCE`
    - Discovery Map: `discoveredDevices`
    - State Sync: `STATE_SYNC`
    - Remote Commands: `CMD_PLAY`, `CMD_PAUSE`, `CMD_SEEK`, `CMD_SET_VOLUME`, `CMD_NEXT`, `CMD_PREV`, `CMD_HANDOFF`
    - Clock Drift Compensation: wall-clock latency compensation `compensatedPositionMs = isPlaying ? (positionMs + delta) : positionMs`
    - Volume Clamping: `0.0` to `1.0`
    - Reconnect preservation of discovered devices
    - Multi-remote controller concurrency
- In `tests/fixtures/vitest.setup.ts`:
  - `(global as any).BroadcastChannel = MockBroadcastChannel;` is already active in tests.
  - Native `WebSocket` is used in browser environments, while `BroadcastChannel` provides zero-configuration same-origin fallbacks both in production and testing.

---

## 3. WebSocket Server Architecture (`server/connectServer.js`)

### 3.1 Server Attachment in `server/index.js`
In `server/index.js`:
```js
import { setupConnectServer } from './connectServer.js';

// ...
const server = http.createServer(app);
setupJamServer(server);
setupConnectServer(server); // Attach Connect WebSocket hub

server.listen(PORT, () => {
  console.log(`[dotify] Streaming & Connect backend active at http://localhost:${PORT}`);
});
```

### 3.2 `server/connectServer.js` Core Design
The Connect Server functions as an in-memory LAN signaling hub:
1. **Device Registry**:
   - `Map<string, { ws: WebSocket, device: DeviceInfo, pairedWith?: string, isAlive: boolean, lastPing: number }>`
   - Key: `deviceId`
   - Reverse index: `WeakMap<WebSocket, string>` mapping socket to `deviceId`.
2. **Liveness & Heartbeat**:
   - Server runs a `setInterval` every 25,000ms:
     - For each registered client:
       - If `isAlive === false`: client is unresponsive; close socket, remove from registry, and broadcast updated `DEVICE_LIST`.
       - If `isAlive === true`: set `isAlive = false` and send `{ type: 'PING', timestamp: Date.now() }` (or `ws.ping()`).
     - On client message with `type: 'PONG'` or native pong event: set `isAlive = true`.
3. **Active Playback State Cache**:
   - Server keeps a cache of the current `activeHostState: PlaybackStateSync | null`.
   - When an active host updates playback, the server saves it.
   - When a new device registers or connects, the server immediately forwards the current playback state so new devices reflect the current track with zero delay.
4. **Message Routing & Dispatch**:
   - Broadcast messages (`DEVICE_LIST`, `PLAYBACK_STATE` updates to LAN).
   - Targeted messages (`REMOTE_COMMAND`, `PAIR_REQUEST`, `HANDOFF` routed directly to `targetDeviceId`).

---

## 4. Comprehensive Protocol Specification

### 4.1 Data Models (`src/types/connect.ts`)

```typescript
import { Track } from './track';

export type DeviceType = 'desktop' | 'mobile' | 'web' | 'tv' | 'cast';
export type DeviceRole = 'active_host' | 'remote_controller';

export interface DeviceCapabilities {
  canPlayAudio: boolean;
  isController: boolean;
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  role: DeviceRole;
  isCurrentDevice: boolean;
  lastSeen: number;
  capabilities?: DeviceCapabilities;
}

export interface PlaybackStateSync {
  currentTrack: Track | null;
  activeTrack?: Track | null; // Compatibility alias
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  volume: number; // Clamped 0.0 to 1.0
  timestamp: number; // Epoch ms for clock drift calculation
  queue: Track[];
  currentIndex: number;
  currentTrackIndex?: number; // Compatibility alias
  repeatMode?: 'off' | 'all' | 'one';
  shuffle?: boolean;
}

export type RemoteCommandAction =
  | 'play'
  | 'pause'
  | 'togglePlay'
  | 'seek'
  | 'next'
  | 'prev'
  | 'setVolume'
  | 'setQueue'
  | 'playTrack'
  | 'playNext'
  | 'addToEnd'
  | 'reorderQueue'
  | 'removeFromQueue';

export type RemoteCommand =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'togglePlay' }
  | { action: 'seek'; positionMs: number }
  | { action: 'next' }
  | { action: 'prev' }
  | { action: 'setVolume'; volume: number }
  | { action: 'setQueue'; queue: Track[] }
  | { action: 'playTrack'; track: Track; queue?: Track[]; index?: number }
  | { action: 'playNext'; track: Track }
  | { action: 'addToEnd'; track: Track }
  | { action: 'reorderQueue'; fromIndex: number; toIndex: number }
  | { action: 'removeFromQueue'; index: number };

export type ConnectMessage =
  // Registration & Discovery
  | { type: 'HELLO'; payload: DeviceInfo }
  | { type: 'REGISTER'; payload: DeviceInfo }
  | { type: 'DEVICE_ANNOUNCE'; device: DeviceInfo }
  | { type: 'DEVICE_LIST'; devices: DeviceInfo[] }
  | { type: 'DEVICE_LIST_REQUEST' }
  
  // Pairing & Session
  | { type: 'PAIR'; targetDeviceId: string; fromDeviceId?: string }
  | { type: 'PAIRED'; targetDevice: DeviceInfo; hostDeviceId?: string; controllerDeviceId?: string; role: DeviceRole }
  | { type: 'UNPAIR'; targetDeviceId?: string }
  
  // State Sync
  | { type: 'PLAYBACK_STATE'; state: PlaybackStateSync }
  | { type: 'STATE_SYNC'; state: PlaybackStateSync }
  
  // Remote Commands
  | { type: 'REMOTE_COMMAND'; command: RemoteCommand; targetDeviceId?: string; fromDeviceId?: string }
  | { type: 'CMD_PLAY'; targetDeviceId?: string }
  | { type: 'CMD_PAUSE'; targetDeviceId?: string }
  | { type: 'CMD_SEEK'; positionMs: number; targetDeviceId?: string }
  | { type: 'CMD_SET_VOLUME'; volume: number; targetDeviceId?: string }
  | { type: 'CMD_NEXT'; targetDeviceId?: string }
  | { type: 'CMD_PREV'; targetDeviceId?: string }
  
  // Handoff
  | { type: 'HANDOFF'; targetDeviceId: string; state?: PlaybackStateSync }
  | { type: 'CMD_HANDOFF'; targetDeviceId: string; state: PlaybackStateSync }
  | { type: 'HANDOFF_TRANSFER'; targetDeviceId: string; state: PlaybackStateSync }
  
  // Liveness
  | { type: 'PING'; timestamp?: number }
  | { type: 'PONG'; timestamp?: number };
```

### 4.2 Protocol Flow Sequences

#### 1. Device Discovery & Registration
```
Client (Phone)                                 Connect Server (/ws/connect)
      │                                                     │
      │── ws.connect('/ws/connect') ───────────────────────>│
      │                                                     │
      │── { type: 'HELLO', payload: phoneDeviceInfo } ─────>│
      │                                                     │ [Register in Map]
      │<── { type: 'DEVICE_LIST', devices: [...] } ─────────│
      │                                                     │
      │                                                     │── Broadcast DEVICE_LIST to LAN ──> (Desktop, TV)
```

#### 2. Pairing as Remote Controller
```
Phone (Controller)                            Connect Server                       Desktop (Active Host)
      │                                              │                                       │
      │── { type: 'PAIR', targetDeviceId: 'pc_1' } ─>│                                       │
      │                                              │── Forward PAIR ──────────────────────>│
      │                                              │                                       │ [Acknowledge]
      │                                              │<── { type: 'PAIRED', ... } ───────────│
      │<── Forward PAIRED ───────────────────────────│                                       │
      │                                              │<── { type: 'PLAYBACK_STATE', state } ─│
      │<── Forward PLAYBACK_STATE ───────────────────│                                       │
      │ [Mirrors track, seekbar, volume]             │                                       │
```

#### 3. Remote Command Execution
```
Phone (Controller)                            Connect Server                       Desktop (Active Host)
      │                                              │                                       │
      │── { type: 'CMD_SEEK', positionMs: 65000 } ──>│                                       │
      │                                              │── Route to desktop ──────────────────>│
      │                                              │                                       │ [audioEngine.seekTo(65)]
      │                                              │<── { type: 'STATE_SYNC', state } ─────│
      │<── Broadcast updated STATE_SYNC ─────────────│                                       │
```

#### 4. Seamless Playback Handoff (Preserving Millisecond Timestamp)
```
Phone (Recipient)                              Connect Server                       Desktop (Current Host)
      │                                              │                                       │
      │── { type: 'HANDOFF', targetDeviceId: self } ─>│                                       │
      │                                              │── Route HANDOFF ─────────────────────>│
      │                                              │                                       │ [1. Record currentTime]
      │                                              │                                       │ [2. audioEngine.pause()]
      │                                              │                                       │ [3. snapshot state]
      │                                              │<── { type: 'HANDOFF_TRANSFER', state }─│
      │<── Route HANDOFF_TRANSFER ───────────────────│                                       │ [Demotes to controller]
      │                                              │                                       │
      │ [Compensate transit: pos + (now - ts)]       │                                       │
      │ [playTrack(track, queue, index)]             │                                       │
      │ [audioEngine.seekTo(compensatedPos)]         │                                       │
      │ [audioEngine.play()]                         │                                       │
      │ [Becomes active_host]                        │                                       │
      │── Broadcast new active_host STATE_SYNC ─────>│                                       │
```

---

## 5. Client Service Architecture (`src/services/connectClient.ts`)

`ConnectClient` encapsulates the dual-transport system:

### 5.1 Dual-Transport Strategy (WebSocket + BroadcastChannel)
```
┌─────────────────────────────────────────────────────────────┐
│                        ConnectClient                        │
│                                                             │
│   ┌───────────────────────────┐ ┌─────────────────────────┐ │
│   │    WebSocketTransport     │ │ BroadcastChannelTransport│ │
│   │    (LAN Cross-Device)     │ │   (Same-Origin Multi-Tab)│ │
│   └─────────────┬─────────────┘ └────────────┬────────────┘ │
│                 │                            │              │
│                 ▼                            ▼              │
│       ws://host:3001/ws/connect     dotify_connect channel  │
└─────────────────────────────────────────────────────────────┘
```

1. **Primary Transport**: `WebSocket` connects to `ws://${location.host}/ws/connect` (or `wss:` if HTTPS).
2. **Fallback Transport**: `BroadcastChannel('dotify_connect')` is instantiated immediately.
   - If the backend server is unreachable or offline, multi-tab sync continues via `BroadcastChannel`.
   - In Vitest test environments, `MockBroadcastChannel` from `vitest.setup.ts` activates automatically.
3. **Message Deduplication & Echo Suppression**:
   - Every outgoing message includes `messageId: string` and `senderDeviceId: string`.
   - Receiving nodes discard any message where `senderDeviceId === this.device.deviceId`.
   - An in-memory LRU set of processed `messageId`s prevents duplicate execution when bridging between transports.

### 5.2 Auto-Reconnect with Exponential Backoff
- On WebSocket `onerror` or `onclose`:
  - `reconnectAttempt++`
  - `delay = Math.min(15000, 1000 * Math.pow(1.5, reconnectAttempt)) + Math.random() * 500`
  - Schedules reconnect attempt while keeping existing `discoveredDevices` intact.
  - Upon successful reconnection: resets `reconnectAttempt = 0`, re-announces device (`HELLO`), and requests fresh `DEVICE_LIST`.

### 5.3 Clock Drift & Latency Compensation
When receiving `STATE_SYNC` or `PLAYBACK_STATE`:
```typescript
const now = Date.now();
const delta = Math.max(0, now - (state.timestamp || now));
const compensatedPositionMs = state.isPlaying
  ? Math.min(state.durationMs || Infinity, state.positionMs + delta)
  : state.positionMs;

this.playbackState = {
  ...state,
  currentTrack: state.currentTrack || (state as any).activeTrack || null,
  activeTrack: state.currentTrack || (state as any).activeTrack || null,
  currentIndex: state.currentIndex ?? (state as any).currentTrackIndex ?? 0,
  currentTrackIndex: state.currentIndex ?? (state as any).currentTrackIndex ?? 0,
  positionMs: compensatedPositionMs,
};
```

### 5.4 Test Compatibility: `ConnectNode` Adapter
To ensure that all existing unit tests in `tests/unit/tiers/` (`tier1-features.spec.ts`, `tier2-boundaries.spec.ts`, `tier3-combinations.spec.ts`, `tier4-scenarios.spec.ts`) pass without modification, `connectClient.ts` will export both `ConnectClient` and `ConnectNode`:
```typescript
export class ConnectNode extends ConnectClient {
  constructor(device: DeviceInfo, channelName = 'dotify_connect') {
    super({
      customDevice: device,
      channelName,
      enableWebSocket: false, // Pure BroadcastChannel mode for Vitest unit tests
    });
  }
}
```

---

## 6. State Management & Audio Integration (`src/store/connectStore.ts`)

### 6.1 `connectStore.ts` Reactive Zustand Store
Keeps UI components synced with Connect events:
```typescript
export interface ConnectStoreState {
  currentDevice: DeviceInfo;
  discoveredDevices: DeviceInfo[];
  pairedDevice: DeviceInfo | null;
  role: DeviceRole;
  isConnecting: boolean;
  isConnected: boolean;
  isPickerOpen: boolean;
  transport: 'websocket' | 'broadcast_channel' | 'disconnected';
  remotePlaybackState: PlaybackStateSync | null;

  // Actions
  togglePicker: (open?: boolean) => void;
  pairWith: (deviceId: string) => void;
  unpair: () => void;
  transferPlayback: (targetDeviceId: string) => void;
  setDeviceName: (name: string) => void;
  refreshDevices: () => void;
}
```

### 6.2 Remote Controller Mode: Zero Audio Feedback
When `role === 'remote_controller'`:
1. `audioEngine.pause()` is invoked on the controller.
2. In `playerStore.ts`, user actions (play, pause, seek, volume, next, prev) check `useConnectStore.getState().role`:
   - If `role === 'remote_controller'`: send `REMOTE_COMMAND` via `connectClient.sendCommand(...)` instead of invoking local `audioEngine`.
   - Incoming `PLAYBACK_STATE` updates `playerStore`'s state variables (`currentTrack`, `queue`, `volume`, `isPlaying`, `repeatMode`, `shuffle`), allowing existing UI components (`PlayerBar`, `MobileMiniPlayer`, `MobileNowPlayingSheet`, `QueueDrawer`) to reflect remote playback seamlessly without emitting sound on the remote device.

---

## 7. UI Component Specifications

### 7.1 "Connect to a Device" Modal (`src/components/connect/DevicePickerModal.tsx`)
- **Header**: "Connect to a device" with a refresh spinner icon.
- **Current Device Banner**:
  - Displays icon (`Laptop`, `Smartphone`, `Monitor`), device name, and "This device • Active".
- **Available Devices List**:
  - Lists all discovered LAN/browser devices.
  - Displays device icon based on `deviceType`.
  - Shows status: "Dotify Connect • Available" or "Playing on this device".
  - Actions:
    - "Control" button (pair as remote controller).
    - "Play on this device" button (seamless handoff).
- **Disconnect / Unpair Button**: returns device to standalone local player.

### 7.2 Integration in `PlayerBar.tsx`
- Adds a `Devices` button on the right control cluster (between Equalizer and Volume):
  - Icon: `Laptop2` / `Smartphone` / `Tv` with green accent when paired.
  - Tooltip: "Connect to a device" or "Listening on [Device Name]".
  - Clicking toggles `isPickerOpen`.

### 7.3 Integration in `MobileNowPlayingSheet.tsx`
- Adds a bottom pill in the full-screen now-playing sheet:
  - Text: "🔊 Playing on [Device Name]" or "Devices Available".
  - Tap target: >= 48px, opens `DevicePickerModal`.

---

## 8. File Structure for Implementation

```
c:\Users\monty\Documents\AB\notify\
├── server/
│   ├── index.js                     # [Attach setupConnectServer]
│   └── connectServer.js             # [NEW: WebSocket Hub /ws/connect]
├── src/
│   ├── types/
│   │   └── connect.ts               # [NEW: Connect protocol types & message schemas]
│   ├── services/
│   │   └── connectClient.ts         # [NEW: WebSocket + BroadcastChannel client]
│   ├── store/
│   │   ├── connectStore.ts          # [NEW: Reactive Zustand Connect store]
│   │   └── playerStore.ts           # [Integrate remote command routing & handoff]
│   └── components/
│       ├── connect/
│       │   └── DevicePickerModal.tsx # [NEW: Connect to a Device modal]
│       ├── layout/
│       │   └── PlayerBar.tsx        # [Add Connect button to right cluster]
│       └── player/
│           └── MobileNowPlayingSheet.tsx # [Add Connect device indicator pill]
└── tests/
    └── unit/
        └── connect.spec.ts          # [NEW: Dedicated unit tests for Connect client & server]
```

---

## 9. Verification & Quality Assurance Strategy

1. **Unit & Boundary Tests**:
   - Verify `ConnectNode` compatibility across `tier1-features.spec.ts` (F7), `tier2-boundaries.spec.ts`, `tier3-combinations.spec.ts`, and `tier4-scenarios.spec.ts`.
   - Verify volume clamping (0.0 to 1.0).
   - Verify clock drift compensation with wall-clock latency adjustments.
   - Verify self-announcement filtering and reconnect preservation.
2. **WebSocket Server Integration**:
   - Verify WebSocket upgrade handling on `/ws/connect` alongside `/ws/jam`.
   - Verify client registration, device listing broadcast, and ping-pong liveness.
3. **Handoff Accuracy**:
   - Verify position timestamp transfer accuracy with < 50ms variance.
4. **Zero Audio Feedback**:
   - Verify controller does not trigger Web Audio or HTMLAudioElement playback.
5. **Full Suite Regression Check**:
   - Run `npm test` ensuring all 296+ tests pass with 0 errors.
   - Run `npm run build` ensuring clean TypeScript compilation.
