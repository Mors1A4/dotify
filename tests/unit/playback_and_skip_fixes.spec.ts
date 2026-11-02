import { describe, it, expect, beforeEach } from 'vitest';
import { usePlayerStore } from '../../src/store/playerStore';
import { rankCandidates, YouTubeCandidate } from '../../src/services/youtubeResolver';
import { badSourceService } from '../../src/services/badSourceService';
import { Track } from '../../src/types/track';

const trackA: Track = {
  id: 'track-a',
  title: 'Track A',
  artist: 'Artist A',
  duration: 180,
  source: 'charts',
  streamUrl: 'https://example.com/trackA.mp3',
  sourceMetadata: {},
};

const trackB: Track = {
  id: 'track-b',
  title: 'Track B',
  artist: 'Artist B',
  duration: 200,
  source: 'charts',
  streamUrl: 'https://example.com/trackB.mp3',
  sourceMetadata: {},
};

const trackC: Track = {
  id: 'track-c',
  title: 'Track C',
  artist: 'Artist C',
  duration: 220,
  source: 'charts',
  streamUrl: 'https://example.com/trackC.mp3',
  sourceMetadata: {},
};

const trackD: Track = {
  id: 'track-d',
  title: 'Track D',
  artist: 'Artist D',
  duration: 240,
  source: 'charts',
  streamUrl: 'https://example.com/trackD.mp3',
  sourceMetadata: {},
};

describe('Playback and Rapid Skip Fixes', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      queue: [trackA, trackB, trackC, trackD],
      currentTrack: trackA,
      currentTrackIndex: 0,
      isPlaying: true,
      repeatMode: 'off',
      shuffle: false,
    });
  });

  describe('Rapid Skip Integrity', () => {
    it('advances currentTrackIndex on rapid consecutive nextTrack calls without swallowing skips', async () => {
      const store = usePlayerStore.getState();
      expect(usePlayerStore.getState().currentTrackIndex).toBe(0);
      expect(usePlayerStore.getState().currentTrack?.id).toBe('track-a');

      // Rapid double skip: two nextTrack() calls in immediate sequence
      const p1 = store.nextTrack();
      const p2 = store.nextTrack();
      await Promise.all([p1, p2]);

      // Both skips must be registered: index should be 2 (track-c)
      expect(usePlayerStore.getState().currentTrackIndex).toBe(2);
      expect(usePlayerStore.getState().currentTrack?.id).toBe('track-c');

      // Third rapid skip: advances to index 3 (track-d)
      await store.nextTrack();
      expect(usePlayerStore.getState().currentTrackIndex).toBe(3);
      expect(usePlayerStore.getState().currentTrack?.id).toBe('track-d');
    });

    it('steps backwards on rapid consecutive previousTrack calls when not using history', async () => {
      usePlayerStore.setState({
        queue: [trackA, trackB, trackC, trackD],
        currentTrack: trackD,
        currentTrackIndex: 3,
        history: [],
      });

      const store = usePlayerStore.getState();
      expect(usePlayerStore.getState().currentTrackIndex).toBe(3);

      // Rapid double back skip
      const p1 = store.previousTrack();
      const p2 = store.previousTrack();
      await Promise.all([p1, p2]);

      expect(usePlayerStore.getState().currentTrackIndex).toBe(1);
      expect(usePlayerStore.getState().currentTrack?.id).toBe('track-b');
    });
  });

  describe('Candidate Ranking & Title Disambiguation', () => {
    it('prioritizes exact title "Better" over "Eat Me Better" for nimino even without duration info', () => {
      const artist = 'nimino';
      const title = 'Better';
      const candidates: YouTubeCandidate[] = [
        {
          videoId: 'eat_me_audio',
          title: "nimino - 'Eat Me Better' (Official Audio)",
          duration: 190,
        },
        {
          videoId: 'eat_me_video',
          title: "nimino - 'Eat Me Better' (Official Video)",
          duration: 189,
        },
        {
          videoId: 'better_mv',
          title: "nimino - 'Better (feat. Manta)' (Official Music Video)",
          duration: 239,
        },
        {
          videoId: 'better_audio',
          title: 'nimino - Better (feat. Manta)',
          duration: 239,
        },
      ];

      // Test with duration = 0 (duration unknown)
      const rankedNoDur = rankCandidates(candidates, artist, title, 0);
      expect(rankedNoDur[0].videoId).toBe('better_mv');
      expect(rankedNoDur[0].score).toBeGreaterThan(rankedNoDur.find((c) => c.videoId === 'eat_me_audio')!.score!);

      // Test with expected duration = 239 (Spotify duration)
      const rankedWithDur = rankCandidates(candidates, artist, title, 239);
      expect(rankedWithDur[0].videoId).toBe('better_mv');
      expect(rankedWithDur[1].videoId).toBe('better_audio');
      expect(rankedWithDur[0].score).toBeGreaterThan(150);
    });

    it('falls back to alternate clean candidate when top candidate is marked as bad (e.g. error 150)', () => {
      const artist = 'nimino';
      const title = 'Better';
      const candidates: YouTubeCandidate[] = [
        {
          videoId: 'bad_mv_1501',
          title: "nimino - 'Better (feat. Manta)' (Official Music Video)",
          duration: 239,
        },
        {
          videoId: 'clean_aud_2',
          title: 'nimino - Better (feat. Manta)',
          duration: 239,
        },
        {
          videoId: 'clean_lyr_3',
          title: 'nimino - Better (Lyrics) ft. Manta',
          duration: 240,
        },
      ];

      // Initially, bad_mv_1501 wins
      let ranked = rankCandidates(candidates, artist, title, 239);
      expect(ranked[0].videoId).toBe('bad_mv_1501');

      // Now mark bad_mv_1501 as bad (simulate YouTube iframe embed error 150)
      badSourceService.markBad({
        videoId: 'bad_mv_1501',
        artist,
        title,
        reason: 'iframe_error_150',
      });

      // Filter out bad sources like youtubeResolver does
      ranked = rankCandidates(candidates, artist, title, 239);
      const cleanRanked = ranked.filter((c) => !badSourceService.isBad(c.videoId));

      expect(cleanRanked.length).toBe(2);
      expect(cleanRanked[0].videoId).toBe('clean_aud_2');
    });
  });
});
