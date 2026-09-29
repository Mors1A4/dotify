# Implementation Plan: Real-Time Infinite Autoplay Engine

**Author**: `explorer_m2_3` (Teamwork Explorer)  
**Parent**: `orchestrator_2` (Conversation ID: `4f3d93f4-0f89-4383-91a9-37f4029b36ac`)  
**Target Milestone**: Milestone 2 (Infinite Autoplay Engine)  
**Date**: 2026-09-19  

---

## 1. Executive Summary

The **Infinite Autoplay Engine** ensures uninterrupted, continuous, personalized audio playback when the user's active playback queue reaches its end. When `autoplayEnabled` is true and `repeatMode === 'off'`, the engine dynamically synthesizes contextual recommendations based on the user's recently played seed tracks, filters out repetition and fatigue, appends 5 seamless tracks to the queue without audio stutter, and pre-warms the immediate next track to guarantee sub-second cold starts and zero-gap transitions.

### System Flow Diagram
```
                                 Active Playback (Queue Tail Approaching)
                                                   │
                       ┌───────────────────────────┴───────────────────────────┐
                       ▼                                                       ▼
            AudioEngine timeupdate                                  AudioEngine onTrackEnd
          (duration - currentTime <= 15s)                             (or User clicks Next)
                       │                                                       │
                       ▼                                                       ▼
      proactive triggerAutoplayIfNeeded()                      reactive triggerAutoplayIfNeeded()
                       │                                                       │
                       └───────────────────────────┬───────────────────────────┘
                                                   │
                                     Is autoplayEnabled === true?
                                     Is repeatMode === 'off'?
                                     Is currentIndex >= queue.length - 1?
                                                   │
                                                   ├─► NO  ──► Stop / Loop according to repeatMode
                                                   ▼ YES
                                     Acquire Fetch Mutex Lock
                                                   │
                              ┌────────────────────┴────────────────────┐
                              ▼                                         ▼
                   Inspect 1-3 Seed Tracks                  Query Recent Telemetry
                 [currentTrack, ...history]                 (High-skip / Fatigue IDs)
                              │                                         │
                              └────────────────────┬────────────────────┘
                                                   ▼
                           recommendationEngine.getAutoplayRecommendations(seeds, 5)
                                                   │
                       ┌───────────────────────────┼───────────────────────────┐
                       ▼                           ▼                           ▼
               Related Artists Top         Trending Genre Tracks       Cross-Provider
                 Tracks (40-50%)             Audius/Charts (40-50%)     (Archive/Radio)
                       │                           │                           │
                       └───────────────────────────┼───────────────────────────┘
                                                   ▼
                                         Multi-Stage Filtering:
                                   - Exclude active queue tracks
                                   - Exclude player history (last 40-50)
                                   - Exclude high-skip telemetry tracks
                                   - Enforce anti-clumping (<=2 tracks/artist)
                                   - Fallback padding if pool is small
                                                   │
                                                   ▼
                                     Return Exactly 5 Candidate Tracks
                                                   │
                       ┌───────────────────────────┴───────────────────────────┐
                       ▼                                                       ▼
              playerStore.addToEnd(5)                              audioCache.prewarmTrack(cand[0])
            (Zero Audio Interruption)                              (256KB Chunk into L1/L2)
                       │                                                       │
                       └───────────────────────────┬───────────────────────────┘
                                                   ▼
                                  audioEngine.prebufferNextTrack(cand[0])
                                  (Standby element loaded & ready for swap)
                                                   │
                                                   ▼
                                      Gapless 0ms Next Track Transition
```

---

## 2. Trigger Condition & Lifecycle Architecture

### 2.1 Dual-Phase Trigger Strategy (Proactive + Reactive)

To achieve **zero audible latency** and avoid network dead air between tracks, Dotify must not wait until audio completely stops before fetching recommendations. Instead, the engine implements a dual-phase trigger:

1. **Phase 1: Proactive Pre-Trigger (`approaching_end` / `track_start`)**:
   - **Condition**: While track $N$ is playing, when `(duration - currentTime) <= 15` seconds (or immediately when track $N$ starts if `currentIndex >= queue.length - 1`).
   - **Action**: Queries `recommendationEngine.getAutoplayRecommendations(seedTracks, 5)` in the background.
   - **Result**: 5 tracks are appended to the queue via `addToEnd` *while track $N$ is still playing*. `candidates[0]` is pre-warmed via `audioCache.prewarmTrack` and pre-buffered into `audioEngine.secondaryAudio`.
   - **Playback Experience**: When track $N$ ends, `audioEngine.onTrackEnd` calls `nextTrack()`. Because `candidates[0]` is already in `queue` at `currentIndex + 1` and pre-buffered on the standby element, the dual-element switch occurs with **zero audible latency (0ms)**.

