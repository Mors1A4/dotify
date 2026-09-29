import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePlayerStore } from '../../src/store/playerStore';
import { artistService } from '../../src/services/artistService';
import { validateSpotifyUrl } from '../../src/services/spotifyImporter';
import { audioEngine } from '../../src/audio/audioEngine';
import { Track } from '../../src/types/track';
import { ArtistProfile } from '../../src/types/artist';

function createMockTrack(id: string, artist: string, title: string, duration = 180): Track {
  return {
    id,
    source: 'charts',
    title,
    artist,
    album: 'Adversarial Test Album',
    duration,
    streamUrl: `http://localhost:3001/stream/${id}.mp3`,
    artworkUrl: `http://localhost:3001/art/${id}.jpg`,
    sourceMetadata: {
      format: 'mp3',
      genre: 'Electronic',
    },
  };
}

describe('Adversarial Challenge: Milestone 1 Robustness & Stress Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    usePlayerStore.setState({
      queue: [],
      currentTrack: null,
      history: [],
      isPlaying: false,
      isBuffering: false,
      repeatMode: 'off',
      shuffle: false,
    });
  });

  // =========================================================================
  // 1. QUEUE BOUNDARY MANIPULATIONS
  // =========================================================================
  describe('1. Queue Boundary Manipulations (reorderQueue)', () => {
    it('handles negative indices gracefully without modifying queue or throwing', () => {
      const t0 = createMockTrack('t0', 'Artist 0', 'Song 0');
      const t1 = createMockTrack('t1', 'Artist 1', 'Song 1');
      const t2 = createMockTrack('t2', 'Artist 2', 'Song 2');

      usePlayerStore.setState({ queue: [t0, t1, t2] });

      // Negative fromIndex
      expect(() => usePlayerStore.getState().reorderQueue(-1, 1)).not.toThrow();
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['t0', 't1', 't2']);

      // Negative toIndex
      expect(() => usePlayerStore.getState().reorderQueue(1, -1)).not.toThrow();
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['t0', 't1', 't2']);

      // Both negative
      expect(() => usePlayerStore.getState().reorderQueue(-5, -2)).not.toThrow();
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['t0', 't1', 't2']);
    });

    it('handles out-of-bounds indices gracefully without modifying queue or throwing', () => {
      const t0 = createMockTrack('t0', 'Artist 0', 'Song 0');
      const t1 = createMockTrack('t1', 'Artist 1', 'Song 1');
      const t2 = createMockTrack('t2', 'Artist 2', 'Song 2');

      usePlayerStore.setState({ queue: [t0, t1, t2] });

      // fromIndex >= length
      expect(() => usePlayerStore.getState().reorderQueue(3, 1)).not.toThrow();
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['t0', 't1', 't2']);

      expect(() => usePlayerStore.getState().reorderQueue(100, 0)).not.toThrow();
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['t0', 't1', 't2']);

      // toIndex >= length
      expect(() => usePlayerStore.getState().reorderQueue(0, 3)).not.toThrow();
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['t0', 't1', 't2']);

      expect(() => usePlayerStore.getState().reorderQueue(0, 999)).not.toThrow();
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['t0', 't1', 't2']);

      // Both out-of-bounds
      expect(() => usePlayerStore.getState().reorderQueue(50, 60)).not.toThrow();
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['t0', 't1', 't2']);
    });

    it('handles empty queue and single-element queue reordering without crashing', () => {
      // Empty queue
      usePlayerStore.setState({ queue: [] });
      expect(() => usePlayerStore.getState().reorderQueue(0, 0)).not.toThrow();
      expect(() => usePlayerStore.getState().reorderQueue(0, 1)).not.toThrow();
      expect(() => usePlayerStore.getState().reorderQueue(-1, 0)).not.toThrow();
      expect(usePlayerStore.getState().queue).toEqual([]);

      // Single item queue
      const t0 = createMockTrack('t0', 'Artist 0', 'Song 0');
      usePlayerStore.setState({ queue: [t0] });
      expect(() => usePlayerStore.getState().reorderQueue(0, 0)).not.toThrow();
      expect(() => usePlayerStore.getState().reorderQueue(0, 1)).not.toThrow();
      expect(usePlayerStore.getState().queue).toEqual([t0]);
    });

    it('correctly swaps head and tail in multi-item queue', () => {
      const tracks = [
        createMockTrack('t0', 'A0', 'S0'),
        createMockTrack('t1', 'A1', 'S1'),
        createMockTrack('t2', 'A2', 'S2'),
        createMockTrack('t3', 'A3', 'S3'),
        createMockTrack('t4', 'A4', 'S4'),
      ];
      usePlayerStore.setState({ queue: [...tracks] });

      // Move head (0) to tail (4)
      usePlayerStore.getState().reorderQueue(0, 4);
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4', 't0']);

      // Move new tail (4) back to head (0)
      usePlayerStore.getState().reorderQueue(4, 0);
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['t0', 't1', 't2', 't3', 't4']);
    });

    it('preserves active playback and re-primes prebuffering when reordering during active playback', () => {
      const t0 = createMockTrack('t0', 'A0', 'S0');
      const t1 = createMockTrack('t1', 'A1', 'S1');
      const t2 = createMockTrack('t2', 'A2', 'S2');
      const t3 = createMockTrack('t3', 'A3', 'S3');

      const prebufferSpy = vi.spyOn(audioEngine, 'prebufferNextTrack').mockResolvedValue();

      usePlayerStore.setState({
        queue: [t0, t1, t2, t3],
        currentTrack: t0,
        isPlaying: true,
      });

      // Move index 2 (t2) to index 1 (directly after currentTrack t0)
      usePlayerStore.getState().reorderQueue(2, 1);

      const state = usePlayerStore.getState();
      expect(state.queue.map((t) => t.id)).toEqual(['t0', 't2', 't1', 't3']);
      expect(state.currentTrack?.id).toBe('t0');
      expect(state.isPlaying).toBe(true);

      // Pre-buffering must be primed for newly adjacent track (t2)
      expect(prebufferSpy).toHaveBeenCalledWith(t2);
    });

    it('handles moving the currently playing track to tail without crashing or losing playback state', () => {
      const t0 = createMockTrack('t0', 'A0', 'S0');
      const t1 = createMockTrack('t1', 'A1', 'S1');
      const t2 = createMockTrack('t2', 'A2', 'S2');

      const prebufferSpy = vi.spyOn(audioEngine, 'prebufferNextTrack').mockResolvedValue();

      usePlayerStore.setState({
        queue: [t0, t1, t2],
        currentTrack: t0,
        isPlaying: true,
      });

      // Move actively playing track t0 from index 0 to index 2 (tail)
      expect(() => usePlayerStore.getState().reorderQueue(0, 2)).not.toThrow();

      const state = usePlayerStore.getState();
      expect(state.queue.map((t) => t.id)).toEqual(['t1', 't2', 't0']);
      expect(state.currentTrack?.id).toBe('t0');
      expect(state.isPlaying).toBe(true);
      expect(prebufferSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. ARTIST RADIO GOLDEN-RATIO DISPERSION
  // =========================================================================
  describe('2. Artist Radio Golden-Ratio Dispersion', () => {
    it('generates radio for an artist with only 1 top track without crashing', async () => {
      const soloTrack = createMockTrack('solo-1', 'Solo Artist', 'Solo Hit');

      const mockProfile: ArtistProfile = {
        id: 'artist:solo-1',
        name: 'Solo Artist',
        topTracks: [soloTrack],
        albums: [],
        discography: [soloTrack],
        relatedArtists: [],
        genres: ['Pop'],
        isSynthetic: false,
      };

      vi.spyOn(artistService, 'getArtistProfile').mockResolvedValue(mockProfile);

      // Mock Deezer charts discovery tracks
      const discoveryTracks = Array.from({ length: 25 }, (_, i) =>
        createMockTrack(`disc-${i}`, `Discovery Artist ${i % 5}`, `Discovery Song ${i}`)
      );

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/charts/tracks')) {
          return new Response(
            JSON.stringify({
              data: discoveryTracks.map((t, idx) => ({
                id: 1000 + idx,
                title: t.title,
                artist: { name: t.artist },
                album: { title: 'Charts' },
                duration: 180,
              })),
            })
          );
        }
        return new Response(JSON.stringify({ data: [] }));
      });

      const radio = await artistService.generateArtistRadio(
        { id: 'solo-1', name: 'Solo Artist' },
        { length: 20 }
      );

      expect(radio.length).toBeGreaterThan(0);
      expect(radio.some((t) => t.artist === 'Solo Artist')).toBe(true);

      // Verify anti-clumping constraint: <= 2 consecutive tracks by ANY artist
      for (let i = 0; i < radio.length - 2; i++) {
        const a1 = radio[i].artist;
        const a2 = radio[i + 1].artist;
        const a3 = radio[i + 2].artist;
        const streakOfThree = a1 === a2 && a2 === a3;
        expect(streakOfThree).toBe(false);
      }
    });

    it('handles artist with 1 top track when discovery & related APIs fail (zero crash, length 1)', async () => {
      const soloTrack = createMockTrack('solo-1', 'Lone Singer', 'Sole Track');

      const mockProfile: ArtistProfile = {
        id: 'artist:lone-1',
        name: 'Lone Singer',
        topTracks: [soloTrack],
        albums: [],
        discography: [],
        relatedArtists: [],
        genres: ['Indie'],
        isSynthetic: false,
      };

      vi.spyOn(artistService, 'getArtistProfile').mockResolvedValue(mockProfile);

      // Discovery API completely fails
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network offline'));

      const radio = await artistService.generateArtistRadio(
        { id: 'lone-1', name: 'Lone Singer' },
        { length: 20 }
      );

      expect(Array.isArray(radio)).toBe(true);
      expect(radio.length).toBe(1);
      expect(radio[0].artist).toBe('Lone Singer');

      // Constraint verification: <= 2 consecutive tracks holds trivially
      let maxStreak = 0;
      let currentStreak = 0;
      let prevArtist: string | null = null;
      for (const track of radio) {
        if (track.artist === prevArtist) {
          currentStreak++;
        } else {
          currentStreak = 1;
          prevArtist = track.artist;
        }
        if (currentStreak > maxStreak) maxStreak = currentStreak;
      }
      expect(maxStreak).toBeLessThanOrEqual(2);
    });

    it('interleaveWithAntiClumping enforces <=2 consecutive tracks across diverse artist pools', () => {
      const anchor = [createMockTrack('a1', 'Anchor Artist', 'A1')];
      const related = [
        createMockTrack('r1', 'Related A', 'R1'),
        createMockTrack('r2', 'Related A', 'R2'),
        createMockTrack('r3', 'Related B', 'R3'),
        createMockTrack('r4', 'Related B', 'R4'),
      ];
      const discovery = [
        createMockTrack('d1', 'Discovery X', 'D1'),
        createMockTrack('d2', 'Discovery Y', 'D2'),
        createMockTrack('d3', 'Discovery Z', 'D3'),
      ];

      const result = artistService.interleaveWithAntiClumping(anchor, related, discovery, 8);
      expect(result.length).toBe(8);

      // Verify no 3 consecutive tracks by same artist
      for (let i = 0; i < result.length - 2; i++) {
        const threeIdentical =
          result[i].artist === result[i + 1].artist &&
          result[i + 1].artist === result[i + 2].artist;
        expect(threeIdentical).toBe(false);
      }
    });

    it('stress-tests interleaveWithAntiClumping over 200 randomized iterations without crashing', () => {
      for (let run = 0; run < 200; run++) {
        const anchorCount = Math.floor(Math.random() * 5) + 1;
        const relatedCount = Math.floor(Math.random() * 8);
        const discoveryCount = Math.floor(Math.random() * 8);

        const anchor = Array.from({ length: anchorCount }, (_, i) =>
          createMockTrack(`a-${i}`, 'Anchor Main', `Track ${i}`)
        );
        const related = Array.from({ length: relatedCount }, (_, i) =>
          createMockTrack(`r-${i}`, `Related ${i % 3}`, `Track ${i}`)
        );
        const discovery = Array.from({ length: discoveryCount }, (_, i) =>
          createMockTrack(`d-${i}`, `Discovery ${i % 4}`, `Track ${i}`)
        );

        const targetLength = anchorCount + relatedCount + discoveryCount;
        expect(() =>
          artistService.interleaveWithAntiClumping(anchor, related, discovery, targetLength)
        ).not.toThrow();
      }
    });
  });

  // =========================================================================
  // 3. SPOTIFY URL VALIDATOR
  // =========================================================================
  describe('3. Spotify URL Validator (validateSpotifyUrl)', () => {
    describe('Malformed & Invalid Inputs', () => {
      it('rejects empty strings, whitespace, and non-string types', () => {
        expect(validateSpotifyUrl('').isValid).toBe(false);
        expect(validateSpotifyUrl('   ').isValid).toBe(false);
        expect(validateSpotifyUrl(null as any).isValid).toBe(false);
        expect(validateSpotifyUrl(undefined as any).isValid).toBe(false);
        expect(validateSpotifyUrl(12345 as any).isValid).toBe(false);
        expect(validateSpotifyUrl({} as any).isValid).toBe(false);
      });

      it('rejects non-Spotify URLs and malformed URIs', () => {
        expect(validateSpotifyUrl('https://google.com/search?q=spotify').isValid).toBe(false);
        expect(validateSpotifyUrl('https://apple.music.com/album/123').isValid).toBe(false);
        expect(validateSpotifyUrl('spotify:').isValid).toBe(false);
        expect(validateSpotifyUrl('spotify:unknown:123').isValid).toBe(false);
        expect(validateSpotifyUrl('javascript:alert(1)').isValid).toBe(false);
        expect(validateSpotifyUrl('<script>alert("xss")</script>').isValid).toBe(false);
      });

      it('rejects open.spotify.com URLs lacking a playlist, album, or track entity', () => {
        expect(validateSpotifyUrl('https://open.spotify.com/').isValid).toBe(false);
        expect(validateSpotifyUrl('https://open.spotify.com/genre/pop').isValid).toBe(false);
        expect(validateSpotifyUrl('https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb').isValid).toBe(false);
      });
    });

    describe('Standard Web URLs', () => {
      it('validates standard public playlist URLs and extracts clean ID', () => {
        const res = validateSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
        expect(res.isValid).toBe(true);
        expect(res.type).toBe('playlist');
        expect(res.id).toBe('37i9dQZF1DXcBWIGoYBM5M');
        expect(res.sanitizedUrl).toBe('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
      });

      it('validates standard album and track URLs', () => {
        const album = validateSpotifyUrl('https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa');
        expect(album.isValid).toBe(true);
        expect(album.type).toBe('album');
        expect(album.id).toBe('4m2880jivSbbyEGAKfITCa');

        const track = validateSpotifyUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
        expect(track.isValid).toBe(true);
        expect(track.type).toBe('track');
        expect(track.id).toBe('4cOdK2wGLETKBW3PvgPWqT');
      });
    });

    describe('spotify:playlist: URIs', () => {
      it('validates spotify:playlist: URI and produces sanitized web URL', () => {
        const res = validateSpotifyUrl('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
        expect(res.isValid).toBe(true);
        expect(res.type).toBe('playlist');
        expect(res.id).toBe('37i9dQZF1DXcBWIGoYBM5M');
        expect(res.sanitizedUrl).toBe('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
      });

      it('validates spotify:album: and spotify:track: URIs', () => {
        const album = validateSpotifyUrl('spotify:album:4m2880jivSbbyEGAKfITCa');
        expect(album.isValid).toBe(true);
        expect(album.type).toBe('album');
        expect(album.id).toBe('4m2880jivSbbyEGAKfITCa');

        const track = validateSpotifyUrl('spotify:track:4cOdK2wGLETKBW3PvgPWqT');
        expect(track.isValid).toBe(true);
        expect(track.type).toBe('track');
        expect(track.id).toBe('4cOdK2wGLETKBW3PvgPWqT');
      });
    });

    describe('International / Localized URLs', () => {
      it('validates internationalized country-code Spotify URLs (intl-de, intl-fr, intl-es, intl-ja)', () => {
        const de = validateSpotifyUrl('https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M');
        expect(de.isValid).toBe(true);
        expect(de.type).toBe('playlist');
        expect(de.id).toBe('37i9dQZF1DXcBWIGoYBM5M');

        const fr = validateSpotifyUrl('https://open.spotify.com/intl-fr/album/4m2880jivSbbyEGAKfITCa');
        expect(fr.isValid).toBe(true);
        expect(fr.type).toBe('album');
        expect(fr.id).toBe('4m2880jivSbbyEGAKfITCa');

        const es = validateSpotifyUrl('https://open.spotify.com/intl-es/track/4cOdK2wGLETKBW3PvgPWqT');
        expect(es.isValid).toBe(true);
        expect(es.type).toBe('track');
        expect(es.id).toBe('4cOdK2wGLETKBW3PvgPWqT');

        const ja = validateSpotifyUrl('https://open.spotify.com/intl-ja/playlist/37i9dQZF1DXcBWIGoYBM5M');
        expect(ja.isValid).toBe(true);
        expect(ja.type).toBe('playlist');
        expect(ja.id).toBe('37i9dQZF1DXcBWIGoYBM5M');
      });

      it('validates legacy user-nested playlist URLs', () => {
        const legacy = validateSpotifyUrl('https://open.spotify.com/user/spotify/playlist/37i9dQZF1DXcBWIGoYBM5M');
        expect(legacy.isValid).toBe(true);
        expect(legacy.type).toBe('playlist');
        expect(legacy.id).toBe('37i9dQZF1DXcBWIGoYBM5M');
      });
    });

    describe('Private & Query-String Parameterized URLs', () => {
      it('strips tracking and private share tokens (?si=..., &pt=...) while keeping raw entity ID pure', () => {
        const res = validateSpotifyUrl(
          'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=ab12cd34ef56&pt=fe65dc43ba21&utm_source=copy-link'
        );
        expect(res.isValid).toBe(true);
        expect(res.type).toBe('playlist');
        expect(res.id).toBe('37i9dQZF1DXcBWIGoYBM5M');
        expect(res.sanitizedUrl).toBe('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
      });
    });
  });

  // =========================================================================
  // 4. NON-DESTRUCTIVE QUEUE CLEARING
  // =========================================================================
  describe('4. Non-Destructive Queue Clearing (clearQueue)', () => {
    it('preserves active currentTrack and playback state when clearing multi-track queue', () => {
      const t0 = createMockTrack('t0', 'A0', 'S0');
      const t1 = createMockTrack('t1', 'A1', 'S1');
      const t2 = createMockTrack('t2', 'A2', 'S2');
      const t3 = createMockTrack('t3', 'A3', 'S3');

      const pauseSpy = vi.spyOn(audioEngine, 'pause');

      usePlayerStore.setState({
        queue: [t0, t1, t2, t3],
        currentTrack: t1,
        isPlaying: true,
      });

      usePlayerStore.getState().clearQueue();

      const state = usePlayerStore.getState();
      expect(state.queue.length).toBe(1);
      expect(state.queue[0].id).toBe('t1');
      expect(state.currentTrack?.id).toBe('t1');
      expect(state.isPlaying).toBe(true);
      expect(pauseSpy).not.toHaveBeenCalled();
    });

    it('preserves paused currentTrack when clearing queue', () => {
      const t0 = createMockTrack('t0', 'A0', 'S0');
      const t1 = createMockTrack('t1', 'A1', 'S1');

      usePlayerStore.setState({
        queue: [t0, t1],
        currentTrack: t0,
        isPlaying: false,
      });

      usePlayerStore.getState().clearQueue();

      const state = usePlayerStore.getState();
      expect(state.queue.length).toBe(1);
      expect(state.queue[0].id).toBe('t0');
      expect(state.currentTrack?.id).toBe('t0');
      expect(state.isPlaying).toBe(false);
    });

    it('handles empty queue without throwing or corrupting state', () => {
      usePlayerStore.setState({
        queue: [],
        currentTrack: null,
        isPlaying: false,
      });

      expect(() => usePlayerStore.getState().clearQueue()).not.toThrow();

      const state = usePlayerStore.getState();
      expect(state.queue).toEqual([]);
      expect(state.currentTrack).toBeNull();
    });

    it('handles single-item queue idempotently', () => {
      const t0 = createMockTrack('t0', 'A0', 'S0');
      usePlayerStore.setState({
        queue: [t0],
        currentTrack: t0,
        isPlaying: true,
      });

      usePlayerStore.getState().clearQueue();

      const state = usePlayerStore.getState();
      expect(state.queue).toEqual([t0]);
      expect(state.currentTrack?.id).toBe('t0');
    });

    it('gracefully handles nextTrack() after queue is cleared to active track only', () => {
      const t0 = createMockTrack('t0', 'A0', 'S0');
      const t1 = createMockTrack('t1', 'A1', 'S1');

      usePlayerStore.setState({
        queue: [t0, t1],
        currentTrack: t0,
        isPlaying: true,
        repeatMode: 'off',
      });

      // Clear upcoming tracks
      usePlayerStore.getState().clearQueue();
      expect(usePlayerStore.getState().queue.length).toBe(1);

      // Advance to next: there is no next track in queue (repeatMode is off)
      expect(() => usePlayerStore.getState().nextTrack()).not.toThrow();

      // Current track remains t0 (playback finishes or stops at end of queue)
      expect(usePlayerStore.getState().currentTrack?.id).toBe('t0');
    });
  });
});
