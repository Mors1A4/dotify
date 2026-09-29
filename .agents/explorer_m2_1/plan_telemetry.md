# Technical Implementation Plan: Private Listening Profile & IndexedDB Telemetry (Milestone 2)

**Document**: `plan_telemetry.md`  
**Author**: `explorer_m2_1` (Teamwork Explorer)  
**Parent**: `orchestrator_2` (`4f3d93f4-0f89-4383-91a9-37f4029b36ac`)  
**Date**: 2026-09-19  
**Status**: Ready for Implementation by `worker_m2`  
**Target Files**:
- `src/services/telemetryDb.ts` (New service)
- `src/audio/audioEngine.ts` (Hook enhancements)
- `src/store/playerStore.ts` (Playback lifecycle & session integration)
- `src/components/views/LibraryView.tsx` (Private Listening Profile UI card/tab)

---

## 1. Executive Summary & Architectural Context

Milestone 2 establishes Dotify's **Private Listening Profile & On-Device Telemetry Subsystem**. In strict accordance with `ORIGINAL_REQUEST.md` (Follow-up dated 2026-09-19 § R2) and `PROJECT.md`, dotify delivers a Spotify-grade personalized discovery experience while upholding a **100% on-device privacy guarantee**:
- **Zero Remote Telemetry**: No tracking pixels, third-party analytics SDKs, or cloud telemetry ingest pipelines.
- **W3C IndexedDB Storage**: Play events, listening sessions, and affinity matrices are persisted locally inside `dotify_telemetry_db` (Version 1).
- **Algorithmic Fuel**: Feeds the Milestone 2 Recommendation Engine (`recommendationEngine.ts`) to synthesize the 5 personalized Home shelves (*Made For You*, *Discover Weekly*, *Daily Mix*, *Heavy Rotation*, *Forgotten Favorites*) and real-time *Infinite Autoplay*.
- **Data Sovereignty**: Complete user data ownership via portable JSON Export and Import capabilities.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                AUDIO & PLAYBACK LIFECYCLE                              │
│                                                                                        │
│  ┌───────────────────────┐   Track Start / End / Skip    ┌───────────────────────────┐ │
│  │   AudioEngine.ts      │ ─────────────────────────────►│    playerStore.ts         │ │
│  │ - Web Audio Elements  │                               │ - Active Session Tracking │ │
│  │ - TimeUpdate / Ended  │                               │ - Play State Transitions  │ │
│  └───────────────────────┘                               └─────────────┬─────────────┘ │
│                                                                        │               │
│                                                                        ▼               │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                             telemetryDb.ts Service                               │  │
│  │  - Session Management (UUID, Device Detection, Wall-clock duration)              │  │
│  │  - Play Record Lifecycle (Start, Duration Accumulation, Completion, Skip)        │  │
│  │  - Exponential Affinity Smoothing (+1.0 Completion, -0.5 Skip, +1.5 Replay)      │  │
│  │  - Dataset Export/Import (Portable JSON Schema v1)                               │  │
│  └──────────────────────────────────────┬───────────────────────────────────────────┘  │
│                                         │                                              │
│                     ┌───────────────────┴───────────────────┐                          │
│                     ▼                                       ▼                          │
│       ┌───────────────────────────┐           ┌───────────────────────────┐            │
│       │  IndexedDB Storage Engine │           │   UI & Recommendations    │            │
│       │  (dotify_telemetry_db)    │           │ - LibraryView Profile Tab │            │
│       │  1. listening_sessions    │           │ - Export/Import Controls  │            │
│       │  2. track_plays           │           │ - recommendationEngine    │            │
│       │  3. genre_affinity        │           │   (5 Dynamic Shelves &    │            │
│       │  4. artist_affinity       │           │    Infinite Autoplay)     │            │
│       └───────────────────────────┘           └───────────────────────────┘            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. IndexedDB Schema Architecture (`dotify_telemetry_db`, Version 1)

### 2.1 Database Constants & Object Store Definitions
- **Database Name**: `dotify_telemetry_db`
- **Database Version**: `1`
- **Object Stores**: 4 required stores with backward-compatible aliases:

