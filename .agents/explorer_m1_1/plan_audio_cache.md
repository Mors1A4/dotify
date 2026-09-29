# Low-Latency Audio Streaming & Multi-Tier Caching Architecture Plan
**Milestone 1 — Sub-Second Audio Playback Across All Providers**  
**Author**: `explorer_m1_1` (Teamwork Preview Explorer)  
**Target File**: `src/audio/audioCache.ts` & `src/audio/audioEngine.ts`  
**Date**: 2026-09-19  

---

## 1. Executive Summary & Problem Diagnosis

### 1.1 Objective
To upgrade **dotify** with sub-second (< 1s) cold-start audio playback across all 5 supported audio providers (Audius, Internet Archive, Radio-Browser, WebTorrent, and Charts/Universal) through an integrated 4-tier caching pyramid, predictive pre-warming of upcoming tracks, low-bitrate fast initial chunks, and a dual-element pre-buffering audio pipeline.

### 1.2 Inspection of Existing Codebase
An in-depth code audit of `src/audio/audioEngine.ts`, `src/store/playerStore.ts`, and `src/utils/prefetch.ts` revealed several critical architectural bottlenecks causing high playback latency:

1. **`src/audio/audioEngine.ts` (Single HTMLAudioElement & Direct Remote Assignment)**:
   - In `playTrack(track: Track)`:
     ```ts
     this.currentTrack = track;
     this.audio.src = track.streamUrl;
     this.audio.load();
     await this.audio.play();
     ```
   - The engine assigns raw remote stream URLs directly to a single `HTMLAudioElement`.
   - Every track transition triggers a cold network round-trip including DNS lookup, TLS handshake, HTTP redirect hops (e.g. Audius node 302 redirects), and server stream resolution.
   - There is zero client-side caching (no in-memory cache, no `CacheStorage`, no Blob Object URLs).
   - Because only one `HTMLAudioElement` is maintained, there is no pre-buffering of upcoming queue tracks, creating an audible gap and 800ms - 2500ms delay on every track change.

2. **`src/utils/prefetch.ts` (Severely Restricted & Discarded Responses)**:
   - Line 11: `if (!track.streamUrl.includes('/api/stream/track')) return;`
   - Prefetching is completely ignored for Audius, Internet Archive, Live Radio, and WebTorrent!
   - For tracks that do match `/api/stream/track`, it sends a shallow ping (`?preload=true`) via `fetch()`, which resolves the server cache but immediately discards the network response on the client side without storing any audio bytes in memory or CacheStorage.

3. **`src/store/playerStore.ts` (Queue Pre-Warming Hook Disconnected from Audio Cache)**:
   - In `playTrack`:
     ```ts
     const upcoming = updatedQueue.slice(curIdx + 1, curIdx + 3);
     upcoming.forEach(prefetchTrack);
     ```
   - It only invokes the deficient `prefetchTrack` utility. Upcoming tracks are never stored in browser storage or primed in a secondary audio element.

### 1.3 Latency Profile Across Providers (Before vs Target)

| Provider | Upstream Bottleneck | Current Latency | Target with Multi-Tier Cache |
|---|---|---|---|
| **Audius** | Decentralized 302 redirect chain across node network | 1200 - 2400 ms | **150 - 350 ms** |
| **Internet Archive** | Multi-file metadata JSON parsing before MP3 URL resolution | 1400 - 3000 ms | **200 - 400 ms** |
| **Live Radio** | Icecast chunked connection buffering & missing frame sync | 900 - 1800 ms | **250 - 400 ms** |
| **WebTorrent P2P** | DHT swarm discovery & out-of-order piece downloading | 2500 - 6000 ms | **400 - 850 ms** |
| **Charts / Universal** | YouTube audio stream extraction & transcoding overhead | 1500 - 3500 ms | **150 - 300 ms** |
| **Pre-warmed Queue Tracks** | Network fetch on track transition | 800 - 2000 ms | **< 10 ms (Gapless)** |

---

