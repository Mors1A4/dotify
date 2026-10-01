import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelemetryDatabase } from '../../src/services/telemetryDb';
import { RecommendationEngine } from '../../src/services/recommendationEngine';
import {
  isFavouredOrigin,
  isExploratoryOrigin,
  isUserFavouredPlay,
  getIntentWeight,
  classifyListeningRecord,
} from '../../src/services/listeningClassifier';
import { Track } from '../../src/types/track';
import { TrackPlayRecord, PlayOrigin, UserListeningContext } from '../../src/types/telemetry';

function createMockTrack(
  id: string,
  artist: string,
  title: string,
  genre = 'Indie Pop',
  duration = 200
): Track {
  return {
    id,
    source: 'audius',
    title,
    artist,
    album: 'Test Album',
    duration,
    streamUrl: `http://localhost:3000/stream/${id}.mp3`,
    artworkUrl: `http://localhost:3000/art/${id}.jpg`,
    sourceMetadata: {
      format: 'mp3',
      genre,
    },
  };
}

function createMockPlay(
  partial: Partial<TrackPlayRecord> & { trackId: string; artist: string }
): TrackPlayRecord {
  const durationPlayedMs = partial.durationPlayedMs ?? 180000;
  const totalDurationMs = partial.totalDurationMs ?? 180000;
  const completionRate = partial.completionRate ?? 1.0;
  return {
    playId: partial.playId ?? `play_${Math.random().toString(36).slice(2, 7)}`,
    id: partial.id ?? partial.playId ?? `play_${Math.random().toString(36).slice(2, 7)}`,
    sessionId: partial.sessionId ?? 'session_1',
    trackId: partial.trackId,
    title: partial.title ?? 'Mock Track',
    artist: partial.artist,
    genre: partial.genre ?? 'Pop',
    source: partial.source ?? 'audius',
    startTime: partial.startTime ?? Date.now(),
    playedAt: partial.playedAt ?? partial.startTime ?? Date.now(),
    durationPlayedMs,
    timePlayedMs: durationPlayedMs,
    totalDurationMs,
    durationMs: totalDurationMs,
    completionRate,
    skipped: partial.skipped ?? false,
    completed: partial.completed ?? true,
    replayed: partial.replayed ?? false,
    userLiked: partial.userLiked,
    artworkUrl: partial.artworkUrl ?? 'https://example.com/artwork.jpg',
    origin: partial.origin,
    intent: partial.intent,
    intentWeight: partial.intentWeight,
    searchQuery: partial.searchQuery,
  };
}

