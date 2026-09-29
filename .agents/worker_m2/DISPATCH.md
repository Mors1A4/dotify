## 2026-09-19T09:50:09Z

You are worker_m2, a teamwork_preview_worker for Milestone 2 (Private Listening Profile & Tailored Recommendation Engine).
Your working directory is: c:\Users\monty\Documents\AB\notify\.agents\worker_m2
Your parent is orchestrator_2 (Conversation ID: 4f3d93f4-0f89-4383-91a9-37f4029b36ac).

You MUST read the following files before writing code:
1. c:\Users\monty\Documents\AB\notify\ORIGINAL_REQUEST.md (Authoritative requirements, especially Follow-up dated 2026-09-19 § R2)
2. c:\Users\monty\Documents\AB\notify\.agents\orchestrator_2\PROJECT.md (Milestone 2 contracts & architecture)
3. c:\Users\monty\Documents\AB\notify\.agents\explorer_m2_1\plan_telemetry.md (IndexedDB telemetry & export/import blueprint)
4. c:\Users\monty\Documents\AB\notify\.agents\explorer_m2_2\plan_recommendations.md (5 recommendation shelves & algorithms blueprint)
5. c:\Users\monty\Documents\AB\notify\.agents\explorer_m2_3\plan_autoplay.md (Real-time infinite autoplay blueprint)

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Scope of Work & File Ownership:
You have exclusive write ownership of:
- src/types/telemetry.ts (create/update)
- src/services/telemetryDb.ts (create: IndexedDB dotify_telemetry_db Version 1 with listening_sessions, track_plays, genre_affinity, artist_affinity, dual-store aliases for test fixtures, EMA smoothing, and JSON export/import with validation)
- src/services/recommendationEngine.ts (create: Made For You, Discover Weekly with MMR novelty filtering, Daily Mix graph modularity clustering, Heavy Rotation with exponential half-life decay lambda = ln(2)/5 days, Forgotten Favorites 21-day gap, and getAutoplayRecommendations)
- src/audio/audioEngine.ts (integrate telemetry logging on play/pause/timeupdate/ended/skip and proactive autoplay trigger at queue end)
- src/store/playerStore.ts (integrate telemetry session management, autoplayEnabled state & toggle, triggerAutoplay queue extension)
- src/components/views/HomeView.tsx (render personalized shelves: Made For You, Discover Weekly, Daily Mix, Heavy Rotation, Forgotten Favorites with carousel cards & quick play buttons)
- src/components/views/LibraryView.tsx (add Private Listening Profile tab with privacy guarantee banner, stats summary, and Export JSON / Import JSON buttons)
- src/components/player/QueueDrawer.tsx (add Autoplay toggle switch)
- tests/unit/m2.spec.ts (create unit tests for telemetry DB, recommendation scoring, and infinite autoplay)

Verification Commands to Execute:
1. Run `npm test` (vitest run) and ensure all existing 153 tests AND your new tests pass cleanly with code 0.
2. Run `npm run build` (tsc && vite build) and ensure 0 TypeScript errors and clean bundling with code 0.

Deliverable:
- Write your completion and handoff report to: c:\Users\monty\Documents\AB\notify\.agents\worker_m2\handoff.md
- Send a completion message via send_message to Recipient: 4f3d93f4-0f89-4383-91a9-37f4029b36ac with summary and verification command outputs.
