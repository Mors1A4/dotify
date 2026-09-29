# Handoff Report — Cold Start & Empty Shelf Remediation (Failures 1, 2, 3)

**Agent**: `explorer_m2_it2_1`  
**Working Directory**: `c:\Users\monty\Documents\AB\notify\.agents\explorer_m2_it2_1`  
**Type**: Hard Handoff (Investigation & Architecture Plan Complete)  
**Deliverable Document**: `c:\Users\monty\Documents\AB\notify\.agents\explorer_m2_it2_1\plan_coldstart_fix.md`

---

## 1. Observation

Direct empirical observations, verbatim error outputs, and source code locations:

### 1.1 Tool Execution & Test Results
Command executed:
```powershell
npx vitest run tests/unit/challenger_m2_2_adversarial.spec.ts
```
Direct output:
```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 of 9 related to Cold Start ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/unit/challenger_m2_2_adversarial.spec.ts > 1. Cold Start Recommendation Generation (Zero Listening History) > Shelf 3 (Daily Mix) cold start resilience when catalogue lacks Electronic genre
AssertionError: expected 0 to be greater than 0 
 ❯ tests/unit/challenger_m2_2_adversarial.spec.ts:148:35
    146|       expect(mix1).toBeDefined();
    147|       // EMPIRICAL CHECK: Does mix 1 have tracks even when Electronic …
    148|       expect(mix1!.tracks.length).toBeGreaterThan(0);

 FAIL  tests/unit/challenger_m2_2_adversarial.spec.ts > 1. Cold Start Recommendation Generation (Zero Listening History) > Shelf 3 (Daily Mix) cold start resilience when catalogue has fewer than 10 tracks
AssertionError: expected 0 to be greater than 0
 ❯ tests/unit/challenger_m2_2_adversarial.spec.ts:162:35
    160|       expect(mix3).toBeDefined();
    161|       // EMPIRICAL CHECK: Does Mix 3 contain valid playable tracks or …
    162|       expect(mix3!.tracks.length).toBeGreaterThan(0);

 FAIL  tests/unit/challenger_m2_2_adversarial.spec.ts > 1. Cold Start Recommendation Generation (Zero Listening History) > Shelf 5 (Forgotten Favorites) returns valid tracks on zero history without blank UI
AssertionError: expected 0 to be greater than 0
 ❯ tests/unit/challenger_m2_2_adversarial.spec.ts:181:29
    179|       // EMPIRICAL CHECK: Requirement 1 explicitly states:
    180|       // "ensure all 5 shelves return valid tracks without crash or bl…
    181|       expect(shelf5.length).toBeGreaterThan(0);
```

### 1.2 Verbatim Source Code Observations

- **Observation A (Shelf 5 "Forgotten Favorites" omission)**:
  `src/services/recommendationEngine.ts:309-316`:
  ```ts
  const minPlays = plays.length >= 20 ? 4 : 2; // Adaptive threshold
  const forgottenIds = Array.from(playStats.entries())
    .filter(([_, stats]) => {
      const avgCompletion = stats.totalCompletion / stats.count;
      const timeSincePlay = now - stats.lastPlay;
      return stats.count >= minPlays && avgCompletion >= 0.8 && timeSincePlay >= twentyOneDaysMs;
    })
    .sort((a, b) => b[1].totalDuration - a[1].totalDuration)
    .map(([id]) => id);
  ```
  And `src/components/views/HomeView.tsx:496`:
  ```tsx
  {forgottenFavorites.length > 0 && (
    <section data-testid="forgotten-favorites-shelf" className="flex flex-col gap-4">
  ```
  When `plays.length === 0`, `forgottenIds` is `[]`, `generateForgottenFavorites` returns `[]`, and `HomeView.tsx:496` omits Shelf 5 completely.

- **Observation B (Daily Mix 1 `[] || fallback` truthiness)**:
  `src/services/recommendationEngine.ts:180`:
  ```ts
  tracks: catalogue.filter((t) => (t.sourceMetadata?.genre || '').toLowerCase().includes('electronic')).slice(0, 15) || catalogue.slice(0, 15),
  ```
  In JavaScript, `[]` is truthy, so `[].slice(0, 15) || catalogue.slice(0, 15)` returns `[]`. When catalogue lacks 'Electronic', `mix_1.tracks` is `[]`.

- **Observation C (Daily Mix 3 fixed slice overflow)**:
  `src/services/recommendationEngine.ts:194`:
  ```ts
  tracks: catalogue.slice(10, 25),
  ```
  When `catalogue.length <= 10` (e.g. `smallCatalogue` with 3 tracks), `catalogue.slice(10, 25)` begins after the array end and evaluates to `[]`. Similarly, line 187 `tracks: catalogue.slice(5, 20)` evaluates to `[]` when `catalogue.length <= 5`.

---

## 2. Logic Chain

1. **Cold Start User Experience & Acceptance Criteria**:
   - The user specification demands that on cold start with zero listening history, all 5 shelves ("Made For You", "Your Daily Mixes", "Discover Weekly", "Heavy Rotation", "Forgotten Favorites") render valid playable tracks without blank UI or crashes.