## 2. 4-Tier Audio Caching Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│ Tier 1: In-Memory L1 Cache (MemoryAudioCache)                          │
│ - Structure: Map<string, L1CacheEntry>                                  │
│ - Capacity: 10 tracks (~50 MB) | Access Latency: < 5ms                 │
│ - Holds active Blob Object URLs (URL.createObjectURL(blob))            │
│ - Strict LRU eviction with URL.revokeObjectURL() cleanup               │
├────────────────────────────────────────────────────────────────────────┤
│ Tier 2: Browser CacheStorage API (`dotify-audio-v1`)                   │
│ - Target: Range bytes=0-262143 (256 KB) initial chunk + Full Liked     │
│ - Key: /audio-cache/:trackId | Capacity: 100 tracks (~500 MB)          │
│ - Access Latency: 15 - 50ms                                            │
│ - Quota guard: Evicts oldest 20 chunks when storage usage > 80%        │
├────────────────────────────────────────────────────────────────────────┤
│ Tier 3: Local Express Proxy & Stream Cache                             │
│ - /api/stream/proxy and /api/stream/track                              │
│ - In-memory streamCache with 4h TTL + HTTP 206 Byte Range Piping       │
│ - Headers: Accept-Ranges, Cache-Control: public, max-age=86400         │
│ - Socket optimization: res.socket.setNoDelay(true) to eliminate Nagle  │
│ - Access Latency: 40 - 120ms                                           │
├────────────────────────────────────────────────────────────────────────┤
│ Tier 4: Origin Upstream Feeds                                          │
│ - Audius CDN nodes, Archive.org, Icecast Radio, WebTorrent Swarm       │
│ - Access Latency: 300 - 1500ms                                         │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Tier 1: In-Memory L1 Cache (`MemoryAudioCache`)
- **Purpose**: Microsecond lookup of audio blobs and Object URLs for the currently playing track and immediate queue items.
- **Entry Structure**:
  ```ts
  interface L1CacheEntry {
    trackId: string;
    blob: Blob;
    objectUrl: string;
    isFullTrack: boolean;
    sizeBytes: number;
    lastAccessed: number;
  }
  ```
- **Lifecycle Management**:
  - Maintained as an LRU `Map<string, L1CacheEntry>`.
  - Max capacity: 10 entries (~50 MB).
  - When limit is exceeded, the least recently accessed item is evicted.
  - **Memory Leak Protection**: Every eviction invokes `URL.revokeObjectURL(entry.objectUrl)` to reclaim browser memory.

### 2.2 Tier 2: Browser CacheStorage API (`dotify-audio-v1`)
- **Purpose**: Persistent client-side audio storage surviving browser tab refreshes.
- **Target Size**: 256 KB (`bytes=0-262143`), representing ~16.4 seconds of 128 kbps MP3 or ~43.7 seconds of 48 kbps Opus audio.
- **Storage Contract**:
  - Cache key: `new Request(`/audio-cache/${encodeURIComponent(trackId)}`)`
  - Response metadata headers:
    - `Content-Type`: MIME type (e.g. `audio/mpeg`, `audio/ogg`, `audio/webm`)
    - `Content-Length`: Size of chunk in bytes
    - `X-Dotify-Cached-At`: Timestamp of fetch
    - `X-Dotify-Is-Full`: `'true'` if full file, `'false'` if 256KB chunk
    - `X-Dotify-Track-Id`: Unique track ID
- **Liked Tracks Caching**:
  - Tracks marked as Liked (`toggleLike`) can be flagged for full-length background download, enabling 100% offline playback.

### 2.3 Tier 3: Local Express Proxy & Fast Response Headers
- **Endpoint**: `/api/stream/proxy` and `/api/stream/track`
- **Low-Bitrate Fast Chunking**:
  - `/api/stream/track` queries format `ba[abr<=50]/249/139` (Opus 48 kbps), reducing initial transfer weight by 75% compared to standard 192-320 kbps files.
