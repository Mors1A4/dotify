# Remediation Plan: Duplicate Track IDs & Queue Runaway (Failures 8 & 9)

**Author**: `explorer_m2_it2_3`  
**Working Directory**: `c:\Users\monty\Documents\AB\notify\.agents\explorer_m2_it2_3`  
**Target Milestone**: Milestone 2 Iteration 2  
**Target Files**:
- `src/services/recommendationEngine.ts`
- `src/services/artistService.ts`
- `src/store/playerStore.ts`
- `src/components/player/QueueDrawer.tsx`

---

## 1. Executive Summary

Milestone 2 Gate evaluation identified 9 failures in `tests/unit/challenger_m2_2_adversarial.spec.ts`. This document provides the complete root cause analysis, architectural design, and concrete implementation specifications for **Failure 8** and **Failure 9**:

1. **Failure 8 — Duplicate Track IDs in `getAutoplayRecommendations`**:
   Tracks matching both seed artist and seed genre in `recommendationEngine.ts:420-428` were pushed to both `relatedPool` and `genrePool`. `interleaveWithAntiClumping` popped from both pools without cross-pool deduplication, causing the same track ID to appear multiple times in the recommendation output.
2. **Failure 9 — Queue Backward Jump & Runaway Loop**:
   In `playerStore.ts:316-317`, `nextTrack` located the active track via `queue.findIndex(t => t.id === currentTrack?.id)`. Because `findIndex` stops at the first match, any duplicate track ID in the queue resolved to index 0, causing playback to jump backward in queue order instead of advancing forward, trapping the player in an infinite 2-track oscillation loop.

---

## 2. Root Cause Analysis

### 2.1 Failure 8: Dual-Pool Ingestion & Lack of Batch Deduplication

#### Observations
In `src/services/recommendationEngine.ts:420-428`:
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
In `tests/unit/challenger_m2_2_adversarial.spec.ts:417-431`:
```typescript
const dualMatchTrack = createMockTrack('cat_e1', 'Synthwave Boy', 'Neon Highway', 'Electronic');
const seed = createMockTrack('seed_e', 'Synthwave Boy', 'Seed Song', 'Electronic');
const recs = await recommendationEngine.getAutoplayRecommendations([seed], 5, [dualMatchTrack]);
```
- `dualMatchTrack` matched `seedArtists` ('Synthwave Boy') $\to$ pushed to `relatedPool`.
- `dualMatchTrack` matched `seedGenres` ('Electronic') $\to$ pushed to `genrePool`.
- Both `eligibleRelated` and `eligibleGenre` contained `dualMatchTrack` (`id: 'cat_e1'`).
- `artistService.interleaveWithAntiClumping` popped `cat_e1` from `eligibleRelated`, then popped `cat_e1` again from `eligibleGenre` because `artistStreak` was 1 ($< 2$).
- Fallback padded remaining slots, producing 5 tracks with only 4 unique IDs.
- Result: `expect(ids.length).toBe(uniqueIds.size)` failed (Expected 4 to be 5, or 5 unique IDs expected).

#### Flaws Identified
1. **No Pool Disjointness**: Independent `if` checks allowed a single track to enter both candidate pools.
2. **No Pre-Interleave Cross-Pool Deduplication**: Neither pool was filtered against IDs already in the other pool.
3. **No Interleaver Uniqueness Invariant**: `interleaveWithAntiClumping` in `artistService.ts` only checked artist streaks, not track ID uniqueness.
4. **Autonomous Fallback ID Predictability**: Fallback generated IDs `autoplay:rec:${seed.id}:${interleaved.length + 1}`, which can collide if the same seed is used across sequential batches.

---

### 2.2 Failure 9: State Cursor Absence & First-Index Matching Trap

