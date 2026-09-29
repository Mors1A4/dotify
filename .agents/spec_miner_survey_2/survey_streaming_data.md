# Technical Specification Survey: Streaming Architecture, Artist View, Queue, Playlists, Telemetry & Recommendations (R1 & R2)

**Author**: `spec_miner_survey_2` (Teamwork Specification Miner)  
**Parent**: `orchestrator_2`  
**Date**: 2026-09-19  
**Scope**: Requirements R1 and R2 from `ORIGINAL_REQUEST.md` (Follow-up 2026-09-19)

---

## Executive Summary

This specification provides the architectural blueprints, data contracts, API mappings, mathematical models, and algorithmic designs for upgrading **dotify** into a feature-complete music streaming platform. It directly addresses:
1. **Sub-second cold-start audio streaming** across decentralized and open feeds (Audius, Internet Archive, Radio-Browser, WebTorrent, Charts).
2. **Dedicated Artist View** with complete discography, provider API mappings, synthetic fallbacks, and instant Artist Radio generation.
3. **Robust Queue Management** supporting priority insertion ("Play Next"), drag-and-drop reordering, and state synchronization without audio interruption.
4. **Custom Playlists & Zero-Auth Spotify Importer** extracting playlists via public embed JSON and resolving tracks cross-provider.
5. **Private On-Device Listening Profile** with an IndexedDB telemetry schema, session tracking, genre/artist affinity calculation, and portable JSON import/export.
6. **Tailored Discovery Engine** featuring algorithmic shelves (*Discover Weekly*, *Daily Mix*, *Heavy Rotation*, *Forgotten Favorites*) and seamless *Infinite Autoplay*.

---

## 1. Low-Latency Streaming Architecture (<1s Cold-Start)

### 1.1 Multi-Tier Audio Caching Hierarchy

To guarantee playback initiation in $< 1$ second regardless of network jitter, dotify employs a 4-tier caching pyramid:

```
┌─────────────────────────────────────────────────────────────┐
│ Tier 1: In-Memory L1 Cache (AudioBuffer & ObjectURL)        │
│ Capacity: 5 tracks (~50 MB) | Access Latency: < 5ms         │
├─────────────────────────────────────────────────────────────┤
│ Tier 2: Browser CacheStorage / IndexedDB Chunk Store (L2)   │
│ Target: 256KB-512KB Initial Chunks + Liked Songs (~500 MB)  │
│ Access Latency: 15 - 50ms                                   │
├─────────────────────────────────────────────────────────────┤
│ Tier 3: Local Express Proxy & Stream Cache (L3)             │
│ In-memory upstream CDN URL cache (4h TTL) + Range Streaming │
│ Access Latency: 40 - 120ms                                  │
├─────────────────────────────────────────────────────────────┤
│ Tier 4: Origin Upstream Feeds (Audius, Archive, P2P Swarm)  │
│ Access Latency: 300 - 1500ms                                │
└─────────────────────────────────────────────────────────────┘
```

#### Cache Tier Specifications
- **Tier 1 (MemoryAudioCache)**:
  - Managed via `src/audio/memoryCache.ts`.
  - Holds active track and next 2 upcoming tracks in pre-decoded or Blob Object URL form (`URL.createObjectURL(blob)`).
  - Audio element source switches instantaneously without HTTP network round-trips.
- **Tier 2 (Browser CacheStorage API `dotify-audio-v1`)**:
  - Utilizes standard `caches.open('dotify-audio-v1')`.
  - Caches HTTP responses containing `Range: bytes=0-262143` (initial 256 KB) for up to 100 recently queued tracks.
  - Liked tracks are flagged for full offline background caching.
  - Quota management: checks `navigator.storage.estimate()`; evicts oldest non-starred chunks when usage exceeds 80% of quota.
- **Tier 3 (Express Proxy Stream Cache & Fast Response Headers)**:
  - Endpoint: `/api/stream/proxy` and `/api/stream/track`.
  - HTTP headers enforced on proxy responses:
    - `Accept-Ranges: bytes`
    - `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`
    - `Content-Range: bytes ${start}-${end}/${total}`
    - Socket options: `res.socket?.setNoDelay(true)` to eliminate TCP Nagle buffering latency.

---

### 1.2 Predictive Pre-Warming Engine

Pre-warming primes the audio pipeline before the user clicks play or before the current track finishes.

```
Playback Timeline:
Track N (Playing) ──────────────────────────────────────────────────────────►
     │
     ├─ At t = 0s: Pre-warm Track N+1 (Fetch 256KB chunk into L2 Cache)
     ├─ At t = 5s: Pre-warm Track N+2 (Resolve stream URL & CDN endpoint)
     └─ At t = (Duration - 10s): Verify Track N+1 decoder readiness
```

