import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AudioCacheManager } from '../../src/audio/audioCache';
import { artistService, extractPrimaryArtist } from '../../src/services/artistService';
import { usePlayerStore } from '../../src/store/playerStore';
import { validateSpotifyUrl, fetchSpotifyPreview, saveSpotifyPlaylistToStore } from '../../src/services/spotifyImporter';
import { Track } from '../../src/types/track';
import { SILENT_WAV_BASE64 } from '../fixtures/mockAudio';

function createMockTrack(id: string, artist: string, title: string, source: any = 'charts'): Track {
  return {
    id,
    source,
    title,
    artist,
    album: 'Test Album',
    duration: 180,
    streamUrl: `http://localhost:3001/stream/${id}.mp3`,
    artworkUrl: 'http://localhost:3001/art.jpg',
    sourceMetadata: {
      format: 'mp3',
      genre: 'Electronic',
    },
  };
}

describe('Milestone 1: Low-Latency Audio Cache Engine', () => {
  let cacheManager: AudioCacheManager;

  beforeEach(() => {
    cacheManager = new AudioCacheManager();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await cacheManager.clearCache();
  });

  it('Tier 1: should store in L1 cache and return cached Object URL', async () => {
    const mockBlob = new Blob(['mock audio data'], { type: 'audio/mpeg' });
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/mock-1');

    cacheManager.putL1('track-1', {
      trackId: 'track-1',
      blob: mockBlob,
      objectUrl: 'blob:http://localhost/mock-1',
      isFullTrack: true,
      sizeBytes: mockBlob.size,
      lastAccessed: Date.now(),
    });

    const resolvedUrl = await cacheManager.getCachedStreamUrl('track-1', 'http://remote/track.mp3');
    expect(resolvedUrl).toBe('blob:http://localhost/mock-1');
  });

  it('Tier 1: should enforce LRU eviction when exceeding 10 entries and revoke object URLs', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    for (let i = 0; i < 12; i++) {
      const blob = new Blob([`audio-${i}`]);
      cacheManager.putL1(`track-${i}`, {
        trackId: `track-${i}`,
        blob,
        objectUrl: `blob:http://localhost/track-${i}`,
        isFullTrack: false,
        sizeBytes: 100,
        lastAccessed: Date.now() + i, // sequential timestamps
      });
    }

    // Capacity is 10, so oldest entries (track-0 and track-1) must have been evicted and revoked
    expect(revokeSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).toHaveBeenCalledWith('blob:http://localhost/track-0');
    expect(revokeSpy).toHaveBeenCalledWith('blob:http://localhost/track-1');
  });

  it('Tier 2: should fetch initial 256KB chunk with Range header and cache in L2', async () => {
    const mockTrack = createMockTrack('prewarm-1', 'Daft Punk', 'One More Time', 'audius');
    const mockBlob = new Blob([new Uint8Array(262144)], { type: 'audio/mpeg' });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(mockBlob, {
        status: 206,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Length': '262144',
          'Content-Range': 'bytes 0-262143/1000000',
        },
      })
    );

    await cacheManager.prewarmTrack(mockTrack);

    expect(fetchSpy).toHaveBeenCalled();
    const fetchCall = fetchSpy.mock.calls[0];
    expect(fetchCall[0]).toBe(mockTrack.streamUrl);
    const headers = (fetchCall[1] as any)?.headers;
    expect(headers?.Range).toBe('bytes=0-262143');

    const stats = await cacheManager.getCacheStats();
    expect(stats.entryCount).toBeGreaterThanOrEqual(1);
  });

  it('Live Radio: should bypass byte-range requests for continuous radio feeds', async () => {
    const radioTrack = createMockTrack('radio-1', 'Radio Station', 'Chill Live', 'radio');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

    await cacheManager.prewarmTrack(radioTrack);

    expect(fetchSpy).toHaveBeenCalled();
    const fetchCall = fetchSpy.mock.calls[0];
    // Ping url should include ping query param
    expect(String(fetchCall[0])).toContain('ping=true');
    const headers = (fetchCall[1] as any)?.headers;
    expect(headers?.Range).toBeUndefined();
  });

  it('prewarmQueue: should prewarm upcoming tracks in queue', async () => {
    const tracks = [
      createMockTrack('t-0', 'Artist 0', 'Song 0'),
      createMockTrack('t-1', 'Artist 1', 'Song 1'),
      createMockTrack('t-2', 'Artist 2', 'Song 2'),
      createMockTrack('t-3', 'Artist 3', 'Song 3'),
    ];

    const prewarmSpy = vi.spyOn(cacheManager, 'prewarmTrack').mockResolvedValue();

    await cacheManager.prewarmQueue(tracks, 0, 2);

    expect(prewarmSpy).toHaveBeenCalledTimes(2);
    expect(prewarmSpy).toHaveBeenCalledWith(tracks[1]);
    expect(prewarmSpy).toHaveBeenCalledWith(tracks[2]);
  });

  it('requireFullTrack: should bypass partial 256KB prewarm blobs so HTMLAudioElement does not truncate at ~30s', async () => {
    const mockTrack = createMockTrack('partial-1', 'Daft Punk', 'Digital Love', 'audius');
    const partialBlob = new Blob([new Uint8Array(262144)], { type: 'audio/mpeg' });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(partialBlob, {
        status: 206,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Length': '262144',
          'Content-Range': 'bytes 0-262143/4000000',
        },
      })
    );

    await cacheManager.prewarmTrack(mockTrack);

    // When requireFullTrack is true (used by AudioEngine), partial 256KB blob must be bypassed
    const fullPlaybackUrl = await cacheManager.getCachedStreamUrl(
      mockTrack.id,
      mockTrack.streamUrl,
      true
    );
    expect(fullPlaybackUrl).toBe(mockTrack.streamUrl);

    // Once full track is cached, requireFullTrack=true returns the cached Object URL
    const fullBlob = new Blob([new Uint8Array(512)], { type: 'audio/mpeg' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(fullBlob, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Length': '512',
        },
      })
    );
    await cacheManager.cacheFullTrack(mockTrack);
    const cachedFullUrl = await cacheManager.getCachedStreamUrl(
      mockTrack.id,
      mockTrack.streamUrl,
      true
    );
    expect(cachedFullUrl).toContain('blob:');
  });

  it('legacy full-track cache purge: should evict unverified v1 X-Dotify-Is-Full entries so 30s preview clips are never served', async () => {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open('dotify-audio-v1');
    const legacyTrackId = 'charts:everlong-legacy';
    const legacyReq = new Request(`http://localhost/audio-cache/${encodeURIComponent(legacyTrackId)}`);
    const legacyPreviewBlob = new Blob([new Uint8Array(4096)], { type: 'audio/mpeg' });

    // Simulate a legacy v1 entry (X-Dotify-Is-Full: true, but missing X-Dotify-Full-Version: 2)
    await cache.put(
      legacyReq,
      new Response(legacyPreviewBlob, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Length': '4096',
          'X-Dotify-Is-Full': 'true',
        },
      })
    );

    const resolvedUrl = await cacheManager.getCachedStreamUrl(
      legacyTrackId,
      'http://127.0.0.1:3001/api/stream/track?artist=Foo%20Fighters&title=Everlong',
      true
    );
    expect(resolvedUrl).toBe('http://127.0.0.1:3001/api/stream/track?artist=Foo%20Fighters&title=Everlong');
    expect(await cache.match(legacyReq)).toBeUndefined();
  });
});