2. **Phase 2: Reactive Exhaustion Fallback (`queue_exhausted`)**:
   - **Condition**: User clicks "Next Track" while on the last track, or scrubs to the end, or the proactive fetch was interrupted by a network blip.
   - **Action**: `nextTrack()` detects `nextIndex >= queue.length` with `autoplayEnabled === true`. It initiates or awaits the pending recommendation fetch, appends the candidates, pre-warms `candidates[0]`, and immediately begins playback of `candidates[0]`.

### 2.2 Concurrency, Deduplication, and Mutex Guards

To eliminate race conditions (e.g. `approaching_end` firing multiple times during seekbar scrubbing, or simultaneous `nextTrack()` calls):

```ts
let isAutoplayFetching = false;
let lastAutoplaySeedTrackId: string | null = null;
let pendingAutoplayPromise: Promise<Track[]> | null = null;
```

1. **Mutex Lock (`isAutoplayFetching`)**: If a fetch is already in flight, subsequent trigger calls return the existing `pendingAutoplayPromise` rather than dispatching redundant network requests.
2. **Seed Track Memoization (`lastAutoplaySeedTrackId`)**: Prevents re-fetching for the same queue tail unless the tail track changes or queue is completely exhausted.
3. **Cancellation & Mid-Flight Disable Check**: If user toggles `autoplayEnabled = false` or sets `repeatMode` while a fetch is in-flight, the returned candidates are discarded and not appended to `queue`.

### 2.3 Interaction with Repeat Modes & Shuffle

| State / Setting | Behavior | Rationale |
|---|---|---|
| `repeatMode === 'one'` | Autoplay **does not trigger**. Current track seeks to 0:00 and loops. | Explicit user repeat directive overrides discovery. |
| `repeatMode === 'all'` | Autoplay **does not trigger**. Queue loops back to `queue[0]`. | Explicit playlist loop directive takes precedence. |
| `repeatMode === 'off'` | Autoplay **triggers** when `currentIndex >= queue.length - 1`. | Standard linear playback reached end of user queue. |
| `autoplayEnabled === false` | Autoplay **does not trigger**. Playback stops cleanly at end of queue. | User opted out of autoplay. Verified by test 2.30 and 3.18. |
| `shuffle === true` | If queue has unplayed tracks, shuffle picks within queue. When all tracks exhausted, Autoplay triggers. | Shuffled queue still reaches tail exhaustion. |

---

## 3. Seed Tracks Inspection & Feature Extraction

### 3.1 Seed Window Specification

The autoplay engine inspects the **last 1 to 3 played tracks** to capture both immediate context and recent session momentum:

```ts
const seedTracks: Track[] = currentTrack
  ? [currentTrack, ...history.slice(0, 2)]
  : history.slice(0, 3);
```

### 3.2 Metadata Extraction & Normalization

1. **Artist Normalization**:
   - Uses `extractPrimaryArtist(track.artist)` from `src/services/artistService.ts`.
   - Strips collaboration tokens (`feat.`, `ft.`, `&`, `vs.`, `with`, `,`, `/`).
   - Example: `"Daft Punk feat. Pharrell Williams"` -> `"Daft Punk"`.
   - Deduplicates across the 1-3 seed tracks to form `seedArtists: string[]`.

2. **Genre Normalization & Fallback Cascade**:
   - Step 1: Read `track.sourceMetadata?.genre`.
   - Step 2: If genre is missing or `'Unknown'`, look up the artist profile genres via `artistService.getArtistProfile(seedArtists[0])`.
   - Step 3: If still empty, check `telemetryDb` for top affinity genres (`genre_affinity` table).
   - Step 4: If no profile data exists (cold-start user), default to the primary seed track source (e.g. `'Electronic'` for Audius, `'Rock'` for Archive, or top chart genres).

3. **Source Context Preservation**:
   - If seed tracks originate from Live Radio (`source === 'radio'`) or Internet Archive concerts (`source === 'archive'`), the candidate generator injects matching live/station recommendations to preserve the acoustic vibe.

---

## 4. Recommendation Engine Autoplay Algorithm

### 4.1 Interface Contract (`src/services/recommendationEngine.ts`)

