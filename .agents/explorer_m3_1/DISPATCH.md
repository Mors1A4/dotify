## 2026-09-19T10:30:39Z

You are explorer_m3_1, a teamwork_preview_explorer for Milestone 3 (Cross-Device Remote Sync - WebSocket Server & Protocol).
Your working directory is: c:\Users\monty\Documents\AB\notify\.agents\explorer_m3_1
Your parent is orchestrator_2 (Conversation ID: 4f3d93f4-0f89-4383-91a9-37f4029b36ac).

You MUST read:
1. c:\Users\monty\Documents\AB\notify\ORIGINAL_REQUEST.md (Authoritative requirements, especially Follow-up dated 2026-09-19 § R3)
2. c:\Users\monty\Documents\AB\notify\.agents\orchestrator_2\PROJECT.md (Global architecture & Milestone 3 contracts)
3. Existing server code in `server/index.js` and existing client types/stores in `src/`

Scope & Objective for Milestone 3 - WebSocket Server & Protocol:
- Spotify Connect-style local device discovery & state synchronization.
- Inspect `server/index.js` to see how WebSocket server (`/ws/connect`) can be attached to the existing HTTP server using `ws` library (check `package.json`).
- Design the full WebSocket message protocol:
  - `HELLO / REGISTER`: Device registration with `deviceId`, `deviceName`, `deviceType` ('desktop' | 'mobile' | 'web'), `capabilities` (canPlayAudio, isController).
  - `DEVICE_LIST`: Broadcast active devices on the LAN / server.
  - `PAIR / CONNECT`: Request pairing with a target device.
  - `PLAYBACK_STATE`: Bidirectional state sync (activeTrack, queue, positionMs, durationMs, isPlaying, volume, currentTrackIndex).
  - `REMOTE_COMMAND`: Play, pause, seek, next, prev, setVolume, setQueue, playTrack.
  - `HANDOFF`: Seamless playback transfer with millisecond-accurate timestamp preservation.
  - `HEARTBEAT / PING-PONG`: For liveness and disconnect detection.
  - Same-origin fallback: `BroadcastChannel('dotify_connect')` for multi-tab synchronization without server.
- Design `src/services/connectClient.ts` to manage connection, auto-reconnect, message routing, and BroadcastChannel fallback.

Deliverables:
- Write your investigation and architectural implementation plan to:
  c:\Users\monty\Documents\AB\notify\.agents\explorer_m3_1\plan_ws_protocol.md
- Write your handoff report to:
  c:\Users\monty\Documents\AB\notify\.agents\explorer_m3_1\handoff.md
- Send a completion message via send_message to Recipient: 4f3d93f4-0f89-4383-91a9-37f4029b36ac.
DO NOT modify source code files. Recommend strategy only.