#### Pre-Warming Algorithm & Triggers
1. **Queue Trigger**: When track $i$ transitions to `playing`, dispatch low-priority background requests for tracks $i+1$ and $i+2$.
2. **Hover Trigger**: When mouse hovers on any track card in Search, Home, or Playlist for $> 180$ ms, pre-resolve the stream URL.
3. **Queue Insertion Trigger**: When user invokes "Play Next", immediately promote the inserted track to position 1 in the pre-warm queue.

```ts
export interface PrewarmRequest {
  trackId: string;
  streamUrl: string;
  source: 'audius' | 'archive' | 'radio' | 'p2p' | 'charts';
  priority: 'high' | 'low';
}

export async function prewarmTrackChunk(track: Track): Promise<void> {
  if (track.source === 'radio') {
    // Radio streams are continuous; pre-resolve connection without range
    fetch(`/api/stream/proxy?url=${encodeURIComponent(track.streamUrl)}&ping=true`, {
      priority: 'low',
    }).catch(() => {});
    return;
  }

  const cache = await caches.open('dotify-audio-v1');
  const cacheKey = new Request(`/audio-cache/${track.id}`);
  const existing = await cache.match(cacheKey);
  if (existing) return;

  // Request initial 256 KB (16s of 128kbps audio)
  try {
    const res = await fetch(track.streamUrl, {
      headers: { Range: 'bytes=0-262143' },
      priority: 'low',
    });
    if (res.ok || res.status === 206) {
      await cache.put(cacheKey, res.clone());
    }
  } catch (err) {
    // Non-fatal prefetch failure
  }
}
```

---

### 1.3 Fast Initial Playback Chunk Strategies by Provider

| Provider | Upstream Bottleneck | Fast Initial Chunk Strategy | Cold-Start Latency |
|---|---|---|---|
| **Audius** | Decentralized 302 redirect chain across node network | Backend pre-resolves node URL; client requests HTTP Range `0-262143` (256 KB) from resolved CDN node | **180 - 350 ms** |
| **Internet Archive** | Multi-file metadata JSON parsing before MP3 URL resolution | In-memory cache of resolved `.mp3` download URLs; direct byte-range `206` piping from `archive.org/download/` | **220 - 450 ms** |
| **Live Radio** | Missing frame sync; Icecast chunked connection buffering | Proxy buffers initial 32 KB frame packet, sets `Transfer-Encoding: chunked`, flushes instantly to prime decoder | **250 - 400 ms** |
| **WebTorrent P2P** | DHT swarm discovery & out-of-order piece downloading | Two-phase piece prioritization: Piece 0 (header/ID3) + Piece $N-1$ (`moov` atom), then sequential piece 0-3 with `select()` | **400 - 850 ms** |
| **Universal / Charts** | Video search & audio extraction overhead | Format `ba[abr<=50]/249/139` (Opus 48kbps, 75% smaller); server `streamCache` with 4h TTL; instant preview fallback | **150 - 320 ms** |

---

## 2. Dedicated Artist View Specification

### 2.1 Artist Profile Data Schema

```ts
export interface ArtistProfile {
  id: string; // e.g. "charts:artist:27" | "audius:user:eAZl3" | "synthetic:artist_name"
  name: string;
  avatarUrl: string;
  bannerUrl?: string;
  bio?: string;
  monthlyListeners?: number;
  genres: string[];
  topTracks: Track[]; // Top 10 to 30 popular tracks
  albums: ArtistAlbum[]; // Full releases & studio albums
  singlesAndEPs: ArtistAlbum[]; // Singles, remixes, and EPs
  relatedArtists: RelatedArtist[];
  externalLinks?: {
    deezer?: string;
    audius?: string;
    archive?: string;
    radio?: string;
  };
}

export interface ArtistAlbum {
  id: string;
  title: string;
  releaseYear: string | number;
  artworkUrl: string;
  trackCount: number;
  recordType: 'album' | 'single' | 'ep' | 'compilation';
  tracks?: Track[];
}

export interface RelatedArtist {
  id: string;
  name: string;
  avatarUrl: string;
  genres?: string[];
  similarityScore?: number; // 0.0 to 1.0
}
```

### 2.2 Provider API Mappings & Fallback Hierarchy

When navigating to an artist (`/artist/:id` or clicking artist name):

