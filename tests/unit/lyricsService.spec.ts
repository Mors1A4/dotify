import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  cleanTrackMetadata,
  parseLrc,
  alignPlainLyrics,
  lyricsService,
} from '../../src/services/lyricsService';
import { useLyricsStore } from '../../src/store/lyricsStore';
import { Track } from '../../src/types/track';

describe('Lyrics Service & Time-Tracked Karaoke Engine', () => {
  beforeEach(() => {
    useLyricsStore.getState().clearLyrics();
  });

  describe('Track Metadata Normalization', () => {
    it('strips video clutter, official video tags, and suffixes', () => {
      const res1 = cleanTrackMetadata('Yellow (Official Audio)', 'Coldplay - Topic');
      expect(res1.cleanTitle).toBe('Yellow');
      expect(res1.cleanArtist).toBe('Coldplay');

      const res2 = cleanTrackMetadata('Starboy [Official Music Video] ft. Daft Punk', 'The Weeknd');
      expect(res2.cleanTitle).toBe('Starboy');
      expect(res2.cleanArtist).toBe('The Weeknd');

      const res3 = cleanTrackMetadata('In The End (Remastered HD)', 'Linkin Park');
      expect(res3.cleanTitle).toBe('In The End');
      expect(res3.cleanArtist).toBe('Linkin Park');
    });

    it('handles clean titles without unnecessary modification', () => {
      const res = cleanTrackMetadata('Bohemian Rhapsody', 'Queen');
      expect(res.cleanTitle).toBe('Bohemian Rhapsody');
      expect(res.cleanArtist).toBe('Queen');
    });
  });

  describe('LRC Synchronized Parser', () => {
    it('parses standard [mm:ss.xx] lines into structured timestamps', () => {
      const lrc = `
[00:10.50]First line of lyrics
[00:15.20]Second line of lyrics
[00:20.80]Third line of lyrics
`;
      const parsed = parseLrc(lrc, 180);
      expect(parsed).toHaveLength(3);

      expect(parsed[0].time).toBe(10.5);
      expect(parsed[0].text).toBe('First line of lyrics');
      expect(parsed[0].endTime).toBe(15.2);

      expect(parsed[1].time).toBe(15.2);
      expect(parsed[1].text).toBe('Second line of lyrics');
      expect(parsed[1].endTime).toBe(20.8);

      expect(parsed[2].time).toBe(20.8);
      expect(parsed[2].text).toBe('Third line of lyrics');
      expect(parsed[2].endTime).toBe(26.8); // +6s fallback or duration bounded
    });

    it('parses 3-digit millisecond timestamps [mm:ss.xxx]', () => {
      const lrc = `
[01:05.123]Line with high-res millisecond precision
[01:10.000]Next line
`;
      const parsed = parseLrc(lrc);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].time).toBe(65.12);
      expect(parsed[1].time).toBe(70);
    });

    it('handles multiple timestamps per line (repeating choruses)', () => {
      const lrc = `
[00:12.00][00:45.00]I want it that way
`;
      const parsed = parseLrc(lrc);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].time).toBe(12);
      expect(parsed[0].text).toBe('I want it that way');
      expect(parsed[1].time).toBe(45);
      expect(parsed[1].text).toBe('I want it that way');
    });

    it('skips metadata header tags gracefully', () => {
      const lrc = `
[ti:Yellow]
[ar:Coldplay]
[al:Parachutes]
[length:04:29]
[00:35.66]Look at the stars
`;
      const parsed = parseLrc(lrc);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].text).toBe('Look at the stars');
      expect(parsed[0].time).toBe(35.66);
    });

    it('detects empty lines as instrumental sections', () => {
      const lrc = `
[00:10.00]Vocal intro
[00:20.00]
[00:35.00]Chorus arrives
`;
      const parsed = parseLrc(lrc);
      expect(parsed).toHaveLength(3);
      expect(parsed[1].isInstrumental).toBe(true);
      expect(parsed[1].time).toBe(20);
      expect(parsed[1].endTime).toBe(35);
    });
  });

  describe('Algorithmic Plain Lyrics Aligner', () => {
    it('distributes plain text lines smoothly across song timeline', () => {
      const plain = `
Is this the real life?
Is this just fantasy?
Caught in a landslide, no escape from reality
Open your eyes, look up to the skies and see
`;
      const aligned = alignPlainLyrics(plain, 240);
      expect(aligned).toHaveLength(4);

      // Chronological order check
      for (let i = 0; i < aligned.length; i++) {
        expect(aligned[i].time).toBeLessThan(aligned[i].endTime);
        if (i > 0) {
          expect(aligned[i].time).toBeGreaterThanOrEqual(aligned[i - 1].time);
        }
      }

      // Check intro offset is respected (starts around 8-24s into the song)
      expect(aligned[0].time).toBeGreaterThanOrEqual(8);
      // Check last line completes before end of song
      expect(aligned[aligned.length - 1].endTime).toBeLessThanOrEqual(240);
    });

    it('handles empty or blank plain lyrics', () => {
      expect(alignPlainLyrics('', 200)).toEqual([]);
      expect(alignPlainLyrics('   \n  \n', 200)).toEqual([]);
    });
  });

  describe('LyricsService Cache & Pipeline', () => {
    const mockTrack: Track = {
      id: 'test_track_1',
      source: 'charts',
      title: 'Viva La Vida',
      artist: 'Coldplay',
      duration: 242,
      streamUrl: 'https://example.com/audio.mp3',
      sourceMetadata: {},
    };

    it('generates consistent cache keys', () => {
      const key1 = lyricsService.getCacheKey(mockTrack);
      const key2 = lyricsService.getCacheKey({
        ...mockTrack,
        title: 'Viva La Vida (Official Video)',
        artist: 'Coldplay - Topic',
      });
      expect(key1).toBe('coldplay:::viva la vida');
      expect(key2).toBe('coldplay:::viva la vida');
    });

    it('stores and retrieves cached lyrics from memory and safeStorage', () => {
      const dummyData = {
        trackId: mockTrack.id,
        title: mockTrack.title,
        artist: mockTrack.artist,
        source: 'lrclib' as const,
        synced: true,
        lines: [{ id: '1', time: 10, endTime: 15, text: 'I used to rule the world' }],
        timestamp: Date.now(),
      };

      lyricsService.setCachedLyrics(mockTrack, dummyData);
      const retrieved = lyricsService.getCachedLyrics(mockTrack);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.lines[0].text).toBe('I used to rule the world');
    });
  });

  describe('Lyrics Zustand Store', () => {
    it('manages activeLineIndex and font size correctly', () => {
      const store = useLyricsStore.getState();
      expect(store.activeLineIndex).toBe(-1);

      store.setActiveLineIndex(3);
      expect(useLyricsStore.getState().activeLineIndex).toBe(3);

      store.setFontSize('large');
      expect(useLyricsStore.getState().fontSize).toBe('large');

      store.setAutoScrollEnabled(false);
      expect(useLyricsStore.getState().isAutoScrollEnabled).toBe(false);

      store.setNextVocalCountdown(5);
      expect(useLyricsStore.getState().nextVocalCountdown).toBe(5);

      store.clearLyrics();
      expect(useLyricsStore.getState().activeLineIndex).toBe(-1);
      expect(useLyricsStore.getState().nextVocalCountdown).toBeNull();
    });
  });

  describe('Player Store Lyrics & Drawer Integration', () => {
    it('supports toggling lyrics modal and right drawer lyrics tab', async () => {
      const { usePlayerStore } = await import('../../src/store/playerStore');

      // Test RightDrawer lyrics tab
      usePlayerStore.getState().toggleRightDrawer('lyrics');
      expect(usePlayerStore.getState().isRightDrawerOpen).toBe(true);
      expect(usePlayerStore.getState().rightDrawerTab).toBe('lyrics');

      // Test Lyrics Modal toggle
      expect(usePlayerStore.getState().isLyricsModalOpen).toBe(false);
      usePlayerStore.getState().toggleLyricsModal(true);
      expect(usePlayerStore.getState().isLyricsModalOpen).toBe(true);

      usePlayerStore.getState().toggleLyricsModal(false);
      expect(usePlayerStore.getState().isLyricsModalOpen).toBe(false);
    });
  });
});
