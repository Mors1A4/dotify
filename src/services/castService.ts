import { ConnectedDevice } from '../types/connect';
import { getApiUrl, isTauriEnvironment } from './apiConfig';
import { connectClient } from './connectClient';

const CACHED_CAST_IPS_KEY = 'dotify_cached_cast_ips';

/**
 * Google Cast Service for Dotify
 * Synchronizes discovered Google Home, Nest Audio, and Chromecast smart speakers
 * with the ConnectClient and playerStore across Desktop and Mobile.
 */

class CastService {
  private isScanning: boolean = false;
  private scanTimer: any = null;
  private discoveredCastDevices: Map<string, ConnectedDevice> = new Map();
  private lastScanTimestamp: number = 0;

  constructor() {
    // Initial fetch on app launch
    this.fetchCastDevices();

    // Auto-poll for smart speakers every 30 seconds
    if (typeof window !== 'undefined') {
      this.scanTimer = setInterval(() => {
        this.fetchCastDevices();
      }, 30000);
    }
  }

  private getCachedIps(): string[] {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(CACHED_CAST_IPS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed.filter((ip) => typeof ip === 'string' && ip.trim());
        }
      }
    } catch {}
    return [];
  }

  private saveCachedIp(ip: string) {
    if (!ip) return;
    try {
      if (typeof localStorage !== 'undefined') {
        const current = this.getCachedIps();
        if (!current.includes(ip)) {
          current.push(ip);
          localStorage.setItem(CACHED_CAST_IPS_KEY, JSON.stringify(current.slice(-10)));
        }
      }
    } catch {}
  }

  private rememberDevices(devices: ConnectedDevice[]) {
    if (!Array.isArray(devices)) return;
    for (const dev of devices) {
      if (dev && dev.deviceId) {
        this.discoveredCastDevices.set(dev.deviceId, dev);
        const ip = dev.castDetails?.ip || (dev.deviceId.startsWith('cast:') ? dev.deviceId.split(':')[1] : null);
        if (ip) {
          this.saveCachedIp(ip);
        }
      }
    }
    connectClient.registerExternalDevices(devices);
  }

  /**
   * Probe a specific IP address directly for a Google Cast speaker (e.g. 192.168.0.48)
   */
  public async probeSpeakerIp(ip: string): Promise<ConnectedDevice | null> {
    const cleanIp = (ip || '').trim();
    if (!cleanIp) return null;

    // 1. Try Tauri native invoke
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const dev: any = await invoke('probe_cast_speaker', { ip: cleanIp });
        if (dev && dev.deviceId) {
          this.rememberDevices([dev]);
          return dev;
        }
      } catch (err) {
        console.debug('[CastService] Native probe fallback to HTTP:', err);
      }
    }

    // 2. Try HTTP endpoint
    try {
      const url = getApiUrl(`/api/cast/probe?ip=${encodeURIComponent(cleanIp)}`);
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        if (data && data.device) {
          this.rememberDevices([data.device]);
          return data.device;
        }
      }
    } catch (err) {
      console.debug('[CastService] HTTP probe error:', err);
    }

    return null;
  }

  /**
   * Fetch known Cast devices from native backend and HTTP server
   */
  public async fetchCastDevices(): Promise<ConnectedDevice[]> {
    // 1. Native Tauri Rust query
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const nativeDevs: any = await invoke('get_cast_devices');
        if (Array.isArray(nativeDevs) && nativeDevs.length > 0) {
          this.rememberDevices(nativeDevs);
        }
      } catch (err) {
        console.debug('[CastService] Native get_cast_devices error:', err);
      }
    }

    // 2. Immediately probe any cached IPs in parallel
    const cachedIps = this.getCachedIps();
    if (cachedIps.length > 0) {
      Promise.allSettled(cachedIps.map((ip) => this.probeSpeakerIp(ip))).catch(() => {});
    }

    // 3. HTTP backend fetch
    try {
      const url = getApiUrl('/api/cast/devices');
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.devices)) {
          this.rememberDevices(data.devices);
          return data.devices;
        }
      }
    } catch (err) {
      console.debug('[CastService] Fetching cast devices deferred:', err);
    }

    return Array.from(this.discoveredCastDevices.values());
  }

  /**
   * Trigger an active network subnet & mDNS scan for Google Cast speakers
   */
  public async scanForDevices(): Promise<ConnectedDevice[]> {
    if (this.isScanning || Date.now() - this.lastScanTimestamp < 5000) {
      return Array.from(this.discoveredCastDevices.values());
    }
    this.lastScanTimestamp = Date.now();

    // Immediately fetch known & cached devices first
    await this.fetchCastDevices();

    this.isScanning = true;
    try {
      // 1. Trigger native Tauri Rust scan if on Desktop or Android
      if (isTauriEnvironment()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const nativeDevs: any = await invoke('scan_cast_devices');
          if (Array.isArray(nativeDevs) && nativeDevs.length > 0) {
            this.rememberDevices(nativeDevs);
          }
        } catch (err) {
          console.debug('[CastService] Native scan_cast_devices error:', err);
        }
      }

      // 2. Trigger HTTP server scan
      const url = getApiUrl('/api/cast/scan');
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.devices)) {
          this.rememberDevices(data.devices);
          return data.devices;
        }
      }
    } catch (err) {
      console.warn('[CastService] Network scan error:', err);
    } finally {
      this.isScanning = false;
    }

    return Array.from(this.discoveredCastDevices.values());
  }

  public getDevices(): ConnectedDevice[] {
    return Array.from(this.discoveredCastDevices.values());
  }

  public destroy() {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }
}

export const castService = new CastService();
