import { ConnectedDevice } from '../types/connect';
import { getApiUrl } from './apiConfig';
import { connectClient } from './connectClient';

/**
 * Google Cast Service for Dotify
 * Synchronizes discovered Google Home, Nest Audio, and Chromecast smart speakers
 * with the ConnectClient and playerStore.
 */

class CastService {
  private isScanning: boolean = false;
  private scanTimer: any = null;
  private discoveredCastDevices: Map<string, ConnectedDevice> = new Map();

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

  /**
   * Fetch known Cast devices from the backend
   */
  public async fetchCastDevices(): Promise<ConnectedDevice[]> {
    try {
      const url = getApiUrl('/api/cast/devices');
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.devices)) {
          for (const dev of data.devices) {
            this.discoveredCastDevices.set(dev.deviceId, dev);
          }
          connectClient.registerExternalDevices(data.devices);
          return data.devices;
        }
      }
    } catch (err) {
      console.debug('[CastService] Fetching cast devices deferred:', err);
    }
    return Array.from(this.discoveredCastDevices.values());
  }

  /**
   * Trigger an active network mDNS / Eureka scan for Google Cast speakers
   */
  public async scanForDevices(): Promise<ConnectedDevice[]> {
    if (this.isScanning) {
      return Array.from(this.discoveredCastDevices.values());
    }

    this.isScanning = true;
    try {
      const url = getApiUrl('/api/cast/scan');
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.devices)) {
          for (const dev of data.devices) {
            this.discoveredCastDevices.set(dev.deviceId, dev);
          }
          connectClient.registerExternalDevices(data.devices);
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