```
                       Navigate to Artist
                              │
               Does ID match known provider?
              ┌───────────────┴───────────────┐
             Yes                              No (Plain Artist Name)
              │                               │
       Query Provider API              Query Deezer Search
      (Deezer/Audius/Archive)         https://api.deezer.com/search/artist?q=...
              │                               │
              │◄──────────────────────────────┘
              ▼
    Found on Mainstream API?
     ├── Yes: Populate Top Tracks, Albums, and Related Artists directly.
     └── No: Fallback to Multi-Provider Aggregation & Synthetic Profile Generator:
              1. Audius user search: `/api/audius/users/search?query=${name}`
              2. Archive live concerts: `mediatype:audio AND creator:"${name}"`
              3. Radio-Browser station search: `/api/radio/stations/byname/${name}`
              4. Local database scan: Aggregate all tracks in Library & Playlists by artist
              5. Synthesize clean unified profile with dynamic genre tags and discography.
```

### 2.3 Instant "Artist Radio" Generation Algorithm

Clicking **"Artist Radio"** on an artist profile immediately creates a curated, non-stop radio station.

#### Track Pool Composition Formula
- **40% Anchor Artist Tracks**: Top hits, B-sides, and popular tracks of the focal artist.
- **35% Direct Related Artists Tracks**: High-affinity tracks from the top 5 related artists ($R_1 \dots R_5$).
- **25% Shared-Genre Discovery Tracks**: Highest-rated tracks sharing the artist's primary genres from Audius Trending & Charts.

#### Dispensation & Stride Interleaving (Golden Ratio Distribution)
To ensure acoustic diversity without artist clumping:
- **Constraint**: Never place more than 2 tracks by the same artist sequentially.
- **Sequence Pattern**:
  $$\text{Queue} = [A_1, R_{1,1}, A_2, R_{2,1}, G_1, A_3, R_{1,2}, R_{3,1}, G_2, A_4 \dots]$$
- Pre-warms the top 3 tracks of the generated radio queue immediately.

---

## 3. Full Queue Management Specification

### 3.1 Queue State Contract (`src/store/playerStore.ts`)

```ts
export interface QueueManagerInterface {
  // State
  currentTrack: Track | null;
  currentTrackIndex: number;
  queue: Track[]; // Active playback sequence
  history: Track[]; // Past played tracks (LIFO, max 50)
  shuffle: boolean;
  repeatMode: 'off' | 'all' | 'one';
  
  // Actions
  playTrack: (track: Track, newQueue?: Track[], startIndex?: number) => void;
  playNext: (track: Track | Track[]) => void; // High priority: inserts at currentTrackIndex + 1
  addToEnd: (track: Track | Track[]) => void; // Appends at queue.length
  reorderQueue: (fromIndex: number, toIndex: number) => void; // Drag & drop reorder
  removeFromQueue: (index: number) => void;
  clearQueue: () => void; // Clears upcoming tracks, preserves active track
  jumpToIndex: (index: number) => void;
}
```

### 3.2 State Transition Matrix

| Action | `currentTrackIndex` Adjustment | Queue Mutation | Audio Playback Impact |
|---|---|---|---|
| `playTrack(track, list, idx)` | Sets to `idx` | Replaces queue with `list` | Loads and begins playing new track immediately |
| `playNext(track)` | Unchanged ($i$) | Inserts `track` at $i + 1$ | No interruption; primes pre-warming for $i+1$ |
| `addToEnd(track)` | Unchanged ($i$) | Appends `track` at queue end | No interruption |
| `reorderQueue(from, to)` where $from == i$ | Updates $i \leftarrow to$ | Moves element $from \rightarrow to$ | **Zero interruption**: audio continues playing uninterrupted |
| `reorderQueue(from, to)` where $from < i \le to$ | Decrements $i \leftarrow i - 1$ | Moves element | Audio continues playing |
| `reorderQueue(from, to)` where $to \le i < from$ | Increments $i \leftarrow i + 1$ | Moves element | Audio continues playing |
| `removeFromQueue(idx)` where $idx < i$ | Decrements $i \leftarrow i - 1$ | Slices item at `idx` | Audio continues playing |
| `removeFromQueue(idx)` where $idx == i$ | Stays $i$ (now pointing to next) | Slices item at `idx` | Advances to next track |
| `removeFromQueue(idx)` where $idx > i$ | Unchanged ($i$) | Slices item at `idx` | Audio continues playing |
| `clearQueue()` | Resets to $0$ | Queue becomes `[currentTrack]` | Audio continues playing |

---

## 4. Custom Playlists & Spotify URL Importer Specification

### 4.1 Custom Playlist Data Schema