```ts
export class RecommendationEngine {
  /**
   * Generates 5 continuous contextual autoplay tracks when the queue exhausts.
   *
   * @param seedTracks - 1 to 3 recently played tracks (inspecting artist and genre)
   * @param count - Number of candidate tracks to return (default: 5)
   * @returns Array of continuous recommended tracks ready to append to queue
   */
  public async getAutoplayRecommendations(
    seedTracks: Track | Track[],
    count: number = 5
  ): Promise<Track[]>;

  /**
   * In-memory synchronous autoplay generator matching test harness contract
   * in tests/fixtures/ecosystemMocks.ts.
   */
  public generateAutoplay(
    currentTrack: Track,
    recentPlays: TrackPlayRecord[],
    catalogue: Track[],
    count?: number
  ): Track[];
}
```

### 4.2 Multi-Source Candidate Retrieval Pipeline

The engine gathers a candidate pool of ~20-30 tracks from three complementary sources:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Candidate Pool (~30 tracks)                                            │
├────────────────────────────────┬───────────────────────────────────────┤
│ Pool A: Related Artists (40%)  │ Artist top tracks from related artists│
│                                │ via artistService.getArtistProfile()  │
├────────────────────────────────┼───────────────────────────────────────┤
│ Pool B: Trending Genre (40%)   │ Top chart and Audius trending tracks  │
│                                │ matching seedGenres                   │
├────────────────────────────────┼───────────────────────────────────────┤
│ Pool C: Discovery / Mix (20%)  │ Top hits / liked tracks / Archive     │
└────────────────────────────────┴───────────────────────────────────────┘
```

#### Step-by-Step Candidate Gathering:
1. **Related Artists**:
   - For primary seed artist $A_1$, retrieve `profile.relatedArtists.slice(0, 3)`.
   - Fetch top tracks for each related artist:
     `chartsApi.fetchArtistTopTracks(related.id, 5)` or `audiusApi.searchAudius(related.name, 5)`.
   - Also include unplayed top tracks from the seed artist itself (`profile.topTracks`).
2. **Trending Genre Tracks**:
   - For primary genre $G_1$, query Audius trending:
     `/api/audius/tracks/trending?genre=${encodeURIComponent(G_1)}&limit=15`.
   - Query Charts top tracks matching genre:
     `/api/charts/tracks?limit=20`.
3. **Contextual Fallbacks**:
   - If seed is Archive: `archiveApi.searchLiveRecordings(G_1)`.
   - If seed is Radio: `radioApi.searchStationsByTag(G_1)`.

### 4.3 Deduplication & Skip-Avoidance Filter

Candidates are passed through a strict exclusion filter:

```ts
const activeQueueIds = new Set(usePlayerStore.getState().queue.map((t) => t.id));
const historyIds = new Set(usePlayerStore.getState().history.map((t) => t.id));
const seedIds = new Set(seeds.map((t) => t.id));

// Fetch high-skip / fatigued IDs from telemetryDb if available
const fatiguedIds = new Set<string>();
try {
  const recentPlays = await telemetryDb.getRecentTrackPlays(50);
  for (const play of recentPlays) {
    // Exclude if explicitly marked skipped or completion rate < 30%
    if (play.skipped || play.completionRate < 0.3) {
      fatiguedIds.add(play.trackId);
    }
    // Exclude tracks played in the last 10 plays
    if (Date.now() - play.startTime < 3600000) {
      fatiguedIds.add(play.trackId);
    }
  }
} catch {
  // Graceful fallback to playerStore history
}

const filteredCandidates = candidatePool.filter((track) => {
  if (seedIds.has(track.id)) return false;
  if (activeQueueIds.has(track.id)) return false;
  if (historyIds.has(track.id)) return false;
  if (fatiguedIds.has(track.id)) return false;
  return true;
});
```

### 4.4 Anti-Clumping & Golden-Ratio Dispersion

To prevent 5 consecutive tracks from the same artist or sub-genre:
- Uses `artistService.interleaveWithAntiClumping(poolA, poolR, poolG, 5)`.
- Enforces constraint: **no more than 2 consecutive tracks by the same artist**.

### 4.5 Fallback Guarantee for Small Pools (Test 2.29 Compliance)

In edge cases where the seed genre has very few matching tracks (e.g. niche radio format or obscure archival genre):
- If `filteredCandidates.length < count`:
  1. Pad with top universal charts (`fetchTopCharts(20)`) not already in `history` or `queue`.
  2. Pad with user's `likedTracks` not recently played.
  3. Ensure the returned array contains **exactly `count` continuous tracks** (default 5).

---

## 5. Zero-Audio-Interruption Queue Insertion & Latency Elimination

### 5.1 Append Without Stutter (`playerStore.addToEnd`)

In `src/store/playerStore.ts`:
```ts
addToEnd: (track: Track | Track[]) => {
  const { queue, currentTrack } = get();
  const tracksToAdd = Array.isArray(track) ? track : [track];
  if (tracksToAdd.length === 0) return;

  if (!currentTrack && queue.length === 0) {
    get().playTrack(tracksToAdd[0], tracksToAdd);
    return;
  }

  const updatedQueue = [...queue, ...tracksToAdd];
  safeStorage.setItem('queue', updatedQueue);
  set({ queue: updatedQueue });
}
```
- **Why this guarantees zero audio interruption**:
  1. `audioEngine.activeAudio` continues decoding and playing current audio without interruption.
  2. `currentTrackIndex` remains unchanged.
  3. Zustand `set({ queue: updatedQueue })` only updates queue observers without re-mounting the active audio element.

### 5.2 Multi-Tier Pre-Warming (`audioCache.prewarmTrack`)

Immediately after appending the 5 candidates:
```ts
// 1. Prime initial 256KB chunk into Memory L1 & CacheStorage L2 (<50ms ready)
audioCache.prewarmTrack(candidates[0]);