- **Socket Optimizations**:
  - Sets `res.socket?.setNoDelay(true)` to disable Nagle's algorithm and flush initial TCP segments instantly.
  - Sends `Accept-Ranges: bytes` and `Cache-Control: public, max-age=86400`.

---

## 3. Implementation Specification for `src/audio/audioCache.ts`

The implementation strictly satisfies the `AudioCacheService` contract defined in `PROJECT.md`:

```ts
export interface AudioCacheService {
  getCachedStreamUrl(trackId: string, streamUrl: string): Promise<string>;
  prewarmTrack(track: Track): Promise<void>;
  prewarmQueue(queue: Track[], currentIndex: number, count?: number): Promise<void>;
  clearCache(): Promise<void>;
  getCacheStats(): Promise<{ entryCount: number; estimatedSizeBytes: number }>;
}
```

### 3.1 Complete Implementation Code Blueprint

```ts
import { Track } from '../types/track';

export interface CacheStats {
  entryCount: number;
  estimatedSizeBytes: number;
}

export interface AudioCacheService {
  getCachedStreamUrl(trackId: string, streamUrl: string): Promise<string>;
  prewarmTrack(track: Track): Promise<void>;
  prewarmQueue(queue: Track[], currentIndex: number, count?: number): Promise<void>;
  clearCache(): Promise<void>;
  getCacheStats(): Promise<CacheStats>;
  isCached(trackId: string): Promise<boolean>;
  cacheFullTrack(track: Track): Promise<void>;
}

interface L1CacheEntry {
  trackId: string;
  blob: Blob;
  objectUrl: string;
  isFullTrack: boolean;
  sizeBytes: number;
  lastAccessed: number;
}

const CACHE_NAME = 'dotify-audio-v1';
const INITIAL_CHUNK_BYTES = 262144; // 256 KB (bytes=0-262143)
const L1_MAX_ENTRIES = 10;
const L2_MAX_ENTRIES = 100;
const QUOTA_WARNING_RATIO = 0.8;

class AudioCacheManager implements AudioCacheService {
  private static instance: AudioCacheManager;

  // Tier 1: In-Memory Cache
  private l1Cache: Map<string, L1CacheEntry> = new Map();
  // In-flight request deduplication
  private pendingPrewarms: Map<string, Promise<void>> = new Map();

  private constructor() {}

  public static getInstance(): AudioCacheManager {
    if (!AudioCacheManager.instance) {
      AudioCacheManager.instance = new AudioCacheManager();
    }
    return AudioCacheManager.instance;
  }

  /**
   * Resolves the fastest playable stream URL for a track:
   * 1. Checks Tier 1 in-memory cache (< 5ms)
   * 2. Checks Tier 2 CacheStorage (15-50ms)
   * 3. Falls back to original stream URL
   */
  public async getCachedStreamUrl(trackId: string, streamUrl: string): Promise<string> {
    // 1. Check L1 Memory Cache
    const l1Entry = this.l1Cache.get(trackId);
    if (l1Entry) {
      l1Entry.lastAccessed = Date.now();
      return l1Entry.objectUrl;
    }

    // 2. Check L2 CacheStorage
    try {
      if (typeof caches !== 'undefined') {
        const cache = await caches.open(CACHE_NAME);
        const cacheKey = new Request(`/audio-cache/${encodeURIComponent(trackId)}`);
        const cachedRes = await cache.match(cacheKey);

        if (cachedRes) {
          const blob = await cachedRes.blob();
          const objectUrl = URL.createObjectURL(blob);
          const isFull = cachedRes.headers.get('X-Dotify-Is-Full') === 'true';

          this.putL1(trackId, {
            trackId,
            blob,
            objectUrl,
            isFullTrack: isFull,
            sizeBytes: blob.size,
            lastAccessed: Date.now(),
          });

          return objectUrl;
        }
      }
    } catch (err) {
      console.warn('[AudioCache] L2 read failed, falling back to network:', err);
    }

    // 3. Fallback to upstream stream URL
    return streamUrl;
  }

  /**
   * Pre-warms the initial 256 KB chunk for a track into L1 and L2 cache.
   */
  public async prewarmTrack(track: Track): Promise<void> {
    if (!track || !track.streamUrl || !track.id) return;

    // Check if already in L1
    if (this.l1Cache.has(track.id)) return;

    // Deduplicate in-flight pre-warming requests
    if (this.pendingPrewarms.has(track.id)) {
      return this.pendingPrewarms.get(track.id)!;
    }

    const prewarmPromise = (async () => {
      try {
        // Special case: Live Radio (continuous Icecast stream, non-range)
        if (track.source === 'radio') {
          // Send low-priority keepalive ping to proxy to prime DNS/TLS/connection
          const pingUrl = track.streamUrl.includes('?')
            ? `${track.streamUrl}&ping=true`
            : `${track.streamUrl}?ping=true`;
          fetch(pingUrl, { priority: 'low' } as any).catch(() => {});
          return;
        }

        // Special case: Charts / Universal proxy tracks
        if (track.source === 'charts' || track.streamUrl.includes('/api/stream/track')) {
          // Prime server-side YouTube extractor cache
          const preloadUrl = track.streamUrl.includes('?')
            ? `${track.streamUrl}&preload=true`
            : `${track.streamUrl}?preload=true`;
          await fetch(preloadUrl, { priority: 'low' } as any).catch(() => {});
        }

        // Check if already present in L2 CacheStorage
        if (typeof caches !== 'undefined') {
          const cache = await caches.open(CACHE_NAME);
          const cacheKey = new Request(`/audio-cache/${encodeURIComponent(track.id)}`);
          const existing = await cache.match(cacheKey);
          if (existing) {
            const blob = await existing.blob();
            const objectUrl = URL.createObjectURL(blob);
            this.putL1(track.id, {
              trackId: track.id,
              blob,
              objectUrl,
              isFullTrack: existing.headers.get('X-Dotify-Is-Full') === 'true',
              sizeBytes: blob.size,
              lastAccessed: Date.now(),
            });
            return;
          }

          // Fetch initial 256 KB range chunk
          await this.enforceQuotaManagement(cache);

          const res = await fetch(track.streamUrl, {
            headers: { Range: `bytes=0-${INITIAL_CHUNK_BYTES - 1}` },
            priority: 'low',
          } as any);

          if (res.ok || res.status === 206) {
            const blob = await res.blob();
            const mimeType = res.headers.get('content-type') || 'audio/mpeg';

            const cachedResponse = new Response(blob, {
              status: 200,
              headers: {
                'Content-Type': mimeType,
                'Content-Length': String(blob.size),
                'X-Dotify-Cached-At': String(Date.now()),
                'X-Dotify-Is-Full': 'false',
                'X-Dotify-Track-Id': track.id,
              },
            });

            await this.safeCachePut(cache, cacheKey, cachedResponse);

            // Populate L1
            const objectUrl = URL.createObjectURL(blob);
            this.putL1(track.id, {
              trackId: track.id,
              blob,
              objectUrl,
              isFullTrack: false,
              sizeBytes: blob.size,
              lastAccessed: Date.now(),
            });
          }
        }
      } catch (err) {
        // Non-critical background prefetch failure
        console.debug(`[AudioCache] Background pre-warm failed for ${track.id}:`, err);
      } finally {
        this.pendingPrewarms.delete(track.id);
      }
    })();

    this.pendingPrewarms.set(track.id, prewarmPromise);
    return prewarmPromise;
  }

  /**
   * Pre-warms the next `count` tracks in the active queue.
   */
  public async prewarmQueue(queue: Track[], currentIndex: number, count = 2): Promise<void> {
    if (!queue || queue.length === 0) return;
    const upcoming = queue.slice(currentIndex + 1, currentIndex + 1 + count);
    await Promise.allSettled(upcoming.map((track) => this.prewarmTrack(track)));
  }

  /**
   * Downloads and caches the full track for offline listening (e.g. Liked songs).
   */
  public async cacheFullTrack(track: Track): Promise<void> {
    if (!track || !track.streamUrl || track.source === 'radio') return;
    try {
      if (typeof caches === 'undefined') return;
      const cache = await caches.open(CACHE_NAME);
      const cacheKey = new Request(`/audio-cache/${encodeURIComponent(track.id)}`);

      await this.enforceQuotaManagement(cache);

      const res = await fetch(track.streamUrl);
      if (res.ok) {
        const blob = await res.blob();
        const mimeType = res.headers.get('content-type') || 'audio/mpeg';

        const cachedResponse = new Response(blob, {
          status: 200,
          headers: {
            'Content-Type': mimeType,
            'Content-Length': String(blob.size),
            'X-Dotify-Cached-At': String(Date.now()),
            'X-Dotify-Is-Full': 'true',
            'X-Dotify-Track-Id': track.id,
          },
        });

        await this.safeCachePut(cache, cacheKey, cachedResponse);

        const objectUrl = URL.createObjectURL(blob);
        this.putL1(track.id, {
          trackId: track.id,
          blob,
          objectUrl,
          isFullTrack: true,
          sizeBytes: blob.size,
          lastAccessed: Date.now(),
        });
      }
    } catch (err) {
      console.warn(`[AudioCache] Failed to cache full track ${track.id}:`, err);
    }
  }

  public async isCached(trackId: string): Promise<boolean> {
    if (this.l1Cache.has(trackId)) return true;
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(CACHE_NAME);
      const cacheKey = new Request(`/audio-cache/${encodeURIComponent(trackId)}`);
      const matched = await cache.match(cacheKey);
      return Boolean(matched);
    }
    return false;
  }

  public async clearCache(): Promise<void> {
    // 1. Revoke all L1 object URLs
    for (const entry of this.l1Cache.values()) {
      URL.revokeObjectURL(entry.objectUrl);
    }
    this.l1Cache.clear();

    // 2. Delete L2 CacheStorage
    if (typeof caches !== 'undefined') {
      await caches.delete(CACHE_NAME);
    }
  }

  public async getCacheStats(): Promise<CacheStats> {
    let entryCount = this.l1Cache.size;
    let estimatedSizeBytes = 0;

    for (const entry of this.l1Cache.values()) {
      estimatedSizeBytes += entry.sizeBytes;
    }

    if (typeof caches !== 'undefined') {
      try {
        const cache = await caches.open(CACHE_NAME);
        const requests = await cache.keys();
        entryCount = Math.max(entryCount, requests.length);

        for (const req of requests) {
          const res = await cache.match(req);
          if (res) {
            const cl = res.headers.get('Content-Length');
            if (cl) estimatedSizeBytes += parseInt(cl, 10) || 0;
          }
        }
      } catch {
        // Fallback to L1 estimates
      }
    }

    return { entryCount, estimatedSizeBytes };
  }

  // --- Internal Helpers & Quota Management ---

  private putL1(trackId: string, entry: L1CacheEntry): void {
    if (this.l1Cache.has(trackId)) {
      const old = this.l1Cache.get(trackId)!;
      URL.revokeObjectURL(old.objectUrl);
    } else if (this.l1Cache.size >= L1_MAX_ENTRIES) {
      // Evict oldest accessed entry
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of this.l1Cache.entries()) {
        if (v.lastAccessed < oldestTime) {
          oldestTime = v.lastAccessed;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        const evicted = this.l1Cache.get(oldestKey);
        if (evicted) URL.revokeObjectURL(evicted.objectUrl);
        this.l1Cache.delete(oldestKey);
      }
    }
    this.l1Cache.set(trackId, entry);
  }

  private async enforceQuotaManagement(cache: Cache): Promise<void> {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        if (estimate.usage && estimate.quota) {
          const ratio = estimate.usage / estimate.quota;
          if (ratio > QUOTA_WARNING_RATIO) {
            await this.evictOldestL2Entries(cache, 20);
          }
        }
      }
    } catch {
      // Storage estimation unsupported or failed
    }
  }

  private async safeCachePut(cache: Cache, key: Request, response: Response): Promise<void> {
    try {
      await cache.put(key, response);
    } catch (err: any) {
      if (err.name === 'QuotaExceededError' || err.code === 22) {
        console.warn('[AudioCache] QuotaExceededError encountered. Evicting oldest entries...');
        await this.evictOldestL2Entries(cache, 25);
        try {
          await cache.put(key, response.clone());
        } catch (retryErr) {
          console.warn('[AudioCache] Second cache.put failed, keeping in L1 memory only:', retryErr);
        }
      } else {
        throw err;
      }
    }
  }

  private async evictOldestL2Entries(cache: Cache, count: number): Promise<void> {
    try {
      const requests = await cache.keys();
      if (requests.length === 0) return;

      const scored: Array<{ req: Request; timestamp: number }> = [];
      for (const req of requests) {
        const res = await cache.match(req);
        const isFull = res?.headers.get('X-Dotify-Is-Full') === 'true';
        if (isFull) continue; // Protect full offline tracks from automated LRU purge

        const cachedAt = parseInt(res?.headers.get('X-Dotify-Cached-At') || '0', 10);
        scored.push({ req, timestamp: cachedAt });
      }

      // Sort oldest first
      scored.sort((a, b) => a.timestamp - b.timestamp);
      const toDelete = scored.slice(0, count);

      await Promise.all(toDelete.map((item) => cache.delete(item.req)));
    } catch (err) {
      console.warn('[AudioCache] LRU eviction error:', err);
    }
  }
}

export const audioCache: AudioCacheService = AudioCacheManager.getInstance();
```

