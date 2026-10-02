import { create } from 'zustand';
import { Track } from '../types/track';
import {
  VibeDjState,
  VibeVector,
  VibeDjTrackRecommendation,
  VibeDjArtistRecommendation,
  VibeDjHistoryItem,
} from '../types/vibeDj';
import { vibeDjEngine } from '../services/vibeDjEngine';
import { telemetryDb } from '../services/telemetryDb';
import { safeStorage } from '../utils/storage';

interface VibeDjStoreActions {
  startVibeDj: (seedTrack?: Track | null) => Promise<void>;
  stopVibeDj: () => void;
  shakeUpVibe: () => Promise<void>;
  popNextDjTrack: () => Promise<Track | null>;
  recordTrackEvent: (
    track: Track,
    event: 'completed' | 'skipped' | 'replayed' | 'liked',
    completionRate?: number,
    durationPlayedMs?: number
  ) => void;
  refreshRecommendations: () => Promise<void>;
  playRecommendedArtist: (artist: VibeDjArtistRecommendation) => Promise<void>;
}

export type VibeDjStore = VibeDjState & VibeDjStoreActions;

const initialVector: VibeVector = {
  energy: 0.70,
  danceability: 0.75,
  mood: 0.65,
  acousticness: 0.20,
  tempoNormalized: 0.62,
  familiarity: 0.60,
  genreWeights: {
    'Electronic & Dance': 0.45,
    'Pop & Anthems': 0.25,
    'Hip-Hop & Urban': 0.15,
    'Chill & Lo-Fi': 0.15,
    'Rock & Alternative': 0.0,
    'Acoustic & Folk': 0.0,
    'Jazz & Soul': 0.0,
    'Classical & Cinematic': 0.0,
  },
};

const defaultTheme = vibeDjEngine.getThemeForVector(initialVector);

