# Handoff Report — Milestone 2 Empirical Adversarial Stress Test

# Verdict: DISPROVED

## 1. Observation
An empirical adversarial test suite was authored in `tests/unit/challenger_m2_2_adversarial.spec.ts` (17 tests) and executed against Milestone 2 components (`src/services/recommendationEngine.ts`, `src/services/artistService.ts`, and `src/store/playerStore.ts`).

Command executed:
```powershell
npx vitest run tests/unit/challenger_m2_2_adversarial.spec.ts
```

Result:
```
Test Files  1 failed (1)
Tests       9 failed | 8 passed (17)
Duration    2.06s
```

### Specific Verbatim Test Failures and Source Code Locations

#### Failure 1 & 2: Cold Start Daily Mix Empty Tracks
- **Location**: `src/services/recommendationEngine.ts:180` and `src/services/recommendationEngine.ts:194`
- **Verbatim Code**:
  ```ts
  // Line 180:
  tracks: catalogue.filter((t) => (t.sourceMetadata?.genre || '').toLowerCase().includes('electronic')).slice(0, 15) || catalogue.slice(0, 15),
  // Line 187:
  tracks: catalogue.slice(5, 20),
  // Line 194:
  tracks: catalogue.slice(10, 25),
  ```
- **Verbatim Test Errors**:
  ```
  FAIL 1. Cold Start Recommendation Generation (Zero Listening History) > Shelf 3 (Daily Mix) cold start resilience when catalogue lacks Electronic genre
  AssertionError: expected 0 to be greater than 0
  at tests/unit/challenger_m2_2_adversarial.spec.ts:148:35

  FAIL 1. Cold Start Recommendation Generation (Zero Listening History) > Shelf 3 (Daily Mix) cold start resilience when catalogue has fewer than 10 tracks
  AssertionError: expected 0 to be greater than 0
  at tests/unit/challenger_m2_2_adversarial.spec.ts:162:35
  ```

#### Failure 3: Shelf 5 (Forgotten Favorites) Empty on Cold Start
- **Location**: `src/services/recommendationEngine.ts:282-334` and `src/components/views/HomeView.tsx:496`
- **Verbatim Code**:
  ```ts
  // recommendationEngine.ts:282-334:
  public generateForgottenFavorites(plays: TrackPlayRecord[], catalogue: Track[], now = Date.now()): Track[] {
    ...
    return forgottenIds.map((id) => catalogueMap.get(id)).filter(Boolean) as Track[];
  }
  // HomeView.tsx:496:
  {forgottenFavorites.length > 0 && (
    <section data-testid="forgotten-favorites-shelf" className="flex flex-col gap-4">
  ```
- **Verbatim Test Error**:
  ```
  FAIL 1. Cold Start Recommendation Generation (Zero Listening History) > Shelf 5 (Forgotten Favorites) returns valid tracks on zero history without blank UI
  AssertionError: expected 0 to be greater than 0
  at tests/unit/challenger_m2_2_adversarial.spec.ts:181:29
  ```

#### Failure 4 & 5: Single-Genre Profile Produces 100% Identical Duplicate Mix Clusters
- **Location**: `src/services/recommendationEngine.ts:206-223`
- **Verbatim Code**:
  ```ts
  const targetGenres = topGenres.length === 1 ? [topGenres[0], 'Alternative / Discovery'] : topGenres.slice(0, 3);

  return targetGenres.map((genre, idx) => {
    const isCustomFallback = genre === 'Alternative / Discovery';
    const genreTracks = isCustomFallback
      ? catalogue.filter((t) => (t.sourceMetadata?.genre || '').toLowerCase() !== topGenres[0].toLowerCase())
      : catalogue.filter((t) => (t.sourceMetadata?.genre || '').toLowerCase().includes(genre.toLowerCase()));

    const pool = genreTracks.length > 0 ? genreTracks : catalogue;
    ...
  ```
- **Verbatim Test Errors**:
  ```
  FAIL 2. Single-Genre User Listening Profile (Daily Mix Cohesion & Clustering) > handles single-genre listener when catalogue ONLY contains tracks of that single genre
  AssertionError: expected 'oe1,oe2,oe3,oe4' not to be 'oe1,oe2,oe3,oe4'
  at tests/unit/challenger_m2_2_adversarial.spec.ts:243:27

  FAIL 2. Single-Genre User Listening Profile (Daily Mix Cohesion & Clustering) > handles single-genre listener whose genre is not present in catalogue
  AssertionError: expected 'cat_a1,cat_a2,cat_c1,cat_e1,cat_e2,ca…' not to be 'cat_a1,cat_a2,cat_c1,cat_e1,cat_e2,ca…'
  at tests/unit/challenger_m2_2_adversarial.spec.ts:262:27
  ```

