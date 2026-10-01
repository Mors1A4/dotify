import { safeStorage } from '../utils/storage';
import { isTauriEnvironment, getCustomApiUrl } from './apiConfig';

// Per-CLIENT storage (not per-user): the download folder depends on this device's
// operating system, so it must never be synced across users/devices via cloud library.
// localStorage is inherently per-browser/per-device, and the authoritative path also
// lives in a device-local config file on the backend daemon.
const STORAGE_CLIENT_CUSTOM_DIR = 'mp3_download_dir_client_custom';
const STORAGE_CLIENT_DEFAULT_DIR = 'mp3_download_dir_client_default';

export interface DownloadDirInfo {
  path: string;
  defaultPath: string;
  customPath: string | null;
  writable: boolean;
  movedCount?: number;
}

function getDaemonBase(): string {
  const custom = getCustomApiUrl();
  if (custom) return custom;
  if (isTauriEnvironment()) return 'http://127.0.0.1:3001';
  return '';
}

function daemonEndpoint(path: string): string {
  const base = getDaemonBase();
  const clean = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${clean}` : clean;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const mod = await import('@tauri-apps/api/core');
  return mod.invoke<T>(cmd, args);
}

export function getCachedClientDownloadDir(): { custom: string | null; def: string } {
  const custom = safeStorage.getItem<string | null>(STORAGE_CLIENT_CUSTOM_DIR, null);
  const def = safeStorage.getItem<string>(STORAGE_CLIENT_DEFAULT_DIR, '');
  return {
    custom: typeof custom === 'string' && custom.trim() ? custom : null,
    def: typeof def === 'string' ? def : '',
  };
}

function cacheClientDownloadDir(info: DownloadDirInfo): void {
  if (info.defaultPath) {
    safeStorage.setItem(STORAGE_CLIENT_DEFAULT_DIR, info.defaultPath);
  }
  if (info.customPath) {
    safeStorage.setItem(STORAGE_CLIENT_CUSTOM_DIR, info.customPath);
  } else if (info.path && info.path !== info.defaultPath) {
    // Backend resolved a custom path but didn't echo customPath; cache current path
    safeStorage.setItem(STORAGE_CLIENT_CUSTOM_DIR, info.path);
  }
}

/**
 * Initial value is the current download location until the user changes it.
 * Falls back to the cached per-client value when the daemon is unreachable.
 */
export async function fetchDownloadDir(): Promise<DownloadDirInfo> {
  // Prefer the native Tauri command when running as a desktop app so the
  // authoritative per-device path is used even if the HTTP daemon is down.
  if (isTauriEnvironment()) {
    try {
      const info = await tauriInvoke<DownloadDirInfo>('get_download_dir');
      if (info && typeof info.path === 'string') {
        const normalized: DownloadDirInfo = {
          path: info.path,
          defaultPath: info.defaultPath || info.path,
          customPath: info.customPath ?? null,
          writable: info.writable !== false,
        };
        cacheClientDownloadDir(normalized);
        return normalized;
      }
    } catch {
      // Fall through to HTTP daemon
    }
  }

  try {
    const res = await fetch(daemonEndpoint('/api/mp3s/download-dir'), {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok && typeof data.path === 'string') {
        const normalized: DownloadDirInfo = {
          path: data.path,
          defaultPath: data.defaultPath || data.path,
          customPath: data.customPath ?? null,
          writable: data.writable !== false,
        };
        cacheClientDownloadDir(normalized);
        return normalized;
      }
    }
  } catch {
    // Daemon unreachable — use cached per-client value
  }

  const cached = getCachedClientDownloadDir();
  const fallbackPath = cached.custom || cached.def;
  if (fallbackPath) {
    return {
      path: fallbackPath,
      defaultPath: cached.def || fallbackPath,
      customPath: cached.custom,
      writable: true,
    };
  }
  throw new Error('Could not reach the local download service');
}

/**
 * Opens the OS-native folder browser to let the user pick a directory.
 * Tauri desktop: native FolderBrowserDialog. Web: File System Access API
 * directory picker where available (name hint only — full path still typed),
 * otherwise null so the caller falls back to manual path entry.
 */
export async function pickDownloadFolderViaSystemBrowser(
  currentPath?: string
): Promise<string | null> {
  if (isTauriEnvironment()) {
    try {
      const picked = await tauriInvoke<string | null>('pick_download_dir');
      if (typeof picked === 'string' && picked.trim()) return picked.trim();
      return null;
    } catch {
      return null;
    }
  }

  // Web fallback: showDirectoryPicker gives a handle, not an absolute server path,
  // but opening it still satisfies "system file browser" UX where supported.
  try {
    const w = window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: string }) => Promise<{ name?: string }>;
    };
    if (typeof w.showDirectoryPicker === 'function') {
      const handle = await w.showDirectoryPicker({ mode: 'readwrite' });
      // We cannot resolve a full filesystem path from the handle for the local
      // daemon, so return the chosen folder name as a hint for manual entry.
      if (handle && typeof handle.name === 'string' && handle.name) {
        return handle.name;
      }
      return null;
    }
  } catch {
    // User cancelled the picker
    return null;
  }
  return null;
}

/**
 * Validates writability on the backend, moves currently downloaded files to the
 * new folder, and persists the choice per-client (device-local only).
 */
export async function setDownloadFolder(targetPath: string): Promise<DownloadDirInfo> {
  const cleaned = String(targetPath || '').trim();
  if (!cleaned) throw new Error('Please choose a download folder');

  if (isTauriEnvironment()) {
    try {
      const info = await tauriInvoke<{
        path: string;
        defaultPath: string;
        customPath: string;
        movedCount: number;
        writable: boolean;
      }>('set_download_dir', { path: cleaned });
      const normalized: DownloadDirInfo = {
        path: info.path,
        defaultPath: info.defaultPath || cleaned,
        customPath: info.customPath ?? cleaned,
        writable: info.writable !== false,
        movedCount: Number(info.movedCount || 0),
      };
      cacheClientDownloadDir(normalized);
      return normalized;
    } catch (err: unknown) {
      // If the Tauri command is unavailable (older binary), fall through to HTTP
      const msg = err instanceof Error ? err.message : String(err ?? '');
      if (msg && !/command .* not found|plugin|invoke/i.test(msg)) {
        throw new Error(msg || 'Could not set download folder');
      }
    }
  }

  const res = await fetch(daemonEndpoint('/api/mp3s/download-dir'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: cleaned }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Could not set download folder (HTTP ${res.status})`);
  }
  const normalized: DownloadDirInfo = {
    path: data.path,
    defaultPath: data.defaultPath || data.path,
    customPath: data.customPath ?? cleaned,
    writable: data.writable !== false,
    movedCount: Number(data.movedCount || 0),
  };
  cacheClientDownloadDir(normalized);
  return normalized;
}