describe('Listening Classification & Intent-Weighted Recommendations Suite', () => {
  let db: TelemetryDatabase;
  let engine: RecommendationEngine;

  beforeEach(async () => {
    db = TelemetryDatabase.getInstance();
    await db.clearTelemetry();
    engine = RecommendationEngine.getInstance();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await db.clearTelemetry();
  });

  // =========================================================================
  // 1. CLASSIFIER LOGIC & INTENT WEIGHTING
  // =========================================================================
  describe('1. listeningClassifier Unit Tests', () => {
    it('accurately identifies favoured vs exploratory play origins', () => {
      const favouredOrigins: PlayOrigin[] = ['search', 'artist', 'song', 'library', 'user_playlist'];
      const exploratoryOrigins: PlayOrigin[] = [
        'vibe_playlist',
        'discover_track',
        'discover_weekly',
        'autoplay',
        'radio',
        'recommendation',
        'charts',
      ];

      for (const origin of favouredOrigins) {
        expect(isFavouredOrigin(origin)).toBe(true);
        expect(isExploratoryOrigin(origin)).toBe(false);
      }

      for (const origin of exploratoryOrigins) {
        expect(isExploratoryOrigin(origin)).toBe(true);
        expect(isFavouredOrigin(origin)).toBe(false);
      }

      expect(isFavouredOrigin('unknown')).toBe(false);
      expect(isExploratoryOrigin('unknown')).toBe(false);
    });

    it('classifies passive exploratory plays as non-favoured', () => {
      const exploratoryPlay: Partial<TrackPlayRecord> = {
        trackId: 't1',
        origin: 'vibe_playlist',
        intent: 'exploratory',
        replayed: false,
        userLiked: false,
      };

      expect(isUserFavouredPlay(exploratoryPlay)).toBe(false);
      expect(getIntentWeight(exploratoryPlay)).toBeLessThan(0.5);
    });

    it('elevates exploratory play to favoured if track was replayed', () => {
      const replayedVibePlay: Partial<TrackPlayRecord> = {
        trackId: 't1',
        origin: 'vibe_playlist',
        intent: 'exploratory',
        replayed: true,
      };

      expect(isUserFavouredPlay(replayedVibePlay)).toBe(true);
      expect(getIntentWeight(replayedVibePlay)).toBeGreaterThanOrEqual(1.0);
    });

    it('elevates exploratory play if track was liked or in user context', () => {
      const likedVibePlay: Partial<TrackPlayRecord> = {
        trackId: 't1',
        artist: 'The National',
        origin: 'discover_track',
        intent: 'exploratory',
        userLiked: true,
      };
      expect(isUserFavouredPlay(likedVibePlay)).toBe(true);

      const userCtx: UserListeningContext = {
        likedTrackIds: new Set(['t2']),
        followedArtists: new Set(['the national']),
        playlistTrackIds: new Set(),
      };

      const unlikedPlayFromFollowedArtist: Partial<TrackPlayRecord> = {
        trackId: 't3',
        artist: 'The National',
        origin: 'vibe_playlist',
        intent: 'exploratory',
        userLiked: false,
        replayed: false,
      };
      expect(isUserFavouredPlay(unlikedPlayFromFollowedArtist, userCtx)).toBe(true);
    });

    it('migrates and classifies legacy unclassified records with context', () => {
      const legacyRecord = createMockPlay({
        id: 'rec_1',
        sessionId: 'sess_1',
        trackId: 't10',
        artist: 'Phoebe Bridgers',
        title: 'Kyoto',
        genre: 'Indie',
        startTime: Date.now() - 50000,
        playedAt: Date.now() - 50000,
        durationPlayedMs: 180000,
        totalDurationMs: 180000,
        completed: true,
        replayed: false,
        source: 'audius',
      });

      const userCtx: UserListeningContext = {
        likedTrackIds: new Set(['t10']),
        followedArtists: new Set(['phoebe bridgers']),
        playlistTrackIds: new Set(),
      };

      const classified = classifyListeningRecord(legacyRecord, userCtx);
      expect(classified.intent).toBe('favoured');
      expect(classified.intentWeight).toBeGreaterThanOrEqual(1.0);
    });
  });

  // =========================================================================
  // 2. TELEMETRY DATABASE: INTENT PERSISTENCE & AFFINITY SCALING
  // =========================================================================
  describe('2. Telemetry Database & Intent-Weighted Affinity', () => {
    it('persists origin, intent, and search query on recordPlay', async () => {
      const track = createMockTrack('track_search_1', 'Radiohead', 'Karma Police', 'Alternative');

      await db.recordPlay('session_1', track, 180000, 180000, false, {
        origin: 'search',
        searchQuery: 'radiohead karma',
      });

      const plays = await db.getAllPlays();
      expect(plays.length).toBe(1);
      const play = plays[0];
      expect(play.origin).toBe('search');
      expect(play.intent).toBe('favoured');
      expect(play.intentWeight).toBe(1.0);
      expect(play.searchQuery).toBe('radiohead karma');
    });

    it('scales artist and genre affinity by interaction intent (favoured > exploratory)', async () => {
      const exploratoryArtistTrack = createMockTrack('vibe_track_1', 'Vibe Background Artist', 'Chill Waves', 'Chillout');
      const favouredArtistTrack = createMockTrack('search_track_1', 'Searched Idol', 'Favorite Song', 'Chillout');

      // Record 6 plays of the Vibe Background Artist from a vibe playlist (passive)
      for (let i = 0; i < 6; i++) {
        await db.recordPlay(`sess_v_${i}`, exploratoryArtistTrack, 180000, 180000, false, {
          origin: 'vibe_playlist',
          playlistId: 'vibe_chill_123',
        });
      }

      // Record 6 plays of the Searched Idol from direct search clicks (favoured)
      for (let i = 0; i < 6; i++) {
        await db.recordPlay(`sess_s_${i}`, favouredArtistTrack, 180000, 180000, false, {
          origin: 'search',
          searchQuery: 'searched idol',
        });
      }

      const affinities = await db.getAllArtistAffinities();
      const vibeAffinity = affinities.find((a) => a.artist.toLowerCase() === 'vibe background artist');
      const searchAffinity = affinities.find((a) => a.artist.toLowerCase() === 'searched idol');

      expect(vibeAffinity).toBeDefined();
      expect(searchAffinity).toBeDefined();

      // Even though both have 6 plays, the favoured artist must have a much higher affinity score!
      expect(searchAffinity!.affinityScore).toBeGreaterThan(vibeAffinity!.affinityScore * 2);
      expect(searchAffinity!.favouredPlayCount).toBe(6);
      expect(vibeAffinity!.passivePlayCount).toBe(6);
    });

    it('classifyPastPlays correctly retroactively classifies unclassified plays in DB', async () => {
      const track = createMockTrack('old_t1', 'Old Favorite', 'Retro Song');

      // Seed exploratory vibe play directly
      await db.recordPlay('legacy_session', track, 180000, 180000, false, {
        origin: 'vibe_playlist',
      });

      const initialPlays = await db.getAllPlays();
      expect(initialPlays.length).toBe(1);
      expect(initialPlays[0].intent).toBe('exploratory');

      // Now run classifyPastPlays with user context indicating this artist is followed
      const userCtx: UserListeningContext = {
        likedTrackIds: new Set(['old_t1']),
        followedArtists: new Set(['old favorite']),
        playlistTrackIds: new Set(),
      };

      const updatedCount = await db.classifyPastPlays(userCtx);
      expect(updatedCount).toBeGreaterThanOrEqual(1);

      const migratedPlays = await db.getAllPlays();
      expect(migratedPlays[0].intent).toBe('favoured');
      expect(migratedPlays[0].intentWeight).toBe(1.0);
    });
  });

  // =========================================================================
  // 3. RECOMMENDATION ENGINE INTEGRATION: PREVENTING VIBE/DISCOVER SPOOFING
  // =========================================================================
  describe('3. Recommendation Engine Intent Filtering', () => {
    const artistFavoured = 'Direct Pick Star';
    const artistPassive = 'Random Vibe Filler';

    const tFav1 = createMockTrack('tf_1', artistFavoured, 'Star Hit', 'Pop');
    const tFav2 = createMockTrack('tf_2', artistFavoured, 'Star Ballad', 'Pop');
    const tPas1 = createMockTrack('tp_1', artistPassive, 'Background Noise 1', 'Pop');
    const tPas2 = createMockTrack('tp_2', artistPassive, 'Background Noise 2', 'Pop');

    const catalogue: Track[] = [tFav1, tFav2, tPas1, tPas2];

    it('generateMadeForYou prioritizes user-favoured artist over vibe playlist artist', () => {
      const now = Date.now();
      // 5 plays of Random Vibe Filler (passive / exploratory)
      const passivePlays: TrackPlayRecord[] = [1, 2, 3, 4, 5].map((i) =>
        createMockPlay({
          id: `p_pas_${i}`,
          sessionId: `s_pas_${i}`,
          trackId: tPas1.id,
          artist: tPas1.artist,
          title: tPas1.title,
          genre: 'Pop',
          playedAt: now - i * 1000,
          startTime: now - i * 1000,
          durationPlayedMs: 180000,
          totalDurationMs: 180000,
          completed: true,
          replayed: false,
          source: 'audius',
          origin: 'vibe_playlist',
          intent: 'exploratory',
          intentWeight: 0.25,
        })
      );

      // Only 2 plays of Direct Pick Star (searched by user, favoured)
      const favouredPlays: TrackPlayRecord[] = [1, 2].map((i) =>
        createMockPlay({
          id: `p_fav_${i}`,
          sessionId: `s_fav_${i}`,
          trackId: tFav1.id,
          artist: tFav1.artist,
          title: tFav1.title,
          genre: 'Pop',
          playedAt: now - i * 2000,
          startTime: now - i * 2000,
          durationPlayedMs: 180000,
          totalDurationMs: 180000,
          completed: true,
          replayed: false,
          source: 'audius',
          origin: 'search',
          intent: 'favoured',
          intentWeight: 1.0,
        })
      );

      const allPlays = [...passivePlays, ...favouredPlays];

      const madeForYou = engine.generateMadeForYou(allPlays, catalogue, [], []);
      expect(madeForYou.length).toBeGreaterThan(0);

      // The top recommendation should come from the user's favoured artist, NOT the vibe filler!
      const topArtist = madeForYou[0].artist;
      expect(topArtist).toBe(artistFavoured);
    });

    it('generateMadeForYouArtists ranks favoured artists above exploratory-only artists', () => {
      const now = Date.now();
      const passivePlays: TrackPlayRecord[] = [1, 2, 3, 4, 5, 6].map((i) =>
        createMockPlay({
          id: `p_pas_${i}`,
          sessionId: `s_pas_${i}`,
          trackId: tPas1.id,
          artist: tPas1.artist,
          title: tPas1.title,
          genre: 'Pop',
          playedAt: now - i * 1000,
          startTime: now - i * 1000,
          durationPlayedMs: 180000,
          totalDurationMs: 180000,
          completed: true,
          replayed: false,
          source: 'audius',
          origin: 'vibe_playlist',
          intent: 'exploratory',
          intentWeight: 0.25,
        })
      );

      const favouredPlays: TrackPlayRecord[] = [1, 2, 3].map((i) =>
        createMockPlay({
          id: `p_fav_${i}`,
          sessionId: `s_fav_${i}`,
          trackId: tFav1.id,
          artist: tFav1.artist,
          title: tFav1.title,
          genre: 'Pop',
          playedAt: now - i * 1000,
          startTime: now - i * 1000,
          durationPlayedMs: 180000,
          totalDurationMs: 180000,
          completed: true,
          replayed: false,
          source: 'audius',
          origin: 'artist',
          intent: 'favoured',
          intentWeight: 1.0,
        })
      );

      const topArtists = engine.generateMadeForYouArtists([...passivePlays, ...favouredPlays]);
      expect(topArtists.length).toBeGreaterThan(0);
      expect(topArtists[0].name).toBe(artistFavoured);
    });

    it('generateHeavyRotation prevents purely exploratory vibe tracks from dominating heavy rotation', () => {
      const now = Date.now();
      // Track listened 4 times in a background vibe playlist without engagement
      const passivePlays: TrackPlayRecord[] = [1, 2, 3, 4].map((i) =>
        createMockPlay({
          id: `p_pas_${i}`,
          sessionId: `s_pas_${i}`,
          trackId: tPas1.id,
          artist: tPas1.artist,
          title: tPas1.title,
          genre: 'Pop',
          playedAt: now - i * 3600000,
          startTime: now - i * 3600000,
          durationPlayedMs: 180000,
          totalDurationMs: 180000,
          completionRate: 1.0,
          completed: true,
          replayed: false,
          source: 'audius',
          origin: 'vibe_playlist',
          intent: 'exploratory',
          intentWeight: 0.25,
        })
      );

      // Track listened 3 times from Library/Song click (favoured)
      const favouredPlays: TrackPlayRecord[] = [1, 2, 3].map((i) =>
        createMockPlay({
          id: `p_fav_${i}`,
          sessionId: `s_fav_${i}`,
          trackId: tFav1.id,
          artist: tFav1.artist,
          title: tFav1.title,
          genre: 'Pop',
          playedAt: now - i * 3600000,
          startTime: now - i * 3600000,
          durationPlayedMs: 180000,
          totalDurationMs: 180000,
          completionRate: 1.0,
          completed: true,
          replayed: false,
          source: 'audius',
          origin: 'song',
          intent: 'favoured',
          intentWeight: 1.0,
        })
      );

      const heavyRotation = engine.generateHeavyRotation([...passivePlays, ...favouredPlays], catalogue, []);
      expect(heavyRotation.length).toBeGreaterThan(0);
      expect(heavyRotation[0].id).toBe(tFav1.id);
    });

    it('generateForgottenFavorites excludes passive exploratory plays that were never favoured', () => {
      const oldTime = Date.now() - 30 * 86400000; // 30 days ago
      const oldPassivePlays: TrackPlayRecord[] = [1, 2].map((i) =>
        createMockPlay({
          id: `p_old_pas_${i}`,
          sessionId: `s_old_pas_${i}`,
          trackId: tPas1.id,
          artist: tPas1.artist,
          title: tPas1.title,
          genre: 'Pop',
          playedAt: oldTime - i * 1000,
          startTime: oldTime - i * 1000,
          durationPlayedMs: 180000,
          totalDurationMs: 180000,
          completionRate: 1.0,
          completed: true,
          replayed: false,
          source: 'audius',
          origin: 'vibe_playlist',
          intent: 'exploratory',
          intentWeight: 0.25,
        })
      );

      const oldFavouredPlays: TrackPlayRecord[] = [1, 2].map((i) =>
        createMockPlay({
          id: `p_old_fav_${i}`,
          sessionId: `s_old_fav_${i}`,
          trackId: tFav1.id,
          artist: tFav1.artist,
          title: tFav1.title,
          genre: 'Pop',
          playedAt: oldTime - i * 1000,
          startTime: oldTime - i * 1000,
          durationPlayedMs: 180000,
          totalDurationMs: 180000,
          completionRate: 1.0,
          completed: true,
          replayed: false,
          source: 'audius',
          origin: 'library',
          intent: 'favoured',
          intentWeight: 1.0,
        })
      );

      const forgotten = engine.generateForgottenFavorites([...oldPassivePlays, ...oldFavouredPlays], catalogue, []);
      const forgottenIds = forgotten.map((t) => t.id);
      expect(forgottenIds).toContain(tFav1.id);
      expect(forgottenIds).not.toContain(tPas1.id);
    });
  });
});