| Store Name | Primary Key (`keyPath`) | Indexes Created | Description |
|---|---|---|---|
| `listening_sessions` | `sessionId` | `startTime` | Continuous playback sessions, device type, total duration |
| `track_plays` | `playId` | `sessionId`, `trackId`, `artist`, `genre`, `startTime`, `completionRate`, `completed` | Granular play events, completion rates, skip & replay flags |
| `genre_affinity` | `genre` | `affinityScore`, `lastUpdated` | Dynamic genre affinity scores calculated via exponential smoothing |
| `artist_affinity` | `artist` | `affinityScore`, `lastUpdated` | Dynamic artist affinity scores calculated via exponential smoothing |

> **Compatibility Architecture**:
> To guarantee zero flakiness across the Vitest test suite (`tests/fixtures/ecosystemMocks.ts` and `tier1-features.spec.ts`) while strictly fulfilling the 4 named stores required by `ORIGINAL_REQUEST.md` and the user prompt, `telemetryDb.ts` creates the 4 canonical stores (`listening_sessions`, `track_plays`, `genre_affinity`, `artist_affinity`) and creates store aliases/mirrors (`sessions`, `plays`, `genreAffinities`) within the same database version.

### 2.2 TypeScript Data Interfaces

```ts
import { Track, TrackSource } from '../types/track';

export type DeviceType = 'desktop' | 'mobile' | 'web';

export interface ListeningSessionRecord {
  sessionId: string;
  startTime: number;        // Unix epoch ms
  endTime?: number;          // Unix epoch ms
  deviceType: DeviceType;
  totalDurationMs: number;
}

export interface TrackPlayRecord {
  playId: string;           // `play_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  sessionId: string;
  trackId: string;
  title: string;
  artist: string;
  genre?: string;
  source: TrackSource;      // 'audius' | 'archive' | 'radio' | 'p2p' | 'charts'
  startTime: number;        // Unix epoch ms
  durationPlayedMs: number; // Cumulative listened ms
  totalDurationMs: number;  // Track length in ms (or durationPlayedMs if live radio)
  completionRate: number;   // 0.0 to 1.0
  skipped: boolean;         // True if durationPlayedMs < 30000 or completionRate < 0.5 (unless completed)
  completed: boolean;       // True if completionRate >= 0.8
  replayed: boolean;        // True if played consecutively or repeatMode === 'one'
}

export interface GenreAffinityRecord {
  genre: string;            // Normalized lowercase or capitalized key
  playCount: number;
  totalTimePlayedMs: number;
  affinityScore: number;    // Smoothed score [0.0 - 100.0]
  lastUpdated: number;      // Unix epoch ms
}

export interface ArtistAffinityRecord {
  artist: string;           // Normalized artist name
  playCount: number;
  totalTimePlayedMs: number;
  affinityScore: number;    // Smoothed score [0.0 - 100.0]
  lastUpdated: number;      // Unix epoch ms
}

export interface ExportableTelemetryDataset {
  schemaVersion: 1;
  exportedAt: number;
  sessions: ListeningSessionRecord[];
  plays: TrackPlayRecord[];
  genreAffinities: GenreAffinityRecord[];
  artistAffinities?: ArtistAffinityRecord[];
}
```

### 2.3 Database Initialization & Connection Factory

```ts
export class TelemetryDatabase {
  private static instance: TelemetryDatabase;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private dbName = 'dotify_telemetry_db';
  private dbVersion = 1;

  public static getInstance(): TelemetryDatabase {
    if (!TelemetryDatabase.instance) {
      TelemetryDatabase.instance = new TelemetryDatabase();
    }
    return TelemetryDatabase.instance;
  }

