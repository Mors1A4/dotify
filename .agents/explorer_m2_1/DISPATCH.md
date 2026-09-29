## 2026-09-19T09:45:43Z
You are explorer_m2_1, a teamwork_preview_explorer for Milestone 2 (Private Listening Profile & IndexedDB Telemetry).
Your working directory is: c:\Users\monty\Documents\AB\notify\.agents\explorer_m2_1
Your parent is orchestrator_2 (Conversation ID: 4f3d93f4-0f89-4383-91a9-37f4029b36ac).

You MUST read:
1. c:\Users\monty\Documents\AB\notify\ORIGINAL_REQUEST.md (Authoritative requirements, especially Follow-up dated 2026-09-19 § R2)
2. c:\Users\monty\Documents\AB\notify\.agents\orchestrator_2\PROJECT.md (Interface contracts & feature inventory)
3. c:\Users\monty\Documents\AB\notify\.agents\spec_miner_survey_2\survey_streaming_data.md (Telemetry schema specs)
4. c:\Users\monty\Documents\AB\notify\TEST_READY.md (E2E Test expectations)

Scope:
- Design the implementation plan for `src/services/telemetryDb.ts`.
- Database `dotify_telemetry_db` (Version 1) with 4 object stores:
  1. `listening_sessions` (sessionId, startTime, endTime, deviceType, totalDurationMs)
  2. `track_plays` (playId, sessionId, trackId, title, artist, genre, source, startTime, durationPlayedMs, totalDurationMs, completionRate, skipped, replayed)
  3. `genre_affinity` (genre, playCount, totalTimePlayedMs, affinityScore, lastUpdated)
  4. `artist_affinity` (artist, playCount, totalTimePlayedMs, affinityScore, lastUpdated)
- Design telemetry hooks in `src/audio/audioEngine.ts` and `src/store/playerStore.ts`:
  - When track starts: open play record.
  - When track updates/ends: compute completion rate. If played >= 80% duration, mark completed. If skipped within 30s or < 50%, mark skipped. If played consecutively or repeated, mark replayed.
  - Compute exponential smoothing on genre/artist affinity score (+1.0 for completion, -0.5 for quick skip, +1.5 for replay).
- Design export & import functions:
  - `exportTelemetryDataset()` -> returns JSON string matching `ExportableTelemetryDataset` (schema version 1).
  - `importTelemetryDataset(jsonString)` -> validates and merges/restores into IndexedDB.
- Design UI button and file picker in `src/components/views/LibraryView.tsx` under a "Private Listening Profile" card/tab.

Deliverables:
- Write plan to: c:\Users\monty\Documents\AB\notify\.agents\explorer_m2_1\plan_telemetry.md
- Write handoff to: c:\Users\monty\Documents\AB\notify\.agents\explorer_m2_1\handoff.md
- Send message to 4f3d93f4-0f89-4383-91a9-37f4029b36ac when complete.
DO NOT modify source code files. Recommends strategy only.