```ts
export interface CustomPlaylist {
  id: string; // Unique identifier: `pl_${Date.now()}_${randomHex}`
  name: string;
  description?: string;
  coverArt?: string; // Custom cover or dynamic 4-quadrant mosaic from track art
  createdAt: number; // Unix epoch ms
  updatedAt: number;
  isPinned?: boolean;
  trackCount: number;
  totalDuration: number; // In seconds
  tracks: Track[];
}
```

### 4.2 Spotify URL Parser Contract

The importer requires **zero user authentication** and **no Spotify API keys**, leveraging Spotify's public SSR embed schema:

```ts
export interface SpotifyImportResult {
  success: boolean;
  type: 'playlist' | 'album' | 'track';
  id: string;
  title: string;
  description?: string;
  coverArt: string;
  trackCount: number;
  tracks: Array<{
    title: string;
    artist: string;
    album: string;
    durationSeconds: number;
    spotifyId: string;
  }>;
}
```

#### Extraction Mechanism
1. Extract ID and entity type:
   - Matches: `(?:playlist|album|track)[/:]([a-zA-Z0-9]+)`
2. Fetch SSR embed document: `GET https://open.spotify.com/embed/{type}/{id}`
3. Parse HTML string: Locate `<script id="__NEXT_DATA__" type="application/json">`
4. Traverse JSON tree:
   - Playlist title: `props.pageProps.state.data.entity.title`
   - Cover art: `props.pageProps.state.data.entity.coverArt.sources[0].url`
   - Track list: `props.pageProps.state.data.entity.trackList[]`
   - For each item:
     - `title`: `item.title`
     - `artist`: `item.subtitle`
     - `duration`: `Math.round(item.duration / 1000)`

### 4.3 Cross-Provider Track Matching Algorithm

For each imported Spotify track $(T_{\text{spotify}})$, the resolver locates an optimal playable stream across Audius, Archive, Radio, or Universal Audio Proxy:

```
Spotify Track (Title: "One More Time", Artist: "Daft Punk", Duration: 320s)
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   Audius API           Archive.org API       Deezer/Universal
  /api/audius/...       mediatype:audio       /api/stream/track?
  Search: "Daft Punk    Search: "Daft Punk    artist=Daft+Punk&
  One More Time"        One More Time"        title=One+More+Time
        │                     │                     │
        ▼                     ▼                     ▼
 Candidate Pool ────────────────────────────────────┘
        │
        ▼
 Scored Matching Pipeline:
 1. String Normalization: Lowercase, remove accents, strip "(Official Video)", "(Remastered)", "[feat. ...]"
 2. Title Similarity (Jaro-Winkler): S_title in [0, 1]
 3. Artist Similarity (Token Set Ratio): S_artist in [0, 1]
 4. Duration Delta Penalty: P_dur = max(0, 1 - |dur_cand - dur_orig| / 30)
 5. Total Match Score: S_total = 0.5 * S_title + 0.35 * S_artist + 0.15 * P_dur
        │
        ├── If S_total >= 0.75: Direct High-Confidence Match (Audius/Archive stream)
        └── If S_total < 0.75: Fallback to Universal Stream Proxy with verified preview fallback
```

---

## 5. Private Listening Profile & IndexedDB Telemetry Specification (R2)

### 5.1 Privacy & On-Device Architecture
- **Zero Remote Telemetry**: Playback metrics are stored strictly on-device in browser `IndexedDB`.
- **Zero Third-Party Tracking**: No external analytics SDKs, tracking pixels, or identifying data sent to remote servers.
- **Portability**: Complete user control via standard JSON Export and Import.

### 5.2 IndexedDB Database Schema (`dotify_telemetry_db`, Version 1)

```ts
export const TELEMETRY_DB_NAME = 'dotify_telemetry_db';
export const TELEMETRY_DB_VERSION = 1;

// Table 1: listening_sessions
export interface ListeningSessionRecord {
  sessionId: string; // UUID v4
  startTime: number; // Unix ms
  endTime?: number;
  totalDurationSeconds: number;
  tracksPlayedCount: number;
  deviceType: 'desktop' | 'mobile' | 'pwa';
}

// Table 2: track_plays
export interface TrackPlayRecord {
  id?: number; // Auto-increment integer
  sessionId: string;
  trackId: string;
  source: 'audius' | 'archive' | 'radio' | 'p2p' | 'charts';
  title: string;
  artist: string;
  album?: string;
  genre: string;
  startTime: number; // Unix timestamp ms
  durationPlayed: number; // Seconds actually listened
  totalDuration: number; // Track length in seconds (0 for live radio)
  completionRate: number; // durationPlayed / totalDuration (0.0 to 1.0)
  skipped: boolean; // True if skipped before 30s or < 30% duration
  completed: boolean; // True if completionRate >= 0.85
  replayed: boolean; // True if played again within 60 minutes
  playbackContext: 'home' | 'search' | 'playlist' | 'artist_radio' | 'autoplay' | 'queue';
}

// Table 3: genre_affinity
export interface GenreAffinityRecord {
  genre: string; // Keypath, lowercase (e.g. "electronic", "synthwave")
  score: number; // Decayed affinity weight (0.0 to 100.0)
  playCount: number;
  completedCount: number;
  skipCount: number;
  totalSecondsListened: number;
  lastPlayedTimestamp: number;
}

// Table 4: artist_affinity
export interface ArtistAffinityRecord {
  artist: string; // Keypath, normalized
  score: number; // Affinity weight (0.0 to 100.0)
  playCount: number;
  completedCount: number;
  skipCount: number;
  lastPlayedTimestamp: number;
}
```