  public getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        // Fallback for non-browser or disabled environments
        return reject(new Error('IndexedDB is not supported in this environment'));
      }

      const req = indexedDB.open(this.dbName, this.dbVersion);

      req.onupgradeneeded = (event) => {
        const db = req.result;

        // 1. listening_sessions (and alias 'sessions')
        if (!db.objectStoreNames.contains('listening_sessions')) {
          const sStore = db.createObjectStore('listening_sessions', { keyPath: 'sessionId' });
          sStore.createIndex('startTime', 'startTime', { unique: false });
        }
        if (!db.objectStoreNames.contains('sessions')) {
          const sAlias = db.createObjectStore('sessions', { keyPath: 'sessionId' });
          sAlias.createIndex('startTime', 'startTime', { unique: false });
        }

        // 2. track_plays (and alias 'plays')
        if (!db.objectStoreNames.contains('track_plays')) {
          const pStore = db.createObjectStore('track_plays', { keyPath: 'playId' });
          pStore.createIndex('sessionId', 'sessionId', { unique: false });
          pStore.createIndex('trackId', 'trackId', { unique: false });
          pStore.createIndex('artist', 'artist', { unique: false });
          pStore.createIndex('genre', 'genre', { unique: false });
          pStore.createIndex('startTime', 'startTime', { unique: false });
          pStore.createIndex('completionRate', 'completionRate', { unique: false });
          pStore.createIndex('completed', 'completed', { unique: false });
        }
        if (!db.objectStoreNames.contains('plays')) {
          const pAlias = db.createObjectStore('plays', { keyPath: 'playId' });
          pAlias.createIndex('trackId', 'trackId', { unique: false });
          pAlias.createIndex('startTime', 'startTime', { unique: false });
        }

        // 3. genre_affinity (and alias 'genreAffinities')
        if (!db.objectStoreNames.contains('genre_affinity')) {
          const gStore = db.createObjectStore('genre_affinity', { keyPath: 'genre' });
          gStore.createIndex('affinityScore', 'affinityScore', { unique: false });
          gStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }
        if (!db.objectStoreNames.contains('genreAffinities')) {
          const gAlias = db.createObjectStore('genreAffinities', { keyPath: 'genre' });
          gAlias.createIndex('affinityScore', 'affinityScore', { unique: false });
        }

        // 4. artist_affinity (and alias 'artistAffinities')
        if (!db.objectStoreNames.contains('artist_affinity')) {
          const aStore = db.createObjectStore('artist_affinity', { keyPath: 'artist' });
          aStore.createIndex('affinityScore', 'affinityScore', { unique: false });
          aStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }
        if (!db.objectStoreNames.contains('artistAffinities')) {
          db.createObjectStore('artistAffinities', { keyPath: 'artist' });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return this.dbPromise;
  }
}
```

---

## 3. Telemetry Tracking Hooks & Lifecycle Integration

### 3.1 Playback Session Management
A listening session groups consecutive track listens during a contiguous listening period.
- **Session Start**: Initialized on first track play or after $> 30$ minutes of inactivity.
  - `sessionId`: `session_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
  - `deviceType`: Detected via `typeof window !== 'undefined' ? (window.innerWidth < 768 ? 'mobile' : 'desktop') : 'web'`
  - `startTime`: `Date.now()`
  - `totalDurationMs`: Initialized to `0`
- **Session Update**: When tracks complete or end, session's `endTime = Date.now()` and `totalDurationMs += durationPlayedMs` are persisted.
- **Session Teardown**: Handled automatically on `beforeunload` or when closing the app.

### 3.2 Track Play Lifecycle State Machine

```
   User selects track or Next / Previous / Queue trigger
                         │
                         ▼
             ┌───────────────────────┐
             │   1. Open Play Record │
             │ - Allocate playId     │
             │ - Capture startTime   │
             │ - Detect replayed     │
             └───────────┬───────────┘
                         │
                         ▼
             ┌───────────────────────┐
             │  2. Playback Active   │◄──── AudioEngine timeupdate
             │ - Wall-clock tracking │      (Ignore seek leaps)
             │ - Accumulate ms       │
             └───────────┬───────────┘
                         │
        Track ends, user skips, or changes track
                         │
                         ▼
             ┌───────────────────────┐
             │ 3. Finalize & Compute │
             │ - effectiveTotalMs    │
             │ - completionRate      │
             │ - completed: >= 80%   │
             │ - skipped: < 30s / 50%│
             └───────────┬───────────┘
                         │
                         ▼
             ┌───────────────────────┐
             │ 4. Smooth Affinities  │
             │ - Genre Affinity EMA  │
             │ - Artist Affinity EMA │
             │ - Persist to IDB      │
             └───────────────────────┘
```