describe('Milestone 1: Artist Profile & 4-Tier Fallback Service', () => {
  it('extractPrimaryArtist: should extract primary artist from collaboration strings', () => {
    expect(extractPrimaryArtist('Calvin Harris feat. Ellie Goulding')).toBe('Calvin Harris');
    expect(extractPrimaryArtist('David Guetta ft. Sia')).toBe('David Guetta');
    expect(extractPrimaryArtist('Queen, David Bowie')).toBe('Queen');
    expect(extractPrimaryArtist('Daft Punk & Pharrell Williams')).toBe('Daft Punk');
    expect(extractPrimaryArtist('Skrillex vs. Boys Noize')).toBe('Skrillex');
    expect(extractPrimaryArtist('Dua Lipa')).toBe('Dua Lipa');
    expect(extractPrimaryArtist('')).toBe('');
  });

  it('Tier 1: should return Deezer profile when search and details succeed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/charts/search/artist')) {
        return new Response(JSON.stringify({ data: [{ id: 42, name: 'Daft Punk' }] }));
      }
      if (urlStr.includes('/api/charts/artist/42/top')) {
        return new Response(JSON.stringify({
          data: [
            {
              id: 101,
              title: 'One More Time',
              artist: { name: 'Daft Punk' },
              album: { title: 'Discovery' },
              duration: 320,
            },
          ],
        }));
      }
      if (urlStr.includes('/api/charts/artist/42/albums')) {
        return new Response(JSON.stringify({
          data: [{ id: 501, title: 'Discovery', release_date: '2001-03-12', nb_tracks: 14 }],
        }));
      }
      if (urlStr.includes('/api/charts/artist/42/related')) {
        return new Response(JSON.stringify({
          data: [{ id: 99, name: 'Justice', nb_fan: 500000 }],
        }));
      }
      if (urlStr.includes('/api/charts/artist/42')) {
        return new Response(JSON.stringify({ id: 42, name: 'Daft Punk', nb_fan: 3000000 }));
      }
      return new Response(JSON.stringify({ data: [] }));
    });

    const profile = await artistService.getArtistProfile('Daft Punk');
    expect(profile.name).toBe('Daft Punk');
    expect(profile.isSynthetic).toBe(false);
    expect(profile.topTracks.length).toBe(1);
    expect(profile.topTracks[0].title).toBe('One More Time');
    expect(profile.albums.length).toBe(1);
    expect(profile.albums[0].title).toBe('Discovery');
    expect(profile.relatedArtists.length).toBe(1);
    expect(profile.relatedArtists[0].name).toBe('Justice');
  });

  it('Tier 4: should synthesize profile from local storage when APIs are unavailable', async () => {
    // Force API failures
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network offline'));

    const syntheticProfile = artistService.generateSyntheticProfile('The Beatles');
    expect(syntheticProfile.name).toBe('The Beatles');
    expect(syntheticProfile.isSynthetic).toBe(true);
    expect(syntheticProfile.id).toContain('synthetic:');
    expect(Array.isArray(syntheticProfile.topTracks)).toBe(true);
    expect(Array.isArray(syntheticProfile.albums)).toBe(true);
  });
});

