import { usePlayerStore } from '../store/playerStore';
import { useAuthStore } from '../store/authStore';
import { useUpdateStore } from '../store/updateStore';
import { useUpgradeStore } from '../store/upgradeStore';

/**
 * Universal In-App Back Navigation Handler.
 * Evaluates the application state and steps backward through active overlays,
 * modals, expanded sheets, and view history.
 *
 * @returns {boolean} true if an in-app action was handled (preventing app exit);
 *                    false if the app is already at the root state (allowing minimization/exit).
 */
export function handleBackAction(): boolean {
  const playerState = usePlayerStore.getState();

  // 1. Priority 1: Mobile Full-Screen Now-Playing Sheet (expanded song)
  if (playerState.isMobileSheetOpen) {
    playerState.toggleMobileSheet(false);
    return true;
  }

  // 2. Priority 2: Active Modals, Drawers & Overlays
  if (playerState.isVisualizerOpen) {
    playerState.toggleVisualizer(false);
    return true;
  }

  if (playerState.isDevicePickerOpen) {
    playerState.toggleDevicePicker(false);
    return true;
  }

  if (playerState.isCreatePlaylistModalOpen) {
    playerState.closeCreatePlaylistModal();
    return true;
  }

  const authState = useAuthStore.getState();
  if (authState.isAuthModalOpen) {
    authState.closeAuthModal();
    return true;
  }

  const updateState = useUpdateStore.getState();
  if (updateState.isModalOpen) {
    updateState.setModalOpen(false);
    return true;
  }

  const upgradeState = useUpgradeStore.getState();
  if (upgradeState.isHelpModalOpen) {
    upgradeState.closeHelpModal();
    return true;
  }

  if (playerState.isRightDrawerOpen) {
    playerState.toggleRightDrawer();
    return true;
  }

  // 3. Priority 3: In-App View Navigation History
  if (playerState.canNavigateBack || (playerState.navHistory && playerState.navHistoryIndex > 0)) {
    playerState.navigateBack();
    return true;
  }

  // Fallback: If not at home view, return to home view before exiting
  if (playerState.activeView !== 'home') {
    playerState.setActiveView('home');
    return true;
  }

  // 4. Nothing to go back to (at root home view with no open sheets or modals)
  return false;
}

/**
 * Initializes global back navigation listeners for:
 * - Android Native WebView bridge (`window.__dotifyHandleBack`)
 * - Mobile browser / PWA `popstate` events
 */
export function initBackNavigation(): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  // Expose bridge handler for Android native WebView
  (window as any).__dotifyHandleBack = handleBackAction;

  const handlePopState = () => {
    // If popstate was triggered by browser back swipe / back button
    const handled = handleBackAction();
    if (handled) {
      // Re-push a history entry if there are still active back-able states
      const state = usePlayerStore.getState();
      const hasMoreBackActions =
        state.isMobileSheetOpen ||
        state.isVisualizerOpen ||
        state.isDevicePickerOpen ||
        state.isCreatePlaylistModalOpen ||
        state.canNavigateBack ||
        state.activeView !== 'home';

      if (hasMoreBackActions) {
        try {
          window.history.pushState({ dotifyNav: true }, '');
        } catch {}
      }
    }
  };

  // Push an initial history entry on mobile browsers so back swipe triggers popstate
  // instead of immediately navigating off the page
  try {
    if (!window.history.state?.dotifyNav) {
      window.history.pushState({ dotifyNav: true }, '');
    }
  } catch {}

  window.addEventListener('popstate', handlePopState);

  return () => {
    window.removeEventListener('popstate', handlePopState);
    if ((window as any).__dotifyHandleBack === handleBackAction) {
      delete (window as any).__dotifyHandleBack;
    }
  };
}
