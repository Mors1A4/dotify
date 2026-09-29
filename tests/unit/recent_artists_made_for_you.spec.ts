import { describe, it, expect } from 'vitest';
import { RecommendationEngine } from '../../src/services/recommendationEngine';
import { TrackPlayRecord, ArtistAffinityRecord } from '../../src/types/telemetry';
import { FollowedArtist } from '../../src/types/artist';
import { Track } from '../../src/types/track';

function createMockPlay(partial: Partial<TrackPlayRecord> & { trackId: string; artist: string }): TrackPlayRecord {
  const durationPlayedMs = partial.durationPlayedMs ?? 180000;
  const totalDurationMs = partial.totalDurationMs ?? 180000;
  const completionRate = partial.completionRate ?? 1.0;
  return {
    playId: partial.playId ?? `play_${Math.random().toString(36).slice(2, 7)}`,
    sessionId: partial.sessionId ?? 'session_1',
    trackId: partial.trackId,
    title: partial.title ?? 'Mock Track',
    artist: partial.artist,
    genre: partial.genre ?? 'Pop',
    source: partial.source ?? 'charts',
    startTime: partial.startTime ?? Date.now(),
    durationPlayedMs,
    timePlayedMs: durationPlayedMs,
    totalDurationMs,
    durationMs: totalDurationMs,
    completionRate,
    skipped: partial.skipped ?? false,
    completed: partial.completed ?? true,
    replayed: partial.replayed ?? false,
    artworkUrl: partial.artworkUrl ?? 'https://example.com/artwork.jpg',
  };
}