describe('Milestone 1: Artist Radio Algorithmic Interleaving', () => {
  it('interleaveWithAntiClumping: should enforce anti-clumping (never >2 tracks by same artist)', () => {
    const anchor = [
      createMockTrack('a1', 'Anchor Artist', 'A Song 1'),
      createMockTrack('a2', 'Anchor Artist', 'A Song 2'),
      createMockTrack('a3', 'Anchor Artist', 'A Song 3'),
      createMockTrack('a4', 'Anchor Artist', 'A Song 4'),
    ];

    const related = [
      createMockTrack('r1', 'Related Artist 1', 'R Song 1'),
      createMockTrack('r2', 'Related Artist 1', 'R Song 2'),
      createMockTrack('r3', 'Related Artist 2', 'R Song 3'),
    ];

    const discovery = [
      createMockTrack('d1', 'Discovery Artist', 'D Song 1'),
      createMockTrack('d2', 'Discovery Artist 2', 'D Song 2'),
    ];

    const radioQueue = artistService.interleaveWithAntiClumping(anchor, related, discovery, 9);
    expect(radioQueue.length).toBeGreaterThan(0);

    // Verify anti-clumping constraint: no 3 consecutive tracks by same artist
    for (let i = 0; i < radioQueue.length - 2; i++) {
      const a1 = radioQueue[i].artist;
      const a2 = radioQueue[i + 1].artist;
      const a3 = radioQueue[i + 2].artist;
      const allThreeSame = a1 === a2 && a2 === a3;
      expect(allThreeSame).toBe(false);
    }
  });
});