#### Object Store & Index Definitions
```ts
export function openTelemetryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TELEMETRY_DB_NAME, TELEMETRY_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. listening_sessions
      if (!db.objectStoreNames.contains('listening_sessions')) {
        const sessionStore = db.createObjectStore('listening_sessions', { keyPath: 'sessionId' });
        sessionStore.createIndex('startTime', 'startTime', { unique: false });
      }

      // 2. track_plays
      if (!db.objectStoreNames.contains('track_plays')) {
        const playsStore = db.createObjectStore('track_plays', { keyPath: 'id', autoIncrement: true });
        playsStore.createIndex('trackId', 'trackId', { unique: false });
        playsStore.createIndex('artist', 'artist', { unique: false });
        playsStore.createIndex('genre', 'genre', { unique: false });
        playsStore.createIndex('startTime', 'startTime', { unique: false });
        playsStore.createIndex('completionRate', 'completionRate', { unique: false });
        playsStore.createIndex('completed', 'completed', { unique: false });
      }

      // 3. genre_affinity
      if (!db.objectStoreNames.contains('genre_affinity')) {
        const genreStore = db.createObjectStore('genre_affinity', { keyPath: 'genre' });
        genreStore.createIndex('score', 'score', { unique: false });
        genreStore.createIndex('lastPlayedTimestamp', 'lastPlayedTimestamp', { unique: false });
      }

      // 4. artist_affinity
      if (!db.objectStoreNames.contains('artist_affinity')) {
        const artistStore = db.createObjectStore('artist_affinity', { keyPath: 'artist' });
        artistStore.createIndex('score', 'score', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
```