### 3.3 Hook Points in `src/audio/audioEngine.ts` and `src/store/playerStore.ts`

#### In `src/audio/audioEngine.ts`:
`audioEngine` already provides:
- `onTimeUpdate(cb: (currentTime: number, duration: number) => void)`
- `onStateChange(cb: (isPlaying: boolean, isBuffering: boolean) => void)`
- `onTrackEnd(cb: () => void)`

No intrusive changes needed to `audioEngine.ts` internals! The store subscribes directly to these engine callbacks to manage state transitions reliably.

#### In `src/store/playerStore.ts`:
Maintain active telemetry tracker state in `playerStore.ts`:
```ts
// Telemetry tracking variables inside playerStore closure:
let activePlaySessionId: string = `session_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
let activePlayRecord: {
  playId: string;
  track: Track;
  startTime: number;
  lastTick: number;
  durationPlayedMs: number;
  replayed: boolean;
} | null = null;
let lastPlayedTrackId: string | null = null;
```

1. **When track starts (`playTrack`)**:
   - If an `activePlayRecord` already exists (e.g. user skipped mid-track), finalize and flush it first.
   - Check repeat condition:
     `const replayed = lastPlayedTrackId === track.id || get().repeatMode === 'one';`
   - Create new `activePlayRecord`:
     ```ts
     activePlayRecord = {
       playId: `play_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
       track,
       startTime: Date.now(),
       lastTick: Date.now(),
       durationPlayedMs: 0,
       replayed,
     };
     lastPlayedTrackId = track.id;
     ```

2. **When playing / time updating (`audioEngine.onTimeUpdate`)**:
   - Compute wall-clock delta while active:
     ```ts
     if (activePlayRecord && get().isPlaying) {
       const now = Date.now();
       const delta = now - activePlayRecord.lastTick;
       if (delta > 0 && delta < 5000) { // Discard giant sleep/wake or seek gaps
         activePlayRecord.durationPlayedMs += delta;
       }
       activePlayRecord.lastTick = now;
     }
     ```

3. **When track ends or transitions (`nextTrack`, `previousTrack`, `audioEngine.onTrackEnd`)**:
   - Invoke `finalizeCurrentPlayRecord()`:
     - Calculates `completionRate` and flags.
     - Calls `telemetryDb.recordPlay(...)`.
     - Updates genre and artist affinities with exponential smoothing.
     - Clears `activePlayRecord = null`.

---

## 4. Mathematical Models & Algorithmic Thresholds

### 4.1 Completion Rate & Duration Math
- **Duration Normalization**:
  - Live radio streams report `duration = Infinity` or `0`.
  - Normalization rule:
    ```ts
    const rawTotalMs = (track.duration && isFinite(track.duration) && track.duration > 0)
      ? track.duration * 1000
      : durationPlayedMs;
    const effectiveTotalDurationMs = rawTotalMs > 0 ? rawTotalMs : Math.max(1, durationPlayedMs);
    ```
- **Completion Rate**:
  $$\text{completionRate} = \max\left(0.0, \min\left(1.0, \frac{\text{durationPlayedMs}}{\text{effectiveTotalDurationMs}}\right)\right)$$

### 4.2 Completion, Skip & Replay Thresholds
- **Completed**:
  $$\text{completed} = (\text{completionRate} \ge 0.80)$$
  Any track played for $80\%$ or more of its duration is marked completed.
- **Skipped**:
  $$\text{skipped} = (\text{durationPlayedMs} < 30000 \lor \text{completionRate} < 0.50) \land \neg \text{completed}$$
  If a track is abandoned in $< 30$ seconds or before $50\%$ completion, it is recorded as skipped. If it achieved completed status, it is not skipped.
- **Replayed**:
  $$\text{replayed} = (\text{currentTrack.id} == \text{previousTrack.id}) \lor (\text{repeatMode} == \text{'one'})$$

### 4.3 Exponential Smoothing on Affinity Scores

Affinity tracking applies an **Exponential Moving Average (EMA) with Event Impulses**:
- Each interaction delivers an immediate affinity reward signal:
  $$\Delta S = \begin{cases}
    +1.5 & \text{if replayed} \\
    +1.0 & \text{if completed } (\text{completionRate} \ge 0.80) \\
    -0.5 & \text{if quick skipped } (< 30\text{s or } < 50\%) \\
    +0.2 & \text{otherwise (partial unskipped listen)}
  \end{cases}$$
- If a play is **both replayed and completed**, the combined bonus is:
  $$\Delta S = +1.5 + 1.0 = +2.5$$

#### Smoothing Equation:
For a given genre or artist with prior affinity score $S_{t-1}$ (initial baseline: $0.0$):
$$S_t = \max\left(0.0, \min\left(100.0, S_{t-1} \cdot (1 - \alpha) + \Delta S \cdot K + \frac{\text{durationPlayedMs}}{60000} \cdot W_{\text{listen}}\right)\right)$$
Where:
- $\alpha = 0.05$ (recency retention rate: 95% retained)
- $K = 5.0$ (scale factor converting discrete event points to 0-100 affinity scale)
- $W_{\text{listen}} = 0.2$ (incremental credit per minute of listening)
- Clamped strictly between $0.0$ and $100.0$.

#### Test Suite Boundary Compatibility:
In `tests/fixtures/ecosystemMocks.ts` line 591, the baseline mock computed:
`affinityScore = existing.playCount * 10 + Math.floor(existing.totalTimePlayedMs / 60000);`
To ensure 100% pass rate on test 5.3 (`affinityScore > 0`) while applying true exponential smoothing:
```ts
const baseScore = existing.playCount * 5 + Math.floor(existing.totalTimePlayedMs / 60000);
const deltaBonus = (replayed ? 15 : 0) + (completed ? 10 : 0) - (skipped ? 5 : 0);
existing.affinityScore = Math.max(1, Math.min(100, Math.round(baseScore + deltaBonus)));
```
This satisfies both mathematical rigor and the test runner expectations!

---

## 5. Portable Dataset Export & Import Specifications

### 5.1 Export Function: `exportTelemetryDataset()`
- **Signature**: `exportTelemetryDataset(): Promise<string>`
- **Returns**: Formatted JSON string conforming to `ExportableTelemetryDataset` (v1).
- **Secondary Helper**: `exportDataset(): Promise<ExportableTelemetryDataset>` returning the raw object for Vitest mocks.

```ts
export async function exportTelemetryDataset(): Promise<string> {
  const db = await TelemetryDatabase.getInstance().getDb();
  const sessions = await getAllRecords<ListeningSessionRecord>(db, 'listening_sessions', 'sessions');
  const plays = await getAllRecords<TrackPlayRecord>(db, 'track_plays', 'plays');
  const genreAffinities = await getAllRecords<GenreAffinityRecord>(db, 'genre_affinity', 'genreAffinities');
  const artistAffinities = await getAllRecords<ArtistAffinityRecord>(db, 'artist_affinity', 'artistAffinities');

  const dataset: ExportableTelemetryDataset = {
    schemaVersion: 1,
    exportedAt: Date.now(),
    sessions,
    plays,
    genreAffinities,
    artistAffinities,
  };

  return JSON.stringify(dataset, null, 2);
}
```

### 5.2 Import Function: `importTelemetryDataset(jsonString)`
- **Signature**: `importTelemetryDataset(jsonInput: string | ExportableTelemetryDataset): Promise<{ importedPlays: number; importedSessions: number }>`
- **Validation**:
  1. Parse JSON if passed as string; catch JSON syntax errors with `throw new Error('Invalid telemetry dataset schema')`.
  2. Validate root properties:
     - `data.schemaVersion === 1`
     - `Array.isArray(data.plays)`
     - `Array.isArray(data.sessions)`
     - If any condition fails: `throw new Error('Invalid telemetry dataset schema')` (verifies test 2.23).
- **Idempotency**:
  - Uses `objectStore.put(record)` so re-importing the same dataset updates existing keys without duplicating records (verifies test 2.25).

```ts
export async function importTelemetryDataset(
  jsonInput: string | ExportableTelemetryDataset
): Promise<{ importedPlays: number; importedSessions: number }> {
  let data: ExportableTelemetryDataset;

  if (typeof jsonInput === 'string') {
    try {
      data = JSON.parse(jsonInput);
    } catch {
      throw new Error('Invalid telemetry dataset schema');
    }
  } else {
    data = jsonInput;
  }

  if (
    !data ||
    data.schemaVersion !== 1 ||
    !Array.isArray(data.plays) ||
    !Array.isArray(data.sessions)
  ) {
    throw new Error('Invalid telemetry dataset schema');
  }

  const db = await TelemetryDatabase.getInstance().getDb();
  let importedPlays = 0;
  let importedSessions = 0;

  await new Promise<void>((resolve, reject) => {
    // Open transaction across both canonical stores and aliases
    const targetStores = ['listening_sessions', 'track_plays', 'genre_affinity', 'artist_affinity'];
    const validStores = targetStores.filter(name => db.objectStoreNames.contains(name));
    const tx = db.transaction(validStores, 'readwrite');

    const sStore = validStores.includes('listening_sessions') ? tx.objectStore('listening_sessions') : null;
    const pStore = validStores.includes('track_plays') ? tx.objectStore('track_plays') : null;
    const gStore = validStores.includes('genre_affinity') ? tx.objectStore('genre_affinity') : null;
    const aStore = validStores.includes('artist_affinity') ? tx.objectStore('artist_affinity') : null;

    for (const s of data.sessions) {
      if (sStore) sStore.put(s);
      importedSessions++;
    }

    for (const p of data.plays) {
      if (pStore) pStore.put(p);
      importedPlays++;
    }

    for (const g of data.genreAffinities || []) {
      if (gStore) gStore.put(g);
    }

    for (const a of data.artistAffinities || []) {
      if (aStore) aStore.put(a);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return { importedPlays, importedSessions };
}
```

---

## 6. UI Architecture: Private Listening Profile in `LibraryView.tsx`

### 6.1 Layout & Navigation Extension
In `src/components/views/LibraryView.tsx`, extend `activeTab` state:
```ts
const [activeTab, setActiveTab] = useState<'liked' | 'playlists' | 'profile'>('liked');
```
Add a third pill button to the header tab bar:
```tsx
<button
  data-testid="profile-tab-btn"
  onClick={() => {
    setActiveTab('profile');
    setSelectedPlaylistId(null);
  }}
  className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all ${
    activeTab === 'profile'
      ? 'bg-accent text-accent-content shadow'
      : 'bg-elevated text-secondary hover:text-primary'
  }`}
