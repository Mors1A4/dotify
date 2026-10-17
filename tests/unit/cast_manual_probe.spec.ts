import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = globalThis;
}

const storageMap: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => storageMap[k] || null,
  setItem: (k: string, v: string) => { storageMap[k] = String(v); },
  removeItem: (k: string) => { delete storageMap[k]; },
  clear: () => {
    for (const key of Object.keys(storageMap)) {
      delete storageMap[key];
    }
  },
};

import { castService } from '../../src/services/castService';
import { connectClient } from '../../src/services/connectClient';

describe('Android Native Cast Discovery & Manual IP Probing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).localStorage.clear();
  });

  afterEach(() => {
    delete (globalThis as any).AndroidNativeCast;
  });

  it('probes speaker via AndroidNativeCast when available and registers it', async () => {
    const mockDevice = {
      deviceId: 'cast:192.168.0.48:8009',
      deviceName: 'Living Room Speaker',
      deviceType: 'speaker',
      role: 'active_host',
      isCurrentDevice: false,
      isActive: false,
      volume: 0.7,
      lastSeen: Date.now(),
      capabilities: { canPlayAudio: true, isController: false },
      castDetails: {
        ip: '192.168.0.48',
        port: 8009,
        model: 'Google Home Mini',
        udn: '',
      },
    };

    (globalThis as any).AndroidNativeCast = {
      getWifiIp: vi.fn().mockReturnValue('192.168.0.12'),
      probeCastSpeaker: vi.fn().mockReturnValue(JSON.stringify(mockDevice)),
      scanCastDevices: vi.fn().mockReturnValue(JSON.stringify([mockDevice])),
    };

    const dev = await castService.probeSpeakerIp('192.168.0.48');

    expect((globalThis as any).AndroidNativeCast.probeCastSpeaker).toHaveBeenCalledWith('192.168.0.48');
    expect(dev).toBeDefined();
    expect(dev?.deviceId).toBe('cast:192.168.0.48:8009');
    expect(dev?.deviceName).toBe('Living Room Speaker');

    // Should remember device in connectClient
    const discovered = connectClient.getDiscoveredDevices();
    const found = discovered.find((d) => d.deviceId === 'cast:192.168.0.48:8009');
    expect(found).toBeDefined();
    expect(found?.deviceName).toBe('Living Room Speaker');

    // Should cache the IP in localStorage
    const cachedIps = JSON.parse(localStorage.getItem('dotify_cached_cast_ips') || '[]');
    expect(cachedIps).toContain('192.168.0.48');
  });

  it('scans cast devices using AndroidNativeCast and returns discovered speakers', async () => {
    const speaker1 = {
      deviceId: 'cast:192.168.0.50:8009',
      deviceName: 'Kitchen Nest Audio',
      deviceType: 'speaker',
      role: 'active_host',
      isCurrentDevice: false,
      isActive: false,
      volume: 0.7,
      lastSeen: Date.now(),
      capabilities: { canPlayAudio: true, isController: false },
      castDetails: { ip: '192.168.0.50', port: 8009, model: 'Nest Audio', udn: '' },
    };

    (globalThis as any).AndroidNativeCast = {
      getWifiIp: vi.fn().mockReturnValue('192.168.0.12'),
      probeCastSpeaker: vi.fn().mockReturnValue(''),
      scanCastDevices: vi.fn().mockReturnValue(JSON.stringify([speaker1])),
    };

    const devices = await castService.scanForDevices();

    expect((globalThis as any).AndroidNativeCast.scanCastDevices).toHaveBeenCalled();
    const found = devices.find((d) => d.deviceId === 'cast:192.168.0.50:8009');
    expect(found).toBeDefined();
    expect(found?.deviceName).toBe('Kitchen Nest Audio');
  });

  it('returns Wi-Fi IP from AndroidNativeCast when available', () => {
    (globalThis as any).AndroidNativeCast = {
      getWifiIp: vi.fn().mockReturnValue('192.168.1.88'),
    };

    const wifiIp = castService.getWifiIp();
    expect(wifiIp).toBe('192.168.1.88');
  });
});
