/**
 * YouTube IFrame Audio Bridge — Dual-Deck High Performance Architecture
 * Hosts official, hidden dual YouTube IFrame Players inside the app / Android WebView.
 * Provides 100% self-contained audio playback without server or bot blocks,
 * with zero-latency deck-swapping for queued and pre-buffered tracks.
 */

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export type PlayerStateCallback = (isPlaying: boolean, isBuffering: boolean) => void;
export type EndedCallback = () => void;
export type ErrorCallback = (errorCode: number) => void;

export class YouTubeIframeBridge {
  private static instance: YouTubeIframeBridge | null = null;

  // Dual-Deck Players: Deck A & Deck B
  private playerA: any = null;
  private playerB: any = null;
  private activeDeckId: 'A' | 'B' = 'A';

  private isReadyA = false;
  private isReadyB = false;
  private isApiLoaded = false;

  private isPlayingState = false;
  private isBufferingState = false;

  private deckAVideoId: string | null = null;
  private deckBVideoId: string | null = null;
  private currentVolume = 1.0; // 0.0 - 1.0

  private onStateChangeCallback: PlayerStateCallback | null = null;
  private onEndedCallback: EndedCallback | null = null;
  private onErrorCallback: ErrorCallback | null = null;

  private readyResolvers: Array<() => void> = [];

  private constructor() {
    if (typeof window !== 'undefined') {
      this.initIframeApi();
    }
  }

  public static getInstance(): YouTubeIframeBridge {
    if (!YouTubeIframeBridge.instance) {
      YouTubeIframeBridge.instance = new YouTubeIframeBridge();
    }
    return YouTubeIframeBridge.instance;
  }

  private get activePlayer(): any {
    return this.activeDeckId === 'A' ? this.playerA : this.playerB;
  }

  private get standbyPlayer(): any {
    return this.activeDeckId === 'A' ? this.playerB : this.playerA;
  }

  private get activeVideoId(): string | null {
    return this.activeDeckId === 'A' ? this.deckAVideoId : this.deckBVideoId;
  }

  private set activeVideoId(v: string | null) {
    if (this.activeDeckId === 'A') this.deckAVideoId = v;
    else this.deckBVideoId = v;
  }

  private get standbyVideoId(): string | null {
    return this.activeDeckId === 'A' ? this.deckBVideoId : this.deckAVideoId;
  }

  private set standbyVideoId(v: string | null) {
    if (this.activeDeckId === 'A') this.deckBVideoId = v;
    else this.deckAVideoId = v;
  }

  /**
   * Injects the YouTube IFrame API script and prepares the hidden player containers.
   */
  private initIframeApi(): void {
    if (typeof window === 'undefined') return;

    if (window.YT && window.YT.Player) {
      this.isApiLoaded = true;
      this.createPlayers();
      return;
    }

    const prevOnReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      this.isApiLoaded = true;
      if (typeof prevOnReady === 'function') {
        try { prevOnReady(); } catch {}
      }
      this.createPlayers();
    };