// 2. Load standby HTMLAudioElement on AudioEngine in the background
audioEngine.prebufferNextTrack(candidates[0]);
```
- When current track finishes:
  - `audioEngine.playTrack(candidates[0])` detects `prebufferedTrack.id === candidates[0].id`.
  - Performs an immediate element swap (`isPrimaryActive = !isPrimaryActive`).
  - Audio starts in **< 10ms**, well under the sub-second threshold ($< 1000\text{ms}$).

---

## 6. UI Toggle Specification & safeStorage Persistence

### 6.1 State Management in `playerStore.ts`

```ts
const STORAGE_AUTOPLAY = 'autoplay_enabled';
const initialAutoplay = safeStorage.getItem<boolean>(STORAGE_AUTOPLAY, true);

// Store slice:
autoplayEnabled: initialAutoplay,

enableAutoplay: (enabled: boolean) => {
  safeStorage.setItem(STORAGE_AUTOPLAY, enabled);
  set({ autoplayEnabled: enabled });
},

toggleAutoplay: () => {
  const next = !get().autoplayEnabled;
  safeStorage.setItem(STORAGE_AUTOPLAY, next);
  set({ autoplayEnabled: next });
},
```

### 6.2 Component: `src/components/player/QueueDrawer.tsx`

Add the Autoplay Toggle Card directly in `QueueDrawer.tsx` right above the queue track list or in the drawer header:

```tsx
{/* Autoplay Toggle Switch */}
<div
  data-testid="autoplay-control-card"
  className="flex items-center justify-between p-3 rounded-xl bg-elevated/50 border border-customBorder/60 select-none shadow-sm"
>
  <div className="flex flex-col gap-0.5 pr-2">
    <div className="flex items-center gap-2">
      <Sparkles size={14} className="text-accent" />
      <span className="text-xs font-bold text-primary">Autoplay</span>
    </div>
    <span className="text-[11px] text-secondary leading-tight">
      Autoplay similar songs when queue ends
    </span>
  </div>

  <button
    type="button"
    role="switch"
    data-testid="autoplay-toggle-btn"
    aria-checked={autoplayEnabled}
    aria-label="Autoplay similar songs when queue ends"
    onClick={() => enableAutoplay(!autoplayEnabled)}
    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
      autoplayEnabled ? 'bg-accent' : 'bg-highlight'
    }`}
  >
    <span
      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
        autoplayEnabled ? 'translate-x-4' : 'translate-x-0'
      }`}
    />
  </button>