#### Failure 6 & 7: Anti-Clumping Surrenders Streak Limits Under Single-Artist Seeds/Catalogue
- **Location**: `src/services/artistService.ts:435-438` and `src/services/recommendationEngine.ts:477-482`
- **Verbatim Code**:
  ```ts
  // artistService.ts:435-438:
  // If strict anti-clumping cannot be satisfied, take any remaining track
  if (poolA.length > 0) return poolA.shift()!;
  if (poolR.length > 0) return poolR.shift()!;
  if (poolG.length > 0) return poolG.shift()!;
  ```
- **Verbatim Test Errors**:
  ```
  FAIL 3. Infinite Autoplay Anti-Clumping (<= 2 Consecutive Tracks by Same Artist) > stress-tests artistService.interleaveWithAntiClumping directly when pools contain single-artist clumping
  AssertionError: expected 3 to be less than or equal to 2
  at tests/unit/challenger_m2_2_adversarial.spec.ts:330:30

  FAIL 3. Infinite Autoplay Anti-Clumping (<= 2 Consecutive Tracks by Same Artist) > verifies anti-clumping when all input seeds and fallback catalogue belong to a SINGLE artist
  AssertionError: expected 6 to be less than or equal to 2
  at tests/unit/challenger_m2_2_adversarial.spec.ts:368:30
  ```

#### Failure 8 & 9: Duplicate Track IDs in Recommendations Cause Queue Backward-Jump Loop Runaway
- **Location**: `src/services/recommendationEngine.ts:420-428` and `src/store/playerStore.ts:316-317`
- **Verbatim Code**:
  ```ts
  // recommendationEngine.ts:420-428:
  for (const catTrack of fallbackCatalogue) {
    if (seedArtists.includes(extractPrimaryArtist(catTrack.artist))) {
      relatedPool.push(catTrack);
    }
    if (seedGenres.includes(catTrack.sourceMetadata?.genre || '')) {
      genrePool.push(catTrack);
    }
  }
  // playerStore.ts:316-317:
  const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);
  let nextIndex = currentIndex + 1;
  ```
- **Verbatim Test Errors**:
  ```
  FAIL 4. Rapid Queue Runout (20+ Repeated Exhaustion Triggers) > checks for duplicate track IDs in getAutoplayRecommendations when tracks match both artist and genre
  AssertionError: expected 5 to be 4
  - Expected: 4
  + Received: 5
  at tests/unit/challenger_m2_2_adversarial.spec.ts:430:26

  FAIL 4. Rapid Queue Runout (20+ Repeated Exhaustion Triggers) > demonstrates queue runaway / backward jump loop bug when duplicate track IDs exist in queue
  AssertionError: expected 'unique_2' to be 'unique_3'
  Expected: "unique_3"
  Received: "unique_2"
  at tests/unit/challenger_m2_2_adversarial.spec.ts:451:41
  ```

---

## 2. Logic Chain

1. **Cold Start Failure Mode**:
   - The user specification demands: *"1. Cold start recommendation generation with zero listening history (ensure all 5 shelves return valid tracks without crash or blank UI)."*
   - In `recommendationEngine.ts:282-334`, `generateForgottenFavorites` returns only tracks with $\ge 2$ historical plays, avg completion $\ge 0.8$, and $> 21$ days age. With 0 plays, `forgottenIds` is empty (`[]`). There is no cold-start fallback, causing Shelf 5 to return 0 tracks.
   - In `HomeView.tsx:496`, `{forgottenFavorites.length > 0 && (` is false, causing Shelf 5 to be completely hidden on the UI.
   - In `recommendationEngine.ts:180`, `mix_1` executes `catalogue.filter(...).slice(0, 15) || catalogue.slice(0, 15)`. In JavaScript, an empty array `[]` is truthy, so `[] || fallback` evaluates to `[]`. When the catalogue does not contain 'electronic' in `sourceMetadata.genre`, Mix 1 has 0 tracks.
   - In `recommendationEngine.ts:194`, `mix_3` executes `catalogue.slice(10, 25)`. If the catalogue contains $\le 10$ tracks, Mix 3 has 0 tracks. Clicking a 0-track mix card does nothing because `if (mix.tracks.length > 0)` suppresses execution.

