import { Track } from '../types/track';
import { EQ_FREQUENCIES, EQ_PRESET_GAINS, EqualizerPreset, EqualizerState } from '../dsp/types';
import { audioCache } from './audioCache';
import { getApiUrl, getCustomApiUrl, isAndroidApp } from '../services/apiConfig';
import { useMp3VaultStore } from '../services/mp3VaultService';
import { YouTubeIframeBridge } from './youtubeIframeBridge';
import { androidNativePlayback, NativeTrackPayload } from './androidNativePlayback';
import {
  resolveYouTubeVideoId,
  markSourceAsBadAndResolveNext,
  setExplicitSource,
  getCachedVideoId,
} from '../services/youtubeResolver';
import { mobileDiagnostics } from '../services/mobileDiagnostics';

function createAudioElement(): HTMLAudioElement {
  if (typeof Audio !== 'undefined') {
    return new Audio();
  }
  return {
    src: '',
    crossOrigin: '',
    preload: '',
    currentTime: 0,
    duration: 0,
    volume: 1,
    paused: true,
    ended: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    load: () => {},
    play: async () => {},
    pause: () => {},
  } as any;
}

export class AudioEngine {
  private static instance: AudioEngine;

  // Dual HTMLAudioElements for seamless gapless pre-buffering
  private primaryAudio: HTMLAudioElement;
  private secondaryAudio: HTMLAudioElement;
  private isPrimaryActive: boolean = true;

  // YouTube IFrame Player Bridge for 100% self-contained mobile & fallback playback
  private ytBridge: YouTubeIframeBridge;
  private isUsingYouTubeBridge: boolean = false;
  private currentResolvedVideoId: string | null = null;

  // Native Media3 ExoPlayer engine (Android) for background / screen-off
  // resilient streaming. Owning this Russell-free flag reroutes every
  // transport, time and visualizer hook so the WebView path stays untouched.
  private isUsingNativeEngine: boolean = false;
  private nativeQueueContext: Track[] = [];
  private nativeQueueStartIndex: number = -1;
  private nativeRepeatMode: 'none' | 'one' | 'all' = 'none';
  private nativeTransitionCallbacks: Set<(track: NativeTrackPayload | null, payloadIndex: number) => void> = new Set();
  private nativeQueueEndedCallbacks: Set<() => void> = new Set();
  private nativeEventsWired: boolean = false;

  private prebufferedTrack: Track | null = null;
  private isPrebufferedReady: boolean = false;

  private audioContext: AudioContext | null = null;
  private primarySourceNode: MediaElementAudioSourceNode | null = null;
  private secondarySourceNode: MediaElementAudioSourceNode | null = null;
  private primaryGainNode: GainNode | null = null;
  private secondaryGainNode: GainNode | null = null;

  private preAmpNode: GainNode | null = null;
  private filterNodes: BiquadFilterNode[] = [];
  private analyserNode: AnalyserNode | null = null;
  private masterGainNode: GainNode | null = null;
  private currentVolume: number = 0.8;

  private currentTrack: Track | null = null;
  private eqState: EqualizerState = {
    enabled: true,
    preset: 'flat',
    preAmp: 0,
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };

  private timeUpdateCallbacks: Set<(currentTime: number, duration: number) => void> = new Set();
  private stateChangeCallbacks: Set<(isPlaying: boolean, isBuffering: boolean) => void> = new Set();
  private trackEndCallbacks: Set<() => void> = new Set();
  private approachingEndCallbacks: Set<() => void> = new Set();
  private hasNotifiedApproachingEnd: boolean = false;

  // Remote Controller mode delegation
  private isControllerMode: boolean = false;
  private remoteCommandDelegate: ((action: string, data?: any) => void) | null = null;
  private controllerCurrentTime: number = 0;
  private controllerDuration: number = 0;

  private constructor() {
    this.primaryAudio = createAudioElement();
    this.primaryAudio.crossOrigin = 'anonymous';
    this.primaryAudio.preload = 'auto';

    this.secondaryAudio = createAudioElement();
    this.secondaryAudio.crossOrigin = 'anonymous';
    this.secondaryAudio.preload = 'auto';

    this.ytBridge = YouTubeIframeBridge.getInstance();
    this.ytBridge.setOnStateChange((isPlaying, isBuffering) => {
      if (this.isUsingYouTubeBridge) {
        if (!isPlaying && this.isSwitchingTrack) {
          return;
        }
        this.notifyState(isPlaying, isBuffering);
      }
    });
    this.ytBridge.setOnEnded(() => {
      if (this.isUsingYouTubeBridge) {
        this.handleTrackEnded();
      }
    });

    this.setupAudioListeners(this.primaryAudio, true);
    this.setupAudioListeners(this.secondaryAudio, false);
  }

  public static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

  private get activeAudio(): HTMLAudioElement {
    return this.isPrimaryActive ? this.primaryAudio : this.secondaryAudio;
  }

  private get standbyAudio(): HTMLAudioElement {
    return this.isPrimaryActive ? this.secondaryAudio : this.primaryAudio;
  }

