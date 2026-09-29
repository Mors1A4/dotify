import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { audioEngine } from '../../src/audio/audioEngine';
import { formatPlaybackTime } from '../../src/hooks/useSmoothSeekbar';
import { Track } from '../../src/types/track';

describe('Smooth Song Switching & Seekbar Transitions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    audioEngine.pause();
  });

  it('formatPlaybackTime formats seconds cleanly and handles NaN/Infinity/negative values', () => {
    expect(formatPlaybackTime(0)).toBe('0:00');
    expect(formatPlaybackTime(5.8)).toBe('0:05');
    expect(formatPlaybackTime(65.2)).toBe('1:05');
    expect(formatPlaybackTime(NaN)).toBe('0:00');
    expect(formatPlaybackTime(Infinity)).toBe('0:00');
    expect(formatPlaybackTime(-12)).toBe('0:00');
  });

  it('emits immediate synthetic timeUpdate(0, track.duration) on playTrack before stream resolves', async () => {
    const updates: Array<{ current: number; duration: number }> = [];
    const unsubscribe = audioEngine.onTimeUpdate((current, duration) => {
      updates.push({ current, duration });
    });

    const trackA: Track = {
      id: 'smooth-switch-a',
      title: 'First Song',
      artist: 'Artist A',
      album: 'Album A',
      duration: 215,
      artworkUrl: '',
      streamUrl: 'https://example.com/a.mp3',
      source: 'audius',
      sourceMetadata: {},
    };

    await audioEngine.playTrack(trackA);
    unsubscribe();

    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates[0].current).toBe(0);
    expect(updates[0].duration).toBe(215);
  });

  it('suppresses transient pause events while isSwitchingTrack is true during track transitions', async () => {
    const playStateEvents: boolean[] = [];
    const unsubscribe = audioEngine.onStateChange((playing: boolean) => {
      playStateEvents.push(playing);
    });

    // Simulate internal switching guard and dispatch a pause event on active audio element
    const engineAny = audioEngine as any;
    const activeEl = engineAny.activeAudio;
    if (activeEl && typeof activeEl.dispatchEvent === 'function') {
      engineAny.isSwitchingTrack = true;
      activeEl.dispatchEvent(new Event('pause'));
      engineAny.isSwitchingTrack = false;
    }

    unsubscribe();
    expect(playStateEvents).not.toContain(false);
  });
});