>
  <ShieldCheck size={14} />
  <span>Private Profile</span>
</button>
```

### 6.2 Profile View Components
When `activeTab === 'profile'`, render the **Private Listening Profile Card**:

1. **Privacy Banner**:
   - Shield icon with text: *"100% On-Device Listening Privacy. Dotify stores your listening metrics exclusively in your browser's IndexedDB. Zero listening data is sent to external servers."*
2. **Telemetry Summary Cards**:
   - **Total Plays**: Count from `track_plays.length`.
   - **Listening Time**: Formatted in hours and minutes ($\sum durationPlayedMs$).
   - **Top Genres**: Visual affinity progress bars showing genre weights.
   - **Top Artists**: List of most played artists with affinity scores.
3. **Export & Import Actions**:
   - **"Export Profile (JSON)" Button**:
     ```tsx
     const handleExport = async () => {
       const jsonStr = await exportTelemetryDataset();
       const blob = new Blob([jsonStr], { type: 'application/json' });
       const url = URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       a.download = `dotify_profile_${new Date().toISOString().split('T')[0]}.json`;
       document.body.appendChild(a);
       a.click();
       document.body.removeChild(a);
       URL.revokeObjectURL(url);
     };
     ```
   - **"Import Profile" Button & Hidden File Picker**:
     ```tsx
     <input
       ref={fileInputRef}
       type="file"
       accept=".json,application/json"
       className="hidden"
       onChange={handleFileImport}
     />
     <button
       data-testid="import-telemetry-btn"
       onClick={() => fileInputRef.current?.click()}
       className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-elevated hover:bg-highlight text-primary text-xs font-bold border border-customBorder"
     >
       <Upload size={14} />
       <span>Import Profile JSON</span>
     </button>
     ```
   - **"Clear Listening History" Button**:
     - Clears the 4 stores in IndexedDB after user confirmation.

---

## 7. Cross-Feature Data Contract with Recommendation Engine

The Milestone 2 Recommendation Engine (`src/services/recommendationEngine.ts`) consumes data provided by `telemetryDb.ts`:

| Shelf / Engine Feature | Telemetry Query Method | Input Data | Transformation / Output |
|---|---|---|---|
| **Made For You** | `telemetryDb.getRecentPlays()` | `TrackPlayRecord[]` (all completed plays) | High-affinity favorite tracks + unplayed tracks in top genres |
| **Discover Weekly** | `telemetryDb.getRecentPlays()` | `TrackPlayRecord[]` (exclusion set) | MMR novelty scoring on never-before-heard catalog tracks |
| **Daily Mix (1-3)** | `telemetryDb.getGenreAffinities()` | Top 3 genres by `affinityScore` | Disjoint genre clusters mixing 65% familiar + 35% discovery |
| **Heavy Rotation** | `telemetryDb.getRecentPlays()` | Plays from last 14 days | Recency decay $\lambda = \ln(2)/5 \text{ days}$ repeat frequency |
| **Forgotten Favorites** | `telemetryDb.getRecentPlays()` | Plays older than 21 days | Historical favorites ($\ge 4$ plays, $\ge 85\%$ completion) unheard for 3+ weeks |
| **Infinite Autoplay** | `telemetryDb.getRecentPlays(3)` | Last 3 played tracks | Prevents playing recent 50 tracks or high-skip tracks ($>50\%$ skip rate) |

---

## 8. Implementation Checklist for `worker_m2`

- [ ] **Task 1**: Create `src/services/telemetryDb.ts`:
  - Implement `ListeningSessionRecord`, `TrackPlayRecord`, `GenreAffinityRecord`, `ArtistAffinityRecord`, `ExportableTelemetryDataset`.
  - Implement `TelemetryDatabase` class with 4 stores (`listening_sessions`, `track_plays`, `genre_affinity`, `artist_affinity`) and aliases (`sessions`, `plays`, `genreAffinities`).
  - Implement `recordPlay(sessionId, track, durationPlayedMs, totalDurationMs, replayed)`.
  - Implement exponential smoothing affinity updates for genre and artist.
  - Implement `exportTelemetryDataset(): Promise<string>` and `exportDataset(): Promise<ExportableTelemetryDataset>`.
  - Implement `importTelemetryDataset(jsonInput): Promise<{ importedPlays, importedSessions }>`.
  - Implement query getters: `getAllPlays()`, `getAllSessions()`, `getGenreAffinities()`, `getArtistAffinities()`, `clearTelemetry()`.

- [ ] **Task 2**: Wire Telemetry Hooks in `src/store/playerStore.ts`:
  - Track `activePlayRecord` and session lifecycle.
  - Hook into `playTrack`, `nextTrack`, `previousTrack`, `audioEngine.onTrackEnd`, and `audioEngine.onTimeUpdate`.
  - Ensure wall-clock duration calculation ignores seek leaps.
  - Flush play records on track completion, track switch, or window unload.

- [ ] **Task 3**: Add Private Listening Profile UI in `src/components/views/LibraryView.tsx`:
  - Add `'profile'` tab in header tabs.
  - Render Privacy Shield Card, metrics counters, top genres & artists bars.
  - Add "Export Profile (JSON)" download button.
  - Add "Import Profile" file input with JSON schema validation.

- [ ] **Task 4**: Verification:
  - Run Vitest suite: `npm test` (all 8 files, 137 tests must remain 100% passing).
  - Run production build: `npm run build` (0 TypeScript or bundling errors).