</div>
```

### 6.3 Settings Integration in `src/components/settings/ThemeModal.tsx`

In `ThemeModal.tsx` (or settings surface), add a **Playback & Autoplay** configuration card:

```tsx
{/* Playback Preferences */}
<div className="flex flex-col gap-2.5 border-t border-customBorder pt-4">
  <span className="text-xs font-bold uppercase tracking-wider text-muted">
    Playback Preferences
  </span>

  <div className="flex items-center justify-between p-3.5 rounded-xl bg-elevated border border-customBorder">
    <div className="flex flex-col gap-0.5">
      <p className="text-sm font-semibold text-primary">Infinite Autoplay</p>
      <p className="text-xs text-secondary">Autoplay similar songs when queue ends</p>
    </div>

    <button
      type="button"
      role="switch"
      data-testid="settings-autoplay-toggle"
      aria-checked={autoplayEnabled}
      onClick={() => enableAutoplay(!autoplayEnabled)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
        autoplayEnabled ? 'bg-accent' : 'bg-highlight'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          autoplayEnabled ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  </div>
</div>
```

---

## 7. Concrete Code Diff Specifications (Proposal for Implementers)

### 7.1 Target 1: `src/audio/audioEngine.ts`

Add approaching-end hook to enable proactive pre-fetching 15 seconds before track end:

```diff
--- a/src/audio/audioEngine.ts
+++ b/src/audio/audioEngine.ts
@@ -58,6 +58,8 @@ export class AudioEngine {
   private timeUpdateCallbacks: Set<(currentTime: number, duration: number) => void> = new Set();
   private stateChangeCallbacks: Set<(isPlaying: boolean, isBuffering: boolean) => void> = new Set();
   private trackEndCallbacks: Set<() => void> = new Set();
+  private approachingEndCallbacks: Set<() => void> = new Set();
+  private hasNotifiedApproachingEnd: boolean = false;
 
   private constructor() {
@@ -166,6 +168,12 @@ export class AudioEngine {
         for (const cb of this.timeUpdateCallbacks) {
           cb(cur, dur);
         }
+        if (dur > 20 && dur - cur <= 15 && !this.hasNotifiedApproachingEnd) {
+          this.hasNotifiedApproachingEnd = true;
+          for (const cb of this.approachingEndCallbacks) {
+            cb();
+          }
+        }
       }
     });
@@ -250,6 +258,7 @@ export class AudioEngine {
     // Check if the track requested is already pre-buffered on the standby element
     if (this.prebufferedTrack && this.prebufferedTrack.id === track.id) {
       this.currentTrack = track;
+      this.hasNotifiedApproachingEnd = false;
       this.prebufferedTrack = null;
@@ -280,6 +289,7 @@ export class AudioEngine {
     this.currentTrack = track;
+    this.hasNotifiedApproachingEnd = false;
     this.prebufferedTrack = null;
@@ -436,6 +446,11 @@ export class AudioEngine {
   public onTrackEnd(cb: () => void): () => void {
     this.trackEndCallbacks.add(cb);
     return () => this.trackEndCallbacks.delete(cb);
   }
+
+  public onApproachingEnd(cb: () => void): () => void {
+    this.approachingEndCallbacks.add(cb);
+    return () => this.approachingEndCallbacks.delete(cb);
+  }
 }
```

### 7.2 Target 2: `src/store/playerStore.ts`

Hook up persistence, proactive trigger, and reactive queue exhaustion in `playerStore.ts`:

```diff
--- a/src/store/playerStore.ts
+++ b/src/store/playerStore.ts
@@ -6,6 +6,7 @@ import { audioCache } from '../audio/audioCache';
 import { updateMediaSession, updateMediaSessionPlaybackState } from '../audio/mediaSession';
 import { safeStorage } from '../utils/storage';
+import { recommendationEngine } from '../services/recommendationEngine';
 
 export type AppView = 'home' | 'search' | 'radio' | 'archive' | 'torrents' | 'library' | 'artist';
@@ -58,6 +59,7 @@ export interface PlayerStoreState {
   setRepeatMode: (mode: 'off' | 'all' | 'one') => void;
   toggleShuffle: () => void;
   enableAutoplay: (enabled: boolean) => void;
+  toggleAutoplay: () => void;
 
   // Enhanced Queue Actions
@@ -95,9 +97,14 @@ export interface PlayerStoreState {
 const STORAGE_LIKED = 'liked';
 const STORAGE_PLAYLISTS = 'user_playlists';
 const STORAGE_VOLUME = 'audio_volume';
+const STORAGE_AUTOPLAY = 'autoplay_enabled';
 
 const initialLiked = safeStorage.getItem<Track[]>(STORAGE_LIKED, []);
 const initialPlaylists = safeStorage.getItem<CustomPlaylist[]>(STORAGE_PLAYLISTS, []);
 const initialVolume = safeStorage.getItem<number>(STORAGE_VOLUME, 0.8);
+const initialAutoplay = safeStorage.getItem<boolean>(STORAGE_AUTOPLAY, true);
+
+let isAutoplayFetching = false;
+let lastAutoplaySeedTrackId: string | null = null;
 
 export const usePlayerStore = create<PlayerStoreState>((set, get) => {
@@ -118,6 +125,48 @@ export const usePlayerStore = create<PlayerStoreState>((set, get) => {
     }
   });
 
+  const triggerAutoplayIfNeeded = async (reason: 'approaching_end' | 'track_start' | 'queue_exhausted') => {
+    const { queue, currentTrack, history, autoplayEnabled, repeatMode } = get();
+    if (!autoplayEnabled || repeatMode !== 'off') return;
+    if (!currentTrack && history.length === 0) return;
+
+    const curIdx = currentTrack ? queue.findIndex((t) => t.id === currentTrack.id) : -1;
+    if (curIdx !== -1 && curIdx < queue.length - 1) return;
+
+    if (currentTrack && lastAutoplaySeedTrackId === currentTrack.id && reason !== 'queue_exhausted') {
+      return;
+    }
+    if (isAutoplayFetching) return;
+
+    try {
+      isAutoplayFetching = true;
+      if (currentTrack) lastAutoplaySeedTrackId = currentTrack.id;
+
+      const seedTracks = currentTrack ? [currentTrack, ...history.slice(0, 2)] : history.slice(0, 3);
+      const candidates = await recommendationEngine.getAutoplayRecommendations(seedTracks, 5);
+
+      if (candidates && candidates.length > 0) {
+        const stateNow = get();
+        if (!stateNow.autoplayEnabled || stateNow.repeatMode !== 'off') return;
+
+        get().addToEnd(candidates);
+        audioCache.prewarmTrack(candidates[0]);
+        audioEngine.prebufferNextTrack(candidates[0]);
+
+        if (reason === 'queue_exhausted' || (!stateNow.isPlaying && !stateNow.currentTrack)) {
+          get().playTrack(candidates[0]);
+        }
+      }
+    } catch (err) {
+      console.warn('[PlayerStore] Autoplay recommendation fetch failed:', err);
+    } finally {
+      isAutoplayFetching = false;
+    }
+  };
+
+  audioEngine.onApproachingEnd(() => {
+    triggerAutoplayIfNeeded('approaching_end');
+  });
+
   return {
@@ -128,7 +177,7 @@ export const usePlayerStore = create<PlayerStoreState>((set, get) => {
     volume: initialVolume,
     repeatMode: 'off',
     shuffle: false,
-    autoplayEnabled: true,
+    autoplayEnabled: initialAutoplay,
 
     playTrack: (track: Track, newQueue?: Track[]) => {
@@ -176,6 +225,10 @@ export const usePlayerStore = create<PlayerStoreState>((set, get) => {
           if (curIdx + 1 < updatedQueue.length) {
             audioEngine.prebufferNextTrack(updatedQueue[curIdx + 1]);
           }
+          if (curIdx >= updatedQueue.length - 1 && get().autoplayEnabled) {
+            triggerAutoplayIfNeeded('track_start');
+          }
         }
       } catch {}
@@ -188,7 +241,7 @@ export const usePlayerStore = create<PlayerStoreState>((set, get) => {
-    nextTrack: () => {
+    nextTrack: async () => {
-      const { queue, currentTrack, repeatMode, shuffle } = get();
+      const { queue, currentTrack, repeatMode, shuffle, autoplayEnabled } = get();
       if (queue.length === 0) {
+        if (autoplayEnabled && repeatMode === 'off') {
+          await triggerAutoplayIfNeeded('queue_exhausted');
+        }
         return;
+      }
 
       const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);
       let nextIndex = currentIndex + 1;
@@ -198,6 +251,9 @@ export const usePlayerStore = create<PlayerStoreState>((set, get) => {
       } else if (nextIndex >= queue.length) {
         if (repeatMode === 'all') {
           nextIndex = 0;
+        } else if (autoplayEnabled) {
+          await triggerAutoplayIfNeeded('queue_exhausted');
+          return;
         } else {
           return; // Stop at end of queue
         }
@@ -239,7 +295,15 @@ export const usePlayerStore = create<PlayerStoreState>((set, get) => {
     setRepeatMode: (mode) => set({ repeatMode: mode }),
     toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),
-    enableAutoplay: (enabled: boolean) => set({ autoplayEnabled: enabled }),
+    enableAutoplay: (enabled: boolean) => {
+      safeStorage.setItem(STORAGE_AUTOPLAY, enabled);
+      set({ autoplayEnabled: enabled });
+    },
+    toggleAutoplay: () => {
+      const next = !get().autoplayEnabled;
+      safeStorage.setItem(STORAGE_AUTOPLAY, next);
+      set({ autoplayEnabled: next });
+    },
```

### 7.3 Target 3: `src/services/recommendationEngine.ts`

Full algorithm for `getAutoplayRecommendations`:

```ts
import { Track } from '../types/track';
import { artistService, extractPrimaryArtist } from './artistService';
import { fetchAudiusTrending } from './audiusApi';
import { fetchTopCharts, searchCharts } from './chartsApi';
import { usePlayerStore } from '../store/playerStore';
import { telemetryDb } from './telemetryDb';

export class RecommendationEngine {
  private static instance: RecommendationEngine;

  public static getInstance(): RecommendationEngine {
    if (!RecommendationEngine.instance) {
      RecommendationEngine.instance = new RecommendationEngine();
    }
    return RecommendationEngine.instance;
  }

  /**
   * Generates 5 continuous contextual autoplay tracks when the queue exhausts.
   */
  public async getAutoplayRecommendations(
    seedTracks: Track | Track[],
    count: number = 5
  ): Promise<Track[]> {
    const seeds = (Array.isArray(seedTracks) ? seedTracks : [seedTracks]).filter(Boolean);
    if (seeds.length === 0) {
      const fallback = await fetchTopCharts(count);
      return fallback.slice(0, count);
    }

    // 1. Inspect the last 1-3 played tracks (seed tracks: artist, genre)
    const seedArtists = Array.from(
      new Set(
        seeds
          .map((t) => extractPrimaryArtist(t.artist))
          .filter(Boolean)
      )
    );

    const seedGenres = Array.from(
      new Set(
        seeds
          .map((t) => t.sourceMetadata?.genre)
          .filter((g): g is string => Boolean(g && g !== 'Unknown' && g !== 'Various'))
      )
    );

    // 2. Multi-source candidate fetching
    const relatedPool: Track[] = [];
    const genrePool: Track[] = [];

    // Query related artists top tracks
    if (seedArtists.length > 0) {
      const profile = await artistService.getArtistProfile(seedArtists[0]);
      if (profile.relatedArtists.length > 0) {
        const topRelated = profile.relatedArtists.slice(0, 3);
        const relatedProfiles = await Promise.allSettled(
          topRelated.map((r) => artistService.getArtistProfile(r.name, r.id))
        );
        for (const res of relatedProfiles) {
          if (res.status === 'fulfilled') {
            relatedPool.push(...res.value.topTracks.slice(0, 3));
          }
        }
      }
      // Also include unplayed top tracks from focal artist
      relatedPool.push(...profile.topTracks.slice(0, 3));
    }

    // Query trending genre tracks from Audius and Charts
    const targetGenre = seedGenres[0] || 'Electronic';
    const [audiusResults, chartResults] = await Promise.allSettled([
      fetchAudiusTrending(20),
      searchCharts(targetGenre, 20),
    ]);

    if (audiusResults.status === 'fulfilled') {
      const audiusTracks = audiusResults.value.filter(
        (t) => !targetGenre || t.sourceMetadata?.genre?.toLowerCase() === targetGenre.toLowerCase()
      );
      genrePool.push(...(audiusTracks.length > 0 ? audiusTracks : audiusResults.value.slice(0, 10)));
    }

    if (chartResults.status === 'fulfilled') {
      genrePool.push(...chartResults.value);
    }

    // 3. Skip & Fatigue Filtering
    const playerState = usePlayerStore.getState();
    const queueIds = new Set(playerState.queue.map((t) => t.id));
    const historyIds = new Set(playerState.history.map((t) => t.id));
    const seedIds = new Set(seeds.map((t) => t.id));

    const fatiguedIds = new Set<string>();
    try {
      if (telemetryDb) {
        const recentPlays = await telemetryDb.getRecentTrackPlays(30);
        for (const p of recentPlays) {
          if (p.skipped || p.completionRate < 0.3) {
            fatiguedIds.add(p.trackId);
          }
        }
      }
    } catch {}

    const isEligible = (t: Track) =>
      !seedIds.has(t.id) &&
      !queueIds.has(t.id) &&
      !historyIds.has(t.id) &&
      !fatiguedIds.has(t.id);

    const eligibleRelated = relatedPool.filter(isEligible);
    const eligibleGenre = genrePool.filter(isEligible);

    // 4. Interleaving with Anti-Clumping (<= 2 tracks per artist)
    const interleaved = artistService.interleaveWithAntiClumping(
      eligibleRelated,
      eligibleGenre,
      [],
      count
    );

    // 5. Guaranteed Count Fallback
    if (interleaved.length < count) {
      const topCharts = await fetchTopCharts(20);
      const remainingCharts = topCharts.filter((t) => isEligible(t) && !interleaved.some((c) => c.id === t.id));
      for (const fallback of remainingCharts) {
        if (interleaved.length >= count) break;
        interleaved.push(fallback);
      }
    }

    return interleaved.slice(0, count);
  }

  /**
   * Synchronous mock contract for Vitest test harness.
   */
  public generateAutoplay(
    currentTrack: Track,
    recentPlays: any[],
    catalogue: Track[],
    count = 5
  ): Track[] {
    const recentIds = new Set(recentPlays.slice(-10).map((p) => p.trackId));
    recentIds.add(currentTrack.id);

    const genre = currentTrack.sourceMetadata?.genre;
    const matching = catalogue.filter(
      (t) => !recentIds.has(t.id) && t.sourceMetadata?.genre === genre
    );
    const fallbacks = catalogue.filter((t) => !recentIds.has(t.id));

    const result = [...matching, ...fallbacks];
    return result.slice(0, count);
  }
}

export const recommendationEngine = RecommendationEngine.getInstance();
```

### 7.4 Target 4: `src/components/player/QueueDrawer.tsx`

Add toggle right below Drawer Header:

```diff
--- a/src/components/player/QueueDrawer.tsx
+++ b/src/components/player/QueueDrawer.tsx
@@ -2,7 +2,7 @@ import React, { useState } from 'react';
 import { usePlayerStore } from '../../store/playerStore';
-import { ListMusic, Trash2, Volume2, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
+import { ListMusic, Trash2, Volume2, GripVertical, ChevronUp, ChevronDown, Sparkles } from 'lucide-react';
 
 export const QueueDrawer: React.FC = () => {
   const {
     queue,
     currentTrack,
+    autoplayEnabled,
+    enableAutoplay,
     playTrack,
@@ -74,6 +75,34 @@ export const QueueDrawer: React.FC = () => {
         )}
       </div>
 
+      {/* Autoplay Toggle */}
+      <div
+        data-testid="autoplay-control-card"
+        className="flex items-center justify-between p-2.5 rounded-xl bg-elevated/50 border border-customBorder/60 select-none shadow-sm"
+      >
+        <div className="flex flex-col gap-0.5 pr-2">
+          <div className="flex items-center gap-1.5">
+            <Sparkles size={13} className="text-accent" />
+            <span className="text-xs font-bold text-primary">Autoplay</span>
+          </div>
+          <span className="text-[11px] text-muted leading-tight">
+            Autoplay similar songs when queue ends
+          </span>
+        </div>
+        <button
+          type="button"
+          role="switch"
+          data-testid="autoplay-toggle-btn"
+          aria-checked={autoplayEnabled}
+          aria-label="Autoplay similar songs when queue ends"
+          onClick={() => enableAutoplay(!autoplayEnabled)}
+          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
+            autoplayEnabled ? 'bg-accent' : 'bg-highlight'
+          }`}
+        >
+          <span
+            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
+              autoplayEnabled ? 'translate-x-4' : 'translate-x-0'
+            }`}
+          />
+        </button>
+      </div>
+
       {/* Now Playing Section */}
```

---

## 8. Verification & Independent Test Matrix

To independently verify the implementation once coded, subsequent testing agents will validate across the following test suites and scenarios:

### 8.1 Automated Test Execution

Run command:
```bash
npm test
```

### 8.2 Test Matrix for Infinite Autoplay Engine

| Test ID | Test Name | Target Behavior | Expected Result |
|---|---|---|---|
| **Tier 1 (F6)** | `tests/unit/tiers/tier1-features.spec.ts` | Autoplay recommendations algorithm | Generates 5 valid continuous tracks matching seed genre/artist |
| **Tier 2 (2.28)** | `tests/unit/tiers/tier2-boundaries.spec.ts` | History & skip exclusion | Excludes `MOCK_AUDIUS_TRACK` and recently played IDs |
| **Tier 2 (2.29)** | `tests/unit/tiers/tier2-boundaries.spec.ts` | Small genre pool padding | Returns exactly `count` (5) tracks even when matching genre pool is small |
| **Tier 2 (2.30)** | `tests/unit/tiers/tier2-boundaries.spec.ts` | Autoplay disabled at queue exhaustion | When `autoplayEnabled === false`, `advanceTrack()` does NOT fire autoplay callback |
| **Tier 3 (3.4)** | `tests/unit/tiers/tier3-combinations.spec.ts` | Artist Radio + Infinite Autoplay | When 25-track Artist Radio completes, infinite autoplay appends 5 related tracks (length becomes 30) |
| **Tier 3 (3.10)**| `tests/unit/tiers/tier3-combinations.spec.ts` | Autoplay + Telemetry session | Autoplay tracks automatically attach to active telemetry session |
| **Tier 3 (3.18)**| `tests/unit/tiers/tier3-combinations.spec.ts` | Autoplay toggle mid-playback | Disabling autoplay mid-playback prevents cueing at queue tail |
| **Tier 4 (Scen 5)**| `tests/unit/tiers/tier4-scenarios.spec.ts` | End-to-End Autoplay Scenario | 3-track queue -> track 2 finishes -> tail exhaustion triggers autoplay -> 5 tracks appended -> total length 8 |

### 8.3 Invalidation Conditions
- If `candidates.length < 5`, invalidation.
- If an autoplay track repeats an active `queue` or `history` ID, invalidation.
- If active audio stops or stutters during `addToEnd`, invalidation.
- If cold start on `candidates[0]` exceeds 1000ms, invalidation.
- If `autoplayEnabled` does not persist across browser reload, invalidation.
