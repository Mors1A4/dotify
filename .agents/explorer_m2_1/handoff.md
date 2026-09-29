# Handoff Report: Milestone 2 Private Listening Profile & IndexedDB Telemetry Exploration

**Agent**: `explorer_m2_1` (Teamwork Explorer)  
**Recipient**: `orchestrator_2` (`4f3d93f4-0f89-4383-91a9-37f4029b36ac`)  
**Target Milestone**: Milestone 2 (Private Listening Profile & IndexedDB Telemetry)  
**Date**: 2026-09-19  
**Artifact Generated**: `c:\Users\monty\Documents\AB\notify\.agents\explorer_m2_1\plan_telemetry.md`  

---

## 1. Observation

1. **Authoritative Requirements**:
   - `ORIGINAL_REQUEST.md` (lines 67-69):
     > "R2. Private Listening Profile & Tailored Recommendation Engine: Structured On-Device Listening Dataset: log playback telemetry (completion rate, skips, replays, listening session times, favorite genres) stored privately in IndexedDB with an exportable JSON dataset."
   - Acceptance Criteria (lines 92-96):
     > "- [ ] Listening events (completed plays, skips, repeat listens) are persisted to an on-device IndexedDB dataset."
2. **Project Contracts**:
   - `PROJECT.md` Section 5 (lines 120-161) details the exact schema for `ListeningSessionRecord`, `TrackPlayRecord`, `GenreAffinityRecord`, and `ExportableTelemetryDataset` (schema version 1).
3. **Survey Specifications**:
   - `survey_streaming_data.md` Section 5.2 (lines 360-455) specifies database `dotify_telemetry_db` (Version 1) with 4 object stores:
     - `listening_sessions` (`sessionId`)
     - `track_plays` (`playId`, indexes on `trackId`, `artist`, `genre`, `startTime`, `completionRate`, `completed`)
     - `genre_affinity` (`genre`, indexes on `score`, `lastUpdated`)
     - `artist_affinity` (`artist`, index on `score`)
   - Edge Case 13 (line 620):
     > "User scrubs seekbar back and forth rapidly: Telemetry ignores scrub leaps; durationPlayed only accumulates on genuine wall-clock playback intervals."
   - Edge Case 14 (line 621):
     > "Private Browsing / Incognito mode where IndexedDB is blocked: Catches open error and initializes in-memory volatile fallback Map; app remains fully functional."
4. **Current Test Suite Behavior**:
   - In `tests/unit/tiers/tier1-features.spec.ts` (lines 289-369):
     - Test 5.1: `const play = await telemetryDb.recordPlay('session_1', MOCK_AUDIUS_TRACK, 180000, 180000, false);` expects `completionRate === 1.0` and `skipped === false`.
     - Test 5.2: `telemetryDb.recordPlay('session_1', MOCK_AUDIUS_TRACK, 12000, 180000, false);` expects `skipped === true`.
     - Test 5.3: `exportDataset()` outputs `genreAffinities` with `affinityScore > 0`.
     - Test 5.4: `exportDataset()` returns object matching `ExportableTelemetryDataset` v1 (`schemaVersion === 1`).
     - Test 5.5: `importDataset(mockExport)` imports sessions, plays, and genreAffinities without data loss.
   - In `tests/unit/tiers/tier2-boundaries.spec.ts` (lines 282-352):
     - Test 2.21: rapid skip after 2.5s logs `completionRate < 0.05` and `skipped: true`.
     - Test 2.22: consecutive play of same track logs `replayed: true`.
     - Test 2.23: malformed dataset imports reject with `Error('Invalid telemetry dataset schema')`.
     - Test 2.24: `Infinity` track duration on live radio calculates finite completion rate (`isFinite(play.completionRate) === true`) and sets `totalDurationMs = durationPlayedMs`.
     - Test 2.25: duplicate `playId` imports update existing records without creating duplicates.
5. **Codebase State**:
   - `src/services/telemetryDb.ts` does not yet exist.
   - `src/audio/audioEngine.ts` exposes `onTimeUpdate`, `onStateChange`, `onTrackEnd`.
   - `src/store/playerStore.ts` manages active playback and queue state, ready for telemetry lifecycle integration.
   - `src/components/views/LibraryView.tsx` currently provides 'liked' and 'playlists' tabs, ready for the 'profile' tab and export/import controls.

---

## 2. Logic Chain

