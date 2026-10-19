import { describe, it, expect } from 'vitest';
import { rankCandidates, YouTubeCandidate } from '../../src/services/youtubeResolver';

describe('YouTube Resolver & Candidate Ranking', () => {
  it('correctly prioritizes international and folk songs over unrelated tracks with official audio keywords', () => {
    const artist = 'So Hee Song';
    const title = 'Folk song for Han River';
    const duration = 241;

    const candidates: YouTubeCandidate[] = [
      {
        videoId: 'pop12345678',
        title: 'Random Pop Hit - Official Audio',
        duration: 240, // almost exact duration match
      },
      {
        videoId: 'iKkhKTRmUQs',
        title: '[M/V] 송소희(Song So-hee) - 한강수타령 (Folk song for Han River)',
        duration: 242, // target song!
      },
      {
        videoId: 'cover123456',
        title: 'Folk song for Han River - Amateur Guitar Cover',
        duration: 241,
      },
      {
        videoId: 'loop1234567',
        title: 'Folk song for Han River - 1 Hour Loop',
        duration: 3600,
      },
    ];

    const ranked = rankCandidates(candidates, artist, title, duration);

    // The genuine music video / audio by Song So-hee must win first place
    expect(ranked[0].videoId).toBe('iKkhKTRmUQs');
    expect(ranked[0].score).toBeGreaterThan(100);

    // Cover and loop should receive penalties
    const cover = ranked.find((c) => c.videoId === 'cover123456');
    const loop = ranked.find((c) => c.videoId === 'loop1234567');
    const winner = ranked[0];

    expect(winner.score!).toBeGreaterThan(cover!.score!);
    expect(winner.score!).toBeGreaterThan(loop!.score!);
  });

  it('handles inverted Asian artist names (e.g. Song So-hee vs So Hee Song)', () => {
    const artist = 'So Hee Song';
    const title = 'Folk song for Han River';
    const duration = 241;

    const candidates: YouTubeCandidate[] = [
      {
        videoId: 'audio111111',
        title: 'Song So-hee - Folk song for Han River',
        duration: 241,
      },
      {
        videoId: 'other222222',
        title: 'Another Artist - Folk song for Han River',
        duration: 241,
      },
    ];

    const ranked = rankCandidates(candidates, artist, title, duration);
    expect(ranked[0].videoId).toBe('audio111111');
  });

  it('does not give keyword bonuses to completely unrelated songs', () => {
    const artist = 'So Hee Song';
    const title = 'Folk song for Han River';
    const duration = 241;

    const candidates: YouTubeCandidate[] = [
      {
        videoId: 'unrelated11',
        title: 'Ed Sheeran - Shape of You (Official Music Video)',
        duration: 241,
      },
      {
        videoId: 'target11111',
        title: 'Folk song for Han River',
        duration: 241,
      },
    ];

    const ranked = rankCandidates(candidates, artist, title, duration);
    expect(ranked[0].videoId).toBe('target11111');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score!);
  });
});
