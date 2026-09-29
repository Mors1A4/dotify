# Implementation Plan: Cold Start & Empty Shelf Remediation (Failures 1, 2, and 3)

**Author**: `explorer_m2_it2_1`  
**Milestone**: Milestone 2 Iteration 2  
**Target Components**: `src/services/recommendationEngine.ts`, `src/components/views/HomeView.tsx`  
**Related Test Suite**: `tests/unit/challenger_m2_2_adversarial.spec.ts` (Failures 1, 2, 3)

---

## 1. Executive Summary & Problem Scope

During Milestone 2 Gate empirical adversarial testing (`challenger_m2_2`), 3 distinct failures were identified in cold-start recommendation generation when the user has zero listening history (`plays.length === 0`) or when the available catalogue is small / genre-restricted:

1. **Failure 1 (Shelf 5 / "Forgotten Favorites" Cold-Start Omission)**:
   - **File & Line**: `src/services/recommendationEngine.ts:282-334` and `src/components/views/HomeView.tsx:496`
   - **Defect**: `generateForgottenFavorites` calculates affinity based strictly on historical plays ($\ge 2$ plays, avg completion $\ge 0.8$, age $\ge 21$ days). When `plays.length === 0`, it returns `[]`.
   - **UI Impact**: On `HomeView.tsx:496`, `{forgottenFavorites.length > 0 && (` evaluates to `false`, completely hiding Shelf 5. This violates the core requirement: *"ensure all 5 shelves return valid tracks without crash or blank UI"*.

2. **Failure 2 (Daily Mix 1 Truthiness Bug `[] || fallback`)**:
   - **File & Line**: `src/services/recommendationEngine.ts:180`
   - **Defect**: `tracks: catalogue.filter(...).slice(0, 15) || catalogue.slice(0, 15)`. In JavaScript, `[].slice(0, 15)` returns an empty array `[]`, which is truthy (`Boolean([]) === true`). The logical OR `||` evaluates to `[]` and never reaches `catalogue.slice(0, 15)`.
   - **Impact**: When the catalogue lacks 'Electronic' tracks (as tested in adversarial suite), Daily Mix 1 returns 0 tracks (`mix1.tracks.length === 0`), causing test failure and unplayable mixes.

3. **Failure 3 (Daily Mix 3 / Cold-Start Catalogue Under-Run)**:
   - **File & Line**: `src/services/recommendationEngine.ts:194`
   - **Defect**: `tracks: catalogue.slice(10, 25)` (and `catalogue.slice(5, 20)` for Mix 2). When the catalogue contains $\le 10$ tracks (e.g. `smallCatalogue` with 3 tracks), `slice(10, 25)` begins after the array end and evaluates to `[]`.
   - **Impact**: Mix 3 returns 0 tracks when catalogue has $\le 10$ tracks, and Mix 2 returns 0 tracks when catalogue has $\le 5$ tracks. Clicking empty mix cards fails silently, violating the invariant that every Daily Mix must have $\ge 1$ track.

---

## 2. Root Cause Analysis (RCA)

### RCA 1: Shelf 5 ("Forgotten Favorites")
- **Mechanism**:
  ```ts
  const minPlays = plays.length >= 20 ? 4 : 2;
  const forgottenIds = Array.from(playStats.entries())
    .filter(([_, stats]) => {
      const avgCompletion = stats.totalCompletion / stats.count;
      const timeSincePlay = now - stats.lastPlay;
      return stats.count >= minPlays && avgCompletion >= 0.8 && timeSincePlay >= twentyOneDaysMs;
    })
    .sort((a, b) => b[1].totalDuration - a[1].totalDuration)
    .map(([id]) => id);

  return forgottenIds.map((id) => catalogueMap.get(id)).filter(Boolean) as Track[];
  ```
  When `plays` is empty:
  1. `playStats.entries()` has size 0.
  2. `forgottenIds` is `[]`.
  3. Method returns `[]`.
  Unlike Shelf 1 (`generateMadeForYou`), Shelf 2 (`generateDiscoverWeekly`), and Shelf 4 (`generateHeavyRotation`), Shelf 5 had **zero cold-start fallback branch**.
- **HomeView Consequence**:
  `HomeView.tsx:87` assigns `setForgottenFavorites([])`. At line 496, `{forgottenFavorites.length > 0 && (` prevents the JSX section from rendering. Only 4 shelves appear on the home screen.

### RCA 2: Daily Mix 1 JavaScript Truthiness
- **Mechanism**:
  ```ts
  tracks: catalogue.filter((t) => (t.sourceMetadata?.genre || '').toLowerCase().includes('electronic')).slice(0, 15) || catalogue.slice(0, 15),
  ```
  In JavaScript expressions:
  - `const a = [];`
  - `const result = a || fallback;` -> `result === a` (`[]`).
  The right-hand expression is dead code. Whenever `catalogue` has no tracks whose genre contains `'electronic'`, `mix_1.tracks` is guaranteed to be `[]`.

