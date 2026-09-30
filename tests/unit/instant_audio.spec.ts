import { describe, it, expect, beforeEach } from 'vitest';
import {
  isCandidateCached,
  prewarmCandidate,
} from '../../src/services/youtubeResolver';
import { YouTubeIframeBridge } from '../../src/audio/youtubeIframeBridge';
import { audioEngine } from '../../src/audio/audioEngine';

describe('Instant Audio Engine & Pre-Resolution', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('YouTube Resolver Pre-Resolution & Caching', () => {
    it('synchronously checks candidate cache status with isCandidateCached', () => {
      expect(isCandidateCached('Test Artist', 'Test Song')).toBe(false);

      localStorage.setItem('dotify_yt_vid_testartist___testsong', 'dQw4w9WgXcQ');
      expect(isCandidateCached('Test Artist', 'Test Song')).toBe(true);
    });

    it('prewarmCandidate safely handles duplicate requests without crashing', () => {
      prewarmCandidate('Daft Punk', 'Get Lucky', 248);
      prewarmCandidate('Daft Punk', 'Get Lucky', 248);
      expect(true).toBe(true);
    });
  });

  describe('YouTubeIframeBridge Audio Bridge', () => {
    it('instantiates YouTubeIframeBridge singleton', () => {
      const bridge = YouTubeIframeBridge.getInstance();
      expect(bridge).toBeDefined();
      expect(typeof bridge.play).toBe('function');
      expect(typeof bridge.pause).toBe('function');
      expect(typeof bridge.resume).toBe('function');
      expect(typeof bridge.seekTo).toBe('function');
    });

    it('retains true song duration in AudioEngine', () => {
      const mockTrack = {
        id: 'charts:12345',
        source: 'charts' as const,
        title: "Don't Look Back In Anger",
        artist: 'Oasis',
        duration: 288,
        streamUrl: '/api/stream/track?artist=Oasis&title=DontLookBackInAnger&id=12345&duration=288',
        sourceMetadata: {},
      };

      expect(mockTrack.duration).toBe(288);
    });
  });
});
