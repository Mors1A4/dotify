## 2026-09-19T10:34:28Z
You are worker_m3, a teamwork_preview_worker for Milestone 3 (Cross-Device Remote Sync & State Sync — Spotify Connect Protocol).
Your working directory is: c:\Users\monty\Documents\AB\notify\.agents\worker_m3
Your parent is orchestrator_2 (Conversation ID: 4f3d93f4-0f89-4383-91a9-37f4029b36ac).

You MUST read the following files before writing code:
1. c:\Users\monty\Documents\AB\notify\ORIGINAL_REQUEST.md (Authoritative requirements, especially Follow-up dated 2026-09-19 § R3)
2. c:\Users\monty\Documents\AB\notify\.agents\orchestrator_2\PROJECT.md (Milestone 3 architecture & contracts)
3. c:\Users\monty\Documents\AB\notify\.agents\explorer_m3_1\plan_ws_protocol.md (WebSocket server & protocol design)
4. c:\Users\monty\Documents\AB\notify\.agents\explorer_m3_2\plan_remote_controller.md (Remote controller mode & state sync design)
5. c:\Users\monty\Documents\AB\notify\.agents\explorer_m3_3\plan_device_picker_handoff.md (Device Picker UI & seamless handoff design)

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope of Work & Exclusive File Ownership:
You have exclusive write ownership of:
- `server/connectHub.js` (create: WebSocket server attached to /ws/connect, connection tracking, broadcast, routing)
- `server/index.js` (update: attach connectHub WebSocket server to existing HTTP server)
- `src/types/connect.ts` (create: ConnectedDevice, ConnectMessage, RemoteCommand, PlaybackStatePayload, HandoffPayload, ConnectMode)
- `src/services/connectClient.ts` (create: WebSocket client with auto-reconnect, BroadcastChannel fallback, state emission, command dispatch)
- `src/audio/audioEngine.ts` (update: controller mode silent delegation, position accessors, playTrackAtPosition with loadedmetadata sync)
- `src/store/playerStore.ts` (update: connectMode, activeDevice, remoteDevices, isDevicePickerOpen, remote command interception, incoming state reconciliation, handoff handler)
- `src/components/connect/DeviceIcon.tsx` (create: SVG icons for desktop, mobile, tablet, speaker)
- `src/components/connect/ActiveDeviceBadge.tsx` (create: animated green indicator & device name)
- `src/components/connect/DevicePickerModal.tsx` (create: device list, transfer playback, remote volume, discovery radar)
- `src/components/layout/PlayerBar.tsx` (update: add Connect button & active device badge in right controls)
- `src/components/layout/MobileMiniPlayer.tsx` (update: connect icon & active device badge)
- `src/components/player/MobileNowPlayingSheet.tsx` (update: 48px connect button & active device badge)
- `tests/unit/m3_connect.spec.ts` (create: unit tests for WebSocket protocol, BroadcastChannel fallback, remote commands, handoff accuracy <= 50ms, and state synchronization)

Required Verification Commands:
1. Run: `npx vitest run tests/unit/m3_connect.spec.ts` (all unit tests for Milestone 3 MUST pass cleanly with 0 failures).
2. Run: `npm test` (all unit and stress tests across the entire repository MUST pass cleanly with code 0).
3. Run: `npm run build` (TypeScript compilation `tsc` and Vite bundling MUST pass with 0 errors and code 0).

Deliverable:
- Write your completion and handoff report to: c:\Users\monty\Documents\AB\notify\.agents\worker_m3\handoff.md
- Send a completion message via send_message to Recipient: 4f3d93f4-0f89-4383-91a9-37f4029b36ac with summary and verification command outputs.
