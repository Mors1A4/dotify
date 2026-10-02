import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as updateService from '../../src/services/updateService';
import { useUpdateStore } from '../../src/store/updateStore';
import { APP_VERSION } from '../../src/version';

describe('Update System & Anti-Loop Invariants', () => {
  beforeEach(() => {
    localStorage.clear();
    useUpdateStore.setState({
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
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Semver Utilities', () => {
    it('cleans various version formats correctly', () => {
      expect(updateService.cleanVersion('v1.0.10')).toBe('1.0.10');
      expect(updateService.cleanVersion('1.0.10-patch1')).toBe('1.0.10');
      expect(updateService.cleanVersion('  v2.3.4  ')).toBe('2.3.4');
      expect(updateService.cleanVersion('')).toBe('0.0.0');
    });

    it('correctly compares semantic versions', () => {
      expect(updateService.compareSemver('1.0.10', '1.0.9')).toBe(1);
      expect(updateService.compareSemver('1.0.9', '1.0.10')).toBe(-1);
      expect(updateService.compareSemver('1.0.10', '1.0.10')).toBe(0);
      expect(updateService.compareSemver('v1.0.10', '1.0.10')).toBe(0);
      expect(updateService.compareSemver('1.1.0', '1.0.15')).toBe(1);
      expect(updateService.compareSemver('2.0.0', '1.9.9')).toBe(1);
    });
  });

  describe('getCurrentAppVersion Multi-Source Resolution', () => {
    it('purges stale dotify_update_installed_version from localStorage', async () => {
      localStorage.setItem('dotify_update_installed_version', '99.9.9');
      const resolved = await updateService.getCurrentAppVersion();
      expect(localStorage.getItem('dotify_update_installed_version')).toBeNull();
      expect(resolved).not.toBe('99.9.9');
    });

    it('returns native app version truthfully', async () => {
      const resolved = await updateService.getCurrentAppVersion();
      expect(typeof resolved).toBe('string');
      expect(resolved.split('.').length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('useUpdateStore Anti-Loop and State Invariants', () => {
    it('sets updateAvailable to false when remote matches current version', async () => {
      vi.spyOn(updateService, 'getCurrentAppVersion').mockResolvedValue('1.0.10');
      vi.spyOn(updateService, 'fetchLatestReleaseInfo').mockResolvedValue({
        version: '1.0.10',
        notes: 'Test release',
        publishedAt: Date.now(),
        windowsExeUrl: 'http://example.com/dotify.exe',
        windowsSetupUrl: 'http://example.com/dotify-setup.exe',
        androidApkUrl: 'http://example.com/dotify.apk',
      });

      const store = useUpdateStore.getState();
      const hasUpdate = await store.checkForUpdates(false);
      expect(hasUpdate).toBe(false);
      expect(useUpdateStore.getState().updateAvailable).toBe(false);
      expect(useUpdateStore.getState().isModalOpen).toBe(false);
    });

    it('suppresses auto-opening modal in background check if recently attempted', async () => {
      localStorage.setItem('dotify_update_attempt_version', '1.0.11');
      localStorage.setItem('dotify_update_attempt_time', String(Date.now() - 5 * 60 * 1000)); // 5 mins ago

      vi.spyOn(updateService, 'getCurrentAppVersion').mockResolvedValue('1.0.10');
      vi.spyOn(updateService, 'fetchLatestReleaseInfo').mockResolvedValue({
        version: '1.0.11',
        notes: 'Test release 1.0.11',
        publishedAt: Date.now(),
        windowsExeUrl: 'http://example.com/dotify.exe',
        windowsSetupUrl: 'http://example.com/dotify-setup.exe',
        androidApkUrl: 'http://example.com/dotify.apk',
      });

      const store = useUpdateStore.getState();
      // Background check detects update available, but suppresses modal to prevent loop
      const bgResult = await store.checkForUpdates(false);
      expect(bgResult).toBe(true);
      expect(useUpdateStore.getState().updateAvailable).toBe(true);
      expect(useUpdateStore.getState().recentlyAttempted).toBe(true);
      expect(useUpdateStore.getState().isModalOpen).toBe(false);

      // User initiated manual check allows modal to show retry/installer options
      const manualResult = await store.checkForUpdates(true);
      expect(manualResult).toBe(true);
      expect(useUpdateStore.getState().isModalOpen).toBe(true);
    });
  });
});
