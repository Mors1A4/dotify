import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isCandidateCached,
  prewarmCandidate,
  resolveYouTubeVideoId,
} from '../../src/services/youtubeResolver';
import { YouTubeIframeBridge } from '../../src/audio/youtubeIframeBridge';
import { audioEngine } from '../../src/audio/audioEngine';
import { formatChartTrack } from '../../src/services/chartsApi';

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

  describe('ChartsApi Preview URL Attachment', () => {
    it('attaches previewUrl into sourceMetadata for instant fast-start playback', () => {
      const mockDeezerItem = {
        id: 123456,
        title: 'Instant Hit',
        artist: { name: 'Fast Band' },
        duration: 210,
        preview: 'https://cdnt-preview.dzcdn.net/sample.mp3',
      };

      const track = formatChartTrack(mockDeezerItem);
      expect(track.sourceMetadata.previewUrl).toBe('https://cdnt-preview.dzcdn.net/sample.mp3');
    });
  });

  describe('Dual-Deck YouTube Bridge & Fast-Start Burst Setting', () => {
    it('instantiates YouTubeIframeBridge singleton with dual-deck support', () => {
      const bridge = YouTubeIframeBridge.getInstance();
      expect(bridge).toBeDefined();
      expect(typeof bridge.cueNext).toBe('function');
      expect(typeof bridge.play).toBe('function');
    });

    it('toggles fast start burst setting in AudioEngine and persists to localStorage', () => {
      audioEngine.setFastStartBurstEnabled(true);
      expect(audioEngine.isFastStartBurst()).toBe(true);
      expect(localStorage.getItem('dotify_fast_start_burst')).toBe('true');

      audioEngine.setFastStartBurstEnabled(false);
      expect(audioEngine.isFastStartBurst()).toBe(false);
      expect(localStorage.getItem('dotify_fast_start_burst')).toBe('false');

      // Reset to true
      audioEngine.setFastStartBurstEnabled(true);
      expect(audioEngine.isFastStartBurst()).toBe(true);
    });
  });
});
