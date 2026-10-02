import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePlayerStore, remoteProgressInterpolator } from '../../src/store/playerStore';
import { audioEngine } from '../../src/audio/audioEngine';
import { Track } from '../../src/types/track';

const FULL_LENGTH_TRACK: Track = {
  id: 'test_cast_track_1',
  title: 'Blinding Lights',
  artist: 'The Weeknd',
  album: 'After Hours',
  duration: 200, // 3 minutes 20 seconds
  streamUrl: 'http://192.168.0.157:3001/api/stream/track?artist=The%20Weeknd&title=Blinding%20Lights&duration=200',
  artworkUrl: 'https://example.com/cover.jpg',
  source: 'charts',
  sourceMetadata: { source: 'charts' },
};

describe('Google Cast Duration Integrity & Seekbar Protection', () => {
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

  it('rejects truncated 29s preview duration reported by Cast speaker and preserves full track duration', () => {
    usePlayerStore.setState({
      currentTrack: FULL_LENGTH_TRACK,
      connectMode: 'remote_controller',
      activeDevice: {
        deviceId: 'cast:192.168.0.48:8009',
        deviceName: 'Kitchen speaker',
        deviceType: 'speaker',
        role: 'active_host',
        isCurrentDevice: false,
        isActive: true,
        volume: 0.7,
        lastSeen: Date.now(),
      },
    });

    // Remote Cast speaker sends status with a truncated ~29.5s preview clip duration
    usePlayerStore.getState().applyRemotePlaybackState(
      {
        currentTrack: FULL_LENGTH_TRACK,
        isPlaying: true,
        positionMs: 5000,
        durationMs: 29500, // 29.5s preview clip
        timestamp: Date.now(),
        volume: 0.7,
        currentTrackIndex: 0,
        queue: [FULL_LENGTH_TRACK],
        repeatMode: 'off',
        shuffle: false,
      },
      'cast:192.168.0.48:8009'
    );

    // RemoteProgressInterpolator must reject 29.5s and retain 200s
    expect((remoteProgressInterpolator as any).durationSec).toBe(200);

    // Current position should be near 5s, not clamped to 29s
    const pos = remoteProgressInterpolator.getCurrentPosition();
    expect(pos).toBeGreaterThanOrEqual(4.8);
    expect(pos).toBeLessThanOrEqual(6.5);
  });

  it('does not collapse seekbar duration to 29s when paused or unpaused', () => {
    usePlayerStore.setState({
      currentTrack: FULL_LENGTH_TRACK,
      connectMode: 'remote_controller',
    });

    // Sync with 29.5s
    remoteProgressInterpolator.sync({
      positionMs: 15000,
      durationMs: 29500,
      isPlaying: false,
      remoteTimestamp: Date.now(),
    });

    expect((remoteProgressInterpolator as any).durationSec).toBe(200);

    // Pause remote progress
    remoteProgressInterpolator.pause();
    expect((remoteProgressInterpolator as any).durationSec).toBe(200);

    // Resume remote progress
    remoteProgressInterpolator.resume();
    expect((remoteProgressInterpolator as any).durationSec).toBe(200);
    remoteProgressInterpolator.pause();
  });

  it('stops interpolator loop and clamps position when track end is reached', () => {
    usePlayerStore.setState({
      currentTrack: { ...FULL_LENGTH_TRACK, duration: 10 },
      connectMode: 'remote_controller',
    });

    remoteProgressInterpolator.sync({
      positionMs: 9950,
      durationMs: 10000,
      isPlaying: true,
      remoteTimestamp: Date.now(),
    });

    expect((remoteProgressInterpolator as any).durationSec).toBe(10);
    // Artificially advance anchor past duration
    (remoteProgressInterpolator as any).anchorPositionSec = 10.5;
    (remoteProgressInterpolator as any).tick();

    // Position must be clamped to 10s and isPlaying set to false
    expect(remoteProgressInterpolator.getCurrentPosition()).toBe(10);
    expect((remoteProgressInterpolator as any).isPlaying).toBe(false);
  });

  it('resolveEffectiveDuration guards against truncated ~29s/30s preview durations', async () => {
    const { resolveEffectiveDuration } = await import('../../src/hooks/useSmoothSeekbar');

    // Case 1: Truncated 29.5s preview reported for a 200s track
    expect(resolveEffectiveDuration(29.5, FULL_LENGTH_TRACK)).toBe(200);

    // Case 2: Truncated 30s preview reported for a 200s track
    expect(resolveEffectiveDuration(30, FULL_LENGTH_TRACK)).toBe(200);

    // Case 3: Genuine short track (e.g. 25s interlude) where track.duration <= 45
    const shortTrack: Track = { ...FULL_LENGTH_TRACK, duration: 25 };
    expect(resolveEffectiveDuration(25, shortTrack)).toBe(25);

    // Case 4: Full-length reported duration (e.g. 202s) matches or reflects true length
    expect(resolveEffectiveDuration(202, FULL_LENGTH_TRACK)).toBe(202);

    // Case 5: Live radio stream always returns Infinity
    const radioTrack: Track = { ...FULL_LENGTH_TRACK, source: 'radio' };
    expect(resolveEffectiveDuration(0, radioTrack)).toBe(Infinity);
  });
});