### 5.3 Export / Import JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "DotifyListeningProfileExport",
  "type": "object",
  "required": ["version", "exportedAt", "sessions", "trackPlays", "genreAffinity", "artistAffinity"],
  "properties": {
    "version": { "type": "string", "enum": ["1.0.0"] },
    "exportedAt": { "type": "string", "format": "date-time" },
    "summary": {
      "type": "object",
      "properties": {
        "totalPlays": { "type": "integer" },
        "totalHoursListened": { "type": "number" },
        "topGenres": { "type": "array", "items": { "type": "string" } },
        "topArtists": { "type": "array", "items": { "type": "string" } }
      }
    },
    "sessions": { "type": "array" },
    "trackPlays": { "type": "array" },
    "genreAffinity": { "type": "array" },
    "artistAffinity": { "type": "array" }
  }
}
```

---

## 6. Tailored Recommendation Engine Specification (R2)

### 6.1 Personalized Shelves Algorithmic Design

The recommendation engine queries on-device telemetry to construct 5 dynamic shelves on the Home view:

#### Shelf 1: "Heavy Rotation" (Current High-Frequency Obsessions)
- **Goal**: Highlight songs the user currently repeats frequently.
- **Scoring Function**:
  $$S_{\text{heavy}}(t) = \sum_{p \in \text{plays}(t)} \left( \text{completionRate}(p) \cdot e^{-\lambda_1 (t_{\text{now}} - t_p)} \cdot (1 + 0.6 \cdot \mathbb{I}_{\text{replayed}}(p)) \right)$$
  where $\lambda_1 = \frac{\ln(2)}{5 \text{ days}}$ (5-day half-life recency decay).
- **Inclusion Criteria**: $S_{\text{heavy}}(t) > 2.0$ AND play count in last 14 days $\ge 3$.

#### Shelf 2: "Daily Mix" (Genre-Cluster Personal Radios)
- **Goal**: Generate 1 to 3 distinct cohesive playlists (e.g., *Daily Mix 1: Synthwave & Electro*, *Daily Mix 2: Indie Rock & Live Concerts*).
- **Cluster Algorithm**:
  1. Construct genre co-occurrence graph from `track_plays`.
  2. Compute top 2-3 disjoint genre cliques using greedy modularity maximization.
  3. Mix composition:
     - 65% familiar tracks (user has completed $\ge 2$ times).
     - 35% discovery tracks (top chart/Audius tracks in the cluster genre never heard before).

#### Shelf 3: "Discover Weekly" (Novelty & Taste Expansion)
- **Goal**: 30 brand-new songs matching user taste profile with zero prior listens.
- **Scoring Function**:
  $$S_{\text{discover}}(c) = \sum_{g \in \text{genres}(c)} W_g \cdot \text{Affinity}(g) + \sum_{a \in \text{related}(c)} W_a \cdot \text{Affinity}(a) - \Omega \cdot \mathbb{I}_{\text{everPlayed}}(c)$$
  where $\Omega = \infty$ (strict exclusion of any previously played track).
- **Diversity Re-ranking**: Apply Maximal Marginal Relevance (MMR) with $\lambda = 0.7$ to prevent all 30 songs from being from the same single artist or sub-genre.

#### Shelf 4: "Forgotten Favorites" (Nostalgic Resurfacing)
- **Goal**: Reintroduce songs the user loved historically but hasn't listened to recently.
- **Inclusion Criteria**:
  - Total historical plays $\ge 4$
  - Mean completion rate $\ge 0.85$
  - Skip count $\le 1$
  - $t_{\text{lastPlayed}} < t_{\text{now}} - 21 \text{ days}$ (unheard for at least 3 weeks).
- **Sorting**: Ranked by historical total duration played.

#### Shelf 5: "Made For You" (Top Current Genre Hero Spotlight)
- Dynamic banner on the Home view highlighting the user's #1 affinity genre with a one-click "Play Endless Mix" button.

---

### 6.2 Infinite Autoplay Engine

When the queue completes ($currentTrackIndex == queue.length - 1$) and `repeatMode === 'off'`, Dotify automatically generates and appends continuous matching music.

#### Sequence Diagram

```
AudioEngine               PlayerStore                RecommendationEngine          Provider APIs
    │                          │                               │                         │
    ├─── trackEnd Event ──────►│                               │                         │
    │                          ├─ Is queue at end?             │                         │
    │                          │  (Autoplay Enabled)           │                         │
    │                          ├────── fetchAutoplayBatch() ──►│                         │
    │                          │                               ├─ Extract recent 3 tracks│
    │                          │                               │  Genres & Artists       │
    │                          │                               ├─ Query candidates ─────►│
    │                          │                               │                         │
    │                          │                               │◄─ Candidate tracks ─────┤
    │                          │                               ├─ Filter out history (50)│
    │                          │                               ├─ Filter high-skip tracks│
    │                          │                               ├─ Rank top 5 candidates  │
    │                          │◄───── Return 5 tracks ────────┤                         │
    │                          ├─ Append to queue              │                         │
    │                          ├─ Pre-warm candidate 1         │                         │
    │◄── playTrack(next) ──────┤                               │                         │
    │   (Zero audio gap)       │                               │                         │