  private initWebAudio() {
    if (this.audioContext) return;

    try {
      const AudioCtx =
        typeof window !== 'undefined'
          ? window.AudioContext || (window as any).webkitAudioContext
          : (globalThis as any).AudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx() as AudioContext;
      this.audioContext = ctx;

      // Pre-amp gain node
      this.preAmpNode = ctx.createGain();
      this.preAmpNode.gain.setValueAtTime(
        this.dbToLinear(this.eqState.preAmp),
        ctx.currentTime
      );

      // Create dual sources and balance gains
      this.primarySourceNode = ctx.createMediaElementSource(this.primaryAudio);
      this.secondarySourceNode = ctx.createMediaElementSource(this.secondaryAudio);

      this.primaryGainNode = ctx.createGain();
      this.secondaryGainNode = ctx.createGain();

      this.primaryGainNode.gain.setValueAtTime(this.isPrimaryActive ? 1.0 : 0.0, ctx.currentTime);
      this.secondaryGainNode.gain.setValueAtTime(this.isPrimaryActive ? 0.0 : 1.0, ctx.currentTime);

      this.primarySourceNode.connect(this.primaryGainNode);
      this.secondarySourceNode.connect(this.secondaryGainNode);

      this.primaryGainNode.connect(this.preAmpNode);
      this.secondaryGainNode.connect(this.preAmpNode);

      // 10-band BiquadFilter cascade
      this.filterNodes = EQ_FREQUENCIES.map((freq, idx) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.setValueAtTime(freq, ctx.currentTime);
        filter.Q.setValueAtTime(1.4142, ctx.currentTime);
        filter.gain.setValueAtTime(this.eqState.bands[idx], ctx.currentTime);
        return filter;
      });

      // AnalyserNode for 60 FPS spectrum visualizer (1024 FFT size for 512 frequency bins)
      this.analyserNode = ctx.createAnalyser();
      this.analyserNode.fftSize = 1024;
      this.analyserNode.smoothingTimeConstant = 0.8;

      // Connect graph: preAmp -> filter[0] -> ... -> filter[9] -> analyser -> masterGain -> destination
      let lastNode: AudioNode = this.preAmpNode;

      for (const filter of this.filterNodes) {
        lastNode.connect(filter);
        lastNode = filter;
      }

      this.masterGainNode = ctx.createGain();
      const initialGain = this.calculateGain(this.currentVolume);
      this.masterGainNode.gain.setValueAtTime(initialGain, ctx.currentTime);

      this.primaryAudio.volume = 1.0;
      this.secondaryAudio.volume = 1.0;

      lastNode.connect(this.analyserNode);
      this.analyserNode.connect(this.masterGainNode);
      this.masterGainNode.connect(ctx.destination);
    } catch (err) {
      console.warn('[AudioEngine] Web Audio DSP initialization deferred or unsupported:', err);
    }
  }

  private getEffectiveDuration(
    el: HTMLAudioElement | null = this.activeAudio,
    track: Track | null = this.currentTrack
  ): number {
    if (track?.source === 'radio' || track?.duration === Infinity) {
      return Infinity;
    }
    if (track && typeof track.duration === 'number' && isFinite(track.duration) && track.duration > 0) {
      return track.duration;
    }
    const rawDur = el?.duration;
    if (typeof rawDur === 'number' && isFinite(rawDur) && rawDur > 0) {
      return rawDur;
    }
    return 0;
  }

  private startProgressLoop(): void {
    const tick = () => {
      this.rafId = null;
      this.lastTickTime = Date.now();
      if (this.isControllerMode) return;

      if (this.isUsingNativeEngine) {
        if (androidNativePlayback.isPlaying()) {
          const cur = this.getCurrentTime();
          const dur = this.getDuration();
          for (const cb of this.timeUpdateCallbacks) {
            cb(cur, dur);
          }
          if (isFinite(dur) && dur > 20 && dur - cur <= 15 && !this.hasNotifiedApproachingEnd) {
            this.hasNotifiedApproachingEnd = true;
            for (const cb of this.approachingEndCallbacks) {
              cb();
            }
          }
          if (typeof requestAnimationFrame !== 'undefined') {
            this.rafId = requestAnimationFrame(tick);
          }
        }
        return;
      }

      if (this.isUsingYouTubeBridge) {
        if (this.ytBridge.isPlaying()) {
          const cur = this.ytBridge.getCurrentTime();
          const dur = this.getDuration();
          for (const cb of this.timeUpdateCallbacks) {
            cb(cur, dur);
          }
          if (isFinite(dur) && dur > 20 && dur - cur <= 15 && !this.hasNotifiedApproachingEnd) {
            this.hasNotifiedApproachingEnd = true;
            for (const cb of this.approachingEndCallbacks) {
              cb();
            }
          }
          if (typeof requestAnimationFrame !== 'undefined') {
            this.rafId = requestAnimationFrame(tick);
          }
        }
        return;
      }

      const el = this.activeAudio;
      if (!el.paused && !el.ended) {
        const cur = el.currentTime || 0;
        const dur = this.getEffectiveDuration(el);
        for (const cb of this.timeUpdateCallbacks) {
          cb(cur, dur);
        }
        if (isFinite(dur) && dur > 20 && dur - cur <= 15 && !this.hasNotifiedApproachingEnd) {
          this.hasNotifiedApproachingEnd = true;
          for (const cb of this.approachingEndCallbacks) {
            cb();
          }
        }
        if (typeof requestAnimationFrame !== 'undefined') {
          this.rafId = requestAnimationFrame(tick);
        }
      }
    };

    if (this.backgroundHeartbeatTimer === null && typeof setInterval !== 'undefined') {
      this.backgroundHeartbeatTimer = setInterval(() => {
        if (Date.now() - this.lastTickTime >= 200) {
          tick();
        }
      }, 250);
    }

    if (this.rafId === null && typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(tick);
    }
  }

  private stopProgressLoop(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.backgroundHeartbeatTimer !== null) {
      clearInterval(this.backgroundHeartbeatTimer);
      this.backgroundHeartbeatTimer = null;
    }
  }

  private setupAudioListeners(el: HTMLAudioElement, isPrimary: boolean) {
    el.addEventListener('timeupdate', () => {
      if (this.isElementActive(isPrimary)) {
        const cur = el.currentTime || 0;
        const dur = this.getEffectiveDuration(el);
        for (const cb of this.timeUpdateCallbacks) {
          cb(cur, dur);
        }
        if (isFinite(dur) && dur > 20 && dur - cur <= 15 && !this.hasNotifiedApproachingEnd) {
          this.hasNotifiedApproachingEnd = true;
          for (const cb of this.approachingEndCallbacks) {
            cb();
          }
        }
      }
    });

    el.addEventListener('play', () => {
      if (this.isElementActive(isPrimary)) {
        this.isSwitchingTrack = false;
        this.notifyState(true, false);
        this.startProgressLoop();
      }
    });

    el.addEventListener('pause', () => {
      if (this.isElementActive(isPrimary)) {
        this.stopProgressLoop();
        if (!this.isSwitchingTrack) {
          this.notifyState(false, false);
        }
      }
    });

    el.addEventListener('waiting', () => {
      if (this.isElementActive(isPrimary)) {
        this.notifyState(true, true);
      }
    });

    el.addEventListener('playing', () => {
      if (this.isElementActive(isPrimary)) {
        this.isSwitchingTrack = false;
        this.notifyState(true, false);
        this.startProgressLoop();
      }
    });

    el.addEventListener('ended', () => {
      if (this.isElementActive(isPrimary)) {
        this.handleTrackEnded();
      }
    });

    el.addEventListener('loadedmetadata', () => {
      const dur = el.duration;
      if (!this.isElementActive(isPrimary)) {
        // Standby element: reject prebuffer if it resolved to a 30s preview clip for a full-length song
        if (
          dur > 0 &&
          isFinite(dur) &&
          dur <= 33 &&
          (!this.prebufferedTrack?.duration || this.prebufferedTrack.duration > 45)
        ) {
          this.isPrebufferedReady = false;
          this.prebufferedTrack = null;
        }
        return;
      }

      // Immediately notify listeners with accurate loaded metadata duration
      const cur = el.currentTime || 0;
      const effectiveDur = this.getEffectiveDuration(el);
      for (const cb of this.timeUpdateCallbacks) {
        cb(cur, effectiveDur);
      }

      // Active element: if a full-length track (>45s) loaded as a <=33s clip, attempt background upgrade
      if (
        dur > 0 &&
        isFinite(dur) &&
        dur <= 33 &&
        this.currentTrack &&
        (!this.currentTrack.duration || this.currentTrack.duration > 45) &&
        this.upgradedPlayReqId !== this.playRequestId
      ) {
        this.upgradedPlayReqId = this.playRequestId;
        this.attemptBackgroundFullStreamUpgrade(this.currentTrack, this.playRequestId);
      }
    });

    el.addEventListener('error', () => {
      if (!this.isElementActive(isPrimary)) {
        // Standby prebuffer failed; invalidate so playTrack resolves fresh
        this.isPrebufferedReady = false;
        this.prebufferedTrack = null;
        return;
      }

      if (this.isElementActive(isPrimary)) {
        console.warn('[AudioEngine] Playback error on active audio element:', el.error);

        // 1. If a cached blob: URL failed, retry directly with the resolved full backend URL
        if (el.src && el.src.startsWith('blob:') && this.currentTrack) {
          const fullUrl = this.resolveFullStreamUrl(this.currentTrack);
          if (fullUrl && !fullUrl.startsWith('blob:') && el.src !== fullUrl) {
            el.src = fullUrl;
            el.load();
            el.play().catch(() => {});
            return;
          }
        }

        // 2. If /api/stream/track failed once, retry up to 2 times with cache-busting retry param before stopping
        if (el.src && el.src.includes('/api/stream/track')) {
          if (!el.src.includes('_retry=1') && !el.src.includes('_retry=2')) {
            const retryUrl = `${el.src}${el.src.includes('?') ? '&' : '?'}_retry=1`;
            el.src = retryUrl;
            el.load();
            el.play().catch(() => {});
            return;
          } else if (el.src.includes('_retry=1')) {
            const retryUrl = el.src.replace('_retry=1', '_retry=2');
            el.src = retryUrl;
            el.load();
            el.play().catch(() => {});
            return;
          }
        }

        // 3. Fallback to self-contained YouTube IFrame Bridge if standard stream failed
        if (this.currentTrack && this.currentTrack.source !== 'radio') {
          this.playViaYouTubeBridge(this.currentTrack, this.playRequestId).catch(() => {});
          return;
        }

        this.isSwitchingTrack = false;
        this.notifyState(false, false);
      }
    });
  }

  private handleTrackEnded(): void {
    this.stopProgressLoop();
    this.isSwitchingTrack = false;
    this.notifyState(false, false);
    for (const cb of this.trackEndCallbacks) {
      cb();
    }
  }

  private isElementActive(isPrimary: boolean): boolean {
    return this.isPrimaryActive === isPrimary;
  }

  private notifyState(isPlaying: boolean, isBuffering: boolean) {
    for (const cb of this.stateChangeCallbacks) {
      cb(isPlaying, isBuffering);
    }
  }

  private playRequestId: number = 0;
  private upgradedPlayReqId: number = 0;
  private rafId: number | null = null;
  private backgroundHeartbeatTimer: any = null;
  private lastTickTime: number = 0;
  private isSwitchingTrack: boolean = false;
  private standbyFadeTimer: ReturnType<typeof setTimeout> | null = null;
  private standbyFadePromise: Promise<void> | null = null;

  private async attemptBackgroundFullStreamUpgrade(track: Track, reqId: number): Promise<void> {
    if (!track.artist || !track.title) return;

    try {
      const fullTrackUrl = this.resolveFullStreamUrl(track);
      if (!fullTrackUrl.includes('/api/stream/track')) return;

      const baseNoRetry = fullTrackUrl.replace(/[?&]_retry=1/g, '');
      const sep = baseNoRetry.includes('?') ? '&' : '?';
      const preloadRetryUrl = `${baseNoRetry}${sep}_retry=1&preload=true&_t=${Date.now()}`;

      const res = await fetch(preloadRetryUrl);
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (!data || !data.cached || data.fallback) return;

      if (this.playRequestId !== reqId || this.currentTrack?.id !== track.id) return;

      const audio = this.activeAudio;
      if (audio.duration > 35) return;

      const resumeTime = audio.currentTime || 0;
      const wasPlaying = !audio.paused;
      const upgradedSrc = `${baseNoRetry}${sep}_upgraded=${Date.now()}`;

      console.info(
        `[AudioEngine] Upgraded 30s fallback to full stream for "${track.artist} - ${track.title}" at ${resumeTime.toFixed(1)}s`
      );

      const onUpgradedMetadata = () => {
        audio.removeEventListener('loadedmetadata', onUpgradedMetadata);
        if (this.playRequestId !== reqId) return;
        if (resumeTime > 0 && audio.duration > resumeTime + 2) {
          audio.currentTime = resumeTime;
        }
        if (wasPlaying) {
          audio.play().catch(() => {});
        }
      };

      audio.addEventListener('loadedmetadata', onUpgradedMetadata);
      audio.src = upgradedSrc;
      audio.load();
    } catch {
      // Keep playing current stream if background upgrade fails
    }
  }

  /**
   * Ensures tracks persisted in localStorage or synced from Android with 30-second
   * Deezer preview CDN URLs (dzcdn.net) or legacy non-YT sources are upgraded to
   * full-length YouTube backend streams whenever a backend server is available.
   */
  private resolveFullStreamUrl(track: Track): string {
    const rawUrl = track.streamUrl || '';
    if (rawUrl.startsWith('blob:')) {
      return rawUrl;
    }

    // 1. If track is saved as a local MP3 on disk, stream directly from the local MP3 vault
    try {
      const vault = useMp3VaultStore.getState();
      if (track.id && vault.isTrackSaved(track.id)) {
        const localMp3Url = vault.getSavedTrackPlayUrl(track.id);
        if (localMp3Url) return localMp3Url;
      }
      // Or if a WiFi peer already has this MP3 saved on LAN, stream directly from that WiFi peer!
      const peerTrack = vault.peerTracks.find((pt) => pt.id === track.id);
      if (peerTrack && peerTrack.peerIp) {
        return `http://${peerTrack.peerIp}:${peerTrack.peerPort || 3001}/api/mp3s/file/${encodeURIComponent(track.id)}`;
      }
    } catch {}

    const vaultPeers = (() => {
      try {
        return useMp3VaultStore.getState().peers || [];
      } catch {
        return [];
      }
    })();
    const desktopWifiPeer = isAndroidApp()
      ? vaultPeers.find((p) => p.deviceType === 'desktop' && p.ip)
      : null;

    const hasBackend = !isAndroidApp() || Boolean(getCustomApiUrl()) || Boolean(desktopWifiPeer);
    const resolveTrackEndpoint = (path: string) => {
      if (desktopWifiPeer && !getCustomApiUrl()) {
        return `http://${desktopWifiPeer.ip}:${desktopWifiPeer.port || 3001}${path}`;
      }
      return getApiUrl(path);
    };

    const expectedDuration = track.duration && isFinite(track.duration) ? track.duration : 210;

    if (rawUrl.includes('/api/stream/track')) {
      let fullUrl = rawUrl.startsWith('/api/') ? resolveTrackEndpoint(rawUrl) : rawUrl;
      // Strip any legacy &preview= query parameters that might have been saved in localStorage/queue
      fullUrl = fullUrl.replace(/([?&])preview=[^&]*(&|$)/g, '$1').replace(/[?&]$/, '');
      if (!fullUrl.includes('duration=')) {
        fullUrl += `${fullUrl.includes('?') ? '&' : '?'}duration=${expectedDuration}`;
      }
      return fullUrl;
    }

    const isLegacyNonYtStream =
      rawUrl.includes('dzcdn.net') ||
      rawUrl.includes('/api/audius/') ||
      rawUrl.includes('audius.co') ||
      rawUrl.includes('/api/archive/') ||
      rawUrl.includes('archive.org') ||
      rawUrl.includes('/api/torrent/') ||
      !rawUrl;

    if (isLegacyNonYtStream && track.artist && track.title) {
      const rawId = String(track.id || '').replace(/^(charts|audius|archive|radio|p2p):/, '');
      return resolveTrackEndpoint(
        `/api/stream/track?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(
          track.title
        )}&id=${encodeURIComponent(rawId)}&duration=${expectedDuration}`
      );
    }

    if (rawUrl.startsWith('/api/')) {
      return resolveTrackEndpoint(rawUrl);
    }
    return rawUrl;
  }

  private crossfadeToActiveDeck(previousActive: HTMLAudioElement): void {
    if (this.standbyFadeTimer) {
      clearTimeout(this.standbyFadeTimer);
      this.standbyFadeTimer = null;
      this.standbyFadePromise = null;
    }

    if (this.audioContext && this.primaryGainNode && this.secondaryGainNode) {
      try {
        const now = this.audioContext.currentTime;
        const activeGain = this.isPrimaryActive ? this.primaryGainNode.gain : this.secondaryGainNode.gain;
        const standbyGain = this.isPrimaryActive ? this.secondaryGainNode.gain : this.primaryGainNode.gain;

        activeGain.cancelScheduledValues(now);
        standbyGain.cancelScheduledValues(now);

        if (!previousActive.paused) {
          activeGain.setValueAtTime(0.08, now);
          activeGain.linearRampToValueAtTime(1.0, now + 0.14);
          standbyGain.setValueAtTime(Math.max(0.01, standbyGain.value || 1.0), now);
          standbyGain.linearRampToValueAtTime(0.0001, now + 0.14);

          this.standbyFadePromise = new Promise<void>((resolve) => {
            this.standbyFadeTimer = setTimeout(() => {
              this.standbyFadeTimer = null;
              this.standbyFadePromise = null;
              try {
                previousActive.pause();
              } catch {}
              resolve();
            }, 145);
          });
          return;
        } else {
          activeGain.setValueAtTime(1.0, now);
          standbyGain.setValueAtTime(0.0, now);
        }
      } catch {
        // Fallback to immediate pause if AudioParam scheduling fails
      }
    }

    try {
      previousActive.pause();
    } catch {}
    this.standbyFadePromise = null;
  }

  public isDirectAudioTrack(track: Track | null): boolean {
    if (!track) return false;
    if (track.source === 'radio' || (track.source as string) === 'mp3_vault') return true;
    if (track.id && (track.id.startsWith('mp3:') || track.id.startsWith('vault:'))) return true;
    try {
      const vault = useMp3VaultStore.getState();
      if (track.id && vault.isTrackSaved(track.id)) return true;
    } catch {}

    const streamUrl = String(track.streamUrl || '').toLowerCase();
    if (!streamUrl) return false;

    // Reject streaming proxy routes and deezer previews from being treated as direct static tracks
    if (streamUrl.includes('/api/stream/track') || streamUrl.includes('dzcdn.net')) {
      return false;
    }

    if (
      streamUrl.startsWith('blob:') ||
      streamUrl.startsWith('file:') ||
      streamUrl.startsWith('data:') ||
      streamUrl.endsWith('.mp3') ||
      streamUrl.endsWith('.wav') ||
      streamUrl.endsWith('.ogg') ||
      streamUrl.endsWith('.flac') ||
      streamUrl.endsWith('.m4a') ||
      streamUrl.includes('/stream/') ||
      streamUrl.includes('/api/mp3s/file')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Pre-buffers the next track on the standby element in the background without audible playback.
   */
  public async prebufferNextTrack(track: Track | null): Promise<void> {
    if (!track) {
      this.prebufferedTrack = null;
      this.isPrebufferedReady = false;
      return;
    }

    this.prebufferedTrack = track;
    this.isPrebufferedReady = false;

    const isDirect = this.isDirectAudioTrack(track);
    if (isDirect) {
      try {
        const targetUrl = this.resolveFullStreamUrl(track);
        const streamUrl = await audioCache.getCachedStreamUrl(track.id, targetUrl, true);
        if (this.standbyFadePromise) {
          await this.standbyFadePromise.catch(() => {});
        }
        if (this.prebufferedTrack?.id === track.id) {
          const standby = this.standbyAudio;
          standby.src = streamUrl;
          standby.preload = 'auto';
          standby.load();
          this.isPrebufferedReady = true;
        }
      } catch (err) {
        console.debug('[AudioEngine] Pre-buffering next track failed:', err);
        this.isPrebufferedReady = false;
      }
    } else {
      // Standard track: Pre-resolve next track's video ID and prime YouTube standby deck
      if (track.artist && track.title) {
        resolveYouTubeVideoId(track.artist, track.title, track.duration)
          .then((videoId) => {
            if (videoId) {
              this.ytBridge.cueNext(videoId);
            }
          })
          .catch(() => {});
      }
    }
  }

  public async playTrack(track: Track): Promise<void> {
    const reqId = ++this.playRequestId;
    this.stopProgressLoop();
    this.isSwitchingTrack = true;

    // Tear down the previous native queue first so two players never overlap.
    if (this.isUsingNativeEngine) {
      this.isUsingNativeEngine = false;
      try { androidNativePlayback.stop(); } catch { /* noop */ }
    }
    if (this.isUsingYouTubeBridge) {
      this.ytBridge.pause();
      this.isUsingYouTubeBridge = false;
    }

    // Android: hand playback to the native engine for screen-off-proof audio.
    if (this.isNativeRoutable(track)) {
      const nativeOk = await this.playViaNativeEngine(track, reqId);
      if (nativeOk) return;
    }

    const isDirect = this.isDirectAudioTrack(track);

    // Central unified streaming: Route standard tracks directly through the YouTube IFrame Bridge!
    if (!isDirect) {
      this.currentTrack = track;
      this.hasNotifiedApproachingEnd = false;
      this.prebufferedTrack = null;
      this.isPrebufferedReady = false;
      const initialDuration = track.duration && isFinite(track.duration) ? track.duration : 210;
      this.emitSyntheticTimeUpdate(0, initialDuration);

      const ok = await this.playViaYouTubeBridge(track, reqId);
      if (ok) return;
    }

    this.initWebAudio();

    // Check synchronously (before any await) if the requested track is pre-buffered on standby
    const standbyDur = this.standbyAudio.duration;
    const isTruncatedStandby =
      standbyDur > 0 && isFinite(standbyDur) && standbyDur <= 33 && (!track.duration || track.duration > 45);
    const canUsePrebuffered =
      this.isPrebufferedReady &&
      this.prebufferedTrack !== null &&
      this.prebufferedTrack.id === track.id &&
      !isTruncatedStandby;

    this.currentTrack = track;
    this.hasNotifiedApproachingEnd = false;
    this.prebufferedTrack = null;
    this.isPrebufferedReady = false;

    // Immediately emit 0:00 and new track's expected duration so the seekbar glides smoothly right away
    const initialDuration = this.getEffectiveDuration(canUsePrebuffered ? this.standbyAudio : null, track);
    this.emitSyntheticTimeUpdate(0, initialDuration);
    this.notifyState(true, !canUsePrebuffered);

    if (canUsePrebuffered) {
      // Fast gapless switch: swap active and standby elements synchronously before any await
      const previousActive = this.activeAudio;
      this.isPrimaryActive = !this.isPrimaryActive;
      const newActive = this.activeAudio;

      this.crossfadeToActiveDeck(previousActive);

      if (this.audioContext && this.audioContext.state === 'suspended') {
        await this.audioContext.resume().catch(() => {});
      }
      if (reqId !== this.playRequestId) return;

      try {
        newActive.currentTime = 0;
      } catch {}

      try {
        await newActive.play();
        this.isSwitchingTrack = false;
        this.notifyState(true, false);
        this.startProgressLoop();
        return;
      } catch (err: any) {
        console.warn('[AudioEngine] Playback error after pre-buffered swap:', err.message);
      }
    } else if (!this.activeAudio.paused) {
      // Non-prebuffered switch while a track is actively playing: swap decks so outgoing track fades out smoothly
      const previousActive = this.activeAudio;
      this.isPrimaryActive = !this.isPrimaryActive;
      this.crossfadeToActiveDeck(previousActive);
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume().catch(() => {});
    }
    if (reqId !== this.playRequestId) {
      return;
    }

    // Cold start or non-prebuffered switch: resolve fastest full stream url from cache
    const targetUrl = this.resolveFullStreamUrl(track);
    const streamUrl = await audioCache.getCachedStreamUrl(track.id, targetUrl, true);
    if (reqId !== this.playRequestId) {
      return;
    }

    const audio = this.activeAudio;
    audio.src = streamUrl;
    audio.load();

    try {
      await audio.play();
      this.isSwitchingTrack = false;
      this.notifyState(true, false);
      this.startProgressLoop();
    } catch (err: any) {
      // Never trigger preview fallback if play() was superseded by a newer track load or pause
      if (reqId !== this.playRequestId || err?.name === 'AbortError' || err?.name === 'NotAllowedError') {
        return;
      }

      // If the 'error' event listener already switched audio.src (e.g. to _retry=1), let it proceed
      if (audio.src && audio.src !== streamUrl && audio.src.includes('_retry=1')) {
        return;
      }

      console.warn('[AudioEngine] Play failed on primary stream:', err.message);

      // 1. If a cached blob: URL failed, retry directly with the backend targetUrl
      if (streamUrl.startsWith('blob:') && targetUrl && !targetUrl.startsWith('blob:')) {
        try {
          audio.src = targetUrl;
          audio.load();
          await audio.play();
          this.isSwitchingTrack = false;
          this.notifyState(true, false);
          this.startProgressLoop();
          return;
        } catch (retryErr: any) {
          if (reqId !== this.playRequestId || retryErr?.name === 'AbortError') {
            return;
          }
        }
      }

      // 2. If /api/stream/track failed once, retry once with cache-busting _retry=1 before falling back
      const currentTarget = targetUrl || streamUrl;
      if (currentTarget.includes('/api/stream/track') && !currentTarget.includes('_retry=1')) {
        try {
          const retryUrl = `${currentTarget}${currentTarget.includes('?') ? '&' : '?'}_retry=1`;
          audio.src = retryUrl;
          audio.load();
          await audio.play();
          this.isSwitchingTrack = false;
          this.notifyState(true, false);
          this.startProgressLoop();
          return;
        } catch (retryErr2: any) {
          if (reqId !== this.playRequestId || retryErr2?.name === 'AbortError') {
            return;
          }
        }
      }

      // 3. Fallback to self-contained YouTube IFrame Bridge if standard stream failed
      if (track.source !== 'radio') {
        const ok = await this.playViaYouTubeBridge(track, reqId);
        if (ok) return;
      }

      this.isSwitchingTrack = false;
      this.notifyState(false, false);
    }
  }

  private async playViaYouTubeBridge(
    track: Track,
    reqId: number,
    startSeconds = 0,
    shouldPlay = true
  ): Promise<boolean> {
    if (!track.artist && !track.title) return false;
    try {
      this.notifyState(true, true); // buffering
      const videoId = await resolveYouTubeVideoId(track.artist, track.title, track.duration);
      if (reqId !== this.playRequestId || !videoId) {
        return false;
      }

      this.activeAudio.pause();
      this.standbyAudio.pause();
      this.isUsingYouTubeBridge = true;
      this.currentResolvedVideoId = videoId;

      await this.ytBridge.play(videoId, startSeconds);
      if (!shouldPlay) {
        this.ytBridge.pause();
      }
      this.isSwitchingTrack = false;
      this.notifyState(shouldPlay, false);
      if (shouldPlay) {
        this.startProgressLoop();
      }
      return true;
    } catch (err: any) {
      console.warn('[AudioEngine] YouTube IFrame playback failed:', err);
      this.isUsingYouTubeBridge = false;
      mobileDiagnostics.report({
        level: 'error',
        category: 'IFRAME_ERROR',
        message: err?.message || 'YouTube IFrame playback failed',
        trackId: track.id,
        trackTitle: track.title,
        trackArtist: track.artist,
        stack: err?.stack,
      });
      return false;
    }
  }

  public setControllerMode(
    enabled: boolean,
    commandDelegate?: (action: string, data?: any) => void
  ): void {
    if (enabled) {
      // Clean direct local audio silencing without firing state changes or delegating pause to remote
      this.isSwitchingTrack = false;
      this.stopProgressLoop();
      if (this.standbyFadeTimer) {
        clearTimeout(this.standbyFadeTimer);
        this.standbyFadeTimer = null;
        this.standbyFadePromise = null;
      }
      // The native ExoPlayer engine is also a LOCAL audio path. Leaving it
      // running while the local device becomes a controller made the phone
      // keep playing (audibly) next to the speaker and desync from the remote
      // host — the WebView-era paths were silenced here, the engine was not.
      if (this.isUsingNativeEngine) {
        this.isUsingNativeEngine = false;
        try { androidNativePlayback.stop(); } catch { /* noop */ }
      }
      YouTubeIframeBridge.setNativeOwner(false);
      if (this.isUsingYouTubeBridge) {
        this.ytBridge.pause();
      } else {
        this.activeAudio.pause();
        this.standbyAudio.pause();
      }
      this.prebufferNextTrack(null);
    }
    this.isControllerMode = enabled;
    this.remoteCommandDelegate = commandDelegate || null;
  }

  public getIsControllerMode(): boolean {
    return this.isControllerMode;
  }

  public setCurrentTrack(track: Track | null): void {
    this.currentTrack = track;
    if (track?.duration && isFinite(track.duration) && track.duration > 0) {
      this.controllerDuration = track.duration;
    }
  }

  // ---------------------------------------------------------------------
  // Native engine (Android ExoPlayer) queue context + event hooks
  // ---------------------------------------------------------------------

  /**
   * Hands the current store queue to the native engine so the Media3 playlist
   * can auto-advance (and repeat) entirely natively even when WebView/JS
   * timers are frozen in Doze. playerStore calls this whenever the store queue
   * or repeat mode is (re)established before triggering playback.
   */
  public setNativeQueueContext(
    tracks: Track[],
    startIndex: number,
    repeatMode: 'off' | 'all' | 'one' | 'none' = 'none'
  ): void {
    this.nativeQueueContext = Array.isArray(tracks) ? [...tracks] : [];
    this.nativeQueueStartIndex = typeof startIndex === 'number' ? startIndex : -1;
    this.nativeRepeatMode = repeatMode === 'one' || repeatMode === 'all' ? repeatMode : 'none';
  }

  public setNativeRepeatMode(mode: 'off' | 'all' | 'one' | 'none' | 'none'): void {
    this.nativeRepeatMode = mode === 'one' || mode === 'all' ? mode : 'none';
    try {
      androidNativePlayback.setRepeatMode(this.nativeRepeatMode);
    } catch { /* bridge unavailable */ }
  }

  public onNativeTransition(cb: (track: NativeTrackPayload | null, payloadIndex: number) => void): () => void {
    this.nativeTransitionCallbacks.add(cb);
    return () => { this.nativeTransitionCallbacks.delete(cb); };
  }

  public onNativeQueueEnded(cb: () => void): () => void {
    this.nativeQueueEndedCallbacks.add(cb);
    return () => { this.nativeQueueEndedCallbacks.delete(cb); };
  }

  public isNativeEngineActive(): boolean {
    return this.isUsingNativeEngine;
  }

  /**
   * Keeps the native playlist in sync with store-side queue edits while the
   * native engine owns playback. The native side restarts cleanly on the
   * currently playing track (cache hit ⇒ sub-second).
   */
  public syncNativeQueue(tracks: Track[]): void {
    // Never sync while this device is only a remote controller (casting to a
    // speaker/host): the engine must stay idle, otherwise the sync would
    // (re)start local playback next to the remote host.
    if (this.isControllerMode) return;
    if (!this.isUsingNativeEngine || !androidNativePlayback.isAvailable()) return;
    try {
      const currentId = this.currentTrack?.id ?? null;
      androidNativePlayback.updateQueue(
        tracks.map((t) => this.toNativePayload(t, null)),
        currentId,
        this.nativeRepeatMode
      );
    } catch { /* ignore */ }
  }

  private wireNativeEvents(): void {
    if (this.nativeEventsWired) return;
    this.nativeEventsWired = true;
    androidNativePlayback.setCallbacks({
      onState: (state) => {
        if (!this.isUsingNativeEngine) {
          if (state === 'playing' || state === 'buffering') {
            this.isUsingNativeEngine = true;
            YouTubeIframeBridge.setNativeOwner(true);
          } else {
            return;
          }
        }
        if (state === 'playing') {
          this.isSwitchingTrack = false;
          this.notifyState(true, false);
          this.startProgressLoop();
        } else if (state === 'buffering') {
          if (!this.isSwitchingTrack) this.notifyState(true, true);
        } else if (state === 'paused') {
          this.notifyState(false, false);
        }
        // 'idle' means the engine was stopped (user stop, teardown or a
        // player error): native ownership must be dropped too, otherwise
        // later transport calls (lockscreen/stop→play) only tickle an
        // emptied engine and the play button goes dead. Same cleanup as
        // onEnded below.
        if (state === 'idle') {
          this.isUsingNativeEngine = false;
          YouTubeIframeBridge.setNativeOwner(false);
          this.notifyState(false, false);
        }
      },
      onTransition: (track, payloadIndex) => {
        if (!this.isUsingNativeEngine) return;
        if (track) this.currentTrack = track as any;
        this.hasNotifiedApproachingEnd = false;
        this.nativeTransitionCallbacks.forEach((cb) => {
          try { cb(track, payloadIndex); } catch { /* listener error */ }
        });
      },
      onEnded: () => {
        if (!this.isUsingNativeEngine) return;
        this.isUsingNativeEngine = false;
        YouTubeIframeBridge.setNativeOwner(false);
        this.stopProgressLoop();
        this.notifyState(false, false);
        this.nativeQueueEndedCallbacks.forEach((cb) => {
          try { cb(); } catch { /* listener error */ }
        });
      },
      onError: (message, payload) => {
        console.warn('[AudioEngine] Native engine error:', message, payload);

        // Discard error if it clearly belongs to a different queued track, keeping active song playing
        if (payload?.id && this.currentTrack?.id && payload.id !== this.currentTrack.id) {
          console.info(`[AudioEngine] Ignored native error for queued track (${payload.title || payload.id}), active track (${this.currentTrack.title}) continues.`);
          return;
        }

        if (this.isUsingNativeEngine && this.currentTrack && !this.isDirectAudioTrack(this.currentTrack)) {
          console.info('[AudioEngine] Native playback error (' + message + '), seamlessly falling back to YouTube IFrame Bridge for:', this.currentTrack.title);
          mobileDiagnostics.report({
            level: 'warn',
            category: 'RESOLVE_FAILED',
            message: `Native playback failed (${message}), falling back to YouTube IFrame Bridge`,
            trackId: this.currentTrack.id,
            trackTitle: this.currentTrack.title,
            trackArtist: this.currentTrack.artist,
            resolveError: message,
          });
          this.isUsingNativeEngine = false;
          YouTubeIframeBridge.setNativeOwner(false);
          try { androidNativePlayback.stop(); } catch { /* noop */ }
          this.playViaYouTubeBridge(this.currentTrack, this.playRequestId);
        }
      },
    });
  }

  private isNativeRoutable(track: Track): boolean {
    if (!androidNativePlayback.isAvailable()) return false;
    const source = String(track.source || '');
    if (source === 'p2p') return false; // torrent-backed playback needs the local backend
    if (this.isDirectAudioTrack(track)) {
      // Native can only stream absolute http(s) sources (blob:/relative need the WebView)
      return /^https?:\/\//i.test(String(track.streamUrl || ''));
    }
    // Anything resolved via the YouTube bridge path is resolvable on-device.
    return true;
  }

  private nativeDirectStreamUrl(track: Track): string | null {
    const url = String(track.streamUrl || '');
    return /^https?:\/\//i.test(url) ? url : null;
  }

  private toNativePayload(track: Track, videoId: string | null): NativeTrackPayload {
    const safeDur = track.duration && isFinite(track.duration) && track.duration > 0
      ? Math.round(track.duration)
      : undefined;
    return {
      id: track.id,
      videoId: videoId ?? null,
      title: track.title || 'Unknown',
      artist: track.artist || '',
      album: track.album ?? null,
      artworkUrl: track.artworkUrl ?? null,
      durationSec: safeDur,
      source: track.source as string,
      streamUrl: this.nativeDirectStreamUrl(track),
    };
  }

  private buildNativePayloadQueue(track: Track, videoIdForCurrent: string | null): NativeTrackPayload[] {
    const context = this.nativeQueueContext;
    const idx = context.findIndex((t) => t && t.id === track.id);
    const base = idx >= 0 ? context : [track];
    // Exclude tracks the native engine cannot reliably stream (e.g. vault
    // tracks whose URL is a blob: or server-relative path) — otherwise the
    // on-device search fallback could match an unrelated YouTube song.
    const queueSource = base.filter((t) => t && t.id === track.id ? true : this.isNativeRoutable(t));
    this.nativeQueueStartIndex = queueSource.findIndex((t) => t.id === track.id);
    return queueSource.map((t) =>
      this.toNativePayload(t, t.id === track.id ? videoIdForCurrent : null)
    );
  }

  private async playViaNativeEngine(
    track: Track,
    reqId: number,
    startSeconds = 0,
    shouldPlay = true
  ): Promise<boolean> {
    try {
      this.wireNativeEvents();

      // Silence every WebView-side audio path first (single-player invariant
      // that the v1.0.30–1.0.38 attempts kept violating).
      this.activeAudio.pause();
      this.standbyAudio.pause();
      if (this.isUsingYouTubeBridge) {
        this.ytBridge.pause();
        this.isUsingYouTubeBridge = false;
      }

      const isDirect = this.isDirectAudioTrack(track);
      let videoId: string | null = null;
      if (isDirect) {
        if (!/^https?:\/\//i.test(String(track.streamUrl || ''))) return false;
      } else {
        const duration = track.duration && isFinite(track.duration) ? track.duration : 0;
        this.notifyState(true, true); // buffering while resolving
        try {
          videoId = await Promise.race([
            resolveYouTubeVideoId(track.artist, track.title, duration),
            new Promise<null>((res) => setTimeout(() => res(null), 3500)),
          ]);
        } catch {
          videoId = null;
        }
        if (reqId !== this.playRequestId) return false;
      }

      const payloadTracks = this.buildNativePayloadQueue(track, videoId);
      const startIndex = Math.max(0, this.nativeQueueStartIndex >= 0 ? this.nativeQueueStartIndex : 0);
      const target = payloadTracks[startIndex];

      this.currentTrack = track;
      this.currentResolvedVideoId = videoId;
      this.hasNotifiedApproachingEnd = false;
      this.prebufferedTrack = null;
      this.isPrebufferedReady = false;
      const fallbackDur = target?.durationSec || (track.duration && isFinite(track.duration) ? track.duration : 210);
      this.emitSyntheticTimeUpdate(startSeconds, fallbackDur);

      this.isUsingNativeEngine = true;
      const started = androidNativePlayback.playWithQueue(
        payloadTracks,
        startIndex,
        startSeconds * 1000,
        this.nativeRepeatMode,
        Math.round(this.currentVolume * 100)
      );
      if (!started) {
        this.isUsingNativeEngine = false;
        YouTubeIframeBridge.setNativeOwner(false);
        return false;
      }

      YouTubeIframeBridge.setNativeOwner(true);
      this.isSwitchingTrack = false;
      this.notifyState(shouldPlay, true);
      if (shouldPlay) {
        this.startProgressLoop();
      }
      return true;
    } catch (err) {
      console.warn('[AudioEngine] Native routing failed, falling back to WebView path:', err);
      this.isUsingNativeEngine = false;
      YouTubeIframeBridge.setNativeOwner(false);
      return false;
    }
  }

  public getCurrentTime(): number {
    if (this.isControllerMode) {
      return this.controllerCurrentTime;
    }
    if (this.isUsingNativeEngine) {
      return (androidNativePlayback.getCurrentPositionMs() || 0) / 1000;
    }
    if (this.isUsingYouTubeBridge) {
      return this.ytBridge.getCurrentTime();
    }
    return this.activeAudio.currentTime || 0;
  }

  public getDuration(): number {
    if (this.isControllerMode) {
      if (this.controllerDuration > 0) return this.controllerDuration;
      if (this.currentTrack?.duration && isFinite(this.currentTrack.duration) && this.currentTrack.duration > 0) {
        return this.currentTrack.duration;
      }
      return 0;
    }
    if (this.isUsingNativeEngine) {
      const nativeDurSec = androidNativePlayback.getDurationSec();
      if (nativeDurSec > 0) return nativeDurSec;
      const trackDur = this.currentTrack?.duration;
      if (trackDur && isFinite(trackDur) && trackDur > 0) return trackDur;
      return 0;
    }
    if (this.isUsingYouTubeBridge) {
      const bridgeDur = this.ytBridge.getDuration();
      if (bridgeDur > 0) return bridgeDur;
    }
    return this.getEffectiveDuration();
  }

  public emitSyntheticTimeUpdate(currentTime: number, duration: number): void {
    this.controllerCurrentTime = isFinite(currentTime) && currentTime >= 0 ? currentTime : 0;
    if (typeof duration === 'number' && isFinite(duration) && duration > 0) {
      this.controllerDuration = duration;
    }
    for (const cb of this.timeUpdateCallbacks) {
      cb(currentTime, duration);
    }
  }

  public togglePlay(): void {
    if (this.isControllerMode) {
      this.remoteCommandDelegate?.('toggle_play');
      return;
    }

    if (this.isUsingNativeEngine) {
      if (androidNativePlayback.isPlaying()) {
        androidNativePlayback.pause();
      } else {
        androidNativePlayback.resume();
      }
      return;
    }

    if (this.isUsingYouTubeBridge) {
      if (this.ytBridge.isPlaying()) {
        this.ytBridge.pause();
      } else {
        this.ytBridge.resume();
      }
      return;
    }

    this.initWebAudio();
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    const audio = this.activeAudio;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      this.isSwitchingTrack = false;
      audio.pause();
    }
  }

  public pause(): void {
    this.isSwitchingTrack = false;
    this.stopProgressLoop();
    if (this.standbyFadeTimer) {
      clearTimeout(this.standbyFadeTimer);
      this.standbyFadeTimer = null;
      this.standbyFadePromise = null;
    }
    if (this.isUsingNativeEngine) {
      androidNativePlayback.pause();
      this.notifyState(false, false);
      return;
    }
    if (this.isUsingYouTubeBridge) {
      this.ytBridge.pause();
      this.notifyState(false, false);
      return;
    }
    this.activeAudio.pause();
    this.standbyAudio.pause();
  }

  public resume(): void {
    if (this.isControllerMode) {
      this.remoteCommandDelegate?.('play');
      return;
    }
    if (this.isUsingNativeEngine) {
      androidNativePlayback.resume();
      this.notifyState(true, false);
      return;
    }
    if (this.isUsingYouTubeBridge) {
      this.ytBridge.resume();
      this.notifyState(true, false);
      return;
    }
    this.activeAudio.play().catch(() => {});
  }

  public seekTo(seconds: number): void {
    if (this.isControllerMode) {
      const dur = this.getDuration();
      this.emitSyntheticTimeUpdate(seconds, dur);
      this.remoteCommandDelegate?.('seek', { seconds, positionMs: seconds * 1000 });
      return;
    }
    if (this.isUsingNativeEngine) {
      androidNativePlayback.seekTo(seconds);
      const dur = this.getDuration();
      this.emitSyntheticTimeUpdate(seconds, dur);
      return;
    }
    if (this.isUsingYouTubeBridge) {
      this.ytBridge.seekTo(seconds);
      const dur = this.getDuration();
      this.emitSyntheticTimeUpdate(seconds, dur);
      return;
    }
    const audio = this.activeAudio;
    const dur = this.getEffectiveDuration(audio);
    if (isFinite(seconds) && dur > 0) {
      const maxDur = isFinite(dur) ? dur : seconds;
      const clamped = Math.max(0, Math.min(seconds, maxDur));
      try {
        audio.currentTime = clamped;
      } catch {}
      this.emitSyntheticTimeUpdate(clamped, dur);
    }
  }

  /**
   * Loads a track and starts playback at a specified millisecond offset.
   * Guarantees that currentTime seek executes immediately upon metadata readiness,
   * avoiding race conditions where currentTime is reset to 0.
   */
  public async playTrackAtPosition(
    track: Track,
    positionMs: number,
    shouldPlay: boolean = true
  ): Promise<void> {
    this.stopProgressLoop();
    this.isSwitchingTrack = shouldPlay;

    // Tear down the previous native queue first so two players never overlap.
    if (this.isUsingNativeEngine) {
      this.isUsingNativeEngine = false;
      try { androidNativePlayback.stop(); } catch { /* noop */ }
    }
    if (this.isUsingYouTubeBridge) {
      this.ytBridge.pause();
      this.isUsingYouTubeBridge = false;
    }

    const targetSeconds = Math.max(0, positionMs / 1000);

    // Android: hand playback to the native engine for screen-off-proof audio.
    if (this.isNativeRoutable(track)) {
      const nativeOk = await this.playViaNativeEngine(track, ++this.playRequestId, targetSeconds, shouldPlay);
      if (nativeOk) return;
    }

    const isDirect = this.isDirectAudioTrack(track);

    if (!isDirect) {
      this.currentTrack = track;
      this.hasNotifiedApproachingEnd = false;
      this.prebufferedTrack = null;
      this.isPrebufferedReady = false;
      const initialDur = track.duration && isFinite(track.duration) ? track.duration : 210;
      this.emitSyntheticTimeUpdate(targetSeconds, initialDur);

      const ok = await this.playViaYouTubeBridge(track, ++this.playRequestId, targetSeconds, shouldPlay);
      if (ok) return;
    }

    this.initWebAudio();
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume().catch(() => {});
    }

    this.currentTrack = track;
    this.hasNotifiedApproachingEnd = false;
    this.prebufferedTrack = null;

    const initialDur = this.getEffectiveDuration(undefined, track);
    this.emitSyntheticTimeUpdate(targetSeconds, initialDur);

    const targetUrl = this.resolveFullStreamUrl(track);
    const streamUrl = await audioCache.getCachedStreamUrl(track.id, targetUrl, true);
    const audio = this.activeAudio;

    const performSeekAndPlay = async () => {
      try {
        if (isFinite(targetSeconds) && targetSeconds > 0) {
          audio.currentTime = targetSeconds;
        }
        if (shouldPlay) {
          await audio.play();
          this.isSwitchingTrack = false;
          this.startProgressLoop();
        } else {
          this.isSwitchingTrack = false;
          audio.pause();
        }
      } catch (err: any) {
        this.isSwitchingTrack = false;
        console.warn('[AudioEngine] Playback error after handoff seek:', err.message);
      }
    };

    if (audio.src === streamUrl && audio.readyState >= 1) {
      await performSeekAndPlay();
    } else {
      audio.src = streamUrl;
      audio.preload = 'auto';

      const onLoaded = () => {
        audio.removeEventListener('loadedmetadata', onLoaded);
        performSeekAndPlay();
      };
      audio.addEventListener('loadedmetadata', onLoaded);
      audio.load();
    }
  }

  /**
   * Natural quadratic audio curve (standard professional player taper)
   * Prevents low-volume blasts while ensuring smooth, balanced progression across 0-100%.
   */
  public calculateGain(volume: number): number {
    const clamped = Math.max(0, Math.min(1, volume));
    if (clamped <= 0.001) return 0;
    return Math.pow(clamped, 1.8);
  }

  public setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.currentVolume = clamped;
    this.ytBridge.setVolume(clamped);
    if (this.isUsingNativeEngine) {
      // Native uses the raw percentage; the 1.8 gain curve is WebAudio-only.
      try { androidNativePlayback.setVolume(clamped * 100); } catch { /* noop */ }
    }
    if (this.isControllerMode) {
      this.remoteCommandDelegate?.('set_volume', { volume: clamped });
      return;
    }
    const gain = this.calculateGain(clamped);

    if (this.masterGainNode && this.audioContext) {
      this.primaryAudio.volume = 1.0;
      this.secondaryAudio.volume = 1.0;
      try {
        const currentTime = this.audioContext.currentTime;
        this.masterGainNode.gain.cancelScheduledValues(currentTime);
        this.masterGainNode.gain.setTargetAtTime(gain, currentTime, 0.015);
      } catch {
        this.masterGainNode.gain.value = gain;
      }
    } else {
      this.primaryAudio.volume = gain;
      this.secondaryAudio.volume = gain;
    }
  }

  public getVolume(): number {
    return this.currentVolume;
  }

  public isPlaying(): boolean {
    if (this.isUsingNativeEngine) {
      return androidNativePlayback.isPlaying();
    }
    if (this.isUsingYouTubeBridge) {
      return this.ytBridge.isPlaying();
    }
    const audio = this.activeAudio;
    return !audio.paused && !audio.ended;
  }

  public getCurrentTrack(): Track | null {
    return this.currentTrack;
  }

  /**
   * Returns the YouTube Video ID of the currently playing or active track, if applicable.
   */
  public getCurrentVideoId(): string | null {
    if (this.currentResolvedVideoId) {
      return this.currentResolvedVideoId;
    }
    const bridgeVid = this.ytBridge.getVideoId();
    if (bridgeVid) {
      return bridgeVid;
    }
    if (this.currentTrack && this.currentTrack.artist && this.currentTrack.title) {
      return getCachedVideoId(this.currentTrack.artist, this.currentTrack.title);
    }
    return null;
  }

  /**
   * Hot-swaps the current audio source to an alternative videoId seamlessly at current playback time.
   */
  public async switchSource(newVideoId: string): Promise<boolean> {
    if (!this.currentTrack || !newVideoId || newVideoId.length !== 11) return false;
    const currentPos = this.getCurrentTime();
    const wasPlaying = this.isPlaying();

    this.currentResolvedVideoId = newVideoId;
    setExplicitSource(this.currentTrack.artist, this.currentTrack.title, newVideoId);

    if (this.isUsingYouTubeBridge) {
      await this.ytBridge.play(newVideoId, currentPos);
      if (!wasPlaying) {
        this.ytBridge.pause();
      }
      return true;
    }

    if (this.isUsingNativeEngine) {
      await this.playViaNativeEngine(this.currentTrack, ++this.playRequestId, currentPos, wasPlaying);
      return true;
    }

    // If somehow neither was active yet (e.g. paused or ready to play):
    if (this.isDirectAudioTrack(this.currentTrack)) {
      return false;
    }
    await this.playViaYouTubeBridge(this.currentTrack, ++this.playRequestId, currentPos, wasPlaying);
    return true;
  }

  /**
   * Marks the currently playing stream source as bad (e.g. audio watermark, promo voiceover)
   * and immediately resolves and switches to the next best clean candidate.
   */
  public async markCurrentSourceAsBad(
    reason = 'audio_watermark'
  ): Promise<{ success: boolean; newVideoId: string | null; message: string }> {
    const track = this.currentTrack;
    if (!track) {
      return { success: false, newVideoId: null, message: 'No track is currently playing' };
    }

    const videoId = this.getCurrentVideoId();
    if (!videoId) {
      return {
        success: false,
        newVideoId: null,
        message: 'Current track is not streamed from an external video source',
      };
    }

    try {
      const { newVideoId } = await markSourceAsBadAndResolveNext(
        track.artist,
        track.title,
        videoId,
        track.duration,
        reason
      );

      if (newVideoId) {
        await this.switchSource(newVideoId);
        return {
          success: true,
          newVideoId,
          message: 'Source marked as bad (audio watermark). Switched to clean source!',
        };
      } else {
        return {
          success: false,
          newVideoId: null,
          message: 'Source marked as bad, but no clean alternative candidates were found.',
        };
      }
    } catch (err: any) {
      return {
        success: false,
        newVideoId: null,
        message: err?.message || 'Failed to switch audio source',
      };
    }
  }

  public getAnalyser(): AnalyserNode | null {
    this.initWebAudio();
    return this.analyserNode;
  }

  /**
   * True when playback is routed through the hidden YouTube IFrame bridge.
   * The bridge's audio lives inside a cross-origin iframe and can never be
   * wired into the Web Audio AnalyserNode, so visualizers must use the
   * synthetic bridge spectrum (see fillBridgeVisualizerData) instead of
   * expecting real FFT data.
   */
  public isBridgePlayback(): boolean {
    return this.isUsingYouTubeBridge || this.isUsingNativeEngine;
  }

  /**
   * True when the YouTube bridge is actively producing audible sound.
   * Preserves the silence invariant: paused / buffering / muted / zero-volume
   * states return false so visualizers fall back to idle breathing.
   */
  public isBridgeAudible(): boolean {
    if (this.isUsingNativeEngine) {
      // Native playback has no AnalyserNode either → same synthetic-pulse path
      // the YouTube bridge used (silence invariant preserved).
      if (!androidNativePlayback.isPlaying()) return false;
      if (this.currentVolume <= 0.001) return false;
      return true;
    }
    if (!this.isUsingYouTubeBridge) return false;
    try {
      if (!this.ytBridge.isPlaying()) return false;
    } catch {
      return false;
    }
    if (this.currentVolume <= 0.001) return false;
    return true;
  }

  public getBridgeVisualTime(): number {
    if (this.isUsingNativeEngine) {
      try {
        return (androidNativePlayback.getCurrentPositionMs() || 0) / 1000;
      } catch {
        return 0;
      }
    }
    try {
      return this.ytBridge.getCurrentTime() || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Beat-reactive synthetic spectrum for YouTube-bridge playback.
   * Fills `freq` (0..255 magnitude per FFT bin) and `wave` (0..255 time-domain,
   * 128 = silence) so Nebula / Ultra / HUD canvases dance in sync with the
   * music even though real YT audio bytes are unreachable (cross-origin iframe).
   * Returns true when synthetic music data was written, false when silent
   * (caller should render idle state instead).
   */
  public fillBridgeVisualizerData(freq: Uint8Array, wave: Uint8Array): boolean {
    if (!this.isBridgeAudible()) return false;
    if (freq.length === 0 || wave.length === 0) return false;
    const t = this.getBridgeVisualTime();
    const volScale = 0.35 + 0.65 * Math.max(0, Math.min(1, this.currentVolume));

    // ~124 BPM kick clock shared with getAudioEnergy so icon + canvas stay in sync.
    const beatInterval = 60 / 124;
    const beatPhase = beatInterval > 0 ? (t % beatInterval) / beatInterval : 0;
    const kickEnv = Math.exp(-beatPhase * 5);
    const barInterval = beatInterval * 4;
    const barPhase = barInterval > 0 ? (t % barInterval) / barInterval : 0;
    const barEnv = Math.exp(-barPhase * 3);

    const bassLevel = Math.min(1, 0.52 + kickEnv * 0.48 + barEnv * 0.08);
    const midLevel = Math.min(
      1,
      0.38 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2.1)) + kickEnv * 0.18
    );
    const trebleLevel = Math.min(
      1,
      0.32 + 0.18 * (0.5 + 0.5 * Math.sin(t * 3.7 + 1.3)) + kickEnv * 0.12
    );

    const n = freq.length;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const lowShape = Math.exp(-x * 9);
      const midD = (x - 0.18) / 0.13;
      const midShape = Math.exp(-midD * midD);
      const highShape = Math.exp(-x * 3) * (0.55 + 0.45 * Math.sin(t * 3.0 + i * 0.11));
      const wobble = 0.85 + 0.15 * Math.sin(t * 4.2 + i * 0.35);
      const val =
        (bassLevel * lowShape + midLevel * midShape * 0.8 + trebleLevel * highShape * 0.5) *
        wobble *
        volScale;
      const byte = Math.round(Math.min(1.2, val) * 255);
      freq[i] = Math.max(0, Math.min(255, byte));
    }

    const m = wave.length;
    for (let i = 0; i < m; i++) {
      const u = i / m;
      const s =
        128 +
        70 * kickEnv * Math.sin(u * Math.PI * 4 + t * 5) * volScale +
        25 * midLevel * Math.sin(u * Math.PI * 10 - t * 7) +
        12 * trebleLevel * Math.sin(u * Math.PI * 22 + t * 9);
      wave[i] = Math.max(0, Math.min(255, Math.round(s)));
    }
    return true;
  }

  /**
   * Returns current peak audio frequency energy (0 to 255).
   * Returns 0 if silent, paused, buffering, seeking, or audio context suspended.
   */
  public getAudioEnergy(): number {
    if (this.isUsingYouTubeBridge || this.isUsingNativeEngine) {
      if (this.isBridgeAudible()) {
        const cur = this.getBridgeVisualTime();
        const beatInterval = 60 / 124;
        const beatPhase = beatInterval > 0 ? (cur % beatInterval) / beatInterval : 0;
        const kickEnv = Math.exp(-beatPhase * 5);
        const energy = 55 + kickEnv * 40;
        const scaled = energy * (0.35 + 0.65 * Math.max(0, Math.min(1, this.currentVolume)));
        return Math.max(25, Math.min(95, Math.round(scaled)));
      }
      return 0;
    }

    this.initWebAudio();
    const el = this.activeAudio;
    if (!el || el.paused || el.ended || el.seeking || el.muted || this.currentVolume <= 0.001) {
      return 0;
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      return 0;
    }

    if (this.analyserNode) {
      try {
        const buffer = new Uint8Array(32);
        this.analyserNode.getByteFrequencyData(buffer);
        let max = 0;
        // Start from index 1 to skip DC offset / sub-audible ground bias on bin 0
        for (let i = 1; i < buffer.length; i++) {
          if (buffer[i] > max) max = buffer[i];
        }
        return max;
      } catch {
        return 0;
      }
    }

    // Fallback if AnalyserNode is not connected or on restricted mobile WebView:
    // Only return active energy if audio is genuinely playing past intro pre-roll
    if ((el.currentTime || 0) > 0.8 && el.readyState >= 3) {
      return 40;
    }
    return 0;
  }

  /**
   * Checks whether the audio is actively producing audible sound (not silent).
   */
  public isAudioActive(threshold = 4): boolean {
    return this.getAudioEnergy() >= threshold;
  }

  // 10-Band Equalizer Controls
  public setEqualizerPreset(preset: EqualizerPreset): void {
    const gains = EQ_PRESET_GAINS[preset] || EQ_PRESET_GAINS.flat;
    this.eqState.preset = preset;
    this.eqState.bands = [...gains];

    if (this.audioContext && this.filterNodes.length === 10) {
      const now = this.audioContext.currentTime;
      for (let i = 0; i < 10; i++) {
        const gainVal = this.eqState.enabled ? gains[i] : 0;
        this.filterNodes[i].gain.setTargetAtTime(gainVal, now, 0.02);
      }
    }
  }

  public setBandGain(index: number, dbGain: number): void {
    const clampedGain = Math.max(-12, Math.min(12, dbGain));
    this.eqState.bands[index] = clampedGain;
    this.eqState.preset = 'custom';

    if (this.audioContext && this.filterNodes[index]) {
      const now = this.audioContext.currentTime;
      const gainVal = this.eqState.enabled ? clampedGain : 0;
      this.filterNodes[index].gain.setTargetAtTime(gainVal, now, 0.02);
    }
  }

  public setPreAmp(dbGain: number): void {
    const clampedGain = Math.max(-12, Math.min(12, dbGain));
    this.eqState.preAmp = clampedGain;

    if (this.audioContext && this.preAmpNode) {
      const now = this.audioContext.currentTime;
      this.preAmpNode.gain.setTargetAtTime(this.dbToLinear(clampedGain), now, 0.02);
    }
  }

  public toggleEqualizer(enabled?: boolean): void {
    this.eqState.enabled = enabled !== undefined ? enabled : !this.eqState.enabled;
    this.setEqualizerPreset(this.eqState.preset);
  }

  public getEqualizerState(): EqualizerState {
    return { ...this.eqState, bands: [...this.eqState.bands] };
  }

  private dbToLinear(db: number): number {
    return Math.pow(10, db / 20);
  }

  // Subscription helpers
  public onTimeUpdate(cb: (currentTime: number, duration: number) => void): () => void {
    this.timeUpdateCallbacks.add(cb);
    return () => this.timeUpdateCallbacks.delete(cb);
  }

  public onStateChange(cb: (isPlaying: boolean, isBuffering: boolean) => void): () => void {
    this.stateChangeCallbacks.add(cb);
    return () => this.stateChangeCallbacks.delete(cb);
  }

  public onTrackEnd(cb: () => void): () => void {
    this.trackEndCallbacks.add(cb);
    return () => this.trackEndCallbacks.delete(cb);
  }

  public onApproachingEnd(cb: () => void): () => void {
    this.approachingEndCallbacks.add(cb);
    return () => this.approachingEndCallbacks.delete(cb);
  }
}

export const audioEngine = AudioEngine.getInstance();
