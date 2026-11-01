import { create } from 'zustand';
import { Track } from '../types/track';
import { LyricsData, lyricsService } from '../services/lyricsService';

export interface LyricsStoreState {
  currentTrackId: string | null;
  lyrics: LyricsData | null;
  isLoading: boolean;
  error: string | null;
  activeLineIndex: number;
  nextVocalCountdown: number | null;
  isAutoScrollEnabled: boolean;
  fontSize: 'small' | 'medium' | 'large';

  // Actions
  fetchLyricsForTrack: (track: Track | null) => Promise<void>;
  setActiveLineIndex: (index: number) => void;
  setNextVocalCountdown: (seconds: number | null) => void;
  setAutoScrollEnabled: (enabled: boolean) => void;
  setFontSize: (size: 'small' | 'medium' | 'large') => void;
  clearLyrics: () => void;
}

export const useLyricsStore = create<LyricsStoreState>((set, get) => ({
  currentTrackId: null,
  lyrics: null,
  isLoading: false,
  error: null,
  activeLineIndex: -1,
  nextVocalCountdown: null,
  isAutoScrollEnabled: true,
  fontSize: 'medium',

  fetchLyricsForTrack: async (track: Track | null) => {
    if (!track) {
      set({ currentTrackId: null, lyrics: null, isLoading: false, error: null, activeLineIndex: -1, nextVocalCountdown: null });
      return;
    }

    if (get().currentTrackId === track.id && get().lyrics) {
      return;
    }

    // Check fast cache synchronously
    const cached = lyricsService.getCachedLyrics(track);
    if (cached) {
      set({
        currentTrackId: track.id,
        lyrics: cached,
        isLoading: false,
        error: null,
        activeLineIndex: -1,
        nextVocalCountdown: null,
      });
      return;
    }

    set({ currentTrackId: track.id, isLoading: true, error: null, activeLineIndex: -1, nextVocalCountdown: null });

    try {
      const data = await lyricsService.getLyrics(track);
      // Ensure track hasn't changed during fetch
      if (get().currentTrackId === track.id) {
        set({
          lyrics: data,
          isLoading: false,
          error: data ? null : 'No lyrics available for this song',
        });
      }
    } catch (e: any) {
      if (get().currentTrackId === track.id) {
        set({
          lyrics: null,
          isLoading: false,
          error: e?.message || 'Failed to load lyrics',
        });
      }
    }
  },

  setActiveLineIndex: (index: number) => {
    if (get().activeLineIndex !== index) {
      set({ activeLineIndex: index });
    }
  },

  setNextVocalCountdown: (seconds: number | null) => {
    if (get().nextVocalCountdown !== seconds) {
      set({ nextVocalCountdown: seconds });
    }
  },

  setAutoScrollEnabled: (enabled: boolean) => {
    set({ isAutoScrollEnabled: enabled });
  },

  setFontSize: (size: 'small' | 'medium' | 'large') => {
    set({ fontSize: size });
  },

  clearLyrics: () => {
    set({
      currentTrackId: null,
      lyrics: null,
      isLoading: false,
      error: null,
      activeLineIndex: -1,
      nextVocalCountdown: null,
    });
  },
}));