#### Observations
In `src/store/playerStore.ts:316-317`:
```typescript
const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);
let nextIndex = currentIndex + 1;
```
In `tests/unit/challenger_m2_2_adversarial.spec.ts:433-453`:
```typescript
const t0 = createMockTrack('dup_1', 'Artist 1', 'Song 1');
const t1 = createMockTrack('unique_2', 'Artist 2', 'Song 2');
const t2 = createMockTrack('dup_1', 'Artist 1', 'Song 1'); // DUPLICATE ID
const t3 = createMockTrack('unique_3', 'Artist 3', 'Song 3');

store.setQueue([t0, t1, t2, t3]);
store.playTrack(t2);
await store.nextTrack();
expect(currentTrackAfterNext?.id).toBe('unique_3'); // Received: 'unique_2'
```

#### Flaws Identified
1. **Missing State Cursor**: `PlayerStoreState` only tracked `currentTrack: Track | null`, with no `currentTrackIndex`.
2. **First-Match Index Trap**: `Array.prototype.findIndex()` searches from index 0. When `t2` (index 2) was playing, `findIndex` found `t0` at index 0. `nextIndex` became $0 + 1 = 1$ (`t1`).
3. **Infinite Oscillation**: Advancing from `t1` (index 1) led to `t2` (index 2). Advancing from `t2` jumped backward to `t1` (index 1). Index 3 was unreachable.
4. **Queue Drawer Mutation Flaws**:
   - `QueueDrawer.tsx:21`: `currentTrackIndex = currentTrack ? queue.findIndex(t => t.id === currentTrack.id) : -1`. Always highlighted index 0 even if index 2 was active.
   - `removeFromQueue(idx)`: Checked `queue[idx].id === currentTrack?.id`. Deleting upcoming index 2 falsely treated the playing track as removed and skipped playback.

---

## 3. Detailed Remediation Design

### 3.1 Failure 8: Multi-Tier Deduplication in Recommendation Engine

#### Tier 1: Candidate Pool Disjointness
When ingesting from `fallbackCatalogue`, classify each candidate into either `relatedPool` OR `genrePool`, never both:
```typescript
for (const catTrack of fallbackCatalogue) {
  const matchesArtist = seedArtists.includes(extractPrimaryArtist(catTrack.artist));
  const matchesGenre = seedGenres.includes(catTrack.sourceMetadata?.genre || '');
  if (matchesArtist) {
    relatedPool.push(catTrack);
  } else if (matchesGenre) {
    genrePool.push(catTrack);
  }
}
```

#### Tier 2: Cross-Pool & In-Pool Set Deduplication
Prior to interleaving, deduplicate within pools and ensure `genrePool` contains zero tracks already present in `relatedPool`:
```typescript
const seenCandidateIds = new Set<string>();
const uniqueRelated: Track[] = [];
for (const t of relatedPool) {
  if (!seenCandidateIds.has(t.id)) {
    seenCandidateIds.add(t.id);
    uniqueRelated.push(t);
  }
}

const uniqueGenre: Track[] = [];
for (const t of genrePool) {
  if (!seenCandidateIds.has(t.id)) {
    seenCandidateIds.add(t.id);
    uniqueGenre.push(t);
  }
}
```

#### Tier 3: Eligibility Filtering against Current Queue and History
Ensure candidate tracks are not already in the active player queue, playback history, input seeds, or fatigue set:
```typescript
const queueIds = new Set(playerState.queue.map((t) => t.id));
const historyIds = new Set(playerState.history.map((t) => t.id));
const seedIds = new Set(seeds.map((t) => t.id));

const isEligible = (t: Track) =>
  !seedIds.has(t.id) &&
  !queueIds.has(t.id) &&
  !historyIds.has(t.id) &&
  !fatiguedIds.has(t.id);

const eligibleRelated = uniqueRelated.filter(isEligible);
const eligibleGenre = uniqueGenre.filter(isEligible);
```

#### Tier 4: Interleaver Deduplication Defense
In `artistService.interleaveWithAntiClumping`, maintain `seenTrackIds = new Set<string>()`. The interleaver must reject any track whose ID has already been emitted:
```typescript
const seenTrackIds = new Set<string>();
const isEligible = (t: Track) =>
  !seenTrackIds.has(t.id) && (!currentArtist || t.artist !== currentArtist || streak < 2);
```
When picking next track:
```typescript
seenTrackIds.add(next.id);
result.push(next);
```