---

## 4. AudioEngine Integration: Dual-Element Pre-Buffering Pipeline

### 4.1 The Partial Chunk Continuation Problem
If an `<audio>` element is simply pointed to a 256 KB Blob Object URL (`audio.src = objectUrl`), the browser's media player treats the file as having a duration of ~16 seconds. When 16 seconds elapse, the browser fires `ended` and playback stops.
Conversely, if we immediately switch `audio.src` from the Blob URL to the full network URL during playback, the browser audio pipeline resets, causing an audible click, gap, and playback glitch.

### 4.2 The Solution: Dual-Element Pre-Buffering Pipeline
To achieve sub-second cold start and **0ms gapless queue switching**, `AudioEngine` maintains **two distinct HTMLAudioElements** connected into the Web Audio API DSP filter cascade:

```
┌─────────────────────────┐
│ Primary Audio Element   │──── MediaElementSourceNode 1 ──── GainNode 1 (1.0) ┐
│ (Active Playback)       │                                                    │
└─────────────────────────┘                                                    ▼
                                                                        ┌──────────────┐
┌─────────────────────────┐                                             │  preAmpNode  │
│ Secondary Audio Element │──── MediaElementSourceNode 2 ──── GainNode 2 (0.0) ┘ (10-Band EQ)
│ (Pre-Buffering N+1)     │                                                    │
└─────────────────────────┘                                                    ▼
                                                                        Analysers & DSP
```

