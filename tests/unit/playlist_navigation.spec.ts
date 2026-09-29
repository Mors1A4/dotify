import { describe, it, expect, beforeEach } from 'vitest';
import { usePlayerStore } from '../../src/store/playerStore';
import { Track } from '../../src/types/track';

const mockTrack1: Track = {
  id: 'track-1',
  title: 'Paranoid Android',
  artist: 'Radiohead',
  album: 'OK Computer',
  duration: 387,
  source: 'charts',
  streamUrl: 'https://example.com/track1.mp3',
  sourceMetadata: {},
};

const mockTrack2: Track = {
  id: 'track-2',
  title: 'Karma Police',
  artist: 'Radiohead',
  album: 'OK Computer',
  duration: 261,
  source: 'charts',
  streamUrl: 'https://example.com/track2.mp3',
  sourceMetadata: {},
};

describe('Playlist Direct Navigation & Management', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      activeView: 'home',
      currentView: 'home',
      previousView: 'home',
      selectedPlaylistId: null,
      playlists: [],
      queue: [],
      currentTrack: null,
      currentTrackIndex: -1,
    });
  });

  it('navigates directly to a playlist view instead of generic library', () => {
    const store = usePlayerStore.getState();
    const playlistId = store.createPlaylist('My Synthwave Hits', 'Best retro vibes');

    expect(usePlayerStore.getState().playlists.length).toBe(1);
    expect(playlistId).toBeTruthy();

    store.navigateToPlaylist(playlistId);

    const state = usePlayerStore.getState();
    expect(state.activeView).toBe('playlist');
    expect(state.selectedPlaylistId).toBe(playlistId);
    expect(state.previousView).toBe('home');
  });

  it('can add tracks, reorder them, and navigate between multiple playlists', () => {
    const store = usePlayerStore.getState();
    const pl1 = store.createPlaylist('Rock Classics');
    const pl2 = store.createPlaylist('Electronic Odyssey');

    store.addTrackToPlaylist(pl1, mockTrack1);
    store.addTrackToPlaylist(pl1, mockTrack2);

    store.navigateToPlaylist(pl1);
    let state = usePlayerStore.getState();
    expect(state.activeView).toBe('playlist');
    expect(state.selectedPlaylistId).toBe(pl1);

    const targetPlaylist = state.playlists.find((p) => p.id === pl1);
    expect(targetPlaylist?.tracks.length).toBe(2);
    expect(targetPlaylist?.tracks[0].id).toBe('track-1');
    expect(targetPlaylist?.tracks[1].id).toBe('track-2');

    // Reorder tracks
    store.reorderPlaylistTracks(pl1, 0, 1);
    state = usePlayerStore.getState();
    const reordered = state.playlists.find((p) => p.id === pl1);
    expect(reordered?.tracks[0].id).toBe('track-2');
    expect(reordered?.tracks[1].id).toBe('track-1');

    // Switch to second playlist
    store.navigateToPlaylist(pl2);
    state = usePlayerStore.getState();
    expect(state.activeView).toBe('playlist');
    expect(state.selectedPlaylistId).toBe(pl2);
  });

  it('handles navigateBack from playlist view', () => {
    const store = usePlayerStore.getState();
    store.setActiveView('search');

    const plId = store.createPlaylist('Favorites');
    store.navigateToPlaylist(plId);

    let state = usePlayerStore.getState();
    expect(state.activeView).toBe('playlist');
    expect(state.previousView).toBe('search');

    store.navigateBack();
    state = usePlayerStore.getState();
    expect(state.activeView).toBe('search');
  });
});
