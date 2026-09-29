import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db, firebaseConfig } from './firebase';
import { isTauriEnvironment, isAndroidApp } from './apiConfig';
import { APP_VERSION, RELEASE_GITHUB_REPO } from '../version';

export interface AppReleaseInfo {
  version: string;
  notes: string;
  publishedAt: number;
  windowsExeUrl: string;
  windowsSetupUrl: string;
  androidApkUrl: string;
  releasePageUrl?: string;
  mandatory?: boolean;
}

export interface UpdateProgressPayload {
  percent: number;
  status: string;
  error?: string | null;
}

export function cleanVersion(version: string): string {
  return (version || '').trim().replace(/^v/i, '').split('-')[0].trim() || '0.0.0';
}

export function compareSemver(vA: string, vB: string): number {
  const partsA = cleanVersion(vA).split('.').map((n) => parseInt(n, 10) || 0);
  const partsB = cleanVersion(vB).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(partsA.length, partsB.length, 3);
  for (let i = 0; i < len; i++) {
    const a = partsA[i] || 0;
    const b = partsB[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

export async function getCurrentAppVersion(): Promise<string> {
  if (typeof window !== 'undefined' && (window as any).AndroidNativeUpdater?.getVersionName) {
    try {
      const androidVer = (window as any).AndroidNativeUpdater.getVersionName();
      if (androidVer && typeof androidVer === 'string') {
        const cleaned = cleanVersion(androidVer);
        if (cleaned && cleaned !== '0.0.0') {
          return cleaned;
        }
      }
    } catch {
      // ignore
    }
  }

  if (isTauriEnvironment()) {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      const tauriVer = await getVersion();
      if (tauriVer && typeof tauriVer === 'string') {
        const cleaned = cleanVersion(tauriVer);
        if (cleaned && cleaned !== '0.0.0') {
          return cleaned;
        }
      }
    } catch {
      // ignore
    }
  }

  return cleanVersion(APP_VERSION);
}

function buildDefaultReleaseUrls(version: string): {
  windowsExeUrl: string;
  windowsSetupUrl: string;
  androidApkUrl: string;
  releasePageUrl: string;
} {
  const clean = cleanVersion(version);
  const tag = `v${clean}`;
  const base = `https://github.com/${RELEASE_GITHUB_REPO}/releases/download/${tag}`;
  return {
    windowsExeUrl: `${base}/dotify.exe`,
    windowsSetupUrl: `${base}/dotify-setup.exe`,
    androidApkUrl: `${base}/dotify.apk`,
    releasePageUrl: `https://github.com/${RELEASE_GITHUB_REPO}/releases/tag/${tag}`,
  };
}

async function fetchReleaseFromFirestore(): Promise<AppReleaseInfo | null> {
  // 1. Try Firebase SDK getDoc
  try {
    const ref = doc(db, 'app_config', 'release');
    const snap = await Promise.race([
      getDoc(ref),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500)),
    ]);
    if (snap && snap.exists()) {
      const data = snap.data() as any;
      if (data && data.version) {
        const urls = buildDefaultReleaseUrls(data.version);
        return {
          version: cleanVersion(data.version),
          notes: data.notes || `Dotify v${cleanVersion(data.version)} update with the latest improvements and fixes.`,
          publishedAt: Number(data.publishedAt) || Date.now(),
          windowsExeUrl: data.windowsExeUrl || urls.windowsExeUrl,
          windowsSetupUrl: data.windowsSetupUrl || urls.windowsSetupUrl,
          androidApkUrl: data.androidApkUrl || urls.androidApkUrl,
          releasePageUrl: data.releasePageUrl || urls.releasePageUrl,
          mandatory: Boolean(data.mandatory),
        };
      }
    }
  } catch {
    // Fallback to direct Firestore REST endpoint
  }

  // 2. Direct Firestore REST API fallback (works even if WebSocket/IndexedDB is blocked)
  try {
    const restUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/app_config/release?_t=${Date.now()}`;
    const res = await fetch(restUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const docJson = await res.json();
      const f = docJson?.fields;
      const version = f?.version?.stringValue;
      if (version) {
        const urls = buildDefaultReleaseUrls(version);
        return {
          version: cleanVersion(version),
          notes:
            f?.notes?.stringValue ||
            `Dotify v${cleanVersion(version)} update with the latest improvements and fixes.`,
          publishedAt: Number(f?.publishedAt?.integerValue || f?.publishedAt?.doubleValue) || Date.now(),
          windowsExeUrl: f?.windowsExeUrl?.stringValue || urls.windowsExeUrl,
          windowsSetupUrl: f?.windowsSetupUrl?.stringValue || urls.windowsSetupUrl,
          androidApkUrl: f?.androidApkUrl?.stringValue || urls.androidApkUrl,
          releasePageUrl: f?.releasePageUrl?.stringValue || urls.releasePageUrl,
          mandatory: Boolean(f?.mandatory?.booleanValue),
        };
      }
    }
  } catch {
    // ignore
  }

  return null;
}

async function fetchReleaseFromGitHub(): Promise<AppReleaseInfo | null> {
  try {
    const apiUrl = `https://api.github.com/repos/${RELEASE_GITHUB_REPO}/releases/latest`;
    const res = await fetch(apiUrl, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rawTag = data?.tag_name || data?.name;
    if (!rawTag) return null;

    const version = cleanVersion(rawTag);
    const defaults = buildDefaultReleaseUrls(version);
    const assets: any[] = Array.isArray(data.assets) ? data.assets : [];

    const findAsset = (namePattern: RegExp) =>
      assets.find((a) => a?.name && namePattern.test(a.name))?.browser_download_url;

    return {
      version,
      notes: data.body || `Dotify v${version} release.`,
      publishedAt: data.published_at ? new Date(data.published_at).getTime() : Date.now(),
      windowsExeUrl: findAsset(/^dotify\.exe$/i) || defaults.windowsExeUrl,
      windowsSetupUrl: findAsset(/setup\.exe$/i) || defaults.windowsSetupUrl,
      androidApkUrl: findAsset(/\.apk$/i) || defaults.androidApkUrl,
      releasePageUrl: data.html_url || defaults.releasePageUrl,
      mandatory: false,
    };
  } catch {
    return null;
  }
}

export async function fetchLatestReleaseInfo(): Promise<AppReleaseInfo | null> {
  const [fsRelease, ghRelease] = await Promise.all([
    fetchReleaseFromFirestore(),
    fetchReleaseFromGitHub(),
  ]);

  if (fsRelease && ghRelease) {
    return compareSemver(fsRelease.version, ghRelease.version) >= 0 ? fsRelease : ghRelease;
  }
  return fsRelease || ghRelease || null;
}

export function subscribeToReleaseManifest(
  onUpdate: (release: AppReleaseInfo) => void
): () => void {
  try {
    const ref = doc(db, 'app_config', 'release');
    return onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as any;
        if (!data || !data.version) return;
        const urls = buildDefaultReleaseUrls(data.version);
        onUpdate({
          version: cleanVersion(data.version),
          notes: data.notes || `Dotify v${cleanVersion(data.version)} update.`,
          publishedAt: Number(data.publishedAt) || Date.now(),
          windowsExeUrl: data.windowsExeUrl || urls.windowsExeUrl,
          windowsSetupUrl: data.windowsSetupUrl || urls.windowsSetupUrl,
          androidApkUrl: data.androidApkUrl || urls.androidApkUrl,
          releasePageUrl: data.releasePageUrl || urls.releasePageUrl,
          mandatory: Boolean(data.mandatory),
        });
      },
      () => {
        // ignore snapshot offline errors
      }
    );
  } catch {
    return () => {};
  }
}

