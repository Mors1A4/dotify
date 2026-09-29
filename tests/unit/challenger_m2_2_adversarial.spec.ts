import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recommendationEngine } from '../../src/services/recommendationEngine';
import { artistService } from '../../src/services/artistService';
import { usePlayerStore } from '../../src/store/playerStore';
import { audioEngine } from '../../src/audio/audioEngine';
import { Track } from '../../src/types/track';
import { TrackPlayRecord } from '../../src/types/telemetry';

function createMockTrack(
  id: string,
  artist: string,
  title: string,
  genre = 'Electronic',
  duration = 180
): Track {
  return {
    id,
    source: 'audius',
    title,
    artist,
    album: 'Adversarial Test Album',
    duration,
    streamUrl: `http://localhost:3001/stream/${id}.mp3`,
    artworkUrl: `http://localhost:3001/art/${id}.jpg`,
    sourceMetadata: {
      format: 'mp3',
      genre,
    },
  };
}

function createMockPlay(
  trackId: string,
  artist: string,
  genre: string,
  completionRate = 1.0,
  startTime = Date.now() - 60000
): TrackPlayRecord {
  return {
    playId: `play_${trackId}_${Math.random().toString(36).slice(2, 6)}`,
    sessionId: 'test_session',
    trackId,
    title: `Track ${trackId}`,
    artist,
    genre,
    source: 'audius',
    startTime,
    durationPlayedMs: 180000 * completionRate,
    totalDurationMs: 180000,
    completionRate,
    skipped: completionRate < 0.3,
    replayed: false,
  };
}

const DIVERSE_CATALOGUE: Track[] = [
  createMockTrack('cat_e1', 'Synthwave Boy', 'Neon Highway', 'Electronic'),
  createMockTrack('cat_e2', 'Synthwave Boy', 'Laser Grid', 'Electronic'),
  createMockTrack('cat_e3', 'Electro Pulse', 'Cyber Beats', 'Electronic'),
  createMockTrack('cat_e4', 'Electro Pulse', 'Bass Reactor', 'Electronic'),
  createMockTrack('cat_r1', 'Rock Legends', 'Guitar Fire', 'Rock'),
  createMockTrack('cat_r2', 'Rock Legends', 'Thunder Valley', 'Rock'),
  createMockTrack('cat_p1', 'Pop Starlet', 'Dance All Night', 'Pop'),
  createMockTrack('cat_p2', 'Pop Starlet', 'Glitter Rain', 'Pop'),
  createMockTrack('cat_j1', 'Jazz Quartet', 'Midnight Blue', 'Jazz'),
  createMockTrack('cat_j2', 'Jazz Quartet', 'Smooth Sax', 'Jazz'),
  createMockTrack('cat_a1', 'Ambient Dreamer', 'Ocean Drift', 'Ambient'),
  createMockTrack('cat_a2', 'Ambient Dreamer', 'Cloud Forest', 'Ambient'),
  createMockTrack('cat_m1', 'Metal Forge', 'Iron Fist', 'Metal'),
  createMockTrack('cat_m2', 'Metal Forge', 'Heavy Steel', 'Metal'),
  createMockTrack('cat_c1', 'Classical Trio', 'Moonlight Sonata', 'Classical'),
  createMockTrack('cat_c2', 'Classical Trio', 'Spring Vibe', 'Classical'),
];

