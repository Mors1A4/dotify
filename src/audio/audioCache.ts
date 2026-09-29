import { Track } from '../types/track';
import { getApiUrl, isAndroidApp } from '../services/apiConfig';

export interface CacheStats {
  entryCount: number;
  estimatedSizeBytes: number;
}

export interface AudioCacheService {
  getCachedStreamUrl(trackId: string, streamUrl: string, requireFullTrack?: boolean): Promise<string>;
  prewarmTrack(track: Track): Promise<void>;
  prewarmQueue(queue: Track[], currentIndex: number, count?: number): Promise<void>;
  clearCache(): Promise<void>;
  getCacheStats(): Promise<CacheStats>;
  isCached(trackId: string): Promise<boolean>;
  cacheFullTrack(track: Track): Promise<void>;
  getCachedFullBlob(trackId: string): Promise<Blob | null>;
  storeFullBlob(trackId: string, blob: Blob): Promise<void>;
  deleteCachedTrack(trackId: string): Promise<void>;
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
const FULL_CACHE_VERSION = '3';
const INITIAL_CHUNK_BYTES = 262144; // 256 KB (bytes=0-262143)
const L1_MAX_ENTRIES = 10;
const QUOTA_WARNING_RATIO = 0.8;

function resolveBackendFullUrl(track: Track): string {
  const rawUrl = track.streamUrl || '';
  if (!rawUrl || rawUrl.includes('dzcdn.net')) {
    if (track.artist && track.title) {
      const rawId = String(track.id || '').replace(/^(charts|audius|archive|radio|p2p):/, '');
      const expectedDuration = track.duration && isFinite(track.duration) ? track.duration : 210;
      return getApiUrl(
        `/api/stream/track?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(
          track.title
        )}&id=${encodeURIComponent(rawId)}&duration=${expectedDuration}`
      );
    }
  }
  if (rawUrl.startsWith('/api/')) {
    return getApiUrl(rawUrl);
  }
  return rawUrl;
}

function getCacheRequest(trackId: string): Request {
  const path = `/audio-cache/${encodeURIComponent(trackId)}`;
  try {
    return new Request(path);
  } catch {
    return new Request(`http://localhost${path}`);
  }
}

export class AudioCacheManager implements AudioCacheService {
  private static instance: AudioCacheManager;

  // Tier 1: In-Memory LRU Cache
  private l1Cache: Map<string, L1CacheEntry> = new Map();
  // In-flight pre-warm request deduplication
  private pendingPrewarms: Map<string, Promise<void>> = new Map();