### RCA 3: Daily Mix 3 Fixed-Offset Slicing
- **Mechanism**:
  - `mix_1`: Starts at index 0.
  - `mix_2`: `catalogue.slice(5, 20)`.
  - `mix_3`: `catalogue.slice(10, 25)`.
  If `catalogue.length = N`:
  - For $N \le 5$, Mix 2 and Mix 3 are `[]`.
  - For $5 < N \le 10$, Mix 3 is `[]`.
  Fixed offsets assume an enterprise-sized catalogue ($N \ge 25$). When testing edge-case catalogues ($N=3$), the fixed offset slices outside array bounds.

---

## 3. Targeted Remediation Strategy & Algorithms

### Strategy 1: Cold-Start Fallback for Shelf 5 ("Forgotten Favorites")

When `plays.length === 0`, Shelf 5 must serve classic, timeless, and nostalgic tracks from the catalogue so the user immediately sees rich, curated content across all 5 shelves.

#### Algorithmic Heuristic:
1. **Nostalgic Classification**:
   Identify tracks that meet any of the following nostalgic/classic indicators:
   - `t.source === 'archive'`: Public domain live concerts, historic recordings from Internet Archive.
   - `genre` matches keywords: `classic`, `vintage`, `retro`, `archive`, `jazz`, `blues`, `rock`, `folk`, `acoustic`, `live`, `soul`, `traditional`.
   - `title` or `album` contains: `classic`, `live`, `vintage`, `remaster`, `greatest hits`, `unplugged`, `anthology`.
   - `sourceMetadata.year`: `parseInt(year) < 2015` if year metadata is present.
2. **Resilience & Fallback Guarantee**:
   - If $\ge 5$ nostalgic tracks exist in `catalogue`, return up to 15 of them.
   - If $< 5$ nostalgic tracks exist (or 0), pad with tracks from the reverse/end of `catalogue` (which represent deeper back-catalogue rather than trending hero tracks) up to `min(catalogue.length, 15)`.
   - Use `Set<string>` to guarantee that all returned track IDs are unique.
   - Guarantees: `shelf5.length > 0` whenever `catalogue.length > 0`.

---

### Strategy 2: Daily Mix 1 Truthiness Elimination

Replace the erroneous short-circuit operator with explicit array length inspection:
```ts
const electronicTracks = catalogue.filter((t) => {
  const g = (t.sourceMetadata?.genre || '').toLowerCase();
  return ['electronic', 'dance', 'techno', 'house', 'synthwave', 'edm'].some((kw) => g.includes(kw));
});

// Use electronicTracks if available; otherwise use rotated catalogue slice
const mix1Tracks = electronicTracks.length > 0
  ? electronicTracks.slice(0, 15)
  : this.getCircularSlice(catalogue, 0, 15);
```

---

### Strategy 3: Universal Circular Rotation & Padding for Daily Mixes

To guarantee that **every Daily Mix has $\ge 1$ track regardless of catalogue size** without ever introducing duplicate track IDs (which cause the queue backward-jump loop bug):

#### Circular Slice Formula:
For a catalogue of size $N$ and target count $C$ ($C=15$):
- Number of tracks to take: $K = \min(N, C)$.
- Starting index: $S = \text{offset} \pmod N$.
- Selected index at step $i \in [0, K-1]$:
  $$\text{index}_i = (S + i) \pmod N$$
- **Mathematical Property**: Since $K \le N$, each step $i$ produces a unique modulo index. No duplicate tracks can ever exist within a mix!

#### Unified Helper: `buildColdStartMix`
Combines genre prioritization with circular padding:
```ts
private getCircularSlice(catalogue: Track[], offset: number, count: number): Track[] {
  if (catalogue.length === 0) return [];
  const n = catalogue.length;
  const limit = Math.min(n, count);
  const start = offset % n;
  const result: Track[] = [];
  for (let i = 0; i < limit; i++) {
    result.push(catalogue[(start + i) % n]);
  }
  return result;
}

private buildColdStartMix(
  catalogue: Track[],
  genreKeywords: string[],
  offset: number,
  limit = 15
): Track[] {
  if (catalogue.length === 0) return [];

  const genreMatches = catalogue.filter((t) => {
    const g = (t.sourceMetadata?.genre || '').toLowerCase();
    return genreKeywords.some((kw) => g.includes(kw));
  });

  if (genreMatches.length >= limit || genreMatches.length >= catalogue.length) {
    return genreMatches.slice(0, limit);
  }

  // Start with genre matches, pad with circular slice from offset to ensure non-empty unique tracks
  const seen = new Set<string>();
  const tracks: Track[] = [];

  for (const t of genreMatches) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      tracks.push(t);
    }
  }

  const padTracks = this.getCircularSlice(catalogue, offset, Math.min(catalogue.length, limit));
  for (const t of padTracks) {
    if (tracks.length >= limit) break;
    if (!seen.has(t.id)) {
      seen.add(t.id);
      tracks.push(t);
    }
  }

  // Fallback if padTracks did not fill to limit
  if (tracks.length < limit && tracks.length < catalogue.length) {
    for (const t of catalogue) {
      if (tracks.length >= limit) break;
      if (!seen.has(t.id)) {
        seen.add(t.id);
        tracks.push(t);
      }
    }
  }

  return tracks.length > 0 ? tracks : this.getCircularSlice(catalogue, offset, limit);
}
```

