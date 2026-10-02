import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommunityListeningService, communityListeningService } from '../../src/services/communityListeningService';
import { RecommendationEngine } from '../../src/services/recommendationEngine';
import { Track } from '../../src/types/track';
import { TrackPlayRecord } from '../../src/types/telemetry';
import { safeStorage } from '../../src/utils/storage';

const MOCK_TRACK_A1: Track = {
  id: 'charts:101',
  source: 'charts',
  title: 'Starboy',
  artist: 'The Weeknd',
  album: 'Starboy',
  duration: 230,
  streamUrl: 'http://localhost/stream/101',
  artworkUrl: 'https://example.com/starboy.jpg',
  sourceMetadata: { genre: 'R&B' },
};

const MOCK_TRACK_A2: Track = {
  id: 'charts:102',
  source: 'charts',
  title: 'Blinding Lights',
  artist: 'The Weeknd',
  album: 'After Hours',
  duration: 200,
  streamUrl: 'http://localhost/stream/102',
  artworkUrl: 'https://example.com/blinding.jpg',
  sourceMetadata: { genre: 'Synthpop' },
};

const MOCK_TRACK_A3: Track = {
  id: 'charts:103',
  source: 'charts',
  title: 'Save Your Tears',
  artist: 'The Weeknd',
  album: 'After Hours',
  duration: 215,
  streamUrl: 'http://localhost/stream/103',
  artworkUrl: 'https://example.com/save.jpg',
  sourceMetadata: { genre: 'Synthpop' },
};

const MOCK_TRACK_B1: Track = {
  id: 'charts:201',
  source: 'charts',
  title: 'Do I Wanna Know?',
  artist: 'Arctic Monkeys',
  album: 'AM',
  duration: 272,
  streamUrl: 'http://localhost/stream/201',
  artworkUrl: 'https://example.com/am.jpg',
  sourceMetadata: { genre: 'Indie Rock' },
};

const MOCK_TRACK_B2: Track = {
  id: 'charts:202',
  source: 'charts',
  title: '505',
  artist: 'Arctic Monkeys',
  album: 'Favourite Worst Nightmare',
  duration: 253,
  streamUrl: 'http://localhost/stream/202',
  artworkUrl: 'https://example.com/505.jpg',
  sourceMetadata: { genre: 'Indie Rock' },
};

const MOCK_TRACK_C1: Track = {
  id: 'charts:301',
  source: 'charts',
  title: 'BIRDS OF A FEATHER',
  artist: 'Billie Eilish',
  album: 'HIT ME HARD AND SOFT',
  duration: 190,
  streamUrl: 'http://localhost/stream/301',
  artworkUrl: 'https://example.com/birds.jpg',
  sourceMetadata: { genre: 'Pop' },
};

