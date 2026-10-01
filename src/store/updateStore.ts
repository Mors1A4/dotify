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
const STORAGE_KEY_INSTALLED_VER = 'dotify_update_installed_version';

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
      const hasSemverDiff = compareSemver(release.version, currentVersion) > 0;
      const prevVersion = get().latestRelease?.version;

      let recentlyAttempted = false;
      let isDismissed = false;
      let isAlreadyInstalled = false;
      try {
        const attemptVer = localStorage.getItem(STORAGE_KEY_ATTEMPT_VER);
        const attemptTime = Number(localStorage.getItem(STORAGE_KEY_ATTEMPT_TIME)) || 0;
        recentlyAttempted = attemptVer === release.version && Date.now() - attemptTime < 2 * 60 * 60 * 1000;
        const dismissedVer = localStorage.getItem(STORAGE_KEY_DISMISSED);
        isDismissed = dismissedVer === release.version;
        const installedVer = localStorage.getItem(STORAGE_KEY_INSTALLED_VER);
        isAlreadyInstalled = Boolean(installedVer && compareSemver(installedVer, release.version) >= 0);
      } catch {}

      // Zero-Loop Invariant:
      // If version is already installed, or running version >= release, or recently attempted:
      // updateAvailable MUST be false
      const updateAvailable = Boolean(hasSemverDiff && !isAlreadyInstalled && !recentlyAttempted);

      // Never auto-trap user in a loop if recently attempted or dismissed
      const shouldAutoOpen = Boolean(
        updateAvailable &&
          (release.mandatory ||
            (prevVersion && prevVersion !== release.version && !isDismissed))
      );

      set({
        currentVersion,
        latestRelease: release,
        updateAvailable,
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

      const hasSemverDiff = Boolean(remote && compareSemver(remote.version, currentVersion) > 0);

      let recentlyAttempted = false;
      let isDismissed = false;
      let isAlreadyInstalled = false;

      if (remote) {
        try {
          const attemptVer = localStorage.getItem(STORAGE_KEY_ATTEMPT_VER);
          const attemptTime = Number(localStorage.getItem(STORAGE_KEY_ATTEMPT_TIME)) || 0;
          recentlyAttempted = attemptVer === remote.version && Date.now() - attemptTime < 2 * 60 * 60 * 1000;
          const dismissedVer = localStorage.getItem(STORAGE_KEY_DISMISSED);
          isDismissed = dismissedVer === remote.version;
          const installedVer = localStorage.getItem(STORAGE_KEY_INSTALLED_VER);
          isAlreadyInstalled = Boolean(installedVer && compareSemver(installedVer, remote.version) >= 0);
        } catch {}
      }

      if (remote && (!hasSemverDiff || isAlreadyInstalled)) {
        // App is on or ahead of latest release: clear attempt & dismissal history
        try {
          localStorage.removeItem(STORAGE_KEY_ATTEMPT_VER);
          localStorage.removeItem(STORAGE_KEY_ATTEMPT_TIME);
          localStorage.removeItem(STORAGE_KEY_DISMISSED);
        } catch {}
      }

      // If user initiated the check manually from sidebar, let them see update if hasSemverDiff and not installed.
      // In background checks, suppress updateAvailable if recently attempted.
      const updateAvailable = Boolean(
        hasSemverDiff &&
        !isAlreadyInstalled &&
        (userInitiated || !recentlyAttempted)
      );

      const shouldOpenModal = Boolean(
        userInitiated ||
        (updateAvailable && remote?.mandatory)
      );

      set({
        currentVersion,
        latestRelease: remote,
        updateAvailable,
        recentlyAttempted,
        isChecking: false,
        ...(shouldOpenModal ? { isModalOpen: true } : {}),
      });

      return updateAvailable;
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
      localStorage.setItem(STORAGE_KEY_INSTALLED_VER, latestRelease.version);
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
      set({
        isUpdating: false,
        updateAvailable: false,
        currentVersion: latestRelease.version,
      });
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
