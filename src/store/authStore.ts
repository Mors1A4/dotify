import { create } from 'zustand';
import { User } from 'firebase/auth';
import { authService } from '../services/authService';
import { usePlayerStore } from './playerStore';
import { safeStorage } from '../utils/storage';

export interface AuthState {
  user: User | null;
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  isAuthModalOpen: boolean;

  openAuthModal: () => void;
  closeAuthModal: () => void;
  signIn: () => Promise<void>;
  signInWithFastProfile: (nameOrEmail: string) => Promise<void>;
  signOut: () => Promise<void>;
  initAuth: () => () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,
  isSyncing: false,
  error: null,
  isAuthModalOpen: false,

  openAuthModal: () => set({ isAuthModalOpen: true }),
  closeAuthModal: () => set({ isAuthModalOpen: false }),

  signIn: async () => {
    set({ isLoading: true, error: null });
    try {
      const user = await authService.signInWithGoogle();
      set({ user, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to sign in with Google', isLoading: false });
    }
  },

  signInWithFastProfile: async (nameOrEmail: string) => {
    set({ isLoading: true, error: null });
    try {
      const user = await authService.signInWithFastProfile(nameOrEmail);
      set({ user, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to connect profile', isLoading: false });
    }
  },

  signOut: async () => {
    set({ isLoading: true, error: null });
    try {
      await authService.signOutUser();
      set({ user: null, isLoading: false });
    } catch (err: any) {
      set({ error: err.message || 'Failed to sign out', isLoading: false });
    }
  },

  initAuth: () => {
    let realtimeUnsub: (() => void) | null = null;

    const unsub = authService.subscribeToAuth(async (user) => {
      set({ user, isLoading: false });

      if (realtimeUnsub) {
        realtimeUnsub();
        realtimeUnsub = null;
      }

      if (user) {
        set({ isSyncing: true });
        try {
          const library = await authService.loadUserLibrary(user.uid);
          if (library) {
            usePlayerStore.getState().setUserLibrary(
              library.likedTracks,
              library.playlists,
              library.history,
              user.uid,
              library.followedArtists || []
            );
          }
        } finally {
          set({ isSyncing: false });
        }

        // Realtime cross-device sync: changes on PC update Phone in real time, and vice-versa!
        realtimeUnsub = authService.subscribeToUserLibrary(user.uid, (data) => {
          console.log('[AuthStore] Realtime cloud update received from another device for:', user.uid);
          usePlayerStore.getState().setUserLibrary(
            data.likedTracks,
            data.playlists,
            data.history,
            user.uid,
            data.followedArtists || []
          );
        });
      } else {
        // Reset to guest library
        const guestLiked = safeStorage.getItem('likedTracks', []);
        const guestPlaylists = safeStorage.getItem('playlists', []);
        const guestHistory = safeStorage.getItem('history', []);
        const guestFollowed = safeStorage.getItem('followed_artists', []);
        usePlayerStore.getState().setUserLibrary(guestLiked, guestPlaylists, guestHistory, null, guestFollowed);
      }
    });

    return () => {
      if (realtimeUnsub) realtimeUnsub();
      unsub();
    };
  },
}));
