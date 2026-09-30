/**
 * YouTube IFrame Audio Bridge
 * Hosts an official, hidden YouTube IFrame Player inside the app / Android WebView.
 * Provides 100% self-contained audio playback without server or bot blocks.
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

  private player: any = null;
  private isApiLoaded = false;
  private isReady = false;
  private isPlayingState = false;
  private isBufferingState = false;
  private currentVideoId: string | null = null;
  private targetStartSeconds = 0;
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

  /**
   * Injects the YouTube IFrame API script and prepares the hidden player container.
   */
  private initIframeApi(): void {
    if (typeof window === 'undefined') return;

    if (window.YT && window.YT.Player) {
      this.isApiLoaded = true;
      this.createPlayer();
      return;
    }

    const prevOnReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      this.isApiLoaded = true;
      if (typeof prevOnReady === 'function') {
        try { prevOnReady(); } catch {}
      }
      this.createPlayer();
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
   * Creates the hidden DOM container and instantiates the YT.Player.
   */
  private createPlayer(): void {
    if (typeof document === 'undefined' || !window.YT || !window.YT.Player) return;
    if (this.player) return;

    let container = document.getElementById('dotify-yt-bridge-wrapper');
    if (!container) {
      container = document.createElement('div');
      container.id = 'dotify-yt-bridge-wrapper';
      container.setAttribute(
        'style',
        'position: fixed; width: 200px; height: 200px; left: -9999px; bottom: -9999px; pointer-events: none; opacity: 0.001; z-index: -9999;'
      );

      const target = document.createElement('div');
      target.id = 'dotify-yt-player-target';
      container.appendChild(target);
      document.body.appendChild(container);
    }

    try {
      this.player = new window.YT.Player('dotify-yt-player-target', {
        height: '200',
        width: '200',
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          enablejsapi: 1,
          fs: 0,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin || 'http://tauri.localhost',
        },
        events: {
          onReady: () => {
            this.isReady = true;
            try {
              this.player.setVolume(Math.round(this.currentVolume * 100));
            } catch {}
            for (const resolve of this.readyResolvers) {
              try { resolve(); } catch {}
            }
            this.readyResolvers = [];
          },
          onStateChange: (event: any) => {
            this.handleStateChange(event.data);
          },
          onError: (event: any) => {
            console.warn('[YouTubeIframeBridge] Player error code:', event.data);
            this.onErrorCallback?.(Number(event.data) || 0);
          },
        },
      });
    } catch (err) {
      console.error('[YouTubeIframeBridge] Failed to construct YT.Player:', err);
    }
  }

  private waitUntilReady(): Promise<void> {
    if (this.isReady && this.player) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.readyResolvers.push(resolve);
      // Timeout fallback in case API takes too long
      setTimeout(() => {
        resolve();
      }, 5000);
    });
  }

  private handleStateChange(state: number): void {
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
   * Plays a YouTube video by ID at the given start offset.
   */
  public async play(videoId: string, startSeconds = 0): Promise<void> {
    await this.waitUntilReady();
    if (!this.player) {
      console.warn('[YouTubeIframeBridge] Cannot play: player not initialized');
      return;
    }

    this.currentVideoId = videoId;
    this.targetStartSeconds = startSeconds;

    try {
      this.player.loadVideoById({
        videoId,
        startSeconds,
        suggestedQuality: 'small',
      });
      this.player.playVideo();
      this.isPlayingState = true;
    } catch (err) {
      console.error('[YouTubeIframeBridge] play error:', err);
    }
  }

  public cueNext(videoId: string): void {
    // No-op for single player
  }

  public pause(): void {
    if (!this.player || !this.isReady) return;
    try {
      this.player.pauseVideo();
      this.isPlayingState = false;
      this.onStateChangeCallback?.(false, false);
    } catch {}
  }

  public resume(): void {
    if (!this.player || !this.isReady) return;
    try {
      this.player.playVideo();
      this.isPlayingState = true;
      this.onStateChangeCallback?.(true, false);
    } catch {}
  }

  public seekTo(seconds: number): void {
    if (!this.player || !this.isReady) return;
    try {
      this.player.seekTo(seconds, true);
    } catch {}
  }

  public setVolume(volume: number): void {
    this.currentVolume = Math.max(0, Math.min(1, volume));
    if (!this.player || !this.isReady) return;
    try {
      this.player.setVolume(Math.round(this.currentVolume * 100));
    } catch {}
  }

  public getCurrentTime(): number {
    if (!this.player || !this.isReady || typeof this.player.getCurrentTime !== 'function') {
      return 0;
    }
    try {
      return this.player.getCurrentTime() || 0;
    } catch {
      return 0;
    }
  }

  public getDuration(): number {
    if (!this.player || !this.isReady || typeof this.player.getDuration !== 'function') {
      return 0;
    }
    try {
      return this.player.getDuration() || 0;
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
    return this.currentVideoId;
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
