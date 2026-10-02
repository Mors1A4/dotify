import React from 'react';
import { usePlayerStore, restorePlaybackHandoffIfNeeded } from './store/playerStore';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { PlayerBar } from './components/layout/PlayerBar';
import { RightDrawer } from './components/layout/RightDrawer';
import { MobileBottomNav } from './components/layout/MobileBottomNav';
import { MobileMiniPlayer } from './components/layout/MobileMiniPlayer';
import { MobileNowPlayingSheet } from './components/player/MobileNowPlayingSheet';
import { VisualizerModal } from './components/player/VisualizerModal';
import { DevicePickerModal } from './components/connect/DevicePickerModal';
import { AuthModal } from './components/auth/AuthModal';
import { CreatePlaylistModal } from './components/modals/CreatePlaylistModal';
import { UpdateModal } from './components/modals/UpdateModal';
import { HelpUpgradeModal } from './components/modals/HelpUpgradeModal';
import { HomeView } from './components/views/HomeView';
import { SearchView } from './components/views/SearchView';
import { LibraryView } from './components/views/LibraryView';
import { ArtistView } from './components/views/ArtistView';
import { AlbumView } from './components/views/AlbumView';
import { PlaylistView } from './components/views/PlaylistView';
import { VibeDjView } from './components/views/VibeDjView';
import { useAuthStore } from './store/authStore';
import { useUpdateStore } from './store/updateStore';
import { isAndroidApp } from './services/apiConfig';
import { castService } from './services/castService';
import { useMp3VaultStore } from './services/mp3VaultService';
import { initBackNavigation, handleBackAction } from './services/backNavigationService';

export const App: React.FC = () => {
  const { activeView, selectedArtist, selectedAlbum, selectedPlaylistId } = usePlayerStore();

  React.useEffect(() => {
    if (typeof navigator !== 'undefined' && (/android/i.test(navigator.userAgent) || isAndroidApp())) {
      document.documentElement.classList.add('is-android');
    }
    if (isAndroidApp()) {
      useMp3VaultStore.getState().scanWifiPeers().catch(() => {});
    }
    castService.fetchCastDevices().catch(() => {});
    const unsubAuth = useAuthStore.getState().initAuth();
    const unsubUpdater = useUpdateStore.getState().initUpdater();
    const unsubBack = initBackNavigation();
    restorePlaybackHandoffIfNeeded();
    return () => {
      unsubAuth();
      unsubUpdater();
      unsubBack();
    };
  }, []);

  // Global spacebar play/pause shortcut
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable ||
            target.getAttribute('role') === 'textbox')
        ) {
          return;
        }
        e.preventDefault();
        usePlayerStore.getState().togglePlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Global navigation shortcuts: Alt+Left/Right and mouse thumb buttons (buttons 3 and 4)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowLeft') {
        const handled = handleBackAction();
        if (handled) {
          e.preventDefault();
        }
      } else if (e.altKey && e.key === 'ArrowRight') {
        const { canNavigateForward, navigateForward } = usePlayerStore.getState();
        if (canNavigateForward) {
          e.preventDefault();
          navigateForward();
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        const handled = handleBackAction();
        if (handled) {
          e.preventDefault();
        }
      } else if (e.button === 4) {
        const { canNavigateForward, navigateForward } = usePlayerStore.getState();
        if (canNavigateForward) {
          e.preventDefault();
          navigateForward();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Reset scroll position to top whenever active view or destination changes
  React.useEffect(() => {
    const mainEl = document.getElementById('content');
    if (mainEl) {
      mainEl.scrollTop = 0;
    }
  }, [activeView, selectedArtist?.name, selectedAlbum?.id, selectedPlaylistId]);

  const renderActiveView = () => {
    switch (activeView) {
      case 'home':
        return <HomeView />;
      case 'search':
        return <SearchView />;
      case 'library':
        return <LibraryView />;
      case 'artist':
        return <ArtistView />;
      case 'album':
        return <AlbumView />;
      case 'playlist':
        return <PlaylistView />;
      case 'vibe-dj':
        return <VibeDjView />;
      default:
        return <HomeView />;
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-base text-primary font-sans">
      {/* Top Bar */}
      <TopBar />

      {/* Main Stage (Sidebar + Main View + Right Drawer) */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Desktop Sidebar */}
        <Sidebar />

        {/* Central Scrollable Content Feed */}
        <main
          data-testid="main-content"
          id="content"
          className="flex-1 overflow-y-auto overflow-x-hidden relative bg-gradient-to-b from-surface/40 to-base"
        >
          {renderActiveView()}
        </main>

        {/* Collapsible Right Drawer (Queue / Equalizer) */}
        <RightDrawer />
      </div>

      {/* Persistent Desktop Player Bar */}
      <PlayerBar />

      {/* Mobile Floating Mini-Player */}
      <MobileMiniPlayer />

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav />

      {/* Mobile Full-Screen Now-Playing Sheet */}
      <MobileNowPlayingSheet />

      {/* Full-Screen / Modal Audio Spectrum Visualizer */}
      <VisualizerModal />

      {/* Spotify Connect & Smart Speaker Device Picker Modal */}
      <DevicePickerModal />

      {/* Account & Library Sync Modal */}
      <AuthModal />

      {/* Studio Playlist Creator & Spotify 1:1 Cloner Modal */}
      <CreatePlaylistModal />

      {/* Automatic Desktop & Android Self-Update Modal */}
      <UpdateModal />

      {/* Help & AI Feature Upgrade Studio Modal */}
      <HelpUpgradeModal />
    </div>
  );
};

export default App;