export async function openReleaseAssetExternal(url: string): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).AndroidNativeAuth?.openBrowser) {
    try {
      const ok = (window as any).AndroidNativeAuth.openBrowser(url);
      if (ok !== false) return;
    } catch {}
  }

  if (isTauriEnvironment()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch {}
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_external_browser', { url });
      return;
    } catch {}
  }

  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export async function performSelfUpdate(
  release: AppReleaseInfo,
  onProgress: (progress: UpdateProgressPayload) => void
): Promise<void> {
  // 1. Android APK Native Self-Update
  if (isAndroidApp() || (typeof window !== 'undefined' && (window as any).AndroidNativeUpdater)) {
    const updater = typeof window !== 'undefined' ? (window as any).AndroidNativeUpdater : null;
    if (updater && typeof updater.downloadAndInstallApk === 'function') {
      return new Promise<void>((resolve, reject) => {
        (window as any).__onAndroidUpdateProgress = (payload: UpdateProgressPayload) => {
          onProgress(payload);
          if (payload.error) {
            reject(new Error(payload.error));
          } else if (payload.percent >= 100) {
            resolve();
          }
        };

        try {
          onProgress({ percent: 5, status: 'Starting Android APK download...' });
          const started = updater.downloadAndInstallApk(release.androidApkUrl);
          if (started === false) {
            reject(new Error('Could not start native Android APK downloader'));
          }
        } catch (err: any) {
          reject(err);
        }
      });
    }

    // Fallback if running an older APK without AndroidNativeUpdater bridge:
    // Open direct APK download URL in system browser so Android downloads and installs it
    onProgress({ percent: 100, status: 'Opening APK installer download in browser...' });
    await openReleaseAssetExternal(release.androidApkUrl);
    return;
  }

  // 2. Windows Desktop Tauri Native Self-Update
  if (isTauriEnvironment()) {
    let unlisten: (() => void) | null = null;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');

      unlisten = await listen<UpdateProgressPayload>('update-download-progress', (event) => {
        if (event.payload) {
          onProgress(event.payload);
        }
      });

      onProgress({ percent: 5, status: 'Connecting to release server...' });
      await invoke('install_windows_update', {
        exeUrl: release.windowsExeUrl,
        setupUrl: release.windowsSetupUrl,
      });
    } finally {
      if (unlisten) {
        try {
          unlisten();
        } catch {}
      }
    }
    return;
  }

  // 3. Web Browser fallback
  onProgress({ percent: 100, status: 'Reloading web application...' });
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}
