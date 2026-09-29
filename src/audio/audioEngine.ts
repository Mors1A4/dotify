import { Track } from '../types/track';
import { EQ_FREQUENCIES, EQ_PRESET_GAINS, EqualizerPreset, EqualizerState } from '../dsp/types';
import { audioCache } from './audioCache';
import { getApiUrl, getCustomApiUrl, isAndroidApp } from '../services/apiConfig';
import { useMp3VaultStore } from '../services/mp3VaultService';

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

  private constructor() {
    this.primaryAudio = createAudioElement();
    this.primaryAudio.crossOrigin = 'anonymous';
    this.primaryAudio.preload = 'auto';

    this.secondaryAudio = createAudioElement();
    this.secondaryAudio.crossOrigin = 'anonymous';
    this.secondaryAudio.preload = 'auto';

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
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      this.audioContext = new AudioCtx();

      // Pre-amp gain node
      this.preAmpNode = this.audioContext.createGain();
      this.preAmpNode.gain.setValueAtTime(
        this.dbToLinear(this.eqState.preAmp),
        this.audioContext.currentTime
      );

      // Create dual sources and balance gains
      this.primarySourceNode = this.audioContext.createMediaElementSource(this.primaryAudio);
      this.secondarySourceNode = this.audioContext.createMediaElementSource(this.secondaryAudio);

      this.primaryGainNode = this.audioContext.createGain();
      this.secondaryGainNode = this.audioContext.createGain();

      this.primaryGainNode.gain.setValueAtTime(this.isPrimaryActive ? 1.0 : 0.0, this.audioContext.currentTime);
      this.secondaryGainNode.gain.setValueAtTime(this.isPrimaryActive ? 0.0 : 1.0, this.audioContext.currentTime);

      this.primarySourceNode.connect(this.primaryGainNode);
      this.secondarySourceNode.connect(this.secondaryGainNode);

      this.primaryGainNode.connect(this.preAmpNode);
      this.secondaryGainNode.connect(this.preAmpNode);

      // 10-band BiquadFilter cascade
      this.filterNodes = EQ_FREQUENCIES.map((freq, idx) => {
        const filter = this.audioContext!.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.setValueAtTime(freq, this.audioContext!.currentTime);
        filter.Q.setValueAtTime(1.4142, this.audioContext!.currentTime);
        filter.gain.setValueAtTime(this.eqState.bands[idx], this.audioContext!.currentTime);
        return filter;
      });

      // AnalyserNode for 60 FPS spectrum visualizer (1024 FFT size for 512 frequency bins)
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 1024;
      this.analyserNode.smoothingTimeConstant = 0.8;

      // Connect graph: preAmp -> filter[0] -> ... -> filter[9] -> analyser -> masterGain -> destination
      let lastNode: AudioNode = this.preAmpNode;

      for (const filter of this.filterNodes) {
        lastNode.connect(filter);
        lastNode = filter;
      }

      this.masterGainNode = this.audioContext.createGain();
      const initialGain = this.calculateGain(this.currentVolume);
      this.masterGainNode.gain.setValueAtTime(initialGain, this.audioContext.currentTime);

      this.primaryAudio.volume = 1.0;
      this.secondaryAudio.volume = 1.0;

      lastNode.connect(this.analyserNode);
      this.analyserNode.connect(this.masterGainNode);
      this.masterGainNode.connect(this.audioContext.destination);
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
    const rawDur = el?.duration;
    if (typeof rawDur === 'number' && isFinite(rawDur) && rawDur > 0) {
      return rawDur;
    }
    if (track && typeof track.duration === 'number' && isFinite(track.duration) && track.duration > 0) {
      return track.duration;
    }
    return 0;
  }

  private startProgressLoop(): void {
    if (this.rafId !== null || typeof requestAnimationFrame === 'undefined') return;
    const tick = () => {
      this.rafId = null;
      if (this.isControllerMode) return;
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
        this.rafId = requestAnimationFrame(tick);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopProgressLoop(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
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
        this.stopProgressLoop();
        this.isSwitchingTrack = false;
        this.notifyState(false, false);
        for (const cb of this.trackEndCallbacks) {
          cb();
        }
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

        // 2. If /api/stream/track failed once, retry once with cache-busting retry param
        if (el.src && el.src.includes('/api/stream/track') && !el.src.includes('_retry=1')) {
          const retryUrl = `${el.src}${el.src.includes('?') ? '&' : '?'}_retry=1`;
          el.src = retryUrl;
          el.load();
          el.play().catch(() => {});
          return;
        }

        const fallbackUrl =
          (this.currentTrack as any)?.previewUrl ||
          this.currentTrack?.sourceMetadata?.previewUrl ||
          this.currentTrack?.sourceMetadata?.fallbackUrl;

        if (fallbackUrl && el.src !== fallbackUrl) {
          console.log('[AudioEngine] Primary stream failed, switching to direct preview fallback:', fallbackUrl);
          el.src = fallbackUrl;
          el.load();
          el.play().catch((err) => {
            console.warn('[AudioEngine] Fallback play error:', err.message);
            this.isSwitchingTrack = false;
            this.notifyState(false, false);
          });
          return;
        }

        this.isSwitchingTrack = false;
        this.notifyState(false, false);
      }
    });
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
  private isSwitchingTrack: boolean = false;
  private standbyFadeTimer: ReturnType<typeof setTimeout> | null = null;
  private standbyFadePromise: Promise<void> | null = null;

  private async attemptBackgroundFullStreamUpgrade(track: Track, reqId: number): Promise<void> {
    if (!track.artist || !track.title) return;
    const hasBackend = !isAndroidApp() || Boolean(getCustomApiUrl());
    if (!hasBackend) return;

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
    const preview =
      (track as any)?.previewUrl ||
      track.sourceMetadata?.previewUrl ||
      track.sourceMetadata?.fallbackUrl ||
      (rawUrl.includes('dzcdn.net') ? rawUrl : '');

    if (rawUrl.includes('/api/stream/track')) {
      let fullUrl = rawUrl.startsWith('/api/') ? resolveTrackEndpoint(rawUrl) : rawUrl;
      if (!fullUrl.includes('duration=')) {
        fullUrl += `${fullUrl.includes('?') ? '&' : '?'}duration=${expectedDuration}`;
      }
      if (preview && !fullUrl.includes('preview=http')) {
        fullUrl += `&preview=${encodeURIComponent(preview)}`;
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

    if (isLegacyNonYtStream && track.artist && track.title && hasBackend) {
      const rawId = String(track.id || '').replace(/^(charts|audius|archive|radio|p2p):/, '');
      return resolveTrackEndpoint(
        `/api/stream/track?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(
          track.title
        )}&preview=${encodeURIComponent(preview)}&id=${encodeURIComponent(rawId)}&duration=${expectedDuration}`
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
  }

  public async playTrack(track: Track): Promise<void> {
    const reqId = ++this.playRequestId;
    this.stopProgressLoop();
    this.isSwitchingTrack = true;

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

      const fallbackUrl =
        (track as any)?.previewUrl ||
        track.sourceMetadata?.previewUrl ||
        track.sourceMetadata?.fallbackUrl;
      if (fallbackUrl && audio.src !== fallbackUrl) {
        try {
          audio.src = fallbackUrl;
          audio.load();
          await audio.play();
          this.isSwitchingTrack = false;
          this.notifyState(true, false);
          this.startProgressLoop();
        } catch (fErr: any) {
          this.isSwitchingTrack = false;
          console.warn('[AudioEngine] Fallback play error:', fErr.message);
        }
      } else {
        this.isSwitchingTrack = false;
      }
    }
  }

  public setControllerMode(
    enabled: boolean,
    commandDelegate?: (action: string, data?: any) => void
  ): void {
    this.isControllerMode = enabled;
    this.remoteCommandDelegate = commandDelegate || null;

    if (enabled) {
      this.pause();
      this.prebufferNextTrack(null);
    }
  }

  public getIsControllerMode(): boolean {
    return this.isControllerMode;
  }

  public getCurrentTime(): number {
    return this.activeAudio.currentTime || 0;
  }

  public getDuration(): number {
    return this.getEffectiveDuration();
  }

  public emitSyntheticTimeUpdate(currentTime: number, duration: number): void {
    for (const cb of this.timeUpdateCallbacks) {
      cb(currentTime, duration);
    }
  }

  public togglePlay(): void {
    if (this.isControllerMode) {
      this.remoteCommandDelegate?.('toggle_play');
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
    this.activeAudio.pause();
    this.standbyAudio.pause();
  }

  public resume(): void {
    if (this.isControllerMode) {
      this.remoteCommandDelegate?.('play');
      return;
    }
    this.activeAudio.play().catch(() => {});
  }

  public seekTo(seconds: number): void {
    if (this.isControllerMode) {
      this.remoteCommandDelegate?.('seek', { seconds, positionMs: seconds * 1000 });
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
    this.initWebAudio();
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume().catch(() => {});
    }

    this.currentTrack = track;
    this.hasNotifiedApproachingEnd = false;
    this.prebufferedTrack = null;

    const targetSeconds = Math.max(0, positionMs / 1000);
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
    const audio = this.activeAudio;
    return !audio.paused && !audio.ended;
  }

  public getCurrentTrack(): Track | null {
    return this.currentTrack;
  }

  public getAnalyser(): AnalyserNode | null {
    this.initWebAudio();
    return this.analyserNode;
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
