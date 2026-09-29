# Handoff Report: Milestone 3 - WebSocket Server & Protocol

**Agent**: `explorer_m3_1` (Teamwork Explorer)  
**Task**: Milestone 3 Architectural Investigation & Protocol Design (Cross-Device Remote Sync)  
**Date**: 2026-09-19  

---

## 1. Observation

1. **Dependency Availability (`package.json`)**:
   - `package.json` lines 22 and 31 contain:
     ```json
     "@types/ws": "^8.18.1",
     "ws": "^8.21.3",
     ```
   - Both runtime `ws` and TypeScript definitions `@types/ws` are already installed in dependencies.

2. **Existing HTTP Server & Upgrade Handling (`server/index.js` and `server/jamServer.js`)**:
   - In `server/index.js` lines 290-295:
     ```js
     const server = http.createServer(app);
     setupJamServer(server);

     server.listen(PORT, () => {
       console.log(`[dotify] Streaming & Collaborative Jam backend active at http://localhost:${PORT}`);
     });
     ```
   - In `server/jamServer.js` lines 21-30:
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
     ```
   - Notice that `jamServer.js` inspects `url.pathname === '/ws/jam'` and does *not* call `socket.destroy()` on other paths.

3. **Existing Reference Mock & Test Contracts (`tests/fixtures/ecosystemMocks.ts` and `tests/fixtures/vitest.setup.ts`)**:
   - In `tests/fixtures/ecosystemMocks.ts` lines 822-855:
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

     export interface PlaybackStateSync {
       currentTrack: Track | null;
       isPlaying: boolean;
       positionMs: number;
       durationMs: number;
       volume: number;
       timestamp: number;
       queue: Track[];
       currentIndex: number;
     }

     export type ConnectMessage =
       | { type: 'DEVICE_ANNOUNCE'; device: DeviceInfo }
       | { type: 'DEVICE_LIST'; devices: DeviceInfo[] }
       | { type: 'STATE_SYNC'; state: PlaybackStateSync }
       | { type: 'CMD_PLAY' }
       | { type: 'CMD_PAUSE' }
       | { type: 'CMD_SEEK'; positionMs: number }
       | { type: 'CMD_SET_VOLUME'; volume: number }
       | { type: 'CMD_NEXT' }
       | { type: 'CMD_PREV' }
       | { type: 'CMD_HANDOFF'; targetDeviceId: string; state: PlaybackStateSync };
     ```
   - In `tests/fixtures/vitest.setup.ts` lines 193-225:
     - `MockBroadcastChannel` is globally registered on `(global as any).BroadcastChannel`.
     - `postMessage` delivers messages to `channel.onmessage`.

4. **Tested Boundaries & Assertions across Test Tiers (`tests/unit/tiers/`)**:
   - `tier1-features.spec.ts` lines 583-655: tests `DEVICE_ANNOUNCE`, `STATE_SYNC`, `CMD_PLAY`, `CMD_PAUSE`, `CMD_SET_VOLUME`, and `CMD_HANDOFF`.
   - `tier2-boundaries.spec.ts` line 439: tests wall-clock latency compensation `compensatedPosition = isPlaying ? positionMs + delta : positionMs`.
   - `tier2-boundaries.spec.ts` line 471: tests ignoring announcements from self (`deviceId !== this.device.deviceId`).
   - `tier2-boundaries.spec.ts` line 481: tests preserving discovered devices on reconnect.
   - `tier2-boundaries.spec.ts` line 501: tests volume clamping to `[0.0, 1.0]`.
   - `tier3-combinations.spec.ts` line 131: tests remote phone controlling desktop queue (`CMD_NEXT` updates host queue).
   - `tier3-combinations.spec.ts` line 231: tests concurrent remote controllers receiving real-time queue updates.
   - `tier4-scenarios.spec.ts` line 123: tests "Scenario 2: Remote Party" where mobile controls desktop player with zero audio feedback on phone.

5. **Test Suite Baseline**:
   - Running `npm test` passed 15/15 test files (296 tests total) cleanly with code 0 in 5.43s.

---

## 2. Logic Chain

1. **Server Integration (from Observation 1 & 2)**:
   - Because `ws` is already installed and `jamServer.js` handles upgrade events without closing unmatched paths, a new module `server/connectServer.js` exposing `setupConnectServer(server)` can attach its own `server.on('upgrade')` listener filtering for `url.pathname === '/ws/connect'`.
   - In `server/index.js`, adding `import { setupConnectServer } from './connectServer.js';` and calling `setupConnectServer(server);` cleanly registers the `/ws/connect` endpoint with zero side effects on existing routes.

2. **Protocol Unification (from Observation 3 & 4)**:
   - The user dispatch requires Spotify Connect messages: `HELLO/REGISTER`, `DEVICE_LIST`, `PAIR/CONNECT`, `PLAYBACK_STATE`, `REMOTE_COMMAND`, `HANDOFF`, `HEARTBEAT / PING-PONG`, and `BroadcastChannel` fallback.
   - The existing test suite relies on `DEVICE_ANNOUNCE`, `STATE_SYNC`, and `CMD_*`.
   - By structuring `src/types/connect.ts` as a union supporting both the extended Spotify Connect protocol and the legacy `CMD_*` / `STATE_SYNC` types (with property aliases `activeTrack` <-> `currentTrack` and `currentTrackIndex` <-> `currentIndex`), all existing tests will pass while providing the full WebSocket capability required by Milestone 3.

3. **Dual-Transport Architecture (from Observation 2, 3, & 4)**:
   - In production with a local server, WebSocket provides cross-device LAN sync (phone controlling desktop).
   - In offline mode or in Vitest test runs, `BroadcastChannel('dotify_connect')` provides zero-configuration same-origin transport without requiring network sockets.
   - Combining both transports in `ConnectClient` with message deduplication (via `messageId` tracking and `senderDeviceId` filtering) guarantees reliable communication in all environments.

4. **Handoff & Remote Mode Guarantees (from Observation 4)**:
   - Clock drift compensation: `delta = Date.now() - state.timestamp; positionMs = isPlaying ? positionMs + delta : positionMs`.
   - Handoff transfer: active host pauses its `audioEngine`, snapshots timestamped state, sends `HANDOFF_TRANSFER`, and recipient seeks to compensated position before calling `audioEngine.play()`.
   - Remote controller mode: controller UI triggers `connectClient.sendCommand(...)` instead of modifying local `audioEngine`, ensuring zero audio feedback.

---

## 3. Caveats

- **Network Firewalls / mDNS**: WebSocket discovery connects devices on the same LAN that can reach the Express server IP. For mobile devices connecting to a desktop server, the mobile phone must be on the same Wi-Fi network and connect to `http://<lan-ip>:3001`. A QR code or server LAN IP display in the UI will assist users in connecting mobile browsers.
- **Background Tab Throttling on Mobile**: Mobile browsers throttle background WebSockets. The 25-second heartbeat with auto-reconnect on visibility change (`document.addEventListener('visibilitychange')`) handles reconnection when mobile browsers resume.
- No other caveats.