    if (!document.getElementById('yt-iframe-api-script')) {
      const tag = document.createElement('script');
      tag.id = 'yt-iframe-api-script';
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      if (firstScriptTag && firstScriptTag.parentNode) {
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      } else {
        document.head.appendChild(tag);
      }
    }
  }

  /**
   * Creates the hidden DOM container and instantiates dual YT.Players.
   */
  private createPlayers(): void {
    if (typeof document === 'undefined' || !window.YT || !window.YT.Player) return;

    let container = document.getElementById('dotify-yt-bridge-wrapper');
    if (!container) {
      container = document.createElement('div');
      container.id = 'dotify-yt-bridge-wrapper';
      container.setAttribute(
        'style',
        'position: fixed; width: 200px; height: 200px; left: -9999px; bottom: -9999px; pointer-events: none; opacity: 0.001; z-index: -9999;'
      );

      const targetA = document.createElement('div');
      targetA.id = 'dotify-yt-player-target-a';
      container.appendChild(targetA);

      const targetB = document.createElement('div');
      targetB.id = 'dotify-yt-player-target-b';
      container.appendChild(targetB);

      document.body.appendChild(container);
    }

    const playerVars = {
      autoplay: 1,
      controls: 0,
      disablekb: 1,
      enablejsapi: 1,
      fs: 0,
      modestbranding: 1,
      playsinline: 1,
      rel: 0,
      origin: window.location.origin || 'http://tauri.localhost',
    };

    const notifyReadyIfPossible = () => {
      if (this.isReadyA || this.isReadyB) {
        for (const resolve of this.readyResolvers) {
          try { resolve(); } catch {}
        }
        this.readyResolvers = [];
      }
    };

    try {
      if (!this.playerA) {
        this.playerA = new window.YT.Player('dotify-yt-player-target-a', {
          height: '200',
          width: '200',
          playerVars,
          events: {
            onReady: () => {
              this.isReadyA = true;
              try { this.playerA.setVolume(Math.round(this.currentVolume * 100)); } catch {}
              notifyReadyIfPossible();
            },
            onStateChange: (event: any) => {
              this.handleStateChange('A', event.data);
            },
            onError: (event: any) => {
              if (this.activeDeckId === 'A') {
                console.warn('[YouTubeIframeBridge Deck A] Error code:', event.data);
                this.onErrorCallback?.(Number(event.data) || 0);
              }
            },
          },
        });
      }

      if (!this.playerB) {
        this.playerB = new window.YT.Player('dotify-yt-player-target-b', {
          height: '200',
          width: '200',
          playerVars,
          events: {
            onReady: () => {
              this.isReadyB = true;
              try { this.playerB.setVolume(Math.round(this.currentVolume * 100)); } catch {}
              notifyReadyIfPossible();
            },
            onStateChange: (event: any) => {
              this.handleStateChange('B', event.data);
            },
            onError: (event: any) => {
              if (this.activeDeckId === 'B') {
                console.warn('[YouTubeIframeBridge Deck B] Error code:', event.data);
                this.onErrorCallback?.(Number(event.data) || 0);
              }
            },
          },
        });
      }
    } catch (err) {
      console.error('[YouTubeIframeBridge] Failed to construct YT.Players:', err);
    }
  }

  private waitUntilReady(): Promise<void> {
    if ((this.isReadyA && this.playerA) || (this.isReadyB && this.playerB)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.readyResolvers.push(resolve);
      setTimeout(() => {
        resolve();
      }, 5000);
    });
  }

  private handleStateChange(deck: 'A' | 'B', state: number): void {
    // Only dispatch events from the actively playing deck
    if (deck !== this.activeDeckId) {
      return;
    }

    // YT.PlayerState:
    // -1: UNSTARTED, 0: ENDED, 1: PLAYING, 2: PAUSED, 3: BUFFERING, 5: CUED
    switch (state) {
      case 1: // PLAYING
        this.isPlayingState = true;
        this.isBufferingState = false;
        this.onStateChangeCallback?.(true, false);
        break;
      case 2: // PAUSED
        this.isPlayingState = false;
        this.isBufferingState = false;
        this.onStateChangeCallback?.(false, false);
        break;
      case 3: // BUFFERING
        this.isBufferingState = true;
        this.onStateChangeCallback?.(this.isPlayingState, true);
        break;
      case 0: // ENDED
        this.isPlayingState = false;
        this.isBufferingState = false;
        this.onStateChangeCallback?.(false, false);
        this.onEndedCallback?.();
        break;
    }
  }

  /**
   * Pre-buffers the next track silently on the standby deck.
   * Uses cueVideoById with lowest quality to prefetch stream metadata in background.
   */
  public async cueNext(videoId: string): Promise<void> {
    if (!videoId || videoId.length !== 11) return;
    await this.waitUntilReady();
    const standby = this.standbyPlayer;
    if (!standby) return;

    if (this.standbyVideoId === videoId) {
      return; // Already cued on standby deck
    }

    this.standbyVideoId = videoId;
    try {
      if (typeof standby.cueVideoById === 'function') {
        standby.cueVideoById({
          videoId,
          startSeconds: 0,
          suggestedQuality: 'small',
        });
      }
    } catch (err) {
      console.debug('[YouTubeIframeBridge] cueNext error:', err);
    }
  }

  /**
   * Plays a YouTube video by ID.
   * If the video was already pre-buffered on the standby deck, performs a 0ms instant deck swap!
   */
  public async play(videoId: string, startSeconds = 0): Promise<void> {
    await this.waitUntilReady();

    // 1. Instant Deck Swap: Check if requested video is already primed on the standby deck
    if (this.standbyVideoId === videoId && this.standbyPlayer) {
      const prevActive = this.activePlayer;
      try {
        prevActive?.pauseVideo();
      } catch {}

      // Swap decks
      this.activeDeckId = this.activeDeckId === 'A' ? 'B' : 'A';
      const newActive = this.activePlayer;

      try {
        newActive.setVolume(Math.round(this.currentVolume * 100));
        if (startSeconds > 0) {
          newActive.seekTo(startSeconds, true);
        }
        newActive.playVideo();
        this.isPlayingState = true;
        this.onStateChangeCallback?.(true, false);
        return;
      } catch (err) {
        console.warn('[YouTubeIframeBridge] Standby deck swap failed, falling back to direct load:', err);
      }
    }

    // 2. Direct load on active player
    this.activeVideoId = videoId;
    const player = this.activePlayer;
    if (!player) {
      console.warn('[YouTubeIframeBridge] Cannot play: player not initialized');
      return;
    }

    try {
      player.loadVideoById({
        videoId,
        startSeconds,
        suggestedQuality: 'small',
      });
      player.playVideo();
      this.isPlayingState = true;
    } catch (err) {
      console.error('[YouTubeIframeBridge] play error:', err);
    }
  }

  public pause(): void {
    const player = this.activePlayer;
    if (!player) return;
    try {
      player.pauseVideo();
      this.isPlayingState = false;
      this.onStateChangeCallback?.(false, false);
    } catch {}
  }

  public resume(): void {
    const player = this.activePlayer;
    if (!player) return;
    try {
      player.playVideo();
      this.isPlayingState = true;
      this.onStateChangeCallback?.(true, false);
    } catch {}
  }

  public seekTo(seconds: number): void {
    const player = this.activePlayer;
    if (!player) return;
    try {
      player.seekTo(seconds, true);
    } catch {}
  }

  public setVolume(volume: number): void {
    this.currentVolume = Math.max(0, Math.min(1, volume));
    try {
      const volInt = Math.round(this.currentVolume * 100);
      this.playerA?.setVolume(volInt);
      this.playerB?.setVolume(volInt);
    } catch {}
  }

  public getCurrentTime(): number {
    const player = this.activePlayer;
    if (!player || typeof player.getCurrentTime !== 'function') {
      return 0;
    }
    try {
      return player.getCurrentTime() || 0;
    } catch {
      return 0;
    }
  }

  public getDuration(): number {
    const player = this.activePlayer;
    if (!player || typeof player.getDuration !== 'function') {
      return 0;
    }
    try {
      return player.getDuration() || 0;
    } catch {
      return 0;
    }
  }

  public isPlaying(): boolean {
    return this.isPlayingState;
  }

  public isBuffering(): boolean {
    return this.isBufferingState;
  }

  public getVideoId(): string | null {
    return this.activeVideoId;
  }

  public getCuedStandbyVideoId(): string | null {
    return this.standbyVideoId;
  }

  public setOnStateChange(cb: PlayerStateCallback | null): void {
    this.onStateChangeCallback = cb;
  }

  public setOnEnded(cb: EndedCallback | null): void {
    this.onEndedCallback = cb;
  }

  public setOnError(cb: ErrorCallback | null): void {
    this.onErrorCallback = cb;
  }
}