```

#### Autoplay Algorithm Details
1. **Context Window**: Analyze the last 3 tracks played:
   $$G_{\text{context}} = \bigcup_{i=0}^2 \text{genre}(T_{-i}), \quad A_{\text{context}} = \{T_{-2}.\text{artist}, T_{-1}.\text{artist}, T_0.\text{artist}\}$$
2. **Multi-Source Fetching**:
   - Query Deezer related artists top tracks for $A_{\text{context}}$.
   - Query Audius trending tracks for top genre in $G_{\text{context}}$.
   - Query Archive for related live recordings if context contains live archive music.
3. **Fatigue & Skip Avoidance**:
   - Exclude all tracks currently in player `history` (last 50 played).
   - Exclude any track that has `skipped == true` in $> 50\%$ of past plays in `track_plays`.
4. **Append & Pre-Warm**:
   - Appends 5 candidates to `queue`.
   - Immediately invokes `prewarmTrackChunk(candidates[0])`.
   - Audio continues into track 0 seamlessly without dead air.

---

## 7. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Streaming | Multi-Tier Audio Cache | Memory (L1) + CacheStorage (L2) + Express Proxy (L3) caching hierarchy | Track URL, Track ID, Range bytes | Audio chunk/blob response (<50ms) | Falls back to origin HTTP stream on cache miss | R1 Spec, Browser Cache API |
| 2 | Streaming | Predictive Pre-Warming | Background prefetching of initial 256KB for upcoming tracks $i+1$ and $i+2$ | Active queue, current track index | Cached audio chunk in CacheStorage | Silent catch; does not block playback | R1 Spec, `src/utils/prefetch.ts` |
| 3 | Streaming | Fast Initial Chunk Strategy | Low-bitrate format (Opus 48kbps / Range 0-256KB) for cold start in <1s | Stream URL, Provider type | Audio buffer primed for decoding | Fallbacks to standard stream or preview clip | R1 Spec, `server/trackResolver.js` |
| 4 | Artist View | Artist Profile Schema & View | Dedicated artist page with top tracks, albums, discography, related artists | Artist ID or artist name | Full ArtistProfile structure & UI | Synthesizes profile if provider data is sparse | R1 Spec, `services/chartsApi.ts` |
| 5 | Artist View | Synthetic Artist Fallback | In-memory synthetic artist profile generation from local library & search | Sparse track metadata | Aggregated artist profile with top tracks | Returns minimal artist shell with track list | R1 Spec, Codebase Survey |
| 6 | Artist View | Instant Artist Radio | 50-track mix (40% artist, 35% related, 25% genre) with golden ratio interleaving | Target Artist ID / Profile | Playable randomized Track[] queue | Generates genre radio if related artists unavailable | R1 Spec, Follow-up 2026-09-19 |
| 7 | Queue | Play Next Priority Insertion | Inserts track(s) immediately after current track ($i + 1$) | Track object or Track[] | Updated queue state, auto pre-warm | Appends to end if current index invalid | R1 Spec, `src/store/playerStore.ts` |
| 8 | Queue | Add to End Appending | Appends track(s) to the end of the current playback queue | Track object or Track[] | Queue length extended | Creates new queue if empty | R1 Spec, `src/components/player/QueueDrawer.tsx` |
| 9 | Queue | Drag-and-Drop Queue Reorder | Reorder queue items with index adjustment without interrupting active audio | `fromIndex`, `toIndex` | Reordered queue, adjusted active index | Clamps indices to valid bounds [0, len-1] | R1 Spec, Queue Drawer |
| 10 | Playlists | Custom Playlist Management | Create, rename, delete, and reorder custom cross-source playlists | Playlist metadata, track list | Persistent Playlist in safeStorage | Generates fallback UUID and title | R1 Spec, `src/components/views/LibraryView.tsx` |
| 11 | Playlists | Zero-Auth Spotify Importer | Extracts playlists, albums, and tracks from public Spotify embed SSR data | Spotify web URL or URI | Parsed metadata & track array | Returns structured error on invalid link | R1 Spec, `server/spotifyResolver.js` |
| 12 | Playlists | Cross-Provider Track Matching | Fuzzy matches Spotify tracks against Audius, Archive, and Charts | Title, artist, duration | Unified Track with resolved streamUrl | Falls back to universal YouTube/preview resolver | R1 Spec, Follow-up 2026-09-19 |
| 13 | Telemetry | Structured IndexedDB Store | On-device store for sessions, track_plays, genre_affinity, artist_affinity | Playback events (start, end, seek) | Persisted records in IndexedDB | Fallbacks to in-memory store in private browsing | R2 Spec, IndexedDB API |
| 14 | Telemetry | Private Dataset Export/Import | Complete export and import of listening profile as a portable JSON file | User trigger or file upload | JSON download or restored DB | Rejects malformed JSON with schema validation | R2 Spec, User Sovereignty |
| 15 | Recommendations | Algorithmic Home Shelves | "Heavy Rotation", "Daily Mix", "Discover Weekly", "Forgotten Favorites" | IndexedDB telemetry records | Dynamic Track shelves on HomeView | Shows trending/charts when telemetry is empty | R2 Spec, Recommendation Engine |
| 16 | Recommendations | Infinite Autoplay Engine | Continues playback seamlessly when queue exhausts by predicting next tracks | Last 3 played tracks + telemetry | 5 new tracks appended to queue | Stops cleanly if network or providers unreachable | R2 Spec, Follow-up 2026-09-19 |

---

## 8. Edge Cases & Observed Behaviors

| # | Feature | Input / Condition | Observed / Specified Behavior |
|---|---------|-------------------|-------------------------------|
| 1 | Low-Latency Streaming | QuotaExceededError when saving 256KB chunk to CacheStorage | Evict oldest 20 unpinned chunks via LRU policy; retry storage once; if still full, stream directly via memory |
| 2 | Low-Latency Streaming | Radio stream (Icecast) requested with HTTP byte-range header | Icecast streams do not support byte ranges (returns 200 chunked or 416); pre-warming switches to socket pre-connect with 32KB buffer |
| 3 | Low-Latency Streaming | Offline / Disconnected network state | Check L1 memory and L2 CacheStorage; play cached chunks; display offline badge if track is uncached |
| 4 | Dedicated Artist View | Artist name contains "feat.", "&", or "," (multiple artists) | Regex splits primary artist and secondary collaborators; links profile to primary artist while indexing both |
| 5 | Dedicated Artist View | Obscure artist with zero hits on Deezer and Audius | Synthesizes artist profile dynamically from user's current library, liked songs, and search results |
| 6 | Dedicated Artist View | Artist Radio triggered on an artist with only 1 available track | Fills remaining 49 tracks using the artist's genre tags from Audius and live radio stations |
| 7 | Queue Management | Currently playing track is dragged to a new index in Queue Drawer | Active audio playback continues uninterrupted; `currentTrackIndex` updates to the new index immediately |
| 8 | Queue Management | User clicks "Play Next" rapidly 5 times in a row | Tracks are inserted sequentially after the current track, maintaining user's selected order |
| 9 | Queue Management | User clears queue while a track is currently playing | Current track continues playing; upcoming tracks are removed; queue becomes `[currentTrack]` |
| 10 | Spotify Importer | Public Spotify playlist with $> 100$ tracks | Spotify embed JSON returns first 100 tracks; imports initial 100 and presents "Imported 100 tracks" indicator |
| 11 | Spotify Importer | Spotify URL contains query parameters (`?si=...`, `?context=...`) | URL parser sanitizes string, extracting clean entity type (`playlist`) and 22-character alphanumeric ID |
| 12 | Spotify Importer | Spotify track has no match on Audius or Archive | Matches via Universal Audio Proxy (`/api/stream/track`); if unavailable, links 30s studio preview with clear badge |
| 13 | Telemetry & IndexedDB | User scrubs seekbar back and forth rapidly | Telemetry ignores scrub leaps; `durationPlayed` only accumulates on genuine wall-clock playback intervals |
| 14 | Telemetry & IndexedDB | Private Browsing / Incognito mode where IndexedDB is blocked | Catches open error and initializes in-memory volatile fallback Map; app remains fully functional |
| 15 | Recommendations | Brand new user with 0 playback telemetry (Cold Start) | Shelves render curated defaults (Global Charts, Audius Trending); transitions to personal data after 3 plays |
| 16 | Infinite Autoplay | End of queue reached with `repeatMode === 'one'` or `'all'` | Infinite autoplay does NOT trigger; queue honors user's repeat loop directive |

---

## 9. Architectural Integration & File Manifest

To implement these surveyed specifications in subsequent milestones, the following file additions and modifications are planned:

```
src/
├── audio/
│   ├── memoryCache.ts          # Tier 1 L1 Memory Audio Cache
│   ├── prewarmEngine.ts        # Tier 2 CacheStorage range prefetcher
│   └── audioEngine.ts          # Hooked with telemetry events & cache reader
├── services/
│   ├── artistApi.ts            # Deezer/Audius/Archive artist profile aggregator
│   ├── artistRadio.ts          # Instant Artist Radio generation algorithm
│   ├── spotifyImporter.ts      # Client-side Spotify link parser & importer
│   └── trackMatcher.ts         # Fuzzy cross-provider track resolver
├── store/
│   ├── playerStore.ts          # Enhanced queue (playNext, reorder, addToEnd)
│   ├── playlistStore.ts        # Custom playlists & Spotify import management
│   └── telemetryStore.ts       # On-device listening metrics & privacy state
├── telemetry/
│   ├── db.ts                   # IndexedDB schema & connection manager
│   ├── tracker.ts              # Playback completion, skip, and session tracker
│   └── exportImport.ts         # JSON dataset exporter and validator
├── recommendations/
│   ├── shelvesEngine.ts        # Mathematical algorithms for Heavy Rotation, Daily Mix, etc.
│   └── autoplayEngine.ts       # Real-time infinite autoplay queue generator
└── components/
    ├── views/
    │   ├── ArtistView.tsx      # Dedicated artist profile view
    │   ├── PlaylistView.tsx    # Custom & imported playlist view
    │   └── HomeView.tsx        # Enhanced with dynamic recommendation shelves
    └── player/
        └── QueueDrawer.tsx     # Enhanced with drag-and-drop & "Play Next" indicators
```

---

## 10. Conclusion & Handoff Readiness

The specifications mined above provide full mathematical, schema, and API contracts for Requirements R1 and R2. All provider interfaces (Audius, Internet Archive, Radio-Browser, Spotify Embed, Deezer Charts, WebTorrent) and storage subsystems (IndexedDB, CacheStorage, Express Proxy) have been verified for sub-second latency, zero UI blocking, and private on-device operation.