  public constructor() {}

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
   *
   * When `requireFullTrack` is true (used by AudioEngine for full playback),
   * partial 256KB pre-warm chunks (`isFullTrack === false`) and legacy unverified
   * cache entries are bypassed so HTMLAudioElement never truncates at ~30s.
   */
  public async getCachedStreamUrl(
    trackId: string,
    streamUrl: string,
    requireFullTrack = false
  ): Promise<string> {
    // 1. Check L1 Memory Cache
    const l1Entry = this.l1Cache.get(trackId);
    if (l1Entry) {
      l1Entry.lastAccessed = Date.now();
      if (!requireFullTrack || l1Entry.isFullTrack) {
        return l1Entry.objectUrl;
      }
      return streamUrl;
    }

    // 2. Check L2 CacheStorage
    try {
      if (typeof caches !== 'undefined') {
        const cache = await caches.open(CACHE_NAME);
        const cacheKey = getCacheRequest(trackId);
        const cachedRes = await cache.match(cacheKey);

        if (cachedRes) {
          const rawIsFull = cachedRes.headers.get('X-Dotify-Is-Full') === 'true';
          const isVerifiedFull =
            rawIsFull && cachedRes.headers.get('X-Dotify-Full-Version') === FULL_CACHE_VERSION;

          // Purge legacy v1 full-track cache entries that may contain 30s preview clips
          if (rawIsFull && !isVerifiedFull) {
            await cache.delete(cacheKey).catch(() => {});
            return streamUrl;
          }

          if (requireFullTrack && !isVerifiedFull) {
            return streamUrl;
          }

          const blob = await cachedRes.blob();
          const isSuspectedPreviewClip =
            requireFullTrack && blob.size >= 100_000 && blob.size <= 520_000;
          if (isSuspectedPreviewClip) {
            await cache.delete(cacheKey).catch(() => {});
            return streamUrl;
          }

          const objectUrl = URL.createObjectURL(blob);

          this.putL1(trackId, {
            trackId,
            blob,
            objectUrl,
            isFullTrack: isVerifiedFull,
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
   * Pre-warms the initial 256 KB chunk for a track into L1 and L2 cache,
   * or triggers backend stream resolution for `/api/stream/track` tracks.
   */
  public async prewarmTrack(track: Track): Promise<void> {
    if (!track || !track.streamUrl || !track.id) return;

    // Check if already in L1 as a full track
    const existingL1 = this.l1Cache.get(track.id);
    if (existingL1 && existingL1.isFullTrack) return;

    // Deduplicate in-flight pre-warming requests
    if (this.pendingPrewarms.has(track.id)) {
      return this.pendingPrewarms.get(track.id)!;
    }

    const prewarmPromise = (async () => {
      try {
        const effectiveStreamUrl = resolveBackendFullUrl(track);

        // Special case: Live Radio (continuous Icecast stream, non-range)
        if (track.source === 'radio') {
          const pingUrl = effectiveStreamUrl.includes('?')
            ? `${effectiveStreamUrl}&ping=true`
            : `${effectiveStreamUrl}?ping=true`;
          fetch(pingUrl).catch(() => {});
          return;
        }

        // Check if already present in L2 CacheStorage before making network requests
        if (typeof caches !== 'undefined') {
          const cache = await caches.open(CACHE_NAME);
          const cacheKey = getCacheRequest(track.id);
          const existing = await cache.match(cacheKey);
          if (existing) {
            const rawIsFull = existing.headers.get('X-Dotify-Is-Full') === 'true';
            const isVerifiedFull =
              rawIsFull && existing.headers.get('X-Dotify-Full-Version') === FULL_CACHE_VERSION;

            if (rawIsFull && !isVerifiedFull) {
              await cache.delete(cacheKey).catch(() => {});
            } else if (isVerifiedFull) {
              const blob = await existing.blob();
              const objectUrl = URL.createObjectURL(blob);
              this.putL1(track.id, {
                trackId: track.id,
                blob,
                objectUrl,
                isFullTrack: true,
                sizeBytes: blob.size,
                lastAccessed: Date.now(),
              });
              return;
            }
          }
        }

        // Special case: Charts / Universal backend stream tracks
        // Warm the backend resolver cache via ?preload=true without downloading a 256KB partial chunk
        // that AudioEngine (requireFullTrack=true) would ignore anyway.
        if (track.source === 'charts' || effectiveStreamUrl.includes('/api/stream/track')) {
          const preloadUrl = effectiveStreamUrl.includes('?')
            ? `${effectiveStreamUrl}&preload=true`
            : `${effectiveStreamUrl}?preload=true`;
          await fetch(preloadUrl).catch(() => {});
          if (effectiveStreamUrl.includes('/api/stream/track')) {
            return;
          }
        }

        if (this.l1Cache.has(track.id)) return;

        // For direct non-backend streams, pre-warm initial 256KB chunk in L2 CacheStorage
        if (typeof caches !== 'undefined') {
          const cache = await caches.open(CACHE_NAME);
          const cacheKey = getCacheRequest(track.id);

          // Enforce storage quota
          await this.enforceQuotaManagement(cache);

          const res = await fetch(effectiveStreamUrl, {
            headers: { Range: `bytes=0-${INITIAL_CHUNK_BYTES - 1}` },
          });

          if ((res.ok || res.status === 206) && res.headers.get('X-Dotify-Preview-Fallback') !== 'true') {
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
      const effectiveStreamUrl = resolveBackendFullUrl(track);
      // Never cache a 30-second Deezer preview clip as a full offline track when backend is enabled
      if (effectiveStreamUrl.includes('dzcdn.net')) return;

      const cache = await caches.open(CACHE_NAME);
      const cacheKey = getCacheRequest(track.id);

      await this.enforceQuotaManagement(cache);

      const res = await fetch(effectiveStreamUrl);
      if (res.ok && res.headers.get('X-Dotify-Preview-Fallback') !== 'true') {
        const blob = await res.blob();
        // Reject ~480KB 30-second Deezer preview clips if a full track (>60s) was expected
        const isSuspectedPreviewClip =
          (!track.duration || track.duration > 60) &&
          blob.size >= 100_000 &&
          blob.size <= 520_000;
        if (isSuspectedPreviewClip) {
          console.warn(
            `[AudioCache] Skipping full-track cache for ${track.id}: blob size (${blob.size}B) looks like a 30s preview`
          );
          return;
        }

        const mimeType = res.headers.get('content-type') || 'audio/mpeg';

        const cachedResponse = new Response(blob, {
          status: 200,
          headers: {
            'Content-Type': mimeType,
            'Content-Length': String(blob.size),
            'X-Dotify-Cached-At': String(Date.now()),
            'X-Dotify-Is-Full': 'true',
            'X-Dotify-Full-Version': FULL_CACHE_VERSION,
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

  public async getCachedFullBlob(trackId: string): Promise<Blob | null> {
    const l1 = this.l1Cache.get(trackId);
    if (l1 && l1.isFullTrack && l1.blob && l1.blob.size > 1024) {
      return l1.blob;
    }
    if (typeof caches !== 'undefined') {
      try {
        const cache = await caches.open(CACHE_NAME);
        const cacheKey = getCacheRequest(trackId);
        const matched = await cache.match(cacheKey);
        if (matched && matched.headers.get('X-Dotify-Is-Full') === 'true') {
          const blob = await matched.blob();
          if (blob.size > 1024) {
            return blob;
          }
        }
      } catch {}
    }
    return null;
  }

  public async storeFullBlob(trackId: string, blob: Blob): Promise<void> {
    if (!trackId || !blob || blob.size <= 1024) return;
    try {
      if (typeof caches !== 'undefined') {
        const cache = await caches.open(CACHE_NAME);
        const cacheKey = getCacheRequest(trackId);
        await this.enforceQuotaManagement(cache);
        const cachedResponse = new Response(blob, {
          status: 200,
          headers: {
            'Content-Type': blob.type || 'audio/mpeg',
            'Content-Length': String(blob.size),
            'X-Dotify-Cached-At': String(Date.now()),
            'X-Dotify-Is-Full': 'true',
            'X-Dotify-Full-Version': FULL_CACHE_VERSION,
            'X-Dotify-Track-Id': trackId,
          },
        });
        await this.safeCachePut(cache, cacheKey, cachedResponse);
      }
      const objectUrl = URL.createObjectURL(blob);
      this.putL1(trackId, {
        trackId,
        blob,
        objectUrl,
        isFullTrack: true,
        sizeBytes: blob.size,
        lastAccessed: Date.now(),
      });
    } catch (err) {
      console.warn('[AudioCache] storeFullBlob failed:', err);
    }
  }

  public async deleteCachedTrack(trackId: string): Promise<void> {
    if (!trackId) return;
    const existing = this.l1Cache.get(trackId);
    if (existing) {
      if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
        URL.revokeObjectURL(existing.objectUrl);
      }
      this.l1Cache.delete(trackId);
    }
    if (typeof caches !== 'undefined') {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.delete(getCacheRequest(trackId));
      } catch {}
    }
  }

  public async isCached(trackId: string): Promise<boolean> {
    if (this.l1Cache.has(trackId)) return true;
    if (typeof caches !== 'undefined') {
      try {
        const cache = await caches.open(CACHE_NAME);
        const cacheKey = getCacheRequest(trackId);
        const matched = await cache.match(cacheKey);
        return Boolean(matched);
      } catch {
        return false;
      }
    }
    return false;
  }

  public async clearCache(): Promise<void> {
    // 1. Revoke all L1 object URLs
    for (const entry of this.l1Cache.values()) {
      if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
        URL.revokeObjectURL(entry.objectUrl);
      }
    }
    this.l1Cache.clear();

    // 2. Delete L2 CacheStorage
    if (typeof caches !== 'undefined') {
      try {
        await caches.delete(CACHE_NAME);
      } catch (err) {
        console.warn('[AudioCache] Failed to clear CacheStorage:', err);
      }
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

  public putL1(trackId: string, entry: L1CacheEntry): void {
    if (this.l1Cache.has(trackId)) {
      const old = this.l1Cache.get(trackId)!;
      if (typeof URL !== 'undefined' && URL.revokeObjectURL) {
        URL.revokeObjectURL(old.objectUrl);
      }
    } else if (this.l1Cache.size >= L1_MAX_ENTRIES) {
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
        if (evicted && typeof URL !== 'undefined' && URL.revokeObjectURL) {
          URL.revokeObjectURL(evicted.objectUrl);
        }
        this.l1Cache.delete(oldestKey);
      }
    }
    this.l1Cache.set(trackId, entry);
  }

  private async enforceQuotaManagement(cache: Cache): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
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

      scored.sort((a, b) => a.timestamp - b.timestamp);
      const toDelete = scored.slice(0, count);

      await Promise.all(toDelete.map((item) => cache.delete(item.req)));
    } catch (err) {
      console.warn('[AudioCache] LRU eviction error:', err);
    }
  }
}

export const audioCache: AudioCacheService = AudioCacheManager.getInstance();
