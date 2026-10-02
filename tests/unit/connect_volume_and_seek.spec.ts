import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePlayerStore, remoteProgressInterpolator } from '../../src/store/playerStore';
import { connectClient } from '../../src/services/connectClient';
import { audioEngine } from '../../src/audio/audioEngine';
import { ConnectedDevice } from '../../src/types/connect';

describe('Connect Volume Persistence & Remote Seeking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState({
      volume: 0.8,
      connectMode: 'standalone',
      activeDevice: null,
      remoteDevices: [],
      isPlaying: false,
    });
  });

  it('preserves user-adjusted remote volume across device re-discovery cycles', () => {
    const castSpeaker: ConnectedDevice = {
      deviceId: 'cast:192.168.0.48:8009',
      deviceName: 'Living Room Speaker',
      deviceType: 'speaker',
      role: 'active_host',
      isCurrentDevice: false,
      isActive: true,
      volume: 0.7,
      lastSeen: Date.now(),
    };

    connectClient.registerExternalDevices([castSpeaker]);
    usePlayerStore.getState().setConnectMode('remote_controller', castSpeaker);

    // User changes volume to 35%
    usePlayerStore.getState().setRemoteVolume(castSpeaker.deviceId, 0.35);

    expect(usePlayerStore.getState().volume).toBe(0.35);
    expect(usePlayerStore.getState().activeDevice?.volume).toBe(0.35);
    expect(
      usePlayerStore.getState().remoteDevices.find((d) => d.deviceId === castSpeaker.deviceId)?.volume
    ).toBe(0.35);

    // Simulated re-discovery cycle (e.g. menu closed and reopened, network scan runs with default 0.7)
    const redisoveredWithDefault: ConnectedDevice = {
      ...castSpeaker,
      volume: 0.7, // Incoming probe from network
    };

    connectClient.registerExternalDevices([redisoveredWithDefault]);

    // Volume MUST remain 0.35 and NOT jump back to 0.7
    expect(usePlayerStore.getState().volume).toBe(0.35);
    expect(usePlayerStore.getState().activeDevice?.volume).toBe(0.35);
    expect(
      usePlayerStore.getState().remoteDevices.find((d) => d.deviceId === castSpeaker.deviceId)?.volume
    ).toBe(0.35);
  });

  it('immediately updates remoteProgressInterpolator when seeking in controller mode', () => {
    const castSpeaker: ConnectedDevice = {
      deviceId: 'cast:192.168.0.48:8009',
      deviceName: 'Living Room Speaker',
      deviceType: 'speaker',
      role: 'active_host',
      isCurrentDevice: false,
      isActive: true,
      volume: 0.5,
      lastSeen: Date.now(),
    };

    usePlayerStore.getState().setConnectMode('remote_controller', castSpeaker);
    remoteProgressInterpolator.resetForTrack(240);

    // Initial position ~ 10s
    remoteProgressInterpolator.sync({
      positionMs: 10000,
      durationMs: 240000,
      isPlaying: true,
      remoteTimestamp: Date.now(),
    });

    expect(remoteProgressInterpolator.getCurrentPosition()).toBeCloseTo(10, 0);

    // Seek to 95s
    usePlayerStore.getState().seekTo(95);

    // Immediately after seeking, getCurrentPosition should reflect 95s, not 10s
    expect(remoteProgressInterpolator.getCurrentPosition()).toBeCloseTo(95, 0);
  });

  it('rejects stale pre-seek position updates within the seek-lock window', () => {
    remoteProgressInterpolator.resetForTrack(200);

    // User seeks to 120s
    remoteProgressInterpolator.seek(120);

    // Stale delayed network packet arrives with 15s (pre-seek time)
    remoteProgressInterpolator.sync({
      positionMs: 15000,
      durationMs: 200000,
      isPlaying: true,
      remoteTimestamp: Date.now(),
    });

    // Stale 15s must be rejected; position must remain ~120s
    expect(remoteProgressInterpolator.getCurrentPosition()).toBeGreaterThanOrEqual(119.5);
  });

  it('emits synthetic time update immediately upon seeking in controller mode via audioEngine', () => {
    const castSpeaker: ConnectedDevice = {
      deviceId: 'cast:192.168.0.48:8009',
      deviceName: 'Kitchen Speaker',
      deviceType: 'speaker',
      role: 'active_host',
      isCurrentDevice: false,
      isActive: true,
      volume: 0.5,
      lastSeen: Date.now(),
    };

    usePlayerStore.getState().setConnectMode('remote_controller', castSpeaker);

    const receivedTimes: number[] = [];
    const unsub = audioEngine.onTimeUpdate((current) => {
      receivedTimes.push(current);
    });

    audioEngine.seekTo(72.5);

    unsub();
    expect(receivedTimes).toContain(72.5);
  });
});
