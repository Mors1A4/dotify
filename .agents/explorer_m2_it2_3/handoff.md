# Handoff Report: Investigation & Remediation Plan for Failures 8 & 9 (Duplicate Tracks & Queue Runaway)

**Agent**: `explorer_m2_it2_3`  
**Working Directory**: `c:\Users\monty\Documents\AB\notify\.agents\explorer_m2_it2_3`  
**Recipient**: `orchestrator_2` (Conversation ID: `4f3d93f4-0f89-4383-91a9-37f4029b36ac`)  
**Milestone**: Milestone 2 Iteration 2 (Gate Remediation)  
**Deliverable File**: `c:\Users\monty\Documents\AB\notify\.agents\explorer_m2_it2_3\plan_queue_dedup_fix.md`

---

## 1. Observation

### 1.1 Empirical Test Execution & Verbatim Failures
Executed test command:
```powershell
npx vitest run tests/unit/challenger_m2_2_adversarial.spec.ts
```
Results:
```
Test Files  1 failed (1)
Tests       9 failed | 8 passed (17)
```

Verbatim error for Failure 8 (`challenger_m2_2_adversarial.spec.ts:417-431`):
```
FAIL tests/unit/challenger_m2_2_adversarial.spec.ts > Empirical Adversarial Stress Suite: Milestone 2 (challenger_m2_2) > 4. Rapid Queue Runout (20+ Repeated Exhaustion Triggers) > checks for duplicate track IDs in getAutoplayRecommendations when tracks match both artist and genre
AssertionError: expected 5 to be 4 // Object.is equality

- Expected
+ Received

- 4
+ 5

 ❯ tests/unit/challenger_m2_2_adversarial.spec.ts:430:26
    428|       const uniqueIds = new Set(ids);
    429|       // EMPIRICAL CHECK: All recommended tracks must have unique IDs! No duplicates!
    430|       expect(ids.length).toBe(uniqueIds.size);
       |                          ^
    431|     });
```

Verbatim error for Failure 9 (`challenger_m2_2_adversarial.spec.ts:433-453`):
```
FAIL tests/unit/challenger_m2_2_adversarial.spec.ts > Empirical Adversarial Stress Suite: Milestone 2 (challenger_m2_2) > 4. Rapid Queue Runout (20+ Repeated Exhaustion Triggers) > demonstrates queue runaway / backward jump loop bug when duplicate track IDs exist in queue
AssertionError: expected 'unique_2' to be 'unique_3' // Object.is equality

Expected: "unique_3"
Received: "unique_2"

 ❯ tests/unit/challenger_m2_2_adversarial.spec.ts:451:41
    449|       // It jumped BACKWARD instead of forward to unique_3!
    450|       const currentTrackAfterNext = usePlayerStore.getState().currentTrack;
    451|       expect(currentTrackAfterNext?.id).toBe('unique_3');
       |                                         ^
    452|     });
```

### 1.2 Code Inspection Observations
1. In `src/services/recommendationEngine.ts:420-428`:
   ```typescript
   if (fallbackCatalogue && fallbackCatalogue.length > 0) {
     for (const catTrack of fallbackCatalogue) {
       if (seedArtists.includes(extractPrimaryArtist(catTrack.artist))) {
         relatedPool.push(catTrack);
       }
       if (seedGenres.includes(catTrack.sourceMetadata?.genre || '')) {
         genrePool.push(catTrack);
       }
     }
   }
   ```
   A track matching both seed artist and seed genre is pushed unconditionally to both `relatedPool` and `genrePool`.
2. In `src/services/artistService.ts:397-446`:
   `interleaveWithAntiClumping` does not check for track ID uniqueness across or within pools, allowing the same track object or ID to be popped from multiple pools.
3. In `src/store/playerStore.ts:316-317`:
   ```typescript
   const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);
   let nextIndex = currentIndex + 1;
   ```
   `PlayerStoreState` possesses no `currentTrackIndex` property. Position resolution is delegated to `queue.findIndex(t => t.id === currentTrack?.id)`.
4. In `src/components/player/QueueDrawer.tsx:21` and `471`:
   - Line 21: `const currentTrackIndex = currentTrack ? queue.findIndex((t) => t.id === currentTrack.id) : -1;`
   - In `playerStore.ts:471`: `const isCurrent = queue[idx].id === currentTrack?.id;`

---

## 2. Logic Chain