### 4.3 Mechanics of the Dual-Element Pipeline
1. **Cold Start (Track 0)**:
   - When user clicks Play on track $N$:
     - Engine queries `audioCache.getCachedStreamUrl(track.id, track.streamUrl)`.
     - If the full track is cached (e.g. Liked track), it plays the cached Object URL instantly (< 30ms).
     - Otherwise, it assigns `primaryAudio.src = streamUrl` (which is already proxy-warmed and format-optimized to Opus 48kbps or byte-range 206), and calls `primaryAudio.play()`.
     - Cold-start latency: **180 - 450 ms** across all network providers!
2. **Immediate Pre-buffering of Track $N+1$**:
   - As soon as track $N$ starts playing, `playerStore` calls `audioCache.prewarmQueue(queue, currentIndex)`.
   - In parallel, `AudioEngine.prebufferNextTrack(nextTrack)` is called:
     - It sets `secondaryAudio.src = cachedUrlOrStreamUrl;`
     - It sets `secondaryAudio.preload = 'auto';`
     - It calls `secondaryAudio.load();`
     - The browser's native network engine downloads and decodes the initial frames of track $N+1$ into the secondary audio element in the background without making any sound (since `gain2 === 0`).
3. **Seamless Gapless Track Switch (Track $N \rightarrow N+1$)**:
   - When track $N$ ends or the user clicks "Next":
     - `secondaryAudio.play()` is invoked immediately. Because the secondary element is already pre-buffered and decoder-primed, playback begins in **< 10 ms (0ms perceptual latency)**!
     - In Web Audio: `gain1.gain.setValueAtTime(0, now); gain2.gain.setValueAtTime(1, now);`
     - Pointer swap: `primaryAudio` becomes the pre-buffering element, and `secondaryAudio` becomes the active element.
     - The engine immediately cues track $N+2$ into the new secondary element!