---

## 4. Conclusion

Milestone 3's WebSocket Server & Protocol architecture is fully mapped, backwards-compatible, and ready for immediate implementation.

### Implementation Blueprint:
1. `server/connectServer.js`: In-memory device registry, WebSocket upgrade handler on `/ws/connect`, ping-pong heartbeat (25s), targeted command routing, and state caching.
2. `server/index.js`: Attach `setupConnectServer(server)`.
3. `src/types/connect.ts`: Unified data schemas (`DeviceInfo`, `PlaybackStateSync`, `RemoteCommand`, `ConnectMessage`).
4. `src/services/connectClient.ts`: Dual-transport client (`WebSocket` + `BroadcastChannel`), auto-reconnect with exponential backoff, clock drift compensator, and `ConnectNode` compatibility export.
5. `src/store/connectStore.ts`: Reactive Zustand store managing device lists, active role, pairing, and UI state.
6. `src/components/connect/DevicePickerModal.tsx`: "Connect to a Device" dialog with device icons, status, and control/handoff buttons.
7. `src/components/layout/PlayerBar.tsx`: Connect launcher button on right control cluster.

Detailed technical specifications and sequence diagrams are preserved in:
`c:\Users\monty\Documents\AB\notify\.agents\explorer_m3_1\plan_ws_protocol.md`

---

## 5. Verification Method

To independently verify the findings and test against this plan:
1. Inspect the architecture plan:
   ```
   c:\Users\monty\Documents\AB\notify\.agents\explorer_m3_1\plan_ws_protocol.md
   ```
2. Verify existing test suite baseline:
   ```powershell
   npm test
   ```
   *Expected: All 15 test suites and 296 tests pass cleanly.*
3. Verify `server/index.js` and `package.json`:
   - Inspect `package.json` for `ws` and `@types/ws`.
   - Inspect `server/jamServer.js` line 24 for path-scoped upgrade handling.
4. Invalidation conditions:
   - If `npm test` fails any of the 296 baseline tests.
   - If `server.on('upgrade')` in `jamServer.js` is modified to destroy sockets on unknown paths.