#### Tier 5: Batch-Level `seenBatchIds` Tracking for Fallbacks
Maintain `seenBatchIds = new Set<string>(queueIds)` across all fallback stages (catalogue fallback, charts fallback, and autonomous fallback). Every fallback item must be verified against `!seenBatchIds.has(candidate.id)`.

#### Tier 6: Guaranteed Unique Autonomous Fallback IDs
Generate collision-free IDs for autonomous fallback tracks using high-entropy suffixes:
```typescript
const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${interleaved.length + 1}`;
const fallbackId = `autoplay:rec:${seed.id}:${uniqueSuffix}`;
```

#### Tier 7: Final Defensive Pass
Immediately before returning, filter the final array through a `Set`:
```typescript
const finalOutput: Track[] = [];
const finalSeen = new Set<string>(queueIds);
for (const t of interleaved) {
  if (!finalSeen.has(t.id)) {
    finalSeen.add(t.id);
    finalOutput.push(t);
  }
}
return finalOutput.slice(0, count);
```

---

### 3.2 Failure 9: Queue Cursor System in `playerStore.ts`

#### Architectural Principles
1. A queue is an ordered array of playback slots indexed `0 .. queue.length - 1`.
2. `currentTrackIndex: number` must be an explicit, first-class property in `PlayerStoreState`.
3. Track advancement (`nextTrack`, `previousTrack`) must operate on `currentTrackIndex` as a numerical cursor.
4. `playTrack` must accept an optional `trackIndex?: number` parameter and use a 4-tier fallback for index resolution.

#### 4-Tier Queue Cursor Resolution in `playTrack`
When `playTrack(track, newQueue?, trackIndex?)` is called:
```typescript
let activeTrackIndex: number;
if (typeof trackIndex === 'number' && trackIndex >= 0 && trackIndex < updatedQueue.length) {
  // Tier 1: Explicit index passed by caller (e.g. nextTrack, previousTrack, QueueDrawer click)
  activeTrackIndex = trackIndex;
} else {
  // Tier 2: Reference equality check (matches exact object passed, e.g. store.playTrack(t2))
  const refIdx = updatedQueue.indexOf(track);
  if (refIdx !== -1) {
    activeTrackIndex = refIdx;
  } else {
    // Tier 3: Instance ID check if present
    const instIdx = (track as any)?._instanceId
      ? updatedQueue.findIndex((t) => (t as any)?._instanceId === (track as any)?._instanceId)
      : -1;
    if (instIdx !== -1) {
      activeTrackIndex = instIdx;
    } else {
      // Tier 4: Fallback to track ID matching
      const idIdx = updatedQueue.findIndex((t) => t.id === track.id);
      activeTrackIndex = idIdx !== -1 ? idIdx : 0;
    }
  }
}
```

#### Cursor-Driven `nextTrack`
```typescript
nextTrack: async () => {
  await finalizeCurrentPlayRecord();
  const { queue, currentTrack, currentTrackIndex, repeatMode, shuffle, autoplayEnabled } = get();
  if (queue.length === 0) {
    if (autoplayEnabled && repeatMode === 'off') {
      await triggerAutoplayIfNeeded('queue_exhausted');
    }
    return;
  }

  // Validate cursor or synchronize if invalid
  let currentIndex = currentTrackIndex;
  if (
    typeof currentIndex !== 'number' ||
    currentIndex < 0 ||
    currentIndex >= queue.length ||
    (currentTrack && queue[currentIndex]?.id !== currentTrack.id)
  ) {
    const refIdx = currentTrack ? queue.indexOf(currentTrack) : -1;
    currentIndex = refIdx !== -1 ? refIdx : currentTrack ? queue.findIndex((t) => t.id === currentTrack.id) : 0;
  }

  let nextIndex = currentIndex + 1;

  if (shuffle && queue.length > 1) {
    do {
      nextIndex = Math.floor(Math.random() * queue.length);
    } while (nextIndex === currentIndex && queue.length > 1);
  } else if (nextIndex >= queue.length) {
    if (repeatMode === 'all') {
      nextIndex = 0;
    } else if (autoplayEnabled) {
      await triggerAutoplayIfNeeded('queue_exhausted');
      return;
    } else {
      return; // Stop at end of queue
    }
  }

  const next = queue[nextIndex];
  if (next) {
    get().playTrack(next, undefined, nextIndex);
  }
}
```

#### Cursor-Driven `previousTrack`
```typescript
previousTrack: async () => {
  await finalizeCurrentPlayRecord();
  const { queue, currentTrack, currentTrackIndex, history } = get();
  if (history.length > 0) {
    const prev = history[0];
    set({ history: history.slice(1) });
    get().playTrack(prev);
    return;
  }

  if (queue.length === 0) return;
  let currentIndex = currentTrackIndex;
  if (
    typeof currentIndex !== 'number' ||
    currentIndex < 0 ||
    currentIndex >= queue.length ||
    (currentTrack && queue[currentIndex]?.id !== currentTrack.id)
  ) {
    const refIdx = currentTrack ? queue.indexOf(currentTrack) : -1;
    currentIndex = refIdx !== -1 ? refIdx : currentTrack ? queue.findIndex((t) => t.id === currentTrack.id) : 0;
  }

  const prevIndex = Math.max(0, currentIndex - 1);
  const prev = queue[prevIndex];
  if (prev) {
    get().playTrack(prev, undefined, prevIndex);
  }
}
```

#### Cursor Maintenance During Queue Mutations
- **`setQueue(queue: Track[])`**:
  ```typescript
  setQueue: (queue: Track[]) => {
    const { currentTrack } = get();
    let newIndex = -1;
    if (currentTrack) {
      const refIdx = queue.indexOf(currentTrack);
      newIndex = refIdx !== -1 ? refIdx : queue.findIndex((t) => t.id === currentTrack.id);
    }
    safeStorage.setItem('queue', queue);
    set({ queue, currentTrackIndex: newIndex });
  }
  ```
- **`playNext(track)`**: Inserts items at `currentIndex + 1`. The cursor position `currentIndex` does not shift.
- **`addToEnd(track)`**: Appends items at `queue.length`. The cursor position `currentIndex` does not shift.
- **`reorderQueue(fromIndex, toIndex)`**:
  Adjust cursor based on moved element:
  ```typescript
  let nextCursor = currentTrackIndex;
  if (currentTrackIndex === fromIndex) {
    nextCursor = toIndex;
  } else if (fromIndex < currentTrackIndex && toIndex >= currentTrackIndex) {
    nextCursor = currentTrackIndex - 1;
  } else if (fromIndex > currentTrackIndex && toIndex <= currentTrackIndex) {
    nextCursor = currentTrackIndex + 1;
  }
  set({ queue: updatedQueue, currentTrackIndex: nextCursor });
  ```
- **`removeFromQueue(idx)`**:
  Use index equality (`idx === currentTrackIndex`) rather than ID equality:
  ```typescript
  removeFromQueue: (idx: number) => {
    const { queue, currentTrackIndex } = get();
    if (idx < 0 || idx >= queue.length) return;

    const isCurrent = idx === currentTrackIndex;
    const updatedQueue = queue.filter((_, i) => i !== idx);

    let nextCursor = currentTrackIndex;
    if (idx < currentTrackIndex) {
      nextCursor = currentTrackIndex - 1;
    }

    safeStorage.setItem('queue', updatedQueue);
    set({ queue: updatedQueue, currentTrackIndex: nextCursor });

    if (isCurrent) {
      if (updatedQueue.length > 0) {
        const newIdx = Math.min(idx, updatedQueue.length - 1);
        get().playTrack(updatedQueue[newIdx], undefined, newIdx);
      } else {
        audioEngine.pause();
        set({ currentTrack: null, currentTrackIndex: -1, isPlaying: false });
      }
    }
  }
  ```
- **`clearQueue()`**:
  ```typescript
  clearQueue: () => {
    const { currentTrack } = get();
    const updatedQueue = currentTrack ? [currentTrack] : [];
    safeStorage.setItem('queue', updatedQueue);
    set({ queue: updatedQueue, currentTrackIndex: currentTrack ? 0 : -1 });
    audioEngine.prebufferNextTrack(null);
  }
  ```
- **`triggerAutoplayIfNeeded(reason)`**:
  ```typescript
  const { currentTrackIndex, queue } = get();
  const curIdx = currentTrackIndex >= 0 ? currentTrackIndex : currentTrack ? queue.findIndex((t) => t.id === currentTrack.id) : -1;
  if (curIdx !== -1 && curIdx < queue.length - 1) return;
  ```

---

## 4. Implementation Code Changes (Before $\to$ After)

### 4.1 Target: `src/services/recommendationEngine.ts`

```diff
@@ -420,12 +420,13 @@
     if (fallbackCatalogue && fallbackCatalogue.length > 0) {
       for (const catTrack of fallbackCatalogue) {
-        if (seedArtists.includes(extractPrimaryArtist(catTrack.artist))) {
+        const matchesArtist = seedArtists.includes(extractPrimaryArtist(catTrack.artist));
+        const matchesGenre = seedGenres.includes(catTrack.sourceMetadata?.genre || '');
+        if (matchesArtist) {
           relatedPool.push(catTrack);
-        }
-        if (seedGenres.includes(catTrack.sourceMetadata?.genre || '')) {
+        } else if (matchesGenre) {
           genrePool.push(catTrack);
         }
       }
     }
@@ -450,11 +451,26 @@
     const playerState = usePlayerStore.getState();
     const queueIds = new Set(playerState.queue.map((t) => t.id));
     const historyIds = new Set(playerState.history.map((t) => t.id));
     const seedIds = new Set(seeds.map((t) => t.id));
+
+    // Deduplicate candidate pools internally and across pools
+    const seenCandidateIds = new Set<string>();
+    const uniqueRelated: Track[] = [];
+    for (const t of relatedPool) {
+      if (!seenCandidateIds.has(t.id)) {
+        seenCandidateIds.add(t.id);
+        uniqueRelated.push(t);
+      }
+    }
+    const uniqueGenre: Track[] = [];
+    for (const t of genrePool) {
+      if (!seenCandidateIds.has(t.id)) {
+        seenCandidateIds.add(t.id);
+        uniqueGenre.push(t);
+      }
+    }

     const isEligible = (t: Track) =>
       !seedIds.has(t.id) &&
       !queueIds.has(t.id) &&
       !historyIds.has(t.id) &&
       !fatiguedIds.has(t.id);

-    const eligibleRelated = relatedPool.filter(isEligible);
-    const eligibleGenre = genrePool.filter(isEligible);
+    const eligibleRelated = uniqueRelated.filter(isEligible);
+    const eligibleGenre = uniqueGenre.filter(isEligible);
@@ -515,13 +531,14 @@
     if (interleaved.length < count) {
+      const seenBatchIds = new Set<string>([...queueIds, ...interleaved.map((t) => t.id)]);
       for (let i = 0; interleaved.length < count; i++) {
         const seed = seeds[i % seeds.length];
         const artist = i % 2 === 0 ? seed.artist : `${seed.artist} Echo`;
         const currentArtistCount = interleaved.filter((t) => t.artist === artist).length;
+        const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${interleaved.length + 1}`;
+        const recId = `autoplay:rec:${seed.id}:${uniqueSuffix}`;
+        if (seenBatchIds.has(recId)) continue;
+        seenBatchIds.add(recId);
         if (currentArtistCount < 2) {
           interleaved.push({
-            id: `autoplay:rec:${seed.id}:${interleaved.length + 1}`,
+            id: recId,
             source: seed.source,
@@ -547,7 +564,15 @@
-    return interleaved.slice(0, count);
+    const finalOutput: Track[] = [];
+    const finalSeen = new Set<string>(queueIds);
+    for (const t of interleaved) {
+      if (!finalSeen.has(t.id)) {
+        finalSeen.add(t.id);
+        finalOutput.push(t);
+      }
+    }
+    return finalOutput.slice(0, count);
```

---

### 4.2 Target: `src/services/artistService.ts`

```diff
@@ -403,6 +403,7 @@
     const result: Track[] = [];
     const poolA = [...anchor];
     const poolR = [...related];
     const poolG = [...discovery];
+    const seenTrackIds = new Set<string>();

     const pickNext = (currentArtist: string | null, streak: number): Track | null => {
-      const isEligible = (t: Track) => !currentArtist || t.artist !== currentArtist || streak < 2;
+      const isEligible = (t: Track) => !seenTrackIds.has(t.id) && (!currentArtist || t.artist !== currentArtist || streak < 2);
@@ -435,9 +436,12 @@
       // If strict anti-clumping cannot be satisfied, take any remaining track
-      if (poolA.length > 0) return poolA.shift()!;
-      if (poolR.length > 0) return poolR.shift()!;
-      if (poolG.length > 0) return poolG.shift()!;
+      const anyUnseen = (t: Track) => !seenTrackIds.has(t.id);
+      const aIdx = poolA.findIndex(anyUnseen);
+      if (aIdx !== -1) return poolA.splice(aIdx, 1)[0];
+      const rIdx = poolR.findIndex(anyUnseen);
+      if (rIdx !== -1) return poolR.splice(rIdx, 1)[0];
+      const gIdx = poolG.findIndex(anyUnseen);
+      if (gIdx !== -1) return poolG.splice(gIdx, 1)[0];

       return null;
     };

     let lastArtist: string | null = null;
     let artistStreak = 0;

     while (result.length < totalLength && (poolA.length > 0 || poolR.length > 0 || poolG.length > 0)) {
       const next = pickNext(lastArtist, artistStreak);
       if (!next) break;
+      seenTrackIds.add(next.id);
```

---

### 4.3 Target: `src/store/playerStore.ts`

```diff
@@ -23,6 +23,7 @@
 export interface PlayerStoreState {
   currentTrack: Track | null;
+  currentTrackIndex: number;
   queue: Track[];
   history: Track[];
@@ -54,6 +55,6 @@
-  playTrack: (track: Track, newQueue?: Track[]) => void;
+  playTrack: (track: Track, newQueue?: Track[], trackIndex?: number) => void;
@@ -227,6 +228,7 @@
   return {
     currentTrack: null,
+    currentTrackIndex: -1,
     queue: [],
@@ -254,11 +256,31 @@
-    playTrack: (track: Track, newQueue?: Track[]) => {
+    playTrack: (track: Track, newQueue?: Track[], trackIndex?: number) => {
       finalizeCurrentPlayRecord();

       const { queue, history, currentTrack } = get();
       if (currentTrack) {
         set({ history: [currentTrack, ...history.slice(0, 40)] });
       }

       const updatedQueue = newQueue ? [...newQueue] : queue.length > 0 ? queue : [track];
+      let activeTrackIndex: number;
+      if (typeof trackIndex === 'number' && trackIndex >= 0 && trackIndex < updatedQueue.length) {
+        activeTrackIndex = trackIndex;
+      } else {
+        const refIdx = updatedQueue.indexOf(track);
+        if (refIdx !== -1) {
+          activeTrackIndex = refIdx;
+        } else {
+          const instIdx = (track as any)?._instanceId
+            ? updatedQueue.findIndex((t) => (t as any)?._instanceId === (track as any)?._instanceId)
+            : -1;
+          if (instIdx !== -1) {
+            activeTrackIndex = instIdx;
+          } else {
+            const idIdx = updatedQueue.findIndex((t) => t.id === track.id);
+            activeTrackIndex = idIdx !== -1 ? idIdx : 0;
+          }
+        }
+      }
       safeStorage.setItem('queue', updatedQueue);
-      set({ currentTrack: track, queue: updatedQueue });
+      set({ currentTrack: track, currentTrackIndex: activeTrackIndex, queue: updatedQueue });
@@ -308,9 +330,22 @@
     nextTrack: async () => {
       await finalizeCurrentPlayRecord();
-      const { queue, currentTrack, repeatMode, shuffle, autoplayEnabled } = get();
+      const { queue, currentTrack, currentTrackIndex, repeatMode, shuffle, autoplayEnabled } = get();
       if (queue.length === 0) {
         if (autoplayEnabled && repeatMode === 'off') {
           await triggerAutoplayIfNeeded('queue_exhausted');
         }
         return;
       }

-      const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);
+      let currentIndex = currentTrackIndex;
+      if (
+        typeof currentIndex !== 'number' ||
+        currentIndex < 0 ||
+        currentIndex >= queue.length ||
+        (currentTrack && queue[currentIndex]?.id !== currentTrack.id)
+      ) {
+        const refIdx = currentTrack ? queue.indexOf(currentTrack) : -1;
+        currentIndex = refIdx !== -1 ? refIdx : currentTrack ? queue.findIndex((t) => t.id === currentTrack.id) : 0;
+      }
       let nextIndex = currentIndex + 1;
@@ -334,3 +369,3 @@
       if (next) {
-        get().playTrack(next);
+        get().playTrack(next, undefined, nextIndex);
       }
@@ -340,9 +375,19 @@
     previousTrack: async () => {
       await finalizeCurrentPlayRecord();
-      const { queue, currentTrack, history } = get();
+      const { queue, currentTrack, currentTrackIndex, history } = get();
       if (history.length > 0) {
         const prev = history[0];
         set({ history: history.slice(1) });
         get().playTrack(prev);
         return;
       }

       if (queue.length === 0) return;
-      const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);
+      let currentIndex = currentTrackIndex;
+      if (
+        typeof currentIndex !== 'number' ||
+        currentIndex < 0 ||
+        currentIndex >= queue.length ||
+        (currentTrack && queue[currentIndex]?.id !== currentTrack.id)
+      ) {
+        const refIdx = currentTrack ? queue.indexOf(currentTrack) : -1;
+        currentIndex = refIdx !== -1 ? refIdx : currentTrack ? queue.findIndex((t) => t.id === currentTrack.id) : 0;
+      }
       const prevIndex = Math.max(0, currentIndex - 1);
       const prev = queue[prevIndex];
       if (prev) {
-        get().playTrack(prev);
+        get().playTrack(prev, undefined, prevIndex);
       }
     },
@@ -382,2 +427,8 @@
     setQueue: (queue: Track[]) => {
+      const { currentTrack } = get();
+      let newIndex = -1;
+      if (currentTrack) {
+        const refIdx = queue.indexOf(currentTrack);
+        newIndex = refIdx !== -1 ? refIdx : queue.findIndex((t) => t.id === currentTrack.id);
+      }
       safeStorage.setItem('queue', queue);
-      set({ queue });
+      set({ queue, currentTrackIndex: newIndex });
     },
@@ -455,3 +506,12 @@
+      let nextCursor = currentTrackIndex;
+      if (currentTrackIndex === fromIndex) {
+        nextCursor = toIndex;
+      } else if (fromIndex < currentTrackIndex && toIndex >= currentTrackIndex) {
+        nextCursor = currentTrackIndex - 1;
+      } else if (fromIndex > currentTrackIndex && toIndex <= currentTrackIndex) {
+        nextCursor = currentTrackIndex + 1;
+      }
       safeStorage.setItem('queue', updatedQueue);
-      set({ queue: updatedQueue });
+      set({ queue: updatedQueue, currentTrackIndex: nextCursor });
@@ -468,7 +528,12 @@
     removeFromQueue: (idx: number) => {
-      const { queue, currentTrack, nextTrack } = get();
+      const { queue, currentTrackIndex } = get();
       if (idx < 0 || idx >= queue.length) return;

-      const isCurrent = queue[idx].id === currentTrack?.id;
+      const isCurrent = idx === currentTrackIndex;
       const updatedQueue = queue.filter((_, i) => i !== idx);
+      let nextCursor = currentTrackIndex;
+      if (idx < currentTrackIndex) {
+        nextCursor = currentTrackIndex - 1;
+      }

       safeStorage.setItem('queue', updatedQueue);
-      set({ queue: updatedQueue });
+      set({ queue: updatedQueue, currentTrackIndex: nextCursor });

       if (isCurrent) {
         if (updatedQueue.length > 0) {
-          nextTrack();
+          const newIdx = Math.min(idx, updatedQueue.length - 1);
+          get().playTrack(updatedQueue[newIdx], undefined, newIdx);
         } else {
           audioEngine.pause();
-          set({ currentTrack: null, isPlaying: false });
+          set({ currentTrack: null, currentTrackIndex: -1, isPlaying: false });
         }
       }
     },
```

---

### 4.4 Target: `src/components/player/QueueDrawer.tsx`

```diff
@@ -7,2 +7,3 @@
     queue,
+    currentTrackIndex,
     currentTrack,
@@ -21,1 +22,0 @@
-  const currentTrackIndex = currentTrack ? queue.findIndex((t) => t.id === currentTrack.id) : -1;
@@ -163,1 +163,1 @@
-  onClick={() => playTrack(track, queue)}
+  onClick={() => playTrack(track, queue, idx)}
```

---

## 5. Verification Matrix & Test Strategy

### 5.1 Verification Commands
1. **Adversarial Suite (Specific Failure 8 & 9 check)**:
   ```powershell
   npx vitest run tests/unit/challenger_m2_2_adversarial.spec.ts -t "Rapid Queue Runout"
   ```
   Must pass both:
   - `checks for duplicate track IDs in getAutoplayRecommendations when tracks match both artist and genre`
   - `demonstrates queue runaway / backward jump loop bug when duplicate track IDs exist in queue`
   - `extends queue smoothly without duplicate runaway or audio disruption across 25 consecutive runouts`
   - `stress-tests concurrent rapid exhaustion calls (race condition resistance)`

2. **Full Regression Suite**:
   ```powershell
   npx vitest run
   ```
   Must pass all 273+ unit and adversarial tests across all 14 test files.

3. **TypeScript Build Verification**:
   ```powershell
   npm run build
   ```
   Must complete with 0 compile errors and 0 type warnings.

### 5.2 Edge-Case Coverage Matrix
| Scenario | Precondition | Execution | Expected Invariant |
| :--- | :--- | :--- | :--- |
| **Dual-Match Catalogue** | Track matches seed artist AND genre | Call `getAutoplayRecommendations(seed, 5, [dualMatch])` | Track ID appears exactly once; total returned has 5 unique IDs |
| **Duplicate IDs in Queue** | Queue has `[t0(dup), t1(uniq), t2(dup), t3(uniq)]` | Play `t2`, call `nextTrack()` | Playback advances to `t3`, cursor updates to 3 |
| **Reverse from Duplicate** | Queue has `[t0(dup), t1(uniq), t2(dup), t3(uniq)]` | Play `t2`, call `previousTrack()` | Playback retreats to `t1`, cursor updates to 1 |
| **Delete Inactive Duplicate** | Index 0 is `dup`, Index 2 is `dup` (active) | Call `removeFromQueue(0)` | Active playback of index 2 is NOT stopped; cursor decrements to 1 |
| **Delete Active Duplicate** | Index 2 is active in `[t0, t1, t2, t3]` | Call `removeFromQueue(2)` | Shifts to `t3` at index 2, playback starts immediately |
| **Queue Reorder with Dups** | Drag index 2 to index 0 | Call `reorderQueue(2, 0)` | Cursor updates to 0; `nextTrack()` advances to index 1 |
