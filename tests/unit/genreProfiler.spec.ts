import { describe, it, expect } from 'vitest';
import { GenreProfiler } from '../../src/services/genreProfiler';
import { TrackPlayRecord } from '../../src/types/telemetry';
import { Track } from '../../src/types/track';
import { FollowedArtist } from '../../src/types/artist';

describe('GenreProfiler & Taste Profiling Engine', () => {
  const profiler = GenreProfiler.getInstance();

  it('classifies granular subgenres and tags into macro genre groups correctly', () => {
    expect(profiler.classifyGenre('techno')).toBe('Electronic & Dance');
    expect(profiler.classifyGenre('synthwave')).toBe('Electronic & Dance');
    expect(profiler.classifyGenre('drum & bass')).toBe('Electronic & Dance');
    expect(profiler.classifyGenre('hip-hop / rap')).toBe('Hip-Hop & Urban');
    expect(profiler.classifyGenre('trap')).toBe('Hip-Hop & Urban');
    expect(profiler.classifyGenre('r&b')).toBe('Hip-Hop & Urban');
    expect(profiler.classifyGenre('indie rock')).toBe('Rock & Alternative');
    expect(profiler.classifyGenre('post-rock')).toBe('Rock & Alternative');
    expect(profiler.classifyGenre('heavy metal')).toBe('Rock & Alternative');
    expect(profiler.classifyGenre('dance-pop')).toBe('Pop & Anthems');
    expect(profiler.classifyGenre('k-pop')).toBe('Pop & Anthems');
    expect(profiler.classifyGenre('chillhop')).toBe('Chill & Lo-Fi');
    expect(profiler.classifyGenre('study beats')).toBe('Chill & Lo-Fi');
    expect(profiler.classifyGenre('acoustic')).toBe('Acoustic & Folk');
    expect(profiler.classifyGenre('country')).toBe('Acoustic & Folk');
    expect(profiler.classifyGenre('jazz')).toBe('Jazz & Soul');
    expect(profiler.classifyGenre('motown')).toBe('Jazz & Soul');
    expect(profiler.classifyGenre('soundtrack')).toBe('Classical & Cinematic');
    expect(profiler.classifyGenre('orchestral')).toBe('Classical & Cinematic');
  });

  it('infers macro genre from track title and artist keywords when genre is missing or unknown', () => {
    expect(profiler.classifyGenre('Unknown', 'Carpenter Brut', 'Turbo Killer Remix')).toBe('Electronic & Dance');
    expect(profiler.classifyGenre('', 'Lofi Fruits Music', 'Chill Study Beats')).toBe('Chill & Lo-Fi');
    expect(profiler.classifyGenre(undefined, 'Hans Zimmer', 'Interstellar Piano Theme')).toBe('Classical & Cinematic');
  });

  it('computes weighted taste profile with completion rate bonuses and replay weighting', () => {
    const plays: TrackPlayRecord[] = [
      {
        playId: 'p1',
        sessionId: 's1',
        trackId: 'rhcp_1',
        title: "Can't Stop",
        artist: 'Red Hot Chili Peppers',
        genre: 'Rock',
        source: 'charts',
        startTime: Date.now() - 3600000,
        durationPlayedMs: 260000,
        totalDurationMs: 260000,
        completionRate: 1.0,
        skipped: false,
        completed: true,
        replayed: true,
      },
      {
        playId: 'p2',
        sessionId: 's1',
        trackId: 'rhcp_2',
        title: 'Californication',
        artist: 'Red Hot Chili Peppers',
        genre: 'Alternative Rock',
        source: 'charts',
        startTime: Date.now() - 3000000,
        durationPlayedMs: 240000,
        totalDurationMs: 240000,
        completionRate: 1.0,
        skipped: false,
        completed: true,
        replayed: false,
      },
      {
        playId: 'p3',
        sessionId: 's2',
        trackId: 'daft_1',
        title: 'One More Time',
        artist: 'Daft Punk',
        genre: 'Electronic / House',
        source: 'charts',
        startTime: Date.now() - 1000000,
        durationPlayedMs: 320000,
        totalDurationMs: 320000,
        completionRate: 1.0,
        skipped: false,
        completed: true,
        replayed: false,
      },
    ];

    const likedTracks: Track[] = [
      {
        id: 'rhcp_1',
        title: "Can't Stop",
        artist: 'Red Hot Chili Peppers',
        source: 'charts',
        duration: 260,
        streamUrl: '',
        sourceMetadata: { genre: 'Rock' },
      },
    ];

    const followedArtists: FollowedArtist[] = [
      {
        id: 'a1',
        name: 'Red Hot Chili Peppers',
        genres: ['Rock'],
        followedAt: Date.now(),
      },
    ];

    const profile = profiler.profileUserGenres(plays, likedTracks, followedArtists);

    expect(profile.isColdStart).toBe(false);
    expect(profile.dominantGenre).toBe('Rock & Alternative');
    expect(profile.topGenreGroups.length).toBeGreaterThan(0);
    expect(profile.topGenreGroups[0].group).toBe('Rock & Alternative');
    expect(profile.topGenreGroups[0].percentage).toBeGreaterThan(50);
    expect(profile.topArtists[0].name).toBe('Red Hot Chili Peppers');
    expect(profile.summaryText).toContain('Rock & Alternative');
  });

  it('handles cold-start new users gracefully with a balanced starter profile', () => {
    const profile = profiler.profileUserGenres([], [], []);
    expect(profile.isColdStart).toBe(true);
    expect(profile.topGenreGroups.length).toBeGreaterThanOrEqual(4);
    expect(profile.summaryText).toContain('Cold Start');
  });
});
