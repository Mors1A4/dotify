/**
 * Universal API Configuration & Server Resolver
 * Handles dynamic API routing for Web, Tauri Desktop, and Tauri Android.
 */

export function isTauriEnvironment(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
      ((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)
  );
}

export function isAndroidApp(): boolean {
  if (typeof navigator === 'undefined') return false;
  return isTauriEnvironment() && /android/i.test(navigator.userAgent);
}

const CUSTOM_API_STORAGE_KEY = 'dotify_custom_api_url';

export function getCustomApiUrl(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const val = localStorage.getItem(CUSTOM_API_STORAGE_KEY);
      if (val && typeof val === 'string' && val.trim()) {
        return val.trim().replace(/\/+$/, '');
      }
    }
  } catch {
    // ignore storage errors
  }
  return '';
}

export function setCustomApiUrl(url: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      const cleaned = (url || '').trim().replace(/\/+$/, '');
      if (cleaned) {
        localStorage.setItem(CUSTOM_API_STORAGE_KEY, cleaned);
      } else {
        localStorage.removeItem(CUSTOM_API_STORAGE_KEY);
      }
    }
  } catch {
    // ignore storage errors
  }
}

export async function testServerConnection(targetUrl?: string): Promise<{
  ok: boolean;
  latencyMs: number;
  message: string;
}> {
  const start = Date.now();
  const base = (targetUrl !== undefined ? targetUrl : getApiBaseUrl()).trim().replace(/\/+$/, '');
  const endpoint = base ? `${base}/api/health` : '/api/health';
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(4000) });
    const latencyMs = Math.max(1, Date.now() - start);
    if (res.ok) {
      return { ok: true, latencyMs, message: 'Connected' };
    }
    return { ok: false, latencyMs, message: `HTTP ${res.status}` };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Math.max(1, Date.now() - start),
      message: err?.message || 'Connection failed',
    };
  }
}

export function getDiscoveredDesktopPeer(): { ip: string; port: number } | null {
  try {
    if (typeof window !== 'undefined') {
      const w = window as any;
      if (Array.isArray(w.__DOTIFY_PEERS__)) {
        const p = w.__DOTIFY_PEERS__.find((item: any) => item.deviceType === 'desktop' && item.ip);
        if (p) return { ip: p.ip, port: p.port || 3001 };
      }
    }
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem('dotify_last_desktop_peer');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.ip) return { ip: parsed.ip, port: parsed.port || 3001 };
      }
    }
  } catch {}
  return null;
}

/**
 * Returns the effective base URL for backend API requests.
 * E.g., '' (relative) or 'http://localhost:3001'
 */
export function getApiBaseUrl(): string {
  const customUrl = getCustomApiUrl();
  if (customUrl) {
    return customUrl;
  }

  // 1. Vite environment variable (if provided at build/runtime)
  const envUrl = (import.meta as any).env?.VITE_API_BASE_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  // 2. Desktop / Android Tauri detection:
  // In Tauri, web assets run from http://tauri.localhost or https://tauri.localhost.
  // Relative '/api' would fail unless routed to a live server.
  if (isTauriEnvironment()) {
    if (isAndroidApp()) {
      const desktopPeer = getDiscoveredDesktopPeer();
      if (desktopPeer) {
        return `http://${desktopPeer.ip}:${desktopPeer.port || 3001}`;
      }
      return 'http://127.0.0.1:3001';
    }
    // On Desktop Tauri, localhost:3001 is where the desktop daemon runs
    return 'http://localhost:3001';
  }

  // 3. Standard browser on LAN (e.g. mobile browser or Dad's PC hitting Monty's IP)
  if (typeof window !== 'undefined' && window.location) {
    const loc = window.location;
    if (loc.hostname && loc.hostname !== 'localhost' && loc.hostname !== '127.0.0.1') {
      return `${loc.protocol}//${loc.hostname}:3001`;
    }
  }

  // 4. Standard local dev browser: empty prefix uses relative proxy (/api -> :3001)
  return '';
}

/**
 * Resolves a full API path against the active base URL.
 * Example: getApiUrl('/api/charts/tracks') -> 'http://localhost:3001/api/charts/tracks'
 */
export function getApiUrl(path: string): string {
  const base = getApiBaseUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (!base) return cleanPath;
  return `${base}${cleanPath}`;
}

/**
 * Resolves the WebSocket URL for Spotify Connect Hub.
 */
export function getWsUrl(customPath = '/ws/connect'): string {
  const envWs = (import.meta as any).env?.VITE_WS_URL;
  if (envWs) return envWs;

  if (typeof window !== 'undefined') {
    if (isTauriEnvironment()) {
      return `ws://localhost:3001${customPath}`;
    }
    const loc = window.location;
    const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = loc.host || 'localhost:3001';
    return `${protocol}//${host}${customPath}`;
  }

  return `ws://localhost:3001${customPath}`;
}