---

## 4. Code Change Specifications

### File 1: `src/services/recommendationEngine.ts`

#### Change A: Update `generateDailyMixes` Cold-Start Branch (Lines 172-197)

**Before**:
```ts
    if (topGenres.length === 0) {
      // Cold-start default daily mixes
      return [
        {
          id: 'mix_1',
          title: 'Daily Mix 1',
          genre: 'Electronic / Dance',
          description: 'Cyberdrive, Neon Pulse, and high-energy electronic beats',
          tracks: catalogue.filter((t) => (t.sourceMetadata?.genre || '').toLowerCase().includes('electronic')).slice(0, 15) || catalogue.slice(0, 15),
        },
        {
          id: 'mix_2',
          title: 'Daily Mix 2',
          genre: 'Pop & Urban',
          description: 'Top charting mainstream hits, pop anthems, and modern urban vibes',
          tracks: catalogue.slice(5, 20),
        },
        {
          id: 'mix_3',
          title: 'Daily Mix 3',
          genre: 'Rock & Alternative',
          description: 'Indie rock legends, live concert master tapes, and acoustic classics',
          tracks: catalogue.slice(10, 25),
        },
      ];
    }
```

**After**:
```ts
    if (topGenres.length === 0) {
      // Cold-start default daily mixes with resilient circular padding & genre fallback
      return [
        {
          id: 'mix_1',
          title: 'Daily Mix 1',
          genre: 'Electronic / Dance',
          description: 'Cyberdrive, Neon Pulse, and high-energy electronic beats',
          tracks: this.buildColdStartMix(catalogue, ['electronic', 'dance', 'techno', 'house', 'synthwave', 'edm'], 0, 15),
        },
        {
          id: 'mix_2',
          title: 'Daily Mix 2',
          genre: 'Pop & Urban',
          description: 'Top charting mainstream hits, pop anthems, and modern urban vibes',
          tracks: this.buildColdStartMix(catalogue, ['pop', 'urban', 'hip hop', 'r&b', 'rap'], 5, 15),
        },
        {
          id: 'mix_3',
          title: 'Daily Mix 3',
          genre: 'Rock & Alternative',
          description: 'Indie rock legends, live concert master tapes, and acoustic classics',
          tracks: this.buildColdStartMix(catalogue, ['rock', 'alternative', 'metal', 'indie', 'punk'], 10, 15),
        },
      ];
    }
```

#### Change B: Add Cold-Start Fallback to `generateForgottenFavorites` (Lines 282-287)

**Before**:
```ts
  // Shelf 5: "Forgotten Favorites" - High historical affinity with strict 21-day gap
  public generateForgottenFavorites(
    plays: TrackPlayRecord[],
    catalogue: Track[],
    now = Date.now()
  ): Track[] {
    const twentyOneDaysMs = 21 * 86400 * 1000;
```

**After**:
```ts
  // Shelf 5: "Forgotten Favorites" - High historical affinity with strict 21-day gap
  public generateForgottenFavorites(
    plays: TrackPlayRecord[],
    catalogue: Track[],
    now = Date.now()
  ): Track[] {
    if (plays.length === 0) {
      return this.getColdStartForgottenFavorites(catalogue);
    }

    const twentyOneDaysMs = 21 * 86400 * 1000;
```

#### Change C: Add Helper Methods to `RecommendationEngine` class