2. **Single-Genre Listener Failure Mode**:
   - The specification demands: *"2. Single-genre user listening profile (ensure Daily Mix does not crash or generate duplicate clusters)."*
   - In `recommendationEngine.ts:206-223`, for single-genre listeners, `targetGenres` is set to `[topGenres[0], 'Alternative / Discovery']`.
   - If the catalogue consists exclusively of that genre (or if user top genre is absent from the catalogue), `genreTracks` for Mix 2 evaluates to `[]`.
   - The code then executes `const pool = genreTracks.length > 0 ? genreTracks : catalogue;`, causing Mix 2 to fall back to the entire catalogue — exactly the same pool as Mix 1.
   - Consequently, Mix 1 and Mix 2 receive identical track arrays (Jaccard similarity = 1.0), violating the requirement of non-duplicate clusters.

3. **Infinite Autoplay Anti-Clumping Failure Mode**:
   - The specification demands: *"3. Infinite Autoplay anti-clumping: verify that no more than 2 consecutive tracks by the same artist are generated even when input seeds contain single-artist loops."*
   - In `artistService.ts:435-438`, `interleaveWithAntiClumping` implements a fallback:
     ```ts
     if (poolA.length > 0) return poolA.shift()!;
     if (poolR.length > 0) return poolR.shift()!;
     if (poolG.length > 0) return poolG.shift()!;
     ```
   - When all input seeds and catalogue candidates belong to a single artist, `isEligible` fails as soon as `streak >= 2`. The fallback executes anyway, completely bypassing the streak check.
   - Empirical execution demonstrated that when fed single-artist loops, `getAutoplayRecommendations` emits **6 consecutive tracks by the exact same artist**, directly violating the $\le 2$ consecutive tracks invariant.

4. **Rapid Queue Runout & Duplicate Runaway Failure Mode**:
   - The specification demands: *"4. Rapid queue runout: trigger queue exhaustion repeatedly (20+ times); verify queue extends smoothly without duplicate runaway or audio disruption."*
   - In `recommendationEngine.ts:420-428`, any track matching both the seed artist and seed genre is pushed to `relatedPool` AND `genrePool`.
   - `interleaveWithAntiClumping` pops from both pools without ID deduplication, returning duplicate tracks with identical IDs.
   - In `playerStore.ts:316-317`, track advancement is computed via:
     `const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);`
     `let nextIndex = currentIndex + 1;`
   - When duplicate track IDs are present in `queue`, `queue.findIndex` finds the **first** index where the ID appears (index 0). When the player is playing the duplicate at index 2, `currentIndex` resolves to 0, and `nextIndex` resolves to 1 (`unique_2`) instead of 3 (`unique_3`).
   - Playback jumps backward, trapping the player in an infinite loop / duplicate runaway cycle.

---

## 3. Caveats
- Baseline tests in `tests/unit/m2.spec.ts` pass (26 tests) only because those tests use pre-conditioned, non-adversarial mock datasets where catalogue tracks never dual-match pools, genres are balanced, and input seeds contain multi-artist distributions.
- When tested under hostile, adversarial edge conditions, the underlying algorithms fail 9 out of 17 test cases.
- Challenger operates under strict review-only constraints; implementation fixes were not applied.

---

## 4. Conclusion
**Verdict: DISPROVED**

Milestone 2 recommendation engine and infinite autoplay do not meet all operational guarantees under adversarial edge cases. Specifically:
1. Cold-start generation omits Shelf 5 (`Forgotten Favorites`), and creates empty Daily Mixes under non-electronic or small catalogues.
2. Single-genre listening profiles produce 100% duplicate Daily Mix clusters when catalogue tracks match the user's genre or when user genre is missing from catalogue.
3. Infinite Autoplay violates anti-clumping, generating up to 6 consecutive tracks by the same artist when input seeds contain single-artist loops.
4. Recommendation generation produces duplicate track IDs when tracks dual-match artist and genre, causing backward-jumping queue runaway in `playerStore.ts`.

Remediation is required in `recommendationEngine.ts`, `artistService.ts`, and `playerStore.ts` before Milestone 2 can be verified as complete.

---

## 5. Verification Method
To independently reproduce and verify all 9 failures:
```powershell
npx vitest run tests/unit/challenger_m2_2_adversarial.spec.ts
```
Expected output: 9 failed tests, 8 passed tests.

Key files for code inspection:
- `src/services/recommendationEngine.ts` (lines 180, 194, 206-223, 282-334, 420-428)
- `src/services/artistService.ts` (lines 435-438)
- `src/store/playerStore.ts` (lines 316-317)
- `src/components/views/HomeView.tsx` (line 496)
