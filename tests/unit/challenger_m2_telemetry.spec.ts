import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelemetryDatabase } from '../../src/services/telemetryDb';
import { RecommendationEngine } from '../../src/services/recommendationEngine';
import { usePlayerStore } from '../../src/store/playerStore';
import { Track } from '../../src/types/track';
import {
  ListeningSessionRecord,
  TrackPlayRecord,
  GenreAffinityRecord,
  ArtistAffinityRecord,
  ExportableTelemetryDataset,
} from '../../src/types/telemetry';

function createMockTrack(
  id: string,
  artist: string,
  title: string,
  genre = 'Electronic',
  duration = 180,
  source: 'audius' | 'archive' | 'radio' | 'p2p' = 'audius'
): Track {
  return {
    id,
    source,
    title,
    artist,
    album: 'Telemetry Challenger Album',
    duration,
    streamUrl: `http://localhost:3001/stream/${id}.mp3`,
    artworkUrl: `http://localhost:3001/art/${id}.jpg`,
    sourceMetadata: {
      format: 'mp3',
      genre,
    },
  };
}

const CATALOGUE_16: Track[] = [
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

describe('Adversarial Telemetry & Cold-Start Suite (challenger_m2_it2_1)', () => {
  let db: TelemetryDatabase;
  let engine: RecommendationEngine;

  beforeEach(async () => {
    db = TelemetryDatabase.getInstance();
    await db.clearTelemetry();
    engine = RecommendationEngine.getInstance();
    vi.restoreAllMocks();
    usePlayerStore.setState({
      queue: [],
      currentTrack: null,
      currentTrackIndex: -1,
      history: [],
      isPlaying: false,
      isBuffering: false,
      repeatMode: 'off',
      shuffle: false,
      autoplayEnabled: true,
    });
  });

  afterEach(async () => {
    await db.clearTelemetry();
  });

  // =========================================================================
  // SUITE 1: TELEMETRY STORAGE UNDER STRESS
  // =========================================================================
  describe('1. Telemetry Storage Under Stress', () => {
    it('handles 50 concurrent recordPlay calls across multiple sessions without data loss', async () => {
      const sessions = ['s_alpha', 's_beta', 's_gamma', 's_delta', 's_epsilon'];
      for (const sid of sessions) {
        await db.recordSession({
          sessionId: sid,
          startTime: Date.now() - 300000,
          deviceType: 'desktop',
          tracksPlayed: 0,
          totalDurationMs: 0,
        });
      }

      const playPromises: Promise<any>[] = [];
      for (let i = 0; i < 50; i++) {
        const sid = sessions[i % sessions.length];
        const track = CATALOGUE_16[i % CATALOGUE_16.length];
        const durationPlayed = 30000 + i * 2500;
        const totalDuration = 180000;
        const replayed = i % 5 === 0;

        playPromises.push(db.recordPlay(sid, track, durationPlayed, totalDuration, replayed));
      }

      const results = await Promise.all(playPromises);
      expect(results.length).toBe(50);

      const allPlays = await db.getAllPlays();
      expect(allPlays.length).toBe(50);

      // Verify each play record has valid calculated fields
      for (const p of allPlays) {
        expect(p.playId).toBeDefined();
        expect(p.trackId).toBeDefined();
        expect(p.completionRate).toBeGreaterThanOrEqual(0);
        expect(p.completionRate).toBeLessThanOrEqual(1);
        expect(typeof p.skipped).toBe('boolean');
        expect(typeof p.completed).toBe('boolean');
      }

      // Verify sessions were updated
      const allSessions = await db.getAllSessions();
      expect(allSessions.length).toBe(5);
      for (const s of allSessions) {
        expect(s.tracksPlayed).toBeGreaterThan(0);
        expect(s.totalDurationMs).toBeGreaterThan(0);
      }
    });

    it('records rapid sequential session lifecycle operations (20 sessions)', async () => {
      const createdSessions: ListeningSessionRecord[] = [];
      for (let i = 0; i < 20; i++) {
        const session = await db.startSession(i % 2 === 0 ? 'desktop' : 'mobile');
        expect(session.sessionId).toBeDefined();
        expect(session.endedAt).toBeUndefined();

        await db.recordPlay(session.sessionId, CATALOGUE_16[i % CATALOGUE_16.length], 60000, 180000, false);
        await db.endSession(session.sessionId);
        createdSessions.push(session);
      }

      const storedSessions = await db.getAllSessions();
      expect(storedSessions.length).toBe(20);
      for (const s of storedSessions) {
        expect(s.endTime || s.endedAt).toBeDefined();
        expect((s as any).tracksPlayed).toBe(1);
      }
    });

    it('handles extreme and boundary durations gracefully (0ms, negative, Infinity, 24-hour)', async () => {
      // 0ms played
      const pZero = await db.recordPlay('s_bound', CATALOGUE_16[0], 0, 180000, false);
      expect(pZero.completionRate).toBe(0);
      expect(pZero.skipped).toBe(true);
      expect(pZero.completed).toBe(false);

      // Negative duration played
      const pNeg = await db.recordPlay('s_bound', CATALOGUE_16[1], -500, 180000, false);
      expect(pNeg.completionRate).toBe(0);
      expect(pNeg.skipped).toBe(true);

      // Infinity total duration with live radio track (track.duration === Infinity)
      const liveRadioTrack = createMockTrack('radio_live_1', 'Live Radio FM', 'Global Stream', 'Ambient', Infinity, 'radio');
      const pRadio = await db.recordPlay('s_bound', liveRadioTrack, 120000, Infinity, false);
      expect(isFinite(pRadio.completionRate)).toBe(true);
      expect(pRadio.completionRate).toBe(1);
      expect(pRadio.completed).toBe(true);
      expect(pRadio.durationMs).toBe(120000);

      // Infinity total duration with finite track (falls back to track.duration * 1000)
      const pInfFinite = await db.recordPlay('s_bound', CATALOGUE_16[2], 120000, Infinity, false);
      expect(pInfFinite.completionRate).toBeCloseTo(120000 / 180000, 3);
      expect(pInfFinite.totalDurationMs).toBe(180000);

      // 24-hour stream (86,400,000 ms)
      const oneDayMs = 86400000;
      const pDay = await db.recordPlay('s_bound', CATALOGUE_16[3], oneDayMs, oneDayMs, false);
      expect(pDay.completionRate).toBe(1);
      expect(pDay.completed).toBe(true);
      expect(pDay.skipped).toBe(false);
    });

    it('handles tracks with missing metadata and injection / unicode strings', async () => {
      const weirdTrack: Track = {
        id: 'weird_track_1',
        source: 'audius',
        title: 'DROP TABLE plays; <script>alert("hack")</script> 🚀🎶',
        artist: 'XÆA-12 / Unknown artist with emoji 🔥',
        duration: 0,
        streamUrl: '',
        sourceMetadata: undefined as any,
      };

      const play = await db.recordPlay('s_weird', weirdTrack, 45000, 45000, false);
      expect(play).toBeDefined();
      expect(play.genre).toBe('Unknown');
      expect(play.artist).toBe('XÆA-12 / Unknown artist with emoji 🔥');
      expect(play.title).toContain('<script>');
    });

    it('correctly computes and bounds genre and artist affinity scores (1 to 100)', async () => {
      const rockTrack = CATALOGUE_16[4]; // Rock Legends, Rock

      // 10 completed plays with replays
      for (let i = 0; i < 10; i++) {
        await db.recordPlay('s_affinity', rockTrack, 180000, 180000, true);
      }

      const genres = await db.getTopGenres();
      const rockAffinity = genres.find((g) => g.genre === 'Rock');
      expect(rockAffinity).toBeDefined();
      expect(rockAffinity!.affinityScore).toBeGreaterThanOrEqual(1);
      expect(rockAffinity!.affinityScore).toBeLessThanOrEqual(100);
      expect(rockAffinity!.playCount).toBe(10);

      const artists = await db.getTopArtists();
      const artistAffinity = artists.find((a) => a.artist === 'Rock Legends');
      expect(artistAffinity).toBeDefined();
      expect(artistAffinity!.affinityScore).toBeGreaterThanOrEqual(1);
      expect(artistAffinity!.affinityScore).toBeLessThanOrEqual(100);
      expect(artistAffinity!.playCount).toBe(10);
    });

    it('clearTelemetry purges all object stores completely', async () => {
      await db.recordPlay('s_purge', CATALOGUE_16[0], 180000, 180000, false);
      await db.clearTelemetry();

      const plays = await db.getAllPlays();
      const sessions = await db.getAllSessions();
      const genres = await db.getGenreAffinities();
      const artists = await db.getArtistAffinities();

      expect(plays.length).toBe(0);
      expect(sessions.length).toBe(0);
      expect(genres.length).toBe(0);
      expect(artists.length).toBe(0);
    });
  });

  // =========================================================================
  // SUITE 2: TELEMETRY EXPORT / IMPORT ROUND-TRIP UNDER STRESS
  // =========================================================================
  describe('2. Telemetry Export / Import Round-Trip Under Stress', () => {
    it('verifies full round-trip export and import fidelity', async () => {
      // 1. Populate DB with 12 plays across 3 sessions
      const sessions = ['s_rt_1', 's_rt_2', 's_rt_3'];
      for (const sid of sessions) {
        await db.recordSession({
          sessionId: sid,
          startTime: Date.now() - 100000,
          deviceType: 'desktop',
          tracksPlayed: 0,
          totalDurationMs: 0,
        });
      }
      for (let i = 0; i < 12; i++) {
        await db.recordPlay(sessions[i % 3], CATALOGUE_16[i], 120000, 180000, i % 2 === 0);
      }

      // 2. Export dataset
      const exportedJson = await db.exportTelemetryDataset();
      const exportedObj: ExportableTelemetryDataset = JSON.parse(exportedJson);
      expect(exportedObj.schemaVersion === 1 || exportedObj.version === 1).toBe(true);
      expect(exportedObj.plays.length).toBe(12);
      expect(exportedObj.sessions.length).toBe(3);

      // 3. Clear DB
      await db.clearTelemetry();
      expect((await db.getAllPlays()).length).toBe(0);

      // 4. Import dataset
      const importResult = await db.importTelemetryDataset(exportedJson);
      expect(importResult.importedPlays).toBe(12);
      expect(importResult.importedSessions).toBe(3);

      // 5. Verify restored database contents
      const restoredPlays = await db.getAllPlays();
      expect(restoredPlays.length).toBe(12);
      const restoredSessions = await db.getAllSessions();
      expect(restoredSessions.length).toBe(3);

      // Check field-level integrity for the first play
      const originalFirst = exportedObj.plays[0];
      const restoredFirst = restoredPlays.find((p) => (p.playId || p.id) === (originalFirst.playId || originalFirst.id));
      expect(restoredFirst).toBeDefined();
      expect(restoredFirst!.trackId).toBe(originalFirst.trackId);
      expect(restoredFirst!.durationPlayedMs).toBe(originalFirst.durationPlayedMs);
      expect(restoredFirst!.completionRate).toBe(originalFirst.completionRate);
    });

    it('handles high volume import stress (120 plays, 15 sessions)', async () => {
      const bigSessions: ListeningSessionRecord[] = [];
      for (let s = 0; s < 15; s++) {
        bigSessions.push({
          sessionId: `bulk_s_${s}`,
          startTime: Date.now() - s * 3600000,
          deviceType: s % 2 === 0 ? 'desktop' : 'mobile',
          tracksPlayed: 8,
          totalDurationMs: 8 * 180000,
        });
      }

      const bigPlays: TrackPlayRecord[] = [];
      for (let p = 0; p < 120; p++) {
        const track = CATALOGUE_16[p % CATALOGUE_16.length];
        bigPlays.push({
          playId: `bulk_p_${p}`,
          sessionId: `bulk_s_${p % 15}`,
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          genre: track.sourceMetadata?.genre || 'Electronic',
          source: track.source,
          startTime: Date.now() - p * 60000,
          durationPlayedMs: 180000,
          totalDurationMs: 180000,
          completionRate: 1.0,
          skipped: false,
          completed: true,
          replayed: p % 4 === 0,
        });
      }

      const dataset: ExportableTelemetryDataset = {
        schemaVersion: 1,
        exportedAt: Date.now(),
        sessions: bigSessions,
        plays: bigPlays,
        genreAffinities: [
          { genre: 'Electronic', playCount: 40, totalTimePlayedMs: 7200000, affinityScore: 90 },
          { genre: 'Rock', playCount: 30, totalTimePlayedMs: 5400000, affinityScore: 75 },
        ],
        artistAffinities: [
          { artist: 'Synthwave Boy', playCount: 30, totalTimePlayedMs: 5400000, affinityScore: 85 },
        ],
      };

      const result = await db.importDataset(dataset);
      expect(result.importedPlays).toBe(120);
      expect(result.importedSessions).toBe(15);

      const plays = await db.getAllPlays();
      expect(plays.length).toBe(120);

      const recent50 = await db.getRecentTrackPlays(50);
      expect(recent50.length).toBe(50);
      // Ensure descending sort by startTime
      for (let i = 1; i < recent50.length; i++) {
        expect(recent50[i - 1].startTime).toBeGreaterThanOrEqual(recent50[i].startTime);
      }
    });

    it('idempotently handles repeated imports of the same dataset without duplicating data', async () => {
      const dataset: ExportableTelemetryDataset = {
        schemaVersion: 1,
        exportedAt: Date.now(),
        sessions: [
          {
            sessionId: 'idem_session_1',
            startTime: Date.now() - 50000,
            deviceType: 'desktop',
            totalDurationMs: 180000,
          },
        ],
        plays: [
          {
            playId: 'idem_play_1',
            sessionId: 'idem_session_1',
            trackId: CATALOGUE_16[0].id,
            title: CATALOGUE_16[0].title,
            artist: CATALOGUE_16[0].artist,
            genre: 'Electronic',
            source: 'audius',
            startTime: Date.now() - 30000,
            durationPlayedMs: 180000,
            totalDurationMs: 180000,
            completionRate: 1.0,
            skipped: false,
            replayed: false,
          },
        ],
        genreAffinities: [],
        artistAffinities: [],
      };

      await db.importDataset(dataset);
      await db.importDataset(dataset);
      await db.importDataset(dataset);

      const allPlays = await db.getAllPlays();
      const allSessions = await db.getAllSessions();
      expect(allPlays.length).toBe(1);
      expect(allSessions.length).toBe(1);
    });

    it('strictly validates schema and rejects invalid or malformed imports', async () => {
      // 1. Non-JSON string
      await expect(db.importDataset('not a json string')).rejects.toThrow('Invalid telemetry dataset schema');

      // 2. Unsupported schema version
      await expect(db.importDataset({ schemaVersion: 99, plays: [], sessions: [] })).rejects.toThrow('Invalid telemetry dataset schema');

      // 3. Missing plays or sessions arrays
      await expect(db.importDataset({ schemaVersion: 1, plays: null, sessions: [] })).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(db.importDataset({ schemaVersion: 1, plays: [], sessions: 'invalid' })).rejects.toThrow('Invalid telemetry dataset schema');

      // 4. Null or primitive values
      await expect(db.importDataset(null)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(db.importDataset(12345)).rejects.toThrow('Invalid telemetry dataset schema');

      // 5. Valid schema with missing optional affinities succeeds
      const minimalValid = {
        schemaVersion: 1,
        sessions: [],
        plays: [],
      };
      const res = await db.importDataset(minimalValid);
      expect(res.importedPlays).toBe(0);
      expect(res.importedSessions).toBe(0);
    });
  });

  // =========================================================================
  // SUITE 3: COLD-START BEHAVIOR ACROSS ALL 5 SHELVES
  // =========================================================================
  describe('3. Cold-Start Behavior Across All 5 Shelves', () => {
    const emptyPlays: TrackPlayRecord[] = [];
    const emptyLiked: Track[] = [];

    describe('3.1 Zero History with Standard Catalogue (16 Tracks)', () => {
      it('Shelf 1 (Made For You) returns valid tracks (<= 10)', () => {
        const shelf = engine.generateMadeForYou(emptyPlays, CATALOGUE_16, emptyLiked);
        expect(Array.isArray(shelf)).toBe(true);
        expect(shelf.length).toBe(10);
        for (const t of shelf) {
          expect(t.id).toBeDefined();
          expect(t.title).toBeDefined();
        }
      });

      it('Shelf 2 (Discover Weekly) returns up to requested count with MMR diversity', () => {
        const shelf = engine.generateDiscoverWeekly(emptyPlays, CATALOGUE_16, 30);
        expect(Array.isArray(shelf)).toBe(true);
        expect(shelf.length).toBe(16); // Total catalogue size
        const uniqueIds = new Set(shelf.map((t) => t.id));
        expect(uniqueIds.size).toBe(16);
      });

      it('Shelf 3 (Daily Mixes) returns 3 non-empty daily mixes', () => {
        const mixes = engine.generateDailyMixes(emptyPlays, CATALOGUE_16);
        expect(Array.isArray(mixes)).toBe(true);
        expect(mixes.length).toBe(3);

        for (const mix of mixes) {
          expect(mix.id).toBeDefined();
          expect(mix.title).toBeDefined();
          expect(mix.genre).toBeDefined();
          expect(mix.tracks.length).toBeGreaterThan(0);
          const trackIds = new Set(mix.tracks.map((t) => t.id));
          expect(trackIds.size).toBe(mix.tracks.length); // No internal duplicates
        }
      });

      it('Shelf 4 (Heavy Rotation) returns valid fallback tracks (<= 12)', () => {
        const shelf = engine.generateHeavyRotation(emptyPlays, CATALOGUE_16);
        expect(Array.isArray(shelf)).toBe(true);
        expect(shelf.length).toBe(12);
      });

      it('Shelf 5 (Forgotten Favorites) returns non-empty fallback tracks (avoiding blank UI)', () => {
        const shelf = engine.generateForgottenFavorites(emptyPlays, CATALOGUE_16);
        expect(Array.isArray(shelf)).toBe(true);
        expect(shelf.length).toBeGreaterThan(0);
        expect(shelf.length).toBeLessThanOrEqual(15);
      });
    });

    describe('3.2 Small Catalogues (< 5 Tracks)', () => {
      const CATALOGUE_4 = CATALOGUE_16.slice(0, 4);
      const CATALOGUE_2 = CATALOGUE_16.slice(0, 2);
      const CATALOGUE_1 = CATALOGUE_16.slice(0, 1);

      it('handles 4-track catalogue across all 5 shelves without errors or infinite loops', () => {
        const s1 = engine.generateMadeForYou(emptyPlays, CATALOGUE_4, emptyLiked);
        expect(s1.length).toBe(4);

        const s2 = engine.generateDiscoverWeekly(emptyPlays, CATALOGUE_4, 30);
        expect(s2.length).toBe(4);

        const s3 = engine.generateDailyMixes(emptyPlays, CATALOGUE_4);
        expect(s3.length).toBe(3);
        for (const mix of s3) {
          expect(mix.tracks.length).toBeGreaterThan(0);
          expect(mix.tracks.length).toBeLessThanOrEqual(4);
        }

        const s4 = engine.generateHeavyRotation(emptyPlays, CATALOGUE_4);
        expect(s4.length).toBe(4);

        const s5 = engine.generateForgottenFavorites(emptyPlays, CATALOGUE_4);
        expect(s5.length).toBe(4);
      });

      it('handles 2-track catalogue across all 5 shelves without errors', () => {
        const s1 = engine.generateMadeForYou(emptyPlays, CATALOGUE_2, emptyLiked);
        expect(s1.length).toBe(2);

        const s2 = engine.generateDiscoverWeekly(emptyPlays, CATALOGUE_2, 30);
        expect(s2.length).toBe(2);

        const s3 = engine.generateDailyMixes(emptyPlays, CATALOGUE_2);
        expect(s3.length).toBe(3);
        for (const mix of s3) {
          expect(mix.tracks.length).toBeGreaterThan(0);
          expect(mix.tracks.length).toBeLessThanOrEqual(2);
        }

        const s4 = engine.generateHeavyRotation(emptyPlays, CATALOGUE_2);
        expect(s4.length).toBe(2);

        const s5 = engine.generateForgottenFavorites(emptyPlays, CATALOGUE_2);
        expect(s5.length).toBe(2);
      });

      it('handles 1-track (singleton) catalogue across all 5 shelves', () => {
        const s1 = engine.generateMadeForYou(emptyPlays, CATALOGUE_1, emptyLiked);
        expect(s1.length).toBe(1);

        const s2 = engine.generateDiscoverWeekly(emptyPlays, CATALOGUE_1, 30);
        expect(s2.length).toBe(1);

        const s3 = engine.generateDailyMixes(emptyPlays, CATALOGUE_1);
        expect(s3.length).toBe(3);
        for (const mix of s3) {
          expect(mix.tracks.length).toBe(1);
          expect(mix.tracks[0].id).toBe(CATALOGUE_1[0].id);
        }

        const s4 = engine.generateHeavyRotation(emptyPlays, CATALOGUE_1);
        expect(s4.length).toBe(1);

        const s5 = engine.generateForgottenFavorites(emptyPlays, CATALOGUE_1);
        expect(s5.length).toBe(1);
      });
    });

    describe('3.3 Empty Catalogue (0 Tracks)', () => {
      const EMPTY_CATALOGUE: Track[] = [];

      it('safely handles empty catalogue without throwing uncaught exceptions', () => {
        const s1 = engine.generateMadeForYou(emptyPlays, EMPTY_CATALOGUE, emptyLiked);
        expect(s1).toEqual([]);

        const s2 = engine.generateDiscoverWeekly(emptyPlays, EMPTY_CATALOGUE, 30);
        expect(s2).toEqual([]);

        const s3 = engine.generateDailyMixes(emptyPlays, EMPTY_CATALOGUE);
        expect(s3.length).toBe(3);
        for (const mix of s3) {
          expect(mix.tracks).toEqual([]);
        }

        const s4 = engine.generateHeavyRotation(emptyPlays, EMPTY_CATALOGUE);
        expect(s4).toEqual([]);

        const s5 = engine.generateForgottenFavorites(emptyPlays, EMPTY_CATALOGUE);
        expect(s5).toEqual([]);
      });
    });

    describe('3.4 Empty / Unmatched Genre Stress in Cold Start', () => {
      it('populates all 3 Daily Mixes when catalogue has ZERO tracks matching Electronic, Pop, or Rock', () => {
        // Catalogue only containing Ambient tracks
        const AMBIENT_CATALOGUE: Track[] = [
          createMockTrack('amb_1', 'Ambient Master', 'Drift One', 'Ambient'),
          createMockTrack('amb_2', 'Ambient Master', 'Drift Two', 'Ambient'),
          createMockTrack('amb_3', 'Space Tone', 'Nebula Calm', 'Ambient'),
          createMockTrack('amb_4', 'Space Tone', 'Solar Wind', 'Ambient'),
          createMockTrack('amb_5', 'Deep Drone', 'Low Frequency', 'Ambient'),
          createMockTrack('amb_6', 'Deep Drone', 'Sub Zero', 'Ambient'),
          createMockTrack('amb_7', 'Echo Sphere', 'Mirror World', 'Ambient'),
          createMockTrack('amb_8', 'Echo Sphere', 'Crystal Cave', 'Ambient'),
        ];

        const mixes = engine.generateDailyMixes(emptyPlays, AMBIENT_CATALOGUE);
        expect(mixes.length).toBe(3);

        for (const mix of mixes) {
          // Despite mismatching the mix genre titles, circular fallback guarantees non-empty tracks
          expect(mix.tracks.length).toBeGreaterThan(0);
          expect(mix.tracks.length).toBe(8);
        }

        // Circular offsets ensure different tracks appear at the start of each mix
        const mix1First = mixes[0].tracks[0].id;
        const mix2First = mixes[1].tracks[0].id;
        const mix3First = mixes[2].tracks[0].id;

        // Offset 0 vs Offset 5 vs Offset 10 % 8
        // 0 % 8 = 0 -> amb_1
        // 5 % 8 = 5 -> amb_6
        // 10 % 8 = 2 -> amb_3
        expect(mix1First).toBe('amb_1');
        expect(mix2First).toBe('amb_6');
        expect(mix3First).toBe('amb_3');
      });
    });
  });

  // =========================================================================
  // SUITE 4: AUTOPLAY RECOMMENDATIONS & QUEUE CURSOR STRESS
  // =========================================================================
  describe('4. Autoplay Recommendations & Queue Cursor Stress', () => {
    it('handles autoplay cold-start with empty or null seeds gracefully', async () => {
      const recsEmpty = await engine.getAutoplayRecommendations([], 5, CATALOGUE_16);
      expect(recsEmpty.length).toBe(5);

      const recsNull = await engine.getAutoplayRecommendations(null as any, 5, CATALOGUE_16);
      expect(recsNull.length).toBe(5);
    });

    it('enforces anti-clumping streak invariant (<= 2 tracks per artist) and no duplicate IDs on singleton seed', async () => {
      const seed = CATALOGUE_16[0]; // Synthwave Boy
      const singleArtistCat = [
        CATALOGUE_16[0],
        CATALOGUE_16[1], // Both Synthwave Boy
      ];

      const recs = await engine.getAutoplayRecommendations(seed, 6, singleArtistCat);
      expect(recs.length).toBe(6);

      // Verify no duplicate IDs
      const ids = recs.map((r) => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);

      // Verify streak invariant: max consecutive streak of any artist is <= 2
      let streak = 1;
      let maxStreak = 1;
      for (let i = 1; i < recs.length; i++) {
        if (recs[i].artist === recs[i - 1].artist) {
          streak++;
          if (streak > maxStreak) maxStreak = streak;
        } else {
          streak = 1;
        }
      }
      expect(maxStreak).toBeLessThanOrEqual(2);
    });

    it('preserves linear queue cursor progression when duplicate track IDs exist in queue', async () => {
      const trackA = CATALOGUE_16[0];
      const trackB = CATALOGUE_16[1];
      const trackC = CATALOGUE_16[2];

      const testQueue = [trackA, trackB, trackA, trackC];

      // Set queue
      usePlayerStore.getState().setQueue(testQueue);
      expect(usePlayerStore.getState().queue.length).toBe(4);

      // Play index 2 (second instance of trackA)
      usePlayerStore.getState().playTrack(testQueue[2], testQueue, 2);
      expect(usePlayerStore.getState().currentTrackIndex).toBe(2);
      expect(usePlayerStore.getState().currentTrack?.id).toBe(trackA.id);

      // Calling nextTrack advances to index 3 (trackC), NOT jumping backward to index 1
      await usePlayerStore.getState().nextTrack();
      expect(usePlayerStore.getState().currentTrackIndex).toBe(3);
      expect(usePlayerStore.getState().currentTrack?.id).toBe(trackC.id);

      // Calling previousTrack with queue navigation retreats by numerical index to index 2 (second instance of trackA)
      usePlayerStore.setState({ history: [] }); // Test queue-based retreat
      await usePlayerStore.getState().previousTrack();
      expect(usePlayerStore.getState().currentTrackIndex).toBe(2);
      expect(usePlayerStore.getState().currentTrack?.id).toBe(trackA.id);
    });
  });
});

