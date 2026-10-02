import { create } from 'zustand';
import { Track } from '../types/track';
import { CustomPlaylist } from '../types/playlist';
import { FollowedArtist } from '../types/artist';
import { audioEngine } from '../audio/audioEngine';
import { audioCache } from '../audio/audioCache';
import { updateMediaSession, updateMediaSessionPlaybackState } from '../audio/mediaSession';
import { safeStorage } from '../utils/storage';
import { telemetryDb } from '../services/telemetryDb';
import { recommendationEngine } from '../services/recommendationEngine';
import { DeviceType, PlayOrigin, PlayIntent, PlayContext } from '../types/telemetry';
import { listeningClassifier } from '../services/listeningClassifier';
import {
  ConnectMode,
  ConnectedDevice,
  PlaybackSnapshot,
  PlaybackStatePayload,
  RemoteCommand,
  RemoteCommandAction,
} from '../types/connect';
import { connectClient } from '../services/connectClient';
import { authService } from '../services/authService';
import { upgradeArtworkUrl } from '../utils/artwork';
import { useMp3VaultStore } from '../services/mp3VaultService';
import { communityListeningService } from '../services/communityListeningService';

export class RemoteProgressInterpolator {
  private anchorPositionSec: number = 0;
  private durationSec: number = 0;
  private anchorLocalPerfTime: number = 0;
  private isPlaying: boolean = false;
  private intervalId: any = null;
  private clockOffsetMs: number = 0;

  public setClockOffset(offsetMs: number) {
    this.clockOffsetMs = offsetMs;
  }

  public sync(params: {
    positionMs: number;
    durationMs: number;
    isPlaying: boolean;
    remoteTimestamp: number;
  }) {
    const nowLocal = Date.now();
    const estimatedRemoteNow = nowLocal + this.clockOffsetMs;
    const transitMs = Math.max(0, estimatedRemoteNow - params.remoteTimestamp);

    const adjustedPositionMs = params.isPlaying
      ? params.positionMs + transitMs
      : params.positionMs;

    const newPositionSec = adjustedPositionMs / 1000;
    const newDurationSec = params.durationMs > 0 ? params.durationMs / 1000 : 0;

    const currentEst = this.getCurrentPosition();
    const diff = Math.abs(newPositionSec - currentEst);

    this.isPlaying = params.isPlaying;
    this.durationSec = newDurationSec;

    const perfNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (diff > 1.0 || !this.isPlaying) {
      this.anchorPositionSec = Math.max(0, newPositionSec);
      this.anchorLocalPerfTime = perfNow;
    } else {
      this.anchorPositionSec = currentEst + (newPositionSec - currentEst) * 0.3;
      this.anchorLocalPerfTime = perfNow;
    }

    this.tick();
    this.ensureLoop();
  }

  public seek(seconds: number) {
    this.anchorPositionSec = Math.max(0, seconds);
    this.anchorLocalPerfTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.tick();
  }

  public resetForTrack(durationSec: number = 0) {
    this.anchorPositionSec = 0;
    this.durationSec = durationSec > 0 ? durationSec : 0;
    this.anchorLocalPerfTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.isPlaying = true;
    this.tick();
    this.ensureLoop();
  }

  public getCurrentPosition(): number {
    if (!this.isPlaying) return this.anchorPositionSec;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsedSec = (now - this.anchorLocalPerfTime) / 1000;
    const pos = this.anchorPositionSec + elapsedSec;
    if (this.durationSec > 0) {
      return Math.min(pos, this.durationSec);
    }
    return pos;
  }

  private tick() {
    const cur = this.getCurrentPosition();
    audioEngine.emitSyntheticTimeUpdate(cur, this.durationSec);
  }

  public start() {
    this.ensureLoop();
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isPlaying = false;
  }

  private ensureLoop() {
    if (this.intervalId || !this.isPlaying) return;
    this.intervalId = setInterval(() => {
      this.tick();
    }, 16);
  }
}

export const remoteProgressInterpolator = new RemoteProgressInterpolator();

export type AppView = 'home' | 'search' | 'radio' | 'archive' | 'torrents' | 'library' | 'artist' | 'album' | 'playlist';

// Backward compatibility alias for Playlist
export type Playlist = CustomPlaylist;

export interface SelectedArtistState {
  id: string;
  name: string;
}

export interface SelectedAlbumState {
  id: string | number;
  title: string;
  artist: string;
  coverUrl?: string;
  year?: string;
  recordType?: string;
  tracks?: Track[];
}

export interface NavigationEntry {
  view: AppView;
  selectedArtist?: SelectedArtistState | null;
  selectedAlbum?: SelectedAlbumState | null;
  selectedPlaylistId?: string | null;
  searchQuery?: string;
  sourceFilter?: 'all' | 'charts' | 'audius' | 'archive' | 'radio' | 'p2p';
}

export interface PlayerStoreState {
  currentTrack: Track | null;
  currentTrackIndex: number;
  queue: Track[];
  history: Track[];
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
  repeatMode: 'off' | 'all' | 'one';
  shuffle: boolean;
  autoplayEnabled: boolean;

  // Navigation
  activeView: AppView;
  currentView: AppView; // Backwards-compatible alias for activeView
  previousView: AppView;
  selectedArtist: SelectedArtistState | null;
  selectedAlbum: SelectedAlbumState | null;
  selectedPlaylistId: string | null;
  searchQuery: string;
  sourceFilter: 'all' | 'charts' | 'audius' | 'archive' | 'radio' | 'p2p';
  navHistory: NavigationEntry[];
  navHistoryIndex: number;
  canNavigateBack: boolean;
  canNavigateForward: boolean;

  // Drawers & Overlays
  isRightDrawerOpen: boolean;
  rightDrawerTab: 'queue' | 'equalizer';
  isMobileSheetOpen: boolean;
  isVisualizerOpen: boolean;
  isSidebarCollapsed: boolean;
  isDevicePickerOpen: boolean;
  isCreatePlaylistModalOpen: boolean;
  createPlaylistModalTab: 'custom' | 'spotify';
  createPlaylistInitialTracks: Track[];

  // Spotify Connect State
  connectMode: ConnectMode;
  activeDevice: ConnectedDevice | null;
  remoteDevices: ConnectedDevice[];
  isTransferringPlayback: boolean;
  transferringToId: string | null;

  // Persistence
  likedTracks: Track[];
  playlists: CustomPlaylist[];
  followedArtists: FollowedArtist[];

  playTrack: (
    track: Track,
    newQueue?: Track[],
    trackIndex?: number,
    playContext?: PlayContext | PlayOrigin
  ) => void;
  togglePlay: () => void;
  nextTrack: () => void;
  previousTrack: () => void;
  seekTo: (seconds: number) => void;
  setVolume: (vol: number) => void;
  setRepeatMode: (mode: 'off' | 'all' | 'one') => void;
  toggleShuffle: () => void;
  enableAutoplay: (enabled: boolean) => void;
  toggleAutoplay: () => void;
  triggerAutoplayIfNeeded: (reason?: 'approaching_end' | 'track_start' | 'queue_exhausted') => Promise<void>;

  // Spotify Connect Actions
  toggleDevicePicker: (open?: boolean) => void;
  setConnectMode: (mode: ConnectMode, activeDevice?: ConnectedDevice | null) => void;
  setRemoteDevices: (devices: ConnectedDevice[]) => void;
  applyRemotePlaybackState: (state: PlaybackStatePayload) => void;
  executeRemoteCommand: (action: string, data?: any) => void;
  transferPlaybackTo: (targetDeviceId: string) => Promise<boolean>;
  initiateHandoff: (targetDeviceId: string) => Promise<boolean>;
  setRemoteVolume: (targetDeviceId: string, volume: number) => void;

  // Enhanced Queue Actions
  setQueue: (queue: Track[]) => void;
  playNext: (track: Track | Track[]) => void;
  addToEnd: (track: Track | Track[]) => void;
  addToQueue: (track: Track) => void; // Kept as alias to addToEnd
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;

  // View & UI actions
  setActiveView: (view: AppView) => void;
  navigateToArtist: (artistName: string, artistId?: string) => void;
  navigateToAlbum: (album: SelectedAlbumState) => void;
  navigateToPlaylist: (playlistId: string) => void;
  addAlbumToLibrary: (album: SelectedAlbumState, tracks: Track[]) => void;
  removeAlbumFromLibrary: (albumTitle: string) => void;
  isAlbumInLibrary: (albumTitle: string) => boolean;
  navigateBack: () => void;
  navigateForward: () => void;
  setSearchQuery: (q: string) => void;
  setSourceFilter: (filter: 'all' | 'charts' | 'audius' | 'archive' | 'radio' | 'p2p') => void;
  toggleRightDrawer: (tab?: 'queue' | 'equalizer') => void;
  toggleMobileSheet: (open?: boolean) => void;
  toggleVisualizer: (open?: boolean) => void;
  toggleSidebarCollapse: () => void;
  openCreatePlaylistModal: (tab?: 'custom' | 'spotify', initialTracks?: Track[]) => void;
  closeCreatePlaylistModal: () => void;

