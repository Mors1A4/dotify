## 2026-09-19T10:56:35Z
You are worker_m3_it2, a teamwork_preview_worker for Milestone 3 Iteration 2 (Gate Remediation).
Your working directory is: c:\Users\monty\Documents\AB\notify\.agents\worker_m3_it2
Your parent is orchestrator_2 (Conversation ID: 4f3d93f4-0f89-4383-91a9-37f4029b36ac).

You MUST read:
1. c:\Users\monty\Documents\AB\notify\ORIGINAL_REQUEST.md (Authoritative requirements § R3)
2. c:\Users\monty\Documents\AB\notify\.agents\orchestrator_2\PROJECT.md (Milestone 3 contracts)
3. c:\Users\monty\Documents\AB\notify\.agents\reviewer_m3_1\handoff.md (Reviewer failure evidence and recommended fixes)

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope of Work & Exclusive File Ownership:
You have exclusive write ownership of:
- `src/services/connectClient.ts`
- `server/connectHub.js`
- `tests/unit/m3_connect.spec.ts`

Tasks to Implement:
1. Fix `navigator.userAgent` undefined crash in `src/services/connectClient.ts`:
   In `detectDeviceType()`, safely guard against undefined `navigator` or `navigator.userAgent` (common in Node/headless testing environments):
   ```typescript
   const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent.toLowerCase() : '';
   ```
2. Implement `PING`/`PONG` keepalive response in `src/services/connectClient.ts`:
   In the WebSocket incoming message handler, when `msg.type === 'PING'`, immediately respond with:
   ```typescript
   this.send({
     type: 'PONG',
     payload: { timestamp: Date.now() }
   });
   ```
   This prevents `server/connectHub.js` from terminating healthy sockets after 25-50 seconds.
3. Fix socket close race condition in `server/connectHub.js`:
   In `ws.on('close')`, verify socket identity before deleting from `clients` map:
   ```javascript
   const existing = clients.get(deviceId);
   if (existing && existing.ws === ws) {
     clients.delete(deviceId);
     broadcastDeviceList();
   }
   ```
   This ensures reconnected sockets are not erroneously dropped when stale socket close events fire.
4. Update `tests/unit/m3_connect.spec.ts`:
   Verify all unit tests pass, and in handoff test ensure genuine timing behavior.

Required Verification Commands:
1. Run: `npx vitest run tests/unit/m3_connect.spec.ts`
2. Run: `npm test` (all test suites across the repository MUST pass cleanly with 0 failures)
3. Run: `npm run build` (TypeScript compilation `tsc` and Vite bundling MUST pass with 0 errors and code 0)

Deliverable:
- Write your completion report to: c:\Users\monty\Documents\AB\notify\.agents\worker_m3_it2\handoff.md
- Send completion message via send_message to Recipient: 4f3d93f4-0f89-4383-91a9-37f4029b36ac.
