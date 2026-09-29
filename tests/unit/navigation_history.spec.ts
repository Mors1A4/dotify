import { describe, it, expect, beforeEach } from 'vitest';
import { usePlayerStore } from '../../src/store/playerStore';

describe('Navigation History & Back/Forward Stack', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      activeView: 'home',
      currentView: 'home',
      previousView: 'home',
      selectedArtist: null,
      selectedAlbum: null,
      selectedPlaylistId: null,
      searchQuery: '',
      navHistory: [{ view: 'home' }],
      navHistoryIndex: 0,
      canNavigateBack: false,
      canNavigateForward: false,
    });
  });

  it('starts at home with back/forward disabled', () => {
    const state = usePlayerStore.getState();
    expect(state.activeView).toBe('home');
    expect(state.canNavigateBack).toBe(false);
    expect(state.canNavigateForward).toBe(false);
  });

  it('pushes new views into history and enables back navigation', () => {
    const store = usePlayerStore.getState();

    store.setActiveView('library');
    let state = usePlayerStore.getState();
    expect(state.activeView).toBe('library');
    expect(state.canNavigateBack).toBe(true);
    expect(state.canNavigateForward).toBe(false);

    store.setActiveView('search');
    state = usePlayerStore.getState();
    expect(state.activeView).toBe('search');
    expect(state.navHistory.length).toBe(3);
    expect(state.navHistoryIndex).toBe(2);
    expect(state.canNavigateBack).toBe(true);
  });

  it('does not push duplicate entries when navigating to the same active view', () => {
    const store = usePlayerStore.getState();

    store.setActiveView('library');
    store.setActiveView('library');

    const state = usePlayerStore.getState();
    expect(state.navHistory.length).toBe(2);
    expect(state.navHistoryIndex).toBe(1);
  });

  it('navigates back and forward through views with accurate state restoration', () => {
    const store = usePlayerStore.getState();

    // Home -> Library -> Artist -> Album
    store.setActiveView('library');
    store.navigateToArtist('Daft Punk', 'charts:artist:daft-punk');
    store.navigateToAlbum({
      id: 42,
      title: 'Discovery',
      artist: 'Daft Punk',
    });

    let state = usePlayerStore.getState();
    expect(state.activeView).toBe('album');
    expect(state.selectedAlbum?.title).toBe('Discovery');
    expect(state.canNavigateBack).toBe(true);
    expect(state.canNavigateForward).toBe(false);

    // Step Back -> Artist
    store.navigateBack();
    state = usePlayerStore.getState();
    expect(state.activeView).toBe('artist');
    expect(state.selectedArtist?.name).toBe('Daft Punk');
    expect(state.canNavigateBack).toBe(true);
    expect(state.canNavigateForward).toBe(true);

    // Step Back -> Library
    store.navigateBack();
    state = usePlayerStore.getState();
    expect(state.activeView).toBe('library');
    expect(state.canNavigateBack).toBe(true);
    expect(state.canNavigateForward).toBe(true);

    // Step Back -> Home
    store.navigateBack();
    state = usePlayerStore.getState();
    expect(state.activeView).toBe('home');
    expect(state.canNavigateBack).toBe(false);
    expect(state.canNavigateForward).toBe(true);

    // Step Forward -> Library
    store.navigateForward();
    state = usePlayerStore.getState();
    expect(state.activeView).toBe('library');
    expect(state.canNavigateBack).toBe(true);
    expect(state.canNavigateForward).toBe(true);

    // Step Forward -> Artist
    store.navigateForward();
    state = usePlayerStore.getState();
    expect(state.activeView).toBe('artist');
    expect(state.selectedArtist?.name).toBe('Daft Punk');

    // Step Forward -> Album
    store.navigateForward();
    state = usePlayerStore.getState();
    expect(state.activeView).toBe('album');
    expect(state.selectedAlbum?.title).toBe('Discovery');
    expect(state.canNavigateBack).toBe(true);
    expect(state.canNavigateForward).toBe(false);
  });

  it('prunes forward history when branching to a new view', () => {
    const store = usePlayerStore.getState();

    // Home -> Library -> Search
    store.setActiveView('library');
    store.setActiveView('search');

    // Go back to Library
    store.navigateBack();
    expect(usePlayerStore.getState().activeView).toBe('library');
    expect(usePlayerStore.getState().canNavigateForward).toBe(true);

    // Navigate to a playlist instead of going forward
    store.navigateToPlaylist('playlist-123');
    const state = usePlayerStore.getState();
    expect(state.activeView).toBe('playlist');
    expect(state.selectedPlaylistId).toBe('playlist-123');
    // Forward history to 'search' should have been discarded
    expect(state.canNavigateForward).toBe(false);
    expect(state.navHistory.map((h) => h.view)).toEqual(['home', 'library', 'playlist']);
  });

  it('preserves search query when navigating back from a clicked artist', () => {
    const store = usePlayerStore.getState();

    store.setActiveView('search');
    store.setSearchQuery('Radiohead');

    store.navigateToArtist('Radiohead', 'charts:artist:radiohead');
    expect(usePlayerStore.getState().activeView).toBe('artist');

    store.navigateBack();
    const state = usePlayerStore.getState();
    expect(state.activeView).toBe('search');
    expect(state.searchQuery).toBe('Radiohead');
  });

  it('safely handles navigateBack at the beginning and navigateForward at the end', () => {
    const store = usePlayerStore.getState();

    // At root index 0
    store.navigateBack();
    let state = usePlayerStore.getState();
    expect(state.activeView).toBe('home');
    expect(state.navHistoryIndex).toBe(0);

    store.navigateForward();
    state = usePlayerStore.getState();
    expect(state.activeView).toBe('home');
  });
});