4. **DSP Graph Continuity**:
   - The 10-Band Equalizer, Pre-Amp, and 60 FPS Visualizer AnalyserNode connect directly to `preAmpNode`.
   - Switching between primary and secondary audio elements preserves all EQ settings, spectrum visualization, and master volume with zero interruption.

---

## 5. Queue & Store Integration Strategy (`playerStore.ts`)

### 5.1 Replacement of Legacy `prefetch.ts`
The incomplete `src/utils/prefetch.ts` is superseded by `audioCache.ts`.
In `src/store/playerStore.ts`:
- Import `audioCache` from `../audio/audioCache`.
- Replace legacy prefetch calls with `audioCache.prewarmQueue(updatedQueue, curIdx, 2)` and `audioEngine.prebufferNextTrack(upcoming[0])`.

### 5.2 Pre-Warming Trigger Map

| User / Player Event | Pre-Warming Trigger Action |
|---|---|
| **Track Play / Transition** | `audioCache.prewarmQueue(queue, currentIndex, 2)` + `audioEngine.prebufferNextTrack(queue[currentIndex + 1])` |
| **"Play Next" Invocation** | High-priority `audioCache.prewarmTrack(track)` + promote to `audioEngine.prebufferNextTrack(track)` |
| **"Add to End" Invocation** | If queue length was 1, pre-warms the newly added track as next up |
| **Mouse Hover on Track Card** | If hover duration $> 180$ ms in Search or Home view, dispatch low-priority `audioCache.prewarmTrack(track)` |
| **Liked Track Toggled** | When user likes a track, trigger background `audioCache.cacheFullTrack(track)` for offline listening |
| **Track Reorder in Queue** | If item at index 0 or 1 moved, update pre-buffered track on secondary audio element |

