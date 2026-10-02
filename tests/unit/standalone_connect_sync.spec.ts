import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConnectClient } from '../../src/services/connectClient';
import { usePlayerStore } from '../../src/store/playerStore';
import { audioEngine } from '../../src/audio/audioEngine';
import { Track } from '../../src/types/track';

const MOCK_TRACK: Track = {
  id: 'sync_test_track_1',
  title: 'Starboy',
  artist: 'The Weeknd',
  album: 'Starboy',
  duration: 230,
  streamUrl: 'https://example.com/starboy.mp3',
  previewUrl: 'https://example.com/starboy_preview.mp3',
  artworkUrl: 'https://example.com/starboy.jpg',
  source: 'charts',
  sourceMetadata: { source: 'charts' },
};

describe('Standalone Cross-Device Connect Sync Invariants', () => {
  beforeEach(() => {
    audioEngine.setControllerMode(false);
    usePlayerStore.setState({
      connectMode: 'standalone',
      isPlaying: false,
      currentTrack: null,
      activeDevice: null,
      queue: [],
      currentTrackIndex: 0,
      volume: 0.8,
    });
  });

  it('updates connectClient.activeDeviceId when PLAYBACK_STATE message arrives', () => {
    const client = new ConnectClient({ enableWebSocket: false });
    expect(client.getActiveDeviceId()).not.toBe('cast:192.168.0.48:8009');

    (client as any).handleIncomingMessage({
      type: 'PLAYBACK_STATE',
      state: {
        currentTrack: MOCK_TRACK,
        isPlaying: true,
        positionMs: 12000,
        durationMs: 230000,
        timestamp: Date.now(),
      },
      activeDeviceId: 'cast:192.168.0.48:8009',
      senderDeviceId: 'cast:192.168.0.48:8009',
    });

    expect(client.getActiveDeviceId()).toBe('cast:192.168.0.48:8009');
    client.destroy();
  });

  it('passes sender or active deviceId as fromId to playbackStateListeners', () => {
    const client = new ConnectClient({ enableWebSocket: false });
    const listener = vi.fn();
    client.onPlaybackState(listener);

    (client as any).handleIncomingMessage({
      type: 'PLAYBACK_STATE',
      state: {
        currentTrack: MOCK_TRACK,
        isPlaying: true,
        positionMs: 15000,
        durationMs: 230000,
        timestamp: Date.now(),
      },
      activeDeviceId: 'cast:192.168.0.48:8009',
    });

    expect(listener).toHaveBeenCalled();
    const calledFromId = listener.mock.calls[0][1];
    expect(calledFromId).toBe('cast:192.168.0.48:8009');
    client.destroy();
  });

  it('playerStore adopts remote_controller mode when remote device plays', () => {
    usePlayerStore.getState().applyRemotePlaybackState(
      {
        currentTrack: MOCK_TRACK,
        isPlaying: true,
        positionMs: 30000,
        durationMs: 230000,
        timestamp: Date.now(),
        queue: [MOCK_TRACK],
        currentTrackIndex: 0,
        volume: 0.7,
        repeatMode: 'off',
        shuffle: false,
      },
      'cast:192.168.0.48:8009'
    );

    const state = usePlayerStore.getState();
    expect(state.connectMode).toBe('remote_controller');
    expect(state.currentTrack?.title).toBe('Starboy');
    expect(state.activeDevice?.deviceId).toBe('cast:192.168.0.48:8009');
    expect(state.queue.length).toBe(1);
  });

  it('preserves volume during user interaction to prevent slider jitter', () => {
    // User sets volume locally
    usePlayerStore.getState().setVolume(0.45);
    expect(usePlayerStore.getState().volume).toBe(0.45);

    // Immediate remote echo arrives with stale volume 0.8 within 1500ms window
    usePlayerStore.getState().applyRemotePlaybackState(
      {
        currentTrack: MOCK_TRACK,
        isPlaying: true,
        positionMs: 40000,
        durationMs: 230000,
        timestamp: Date.now(),
        queue: [MOCK_TRACK],
        currentTrackIndex: 0,
        volume: 0.8,
        repeatMode: 'off',
        shuffle: false,
      },
      'cast:192.168.0.48:8009'
    );

    // Volume should remain protected at user-selected 0.45
    expect(usePlayerStore.getState().volume).toBe(0.45);
  });

  it('keeps volume and activeDevice.volume in sync when setRemoteVolume is called', () => {
    usePlayerStore.setState({
      connectMode: 'remote_controller',
      activeDevice: {
        deviceId: 'cast:192.168.0.48:8009',
        deviceName: 'Living Room Speaker',
        deviceType: 'speaker',
        role: 'active_host',
        isCurrentDevice: false,
        isActive: true,
        volume: 0.5,
        lastSeen: Date.now(),
      },
      volume: 0.5,
    });

    usePlayerStore.getState().setRemoteVolume('cast:192.168.0.48:8009', 0.65);

    const s = usePlayerStore.getState();
    expect(s.volume).toBe(0.65);
    expect(s.activeDevice?.volume).toBe(0.65);
  });
});
