import { create } from 'zustand';
import {
  AppReleaseInfo,
  compareSemver,
  fetchLatestReleaseInfo,
  getCurrentAppVersion,
  performSelfUpdate,
  subscribeToReleaseManifest,
} from '../services/updateService';
import { APP_VERSION } from '../version';

const STORAGE_KEY_DISMISSED = 'dotify_update_dismissed_version';
const STORAGE_KEY_ATTEMPT_VER = 'dotify_update_attempt_version';
const STORAGE_KEY_ATTEMPT_TIME = 'dotify_update_attempt_time';

interface UpdateState {
  currentVersion: string;
  latestRelease: AppReleaseInfo | null;
  updateAvailable: boolean;
  recentlyAttempted: boolean;
  isChecking: boolean;
  isUpdating: boolean;
  progressPercent: number;
  progressStatus: string;
  updateError: string | null;
  isModalOpen: boolean;

  initUpdater: () => () => void;
  checkForUpdates: (userInitiated?: boolean) => Promise<boolean>;
  startUpdate: () => Promise<void>;
  setModalOpen: (open: boolean) => void;
  dismissCurrentUpdate: () => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  currentVersion: APP_VERSION,
  latestRelease: null,
  updateAvailable: false,
  recentlyAttempted: false,
  isChecking: false,
  isUpdating: false,
  progressPercent: 0,
  progressStatus: '',
  updateError: null,
  isModalOpen: false,

  setModalOpen: (open: boolean) => set({ isModalOpen: open }),

  dismissCurrentUpdate: () => {
    const { latestRelease } = get();
    if (latestRelease?.version) {
      try {
        localStorage.setItem(STORAGE_KEY_DISMISSED, latestRelease.version);
      } catch {}
    }
    set({ isModalOpen: false });
  },

  initUpdater: () => {
    let active = true;

    // 1. Check in background on startup (never forcibly open modal on boot unless mandatory)
    get().checkForUpdates(false);

    // 2. Real-time Firestore listener for newly published releases
    const unsub = subscribeToReleaseManifest(async (release) => {
      if (!active) return;
      const currentVersion = await getCurrentAppVersion();
      const hasUpdate = compareSemver(release.version, currentVersion) > 0;
      const prevVersion = get().latestRelease?.version;

      let recentlyAttempted = false;
      let isDismissed = false;
      try {
        const attemptVer = localStorage.getItem(STORAGE_KEY_ATTEMPT_VER);
        const attemptTime = Number(localStorage.getItem(STORAGE_KEY_ATTEMPT_TIME)) || 0;
        recentlyAttempted = attemptVer === release.version && Date.now() - attemptTime < 30 * 60 * 1000;
        const dismissedVer = localStorage.getItem(STORAGE_KEY_DISMISSED);
        isDismissed = dismissedVer === release.version;
      } catch {}

      // Never auto-trap user in a loop if recently attempted or dismissed
      const shouldAutoOpen = Boolean(
        hasUpdate &&
          (release.mandatory ||
            (prevVersion && prevVersion !== release.version && !recentlyAttempted && !isDismissed))
      );

      set({
        currentVersion,
        latestRelease: release,
        updateAvailable: hasUpdate,
        recentlyAttempted,
        ...(shouldAutoOpen ? { isModalOpen: true } : {}),
      });
    });

    return () => {
      active = false;
      unsub();
    };
  },

  checkForUpdates: async (userInitiated = false) => {
    set({ isChecking: true, updateError: null });
    try {
      const [currentVersion, remote] = await Promise.all([
        getCurrentAppVersion(),
        fetchLatestReleaseInfo(),
      ]);

      const hasUpdate = Boolean(remote && compareSemver(remote.version, currentVersion) > 0);

      let recentlyAttempted = false;
      let isDismissed = false;

      if (remote && hasUpdate) {
        try {
          const attemptVer = localStorage.getItem(STORAGE_KEY_ATTEMPT_VER);
          const attemptTime = Number(localStorage.getItem(STORAGE_KEY_ATTEMPT_TIME)) || 0;
          recentlyAttempted = attemptVer === remote.version && Date.now() - attemptTime < 30 * 60 * 1000;
          const dismissedVer = localStorage.getItem(STORAGE_KEY_DISMISSED);
          isDismissed = dismissedVer === remote.version;
        } catch {}
      } else if (remote && !hasUpdate) {
        // App is on or ahead of latest release: clear attempt & dismissal history
        try {
          localStorage.removeItem(STORAGE_KEY_ATTEMPT_VER);
          localStorage.removeItem(STORAGE_KEY_ATTEMPT_TIME);
          localStorage.removeItem(STORAGE_KEY_DISMISSED);
        } catch {}
      }

      // Modal is opened immediately if user manually triggered the check,
      // or if the update is marked mandatory. Never hijack startup screen in an endless loop.
      const shouldOpenModal = Boolean(
        userInitiated ||
        (hasUpdate && remote?.mandatory)
      );

      set({
        currentVersion,
        latestRelease: remote,
        updateAvailable: hasUpdate,
        recentlyAttempted,
        isChecking: false,
        ...(shouldOpenModal ? { isModalOpen: true } : {}),
      });

      return hasUpdate;
    } catch (err: any) {
      set({
        isChecking: false,
        updateError: err?.message || 'Could not check for updates',
      });
      return false;
    }
  },

  startUpdate: async () => {
    const { latestRelease, isUpdating } = get();
    if (!latestRelease || isUpdating) return;

    try {
      localStorage.setItem(STORAGE_KEY_ATTEMPT_VER, latestRelease.version);
      localStorage.setItem(STORAGE_KEY_ATTEMPT_TIME, String(Date.now()));
    } catch {}

    set({
      isUpdating: true,
      progressPercent: 5,
      progressStatus: 'Preparing update...',
      updateError: null,
    });

    try {
      await performSelfUpdate(latestRelease, (progress) => {
        set({
          progressPercent: progress.percent,
          progressStatus: progress.status,
          ...(progress.error ? { updateError: progress.error, isUpdating: false } : {}),
        });
      });
      set({ isUpdating: false });
    } catch (err: any) {
      set({
        isUpdating: false,
        updateError:
          err?.message ||
          'Automatic update encountered an issue. You can click the Installer button below to update.',
      });
    }
  },
}));