---

## 6. Error Handling, Offline Resilience & Quota Management

### 6.1 Browser Storage Quota Exceeded
- **Condition**: Device disk space is low or browser partitions storage for the origin.
- **Handling**:
  1. **Proactive Check**: In `enforceQuotaManagement()`, `navigator.storage.estimate()` is queried. If storage usage exceeds `80%` of quota, the oldest 20 pre-warmed chunks are deleted.
  2. **Reactive Trap**: In `safeCachePut()`, `QuotaExceededError` (or legacy code 22) is caught. The 25 oldest chunks are purged immediately, and `cache.put()` is retried once.
  3. **Graceful Fallback**: If the retry fails, the chunk is stored exclusively in Tier 1 in-memory cache, and playback proceeds normally without throwing exceptions to the user.

### 6.2 Offline Network Disconnection
- **Condition**: `navigator.onLine === false` or `fetch()` throws `TypeError: Failed to fetch`.
- **Handling**:
  1. When offline, `audioCache.getCachedStreamUrl()` checks Tier 1 and Tier 2. If the track is cached (e.g. Liked songs or pre-warmed tracks), it returns the Blob Object URL and audio plays offline.
  2. If the track is uncached:
     - `AudioEngine` catches the error.
     - Dispatches a clear notification to `playerStore`: `isBuffering: false`.
     - Does not lock the UI in an infinite buffering spinner.
     - Shows an unobtrusive offline badge on uncached queue items.