describe('Milestone 1: Enhanced Queue & Custom Playlist Management', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      queue: [],
      currentTrack: null,
      playlists: [],
      isPlaying: false,
    });
  });

  it('playNext: should insert immediately after current track without dropping audio', () => {
    const t0 = createMockTrack('t0', 'Artist 0', 'Song 0');
    const t1 = createMockTrack('t1', 'Artist 1', 'Song 1');
    const t2 = createMockTrack('t2', 'Artist 2', 'Song 2');
    const playNextTrack = createMockTrack('t-next', 'Next Artist', 'Next Song');

    usePlayerStore.setState({
      queue: [t0, t1, t2],
      currentTrack: t0,
      isPlaying: true,
    });

    usePlayerStore.getState().playNext(playNextTrack);

    const updatedQueue = usePlayerStore.getState().queue;
    expect(updatedQueue.length).toBe(4);
    expect(updatedQueue[0].id).toBe('t0');
    expect(updatedQueue[1].id).toBe('t-next'); // Priority slot
    expect(updatedQueue[2].id).toBe('t1');
    expect(updatedQueue[3].id).toBe('t2');
    // Current track and playback state remained unchanged
    expect(usePlayerStore.getState().currentTrack?.id).toBe('t0');
  });

  it('addToEnd: should append tracks to the end of queue', () => {
    const t0 = createMockTrack('t0', 'Artist 0', 'Song 0');
    const t1 = createMockTrack('t1', 'Artist 1', 'Song 1');
    const tEnd = createMockTrack('t-end', 'End Artist', 'End Song');

    usePlayerStore.setState({
      queue: [t0, t1],
      currentTrack: t0,
    });

    usePlayerStore.getState().addToEnd(tEnd);

    const updatedQueue = usePlayerStore.getState().queue;
    expect(updatedQueue.length).toBe(3);
    expect(updatedQueue[2].id).toBe('t-end');
  });

  it('reorderQueue: should move items within queue without interrupting audio', () => {
    const t0 = createMockTrack('t0', 'Artist 0', 'Song 0');
    const t1 = createMockTrack('t1', 'Artist 1', 'Song 1');
    const t2 = createMockTrack('t2', 'Artist 2', 'Song 2');

    usePlayerStore.setState({
      queue: [t0, t1, t2],
      currentTrack: t0,
    });

    // Move index 2 (t2) to index 1
    usePlayerStore.getState().reorderQueue(2, 1);

    const updatedQueue = usePlayerStore.getState().queue;
    expect(updatedQueue[0].id).toBe('t0');
    expect(updatedQueue[1].id).toBe('t2');
    expect(updatedQueue[2].id).toBe('t1');
  });

  it('clearQueue: should preserve active playing track while clearing upcoming items', () => {
    const t0 = createMockTrack('t0', 'Artist 0', 'Song 0');
    const t1 = createMockTrack('t1', 'Artist 1', 'Song 1');

    usePlayerStore.setState({
      queue: [t0, t1],
      currentTrack: t0,
      isPlaying: true,
    });

    usePlayerStore.getState().clearQueue();

    const updatedQueue = usePlayerStore.getState().queue;
    expect(updatedQueue.length).toBe(1);
    expect(updatedQueue[0].id).toBe('t0');
  });

  it('Custom Playlists CRUD: create, rename, reorder tracks, delete', () => {
    const store = usePlayerStore.getState();

    // 1. Create
    const plId = store.createPlaylist('Synthwave Favorites', 'Great 80s vibes');
    expect(usePlayerStore.getState().playlists.length).toBe(1);
    expect(usePlayerStore.getState().playlists[0].name).toBe('Synthwave Favorites');

    // 2. Add tracks
    const t1 = createMockTrack('track-a', 'Artist A', 'Song A');
    const t2 = createMockTrack('track-b', 'Artist B', 'Song B');
    store.addTrackToPlaylist(plId, t1);
    store.addTrackToPlaylist(plId, t2);
    expect(usePlayerStore.getState().playlists[0].tracks.length).toBe(2);

    // 3. Reorder tracks in playlist
    store.reorderPlaylistTracks(plId, 1, 0);
    expect(usePlayerStore.getState().playlists[0].tracks[0].id).toBe('track-b');
    expect(usePlayerStore.getState().playlists[0].tracks[1].id).toBe('track-a');

    // 4. Rename
    store.renamePlaylist(plId, 'Cyberpunk Gems');
    expect(usePlayerStore.getState().playlists[0].name).toBe('Cyberpunk Gems');

    // 5. Delete
    store.deletePlaylist(plId);
    expect(usePlayerStore.getState().playlists.length).toBe(0);
  });
});

describe('Milestone 1: Zero-Auth Spotify Importer', () => {
  it('validateSpotifyUrl: should parse web URLs and URIs correctly', () => {
    const webRes = validateSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=123');
    expect(webRes.isValid).toBe(true);
    expect(webRes.type).toBe('playlist');
    expect(webRes.id).toBe('37i9dQZF1DXcBWIGoYBM5M');

    const uriRes = validateSpotifyUrl('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
    expect(uriRes.isValid).toBe(true);
    expect(uriRes.type).toBe('playlist');
    expect(uriRes.id).toBe('37i9dQZF1DXcBWIGoYBM5M');

    const albumRes = validateSpotifyUrl('https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa');
    expect(albumRes.isValid).toBe(true);
    expect(albumRes.type).toBe('album');

    const invalidRes = validateSpotifyUrl('https://google.com/search');
    expect(invalidRes.isValid).toBe(false);
  });

  it('fetchSpotifyPreview & saveSpotifyPlaylistToStore: resolves embed response and saves to store', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'playlist',
          title: "Today's Top Hits",
          description: 'The hottest tracks right now.',
          artworkUrl: 'https://i.scdn.co/image/ab67706f00000002',
          trackCount: 2,
          tracks: [
            createMockTrack('sp-1', 'Sabrina Carpenter', 'Espresso'),
            createMockTrack('sp-2', 'Billie Eilish', 'BIRDS OF A FEATHER'),
          ],
        }),
        { status: 200 }
      )
    );

    const preview = await fetchSpotifyPreview('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    expect(preview.playlistTitle).toBe("Today's Top Hits");
    expect(preview.totalTracks).toBe(2);
    expect(preview.resolvedTracks.length).toBe(2);

    const savedId = saveSpotifyPlaylistToStore(preview);
    expect(savedId).toBeDefined();

    const playlists = usePlayerStore.getState().playlists;
    const imported = playlists.find((p) => p.id === savedId);
    expect(imported).toBeDefined();
    expect(imported?.name).toBe("Today's Top Hits");
    expect(imported?.tracks.length).toBe(2);
  });
});
