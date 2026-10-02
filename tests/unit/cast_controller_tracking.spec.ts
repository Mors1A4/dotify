import { describe, it, expect, vi, beforeEach } from 'vitest';
import { audioEngine } from '../../src/audio/audioEngine';
import { usePlayerStore, remoteProgressInterpolator } from '../../src/store/playerStore';
import { connectClient } from '../../src/services/connectClient';
import { Track } from '../../src/types/track';

const MOCK_TRACK: Track = {
  id: 'test_trk_1',
  title: 'Rolling in the Deep',
  artist: 'Adele',
  album: '21',
  duration: 228,
  streamUrl: 'http://localhost:3001/api/stream/track?artist=Adele&title=Rolling%20in%20the%20Deep',
  artworkUrl: 'https://example.com/adele.jpg',
  source: 'charts',
  sourceMetadata: { genre: 'Pop' },
};

describe('Google Cast & Controller Seekbar Tracking Invariants', () => {
  beforeEach(() => {
    audioEngine.setControllerMode(false);
    remoteProgressInterpolator.stop();
  });

  it('setControllerMode(true) does not call remoteCommandDelegate with pause', () => {
    const delegate = vi.fn();
    audioEngine.setControllerMode(true, delegate);

    expect(audioEngine.getIsControllerMode()).toBe(true);
    expect(delegate).not.toHaveBeenCalledWith('pause');
  });

  it('audioEngine.setCurrentTrack updates getCurrentTrack and duration in controller mode', () => {
    audioEngine.setControllerMode(true);
    audioEngine.setCurrentTrack(MOCK_TRACK);

    expect(audioEngine.getCurrentTrack()).toEqual(MOCK_TRACK);
    expect(audioEngine.getDuration()).toBe(228);
  });

  it('emitSyntheticTimeUpdate updates getCurrentTime and getDuration in controller mode', () => {
    audioEngine.setControllerMode(true);
    audioEngine.emitSyntheticTimeUpdate(45.5, 228);

    expect(audioEngine.getCurrentTime()).toBe(45.5);
    expect(audioEngine.getDuration()).toBe(228);
  });

  it('playerStore does not overwrite isPlaying when audioEngine emits state change in remote_controller mode', () => {
    usePlayerStore.setState({
      connectMode: 'remote_controller',
      isPlaying: true,
      currentTrack: MOCK_TRACK,
    });

    // Simulate an internal audio engine state change (e.g. local deck pause/stop)
    (audioEngine as any).notifyState(false, false);

    // Player store should remain isPlaying: true because it is controlling a remote host/speaker
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('transferPlayback uses extended timeout for Cast devices', async () => {
    vi.useFakeTimers();

    const snapshot = {
      track: MOCK_TRACK,
      queue: [MOCK_TRACK],
      currentTrackIndex: 0,
      positionMs: 12000,
      isPlaying: true,
      volume: 0.8,
      repeatMode: 'off' as const,
      shuffle: false,
      capturedAt: Date.now(),
    };

    const promise = connectClient.transferPlayback('cast:192.168.0.48:8009', snapshot);

    // At 5 seconds (5000ms), standard 4s timeout would have failed; cast timeout should still be pending
    vi.advanceTimersByTime(5000);

    // Deliver simulated ACK at 7 seconds
    const node = (connectClient as any).client || connectClient;
    node.handleIncomingMessage({
      type: 'HANDOFF_ACK',
      fromDeviceId: 'cast:192.168.0.48:8009',
      toDeviceId: connectClient.getLocalDevice().deviceId,
      success: true,
      resumedPositionMs: 12000,
      timestamp: Date.now(),
    });

    const result = await promise;
    expect(result).toBe(true);

    vi.useRealTimers();
  });
});