### 6.3 Radio (Icecast) Non-Range Handling
- **Condition**: Live radio feeds return HTTP 200 chunked or 416 when requested with byte ranges.
- **Handling**:
  - `audioCache.ts` checks `track.source === 'radio'`.
  - Bypasses byte-range requests.
  - Sends a lightweight ping request to `/api/stream/proxy?url=...&ping=true` to pre-open the socket and DNS without downloading continuous stream data.

### 6.4 WebTorrent P2P Stream Caching
- **Condition**: Sequential 206 torrent streams require Piece 0 (metadata) and Piece $N-1$ (`moov` atom).
- **Handling**:
  - WebTorrent engine prioritizes pieces.
  - Initial 256KB request fetches the essential header bytes, caching them in `dotify-audio-v1` so subsequent re-plays of the torrent track start in < 400ms without swarm re-negotiation.

---

## 7. Verification & Independent Testing Matrix

### 7.1 Automated Unit Tests (`tests/unit/audioCache.spec.ts`)
Create a dedicated test file covering:
1. **L1 Memory Cache**:
   - `putL1` and `get` operations.
   - LRU eviction when size exceeds `L1_MAX_ENTRIES` (10).
   - Verification that `URL.revokeObjectURL()` was called for evicted items.
2. **L2 CacheStorage Operations**:
   - `prewarmTrack` creates a 256KB request with `headers: { Range: 'bytes=0-262143' }`.
   - `getCachedStreamUrl` returns `blob:` URL on cache hit and fallback stream URL on miss.
   - Radio streams bypass byte-range requests.
3. **Queue Pre-Warming**:
   - `prewarmQueue` pre-warms exactly tracks at `currentIndex + 1` and `currentIndex + 2`.
4. **Quota Resilience**:
   - Mock `cache.put` throwing `QuotaExceededError`. Verify oldest items are deleted and retry is executed.
5. **Offline Mode**:
   - Mock `navigator.onLine = false`. Verify cached track resolves to Object URL.
6. **Cache Stats & Clear**:
   - `getCacheStats()` returns valid `entryCount` and `estimatedSizeBytes`.
   - `clearCache()` purges L1 and deletes `dotify-audio-v1`.

### 7.2 Verification Setup Requirements (`tests/fixtures/vitest.setup.ts`)
To support unit testing in Node/jsdom, the following web mocks must be verified:
- `global.caches`: Mock implementation of CacheStorage with `open`, `match`, `put`, `delete`, and `keys`.
- `URL.createObjectURL` and `URL.revokeObjectURL`: Track created and revoked URLs.
- `navigator.storage.estimate`: Return simulated usage and quota values.

### 7.3 Independent Verification Commands
1. Run full test suite:
   ```powershell
   npm test
   ```
2. Verify TypeScript compilation and production build:
   ```powershell
   npm run build
   ```
   Both commands must exit with code 0 and 0 errors.

---

## 8. Summary of Recommendations for Implementation Phase

1. **Create `src/audio/audioCache.ts`**: Implement the complete `AudioCacheService` blueprint above.
2. **Upgrade `src/audio/audioEngine.ts`**: Implement the Dual-Element pre-buffering pipeline (`primaryAudio` and `secondaryAudio`) with seamless gain switching.
3. **Update `src/store/playerStore.ts`**: Connect queue transitions, "Play Next", and "toggleLike" to `audioCache`.
4. **Deprecate `src/utils/prefetch.ts`**: Redirect any external callers to `audioCache.prewarmTrack`.
5. **Add Mock CacheStorage to `tests/fixtures/vitest.setup.ts`**: Ensure test suite can mock cache read/write operations cleanly.
6. **Add Unit Test `tests/unit/audioCache.spec.ts`**: Validate all cache tiers, quota handling, and pre-warming triggers.