describe('Community Listening & Cross-User Artist Recommendations', () => {
  const engine = RecommendationEngine.getInstance();
  const service = CommunityListeningService.getInstance();

  beforeEach(() => {
    safeStorage.removeItem('dotify_community_recent_plays');
    service.clearCache();
  });

  it('records play events into local cache and ignores duplicate rapid plays of the same track', async () => {
    await service.recordPlay(MOCK_TRACK_A1, 'user_alice');
    await service.recordPlay(MOCK_TRACK_A1, 'user_alice'); // Immediate duplicate

    const plays = await service.getCommunityPlays();
    const alicePlays = plays.filter((p) => p.userId === 'user_alice' && p.trackId === MOCK_TRACK_A1.id);
    expect(alicePlays.length).toBe(1);
  });

  it('filters out the current user to recommend songs from artists that OTHERS have been listening to', async () => {
    const currentUserId = 'user_monty';
    const otherUser1 = 'user_charlie';
    const otherUser2 = 'user_diana';

    // Other users listen to Arctic Monkeys and Billie Eilish
    await service.recordPlay(MOCK_TRACK_B1, otherUser1);
    await service.recordPlay(MOCK_TRACK_B2, otherUser2);
    await service.recordPlay(MOCK_TRACK_C1, otherUser1);

    // Current user listens to something else
    await service.recordPlay(MOCK_TRACK_A1, currentUserId);

    const communityPlays = await service.getCommunityPlays(currentUserId);
    // None of the returned plays should belong to current user
    const hasCurrentUserPlays = communityPlays.some((p) => p.userId === currentUserId);
    expect(hasCurrentUserPlays).toBe(false);

    // Other users' plays must be present
    expect(communityPlays.some((p) => p.artist === 'Arctic Monkeys')).toBe(true);
    expect(communityPlays.some((p) => p.artist === 'Billie Eilish')).toBe(true);
  });

  it('aggregates trending artists and computes unique listener counts', async () => {
    const currentUserId = 'user_me';
    await service.recordPlay(MOCK_TRACK_B1, 'listener_1');
    await service.recordPlay(MOCK_TRACK_B2, 'listener_2');
    await service.recordPlay(MOCK_TRACK_B1, 'listener_3'); // 3 distinct listeners for Arctic Monkeys

    const trends = await service.getTrendingArtists(currentUserId);
    const arcticTrend = trends.find((t) => t.artist === 'Arctic Monkeys');

    expect(arcticTrend).toBeDefined();
    expect(arcticTrend?.listenerCount).toBeGreaterThanOrEqual(3);
    expect(arcticTrend?.playCount).toBeGreaterThanOrEqual(3);
  });

  it('enforces anti-clumping invariant: maximum 2 tracks per community artist on the shelf', async () => {
    const trending = [
      {
        artist: 'The Weeknd',
        listenerCount: 5,
        recentTracks: [MOCK_TRACK_A1, MOCK_TRACK_A2, MOCK_TRACK_A3], // 3 candidate tracks
      },
      {
        artist: 'Arctic Monkeys',
        listenerCount: 4,
        recentTracks: [MOCK_TRACK_B1, MOCK_TRACK_B2],
      },
    ];

    const recommended = engine.generateCommunityRecommendations(
      trending,
      [MOCK_TRACK_A1, MOCK_TRACK_A2, MOCK_TRACK_A3, MOCK_TRACK_B1, MOCK_TRACK_B2],
      [],
      [],
      10
    );

    const weekndTracks = recommended.filter((t) => t.artist === 'The Weeknd');
    const arcticTracks = recommended.filter((t) => t.artist === 'Arctic Monkeys');

    expect(weekndTracks.length).toBeLessThanOrEqual(2);
    expect(arcticTracks.length).toBeLessThanOrEqual(2);
  });

  it('excludes tracks the current user has skipped when curating community artist songs', () => {
    const trending = [
      {
        artist: 'The Weeknd',
        listenerCount: 5,
        recentTracks: [MOCK_TRACK_A1, MOCK_TRACK_A2],
      },
    ];

    const userPlays: TrackPlayRecord[] = [
      {
        playId: 'p1',
        sessionId: 's1',
        trackId: MOCK_TRACK_A1.id,
        title: MOCK_TRACK_A1.title,
        artist: MOCK_TRACK_A1.artist,
        durationPlayedMs: 5000,
        totalDurationMs: 200000,
        skipped: true, // User skipped MOCK_TRACK_A1
        completed: false,
        replayed: false,
        source: 'charts',
        completionRate: 0.025,
        startTime: Date.now() - 60000,
      },
    ];

    const recommended = engine.generateCommunityRecommendations(
      trending,
      [MOCK_TRACK_A1, MOCK_TRACK_A2],
      userPlays,
      [],
      10
    );

    expect(recommended.some((t) => t.id === MOCK_TRACK_A1.id)).toBe(false);
    expect(recommended.some((t) => t.id === MOCK_TRACK_A2.id)).toBe(true);
  });

  it('attaches community recommendation attribution metadata to recommended tracks', async () => {
    const recommended = await service.getRecommendedSongsFromCommunityArtists({
      excludeUserId: 'test_current_user',
      catalogue: [MOCK_TRACK_A1, MOCK_TRACK_B1, MOCK_TRACK_C1],
    });

    expect(recommended.length).toBeGreaterThan(0);
    const first = recommended[0];
    expect(first.sourceMetadata).toBeDefined();
    expect(first.sourceMetadata?.communityArtist).toBeDefined();
    expect(typeof first.sourceMetadata?.communityReason).toBe('string');
  });

  it('provides graceful fallback to community seed tracks during offline or cold-start', async () => {
    // When local storage and server have no plays, it should still recommend songs from beloved community artists
    safeStorage.removeItem('dotify_community_recent_plays');
    const recommended = await service.getRecommendedSongsFromCommunityArtists({
      excludeUserId: 'brand_new_user',
      catalogue: [],
    });

    expect(recommended.length).toBeGreaterThanOrEqual(5);
    const artists = recommended.map((t) => t.artist);
    // Should include well-known community artists like The Weeknd, Billie Eilish, Arctic Monkeys, etc.
    expect(
      artists.some((a) => ['The Weeknd', 'Billie Eilish', 'Arctic Monkeys', 'Dua Lipa', 'Taylor Swift'].includes(a))
    ).toBe(true);
  });

  it('recommends the specific songs that people have listened to and rotates them naturally by design', async () => {
    service.clearCache();
    // Simulate other listeners playing specific songs
    const SPECIFIC_SONG_1: Track = {
      id: 'charts:sp_1',
      source: 'charts',
      title: 'Midnight City',
      artist: 'M83',
      album: "Hurry Up, We're Dreaming",
      duration: 243,
      streamUrl: '',
      artworkUrl: 'https://example.com/m83.jpg',
      sourceMetadata: {},
    };
    const SPECIFIC_SONG_2: Track = {
      id: 'charts:sp_2',
      source: 'charts',
      title: 'Kids',
      artist: 'MGMT',
      album: 'Oracular Spectacular',
      duration: 302,
      streamUrl: '',
      artworkUrl: 'https://example.com/mgmt.jpg',
      sourceMetadata: {},
    };

    await service.recordPlay(SPECIFIC_SONG_1, 'listener_alpha');
    await service.recordPlay(SPECIFIC_SONG_2, 'listener_beta');

    const recommended = await service.getRecommendedSongsFromCommunityArtists({
      excludeUserId: 'current_user',
      rotationOffset: 0,
      limit: 40,
    });

    const titles = recommended.map((t) => t.title);
    expect(titles).toContain('Midnight City');
    expect(titles).toContain('Kids');

    // Natural rotation test: circular shift with offset
    const rotated = await service.getRecommendedSongsFromCommunityArtists({
      excludeUserId: 'current_user',
      rotationOffset: 1,
      limit: 40,
    });

    expect(rotated.length).toBeGreaterThan(0);
    if (recommended.length > 1) {
      expect(rotated[0].id).not.toBe(recommended[0].id);
    }
  });
});