1. **Failure 8 Causality**:
   - In test 8, `dualMatchTrack` has `artist: 'Synthwave Boy'` and `genre: 'Electronic'`.
   - Seed track has `artist: 'Synthwave Boy'` and `genre: 'Electronic'`.
   - `fallbackCatalogue` contains `dualMatchTrack`.
   - Lines 422 and 425 in `recommendationEngine.ts` evaluate to true consecutively. `catTrack` is pushed to `relatedPool` and `genrePool`.
   - Line 467 `isEligible` verifies track eligibility against `seedIds`, `queueIds`, `historyIds`, `fatiguedIds`, but does not filter duplicates between `relatedPool` and `genrePool`.
   - `artistService.interleaveWithAntiClumping` pops `dualMatchTrack` from `relatedPool` (position 0) and then from `genrePool` (position 1) because `artistStreak` is 1 ($< 2$).
   - Fallback padding appends 3 synthetic tracks to reach the requested count of 5.
   - Resulting array has length 5, but contains only 4 unique IDs (`cat_e1` appears twice).
   - Therefore, dual ingestion without cross-pool deduplication and without interleaver ID deduplication directly produces duplicate track IDs in autoplay recommendations.

2. **Failure 9 Causality**:
   - In test 9, `queue` is set to `[t0('dup_1'), t1('unique_2'), t2('dup_1'), t3('unique_3')]`.
   - `store.playTrack(t2)` sets `currentTrack` to `t2`.
   - `store.nextTrack()` is invoked.
   - `queue.findIndex((t) => t.id === currentTrack?.id)` evaluates `queue.findIndex(t => t.id === 'dup_1')`.
   - `findIndex` traverses index 0 forward and matches `t0` at index 0, returning `0`.
   - `nextIndex` is calculated as `0 + 1 = 1`.
   - Track at index 1 is `t1` (`unique_2`).
   - Active playback jumps backward to index 1 (`unique_2`) instead of advancing to index 3 (`unique_3`).
   - Consequently, relying on `queue.findIndex` by track ID rather than maintaining an index cursor in state causes backward jumps and traps queue playback in an infinite 2-track loop whenever duplicate IDs are present.

---

## 3. Caveats

1. **Other 7 Failures**: This investigation is strictly scoped to Failures 8 and 9. Failures 1–3 (Cold Start Daily Mix/Forgotten Favorites), Failures 4–5 (Single-Genre Mix Clustering), and Failures 6–7 (Anti-clumping streak limits) are under analysis by peer explorers `explorer_m2_it2_1` and `explorer_m2_it2_2`.
2. **Strict Read-Only Investigation**: In accordance with explorer rules, source code files were NOT altered during this turn. All proposals are detailed in `plan_queue_dedup_fix.md`.
3. **Queue Serialization**: `currentTrackIndex` represents transient runtime playback cursor state. If restored from `localStorage`, it can be safely recomputed or default to 0/first match.

---

## 4. Conclusion

Failures 8 and 9 are fully understood and solvable via two targeted, non-breaking architectural remediations:

1. **Strict Multi-Tier ID Deduplication in `recommendationEngine.ts` and `artistService.ts`**:
   - Enforce disjoint candidate classification (`else if (matchesGenre)`).
   - Deduplicate candidates across pools before interleaving (`uniqueRelated` / `uniqueGenre`).
   - Enforce `seenTrackIds` in `interleaveWithAntiClumping` to guarantee no track ID is returned twice.
   - Maintain `seenBatchIds = new Set<string>(queueIds)` across all fallback stages.
   - Apply final Set-based deduplication pass before returning recommendations.

2. **Queue Index Cursor in `playerStore.ts`**:
   - Add `currentTrackIndex: number` to `PlayerStoreState` (initialized to `-1`).
   - Extend `playTrack(track, newQueue?, trackIndex?)` with a 4-tier index resolver (Explicit index $\to$ Reference equality `indexOf` $\to$ `_instanceId` $\to$ ID fallback).
   - Update `nextTrack()` and `previousTrack()` to advance and retreat by numerical cursor index ($+1$ / $-1$).
   - Update queue mutations (`reorderQueue`, `removeFromQueue`, `clearQueue`) to maintain cursor integrity.
   - Update `QueueDrawer.tsx` to read `currentTrackIndex` and pass index to `playTrack(track, queue, idx)`.

The full patch and implementation plan is documented in:
`c:\Users\monty\Documents\AB\notify\.agents\explorer_m2_it2_3\plan_queue_dedup_fix.md`

---

## 5. Verification Method

To reproduce current failures:
```powershell
npx vitest run tests/unit/challenger_m2_2_adversarial.spec.ts -t "Rapid Queue Runout"
```
Observed output:
- `checks for duplicate track IDs in getAutoplayRecommendations when tracks match both artist and genre` $\to$ FAILED (5 received, 4 unique).
- `demonstrates queue runaway / backward jump loop bug when duplicate track IDs exist in queue` $\to$ FAILED ('unique_2' received, 'unique_3' expected).

To verify remediation after implementation:
```powershell
npx vitest run tests/unit/challenger_m2_2_adversarial.spec.ts -t "Rapid Queue Runout"
```
Expected output: 4 passed | 0 failed.

Full regression verification:
```powershell
npx vitest run
npm run build
```
Expected output: All 273+ tests pass, 0 TypeScript compile errors.
