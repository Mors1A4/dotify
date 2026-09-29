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
  sourceMetadata: { genre: 'Alternative' },
};

const mockTrack2: Track = {
  id: 'track-2',
  title: 'Karma Police',
  artist: 'Radiohead',
  album: 'OK Computer',
  duration: 261,
  source: 'charts',
  streamUrl: 'https://example.com/track2.mp3',
  sourceMetadata: { genre: 'Alternative' },
};

describe('Album Navigation & Library Management', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      activeView: 'home',
      selectedAlbum: null,
      playlists: [],
      queue: [],
      currentTrack: null,
      currentTrackIndex: -1,
    });
  });

  it('navigates to album as a dedicated playlist view without forcing playback', () => {
    const store = usePlayerStore.getState();

    store.navigateToAlbum({
      id: 'ok-computer',
      title: 'OK Computer',
      artist: 'Radiohead',
      coverUrl: 'https://example.com/ok-computer.jpg',
      year: '1997',
      tracks: [mockTrack1, mockTrack2],
    });

    const state = usePlayerStore.getState();
    expect(state.activeView).toBe('album');
    expect(state.selectedAlbum).not.toBeNull();
    expect(state.selectedAlbum?.title).toBe('OK Computer');
    expect(state.selectedAlbum?.artist).toBe('Radiohead');
    expect(state.selectedAlbum?.tracks?.length).toBe(2);
    // Playback should not be forced on navigation
    expect(state.currentTrack).toBeNull();
  });

  it('adds an album to library as a synced playlist and checks library presence', () => {
    const store = usePlayerStore.getState();

    expect(store.isAlbumInLibrary('OK Computer')).toBe(false);

    store.addAlbumToLibrary(
      {
        id: 'ok-computer',
        title: 'OK Computer',
        artist: 'Radiohead',
        coverUrl: 'https://example.com/ok-computer.jpg',
      },
      [mockTrack1, mockTrack2]
    );

    const state = usePlayerStore.getState();
    expect(state.isAlbumInLibrary('OK Computer')).toBe(true);
    expect(state.playlists.length).toBe(1);
    expect(state.playlists[0].name).toBe('OK Computer');
    expect(state.playlists[0].description).toContain('Radiohead');
    expect(state.playlists[0].tracks.length).toBe(2);

    // Remove from library
    state.removeAlbumFromLibrary('OK Computer');
    const updatedState = usePlayerStore.getState();
    expect(updatedState.isAlbumInLibrary('OK Computer')).toBe(false);
    expect(updatedState.playlists.length).toBe(0);
  });

  it('manages queue correctly: addToEnd, playNext, removeFromQueue, and clearQueue', () => {
    const store = usePlayerStore.getState();

    usePlayerStore.setState({
      currentTrack: mockTrack1,
      currentTrackIndex: 0,
      queue: [mockTrack1],
    });

    // Add track2 to end
    store.addToEnd(mockTrack2);
    let state = usePlayerStore.getState();
    expect(state.queue.length).toBe(2);
    expect(state.queue[1].id).toBe('track-2');

    // Remove track from queue
    store.removeFromQueue(1);
    state = usePlayerStore.getState();
    expect(state.queue.length).toBe(1);

    // Play next
    store.playNext(mockTrack2);
    state = usePlayerStore.getState();
    expect(state.queue.length).toBe(2);
    expect(state.queue[1].id).toBe('track-2');

    // Clear upcoming queue
    store.clearQueue();
    state = usePlayerStore.getState();
    // Only current playing track remains
    expect(state.queue.length).toBe(1);
    expect(state.queue[0].id).toBe('track-1');
  });

  it('togglePlay starts playback of queue if no current track is playing', () => {
    const store = usePlayerStore.getState();

    usePlayerStore.setState({
      currentTrack: null,
      currentTrackIndex: -1,
      queue: [mockTrack1, mockTrack2],
      isPlaying: false,
    });

    store.togglePlay();
    const state = usePlayerStore.getState();
    expect(state.currentTrack).not.toBeNull();
    expect(state.currentTrack?.id).toBe('track-1');
  });

  it('togglePlay does nothing safely when no track and no queue', () => {
    const store = usePlayerStore.getState();

    usePlayerStore.setState({
      currentTrack: null,
      currentTrackIndex: -1,
      queue: [],
      isPlaying: false,
    });

    expect(() => store.togglePlay()).not.toThrow();
    const state = usePlayerStore.getState();
    expect(state.currentTrack).toBeNull();
    expect(state.isPlaying).toBe(false);
  });
});
