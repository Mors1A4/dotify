import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePlayerStore } from '../../src/store/playerStore';
import { connectClient } from '../../src/services/connectClient';
import { audioEngine } from '../../src/audio/audioEngine';
import { ConnectedDevice } from '../../src/types/connect';
import { MOCK_AUDIUS_TRACK } from '../fixtures/mockData';

describe('Cross-Device Playback Controls & Local Takeover', () => {
  const desktopDevice: ConnectedDevice = {
    deviceId: 'dev_desktop_pc',
    deviceName: 'Desktop PC',
    deviceType: 'desktop',
    role: 'active_host',
    isCurrentDevice: false,
    isActive: true,
    volume: 0.8,
    lastSeen: Date.now(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState({
      volume: 0.8,
      connectMode: 'standalone',
      activeDevice: null,
      remoteDevices: [],
      isPlaying: false,
      currentTrack: null,
      queue: [],
    });
  });

  it('sends explicit idempotent play/pause commands and guards optimistic UI from in-flight echoes', () => {
    const sentCommands: any[] = [];
    vi.spyOn(connectClient, 'sendRemoteCommand').mockImplementation((action: any, data?: any) => {
      sentCommands.push({ action, data });
    });

    usePlayerStore.setState({
      currentTrack: MOCK_AUDIUS_TRACK,
      queue: [MOCK_AUDIUS_TRACK],
      connectMode: 'remote_controller',
      activeDevice: desktopDevice,
      isPlaying: false,
    });

    // Press play on phone while controller
    usePlayerStore.getState().togglePlay();

    // 1. Should send explicit 'play' command (idempotent, not inverting 'toggle_play')
    expect(sentCommands.length).toBe(1);
    expect(sentCommands[0].action).toBe('play');
    expect(usePlayerStore.getState().isPlaying).toBe(true);

    // 2. An in-flight stale PLAYBACK_STATE from host with isPlaying: false arriving within 1000ms must NOT override
    usePlayerStore.getState().applyRemotePlaybackState({
      currentTrack: MOCK_AUDIUS_TRACK,
      currentTrackIndex: 0,
      queue: [MOCK_AUDIUS_TRACK],
      isPlaying: false, // stale echo
      positionMs: 12000,
      durationMs: 200000,
      volume: 0.8,
      repeatMode: 'off',
      shuffle: false,
      timestamp: Date.now() - 50,
    }, desktopDevice.deviceId);

    expect(usePlayerStore.getState().isPlaying).toBe(true);

    // 3. Press pause on phone
    usePlayerStore.getState().togglePlay();
    expect(sentCommands.length).toBe(2);
    expect(sentCommands[1].action).toBe('pause');
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  it('seamlessly transfers playback back to local phone when switching back through phone', async () => {
    const localDev = connectClient.getLocalDevice();
    const sentRemoteCommands: any[] = [];
    vi.spyOn(connectClient, 'sendRemoteCommand').mockImplementation((action: any, data?: any, targetId?: string) => {
      sentRemoteCommands.push({ action, data, targetId });
    });

    const sentMessages: any[] = [];
    vi.spyOn(connectClient, 'sendMessage').mockImplementation((msg: any) => {
      sentMessages.push(msg);
    });

    const playTrackSpy = vi.spyOn(audioEngine, 'playTrackAtPosition').mockResolvedValue(undefined as any);

    // Setup initial state: phone is remote controller, desktop is active host playing music
    usePlayerStore.setState({
      currentTrack: MOCK_AUDIUS_TRACK,
      queue: [MOCK_AUDIUS_TRACK],
      currentTrackIndex: 0,
      connectMode: 'remote_controller',
      activeDevice: desktopDevice,
      remoteDevices: [desktopDevice, { ...localDev, isCurrentDevice: true }],
      isPlaying: true,
    });

    // Phone user taps "This Phone" to take over playback
    const success = await usePlayerStore.getState().transferPlaybackTo(localDev.deviceId);

    expect(success).toBe(true);

    // 1. Should instruct the previous desktop host to pause
    expect(sentRemoteCommands.some((c) => c.action === 'pause' && c.targetId === desktopDevice.deviceId)).toBe(true);

    // 2. Phone should immediately become active_host locally
    const state = usePlayerStore.getState();
    expect(state.connectMode).toBe('active_host');
    expect(state.activeDevice?.deviceId).toBe(localDev.deviceId);
    expect(state.activeDevice?.role).toBe('active_host');

    // 3. Phone should notify the network of the handoff takeover
    expect(sentMessages.some((m) => m.type === 'HANDOFF_TRANSFER' && m.targetDeviceId === localDev.deviceId)).toBe(true);

    // 4. Local audio engine should have loaded and played the track at the current position
    expect(playTrackSpy).toHaveBeenCalledWith(
      MOCK_AUDIUS_TRACK,
      expect.any(Number),
      true
    );

    // 5. Subsequent in-flight/pause updates from desktop must NOT hijack phone back to controller
    usePlayerStore.getState().applyRemotePlaybackState({
      currentTrack: MOCK_AUDIUS_TRACK,
      currentTrackIndex: 0,
      queue: [MOCK_AUDIUS_TRACK],
      isPlaying: false, // desktop paused
      positionMs: 15000,
      durationMs: 200000,
      volume: 0.8,
      repeatMode: 'off',
      shuffle: false,
      timestamp: Date.now(),
    }, desktopDevice.deviceId);

    expect(usePlayerStore.getState().connectMode).toBe('active_host');
    expect(usePlayerStore.getState().activeDevice?.deviceId).toBe(localDev.deviceId);
  });

  it('updates isPlaying state immediately in executeRemoteCommand so broadcasts are accurate', () => {
    usePlayerStore.setState({
      isPlaying: false,
      currentTrack: MOCK_AUDIUS_TRACK,
      queue: [MOCK_AUDIUS_TRACK],
      connectMode: 'active_host',
    });

    vi.spyOn(audioEngine, 'isPlaying').mockReturnValue(false);
    const resumeSpy = vi.spyOn(audioEngine, 'resume').mockImplementation(() => {});

    usePlayerStore.getState().executeRemoteCommand('play');

    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(resumeSpy).toHaveBeenCalled();
  });

  it('preserves local standalone mode when paused remote device sends playback state', async () => {
    const localDev = connectClient.getLocalDevice();
    const playTrackSpy = vi.spyOn(audioEngine, 'playTrackAtPosition').mockResolvedValue(undefined as any);

    // Initial state: phone controlling paused desktop
    usePlayerStore.setState({
      currentTrack: MOCK_AUDIUS_TRACK,
      queue: [MOCK_AUDIUS_TRACK],
      connectMode: 'remote_controller',
      activeDevice: desktopDevice,
      remoteDevices: [desktopDevice, { ...localDev, isCurrentDevice: true }],
      isPlaying: false,
    });

    // Transfer playback while paused
    const success = await usePlayerStore.getState().transferPlaybackTo(localDev.deviceId);
    expect(success).toBe(true);
    expect(usePlayerStore.getState().connectMode).toBe('standalone');
    expect(usePlayerStore.getState().activeDevice?.deviceId).toBe(localDev.deviceId);
    expect(playTrackSpy).toHaveBeenCalledWith(MOCK_AUDIUS_TRACK, expect.any(Number), false);

    // Desktop responds with its paused playback state
    usePlayerStore.getState().applyRemotePlaybackState({
      currentTrack: MOCK_AUDIUS_TRACK,
      currentTrackIndex: 0,
      queue: [MOCK_AUDIUS_TRACK],
      isPlaying: false,
      positionMs: 15000,
      durationMs: 200000,
      volume: 0.8,
      repeatMode: 'off',
      shuffle: false,
      timestamp: Date.now(),
    }, desktopDevice.deviceId);

    // Phone must REMAIN in standalone mode and not be hijacked
    expect(usePlayerStore.getState().connectMode).toBe('standalone');
    expect(usePlayerStore.getState().activeDevice?.deviceId).toBe(localDev.deviceId);

    // Now user taps play on phone - must prime audioEngine if needed and play locally
    vi.spyOn(audioEngine, 'getCurrentTrack').mockReturnValue(null);
    usePlayerStore.getState().togglePlay();

    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(playTrackSpy).toHaveBeenCalledWith(MOCK_AUDIUS_TRACK, 0, true);
  });
});
