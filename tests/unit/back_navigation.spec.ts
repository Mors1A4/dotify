import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleBackAction, initBackNavigation } from '../../src/services/backNavigationService';
import { usePlayerStore } from '../../src/store/playerStore';
import { useAuthStore } from '../../src/store/authStore';
import { useUpdateStore } from '../../src/store/updateStore';
import { useUpgradeStore } from '../../src/store/upgradeStore';

describe('Universal Mobile & Desktop Back Navigation', () => {
  beforeEach(() => {
    (globalThis as any).window = globalThis;
    (globalThis as any).addEventListener = vi.fn();
    (globalThis as any).removeEventListener = vi.fn();
    (globalThis as any).history = {
      state: {},
      pushState: vi.fn(),
    };

    // Reset playerStore to default clean root state
    usePlayerStore.setState({
      isMobileSheetOpen: false,
      isVisualizerOpen: false,
      isDevicePickerOpen: false,
      isCreatePlaylistModalOpen: false,
      isRightDrawerOpen: false,
      activeView: 'home',
      currentView: 'home',
      previousView: 'home',
      navHistory: [{ view: 'home' }],
      navHistoryIndex: 0,
      canNavigateBack: false,
      canNavigateForward: false,
    });

    useAuthStore.setState({
      isAuthModalOpen: false,
    });

    useUpdateStore.setState({
      isModalOpen: false,
    });

    useUpgradeStore.setState({
      isHelpModalOpen: false,
    });
  });

  afterEach(() => {
    delete (globalThis as any).__dotifyHandleBack;
  });

  it('closes expanded mobile now-playing sheet when open', () => {
    usePlayerStore.setState({ isMobileSheetOpen: true });
    expect(usePlayerStore.getState().isMobileSheetOpen).toBe(true);

    const handled = handleBackAction();
    expect(handled).toBe(true);
    expect(usePlayerStore.getState().isMobileSheetOpen).toBe(false);
  });

  it('closes active modals and drawers before exiting', () => {
    // Test visualizer modal
    usePlayerStore.setState({ isVisualizerOpen: true });
    expect(handleBackAction()).toBe(true);
    expect(usePlayerStore.getState().isVisualizerOpen).toBe(false);

    // Test device picker modal
    usePlayerStore.setState({ isDevicePickerOpen: true });
    expect(handleBackAction()).toBe(true);
    expect(usePlayerStore.getState().isDevicePickerOpen).toBe(false);

    // Test create playlist modal
    usePlayerStore.setState({ isCreatePlaylistModalOpen: true });
    expect(handleBackAction()).toBe(true);
    expect(usePlayerStore.getState().isCreatePlaylistModalOpen).toBe(false);

    // Test auth modal
    useAuthStore.setState({ isAuthModalOpen: true });
    expect(handleBackAction()).toBe(true);
    expect(useAuthStore.getState().isAuthModalOpen).toBe(false);

    // Test update modal
    useUpdateStore.setState({ isModalOpen: true });
    expect(handleBackAction()).toBe(true);
    expect(useUpdateStore.getState().isModalOpen).toBe(false);

    // Test help & upgrade modal
    useUpgradeStore.setState({ isHelpModalOpen: true });
    expect(handleBackAction()).toBe(true);
    expect(useUpgradeStore.getState().isHelpModalOpen).toBe(false);

    // Test right drawer
    usePlayerStore.setState({ isRightDrawerOpen: true });
    expect(handleBackAction()).toBe(true);
    expect(usePlayerStore.getState().isRightDrawerOpen).toBe(false);
  });

  it('navigates backward through view history when inner view is open', () => {
    // Navigate from home -> search -> album
    usePlayerStore.getState().setActiveView('search');
    usePlayerStore.getState().navigateToAlbum({
      id: 12345,
      title: 'Random Access Memories',
      artist: 'Daft Punk',
    });

    expect(usePlayerStore.getState().activeView).toBe('album');
    expect(usePlayerStore.getState().canNavigateBack).toBe(true);

    // 1st back -> navigates to search
    const handled1 = handleBackAction();
    expect(handled1).toBe(true);
    expect(usePlayerStore.getState().activeView).toBe('search');

    // 2nd back -> navigates to home
    const handled2 = handleBackAction();
    expect(handled2).toBe(true);
    expect(usePlayerStore.getState().activeView).toBe('home');
  });

  it('falls back to home view if activeView is not home and no history remains', () => {
    usePlayerStore.setState({
      activeView: 'library',
      currentView: 'library',
      navHistory: [{ view: 'library' }],
      navHistoryIndex: 0,
      canNavigateBack: false,
    });

    const handled = handleBackAction();
    expect(handled).toBe(true);
    expect(usePlayerStore.getState().activeView).toBe('home');
  });

  it('returns false when at root home view with nothing to back out of (allowing app minimize/exit)', () => {
    usePlayerStore.setState({
      activeView: 'home',
      currentView: 'home',
      navHistory: [{ view: 'home' }],
      navHistoryIndex: 0,
      canNavigateBack: false,
      isMobileSheetOpen: false,
    });

    const handled = handleBackAction();
    expect(handled).toBe(false);
  });

  it('exposes window.__dotifyHandleBack when initialized', () => {
    const unsub = initBackNavigation();
    expect(typeof (window as any).__dotifyHandleBack).toBe('function');

    usePlayerStore.setState({ isMobileSheetOpen: true });
    const result = (window as any).__dotifyHandleBack();
    expect(result).toBe(true);
    expect(usePlayerStore.getState().isMobileSheetOpen).toBe(false);

    unsub();
    expect((window as any).__dotifyHandleBack).toBeUndefined();
  });
});
