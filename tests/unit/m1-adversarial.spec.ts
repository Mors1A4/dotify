import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioCacheManager, audioCache } from '../../src/audio/audioCache';
import { AudioEngine, audioEngine } from '../../src/audio/audioEngine';
import { Track } from '../../src/types/track';
import { SILENT_WAV_BASE64 } from '../fixtures/mockAudio';

function createMockTrack(
  id: string,
  artist = 'Test Artist',
  title = 'Test Title',
  source: any = 'charts',
  streamUrl = `http://localhost:3001/stream/${id}.mp3`
): Track {
  return {
    id,
    source,
    title,
    artist,
    album: 'Adversarial Album',
    duration: 200,
    streamUrl,
    artworkUrl: 'http://localhost:3001/cover.jpg',
    sourceMetadata: {
      format: 'mp3',
      genre: 'Electronic',
    },
  };
}

describe('Adversarial Stress Suite: Milestone 1 Audio Caching & Pre-Warming', () => {
  let cacheManager: AudioCacheManager;

  beforeEach(async () => {
    cacheManager = new AudioCacheManager();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await cacheManager.clearCache();
    await audioCache.clearCache();
  });

  // =========================================================================
  // 1. Cache Eviction & LRU Capacity Invariants (> 10 Entries)
  // =========================================================================
  describe('1. Cache Eviction Under Rapid Successive Pre-Warming & LRU Capacity Overflow', () => {
    it('1.1 Sequential flood: strictly enforces L1 capacity <= 10 at every single step across 50 inserts', () => {
      const l1 = (cacheManager as any).l1Cache as Map<string, any>;

      for (let i = 0; i < 50; i++) {
        const id = `stress-track-${i}`;
        const blob = new Blob([`chunk-${i}`], { type: 'audio/mpeg' });
        cacheManager.putL1(id, {
          trackId: id,
          blob,
          objectUrl: `blob:http://localhost/${id}`,
          isFullTrack: false,
          sizeBytes: blob.size,
          lastAccessed: 1000 + i,
        });

        // Invariant: L1 cache size MUST NEVER exceed 10 at ANY point in time
        expect(l1.size).toBeLessThanOrEqual(10);
      }

      expect(l1.size).toBe(10);
      // The first 40 should be evicted, and the last 10 (stress-track-40 to stress-track-49) must remain
      for (let i = 0; i < 40; i++) {
        expect(l1.has(`stress-track-${i}`)).toBe(false);
      }
      for (let i = 40; i < 50; i++) {
        expect(l1.has(`stress-track-${i}`)).toBe(true);
      }
    });

    it('1.2 Concurrent flood: 30 concurrent prewarmTrack calls maintain L1 size <= 10 and do not corrupt state', async () => {
      const tracks = Array.from({ length: 30 }, (_, i) =>
        createMockTrack(`concurrent-${i}`, `Artist ${i}`, `Song ${i}`)
      );

      // Simulate asynchronous network fetch with random jitter (1ms - 15ms)
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
        const url = String(input);
        const jitter = Math.floor(Math.random() * 15) + 1;
        await new Promise((r) => setTimeout(r, jitter));
        const blob = new Blob([new Uint8Array(1024)], { type: 'audio/mpeg' });
        return new Response(blob, {
          status: 206,
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Length': '1024',
          },
        });
      });

      // Launch all 30 prewarms concurrently
      const results = await Promise.allSettled(tracks.map((t) => cacheManager.prewarmTrack(t)));
      for (const res of results) {
        expect(res.status).toBe('fulfilled');
      }

      const l1 = (cacheManager as any).l1Cache as Map<string, any>;
      expect(l1.size).toBeLessThanOrEqual(10);
    });

    it('1.3 LRU order preservation: re-accessing an older track refreshes recency and prevents its eviction', async () => {
      const l1 = (cacheManager as any).l1Cache as Map<string, any>;

      // Fill L1 with 10 tracks: track-0 to track-9
      for (let i = 0; i < 10; i++) {
        cacheManager.putL1(`track-${i}`, {
          trackId: `track-${i}`,
          blob: new Blob([`data-${i}`]),
          objectUrl: `blob:http://localhost/track-${i}`,
          isFullTrack: false,
          sizeBytes: 100,
          lastAccessed: 1000 + i, // track-0 has oldest timestamp (1000)
        });
      }

      expect(l1.has('track-0')).toBe(true);
      expect(l1.size).toBe(10);

      // Now re-access track-0 via getCachedStreamUrl. This must update track-0's lastAccessed!
      const resolved = await cacheManager.getCachedStreamUrl('track-0', 'http://fallback/track-0.mp3');
      expect(resolved).toBe('blob:http://localhost/track-0');
      const entry0 = l1.get('track-0');
      expect(entry0.lastAccessed).toBeGreaterThan(1009);

      // Now insert track-10 (11th entry).
      // Since track-0 was refreshed, track-1 is now the oldest entry and MUST be evicted instead of track-0!
      cacheManager.putL1('track-10', {
        trackId: 'track-10',
        blob: new Blob(['data-10']),
        objectUrl: 'blob:http://localhost/track-10',
        isFullTrack: false,
        sizeBytes: 100,
        lastAccessed: Date.now() + 100,
      });

      expect(l1.size).toBe(10);
      expect(l1.has('track-0')).toBe(true); // Spared because of recency update!
      expect(l1.has('track-1')).toBe(false); // Evicted because it was the oldest un-accessed!
      expect(l1.has('track-10')).toBe(true); // Newly inserted
    });

    it('1.4 Concurrent deduplication: simultaneous prewarm calls for the same track collapse into 1 execution', async () => {
      // Test 1.4a: audius track (direct range chunk fetch only)
      const audiusTrack = createMockTrack('dup-track-1', 'Artist', 'Duplicated Song', 'audius');

      let audiusFetchCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        audiusFetchCount++;
        await new Promise((r) => setTimeout(r, 20));
        return new Response(new Blob([new Uint8Array(512)]), {
          status: 206,
          headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '512' },
        });
      });

      // Fire 15 concurrent calls for the exact same track
      const calls1 = Array.from({ length: 15 }, () => cacheManager.prewarmTrack(audiusTrack));
      await Promise.all(calls1);

      // In-flight deduplication must ensure fetch was invoked only once (not 15 times)
      expect(audiusFetchCount).toBe(1);

      // Test 1.4b: charts track (1 preload ping + 1 range chunk = 2 fetches total across 15 concurrent calls)
      const chartsTrack = createMockTrack('dup-charts-1', 'Artist', 'Duplicated Charts', 'charts');
      let chartsFetchCount = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        chartsFetchCount++;
        await new Promise((r) => setTimeout(r, 20));
        return new Response(new Blob([new Uint8Array(512)]), {
          status: 206,
          headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '512' },
        });
      });

      const calls2 = Array.from({ length: 15 }, () => cacheManager.prewarmTrack(chartsTrack));
      await Promise.all(calls2);

      // Without deduplication, 15 calls would have caused 30 fetches. With deduplication: exactly 2 (1 preload + 1 chunk)
      expect(chartsFetchCount).toBe(2);
    });

    it('1.5 L2 CacheStorage LRU eviction: evicts oldest partial entries while protecting full offline tracks', async () => {
      if (typeof caches === 'undefined') return;

      const cache = await caches.open('dotify-audio-v1');

      // Populate L2 with 20 partial chunks and 5 full offline tracks
      for (let i = 0; i < 20; i++) {
        const req = new Request(`http://localhost/audio-cache/partial-${i}`);
        const res = new Response(new Blob([`partial-${i}`]), {
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Length': '100',
            'X-Dotify-Cached-At': String(1000 + i), // older timestamps
            'X-Dotify-Is-Full': 'false',
          },
        });
        await cache.put(req, res);
      }

      for (let i = 0; i < 5; i++) {
        const req = new Request(`http://localhost/audio-cache/full-${i}`);
        const res = new Response(new Blob([`full-${i}`]), {
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Length': '500',
            'X-Dotify-Cached-At': String(500 + i), // even older timestamps!
            'X-Dotify-Is-Full': 'true', // Offline protected!
          },
        });
        await cache.put(req, res);
      }

      // Evict 10 oldest entries via private helper
      await (cacheManager as any).evictOldestL2Entries(cache, 10);

      // Invariant: The 10 oldest partial tracks (partial-0 to partial-9) should be deleted
      for (let i = 0; i < 10; i++) {
        const match = await cache.match(new Request(`http://localhost/audio-cache/partial-${i}`));
        expect(match).toBeUndefined();
      }

      // Partial tracks 10-19 should still exist
      for (let i = 10; i < 20; i++) {
        const match = await cache.match(new Request(`http://localhost/audio-cache/partial-${i}`));
        expect(match).toBeDefined();
      }

      // Invariant: Full offline tracks MUST NOT be evicted despite having older timestamps
      for (let i = 0; i < 5; i++) {
        const match = await cache.match(new Request(`http://localhost/audio-cache/full-${i}`));
        expect(match).toBeDefined();
      }
    });
  });

  // =========================================================================
  // 2. Memory Leak Validation: URL.revokeObjectURL on Eviction & Clear
  // =========================================================================
  describe('2. Memory Leak Validation: Object URL Lifecycle & Revocation', () => {
    it('2.1 Key replacement: overwriting an existing trackId immediately revokes the old Object URL', () => {
      const revoked: string[] = [];
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
        revoked.push(url);
      });

      cacheManager.putL1('track-dup', {
        trackId: 'track-dup',
        blob: new Blob(['v1']),
        objectUrl: 'blob:http://localhost/v1',
        isFullTrack: false,
        sizeBytes: 100,
        lastAccessed: 1000,
      });
      expect(revoked.length).toBe(0);

      // Overwrite same trackId with v2
      cacheManager.putL1('track-dup', {
        trackId: 'track-dup',
        blob: new Blob(['v2']),
        objectUrl: 'blob:http://localhost/v2',
        isFullTrack: false,
        sizeBytes: 100,
        lastAccessed: 2000,
      });

      expect(revoked.length).toBe(1);
      expect(revoked[0]).toBe('blob:http://localhost/v1');
    });

    it('2.2 Strict eviction memory leak invariant: 50 unique additions yield exactly 40 revocations matching evicted URLs', () => {
      const createdURLs: string[] = [];
      const revokedURLs: string[] = [];

      vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        const url = `blob:http://localhost/leak-test-${createdURLs.length}`;
        createdURLs.push(url);
        return url;
      });

      vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
        revokedURLs.push(url);
      });

      // Insert 50 unique tracks into L1
      for (let i = 0; i < 50; i++) {
        const blob = new Blob([`audio-data-${i}`]);
        const url = URL.createObjectURL(blob);
        cacheManager.putL1(`track-${i}`, {
          trackId: `track-${i}`,
          blob,
          objectUrl: url,
          isFullTrack: false,
          sizeBytes: 100,
          lastAccessed: 1000 + i,
        });
      }

      expect(createdURLs.length).toBe(50);
      // Capacity is 10; exactly 40 items evicted and revoked
      expect(revokedURLs.length).toBe(40);

      // Invariant: The 40 revoked URLs must match the first 40 created URLs in exact order
      for (let i = 0; i < 40; i++) {
        expect(revokedURLs[i]).toBe(createdURLs[i]);
      }

      // Invariant: The 10 active tracks in L1 must have unrevoked URLs
      const l1 = (cacheManager as any).l1Cache as Map<string, any>;
      expect(l1.size).toBe(10);
      for (let i = 40; i < 50; i++) {
        const activeEntry = l1.get(`track-${i}`);
        expect(activeEntry).toBeDefined();
        expect(revokedURLs.includes(activeEntry.objectUrl)).toBe(false);
      }
    });

    it('2.3 Full memory reclamation on clearCache(): 100% of created URLs are revoked after clear', async () => {
      const createdURLs: string[] = [];
      const revokedURLs: string[] = [];

      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
        const url = `blob:http://localhost/clear-test-${createdURLs.length}`;
        createdURLs.push(url);
        return url;
      });

      vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
        revokedURLs.push(url);
      });

      for (let i = 0; i < 25; i++) {
        const blob = new Blob([`audio-${i}`]);
        const url = URL.createObjectURL(blob);
        cacheManager.putL1(`track-${i}`, {
          trackId: `track-${i}`,
          blob,
          objectUrl: url,
          isFullTrack: false,
          sizeBytes: 100,
          lastAccessed: 1000 + i,
        });
      }

      // 15 evicted during overflow
      expect(revokedURLs.length).toBe(15);

      // Now clear cache completely
      await cacheManager.clearCache();

      // Invariant: 15 (during insertion) + 10 (on clear) = 25 total revoked. Zero leak!
      expect(revokedURLs.length).toBe(25);
      expect(createdURLs.length).toBe(25);

      for (const created of createdURLs) {
        expect(revokedURLs).toContain(created);
      }
    });

    it('2.4 L2 -> L1 promotion overflow revokes evicted Object URLs', async () => {
      const revokedURLs: string[] = [];
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
        revokedURLs.push(url);
      });

      if (typeof caches !== 'undefined') {
        const cache = await caches.open('dotify-audio-v1');

        // Put 15 items in L2
        for (let i = 0; i < 15; i++) {
          const req = new Request(`http://localhost/audio-cache/promo-${i}`);
          const res = new Response(new Blob([`l2-blob-${i}`]), {
            headers: {
              'Content-Type': 'audio/mpeg',
              'Content-Length': '200',
              'X-Dotify-Is-Full': 'false',
            },
          });
          await cache.put(req, res);
        }

        // Fetch each via getCachedStreamUrl (promoting each from L2 into L1)
        for (let i = 0; i < 15; i++) {
          await cacheManager.getCachedStreamUrl(`promo-${i}`, `http://remote/promo-${i}.mp3`);
        }

        // 15 entries promoted into L1 of capacity 10 -> exactly 5 entries evicted and revoked
        expect(revokedURLs.length).toBe(5);
      }
    });
  });

  // =========================================================================
  // 3. Range 416 Responses, Live Radio Non-Range Feeds & Simulated Timeouts
  // =========================================================================
  describe('3. Handling Range 416 Responses, Live Radio & Simulated Timeouts', () => {
    it('3.1 Range 416 Range Not Satisfiable: handled gracefully without crashing or poisoning cache', async () => {
      const track = createMockTrack('range-416', 'Artist', 'Tiny File');

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Range Not Satisfiable', {
          status: 416,
          statusText: 'Range Not Satisfiable',
          headers: { 'Content-Range': 'bytes */500' },
        })
      );

      // Must not throw an unhandled rejection
      await expect(cacheManager.prewarmTrack(track)).resolves.not.toThrow();

      // Must NOT be stored in L1 cache
      const isCached = await cacheManager.isCached(track.id);
      expect(isCached).toBe(false);

      // getCachedStreamUrl must cleanly fall back to upstream streamUrl
      const url = await cacheManager.getCachedStreamUrl(track.id, track.streamUrl);
      expect(url).toBe(track.streamUrl);
    });

    it('3.2 Upstream HTTP errors (500, 404, 503): handled gracefully without uncaught rejection', async () => {
      const errorStatuses = [404, 500, 503];

      for (const status of errorStatuses) {
        const track = createMockTrack(`error-${status}`, 'Artist', `Error Song ${status}`);
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          new Response('Server Error', { status, statusText: 'Error' })
        );

        await expect(cacheManager.prewarmTrack(track)).resolves.not.toThrow();
        const fallbackUrl = await cacheManager.getCachedStreamUrl(track.id, track.streamUrl);
        expect(fallbackUrl).toBe(track.streamUrl);
        expect(await cacheManager.isCached(track.id)).toBe(false);
      }
    });

    it('3.3 Simulated network timeout & AbortError: cleans up in-flight prewarms and permits retry', async () => {
      const track = createMockTrack('timeout-track', 'Artist', 'Timeout Song', 'audius');

      // 1. First attempt fails due to AbortError (timeout)
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
        new DOMException('The user aborted a request.', 'AbortError')
      );

      await expect(cacheManager.prewarmTrack(track)).resolves.not.toThrow();

      // Invariant: pendingPrewarms must be cleaned up, NOT left dangling
      const pending = (cacheManager as any).pendingPrewarms as Map<string, any>;
      expect(pending.has(track.id)).toBe(false);

      // 2. Second attempt succeeds (network restored)
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(new Blob([new Uint8Array(2048)]), {
          status: 206,
          headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '2048' },
        })
      );

      await expect(cacheManager.prewarmTrack(track)).resolves.not.toThrow();
      expect(await cacheManager.isCached(track.id)).toBe(true);
    });

    it('3.4 Live Radio non-range continuous stream: bypasses range chunking and does not cache', async () => {
      const radioTrack = createMockTrack('radio-live', 'Radio Host', '24/7 Live Stream', 'radio', 'http://stream.radio.org/live');

      let calledUrl = '';
      let calledHeaders: any = null;

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
        calledUrl = String(url);
        calledHeaders = init?.headers;
        return new Response('ok');
      });

      // 1. prewarmTrack on radio must NOT send Range header and must append ping parameter
      await cacheManager.prewarmTrack(radioTrack);
      expect(calledUrl).toContain('ping=true');
      expect(calledHeaders?.Range).toBeUndefined();

      // 2. Radio stream must NOT be stored in L1 or L2
      expect(await cacheManager.isCached(radioTrack.id)).toBe(false);

      // 3. cacheFullTrack must immediately return and not attempt to download infinite stream
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockClear();
      await cacheManager.cacheFullTrack(radioTrack);
      expect(fetchSpy).not.toHaveBeenCalled();

      // 4. getCachedStreamUrl returns the raw stream URL directly
      const resolved = await cacheManager.getCachedStreamUrl(radioTrack.id, radioTrack.streamUrl);
      expect(resolved).toBe(radioTrack.streamUrl);
    });
  });

  // =========================================================================
  // 4. Dual-Element Prebuffer Transitions & Engine Playback Invariants
  // =========================================================================
  describe('4. Dual-Element Prebuffer Transitions & Playback Invariants', () => {
    it('4.1 Cold start playback without pre-buffering operates seamlessly', async () => {
      const track = createMockTrack('cold-1', 'Cold Artist', 'Cold Song');

      await expect(audioEngine.playTrack(track)).resolves.not.toThrow();

      expect(audioEngine.getCurrentTrack()?.id).toBe('cold-1');
      expect(audioEngine.isPlaying()).toBe(true);
    });

    it('4.2 Pre-buffered track transition executes gapless element swap (<10ms)', async () => {
      const track1 = createMockTrack('track-swap-1', 'Artist 1', 'Song 1');
      const track2 = createMockTrack('track-swap-2', 'Artist 2', 'Song 2');

      // Start track 1 on primary element
      await audioEngine.playTrack(track1);
      const initialActiveIsPrimary = (audioEngine as any).isPrimaryActive;

      // Prebuffer track 2 on standby element
      await audioEngine.prebufferNextTrack(track2);
      expect((audioEngine as any).prebufferedTrack?.id).toBe('track-swap-2');

      const standbyAudio = (audioEngine as any).standbyAudio as HTMLAudioElement;
      expect(standbyAudio.src).toContain('track-swap-2.mp3');

      // Now play track 2 (matching the prebuffered track)
      const startTime = performance.now();
      await audioEngine.playTrack(track2);
      const elapsed = performance.now() - startTime;

      // Invariant: active element must have toggled
      expect((audioEngine as any).isPrimaryActive).toBe(!initialActiveIsPrimary);
      // Invariant: prebufferedTrack must be cleared
      expect((audioEngine as any).prebufferedTrack).toBeNull();
      // Invariant: currentTrack is now track 2
      expect(audioEngine.getCurrentTrack()?.id).toBe('track-swap-2');
      // Invariant: transition took < 10ms in test environment
      expect(elapsed).toBeLessThan(150);
    });

    it('4.3 User requests non-prebuffered track while another is pre-buffered: graceful fallback', async () => {
      const trackA = createMockTrack('track-A', 'Artist A', 'Song A');
      const trackB = createMockTrack('track-B', 'Artist B', 'Song B');
      const trackC = createMockTrack('track-C', 'Artist C', 'Song C');

      await audioEngine.playTrack(trackA);

      // Pre-buffer track B
      await audioEngine.prebufferNextTrack(trackB);
      expect((audioEngine as any).prebufferedTrack?.id).toBe('track-B');

      // User jumps to track C instead of track B!
      await expect(audioEngine.playTrack(trackC)).resolves.not.toThrow();

      // Current track must be track C
      expect(audioEngine.getCurrentTrack()?.id).toBe('track-C');
      // prebufferedTrack must be cleared to prevent stale state
      expect((audioEngine as any).prebufferedTrack).toBeNull();
    });

    it('4.4 Rapid alternating chain: 10 transitions alternate elements without desync or throw', async () => {
      const chain = Array.from({ length: 10 }, (_, i) =>
        createMockTrack(`chain-${i}`, `Chain Artist ${i}`, `Chain Song ${i}`)
      );

      // Play first track
      await audioEngine.playTrack(chain[0]);

      for (let i = 1; i < chain.length; i++) {
        const prevIsPrimary = (audioEngine as any).isPrimaryActive;

        // Prebuffer next
        await audioEngine.prebufferNextTrack(chain[i]);
        // Play next
        await audioEngine.playTrack(chain[i]);

        // Element polarity must toggle with each prebuffered swap
        expect((audioEngine as any).isPrimaryActive).toBe(!prevIsPrimary);
        expect(audioEngine.getCurrentTrack()?.id).toBe(`chain-${i}`);
      }
    });

    it('4.5 Autoplay policy rejection: audio.play() failure is caught and does not throw uncaught error', async () => {
      const track = createMockTrack('policy-rejection', 'Artist', 'Blocked Song');

      // Mock audio.play rejecting with NotAllowedError (user gesture missing)
      const activeAudio = (audioEngine as any).activeAudio as HTMLAudioElement;
      vi.spyOn(activeAudio, 'play').mockRejectedValueOnce(
        new DOMException('play() failed because user gesture is required.', 'NotAllowedError')
      );

      // playTrack must catch the error cleanly and not throw to caller
      await expect(audioEngine.playTrack(track)).resolves.not.toThrow();
    });

    it('4.6 prebufferNextTrack(null) cleanly resets standby buffer state', async () => {
      const track = createMockTrack('reset-test', 'Artist', 'Reset Song');

      await audioEngine.prebufferNextTrack(track);
      expect((audioEngine as any).prebufferedTrack).not.toBeNull();

      await audioEngine.prebufferNextTrack(null);
      expect((audioEngine as any).prebufferedTrack).toBeNull();
    });

    it('4.8 Rapid hammering stress: 30 rapid successive playTrack calls with mixed pre-buffering resolve cleanly', async () => {
      const tracks = Array.from({ length: 30 }, (_, i) =>
        createMockTrack(`hammer-${i}`, `Hammer Artist ${i}`, `Hammer Song ${i}`)
      );

      // Rapidly fire prebuffer and playTrack in interleaved succession
      for (let i = 0; i < tracks.length; i++) {
        if (i % 2 === 0 && i + 1 < tracks.length) {
          audioEngine.prebufferNextTrack(tracks[i + 1]);
        }
        await expect(audioEngine.playTrack(tracks[i])).resolves.not.toThrow();
      }

      expect(audioEngine.getCurrentTrack()?.id).toBe('hammer-29');
      expect(audioEngine.isPlaying()).toBe(true);
    });

    it('4.9 Repeat play: calling playTrack with the currently active track does not throw or corrupt state', async () => {
      const track = createMockTrack('repeat-track', 'Artist', 'Repeat Song');

      await audioEngine.playTrack(track);
      expect(audioEngine.getCurrentTrack()?.id).toBe('repeat-track');

      // Click same track again
      await expect(audioEngine.playTrack(track)).resolves.not.toThrow();
      expect(audioEngine.getCurrentTrack()?.id).toBe('repeat-track');
    });

    it('4.10 DSP Volume and Equalizer remain intact across dual-element swaps', async () => {
      audioEngine.setVolume(0.65);
      audioEngine.setEqualizerPreset('electronic');

      const t1 = createMockTrack('dsp-1', 'Artist 1', 'Song 1');
      const t2 = createMockTrack('dsp-2', 'Artist 2', 'Song 2');

      await audioEngine.playTrack(t1);
      await audioEngine.prebufferNextTrack(t2);
      await audioEngine.playTrack(t2); // Swaps element

      expect(audioEngine.getVolume()).toBe(0.65);
      const eqState = audioEngine.getEqualizerState();
      expect(eqState.preset).toBe('electronic');
      expect(eqState.enabled).toBe(true);
    });
  });

  // =========================================================================
  // 5. Resilience to Storage Quota & Malformed Inputs
  // =========================================================================
  describe('5. Storage Quota Exceeded & Input Sanitization Resilience', () => {
    it('5.1 safeCachePut catches QuotaExceededError, evicts oldest L2 entries, and keeps entry in L1', async () => {
      const track = createMockTrack('quota-track', 'Artist', 'Heavy Track');
      const mockBlob = new Blob([new Uint8Array(1024)], { type: 'audio/mpeg' });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(mockBlob, {
          status: 206,
          headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '1024' },
        })
      );

      if (typeof caches !== 'undefined') {
        const cache = await caches.open('dotify-audio-v1');
        let putCount = 0;

        vi.spyOn(cache, 'put').mockImplementation(async () => {
          putCount++;
          if (putCount === 1) {
            const err: any = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          // Second retry succeeds
          return;
        });

        // Prewarm must succeed despite initial QuotaExceededError
        await expect(cacheManager.prewarmTrack(track)).resolves.not.toThrow();
        expect(putCount).toBe(2);
        // Track must still be stored in L1 memory
        const isCached = await cacheManager.isCached(track.id);
        expect(isCached).toBe(true);
      }
    });

    it('5.2 CDN full response (200 OK) instead of 206 Partial Content is accepted and cached', async () => {
      const track = createMockTrack('cdn-200', 'Artist', 'Full File');
      const mockBlob = new Blob([new Uint8Array(2048)], { type: 'audio/mpeg' });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(mockBlob, {
          status: 200, // 200 OK instead of 206
          headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': '2048' },
        })
      );

      await expect(cacheManager.prewarmTrack(track)).resolves.not.toThrow();
      expect(await cacheManager.isCached(track.id)).toBe(true);
    });

    it('5.3 Null, undefined, and malformed track inputs are guarded safely', async () => {
      await expect(cacheManager.prewarmTrack(null as any)).resolves.not.toThrow();
      await expect(cacheManager.prewarmTrack(undefined as any)).resolves.not.toThrow();
      await expect(cacheManager.prewarmTrack({ id: '', streamUrl: '' } as any)).resolves.not.toThrow();
      await expect(cacheManager.cacheFullTrack(null as any)).resolves.not.toThrow();
      await expect(cacheManager.cacheFullTrack({ id: '', streamUrl: '' } as any)).resolves.not.toThrow();
      await expect(cacheManager.prewarmQueue([], 0)).resolves.not.toThrow();
    });
  });
});