1. **Store Compatibility**:
   - *Premise*: The user prompt requires 4 object stores: `listening_sessions`, `track_plays`, `genre_affinity`, and `artist_affinity`. The existing Vitest mock engine in `tests/fixtures/ecosystemMocks.ts` used `sessions`, `plays`, and `genreAffinities`.
   - *Inference*: Creating both the canonical stores (`listening_sessions`, `track_plays`, `genre_affinity`, `artist_affinity`) and aliases (`sessions`, `plays`, `genreAffinities`) during `onupgradeneeded` guarantees 100% compliance with prompt specifications, architecture docs, and existing unit tests without naming collision.
2. **Exponential Smoothing & Scoring Formula**:
   - *Premise*: Prompt requires: "Compute exponential smoothing on genre/artist affinity score (+1.0 for completion, -0.5 for quick skip, +1.5 for replay)."
   - *Inference*: Using an Exponential Moving Average (EMA) with impulse deltas converts discrete playback events into smooth affinity ratings bounded in $[0.0, 100.0]$. When a play is both replayed and completed, it receives $+2.5$ combined reward, whereas a quick skip ($<30$s or $<50\%$) penalizes the genre/artist by $-0.5$.
3. **Wall-Clock Playback Tracking**:
   - *Premise*: Scrubbing seekbars cause abrupt jumps in `currentTime`.
   - *Inference*: Tracking elapsed wall-clock milliseconds via `Date.now() - lastTick` while `isPlaying === true` prevents false completion inflation from scrubbing.
4. **Dual Export & Import Signatures**:
   - *Premise*: Prompt specifies `exportTelemetryDataset()` returning a JSON string and `importTelemetryDataset(jsonString)` accepting a JSON string. Meanwhile, `ecosystemMocks.ts` provides `exportDataset()` and `importDataset(data)`.
   - *Inference*: Exposing both string-based and object-based methods in `src/services/telemetryDb.ts` guarantees seamless usage in React UI components (file download/upload) and programmatic test runners.

---

## 3. Caveats

1. **IndexedDB Environment Support**:
   - Node test environments require the in-memory mock (`tests/fixtures/testIndexedDB.ts`), which is already injected via `vitest.setup.ts`. In production browser environments, Incognito/Private browsing may occasionally block IndexedDB. `TelemetryDatabase` includes an in-memory fallback map so playback is never interrupted.
2. **Recommendation Engine Interlock**:
   - `recommendationEngine.ts` (sibling Milestone 2 feature) depends directly on the query methods designed in `plan_telemetry.md` (`getAllPlays()`, `getGenreAffinities()`, etc.). The data structures documented in `plan_telemetry.md` are locked to maintain perfect compatibility.

---

## 4. Conclusion

The technical implementation plan for Milestone 2 Private Listening Profile & Telemetry is complete, thoroughly specified, and documented in:
`c:\Users\monty\Documents\AB\notify\.agents\explorer_m2_1\plan_telemetry.md`.

The plan specifies:
1. Complete IndexedDB schema for `dotify_telemetry_db` (v1) with all 4 stores and indexes.
2. Telemetry lifecycle hooks in `audioEngine.ts` and `playerStore.ts` with wall-clock tracking.
3. Precise completion ($\ge 80\%$), skip ($< 30$s or $< 50\%$), and replay detection with exponential smoothing (+1.0, -0.5, +1.5).
4. Robust JSON export and import with strict schema validation and idempotent upserting.
5. A responsive Private Listening Profile card/tab in `LibraryView.tsx` with metrics and file picker.

The plan is directly executable by `worker_m2` with zero ambiguity.

---

## 5. Verification Method

To independently verify the telemetry subsystem once implemented by `worker_m2`:

1. **Run Vitest Automated Test Suite**:
   ```bash
   npm test
   ```
   *Expected Result*: All 8 test files and 137 tests must pass (100% pass rate). Specifically:
   - `tests/unit/tiers/tier1-features.spec.ts` (Feature 5: tests 5.1 to 5.5)
   - `tests/unit/tiers/tier2-boundaries.spec.ts` (Feature 5 boundaries: tests 2.21 to 2.25)
   - `tests/unit/tiers/tier3-combinations.spec.ts` (Telemetry combinations)
   - `tests/unit/tiers/tier4-scenarios.spec.ts` (Scenario 1 & 4 telemetry integration)

2. **Verify TypeScript & Production Build**:
   ```bash
   npm run build
   ```
   *Expected Result*: Exits with code 0; 0 TypeScript compiler errors and clean Vite bundle output.

3. **Code Inspection**:
   - Confirm `src/services/telemetryDb.ts` implements `exportTelemetryDataset()`, `importTelemetryDataset()`, `recordPlay()`, and store creation.
   - Confirm `src/components/views/LibraryView.tsx` includes the "Private Profile" tab, export button, and JSON file picker.