  // Library & Playlist actions
  toggleLike: (track: Track) => void;
  isLiked: (trackId: string) => boolean;
  toggleFollowArtist: (artist: { id?: string; name: string; imageUrl?: string; genres?: string[] }) => void;
  isFollowingArtist: (artistNameOrId: string) => boolean;
  createPlaylist: (name: string, description?: string, coverArt?: string, initialTracks?: Track[]) => string;
  renamePlaylist: (playlistId: string, newName: string) => void;
  updatePlaylistDetails: (
    playlistId: string,
    details: { name?: string; description?: string; coverArt?: string }
  ) => void;
  deletePlaylist: (playlistId: string) => void;
  reorderPlaylistTracks: (playlistId: string, fromIndex: number, toIndex: number) => void;
  addTrackToPlaylist: (playlistId: string, track: Track) => void;
  addTracksToPlaylist: (playlistId: string, tracks: Track[]) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  importCustomPlaylist: (playlist: Omit<CustomPlaylist, 'id' | 'createdAt' | 'updatedAt'>) => string;
  setUserLibrary: (
    liked: Track[],
    playlists: CustomPlaylist[],
    historyOrUserId?: Track[] | string | null,
    maybeUserId?: string | null,
    followedArtists?: FollowedArtist[]
  ) => void;
}

const STORAGE_LIKED = 'liked';
const STORAGE_PLAYLISTS = 'user_playlists';
const STORAGE_HISTORY = 'history';
const STORAGE_FOLLOWED_ARTISTS = 'followed_artists';
const STORAGE_VOLUME = 'audio_volume';
const STORAGE_AUTOPLAY = 'autoplay_enabled';

const isCleanTrack = (t: Track | null | undefined): boolean => {
  if (!t || typeof t !== 'object') return false;
  const id = String(t.id || '');
  const artist = String(t.artist || '').toLowerCase();
  const title = String(t.title || '').toLowerCase();
  if (id.includes('mock-')) return false;
  if (artist.includes('synthetic pulse') || title.includes('klarity')) return false;
  return true;
};

export const deduplicatePlaylists = (playlists: CustomPlaylist[]): CustomPlaylist[] => {
  if (!Array.isArray(playlists)) return [];
  const seenSpotifyUrls = new Set<string>();
  const seenNames = new Set<string>();
  const result: CustomPlaylist[] = [];

  for (const pl of playlists) {
    if (!pl || !pl.name) continue;
    const cleanName = pl.name.trim().toLowerCase();
    const cleanSpotifyUrl = pl.sourceSpotifyUrl?.trim().toLowerCase();

    if (cleanSpotifyUrl && seenSpotifyUrls.has(cleanSpotifyUrl)) {
      continue;
    }
    if (seenNames.has(cleanName)) {
      continue;
    }

    if (cleanSpotifyUrl) {
      seenSpotifyUrls.add(cleanSpotifyUrl);
    }
    seenNames.add(cleanName);
    result.push(pl);
  }

  return result;
};

const initialLiked = safeStorage.getItem<Track[]>(STORAGE_LIKED, []).filter(isCleanTrack);
const rawInitialPlaylists = safeStorage.getItem<CustomPlaylist[]>(STORAGE_PLAYLISTS, []);
const initialPlaylists: CustomPlaylist[] = deduplicatePlaylists(
  Array.isArray(rawInitialPlaylists)
    ? rawInitialPlaylists.map((pl) => ({
        ...pl,
        coverArt: pl.coverArt ? upgradeArtworkUrl(pl.coverArt) : pl.coverArt,
        tracks: Array.isArray(pl.tracks)
          ? pl.tracks.filter(isCleanTrack).map((t) => ({
              ...t,
              artworkUrl: upgradeArtworkUrl(t.artworkUrl),
            }))
          : [],
      }))
    : []
);
const initialHistory = safeStorage.getItem<Track[]>(STORAGE_HISTORY, []).filter(isCleanTrack);
const initialFollowedArtists = safeStorage.getItem<FollowedArtist[]>(STORAGE_FOLLOWED_ARTISTS, []);
const initialVolume = safeStorage.getItem<number>(STORAGE_VOLUME, 0.8);
const initialAutoplay = safeStorage.getItem<boolean>(STORAGE_AUTOPLAY, true);

let cloudLibrarySyncTimer: any = null;
export function scheduleCloudLibrarySync() {
  if (cloudLibrarySyncTimer) clearTimeout(cloudLibrarySyncTimer);
  cloudLibrarySyncTimer = setTimeout(() => {
    try {
      const user = authService.getCurrentUser();
      if (user && user.uid) {
        const state = usePlayerStore.getState();
        authService.saveUserLibrary(
          user.uid,
          state.likedTracks,
          state.playlists,
          state.history,
          state.followedArtists
        );
      }
    } catch (e) {
      console.debug('[PlayerStore] Cloud sync skipped:', e);
    }
  }, 1200);
}