export const useVibeDjStore = create<VibeDjStore>((set, get) => ({
  isActive: false,
  vibeLabel: defaultTheme.label,
  vibeTagline: defaultTheme.tagline,
  themeColor: defaultTheme.themeColor,
  themeGradient: defaultTheme.themeGradient,
  accentColor: defaultTheme.accentColor,
  currentVector: initialVector,
  djQueue: [],
  history: [],
  recommendedArtists: [],
  shakeCount: 0,
  lastShakeTimestamp: 0,
  isShaking: false,
  isGenerating: false,
  statusMessage: undefined,

  startVibeDj: async (seedTrack?: Track | null) => {
    set({ isGenerating: true, statusMessage: 'Reading your listening vibe...' });

    // 1. Fetch recent telemetry to calibrate vector
    let recentPlays: any[] = [];
    try {
      recentPlays = await telemetryDb.getAllPlays();
    } catch {}

    const { usePlayerStore } = await import('./playerStore');
    const playerStore = usePlayerStore.getState();
    const effectiveSeed = seedTrack || playerStore.currentTrack || null;

    // 2. Initialize vibe vector
    const vector = vibeDjEngine.createInitialVibeVector(effectiveSeed, recentPlays);
    const theme = vibeDjEngine.getThemeForVector(vector);

    set({
      isActive: true,
      currentVector: vector,
      vibeLabel: theme.label,
      vibeTagline: theme.tagline,
      themeColor: theme.themeColor,
      themeGradient: theme.themeGradient,
      accentColor: theme.accentColor,
      history: effectiveSeed
        ? [{ track: effectiveSeed, playedAt: Date.now(), vibeReason: 'Session starter' }]
        : [],
    });

    // 3. Generate initial DJ queue & artist recommendations
    try {
      set({ statusMessage: 'Curating sequential flow tailored to you...' });
      const { queue, recommendedArtists } = await vibeDjEngine.generateNextDjQueue(
        vector,
        get().history,
        8
      );

      set({
        djQueue: queue,
        recommendedArtists,
        isGenerating: false,
        statusMessage: undefined,
      });

      // 4. If nothing was playing or seedTrack is different, start playing the top match
      if (queue.length > 0) {
        const firstRecommendation = queue[0];
        const queueTracks = queue.map((q) => q.track);

        if (!playerStore.currentTrack || seedTrack) {
          playerStore.playTrack(firstRecommendation.track, queueTracks, 0, {
            origin: 'vibe_playlist',
            intent: 'exploratory',
            playlistName: theme.label,
          });
          // Pop the first one from DJ queue as it is now playing
          set({ djQueue: queue.slice(1) });
        }
      }
    } catch (err) {
      console.warn('[VibeDjStore] Error generating initial queue:', err);
      set({ isGenerating: false, statusMessage: undefined });
    }
  },

  stopVibeDj: () => {
    set({ isActive: false, djQueue: [] });
  },

  shakeUpVibe: async () => {
    const { currentVector, isShaking, history } = get();
    if (isShaking) return;

    set({ isShaking: true, statusMessage: 'Pivoting the vibe...' });

    // Rotate the vector dramatically
    const { newVector, theme } = vibeDjEngine.shakeUpVibe(currentVector);

    set({
      currentVector: newVector,
      vibeLabel: theme.label,
      vibeTagline: theme.tagline,
      themeColor: theme.themeColor,
      themeGradient: theme.themeGradient,
      accentColor: theme.accentColor,
      shakeCount: get().shakeCount + 1,
      lastShakeTimestamp: Date.now(),
    });

    try {
      // Generate fresh set strictly matching the new vibe
      const { queue, recommendedArtists } = await vibeDjEngine.generateNextDjQueue(
        newVector,
        history,
        8
      );

      set({
        djQueue: queue,
        recommendedArtists,
        isShaking: false,
        statusMessage: undefined,
      });

      // Immediately play the #1 track of the fresh vibe
      if (queue.length > 0) {
        const { usePlayerStore } = await import('./playerStore');
        const playerStore = usePlayerStore.getState();
        const topTrack = queue[0].track;
        const newTracks = queue.map((q) => q.track);

        playerStore.playTrack(topTrack, newTracks, 0, {
          origin: 'vibe_playlist',
          intent: 'exploratory',
          playlistName: theme.label,
        });

        // Pop the first one
        set({ djQueue: queue.slice(1) });
      }
    } catch (err) {
      console.warn('[VibeDjStore] Error during shake up:', err);
      set({ isShaking: false, statusMessage: undefined });
    }
  },

  popNextDjTrack: async (): Promise<Track | null> => {
    const { djQueue, currentVector, history } = get();

    if (djQueue.length === 0) {
      // Emergency refill
      set({ isGenerating: true });
      try {
        const { queue } = await vibeDjEngine.generateNextDjQueue(currentVector, history, 6);
        set({ isGenerating: false });
        if (queue.length > 0) {
          const next = queue[0].track;
          set({ djQueue: queue.slice(1) });
          return next;
        }
      } catch {
        set({ isGenerating: false });
      }
      return null;
    }

    const nextRec = djQueue[0];
    const remaining = djQueue.slice(1);
    set({ djQueue: remaining });

    // Background refill when queue gets low (< 4 tracks)
    if (remaining.length < 4 && !get().isGenerating) {
      get().refreshRecommendations();
    }

    return nextRec.track;
  },

  recordTrackEvent: (
    track: Track,
    event: 'completed' | 'skipped' | 'replayed' | 'liked',
    completionRate: number = 1.0,
    durationPlayedMs: number = 0
  ) => {
    const { currentVector, history } = get();

    // 1. Update the session vibe vector
    const updatedVector = vibeDjEngine.updateSessionVibeVector(
      currentVector,
      track,
      event,
      completionRate
    );
    const theme = vibeDjEngine.getThemeForVector(updatedVector);

    // 2. Add to session history
    const historyItem: VibeDjHistoryItem = {
      track,
      playedAt: Date.now(),
      durationPlayedMs,
      completionRate,
      skipped: event === 'skipped',
      replayed: event === 'replayed',
    };

    set({
      currentVector: updatedVector,
      vibeLabel: theme.label,
      vibeTagline: theme.tagline,
      themeColor: theme.themeColor,
      themeGradient: theme.themeGradient,
      accentColor: theme.accentColor,
      history: [historyItem, ...history.slice(0, 30)],
    });

    // 3. If skipped, refresh recommendations immediately to steer away from the skipped vibe!
    if (event === 'skipped') {
      get().refreshRecommendations();
    }
  },

  refreshRecommendations: async () => {
    if (get().isGenerating) return;
    set({ isGenerating: true });

    try {
      const { currentVector, history, djQueue } = get();
      const { queue, recommendedArtists } = await vibeDjEngine.generateNextDjQueue(
        currentVector,
        history,
        8
      );

      // Merge avoiding duplicates
      const seenIds = new Set(djQueue.map((d) => d.track.id));
      const newItems = queue.filter((q) => !seenIds.has(q.track.id));

      set({
        djQueue: [...djQueue, ...newItems].slice(0, 10),
        recommendedArtists,
        isGenerating: false,
      });
    } catch (err) {
      console.warn('[VibeDjStore] Failed to replenish DJ queue:', err);
      set({ isGenerating: false });
    }
  },

  playRecommendedArtist: async (artist: VibeDjArtistRecommendation) => {
    try {
      const { searchCharts } = await import('../services/chartsApi');
      const results = await searchCharts(artist.name, 15);
      if (results && results.length > 0) {
        const { usePlayerStore } = await import('./playerStore');
        usePlayerStore.getState().playTrack(results[0], results, 0, {
          origin: 'artist',
          intent: 'favoured',
          artistName: artist.name,
        });
      }
    } catch (err) {
      console.warn('[VibeDjStore] Error playing recommended artist:', err);
    }
  },
}));
