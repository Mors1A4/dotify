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

interface UpdateState {
  currentVersion: string;
  latestRelease: AppReleaseInfo | null;
  updateAvailable: boolean;
  isChecking: boolean;
  isUpdating: boolean;
  progressPercent: number;
  progressStatus: string;
  updateError: string | null;
  isModalOpen: boolean;

  initUpdater: () => () => void;
  checkForUpdates: (openModalEvenIfUpToDate?: boolean) => Promise<boolean>;
  startUpdate: () => Promise<void>;
  setModalOpen: (open: boolean) => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  currentVersion: APP_VERSION,
  latestRelease: null,
  updateAvailable: false,
  isChecking: false,
  isUpdating: false,
  progressPercent: 0,
  progressStatus: '',
  updateError: null,
  isModalOpen: false,

  setModalOpen: (open: boolean) => set({ isModalOpen: open }),

  initUpdater: () => {
    let active = true;

    // 1. Check on startup
    get().checkForUpdates(false);

    // 2. Real-time Firestore listener so newly published releases appear immediately
    const unsub = subscribeToReleaseManifest(async (release) => {
      if (!active) return;
      const currentVersion = await getCurrentAppVersion();
      const hasUpdate = compareSemver(release.version, currentVersion) > 0;
      const prevAvailable = get().updateAvailable;
      const prevVersion = get().latestRelease?.version;

      set({
        currentVersion,
        latestRelease: release,
        updateAvailable: hasUpdate,
        // Automatically open update modal when a new version is detected
        ...(hasUpdate && (!prevAvailable || prevVersion !== release.version)
          ? { isModalOpen: true }
          : {}),
      });
    });

    return () => {
      active = false;
      unsub();
    };
  },

  checkForUpdates: async (openModalEvenIfUpToDate = false) => {
    set({ isChecking: true, updateError: null });
    try {
      const [currentVersion, remote] = await Promise.all([
        getCurrentAppVersion(),
        fetchLatestReleaseInfo(),
      ]);

      const hasUpdate = Boolean(remote && compareSemver(remote.version, currentVersion) > 0);
      set({
        currentVersion,
        latestRelease: remote,
        updateAvailable: hasUpdate,
        isChecking: false,
        ...(hasUpdate || openModalEvenIfUpToDate ? { isModalOpen: true } : {}),
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
        updateError: err?.message || 'Update failed. You can also use the direct installer button below.',
      });
    }
  },
}));