```ts
  private getCircularSlice(catalogue: Track[], offset: number, count: number): Track[] {
    if (catalogue.length === 0) return [];
    const n = catalogue.length;
    const limit = Math.min(n, count);
    const start = offset % n;
    const result: Track[] = [];
    for (let i = 0; i < limit; i++) {
      result.push(catalogue[(start + i) % n]);
    }
    return result;
  }

  private buildColdStartMix(
    catalogue: Track[],
    genreKeywords: string[],
    offset: number,
    limit = 15
  ): Track[] {
    if (catalogue.length === 0) return [];

    const genreMatches = catalogue.filter((t) => {
      const g = (t.sourceMetadata?.genre || '').toLowerCase();
      return genreKeywords.some((kw) => g.includes(kw));
    });

    if (genreMatches.length >= limit || genreMatches.length >= catalogue.length) {
      return genreMatches.slice(0, limit);
    }

    const seen = new Set<string>();
    const tracks: Track[] = [];

    for (const t of genreMatches) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        tracks.push(t);
      }
    }

    const padTracks = this.getCircularSlice(catalogue, offset, Math.min(catalogue.length, limit));
    for (const t of padTracks) {
      if (tracks.length >= limit) break;
      if (!seen.has(t.id)) {
        seen.add(t.id);
        tracks.push(t);
      }
    }

    if (tracks.length < limit && tracks.length < catalogue.length) {
      for (const t of catalogue) {
        if (tracks.length >= limit) break;
        if (!seen.has(t.id)) {
          seen.add(t.id);
          tracks.push(t);
        }
      }
    }

    return tracks.length > 0 ? tracks : this.getCircularSlice(catalogue, offset, limit);
  }

  private getColdStartForgottenFavorites(catalogue: Track[], limit = 15): Track[] {
    if (catalogue.length === 0) return [];

    const nostalgicKeywords = [
      'classic',
      'vintage',
      'retro',
      'archive',
      'jazz',
      'blues',
      'rock',
      'folk',
      'acoustic',
      'live',
      'soul',
      'traditional',
    ];

    const nostalgicTracks = catalogue.filter((t) => {
      if (t.source === 'archive') return true;
      const g = (t.sourceMetadata?.genre || '').toLowerCase();
      const title = t.title.toLowerCase();
      const album = (t.album || '').toLowerCase();
      const year = parseInt(t.sourceMetadata?.year || '', 10);
      const isOlder = !isNaN(year) && year < 2015;

      return isOlder || nostalgicKeywords.some((kw) => g.includes(kw) || title.includes(kw) || album.includes(kw));
    });

    if (nostalgicTracks.length >= 5) {
      return nostalgicTracks.slice(0, limit);
    }

    const result: Track[] = [...nostalgicTracks];
    const seen = new Set(result.map((t) => t.id));

    for (let i = catalogue.length - 1; i >= 0 && result.length < limit; i--) {
      const candidate = catalogue[i];
      if (!seen.has(candidate.id)) {
        seen.add(candidate.id);
        result.push(candidate);
      }
    }

    return result.length > 0 ? result : catalogue.slice(0, limit);
  }
```

---

### File 2: `src/components/views/HomeView.tsx`

#### UI Verification for Shelf 5:
- In `HomeView.tsx:87`:
  ```ts
  setForgottenFavorites(recommendationEngine.generateForgottenFavorites(plays, catalogue));
  ```
  With the cold-start fallback returning valid tracks when `plays.length === 0`, `forgottenFavorites.length` will now be $\ge 1$.
- In `HomeView.tsx:496`:
  ```tsx
  {forgottenFavorites.length > 0 && (
    <section data-testid="forgotten-favorites-shelf" className="flex flex-col gap-4">
  ```
  Since `forgottenFavorites.length > 0` is now `true`, the shelf renders automatically without any breaking markup changes! All 5 shelves ("Made For You", "Your Daily Mixes", "Discover Weekly", "Heavy Rotation", "Forgotten Favorites") render cleanly on cold start.

---

## 5. Independent Verification & Validation Method

1. **Verify Adversarial Failures 1, 2, 3 Resolved**:
   ```powershell
   npx vitest run tests/unit/challenger_m2_2_adversarial.spec.ts -t "Cold Start"
   ```
   Expected result: All 7 cold-start tests pass cleanly:
   - `Shelf 1 (Made For You) returns valid tracks on zero history` -> PASS
   - `Shelf 2 (Discover Weekly) returns valid tracks on zero history` -> PASS
   - `Shelf 3 (Daily Mix) returns valid DailyMix clusters with non-empty tracks on zero history` -> PASS
   - `Shelf 3 (Daily Mix) cold start resilience when catalogue lacks Electronic genre` -> PASS
   - `Shelf 3 (Daily Mix) cold start resilience when catalogue has fewer than 10 tracks` -> PASS
   - `Shelf 4 (Heavy Rotation) returns valid tracks on zero history` -> PASS
   - `Shelf 5 (Forgotten Favorites) returns valid tracks on zero history without blank UI` -> PASS

2. **Verify Baseline Non-Adversarial Tests**:
   ```powershell
   npx vitest run tests/unit/m2.spec.ts
   npx vitest run tests/unit/tiers/tier1-features.spec.ts
   ```
   Expected result: 100% passing tests with zero regressions.

3. **Verify Build Integrity**:
   ```powershell
   npm run build
   ```
   Expected result: 0 TypeScript and bundling errors.
