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

  it('audioEngine.getCurrentTime() returns 0 while isSwitchingTrack is true and does not leak previous track time', () => {
    const engineAny = audioEngine as any;
    engineAny.isSwitchingTrack = true;
    engineAny.controllerCurrentTime = 145;
    expect(audioEngine.getCurrentTime()).toBe(0);
    engineAny.isSwitchingTrack = false;
  });

  it('YouTubeIframeBridge does not leak previous track currentTime when loading a new videoId', async () => {
    const { YouTubeIframeBridge } = await import('../../src/audio/youtubeIframeBridge');
    const bridge = YouTubeIframeBridge.getInstance() as any;

    // Simulate player with old video playing at 150s
    bridge.isReady = true;
    bridge.player = {
      getCurrentTime: () => 150,
      getDuration: () => 240,
      getVideoData: () => ({ video_id: 'old_video_id' }),
      loadVideoById: vi.fn(),
      playVideo: vi.fn(),
      unMute: vi.fn(),
      setVolume: vi.fn(),
    };
    bridge.currentVideoId = 'old_video_id';
    bridge.loadedVideoId = 'old_video_id';

    expect(bridge.getCurrentTime()).toBe(150);

    // Now request to play a new video
    await bridge.play('new_video_id', 0);

    // Even though player.getCurrentTime still returns 150 (since YouTube iframe takes time to load),
    // bridge.getCurrentTime must NOT leak 150! It must return 0.
    expect(bridge.getCurrentTime()).toBe(0);
    expect(bridge.getDuration()).toBe(0);
    expect(bridge.isPlaying()).toBe(false);

    // Simulate YouTube iframe confirming transition to new_video_id
    bridge.player.getVideoData = () => ({ video_id: 'new_video_id' });
    bridge.player.getCurrentTime = () => 1.5;
    bridge.player.getDuration = () => 180;
    bridge.handleStateChange(1); // PLAYING

    expect(bridge.getCurrentTime()).toBe(1.5);
    expect(bridge.getDuration()).toBe(180);
    expect(bridge.isPlaying()).toBe(true);
  });

  it('resets track bar and queue context cleanly when skipping a song on Vibe DJ', async () => {
    const { usePlayerStore } = await import('../../src/store/playerStore');
    const { useVibeDjStore } = await import('../../src/store/vibeDjStore');

    const djTrackA: Track = {
      id: 'vibe-dj-track-a',
      title: 'DJ Song A',
      artist: 'DJ Artist A',
      album: 'Vibe',
      duration: 200,
      artworkUrl: '',
      streamUrl: 'https://example.com/dj-a.mp3',
      source: 'charts',
      sourceMetadata: {},
    };

    const djTrackB: Track = {
      id: 'vibe-dj-track-b',
      title: 'DJ Song B',
      artist: 'DJ Artist B',
      album: 'Vibe',
      duration: 220,
      artworkUrl: '',
      streamUrl: 'https://example.com/dj-b.mp3',
      source: 'charts',
      sourceMetadata: {},
    };

    // Activate Vibe DJ with djTrackB in its queue
    useVibeDjStore.setState({
      isActive: true,
      vibeLabel: 'Electronic Horizon',
      djQueue: [
        {
          track: djTrackB,
          vibeScore: 92,
          vibeReason: 'Perfect follow-up',
          predictedEnergy: 0.8,
          sourceTier: 'taste_catalogue',
        },
      ],
    });

    usePlayerStore.setState({
      currentTrack: djTrackA,
      currentTrackIndex: 0,
      queue: [djTrackA],
      isPlaying: true,
    });

    // Skip the song via nextTrack()
    await usePlayerStore.getState().nextTrack();

    const stateAfterSkip = usePlayerStore.getState();
    expect(stateAfterSkip.currentTrack?.id).toBe('vibe-dj-track-b');
    expect(stateAfterSkip.currentTrackIndex).toBe(0);
    expect(stateAfterSkip.queue[0]?.id).toBe('vibe-dj-track-b');
  });
});