2. **Root Cause of Shelf 5 Blank UI**:
   - `recommendationEngine.generateForgottenFavorites` was designed solely for historical listeners ($\ge 21$ day gap). It lacked any cold-start handling branch.
   - When passed `emptyPlays`, it returned `[]`.
   - `HomeView.tsx` unconditionally gates Shelf 5 behind `{forgottenFavorites.length > 0 && (`, causing Shelf 5 to disappear from the page.
   - **Inference**: Adding a cold-start check `if (plays.length === 0)` that harvests nostalgic/classic catalogue tracks (Internet Archive items, classical/jazz/rock/vintage genres, pre-2015 tracks) with resilient reverse-catalogue padding guarantees that `generateForgottenFavorites` returns $\ge 1$ tracks, restoring Shelf 5 on `HomeView.tsx` without requiring breaking UI alterations.
3. **Root Cause of Mix 1 Empty Tracks**:
   - In `recommendationEngine.ts:180`, `filter(...).slice(0, 15) || catalogue.slice(0, 15)` relies on JavaScript `||` fallback.
   - Because `[]` is truthy, the fallback expression `catalogue.slice(0, 15)` is never evaluated when `filter` returns `[]`.
   - **Inference**: Checking array length explicitly (`matches.length > 0 ? matches.slice(0, 15) : fallback`) directly eliminates this defect.
4. **Root Cause of Mix 3 Empty Tracks & Clumping / Duplicate Runaway Risk**:
   - Slicing `catalogue.slice(10, 25)` hardcodes an assumption that `catalogue.length > 10`. On smaller catalogues, start index 10 is out of bounds, producing `[]`.
   - Furthermore, as demonstrated by Failure 9, duplicate track IDs in a mix or queue cause `playerStore.ts` backward-jump loops. Thus, padding must never introduce duplicate track IDs within a mix.
   - **Inference**: Using modulo arithmetic `(offset + i) % catalogue.length` bounded by `min(catalogue.length, 15)` guarantees:
     - Every mix gets $\min(N, 15)$ tracks (at least 1 track whenever $N \ge 1$).
     - No track ID is duplicated within any mix.
     - Each mix starts at a distinct offset (Mix 1: 0, Mix 2: 5, Mix 3: 10).
     - When $N \ge 25$, output is 100% equivalent to original slices (0..15, 5..20, 10..25).

---

## 3. Caveats

1. **Catalogue Size $N = 0$**: If the host application supplies an empty catalogue array (`catalogue.length === 0`), recommendation algorithms cannot generate tracks from nothing. Both `buildColdStartMix` and `getColdStartForgottenFavorites` safely return `[]` without throwing.
2. **Non-Cold-Start Historical Listeners**: For users with historical plays (`plays.length > 0`), the 21-day criteria remain in effect. This ensures baseline tests in `m2.spec.ts` (e.g. `cat_amb_1` 25 days ago vs `cat_amb_2` 5 days ago) remain 100% stable with no regressions.
3. **Failures 4–9**: Failures 4–5 (single-genre clustering), 6–7 (anti-clumping streak limits), and 8–9 (autoplay duplicate IDs and queue runaway) are scoped to companion remediation tasks and are not modified by this cold-start strategy.

---

## 4. Conclusion

Failures 1, 2, and 3 are fully diagnosed with clear, deterministic root causes in `src/services/recommendationEngine.ts`.
A detailed remediation blueprint has been authored in `plan_coldstart_fix.md`.
The proposed remediation:
1. Adds `getColdStartForgottenFavorites` to Shelf 5 returning nostalgic/classic catalogue tracks when `plays.length === 0`, ensuring `HomeView.tsx` renders all 5 shelves.
2. Fixes the JavaScript `||` truthiness bug on Daily Mix 1.
3. Implements `getCircularSlice` and `buildColdStartMix` providing resilient genre matching, circular offset rotation, and zero duplicate IDs for all cold-start Daily Mixes.

---

## 5. Verification Method

Once implemented by the implementer agent, verify with the following commands:

1. **Verify Adversarial Failures 1, 2, 3 Resolved**:
   ```powershell
   npx vitest run tests/unit/challenger_m2_2_adversarial.spec.ts -t "Cold Start"
   ```
   Must pass all 7 cold-start tests:
   - `Shelf 1 (Made For You) returns valid tracks on zero history`
   - `Shelf 2 (Discover Weekly) returns valid tracks on zero history`
   - `Shelf 3 (Daily Mix) returns valid DailyMix clusters with non-empty tracks on zero history`
   - `Shelf 3 (Daily Mix) cold start resilience when catalogue lacks Electronic genre`
   - `Shelf 3 (Daily Mix) cold start resilience when catalogue has fewer than 10 tracks`
   - `Shelf 4 (Heavy Rotation) returns valid tracks on zero history`
   - `Shelf 5 (Forgotten Favorites) returns valid tracks on zero history without blank UI`

2. **Verify Baseline Non-Adversarial Tests**:
   ```powershell
   npx vitest run tests/unit/m2.spec.ts
   npx vitest run tests/unit/tiers/tier1-features.spec.ts
   ```

3. **Verify Build**:
   ```powershell
   npm run build
   ```