let activePlaySessionId: string = `session_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
let currentQueueContext: PlayContext | null = null;
let activePlayRecord: {
  playId: string;
  track: Track;
  startTime: number;
  lastTick: number;
  durationPlayedMs: number;
  replayed: boolean;
  playContext?: PlayContext;
} | null = null;
let lastPlayedTrackId: string | null = null;

let isAutoplayFetching = false;
let activeAutoplayPromise: Promise<void> | null = null;
let lastAutoplaySeedTrackId: string | null = null;

let remoteVolumeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRemoteVolume: { targetDeviceId?: string; volume: number } | null = null;

function sendThrottledRemoteVolume(volume: number, targetDeviceId?: string) {
  pendingRemoteVolume = { targetDeviceId, volume };
  if (remoteVolumeTimer) return;

  remoteVolumeTimer = setTimeout(() => {
    remoteVolumeTimer = null;
    if (pendingRemoteVolume) {
      const { volume: vol, targetDeviceId: devId } = pendingRemoteVolume;
      pendingRemoteVolume = null;
      connectClient.sendRemoteCommand('set_volume', { volume: vol }, devId);
    }
  }, 75);
}

export const usePlayerStore = create<PlayerStoreState>((set, get, api) => {
  if (api) {
    (api as any).getInitialState = () => get();
  }
  // Sync initial volume to engine
  audioEngine.setVolume(initialVolume);

  const finalizeCurrentPlayRecord = async () => {
    if (get().connectMode === 'remote_controller') {
      activePlayRecord = null;
      return;
    }
    if (!activePlayRecord) return;
    const rec = activePlayRecord;
    activePlayRecord = null;
    try {
      const totalMs =
        rec.track.duration && isFinite(rec.track.duration) && rec.track.duration > 0
          ? rec.track.duration * 1000
          : rec.durationPlayedMs;
      await telemetryDb.recordPlay(
        activePlaySessionId,
        rec.track,
        rec.durationPlayedMs,
        totalMs,
        rec.replayed,
        rec.playContext
      );
      await telemetryDb.updateSession(activePlaySessionId, rec.durationPlayedMs);

      // Record to community listening if listened for at least 15s or 40% completed
      if (
        rec.durationPlayedMs >= 15000 ||
        (rec.track.duration && rec.durationPlayedMs / (rec.track.duration * 1000) >= 0.4)
      ) {
        const u = authService.getCurrentUser();
        communityListeningService.recordPlay(rec.track, u?.uid || 'guest');
      }
    } catch (err) {
      console.warn('[PlayerStore] Failed to record play telemetry:', err);
    }
  };

  const broadcastCurrentState = () => {
    const s = get();
    if (s.connectMode === 'remote_controller') return;
    connectClient.broadcastPlaybackState({
      currentTrack: s.currentTrack,
      activeTrack: s.currentTrack,
      currentTrackIndex: s.currentTrackIndex,
      currentIndex: s.currentTrackIndex,
      queue: s.queue,
      isPlaying: s.isPlaying,
      positionMs: Math.round(audioEngine.getCurrentTime() * 1000),
      durationMs: Math.round(audioEngine.getDuration() * 1000),
      volume: s.volume,
      repeatMode: s.repeatMode,
      shuffle: s.shuffle,
      timestamp: Date.now(),
    });
  };

  // Wire connectClient listeners
  connectClient.onDeviceListUpdate((devices, activeId) => {
    const active = devices.find((d) => d.deviceId === activeId) || null;
    set({
      remoteDevices: devices,
      activeDevice: active,
    });
  });

  connectClient.onPlaybackState((state) => {
    get().applyRemotePlaybackState(state);
  });

  connectClient.onRemoteCommand((command) => {
    get().executeRemoteCommand(command.action, command);
  });

  connectClient.onHandoffTransfer(async (snapshot, fromId) => {
    try {
      const { track, queue, currentTrackIndex, positionMs, isPlaying, volume, repeatMode, shuffle } = snapshot;
      set({
        queue,
        currentTrack: track,
        currentTrackIndex,
        volume,
        repeatMode,
        shuffle,
        connectMode: 'active_host',
        isPlaying,
      });

      audioEngine.setControllerMode(false);
      remoteProgressInterpolator.stop();

      await audioEngine.playTrackAtPosition(track, positionMs, isPlaying);

      connectClient.ackHandoff(fromId, true, positionMs);
      broadcastCurrentState();
    } catch (err: any) {
      console.warn('[PlayerStore] Handoff transfer execution failed:', err.message);
      connectClient.ackHandoff(fromId, false, snapshot.positionMs, undefined, err.message);
    }
  });

  const triggerAutoplayIfNeeded = async (reason: 'approaching_end' | 'track_start' | 'queue_exhausted') => {
    const { queue, currentTrack, currentTrackIndex, history, autoplayEnabled, repeatMode } = get();
    if (!autoplayEnabled || repeatMode !== 'off') return;
    if (!currentTrack && history.length === 0) return;

    const curIdx =
      currentTrackIndex >= 0
        ? currentTrackIndex
        : currentTrack
        ? queue.findIndex((t) => t.id === currentTrack.id)
        : -1;
    if (curIdx !== -1 && curIdx < queue.length - 1) return;

    if (currentTrack && lastAutoplaySeedTrackId === currentTrack.id && reason !== 'queue_exhausted') {
      return;
    }
    if (isAutoplayFetching) {
      if (reason === 'queue_exhausted' && activeAutoplayPromise) {
        await activeAutoplayPromise;
      }
      return;
    }

    const fetchPromise = (async () => {
      try {
        isAutoplayFetching = true;
        if (currentTrack) lastAutoplaySeedTrackId = currentTrack.id;

        const seedTracks = currentTrack ? [currentTrack, ...history.slice(0, 2)] : history.slice(0, 3);
        const candidates = await recommendationEngine.getAutoplayRecommendations(seedTracks, 5);

        if (candidates && candidates.length > 0) {
          const stateNow = get();
          if (!stateNow.autoplayEnabled || stateNow.repeatMode !== 'off') return;

          get().addToEnd(candidates);
          audioCache.prewarmTrack(candidates[0]);
          audioEngine.prebufferNextTrack(candidates[0]);

          if (reason === 'queue_exhausted' || (!stateNow.isPlaying && !stateNow.currentTrack) || (reason === 'approaching_end' && !get().isPlaying)) {
            get().playTrack(candidates[0], undefined, undefined, { origin: 'autoplay', intent: 'exploratory' });
          }
        }
      } catch (err) {
        console.warn('[PlayerStore] Autoplay recommendation fetch failed:', err);
      } finally {
        isAutoplayFetching = false;
        activeAutoplayPromise = null;
      }
    })();

    activeAutoplayPromise = fetchPromise;
    await fetchPromise;
  };

  // Wire audioEngine listeners
  audioEngine.onStateChange((isPlaying, isBuffering) => {
    const prevPlaying = get().isPlaying;
    const engineTrack = audioEngine.getCurrentTrack();
    const currentTrack = get().currentTrack || engineTrack;
    set({ isPlaying, isBuffering, currentTrack });
    updateMediaSessionPlaybackState(isPlaying, audioEngine.getCurrentTime());

    if (get().connectMode !== 'remote_controller' && prevPlaying !== isPlaying) {
      broadcastCurrentState();
    }
  });

  audioEngine.onTimeUpdate(() => {
    if (!get().currentTrack) {
      const engineTrack = audioEngine.getCurrentTrack();
      if (engineTrack) {
        set({ currentTrack: engineTrack });
      }
    }
    if (activePlayRecord && get().isPlaying) {
      const now = Date.now();
      const delta = now - activePlayRecord.lastTick;
      if (delta > 0 && delta < 5000) {
        activePlayRecord.durationPlayedMs += delta;
      }
      activePlayRecord.lastTick = now;
    }
  });

  audioEngine.onApproachingEnd(() => {
    triggerAutoplayIfNeeded('approaching_end');
  });

  audioEngine.onTrackEnd(async () => {
    const { repeatMode, currentTrack, nextTrack } = get();
    const completedTrack = currentTrack || audioEngine.getCurrentTrack();
    await finalizeCurrentPlayRecord();

    // Auto-save any track played completely as an MP3 when enabled
    if (completedTrack && completedTrack.source !== 'radio') {
      try {
        const vault = useMp3VaultStore.getState();
        if (vault.autoSaveCompleted) {
          vault.saveTrackAsMp3(completedTrack, 'auto_complete').catch(() => {});
        }
      } catch {}
    }

    if (repeatMode === 'one' && currentTrack) {
      audioEngine.seekTo(0);
      audioEngine.resume();
    } else {
      nextTrack();
    }
  });

  function areNavEntriesEqual(a?: NavigationEntry, b?: NavigationEntry): boolean {
    if (!a || !b) return false;
    if (a.view !== b.view) return false;
    if (a.view === 'artist') {
      return a.selectedArtist?.name === b.selectedArtist?.name && a.selectedArtist?.id === b.selectedArtist?.id;
    }
    if (a.view === 'album') {
      return String(a.selectedAlbum?.id) === String(b.selectedAlbum?.id);
    }
    if (a.view === 'playlist') {
      return a.selectedPlaylistId === b.selectedPlaylistId;
    }
    if (a.view === 'search') {
      return (a.searchQuery || '') === (b.searchQuery || '');
    }
    return true;
  }

  function pushNavEntry(
    state: PlayerStoreState,
    newEntry: NavigationEntry
  ): Partial<PlayerStoreState> {
    const currentHistory: NavigationEntry[] =
      state.navHistory && state.navHistory.length > 0
        ? [...state.navHistory]
        : [
            {
              view: state.activeView || 'home',
              selectedArtist: state.selectedArtist,
              selectedAlbum: state.selectedAlbum,
              selectedPlaylistId: state.selectedPlaylistId,
              searchQuery: state.searchQuery,
              sourceFilter: state.sourceFilter,
            },
          ];

    const currentIndex =
      typeof state.navHistoryIndex === 'number'
        ? Math.max(0, Math.min(state.navHistoryIndex, currentHistory.length - 1))
        : currentHistory.length - 1;

    // If navigating away from search, save latest query into the search entry
    if (currentHistory[currentIndex]?.view === 'search' && state.searchQuery) {
      currentHistory[currentIndex] = {
        ...currentHistory[currentIndex],
        searchQuery: state.searchQuery,
        sourceFilter: state.sourceFilter,
      };
    }

    // Don't push duplicate identical navigation step
    if (areNavEntriesEqual(currentHistory[currentIndex], newEntry)) {
      return {
        activeView: newEntry.view,
        currentView: newEntry.view,
        selectedArtist: newEntry.selectedArtist !== undefined ? newEntry.selectedArtist : state.selectedArtist,
        selectedAlbum: newEntry.selectedAlbum !== undefined ? newEntry.selectedAlbum : state.selectedAlbum,
        selectedPlaylistId: newEntry.selectedPlaylistId !== undefined ? newEntry.selectedPlaylistId : state.selectedPlaylistId,
        canNavigateBack: currentIndex > 0,
        canNavigateForward: currentIndex < currentHistory.length - 1,
      };
    }

    // Prune forward entries and push new entry
    const historyPrefix = currentHistory.slice(0, currentIndex + 1);
    const nextHistory = [...historyPrefix, newEntry];

    if (nextHistory.length > 50) {
      nextHistory.shift();
    }

    const nextIndex = nextHistory.length - 1;

    return {
      navHistory: nextHistory,
      navHistoryIndex: nextIndex,
      canNavigateBack: nextIndex > 0,
      canNavigateForward: false,
      activeView: newEntry.view,
      currentView: newEntry.view,
      previousView: state.activeView === newEntry.view ? state.previousView : state.activeView,
      selectedArtist: newEntry.selectedArtist !== undefined ? newEntry.selectedArtist : (newEntry.view === 'artist' ? state.selectedArtist : null),
      selectedAlbum: newEntry.selectedAlbum !== undefined ? newEntry.selectedAlbum : (newEntry.view === 'album' ? state.selectedAlbum : null),
      selectedPlaylistId: newEntry.selectedPlaylistId !== undefined ? newEntry.selectedPlaylistId : (newEntry.view === 'playlist' ? state.selectedPlaylistId : null),
      searchQuery: newEntry.searchQuery !== undefined ? newEntry.searchQuery : state.searchQuery,
      sourceFilter: newEntry.sourceFilter || state.sourceFilter,
    };
  }

  return {
    currentTrack: null,
    currentTrackIndex: -1,
    queue: [],
    history: initialHistory,
    likedTracks: initialLiked,
    playlists: initialPlaylists,
    followedArtists: initialFollowedArtists,
    isPlaying: false,
    isBuffering: false,
    volume: initialVolume,
    repeatMode: 'off',
    shuffle: false,
    autoplayEnabled: initialAutoplay,

    activeView: 'home',
    currentView: 'home',
    previousView: 'home',
    selectedArtist: null,
    selectedAlbum: null,
    selectedPlaylistId: null,
    searchQuery: '',
    sourceFilter: 'all',
    navHistory: [{ view: 'home' }],
    navHistoryIndex: 0,
    canNavigateBack: false,
    canNavigateForward: false,

    isRightDrawerOpen: false,
    rightDrawerTab: 'queue',
    isMobileSheetOpen: false,
    isVisualizerOpen: false,
    isSidebarCollapsed: false,
    isDevicePickerOpen: false,
    isCreatePlaylistModalOpen: false,
    createPlaylistModalTab: 'custom',
    createPlaylistInitialTracks: [],

    // Spotify Connect State
    connectMode: 'standalone',
    activeDevice: null,
    remoteDevices: [],
    isTransferringPlayback: false,
    transferringToId: null,

    // Spotify Connect Actions
    toggleDevicePicker: (open?: boolean) => {
      set((state) => ({
        isDevicePickerOpen: open !== undefined ? open : !state.isDevicePickerOpen,
      }));
    },

    setConnectMode: (mode: ConnectMode, activeDevice?: ConnectedDevice | null) => {
      set({ connectMode: mode, activeDevice: activeDevice || null });
      if (mode === 'remote_controller') {
        audioEngine.setControllerMode(true, (action, data) => {
          connectClient.sendRemoteCommand(action as any, data);
        });
        remoteProgressInterpolator.start();
      } else {
        audioEngine.setControllerMode(false);
        remoteProgressInterpolator.stop();
      }
    },

    setRemoteDevices: (devices: ConnectedDevice[]) => {
      set({ remoteDevices: devices });
    },

    applyRemotePlaybackState: (state: PlaybackStatePayload) => {
      if (get().connectMode !== 'remote_controller') return;

      const targetTrack = state.currentTrack || state.activeTrack || null;
      if (!targetTrack && (get().isPlaying || audioEngine.isPlaying() || audioEngine.getCurrentTrack())) {
        return;
      }

      set({
        currentTrack: targetTrack,
        currentTrackIndex: state.currentTrackIndex ?? state.currentIndex ?? 0,
        queue: state.queue || get().queue,
        isPlaying: state.isPlaying,
        volume: state.volume ?? get().volume,
        repeatMode: state.repeatMode || get().repeatMode,
        shuffle: state.shuffle ?? get().shuffle,
      });

      remoteProgressInterpolator.sync({
        positionMs: state.positionMs,
        durationMs: state.durationMs,
        isPlaying: state.isPlaying,
        remoteTimestamp: state.timestamp,
      });

      if (state.currentTrack) {
        updateMediaSession(
          state.currentTrack,
          {
            onPlay: () => get().togglePlay(),
            onPause: () => get().togglePlay(),
            onPrevious: () => get().previousTrack(),
            onNext: () => get().nextTrack(),
            onSeekTo: (time) => get().seekTo(time),
          },
          state.isPlaying,
          (state.positionMs || 0) / 1000
        );
      }
    },

    executeRemoteCommand: (action: string, data?: any) => {
      switch (action) {
        case 'play':
          if (!get().isPlaying) audioEngine.resume();
          break;
        case 'pause':
          if (get().isPlaying) audioEngine.pause();
          break;
        case 'toggle_play':
        case 'togglePlay':
          audioEngine.togglePlay();
          break;
        case 'seek': {
          const sec = typeof data?.seconds === 'number' ? data.seconds : (data?.positionMs || 0) / 1000;
          audioEngine.seekTo(sec);
          break;
        }
        case 'next':
          get().nextTrack();
          break;
        case 'previous':
        case 'prev':
          get().previousTrack();
          break;
        case 'set_volume':
        case 'setVolume': {
          const vol = typeof data?.volume === 'number' ? data.volume : data;
          if (typeof vol === 'number') {
            get().setVolume(vol);
          }
          break;
        }
        case 'play_track':
        case 'playTrack': {
          if (data?.track) {
            get().playTrack(data.track, data.queue || data.newQueue, data.index ?? data.trackIndex);
          }
          break;
        }
        case 'play_next':
        case 'playNext': {
          if (data?.track) get().playNext(data.track);
          break;
        }
        case 'add_to_end':
        case 'addToEnd': {
          if (data?.track) get().addToEnd(data.track);
          break;
        }
        case 'set_queue':
        case 'setQueue': {
          if (Array.isArray(data?.queue)) get().setQueue(data.queue);
          break;
        }
        case 'reorder_queue':
        case 'reorderQueue': {
          if (typeof data?.fromIndex === 'number' && typeof data?.toIndex === 'number') {
            get().reorderQueue(data.fromIndex, data.toIndex);
          }
          break;
        }
        case 'remove_from_queue':
        case 'removeFromQueue': {
          if (typeof data?.index === 'number') {
            get().removeFromQueue(data.index);
          }
          break;
        }
        case 'clear_queue':
        case 'clearQueue': {
          get().clearQueue();
          break;
        }
        case 'set_repeat':
        case 'setRepeat': {
          if (data?.mode) get().setRepeatMode(data.mode);
          break;
        }
        case 'set_shuffle':
        case 'setShuffle': {
          if (typeof data?.shuffle === 'boolean') {
            set({ shuffle: data.shuffle });
          }
          break;
        }
      }
      broadcastCurrentState();
    },

    transferPlaybackTo: async (targetDeviceId: string): Promise<boolean> => {
      const store = get();
      const localDevice = connectClient.getLocalDevice();
      const isSwitchingToLocal = targetDeviceId === localDevice.deviceId || targetDeviceId === 'local_device';

      if (isSwitchingToLocal) {
        set({ isTransferringPlayback: true, transferringToId: targetDeviceId });

        // If previously controlling a remote device, stop remote playback
        if (store.connectMode === 'remote_controller') {
          if (store.activeDevice?.deviceId?.startsWith('cast:')) {
            connectClient.sendRemoteCommand('stop', {}, store.activeDevice.deviceId);
          } else {
            connectClient.sendRemoteCommand('pause', {}, store.activeDevice?.deviceId);
          }
        }

        // Return to local host mode
        audioEngine.setControllerMode(false);
        remoteProgressInterpolator.stop();
        connectClient.unpair();

        const currentPosSec = audioEngine.getCurrentTime();
        if (store.currentTrack && store.isPlaying) {
          audioEngine.playTrackAtPosition(store.currentTrack, Math.round(currentPosSec * 1000), true).catch(() => {});
        }

        set({
          connectMode: 'standalone',
          activeDevice: { ...localDevice, isActive: true },
          isTransferringPlayback: false,
          transferringToId: null,
        });

        broadcastCurrentState();
        return true;
      }

      if (!store.currentTrack) {
        return false;
      }

      set({ isTransferringPlayback: true, transferringToId: targetDeviceId });

      const positionMs = Math.round(audioEngine.getCurrentTime() * 1000);
      const snapshot: PlaybackSnapshot = {
        track: store.currentTrack,
        queue: store.queue,
        currentTrackIndex: store.currentTrackIndex,
        positionMs,
        isPlaying: store.isPlaying,
        volume: store.volume,
        repeatMode: store.repeatMode,
        shuffle: store.shuffle,
        capturedAt: Date.now(),
      };

      audioEngine.pause();
      audioEngine.setControllerMode(true, (action, data) => {
        connectClient.sendRemoteCommand(action as any, data);
      });
      remoteProgressInterpolator.start();

      const targetDev = store.remoteDevices.find((d) => d.deviceId === targetDeviceId);

      try {
        const success = await connectClient.transferPlayback(targetDeviceId, snapshot);
        if (success) {
          set({
            connectMode: 'remote_controller',
            activeDevice: targetDev || {
              deviceId: targetDeviceId,
              deviceName: targetDeviceId.startsWith('cast:') ? 'Google Cast Speaker' : 'Remote Device',
              deviceType: targetDeviceId.startsWith('cast:') ? 'speaker' : 'desktop',
              role: 'active_host',
              isCurrentDevice: false,
              isActive: true,
              volume: store.volume,
              lastSeen: Date.now(),
            },
            isTransferringPlayback: false,
            transferringToId: null,
          });
        } else {
          audioEngine.setControllerMode(false);
          remoteProgressInterpolator.stop();
          set({
            connectMode: 'standalone',
            isTransferringPlayback: false,
            transferringToId: null,
          });
          if (store.isPlaying) {
            audioEngine.resume();
          }
        }
        return success;
      } catch (err) {
        audioEngine.setControllerMode(false);
        remoteProgressInterpolator.stop();
        set({
          connectMode: 'standalone',
          isTransferringPlayback: false,
          transferringToId: null,
        });
        if (store.isPlaying) {
          audioEngine.resume();
        }
        return false;
      }
    },

    initiateHandoff: async (targetDeviceId: string): Promise<boolean> => {
      return get().transferPlaybackTo(targetDeviceId);
    },

    setRemoteVolume: (targetDeviceId: string, volume: number) => {
      const clamped = Math.max(0, Math.min(1, volume));
      const activeDev = get().activeDevice;
      if (activeDev && activeDev.deviceId === targetDeviceId) {
        set({ activeDevice: { ...activeDev, volume: clamped } });
      }
      sendThrottledRemoteVolume(clamped, targetDeviceId);
    },

    playTrack: (
      track: Track,
      newQueue?: Track[],
      trackIndex?: number,
      playContext?: PlayContext | PlayOrigin
    ) => {
      finalizeCurrentPlayRecord();

      const resolvedContext: PlayContext =
        typeof playContext === 'string'
          ? {
              origin: playContext,
              intent: listeningClassifier.isFavouredOrigin(playContext) ? 'favoured' : 'exploratory',
            }
          : playContext || listeningClassifier.resolveContextFromState(track, get());

      if (newQueue) {
        currentQueueContext = resolvedContext;
      }

      if (get().connectMode === 'remote_controller') {
        const { queue } = get();
        const updatedQueue = newQueue ? [...newQueue] : queue.length > 0 ? queue : [track];
        const activeTrackIndex = typeof trackIndex === 'number' ? trackIndex : updatedQueue.findIndex((t) => t.id === track.id);
        set({ currentTrack: track, currentTrackIndex: activeTrackIndex >= 0 ? activeTrackIndex : 0, queue: updatedQueue, isPlaying: true });
        remoteProgressInterpolator.resetForTrack(track.duration && isFinite(track.duration) ? track.duration : 0);
        connectClient.sendRemoteCommand('play_track', { track, queue: updatedQueue, index: activeTrackIndex });
        return;
      }

      const { queue, history, currentTrack } = get();
      if (currentTrack) {
        const updatedHistory = [currentTrack, ...history.filter((h) => h.id !== currentTrack.id).slice(0, 49)];
        safeStorage.setItem(STORAGE_HISTORY, updatedHistory);
        set({ history: updatedHistory });
        scheduleCloudLibrarySync();
      }

      const updatedQueue = newQueue ? [...newQueue] : queue.length > 0 ? queue : [track];
      let activeTrackIndex: number;
      if (typeof trackIndex === 'number' && trackIndex >= 0 && trackIndex < updatedQueue.length) {
        activeTrackIndex = trackIndex;
      } else {
        const refIdx = updatedQueue.indexOf(track);
        if (refIdx !== -1) {
          activeTrackIndex = refIdx;
        } else {
          const instIdx = (track as any)?._instanceId
            ? updatedQueue.findIndex((t) => (t as any)?._instanceId === (track as any)?._instanceId)
            : -1;
          if (instIdx !== -1) {
            activeTrackIndex = instIdx;
          } else {
            const idIdx = updatedQueue.findIndex((t) => t.id === track.id);
            activeTrackIndex = idIdx !== -1 ? idIdx : 0;
          }
        }
      }

      safeStorage.setItem('queue', updatedQueue);
      set({ currentTrack: track, currentTrackIndex: activeTrackIndex, queue: updatedQueue });

      const replayed = lastPlayedTrackId === track.id || get().repeatMode === 'one';
      lastPlayedTrackId = track.id;
      activePlayRecord = {
        playId: `play_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        track,
        startTime: Date.now(),
        lastTick: Date.now(),
        durationPlayedMs: 0,
        replayed,
        playContext: resolvedContext,
      };

      audioEngine.playTrack(track);

      // System media session integration
      updateMediaSession(
        track,
        {
          onPlay: () => get().togglePlay(),
          onPause: () => get().togglePlay(),
          onPrevious: () => get().previousTrack(),
          onNext: () => get().nextTrack(),
          onSeekTo: (time) => get().seekTo(time),
        },
        true,
        0
      );

      // Queue pre-warming & secondary element priming
      try {
        const curIdx = activeTrackIndex;
        if (curIdx !== -1) {
          audioCache.prewarmQueue(updatedQueue, curIdx, 2);
          if (curIdx + 1 < updatedQueue.length) {
            audioEngine.prebufferNextTrack(updatedQueue[curIdx + 1]);
          }
        }
      } catch {
        // Non-critical background prefetch
      }

      broadcastCurrentState();
    },

    togglePlay: () => {
      const { currentTrack, queue } = get();
      if (!currentTrack && queue.length > 0) {
        get().playTrack(queue[0], queue, 0);
        return;
      }
      if (!currentTrack) return;
      if (get().connectMode === 'remote_controller') {
        const nextPlaying = !get().isPlaying;
        set({ isPlaying: nextPlaying });
        connectClient.sendRemoteCommand('toggle_play');
        return;
      }
      audioEngine.togglePlay();
      broadcastCurrentState();
    },

    nextTrack: async () => {
      await finalizeCurrentPlayRecord();
      if (get().connectMode === 'remote_controller') {
        connectClient.sendRemoteCommand('next');
        return;
      }
      const { queue, currentTrack, currentTrackIndex, repeatMode, shuffle, autoplayEnabled } = get();
      if (queue.length === 0) {
        if (autoplayEnabled && repeatMode === 'off') {
          await triggerAutoplayIfNeeded('queue_exhausted');
        }
        return;
      }

      let currentIndex = currentTrackIndex;
      if (
        typeof currentIndex !== 'number' ||
        currentIndex < 0 ||
        currentIndex >= queue.length ||
        (currentTrack && queue[currentIndex]?.id !== currentTrack.id)
      ) {
        const refIdx = currentTrack ? queue.indexOf(currentTrack) : -1;
        currentIndex = refIdx !== -1 ? refIdx : currentTrack ? queue.findIndex((t) => t.id === currentTrack.id) : 0;
      }
      let nextIndex = currentIndex + 1;

      if (shuffle && queue.length > 1) {
        do {
          nextIndex = Math.floor(Math.random() * queue.length);
        } while (nextIndex === currentIndex && queue.length > 1);
      } else if (nextIndex >= queue.length) {
        if (repeatMode === 'all') {
          nextIndex = 0;
        } else if (autoplayEnabled) {
          await triggerAutoplayIfNeeded('queue_exhausted');
          return;
        } else {
          return; // Stop at end of queue
        }
      }

      const next = queue[nextIndex];
      if (next) {
        get().playTrack(next, undefined, nextIndex, currentQueueContext || undefined);
      }
      broadcastCurrentState();
    },

    previousTrack: async () => {
      await finalizeCurrentPlayRecord();
      if (get().connectMode === 'remote_controller') {
        connectClient.sendRemoteCommand('previous');
        return;
      }
      const { queue, currentTrack, currentTrackIndex, history } = get();
      if (history.length > 0) {
        const prev = history[0];
        set({ history: history.slice(1) });
        get().playTrack(prev, undefined, undefined, currentQueueContext || undefined);
        broadcastCurrentState();
        return;
      }

      if (queue.length === 0) return;
      let currentIndex = currentTrackIndex;
      if (
        typeof currentIndex !== 'number' ||
        currentIndex < 0 ||
        currentIndex >= queue.length ||
        (currentTrack && queue[currentIndex]?.id !== currentTrack.id)
      ) {
        const refIdx = currentTrack ? queue.indexOf(currentTrack) : -1;
        currentIndex = refIdx !== -1 ? refIdx : currentTrack ? queue.findIndex((t) => t.id === currentTrack.id) : 0;
      }
      const prevIndex = Math.max(0, currentIndex - 1);
      const prev = queue[prevIndex];
      if (prev) {
        get().playTrack(prev, undefined, prevIndex, currentQueueContext || undefined);
      }
      broadcastCurrentState();
    },

    seekTo: (seconds: number) => {
      if (get().connectMode === 'remote_controller') {
        remoteProgressInterpolator.seek(seconds);
        connectClient.sendRemoteCommand('seek', { seconds, positionMs: seconds * 1000 });
        return;
      }
      audioEngine.seekTo(seconds);
      updateMediaSessionPlaybackState(get().isPlaying, seconds);
      broadcastCurrentState();
    },

    setVolume: (vol: number) => {
      const clamped = Math.max(0, Math.min(1, vol));
      if (get().connectMode === 'remote_controller') {
        sendThrottledRemoteVolume(clamped);
        set({ volume: clamped });
        return;
      }
      audioEngine.setVolume(clamped);
      safeStorage.setItem(STORAGE_VOLUME, clamped);
      set({ volume: clamped });
      broadcastCurrentState();
    },

    setRepeatMode: (mode) => {
      if (get().connectMode === 'remote_controller') {
        connectClient.sendRemoteCommand('set_repeat', { mode });
      }
      set({ repeatMode: mode });
      broadcastCurrentState();
    },
    toggleShuffle: () => {
      const nextShuffle = !get().shuffle;
      if (get().connectMode === 'remote_controller') {
        connectClient.sendRemoteCommand('set_shuffle', { shuffle: nextShuffle });
      }
      set({ shuffle: nextShuffle });
      broadcastCurrentState();
    },
    enableAutoplay: (enabled: boolean) => {
      safeStorage.setItem(STORAGE_AUTOPLAY, enabled);
      set({ autoplayEnabled: enabled });
    },
    toggleAutoplay: () => {
      const next = !get().autoplayEnabled;
      safeStorage.setItem(STORAGE_AUTOPLAY, next);
      set({ autoplayEnabled: next });
    },
    triggerAutoplayIfNeeded: (reason = 'approaching_end') => triggerAutoplayIfNeeded(reason),

    setQueue: (queue: Track[]) => {
      if (get().connectMode === 'remote_controller') {
        connectClient.sendRemoteCommand('set_queue', { queue });
      }
      const { currentTrack } = get();
      let newIndex = -1;
      if (currentTrack) {
        const refIdx = queue.indexOf(currentTrack);
        newIndex = refIdx !== -1 ? refIdx : queue.findIndex((t) => t.id === currentTrack.id);
      }
      safeStorage.setItem('queue', queue);
      set({ queue, currentTrackIndex: newIndex });
      broadcastCurrentState();
    },

    // Priority insertion: plays next without interrupting current playback
    playNext: (track: Track | Track[]) => {
      const { queue, currentTrack, currentTrackIndex } = get();
      const tracksToInsert = Array.isArray(track) ? track : [track];
      if (tracksToInsert.length === 0) return;

      if (get().connectMode === 'remote_controller') {
        connectClient.sendRemoteCommand('play_next', { track: tracksToInsert[0] });
      }

      if (!currentTrack || queue.length === 0) {
        get().playTrack(tracksToInsert[0], tracksToInsert);
        return;
      }

      const currentIndex =
        currentTrackIndex >= 0 &&
        currentTrackIndex < queue.length &&
        queue[currentTrackIndex]?.id === currentTrack.id
          ? currentTrackIndex
          : queue.findIndex((t) => t.id === currentTrack.id);
      const insertIndex = currentIndex !== -1 ? currentIndex + 1 : queue.length;

      const updatedQueue = [
        ...queue.slice(0, insertIndex),
        ...tracksToInsert,
        ...queue.slice(insertIndex),
      ];

      safeStorage.setItem('queue', updatedQueue);
      set({
        queue: updatedQueue,
        currentTrackIndex: currentIndex !== -1 ? currentIndex : currentTrackIndex,
      });

      // Pre-warm the newly inserted next track
      try {
        audioCache.prewarmTrack(tracksToInsert[0]);
        audioEngine.prebufferNextTrack(tracksToInsert[0]);
      } catch {}

      broadcastCurrentState();
    },

    // Appending to queue without interrupting current playback
    addToEnd: (track: Track | Track[]) => {
      const { queue, currentTrack, currentTrackIndex } = get();
      const tracksToAdd = Array.isArray(track) ? track : [track];
      if (tracksToAdd.length === 0) return;

      if (get().connectMode === 'remote_controller') {
        connectClient.sendRemoteCommand('add_to_end', { track: tracksToAdd[0] });
      }

      if (!currentTrack && queue.length === 0) {
        get().playTrack(tracksToAdd[0], tracksToAdd);
        return;
      }

      const updatedQueue = [...queue, ...tracksToAdd];
      const resolvedIdx =
        currentTrackIndex >= 0 &&
        currentTrackIndex < updatedQueue.length &&
        currentTrack &&
        updatedQueue[currentTrackIndex]?.id === currentTrack.id
          ? currentTrackIndex
          : currentTrack
          ? updatedQueue.findIndex((t) => t.id === currentTrack.id)
          : -1;

      safeStorage.setItem('queue', updatedQueue);
      set({ queue: updatedQueue, currentTrackIndex: resolvedIdx });

      if (queue.length === 1 && currentTrack) {
        audioEngine.prebufferNextTrack(tracksToAdd[0]);
      }

      broadcastCurrentState();
    },

    addToQueue: (track: Track) => get().addToEnd(track),

    // Reorder queue without interrupting active playback
    reorderQueue: (fromIndex: number, toIndex: number) => {
      const { queue, currentTrack, currentTrackIndex } = get();
      if (
        fromIndex < 0 ||
        fromIndex >= queue.length ||
        toIndex < 0 ||
        toIndex >= queue.length ||
        fromIndex === toIndex
      ) {
        return;
      }

      if (get().connectMode === 'remote_controller') {
        connectClient.sendRemoteCommand('reorder_queue', { fromIndex, toIndex });
      }

      const baseCursor =
        currentTrackIndex >= 0 &&
        currentTrackIndex < queue.length &&
        (!currentTrack || queue[currentTrackIndex]?.id === currentTrack.id)
          ? currentTrackIndex
          : currentTrack
          ? queue.findIndex((t) => t.id === currentTrack.id)
          : -1;

      const updatedQueue = [...queue];
      const [movedItem] = updatedQueue.splice(fromIndex, 1);
      updatedQueue.splice(toIndex, 0, movedItem);

      let nextCursor = baseCursor;
      if (baseCursor === fromIndex) {
        nextCursor = toIndex;
      } else if (fromIndex < baseCursor && toIndex >= baseCursor) {
        nextCursor = baseCursor - 1;
      } else if (fromIndex > baseCursor && toIndex <= baseCursor) {
        nextCursor = baseCursor + 1;
      }

      safeStorage.setItem('queue', updatedQueue);
      set({ queue: updatedQueue, currentTrackIndex: nextCursor });

      // Re-prime pre-buffering if upcoming track changed
      if (currentTrack) {
        const curIdx = nextCursor >= 0 ? nextCursor : updatedQueue.findIndex((t) => t.id === currentTrack.id);
        if (curIdx !== -1 && curIdx + 1 < updatedQueue.length) {
          audioEngine.prebufferNextTrack(updatedQueue[curIdx + 1]);
        }
      }

      broadcastCurrentState();
    },

    removeFromQueue: (idx: number) => {
      const { queue, currentTrack, currentTrackIndex } = get();
      if (idx < 0 || idx >= queue.length) return;

      if (get().connectMode === 'remote_controller') {
        connectClient.sendRemoteCommand('remove_from_queue', { index: idx });
      }

      const baseCursor =
        currentTrackIndex >= 0 &&
        currentTrackIndex < queue.length &&
        (!currentTrack || queue[currentTrackIndex]?.id === currentTrack.id)
          ? currentTrackIndex
          : currentTrack
          ? queue.findIndex((t) => t.id === currentTrack.id)
          : -1;

      const isCurrent = idx === baseCursor;
      const updatedQueue = queue.filter((_, i) => i !== idx);

      let nextCursor = baseCursor;
      if (idx < baseCursor) {
        nextCursor = baseCursor - 1;
      }

      safeStorage.setItem('queue', updatedQueue);
      set({ queue: updatedQueue, currentTrackIndex: nextCursor });

      if (isCurrent) {
        if (updatedQueue.length > 0) {
          const newIdx = Math.min(idx, updatedQueue.length - 1);
          get().playTrack(updatedQueue[newIdx], undefined, newIdx);
        } else {
          audioEngine.pause();
          set({ currentTrack: null, currentTrackIndex: -1, isPlaying: false });
        }
      }

      broadcastCurrentState();
    },

    // Non-destructive: keeps currently playing track in queue, clears upcoming
    clearQueue: () => {
      if (get().connectMode === 'remote_controller') {
        connectClient.sendRemoteCommand('clear_queue');
      }

      const { currentTrack } = get();
      const updatedQueue = currentTrack ? [currentTrack] : [];
      safeStorage.setItem('queue', updatedQueue);
      set({ queue: updatedQueue, currentTrackIndex: currentTrack ? 0 : -1 });
      audioEngine.prebufferNextTrack(null);
      broadcastCurrentState();
    },

    setActiveView: (view: AppView) =>
      set((state) => {
        const res = pushNavEntry(state, {
          view,
          searchQuery: view === 'search' ? state.searchQuery : undefined,
          selectedArtist: view === 'artist' ? state.selectedArtist : null,
          selectedAlbum: view === 'album' ? state.selectedAlbum : null,
          selectedPlaylistId: view === 'playlist' ? state.selectedPlaylistId : null,
        });
        return {
          ...res,
          isMobileSheetOpen: false,
        };
      }),

    navigateToArtist: (artistName: string, artistId?: string) => {
      if (!artistName || !artistName.trim()) return;
      const cleanName = artistName.trim();
      const id = artistId || `artist:${encodeURIComponent(cleanName.toLowerCase())}`;

      set((state) => {
        const res = pushNavEntry(state, {
          view: 'artist',
          selectedArtist: { id, name: cleanName },
        });
        return {
          ...res,
          isMobileSheetOpen: false,
        };
      });
    },

    navigateToAlbum: (album: SelectedAlbumState) => {
      set((state) => {
        const res = pushNavEntry(state, {
          view: 'album',
          selectedAlbum: album,
        });
        return {
          ...res,
          isMobileSheetOpen: false,
        };
      });
    },

    navigateToPlaylist: (playlistId: string) => {
      set((state) => {
        const res = pushNavEntry(state, {
          view: 'playlist',
          selectedPlaylistId: playlistId,
        });
        return {
          ...res,
          isMobileSheetOpen: false,
        };
      });
    },

    addAlbumToLibrary: (album: SelectedAlbumState, tracks: Track[]) => {
      const { playlists, importCustomPlaylist } = get();
      const existing = playlists.find(
        (p) => p.name.toLowerCase() === album.title.toLowerCase()
      );
      if (existing) return;

      importCustomPlaylist({
        name: album.title,
        description: `Album by ${album.artist}${album.year ? ` • ${album.year}` : ''}`,
        coverArt: album.coverUrl || '',
        tracks,
      });
    },

    removeAlbumFromLibrary: (albumTitle: string) => {
      const { playlists, deletePlaylist } = get();
      const found = playlists.find(
        (p) => p.name.toLowerCase() === albumTitle.toLowerCase()
      );
      if (found) {
        deletePlaylist(found.id);
      }
    },

    isAlbumInLibrary: (albumTitle: string) => {
      if (!albumTitle) return false;
      return get().playlists.some(
        (p) => p.name.toLowerCase() === albumTitle.toLowerCase()
      );
    },

    navigateBack: () => {
      const { navHistory, navHistoryIndex, previousView, activeView } = get();
      if (navHistory && navHistory.length > 0 && navHistoryIndex > 0) {
        const nextIndex = navHistoryIndex - 1;
        const target = navHistory[nextIndex];
        set((state) => ({
          navHistoryIndex: nextIndex,
          canNavigateBack: nextIndex > 0,
          canNavigateForward: nextIndex < navHistory.length - 1,
          activeView: target.view,
          currentView: target.view,
          previousView: nextIndex > 0 ? navHistory[nextIndex - 1].view : 'home',
          selectedArtist: target.selectedArtist || null,
          selectedAlbum: target.selectedAlbum || null,
          selectedPlaylistId: target.selectedPlaylistId || null,
          searchQuery: target.searchQuery !== undefined ? target.searchQuery : state.searchQuery,
          sourceFilter: target.sourceFilter || state.sourceFilter,
          isMobileSheetOpen: false,
        }));
      } else if (previousView && previousView !== activeView) {
        set({
          activeView: previousView,
          currentView: previousView,
          canNavigateBack: false,
          isMobileSheetOpen: false,
        });
      }
    },

    navigateForward: () => {
      const { navHistory, navHistoryIndex } = get();
      if (navHistory && navHistory.length > 0 && navHistoryIndex < navHistory.length - 1) {
        const nextIndex = navHistoryIndex + 1;
        const target = navHistory[nextIndex];
        set((state) => ({
          navHistoryIndex: nextIndex,
          canNavigateBack: nextIndex > 0,
          canNavigateForward: nextIndex < navHistory.length - 1,
          activeView: target.view,
          currentView: target.view,
          previousView: navHistory[navHistoryIndex].view,
          selectedArtist: target.selectedArtist || null,
          selectedAlbum: target.selectedAlbum || null,
          selectedPlaylistId: target.selectedPlaylistId || null,
          searchQuery: target.searchQuery !== undefined ? target.searchQuery : state.searchQuery,
          sourceFilter: target.sourceFilter || state.sourceFilter,
          isMobileSheetOpen: false,
        }));
      }
    },

    setSearchQuery: (q) => set({ searchQuery: q }),
    setSourceFilter: (filter) => set({ sourceFilter: filter }),

    toggleRightDrawer: (tab) =>
      set((state) => {
        if (tab && state.rightDrawerTab !== tab) {
          return { isRightDrawerOpen: true, rightDrawerTab: tab };
        }
        return { isRightDrawerOpen: !state.isRightDrawerOpen, rightDrawerTab: tab || state.rightDrawerTab };
      }),

    toggleMobileSheet: (open) =>
      set((state) => ({ isMobileSheetOpen: open !== undefined ? open : !state.isMobileSheetOpen })),

    toggleVisualizer: (open) =>
      set((state) => ({ isVisualizerOpen: open !== undefined ? open : !state.isVisualizerOpen })),

    toggleSidebarCollapse: () =>
      set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),

    openCreatePlaylistModal: (tab = 'custom', initialTracks = []) =>
      set({
        isCreatePlaylistModalOpen: true,
        createPlaylistModalTab: tab,
        createPlaylistInitialTracks: initialTracks,
      }),

    closeCreatePlaylistModal: () =>
      set({
        isCreatePlaylistModalOpen: false,
        createPlaylistInitialTracks: [],
      }),

    toggleLike: (track: Track) => {
      const { likedTracks } = get();
      const exists = likedTracks.some((t) => t.id === track.id);
      let updated: Track[];
      if (exists) {
        updated = likedTracks.filter((t) => t.id !== track.id);
      } else {
        updated = [track, ...likedTracks];
        if (activePlayRecord && activePlayRecord.track.id === track.id) {
          activePlayRecord.playContext = {
            ...(activePlayRecord.playContext || { origin: 'library' }),
            intent: 'favoured',
          };
        }
        // Cache full track for offline listening
        try {
          audioCache.cacheFullTrack(track);
        } catch {}
      }
      safeStorage.setItem(STORAGE_LIKED, updated);
      set({ likedTracks: updated });
      scheduleCloudLibrarySync();
    },

    isLiked: (trackId: string) => {
      return get().likedTracks.some((t) => t.id === trackId);
    },

    toggleFollowArtist: (artist: { id?: string; name: string; imageUrl?: string; genres?: string[] }) => {
      const { followedArtists } = get();
      const cleanName = (artist.name || '').trim();
      if (!cleanName) return;

      const isAlreadyFollowed = followedArtists.some(
        (a) => a.name.toLowerCase() === cleanName.toLowerCase() || (artist.id && a.id === artist.id)
      );

      let updated: FollowedArtist[];
      if (isAlreadyFollowed) {
        updated = followedArtists.filter(
          (a) => a.name.toLowerCase() !== cleanName.toLowerCase() && (!artist.id || a.id !== artist.id)
        );
      } else {
        const newFollow: FollowedArtist = {
          id: artist.id || `artist_${cleanName.toLowerCase().replace(/\s+/g, '_')}`,
          name: cleanName,
          imageUrl: artist.imageUrl,
          genres: artist.genres || [],
          followedAt: Date.now(),
        };
        updated = [newFollow, ...followedArtists];
      }

      safeStorage.setItem(STORAGE_FOLLOWED_ARTISTS, updated);
      const user = authService.getCurrentUser();
      if (user && user.uid) {
        safeStorage.setItem(`dotify_${user.uid}_followed_artists`, updated);
      }
      set({ followedArtists: updated });
      scheduleCloudLibrarySync();
    },

    isFollowingArtist: (artistNameOrId: string) => {
      if (!artistNameOrId) return false;
      const target = artistNameOrId.trim().toLowerCase();
      return (get().followedArtists || []).some(
        (a) => a.name.toLowerCase() === target || a.id.toLowerCase() === target
      );
    },

    createPlaylist: (name: string, description = '', coverArt = '', initialTracks: Track[] = []) => {
      const cleanName = name.trim() || 'My Playlist';
      const { playlists, addTracksToPlaylist } = get();
      const existing = playlists.find(
        (p) => p.name.trim().toLowerCase() === cleanName.toLowerCase()
      );
      if (existing) {
        if (initialTracks && initialTracks.length > 0) {
          addTracksToPlaylist(existing.id, initialTracks);
        }
        return existing.id;
      }

      const id = `pl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const newPlaylist: CustomPlaylist = {
        id,
        name: cleanName,
        description: description.trim(),
        coverArt,
        tracks: Array.isArray(initialTracks) ? [...initialTracks] : [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const updated = [...playlists, newPlaylist];
      safeStorage.setItem(STORAGE_PLAYLISTS, updated);
      set({ playlists: updated });
      scheduleCloudLibrarySync();
      return id;
    },

    renamePlaylist: (playlistId: string, newName: string) => {
      const cleanName = newName.trim();
      if (!cleanName) return;
      const updated = get().playlists.map((p) =>
        p.id === playlistId ? { ...p, name: cleanName, updatedAt: Date.now() } : p
      );
      safeStorage.setItem(STORAGE_PLAYLISTS, updated);
      set({ playlists: updated });
      scheduleCloudLibrarySync();
    },

    updatePlaylistDetails: (
      playlistId: string,
      details: { name?: string; description?: string; coverArt?: string }
    ) => {
      const updated = get().playlists.map((p) => {
        if (p.id !== playlistId) return p;
        return {
          ...p,
          name: details.name !== undefined ? details.name.trim() || p.name : p.name,
          description: details.description !== undefined ? details.description.trim() : p.description,
          coverArt: details.coverArt !== undefined ? details.coverArt : p.coverArt,
          updatedAt: Date.now(),
        };
      });
      safeStorage.setItem(STORAGE_PLAYLISTS, updated);
      set({ playlists: updated });
      scheduleCloudLibrarySync();
    },

    deletePlaylist: (playlistId: string) => {
      const { playlists, selectedPlaylistId, activeView } = get();
      const updated = playlists.filter((p) => p.id !== playlistId);
      safeStorage.setItem(STORAGE_PLAYLISTS, updated);
      const updates: any = { playlists: updated };
      if (selectedPlaylistId === playlistId) {
        updates.selectedPlaylistId = null;
        if (activeView === 'playlist') {
          updates.activeView = 'library';
          updates.currentView = 'library';
        }
      }
      set(updates);
      scheduleCloudLibrarySync();
    },

    reorderPlaylistTracks: (playlistId: string, fromIndex: number, toIndex: number) => {
      const updated = get().playlists.map((p) => {
        if (p.id !== playlistId) return p;
        if (fromIndex < 0 || fromIndex >= p.tracks.length || toIndex < 0 || toIndex >= p.tracks.length) return p;
        const tracks = [...p.tracks];
        const [moved] = tracks.splice(fromIndex, 1);
        tracks.splice(toIndex, 0, moved);
        return { ...p, tracks, updatedAt: Date.now() };
      });
      safeStorage.setItem(STORAGE_PLAYLISTS, updated);
      set({ playlists: updated });
      scheduleCloudLibrarySync();
    },

    addTrackToPlaylist: (playlistId: string, track: Track) => {
      const updated = get().playlists.map((p) => {
        if (p.id === playlistId) {
          return { ...p, tracks: [...p.tracks, track], updatedAt: Date.now() };
        }
        return p;
      });
      safeStorage.setItem(STORAGE_PLAYLISTS, updated);
      set({ playlists: updated });
      scheduleCloudLibrarySync();
    },

    addTracksToPlaylist: (playlistId: string, tracksToAdd: Track[]) => {
      if (!tracksToAdd || tracksToAdd.length === 0) return;
      const updated = get().playlists.map((p) => {
        if (p.id === playlistId) {
          const seenIds = new Set(p.tracks.map((t) => t.id));
          const uniqueToAdd: Track[] = [];
          for (const t of tracksToAdd) {
            if (t && t.id && !seenIds.has(t.id)) {
              seenIds.add(t.id);
              uniqueToAdd.push(t);
            }
          }
          return { ...p, tracks: [...p.tracks, ...uniqueToAdd], updatedAt: Date.now() };
        }
        return p;
      });
      safeStorage.setItem(STORAGE_PLAYLISTS, updated);
      set({ playlists: updated });
      scheduleCloudLibrarySync();
    },

    removeTrackFromPlaylist: (playlistId: string, trackId: string) => {
      const updated = get().playlists.map((p) => {
        if (p.id === playlistId) {
          return { ...p, tracks: p.tracks.filter((t) => t.id !== trackId), updatedAt: Date.now() };
        }
        return p;
      });
      safeStorage.setItem(STORAGE_PLAYLISTS, updated);
      set({ playlists: updated });
      scheduleCloudLibrarySync();
    },

    importCustomPlaylist: (pl) => {
      const { playlists } = get();
      const cleanName = (pl.name || '').trim().toLowerCase();
      const cleanSpotifyUrl = pl.sourceSpotifyUrl?.trim().toLowerCase();

      // Check if duplicate already exists in library
      const existing = playlists.find((p) => {
        if (cleanSpotifyUrl && p.sourceSpotifyUrl && p.sourceSpotifyUrl.trim().toLowerCase() === cleanSpotifyUrl) {
          return true;
        }
        return p.name.trim().toLowerCase() === cleanName;
      });

      if (existing) {
        return existing.id;
      }

      const id = `pl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const newPlaylist: CustomPlaylist = {
        id,
        name: pl.name.trim() || 'Imported Playlist',
        description: pl.description || 'Imported Playlist',
        coverArt: pl.coverArt || '',
        sourceSpotifyUrl: pl.sourceSpotifyUrl,
        tracks: pl.tracks,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const updated = [...playlists, newPlaylist];
      safeStorage.setItem(STORAGE_PLAYLISTS, updated);
      set({ playlists: updated });
      scheduleCloudLibrarySync();
      return id;
    },

    setUserLibrary: (
      liked: Track[],
      playlists: CustomPlaylist[],
      historyOrUserId?: Track[] | string | null,
      maybeUserId?: string | null,
      followedArtists?: FollowedArtist[]
    ) => {
      const cleanLiked = liked.filter(isCleanTrack);
      const cleanPlaylists = deduplicatePlaylists(playlists);
      const history = Array.isArray(historyOrUserId) ? historyOrUserId.filter(isCleanTrack) : undefined;
      const actualUserId = typeof historyOrUserId === 'string' ? historyOrUserId : maybeUserId || null;

      safeStorage.setItem(STORAGE_LIKED, cleanLiked);
      safeStorage.setItem(STORAGE_PLAYLISTS, cleanPlaylists);
      if (history) {
        safeStorage.setItem(STORAGE_HISTORY, history);
      }
      if (followedArtists) {
        safeStorage.setItem(STORAGE_FOLLOWED_ARTISTS, followedArtists);
      }
      if (actualUserId) {
        safeStorage.setItem(`dotify_${actualUserId}_liked`, liked);
        safeStorage.setItem(`dotify_${actualUserId}_playlists`, cleanPlaylists);
        if (history) {
          safeStorage.setItem(`dotify_${actualUserId}_history`, history);
        }
        if (followedArtists) {
          safeStorage.setItem(`dotify_${actualUserId}_followed_artists`, followedArtists);
        }
      }
      set((state) => ({
        likedTracks: cleanLiked,
        playlists: cleanPlaylists,
        history: history || state.history,
        followedArtists: followedArtists !== undefined ? followedArtists : state.followedArtists,
      }));

      try {
        const userContext = {
          likedTrackIds: new Set(cleanLiked.map((t) => t.id)),
          followedArtistNames: new Set(
            (followedArtists || []).map((a) => a.name.toLowerCase().trim())
          ),
          userPlaylistTrackIds: new Set(
            cleanPlaylists.flatMap((p) => (p.tracks || []).map((t) => t.id))
          ),
        };
        telemetryDb.classifyPastPlays(userContext).catch(() => {});
      } catch {}
    },
  };
});

