import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePlayerStore, remoteProgressInterpolator } from '../../src/store/playerStore';
import { connectClient } from '../../src/services/connectClient';
import { audioEngine } from '../../src/audio/audioEngine';
import { Track } from '../../src/types/track';
import { ConnectedDevice } from '../../src/types/connect';

const MOCK_CAST_DEVICE: ConnectedDevice = {
  deviceId: 'cast:192.168.0.48:8009',
  deviceName: 'Kitchen speaker',
  deviceType: 'speaker',
  role: 'active_host',
  isCurrentDevice: false,
  isActive: true,
  volume: 0.7,
  lastSeen: Date.now(),
};

const MOCK_TRACK: Track = {
  id: 'test_trk_disconnect_1',
  title: 'Someone Like You',
  artist: 'Adele',
  album: '21',
  duration: 285,
  streamUrl: 'http://localhost:3001/api/stream/track?artist=Adele&title=Someone%20Like%20You',
  artworkUrl: 'https://example.com/adele.jpg',
  source: 'charts',
  sourceMetadata: {},
};

describe('Google Home Disconnect & Sticky Active Device Invariants', () => {
  beforeEach(() => {
    audioEngine.setControllerMode(false);
    audioEngine.setVolume(0);
    remoteProgressInterpolator.stop();

    const localDev = connectClient.getLocalDevice();
    usePlayerStore.setState({
      connectMode: 'standalone',
      isPlaying: false,
      currentTrack: null,
      activeDevice: { ...localDev, isActive: true, isCurrentDevice: true },
      queue: [],
      volume: 0,
      isDevicePickerOpen: false,
    });
  });

  it('disconnectRemoteDevice resets connectMode to standalone and anchors activeDevice to local device', async () => {
    // Simulate being connected to Google Home
    usePlayerStore.setState({
      connectMode: 'remote_controller',
      activeDevice: MOCK_CAST_DEVICE,
      currentTrack: MOCK_TRACK,
      isPlaying: true,
    });

    const sendCmdSpy = vi.spyOn(connectClient, 'sendRemoteCommand');
    const disconnectSpy = vi.spyOn(connectClient, 'disconnectRemote');

    await usePlayerStore.getState().disconnectRemoteDevice();

    const state = usePlayerStore.getState();
    expect(state.connectMode).toBe('standalone');
    expect(state.activeDevice?.isCurrentDevice).toBe(true);
    expect(state.activeDevice?.deviceId).toBe(connectClient.getLocalDevice().deviceId);
    expect(sendCmdSpy).toHaveBeenCalledWith('stop', {}, 'cast:192.168.0.48:8009');
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('onDeviceListUpdate does not overwrite activeDevice when in standalone mode', () => {
    const localDev = connectClient.getLocalDevice();
    usePlayerStore.setState({
      connectMode: 'standalone',
      activeDevice: { ...localDev, isActive: true, isCurrentDevice: true },
    });

    // Simulate backend sending DEVICE_LIST with activeDeviceId set to a Cast speaker
    const node = (connectClient as any).client || connectClient;
    node.handleIncomingMessage({
      type: 'DEVICE_LIST',
      devices: [
        { ...localDev, isCurrentDevice: true, isActive: false },
        MOCK_CAST_DEVICE,
      ],
      activeDeviceId: 'cast:192.168.0.48:8009',
    });

    const state = usePlayerStore.getState();
    expect(state.connectMode).toBe('standalone');
    // Active device MUST remain the local device, NOT the remote speaker!
    expect(state.activeDevice?.isCurrentDevice).toBe(true);
    expect(state.activeDevice?.deviceId).toBe(localDev.deviceId);
  });

  it('transferPlaybackTo local device calls disconnectRemoteDevice and sets standalone mode cleanly', async () => {
    const localDev = connectClient.getLocalDevice();
    usePlayerStore.setState({
      connectMode: 'remote_controller',
      activeDevice: MOCK_CAST_DEVICE,
      currentTrack: MOCK_TRACK,
      isPlaying: false,
    });

    const success = await usePlayerStore.getState().transferPlaybackTo(localDev.deviceId);

    expect(success).toBe(true);
    const state = usePlayerStore.getState();
    expect(state.connectMode).toBe('standalone');
    expect(state.activeDevice?.isCurrentDevice).toBe(true);
  });

  it('connectClient.unpair dispatches DISCONNECT_REMOTE and UNPAIR messages', () => {
    const sendSpy = vi.spyOn(connectClient, 'sendMessage');

    connectClient.unpair();

    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UNPAIR',
      })
    );
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DISCONNECT_REMOTE',
      })
    );
  });
});