describe('Empirical Adversarial Stress Suite: Milestone 2 (challenger_m2_2)', () => {
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
      autoplayEnabled: true,
    });
  });

  // =========================================================================
  // 1. COLD START RECOMMENDATION GENERATION (Zero Listening History)
  // =========================================================================
  describe('1. Cold Start Recommendation Generation (Zero Listening History)', () => {
    const emptyPlays: TrackPlayRecord[] = [];
    const emptyLiked: Track[] = [];

    it('Shelf 1 (Made For You) returns valid tracks on zero history', () => {
      const shelf1 = recommendationEngine.generateMadeForYou(emptyPlays, DIVERSE_CATALOGUE, emptyLiked);
      expect(Array.isArray(shelf1)).toBe(true);
      expect(shelf1.length).toBeGreaterThan(0);
      shelf1.forEach((t) => {
        expect(t).toBeDefined();
        expect(t.id).toBeDefined();
        expect(t.title).toBeDefined();
        expect(t.artist).toBeDefined();
      });
    });

    it('Shelf 2 (Discover Weekly) returns valid tracks on zero history', () => {
      const shelf2 = recommendationEngine.generateDiscoverWeekly(emptyPlays, DIVERSE_CATALOGUE, 15);
      expect(Array.isArray(shelf2)).toBe(true);
      expect(shelf2.length).toBeGreaterThan(0);
      shelf2.forEach((t) => {
        expect(t).toBeDefined();
        expect(t.id).toBeDefined();
        expect(t.title).toBeDefined();
        expect(t.artist).toBeDefined();
      });
    });

    it('Shelf 3 (Daily Mix) returns valid DailyMix clusters with non-empty tracks on zero history', () => {
      const mixes = recommendationEngine.generateDailyMixes(emptyPlays, DIVERSE_CATALOGUE);
      expect(Array.isArray(mixes)).toBe(true);
      expect(mixes.length).toBeGreaterThanOrEqual(1);

      mixes.forEach((mix) => {
        expect(mix.id).toBeDefined();
        expect(mix.title).toBeDefined();
        expect(mix.genre).toBeDefined();
        expect(Array.isArray(mix.tracks)).toBe(true);
        expect(mix.tracks.length).toBeGreaterThan(0);
      });
    });

    it('Shelf 3 (Daily Mix) cold start resilience when catalogue lacks Electronic genre', () => {
      const noElectronicCat = [
        createMockTrack('r1', 'Rocker', 'Rock 1', 'Rock'),
        createMockTrack('r2', 'Rocker', 'Rock 2', 'Rock'),
        createMockTrack('p1', 'Popper', 'Pop 1', 'Pop'),
        createMockTrack('p2', 'Popper', 'Pop 2', 'Pop'),
      ];

      const mixes = recommendationEngine.generateDailyMixes(emptyPlays, noElectronicCat);
      expect(mixes.length).toBeGreaterThanOrEqual(1);
      const mix1 = mixes.find((m) => m.id === 'mix_1');
      expect(mix1).toBeDefined();
      // EMPIRICAL CHECK: Does mix 1 have tracks even when Electronic is absent from catalogue?
      expect(mix1!.tracks.length).toBeGreaterThan(0);
    });

    it('Shelf 3 (Daily Mix) cold start resilience when catalogue has fewer than 10 tracks', () => {
      const smallCatalogue = [
        createMockTrack('s1', 'Artist A', 'Song A', 'Electronic'),
        createMockTrack('s2', 'Artist B', 'Song B', 'Pop'),
        createMockTrack('s3', 'Artist C', 'Song C', 'Rock'),
      ];

      const mixes = recommendationEngine.generateDailyMixes(emptyPlays, smallCatalogue);
      const mix3 = mixes.find((m) => m.id === 'mix_3');
      expect(mix3).toBeDefined();
      // EMPIRICAL CHECK: Does Mix 3 contain valid playable tracks or is it empty?
      expect(mix3!.tracks.length).toBeGreaterThan(0);
    });

    it('Shelf 4 (Heavy Rotation) returns valid tracks on zero history', () => {
      const shelf4 = recommendationEngine.generateHeavyRotation(emptyPlays, DIVERSE_CATALOGUE);
      expect(Array.isArray(shelf4)).toBe(true);
      expect(shelf4.length).toBeGreaterThan(0);
      shelf4.forEach((t) => {
        expect(t).toBeDefined();
        expect(t.id).toBeDefined();
        expect(t.title).toBeDefined();
      });
    });

    it('Shelf 5 (Forgotten Favorites) returns valid tracks on zero history without blank UI', () => {
      const shelf5 = recommendationEngine.generateForgottenFavorites(emptyPlays, DIVERSE_CATALOGUE);
      expect(Array.isArray(shelf5)).toBe(true);
      // EMPIRICAL CHECK: Requirement 1 explicitly states:
      // "ensure all 5 shelves return valid tracks without crash or blank UI"
      expect(shelf5.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 2. SINGLE-GENRE USER LISTENING PROFILE
  // =========================================================================
  describe('2. Single-Genre User Listening Profile (Daily Mix Cohesion & Clustering)', () => {
    it('does not crash and produces distinct daily mix clusters for single-genre listener', () => {
      const singleGenrePlays = [
        createMockPlay('cat_e1', 'Synthwave Boy', 'Electronic', 1.0),
        createMockPlay('cat_e2', 'Synthwave Boy', 'Electronic', 1.0),
        createMockPlay('cat_e3', 'Electro Pulse', 'Electronic', 0.9),
        createMockPlay('cat_e4', 'Electro Pulse', 'Electronic', 1.0),
      ];

      const mixes = recommendationEngine.generateDailyMixes(singleGenrePlays, DIVERSE_CATALOGUE);
      expect(mixes).toBeDefined();
      expect(mixes.length).toBeGreaterThanOrEqual(2);

      // Verify unique IDs
      const ids = mixes.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);

      // Verify unique titles
      const titles = mixes.map((m) => m.title);
      expect(new Set(titles).size).toBe(titles.length);

      // Verify distinct genres
      const genres = mixes.map((m) => m.genre);
      expect(new Set(genres).size).toBe(genres.length);

      // Verify clusters are not duplicate track lists
      const trackIdSets = mixes.map((m) => new Set(m.tracks.map((t) => t.id)));
      for (let i = 0; i < trackIdSets.length; i++) {
        for (let j = i + 1; j < trackIdSets.length; j++) {
          const intersection = [...trackIdSets[i]].filter((x) => trackIdSets[j].has(x));
          const union = new Set([...trackIdSets[i], ...trackIdSets[j]]);
          const jaccard = union.size > 0 ? intersection.length / union.size : 0;
          expect(jaccard).toBeLessThan(1.0);
        }
      }
    });

    it('handles single-genre listener when catalogue ONLY contains tracks of that single genre', () => {
      const onlyElectronicCat = [
        createMockTrack('oe1', 'Synth 1', 'Track 1', 'Electronic'),
        createMockTrack('oe2', 'Synth 2', 'Track 2', 'Electronic'),
        createMockTrack('oe3', 'Synth 3', 'Track 3', 'Electronic'),
        createMockTrack('oe4', 'Synth 4', 'Track 4', 'Electronic'),
      ];

      const singleGenrePlays = [
        createMockPlay('oe1', 'Synth 1', 'Electronic', 1.0),
      ];

      const mixes = recommendationEngine.generateDailyMixes(singleGenrePlays, onlyElectronicCat);
      expect(mixes.length).toBeGreaterThanOrEqual(2);

      // EMPIRICAL CHECK: Does Mix 2 duplicate Mix 1 completely?
      const mix1Ids = mixes[0].tracks.map((t) => t.id).sort().join(',');
      const mix2Ids = mixes[1].tracks.map((t) => t.id).sort().join(',');
      expect(mix1Ids).not.toBe(mix2Ids);
    });

    it('handles single-genre listener whose genre is not present in catalogue', () => {
      const strangeGenrePlays = [
        createMockPlay('ext_1', 'Viking Chant', 'Nordic Folk Metal', 1.0),
        createMockPlay('ext_2', 'Viking Chant', 'Nordic Folk Metal', 1.0),
      ];

      const mixes = recommendationEngine.generateDailyMixes(strangeGenrePlays, DIVERSE_CATALOGUE);
      expect(mixes.length).toBeGreaterThanOrEqual(2);

      mixes.forEach((m) => {
        expect(m.tracks.length).toBeGreaterThan(0);
      });

      // EMPIRICAL CHECK: Are Mix 1 and Mix 2 distinct clusters?
      const mix1Ids = mixes[0].tracks.map((t) => t.id).sort().join(',');
      const mix2Ids = mixes[1].tracks.map((t) => t.id).sort().join(',');
      expect(mix1Ids).not.toBe(mix2Ids);
    });
  });

  // =========================================================================
  // 3. INFINITE AUTOPLAY ANTI-CLUMPING
  // =========================================================================
  describe('3. Infinite Autoplay Anti-Clumping (<= 2 Consecutive Tracks by Same Artist)', () => {
    it('verifies <= 2 consecutive tracks by the same artist with single-artist loop seeds (diverse catalogue)', async () => {
      const singleArtistSeeds = [
        createMockTrack('seed_1', 'Solo Star', 'Loop 1', 'Pop'),
        createMockTrack('seed_2', 'Solo Star', 'Loop 2', 'Pop'),
        createMockTrack('seed_3', 'Solo Star', 'Loop 3', 'Pop'),
      ];

      const recommendations = await recommendationEngine.getAutoplayRecommendations(
        singleArtistSeeds,
        10,
        DIVERSE_CATALOGUE
      );

      expect(recommendations.length).toBe(10);

      // Verify anti-clumping: no more than 2 consecutive tracks by the same artist
      for (let i = 0; i < recommendations.length - 2; i++) {
        const a1 = recommendations[i].artist;
        const a2 = recommendations[i + 1].artist;
        const a3 = recommendations[i + 2].artist;

        const isThreeInARow = a1 === a2 && a2 === a3;
        expect(isThreeInARow).toBe(false);
      }
    });

    it('stress-tests artistService.interleaveWithAntiClumping directly when pools contain single-artist clumping', () => {
      const artistA_tracks = [
        createMockTrack('a1', 'Artist A', 'Song A1'),
        createMockTrack('a2', 'Artist A', 'Song A2'),
        createMockTrack('a3', 'Artist A', 'Song A3'),
        createMockTrack('a4', 'Artist A', 'Song A4'),
        createMockTrack('a5', 'Artist A', 'Song A5'),
      ];

      const artistB_tracks = [
        createMockTrack('b1', 'Artist B', 'Song B1'),
      ];

      // Pool A has 5 tracks of Artist A, Pool R has 1 track of Artist B, Pool G is empty
      const result = artistService.interleaveWithAntiClumping(artistA_tracks, artistB_tracks, [], 6);

      // Check consecutive tracks by Artist A
      let maxConsecutive = 0;
      let currentStreak = 0;
      let currentArtist = '';

      for (const track of result) {
        if (track.artist === currentArtist) {
          currentStreak++;
        } else {
          currentArtist = track.artist;
          currentStreak = 1;
        }
        if (currentStreak > maxConsecutive) {
          maxConsecutive = currentStreak;
        }
      }

      // EMPIRICAL CHECK: Strict requirement: <= 2 consecutive tracks by the same artist!
      expect(maxConsecutive).toBeLessThanOrEqual(2);
    });

    it('verifies anti-clumping when all input seeds and fallback catalogue belong to a SINGLE artist', async () => {
      const monoArtistCat = [
        createMockTrack('m1', 'Monolith', 'Track 1', 'Rock'),
        createMockTrack('m2', 'Monolith', 'Track 2', 'Rock'),
        createMockTrack('m3', 'Monolith', 'Track 3', 'Rock'),
        createMockTrack('m4', 'Monolith', 'Track 4', 'Rock'),
        createMockTrack('m5', 'Monolith', 'Track 5', 'Rock'),
      ];

      const monoSeeds = [monoArtistCat[0], monoArtistCat[1]];

      const recs = await recommendationEngine.getAutoplayRecommendations(
        monoSeeds,
        8,
        monoArtistCat
      );

      expect(recs.length).toBe(8);

      let maxConsecutive = 0;
      let currentStreak = 0;
      let currentArtist = '';

      for (const track of recs) {
        if (track.artist === currentArtist) {
          currentStreak++;
        } else {
          currentArtist = track.artist;
          currentStreak = 1;
        }
        if (currentStreak > maxConsecutive) {
          maxConsecutive = currentStreak;
        }
      }

      expect(maxConsecutive).toBeLessThanOrEqual(2);
    });
  });

  // =========================================================================
  // 4. RAPID QUEUE RUNOUT (20+ Repeated Exhaustion Triggers)
  // =========================================================================
  describe('4. Rapid Queue Runout (20+ Repeated Exhaustion Triggers)', () => {
    it('extends queue smoothly without duplicate runaway or audio disruption across 25 consecutive runouts', async () => {
      const playTrackSpy = vi.spyOn(audioEngine, 'playTrack');
      const initialTrack = createMockTrack('seed_init', 'Seed Artist', 'Initial Seed');

      const store = usePlayerStore.getState();
      store.enableAutoplay(true);
      store.playTrack(initialTrack, [initialTrack]);

      expect(usePlayerStore.getState().queue.length).toBe(1);

      const runoutCount = 25;
      const observedQueueLengths: number[] = [];

      for (let i = 0; i < runoutCount; i++) {
        await usePlayerStore.getState().nextTrack();

        const currentQueue = usePlayerStore.getState().queue;
        observedQueueLengths.push(currentQueue.length);

        const curTrack = usePlayerStore.getState().currentTrack;
        expect(curTrack).toBeDefined();
        expect(curTrack?.id).toBeDefined();

        expect(playTrackSpy).toHaveBeenCalledWith(curTrack);
      }

      const finalQueue = usePlayerStore.getState().queue;
      expect(finalQueue.length).toBeGreaterThanOrEqual(runoutCount);

      const trackIds = finalQueue.map((t) => t.id);
      const uniqueIds = new Set(trackIds);

      const duplicateCount = trackIds.length - uniqueIds.size;
      expect(duplicateCount).toBe(0);

      const cur = usePlayerStore.getState().currentTrack;
      const foundIdx = finalQueue.findIndex((t) => t.id === cur?.id);
      expect(foundIdx).toBeGreaterThanOrEqual(0);
      expect(finalQueue[foundIdx].id).toBe(cur?.id);
    }, 15000);

    it('checks for duplicate track IDs in getAutoplayRecommendations when tracks match both artist and genre', async () => {
      const dualMatchTrack = createMockTrack('cat_e1', 'Synthwave Boy', 'Neon Highway', 'Electronic');
      const seed = createMockTrack('seed_e', 'Synthwave Boy', 'Seed Song', 'Electronic');

      const recs = await recommendationEngine.getAutoplayRecommendations(
        [seed],
        5,
        [dualMatchTrack]
      );

      const ids = recs.map((t) => t.id);
      const uniqueIds = new Set(ids);
      // EMPIRICAL CHECK: All recommended tracks must have unique IDs! No duplicates!
      expect(ids.length).toBe(uniqueIds.size);
    });

    it('demonstrates queue runaway / backward jump loop bug when duplicate track IDs exist in queue', async () => {
      const t0 = createMockTrack('dup_1', 'Artist 1', 'Song 1');
      const t1 = createMockTrack('unique_2', 'Artist 2', 'Song 2');
      const t2 = createMockTrack('dup_1', 'Artist 1', 'Song 1'); // DUPLICATE ID
      const t3 = createMockTrack('unique_3', 'Artist 3', 'Song 3');

      const store = usePlayerStore.getState();
      store.enableAutoplay(false);
      store.setQueue([t0, t1, t2, t3]);

      store.playTrack(t2);
      expect(usePlayerStore.getState().currentTrack?.id).toBe('dup_1');

      await store.nextTrack();

      // Because queue.findIndex returns index 0 for dup_1, nextIndex becomes 0 + 1 = 1 (unique_2)!
      // It jumped BACKWARD instead of forward to unique_3!
      const currentTrackAfterNext = usePlayerStore.getState().currentTrack;
      expect(currentTrackAfterNext?.id).toBe('unique_3');
    });

    it('stress-tests concurrent rapid exhaustion calls (race condition resistance)', async () => {
      const initialTrack = createMockTrack('seed_race', 'Race Artist', 'Race Track');
      const store = usePlayerStore.getState();
      store.enableAutoplay(true);
      store.playTrack(initialTrack, [initialTrack]);

      const calls = Array.from({ length: 20 }, () => usePlayerStore.getState().nextTrack());
      await Promise.all(calls);

      const state = usePlayerStore.getState();
      expect(state.queue.length).toBeGreaterThan(0);
      expect(state.currentTrack).toBeDefined();
      expect(typeof state.currentTrack?.id).toBe('string');
    });
  });
});