describe('Made For You: Recent Artists Algorithm', () => {
  const engine = RecommendationEngine.getInstance();
  const now = 1700000000000; // Fixed baseline timestamp

  it('ranks recently listened artists higher due to exponential half-life decay', () => {
    const oneHourAgo = now - 3600 * 1000;
    const tenDaysAgo = now - 10 * 86400 * 1000;

    const plays: TrackPlayRecord[] = [
      createMockPlay({
        trackId: 't1',
        artist: 'Recent Star',
        title: 'Fresh Hit',
        startTime: oneHourAgo,
        completionRate: 1.0,
      }),
      createMockPlay({
        trackId: 't2',
        artist: 'Older Legend',
        title: 'Old Hit',
        startTime: tenDaysAgo,
        completionRate: 1.0,
      }),
    ];

    const result = engine.generateMadeForYouArtists(plays, [], [], [], 10, now);
    expect(result.length).toBe(2);
    expect(result[0].name).toBe('Recent Star');
    expect(result[1].name).toBe('Older Legend');
    expect(result[0].lastPlayedAt).toBe(oneHourAgo);
    expect(result[0].recentTrackTitle).toBe('Fresh Hit');
  });

  it('normalizes collaborative artist strings to primary artist name', () => {
    const plays: TrackPlayRecord[] = [
      createMockPlay({
        trackId: 't1',
        artist: 'Calvin Harris feat. Ellie Goulding',
        title: 'I Need Your Love',
        startTime: now - 1000,
      }),
      createMockPlay({
        trackId: 't2',
        artist: 'Calvin Harris & Dua Lipa',
        title: 'One Kiss',
        startTime: now - 2000,
      }),
    ];

    const result = engine.generateMadeForYouArtists(plays, [], [], [], 10, now);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Calvin Harris');
    expect(result[0].playCount).toBe(2);
  });

  it('penalizes skipped plays compared to fully completed plays', () => {
    const plays: TrackPlayRecord[] = [
      createMockPlay({
        trackId: 't1',
        artist: 'Completed Artist',
        title: 'Great Song',
        startTime: now - 3600 * 1000,
        completionRate: 1.0,
        skipped: false,
      }),
      createMockPlay({
        trackId: 't2',
        artist: 'Skipped Artist',
        title: 'Insta Skip',
        startTime: now - 3600 * 1000,
        completionRate: 0.1,
        skipped: true,
      }),
    ];

    const result = engine.generateMadeForYouArtists(plays, [], [], [], 10, now);
    expect(result[0].name).toBe('Completed Artist');
  });

  it('boosts followed artists even if they have fewer recent plays', () => {
    const plays: TrackPlayRecord[] = [
      createMockPlay({
        trackId: 't1',
        artist: 'Unfollowed Artist',
        startTime: now - 2 * 86400 * 1000,
        completionRate: 1.0,
      }),
      createMockPlay({
        trackId: 't2',
        artist: 'Followed Artist',
        startTime: now - 4 * 86400 * 1000,
        completionRate: 1.0,
      }),
    ];

    const followed: FollowedArtist[] = [
      {
        id: 'f1',
        name: 'Followed Artist',
        imageUrl: 'https://example.com/followed.jpg',
        followedAt: now - 100000,
      },
    ];

    const result = engine.generateMadeForYouArtists(plays, [], followed, [], 10, now);
    expect(result[0].name).toBe('Followed Artist');
    expect(result[0].isFollowed).toBe(true);
    expect(result[0].picture).toBe('https://example.com/followed.jpg');
  });

  it('incorporates historical artist affinity score from telemetry database', () => {
    const plays: TrackPlayRecord[] = [
      createMockPlay({
        trackId: 't1',
        artist: 'High Affinity Artist',
        startTime: now - 5 * 86400 * 1000,
        completionRate: 1.0,
      }),
      createMockPlay({
        trackId: 't2',
        artist: 'Low Affinity Artist',
        startTime: now - 5 * 86400 * 1000,
        completionRate: 1.0,
      }),
    ];

    const affinities: ArtistAffinityRecord[] = [
      {
        artist: 'High Affinity Artist',
        affinityScore: 95,
        playCount: 50,
        totalTimePlayedMs: 5000000,
      },
      {
        artist: 'Low Affinity Artist',
        affinityScore: 5,
        playCount: 1,
        totalTimePlayedMs: 100000,
      },
    ];

    const result = engine.generateMadeForYouArtists(plays, affinities, [], [], 10, now);
    expect(result[0].name).toBe('High Affinity Artist');
    expect(result[0].affinityScore).toBe(95);
  });

  it('provides graceful cold-start fallback when listening history is completely empty', () => {
    const catalogue: Track[] = [
      {
        id: 'cat_1',
        title: 'Starboy',
        artist: 'The Weeknd',
        source: 'charts',
        duration: 230,
        streamUrl: '',
        artworkUrl: 'https://example.com/weeknd.jpg',
        sourceMetadata: {} as any,
      },
      {
        id: 'cat_2',
        title: 'Blinding Lights',
        artist: 'The Weeknd',
        source: 'charts',
        duration: 200,
        streamUrl: '',
        sourceMetadata: {} as any,
      },
      {
        id: 'cat_3',
        title: 'Anti-Hero',
        artist: 'Taylor Swift',
        source: 'charts',
        duration: 210,
        streamUrl: '',
        artworkUrl: 'https://example.com/taylor.jpg',
        sourceMetadata: {} as any,
      },
    ];

    const result = engine.generateMadeForYouArtists([], [], [], catalogue, 10, now);
    expect(result.length).toBe(2);
    expect(result.map((r) => r.name)).toEqual(['The Weeknd', 'Taylor Swift']);
    expect(result[0].playCount).toBe(0);
    expect(result[0].lastPlayedAt).toBe(0);
  });

  it('enforces limit argument strictly', () => {
    const plays: TrackPlayRecord[] = Array.from({ length: 15 }, (_, i) =>
      createMockPlay({
        trackId: `t_${i}`,
        artist: `Artist ${i}`,
        startTime: now - i * 1000,
      })
    );

    const result = engine.generateMadeForYouArtists(plays, [], [], [], 5, now);
    expect(result.length).toBe(5);
  });
});