export const useConnectStore = usePlayerStore;

export function restorePlaybackHandoffIfNeeded(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem('dotify_playback_handoff');
    if (!raw) return false;
    localStorage.removeItem('dotify_playback_handoff');
    const handoff = JSON.parse(raw);
    if (!handoff || !handoff.track || !handoff.timestamp) return false;
    const elapsedMs = Date.now() - handoff.timestamp;
    // Only restore if recent (within 30 seconds of restart)
    if (elapsedMs > 30000 || elapsedMs < 0) return false;

    const { track, queue, currentTrackIndex, isPlaying, positionMs } = handoff;
    const store = usePlayerStore.getState();
    const updatedQueue = Array.isArray(queue) && queue.length > 0 ? queue : [track];
    const resolvedIdx =
      typeof currentTrackIndex === 'number' && currentTrackIndex >= 0 ? currentTrackIndex : 0;

    store.setQueue(updatedQueue);
    usePlayerStore.setState({
      currentTrack: track,
      currentTrackIndex: resolvedIdx,
      isPlaying: Boolean(isPlaying),
    });

    const targetPos = Math.max(0, (positionMs || 0) + (isPlaying ? elapsedMs : 0));
    audioEngine.playTrackAtPosition(track, targetPos, Boolean(isPlaying)).catch(() => {});
    return true;
  } catch (err) {
    console.debug('[PlayerStore] Playback handoff restore skipped:', err);
    return false;
  }
}

