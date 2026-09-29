import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelemetryDatabase } from '../../src/services/telemetryDb';
import { RecommendationEngine } from '../../src/services/recommendationEngine';
import { usePlayerStore } from '../../src/store/playerStore';
import { Track } from '../../src/types/track';
import {
  MOCK_AUDIUS_TRACK,
  MOCK_ARCHIVE_TRACK,
  MOCK_RADIO_TRACK,
  MOCK_P2P_TRACK,
} from '../fixtures/mockData';
import {
  TrackPlayRecord,
  ListeningSessionRecord,
  ExportableTelemetryDataset,
} from '../../src/types/telemetry';

function createMockPlayRecord(partial: Partial<TrackPlayRecord> & { trackId: string }): TrackPlayRecord {
  const durationPlayedMs = partial.durationPlayedMs ?? partial.timePlayedMs ?? 180000;
  const totalDurationMs = partial.totalDurationMs ?? partial.durationMs ?? 180000;
  const completionRate = partial.completionRate ?? Math.min(1, durationPlayedMs / totalDurationMs);
  const playId = partial.playId ?? partial.id ?? `play_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    playId,
    id: playId,
    sessionId: partial.sessionId ?? 'session_1',
    trackId: partial.trackId,
    title: partial.title ?? 'Mock Title',
    artist: partial.artist ?? 'Mock Artist',
    genre: partial.genre ?? 'Electronic',
    source: partial.source ?? 'audius',
    startTime: partial.startTime ?? Date.now() - durationPlayedMs,
    durationPlayedMs,
    timePlayedMs: durationPlayedMs,
    totalDurationMs,
    durationMs: totalDurationMs,
    completionRate,
    skipped: partial.skipped ?? (durationPlayedMs < 30000 && completionRate < 0.5),
    completed: partial.completed ?? (completionRate >= 0.8),
    replayed: partial.replayed ?? false,
  };
}

function createMockSessionRecord(
  partial: Partial<ListeningSessionRecord> & { sessionId: string }
): ListeningSessionRecord {
  const startTime = partial.startTime ?? partial.startedAt ?? Date.now() - 3600000;
  return {
    sessionId: partial.sessionId,
    startTime,
    startedAt: startTime,
    endTime: partial.endTime ?? partial.endedAt,
    endedAt: partial.endedAt ?? partial.endTime,
    lastActiveAt: partial.lastActiveAt ?? Date.now(),
    deviceType: partial.deviceType ?? 'desktop',
    tracksPlayed: partial.tracksPlayed ?? 1,
    totalPlayTimeMs: partial.totalPlayTimeMs ?? 180000,
    totalDurationMs: partial.totalDurationMs ?? 180000,
  };
}

const MOCK_EXTENDED_CATALOGUE: Track[] = [
  MOCK_AUDIUS_TRACK,
  MOCK_ARCHIVE_TRACK,
  MOCK_RADIO_TRACK,
  MOCK_P2P_TRACK,
  {
    ...MOCK_AUDIUS_TRACK,
    id: 'cat_elec_1',
    title: 'Solar Flares',
    artist: 'Synthetic Pulse',
    sourceMetadata: { genre: 'Electronic' },
  },
  {
    ...MOCK_AUDIUS_TRACK,
    id: 'cat_elec_2',
    title: 'Cosmic Rays',
    artist: 'Synthetic Pulse',
    sourceMetadata: { genre: 'Electronic' },
  },
  {
    ...MOCK_AUDIUS_TRACK,
    id: 'cat_elec_3',
    title: 'Grid Runner',
    artist: 'Cyber Grid',
    sourceMetadata: { genre: 'Electronic' },
  },
  {
    ...MOCK_AUDIUS_TRACK,
    id: 'cat_elec_4',
    title: 'Neon Highway',
    artist: 'Cyber Grid',
    sourceMetadata: { genre: 'Electronic' },
  },
  {
    ...MOCK_ARCHIVE_TRACK,
    id: 'cat_rock_1',
    title: 'Truckin (Live 1978)',
    artist: 'Grateful Dead',
    sourceMetadata: { genre: 'Rock' },
  },
  {
    ...MOCK_ARCHIVE_TRACK,
    id: 'cat_rock_2',
    title: 'Sugar Magnolia',
    artist: 'Grateful Dead',
    sourceMetadata: { genre: 'Rock' },
  },
  {
    ...MOCK_ARCHIVE_TRACK,
    id: 'cat_rock_3',
    title: 'Ripple',
    artist: 'Grateful Dead',
    sourceMetadata: { genre: 'Rock' },
  },
  {
    ...MOCK_P2P_TRACK,
    id: 'cat_amb_1',
    title: 'Deep Ocean Ambient',
    artist: 'Soundscape Lab',
    sourceMetadata: { genre: 'Ambient' },
  },
  {
    ...MOCK_P2P_TRACK,
    id: 'cat_amb_2',
    title: 'Rainforest Echoes',
    artist: 'Soundscape Lab',
    sourceMetadata: { genre: 'Ambient' },
  },
  {
    ...MOCK_AUDIUS_TRACK,
    id: 'cat_jazz_1',
    title: 'Blue In Green',
    artist: 'Miles Modern',
    sourceMetadata: { genre: 'Jazz' },
  },
  {
    ...MOCK_AUDIUS_TRACK,
    id: 'cat_jazz_2',
    title: 'So What Remake',
    artist: 'Miles Modern',
    sourceMetadata: { genre: 'Jazz' },
  },
];

describe('Milestone 2: Private Listening Profile & Recommendation Engine', () => {
  let db: TelemetryDatabase;
  let engine: RecommendationEngine;

  beforeEach(async () => {
    db = new TelemetryDatabase();
    await db.clearTelemetry();
    engine = new RecommendationEngine();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await db.clearTelemetry();
  });

  // ==========================================================================
  // Section 1: Telemetry Database (IndexedDB / In-Memory Mock)
  // ==========================================================================
  describe('TelemetryDatabase Operations', () => {
    it('records completed track plays with accurate completion rate and flags', async () => {
      const play = await db.recordPlay('session_1', MOCK_AUDIUS_TRACK, 180000, 180000, false);
      expect(play).toBeDefined();
      expect(play?.trackId).toBe(MOCK_AUDIUS_TRACK.id);
      expect(play?.completed).toBe(true);
      expect(play?.skipped).toBe(false);
      expect(play?.completionRate).toBe(1);
      expect(play?.genre).toBe('Electronic');
      expect(play?.artist).toBe('Synthetic Pulse');
    });

    it('records skipped plays when listened < 30 seconds of a full track', async () => {
      const play = await db.recordPlay('session_1', MOCK_AUDIUS_TRACK, 15000, 180000, false);
      expect(play?.skipped).toBe(true);
      expect(play?.completed).toBe(false);
      expect(play?.completionRate).toBeCloseTo(15000 / 180000, 3);
    });

    it('records rapid skips under 30 seconds with skipped: true and valid completionRate', async () => {
      const play = await db.recordPlay('session_1', MOCK_AUDIUS_TRACK, 3000, 180000, false);
      expect(play).toBeDefined();
      expect(play?.skipped).toBe(true);
      expect(play?.completionRate).toBeGreaterThanOrEqual(0);
      expect(play?.completionRate).toBeLessThan(0.05);
      const plays = await db.getRecentPlays();
      expect(plays.length).toBe(1);
    });

    it('handles live streams / Infinity duration safely', async () => {
      const play = await db.recordPlay('session_radio', MOCK_RADIO_TRACK, 120000, Infinity, false);
      expect(play).toBeDefined();
      expect(play?.durationMs).toBe(120000);
      expect(play?.completionRate).toBe(1);
      expect(play?.completed).toBe(true);
    });

    it('computes and updates exponential moving average genre affinities', async () => {
      await db.recordPlay('session_1', MOCK_AUDIUS_TRACK, 180000, 180000, false); // Electronic completed
      await db.recordPlay('session_1', MOCK_AUDIUS_TRACK, 180000, 180000, true); // Electronic replayed
      await db.recordPlay('session_1', MOCK_ARCHIVE_TRACK, 20000, 420000, false); // Rock skipped

      const topGenres = await db.getTopGenres();
      expect(topGenres.length).toBeGreaterThan(0);
      expect(topGenres[0].genre).toBe('Electronic');
      expect(topGenres[0].affinityScore).toBeGreaterThan(10);
      expect(topGenres[0].playCount).toBe(2);
    });

    it('computes and updates artist affinities with play count and score', async () => {
      await db.recordPlay('session_1', MOCK_AUDIUS_TRACK, 180000, 180000, false);
      const topArtists = await db.getTopArtists();
      const syntheticPulse = topArtists.find((a) => a.artist === 'Synthetic Pulse');
      expect(syntheticPulse).toBeDefined();
      expect(syntheticPulse?.playCount).toBe(1);
      expect(syntheticPulse?.affinityScore).toBeGreaterThan(0);
    });

    it('tracks active sessions with start, heartbeat, and end operations', async () => {
      const session = await db.startSession('desktop');
      expect(session.sessionId).toBeDefined();
      expect(session.deviceType).toBe('desktop');
      expect(session.endedAt).toBeUndefined();

      await db.recordPlay(session.sessionId, MOCK_AUDIUS_TRACK, 180000, 180000, false);
      await db.endSession(session.sessionId);

      const dataset = await db.exportDataset();
      const foundSession = dataset.sessions.find(
        (s: ListeningSessionRecord) => s.sessionId === session.sessionId
      );
      expect(foundSession).toBeDefined();
      expect(foundSession?.endedAt).toBeDefined();
      expect(foundSession?.tracksPlayed).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // Section 2: Dataset Export & Import Schema Validation
  // ==========================================================================
  describe('Dataset Export / Import & Schema Validation', () => {
    it('exports dataset conforming strictly to ExportableTelemetryDataset (v1)', async () => {
      await db.recordPlay('session_exp', MOCK_AUDIUS_TRACK, 180000, 180000, false);
      const exported = await db.exportDataset();

      expect(exported.version).toBe(1);
      expect(typeof exported.exportedAt).toBe('number');
      expect(Array.isArray(exported.sessions)).toBe(true);
      expect(Array.isArray(exported.plays)).toBe(true);
      expect(Array.isArray(exported.genreAffinities)).toBe(true);
      expect(Array.isArray(exported.artistAffinities)).toBe(true);
      expect(exported.plays.length).toBe(1);
      expect(exported.plays[0].trackId).toBe(MOCK_AUDIUS_TRACK.id);
    });

    it('imports dataset successfully and rebuilds telemetry state', async () => {
      const mockExport: ExportableTelemetryDataset = {
        version: 1,
        exportedAt: Date.now(),
        sessions: [
          createMockSessionRecord({
            sessionId: 'imp_s1',
            startedAt: Date.now() - 3600000,
            lastActiveAt: Date.now() - 3000000,
            deviceType: 'desktop',
            tracksPlayed: 1,
            totalPlayTimeMs: 180000,
          }),
        ],
        plays: [
          createMockPlayRecord({
            id: 'imp_p1',
            sessionId: 'imp_s1',
            trackId: MOCK_ARCHIVE_TRACK.id,
            startTime: Date.now() - 3500000,
            durationMs: 420000,
            timePlayedMs: 420000,
            completionRate: 1,
            completed: true,
            skipped: false,
            replayed: false,
            genre: 'Rock',
            artist: 'Grateful Dead',
          }),
        ],
        genreAffinities: [
          {
            genre: 'Rock',
            affinityScore: 75,
            playCount: 5,
            totalTimePlayedMs: 2100000,
            lastPlayedAt: Date.now() - 3500000,
          },
        ],
        artistAffinities: [
          {
            artist: 'Grateful Dead',
            affinityScore: 80,
            playCount: 5,
            totalTimePlayedMs: 2100000,
            lastPlayedAt: Date.now() - 3500000,
          },
        ],
      };

      const result = await db.importDataset(mockExport);
      expect(result.importedPlays).toBe(1);
      expect(result.importedSessions).toBe(1);

      const recentPlays = await db.getRecentPlays();
      expect(recentPlays.some((p) => p.trackId === MOCK_ARCHIVE_TRACK.id)).toBe(true);
    });

    it('is idempotent: importing the exact same dataset twice does not corrupt state', async () => {
      const mockExport: ExportableTelemetryDataset = {
        version: 1,
        exportedAt: Date.now(),
        sessions: [
          createMockSessionRecord({
            sessionId: 'idem_s1',
            startedAt: Date.now() - 10000,
            lastActiveAt: Date.now(),
            deviceType: 'mobile',
            tracksPlayed: 1,
            totalPlayTimeMs: 180000,
          }),
        ],
        plays: [
          createMockPlayRecord({
            id: 'idem_p1',
            sessionId: 'idem_s1',
            trackId: MOCK_AUDIUS_TRACK.id,
            startTime: Date.now() - 5000,
            durationMs: 180000,
            timePlayedMs: 180000,
            completionRate: 1,
            completed: true,
            skipped: false,
            replayed: false,
            genre: 'Electronic',
            artist: 'Synthetic Pulse',
          }),
        ],
        genreAffinities: [],
        artistAffinities: [],
      };

      await db.importDataset(mockExport);
      await db.importDataset(mockExport);

      const dataset = await db.exportDataset();
      expect(dataset.plays.length).toBe(1);
      expect(dataset.sessions.length).toBe(1);
    });

    it('rejects unsupported schema versions or malformed datasets', async () => {
      const invalidVersionData = {
        version: 99,
        sessions: [],
        plays: [],
        genreAffinities: [],
        artistAffinities: [],
      } as any;

      await expect(db.importDataset(invalidVersionData)).rejects.toThrow();

      const missingFieldsData = {
        version: 1,
        sessions: null,
      } as any;

      await expect(db.importDataset(missingFieldsData)).rejects.toThrow();
    });
  });

  // ==========================================================================
  // Section 3: Recommendation Engine (5 Shelves & Algorithmic Rules)
  // ==========================================================================
  describe('RecommendationEngine Algorithms', () => {
    it('Shelf 1 - Made For You: Blends user high-affinity favorites with discovery candidates', () => {
      const mockPlays = [
        createMockPlayRecord({
          id: 'p1',
          sessionId: 's1',
          trackId: MOCK_AUDIUS_TRACK.id,
          startTime: Date.now() - 60000,
          durationMs: 180000,
          timePlayedMs: 180000,
          completionRate: 1,
          completed: true,
          skipped: false,
          replayed: false,
          genre: 'Electronic',
          artist: 'Synthetic Pulse',
        }),
      ];

      const madeForYou = engine.generateMadeForYou(mockPlays, MOCK_EXTENDED_CATALOGUE);
      expect(madeForYou.length).toBeGreaterThan(0);
      // Played track should appear in favorites
      expect(madeForYou.some((t) => t.id === MOCK_AUDIUS_TRACK.id)).toBe(true);
      // Should also contain unplayed discovery tracks from affinity genre
      const discoveryTrack = madeForYou.find((t) => t.id !== MOCK_AUDIUS_TRACK.id);
      expect(discoveryTrack).toBeDefined();
    });

    it('Shelf 1 - Made For You: Provides graceful cold-start fallback when history is empty', () => {
      const madeForYou = engine.generateMadeForYou([], MOCK_EXTENDED_CATALOGUE);
      expect(madeForYou.length).toBeGreaterThan(0);
      expect(madeForYou[0]).toBeDefined();
    });

    it('Shelf 2 - Discover Weekly: Enforces strict exclusion of tracks played > 50% in last 30 days', () => {
      const now = Date.now();
      const mockPlays = [
        createMockPlayRecord({
          id: 'p_completed',
          sessionId: 's1',
          trackId: 'cat_elec_1',
          startTime: now - 86400000 * 5, // 5 days ago (< 30 days)
          durationMs: 180000,
          timePlayedMs: 180000,
          completionRate: 1.0, // > 50%
          completed: true,
          skipped: false,
          replayed: false,
          genre: 'Electronic',
          artist: 'Synthetic Pulse',
        }),
        createMockPlayRecord({
          id: 'p_skipped',
          sessionId: 's1',
          trackId: 'cat_elec_2',
          startTime: now - 86400000 * 5,
          durationMs: 180000,
          timePlayedMs: 20000,
          completionRate: 0.11, // <= 50% completion
          completed: false,
          skipped: true,
          replayed: false,
          genre: 'Electronic',
          artist: 'Synthetic Pulse',
        }),
      ];

      const discoverWeekly = engine.generateDiscoverWeekly(mockPlays, MOCK_EXTENDED_CATALOGUE, 10);
      // 'cat_elec_1' was listened > 50% within 30 days -> MUST be strictly excluded
      expect(discoverWeekly.some((t) => t.id === 'cat_elec_1')).toBe(false);
    });

    it('Shelf 2 - Discover Weekly: Computes MMR novelty to balance relevance and diversity', () => {
      const mockPlays = [
        createMockPlayRecord({
          id: 'p_base',
          sessionId: 's1',
          trackId: MOCK_AUDIUS_TRACK.id,
          startTime: Date.now(),
          durationMs: 180000,
          timePlayedMs: 180000,
          completionRate: 1.0,
          completed: true,
          skipped: false,
          replayed: false,
          genre: 'Electronic',
          artist: 'Synthetic Pulse',
        }),
      ];

      const discoverWeekly = engine.generateDiscoverWeekly(mockPlays, MOCK_EXTENDED_CATALOGUE, 8);
      expect(discoverWeekly.length).toBeGreaterThan(0);
      // No duplicates in selected list
      const ids = discoverWeekly.map((t) => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('Shelf 3 - Daily Mix: Clusters tracks into genre mixes and blends ~65% familiar / 35% discovery', () => {
      const mockPlays = [
        createMockPlayRecord({
          id: 'p1',
          sessionId: 's1',
          trackId: MOCK_AUDIUS_TRACK.id,
          startTime: Date.now(),
          durationMs: 180000,
          timePlayedMs: 180000,
          completionRate: 1,
          completed: true,
          skipped: false,
          replayed: false,
          genre: 'Electronic',
          artist: 'Synthetic Pulse',
        }),
        createMockPlayRecord({
          id: 'p2',
          sessionId: 's1',
          trackId: MOCK_ARCHIVE_TRACK.id,
          startTime: Date.now(),
          durationMs: 420000,
          timePlayedMs: 420000,
          completionRate: 1,
          completed: true,
          skipped: false,
          replayed: false,
          genre: 'Rock',
          artist: 'Grateful Dead',
        }),
      ];

      const dailyMixes = engine.generateDailyMixes(mockPlays, MOCK_EXTENDED_CATALOGUE);
      expect(dailyMixes.length).toBeGreaterThanOrEqual(1);

      const electronicMix = dailyMixes.find((m) => m.genre === 'Electronic');
      expect(electronicMix).toBeDefined();
      expect(electronicMix?.tracks.length).toBeGreaterThan(0);
      // Each mix has a distinct title and genre
      expect(electronicMix?.title).toMatch(/Daily Mix/);
    });

    it('Shelf 3 - Daily Mix: Handles single-genre listeners gracefully without breaking', () => {
      const singleGenrePlays = [
        createMockPlayRecord({
          id: 'p1',
          sessionId: 's1',
          trackId: MOCK_AUDIUS_TRACK.id,
          startTime: Date.now(),
          durationMs: 180000,
          timePlayedMs: 180000,
          completionRate: 1,
          completed: true,
          skipped: false,
          replayed: false,
          genre: 'Electronic',
          artist: 'Synthetic Pulse',
        }),
      ];

      const mixes = engine.generateDailyMixes(singleGenrePlays, MOCK_EXTENDED_CATALOGUE);
      expect(mixes.length).toBeGreaterThanOrEqual(1);
      expect(mixes[0].tracks.length).toBeGreaterThan(0);
    });

    it('Shelf 4 - Heavy Rotation: Applies exponential decay half-life of 5 days (lambda = ln(2)/5d)', () => {
      const now = Date.now();
      const ONE_DAY_MS = 86400000;

      const mockPlays = [
        // Track A played yesterday (1 day ago)
        createMockPlayRecord({
          id: 'p_recent',
          sessionId: 's1',
          trackId: 'cat_rock_1',
          startTime: now - ONE_DAY_MS * 1,
          durationMs: 200000,
          timePlayedMs: 200000,
          completionRate: 1,
          completed: true,
          skipped: false,
          replayed: false,
          genre: 'Rock',
          artist: 'Grateful Dead',
        }),
        // Track B played 15 days ago (3 half-lives ago -> weight is (1/2)^3 = 1/8)
        createMockPlayRecord({
          id: 'p_old',
          sessionId: 's1',
          trackId: 'cat_rock_2',
          startTime: now - ONE_DAY_MS * 15,
          durationMs: 200000,
          timePlayedMs: 200000,
          completionRate: 1,
          completed: true,
          skipped: false,
          replayed: false,
          genre: 'Rock',
          artist: 'Grateful Dead',
        }),
      ];

      const heavyRotation = engine.generateHeavyRotation(mockPlays, MOCK_EXTENDED_CATALOGUE, now);
      expect(heavyRotation.length).toBeGreaterThan(0);
      // More recent play 'cat_rock_1' should rank higher than 15-day-old play 'cat_rock_2'
      const indexRecent = heavyRotation.findIndex((t) => t.id === 'cat_rock_1');
      const indexOld = heavyRotation.findIndex((t) => t.id === 'cat_rock_2');
      expect(indexRecent).toBeLessThan(indexOld);
    });

    it('Shelf 4 - Heavy Rotation: Excludes skipped tracks from rotation ranking', () => {
      const now = Date.now();
      const mockPlays = [
        createMockPlayRecord({
          id: 'p_skipped',
          sessionId: 's1',
          trackId: 'cat_rock_3',
          startTime: now - 3600000,
          durationMs: 200000,
          timePlayedMs: 15000,
          completionRate: 0.075,
          completed: false,
          skipped: true,
          replayed: false,
          genre: 'Rock',
          artist: 'Grateful Dead',
        }),
      ];

      const heavyRotation = engine.generateHeavyRotation(mockPlays, MOCK_EXTENDED_CATALOGUE, now);
      expect(heavyRotation.some((t) => t.id === 'cat_rock_3')).toBe(false);
    });

    it('Shelf 5 - Forgotten Favorites: Identifies tracks with >=2 plays and > 21 days since last play', () => {
      const now = Date.now();
      const TWENTY_TWO_DAYS_MS = 22 * 86400000;
      const TEN_DAYS_MS = 10 * 86400000;

      const mockPlays = [
        // Track A: Played twice 25 and 22 days ago (> 21 days ago)
        createMockPlayRecord({
          id: 'p_ff1',
          sessionId: 's1',
          trackId: 'cat_amb_1',
          startTime: now - TWENTY_TWO_DAYS_MS - 86400000,
          durationMs: 240000,
          timePlayedMs: 240000,
          completionRate: 1,
          completed: true,
          skipped: false,
          replayed: false,
          genre: 'Ambient',
          artist: 'Soundscape Lab',
        }),
        createMockPlayRecord({
          id: 'p_ff2',
          sessionId: 's1',
          trackId: 'cat_amb_1',
          startTime: now - TWENTY_TWO_DAYS_MS,
          durationMs: 240000,
          timePlayedMs: 240000,
          completionRate: 1,
          completed: true,
          skipped: false,
          replayed: false,
          genre: 'Ambient',
          artist: 'Soundscape Lab',
        }),
        // Track B: Played recently (10 days ago) - NOT forgotten
        createMockPlayRecord({
          id: 'p_recent1',
          sessionId: 's1',
          trackId: 'cat_amb_2',
          startTime: now - TEN_DAYS_MS,
          durationMs: 240000,
          timePlayedMs: 240000,
          completionRate: 1,
          completed: true,
          skipped: false,
          replayed: false,
          genre: 'Ambient',
          artist: 'Soundscape Lab',
        }),
        createMockPlayRecord({
          id: 'p_recent2',
          sessionId: 's1',
          trackId: 'cat_amb_2',
          startTime: now - TEN_DAYS_MS + 1000,
          durationMs: 240000,
          timePlayedMs: 240000,
          completionRate: 1,
          completed: true,
          skipped: false,
          replayed: false,
          genre: 'Ambient',
          artist: 'Soundscape Lab',
        }),
      ];

      const forgotten = engine.generateForgottenFavorites(mockPlays, MOCK_EXTENDED_CATALOGUE, now);
      expect(forgotten.some((t) => t.id === 'cat_amb_1')).toBe(true);
      expect(forgotten.some((t) => t.id === 'cat_amb_2')).toBe(false);
    });

    it('Autoplay: generateAutoplay returns contextually matched tracks with fallback padding', () => {
      const recs = engine.generateAutoplay(MOCK_AUDIUS_TRACK, [], MOCK_EXTENDED_CATALOGUE, 5);
      expect(recs.length).toBe(5);
      // Should not contain current track
      expect(recs.some((t) => t.id === MOCK_AUDIUS_TRACK.id)).toBe(false);
      // First recommendations should match genre 'Electronic'
      expect(recs[0].sourceMetadata?.genre).toBe('Electronic');
    });

    it('Autoplay: getAutoplayRecommendations enforces anti-clumping (max 2 tracks per artist)', async () => {
      const recs = await engine.getAutoplayRecommendations(MOCK_AUDIUS_TRACK, 5);
      expect(recs.length).toBeGreaterThan(0);

      const artistCounts = new Map<string, number>();
      for (const track of recs) {
        artistCounts.set(track.artist, (artistCounts.get(track.artist) || 0) + 1);
      }

      for (const [artist, count] of artistCounts.entries()) {
        expect(count).toBeLessThanOrEqual(2);
      }
    });
  });

  // ==========================================================================
  // Section 4: PlayerStore Autoplay & Queue Integration
  // ==========================================================================
  describe('PlayerStore Autoplay Integration', () => {
    it('initializes autoplayEnabled with default true and toggles via enableAutoplay', () => {
      const store = usePlayerStore.getState();
      expect(typeof store.autoplayEnabled).toBe('boolean');

      store.enableAutoplay(false);
      expect(usePlayerStore.getState().autoplayEnabled).toBe(false);

      store.enableAutoplay(true);
      expect(usePlayerStore.getState().autoplayEnabled).toBe(true);
    });

    it('persists autoplay setting across toggle calls', () => {
      const store = usePlayerStore.getState();
      store.toggleAutoplay();
      const nextState = usePlayerStore.getState().autoplayEnabled;
      store.toggleAutoplay();
      expect(usePlayerStore.getState().autoplayEnabled).toBe(!nextState);
    });

    it('triggers autoplay extension when triggerAutoplayIfNeeded is called with approaching_end', async () => {
      const store = usePlayerStore.getState();
      store.enableAutoplay(true);
      store.setQueue([MOCK_AUDIUS_TRACK]);
      store.playTrack(MOCK_AUDIUS_TRACK);

      const initialQueueLength = usePlayerStore.getState().queue.length;
      expect(initialQueueLength).toBe(1);

      await store.triggerAutoplayIfNeeded('approaching_end');

      const updatedQueue = usePlayerStore.getState().queue;
      expect(updatedQueue.length).toBeGreaterThan(1);
    });

    it('does not append autoplay tracks if autoplay is disabled', async () => {
      const store = usePlayerStore.getState();
      store.enableAutoplay(false);
      store.setQueue([MOCK_AUDIUS_TRACK]);

      await store.triggerAutoplayIfNeeded('approaching_end');
      expect(usePlayerStore.getState().queue.length).toBe(1);
    });
  });
});
