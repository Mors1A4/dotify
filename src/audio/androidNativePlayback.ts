import type { Track } from '../types/track';

/**
 * Bridge to the native (Media3 ExoPlayer) audio engine on Android
 * (`NativePlayerEngine` + the `AndroidNativePlayer` JS interface).
 *
 * Why: the WebView audio/iframe path dies when the screen locks or the app
 * is backgrounded (v1.0.30–1.0.38 post-mortem). The native engine receives
 * the whole queue once, advances tracks itself, and pushes state + position
 * events back through `window.__dotifyNativePlaybackEvent`, so playback
 * survives Doze/JS-freeze with zero JS involvement.
 *
 * This module is standalone (no audioEngine dependency) so the engine can
 * wire it in without import cycles; playerStore mirrors native transitions
 * into the store via audioEngine callback hooks.
 */

export interface NativeTrackPayload {
  id: string;
  videoId?: string | null;
  title: string;
  artist: string;
  album?: string | null;
  artworkUrl?: string | null;
  durationSec?: number;
  source?: string;
  streamUrl?: string | null;
}

export type NativeEngineState = 'playing' | 'paused' | 'buffering' | 'ended' | 'idle';

interface AndroidNativePlayerBridge {
  playQueue(payloadJson: string): boolean;
  updateQueue(payloadJson: string): boolean;
  pause(): void;
  resume(): void;
  seekTo(positionMs: number): void;
  next(): void;
  prev(): void;
  stop(): void;
  setVolume(volumePct: number): void;
  setRepeatMode(mode: string): void;
  isActive(): boolean;
  currentTimeMs(): number;
  durationMs(): number;
}

export interface NativeCallbacks {
  onState?: (state: NativeEngineState, positionMs: number) => void;
  onTransition?: (track: NativeTrackPayload | null, payloadIndex: number) => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
}

export type NativeRepeatMode = 'none' | 'one' | 'all';

class AndroidNativePlayback {
  private callbacks: NativeCallbacks = {};
  private installed = false;

  // Local mirror of the native playlist for UI interpolation.
  private queue: NativeTrackPayload[] = [];
  private currentIndex = -1;
  private lastState: NativeEngineState = 'idle';
  private lastStateAt = 0;
  private lastPositionMs = 0;
  private bufferingState = false;

  isAvailable(): boolean {
    const bridge = this.getBridge();
    return !!bridge && typeof bridge.playQueue === 'function';
  }

  private getBridge(): AndroidNativePlayerBridge | null {
    return (typeof window !== 'undefined' ? (window as any).AndroidNativePlayer : null) ?? null;
  }

  ensureInstalled(): void {
    if (this.installed || typeof window === 'undefined') return;
    (window as any).__dotifyNativePlaybackEvent = (type: string, payload: any) => {
      try {
        this.handleEvent(type, payload ?? {});
      } catch {
        // Never let a native push crash the page.
      }
    };
    this.installed = true;
  }

  setCallbacks(cb: NativeCallbacks): void {
    this.callbacks = { ...this.callbacks, ...cb };
  }

  private handleEvent(type: string, payload: any): void {
    switch (type) {
      case 'state': {
        const state = String(payload.state ?? 'idle') as NativeEngineState;
        this.lastState = state;
        this.lastStateAt = Date.now();
        if (typeof payload.positionMs === 'number') this.lastPositionMs = payload.positionMs;
        this.bufferingState = state === 'buffering';
        if (state === 'ended') {
          this.currentIndex = -1;
          this.callbacks.onEnded?.();
        } else {
          this.callbacks.onState?.(state, this.lastPositionMs);
        }
        break;
      }
      case 'transition': {
        const index = Number(payload.payloadIndex ?? -1);
        if (Number.isFinite(index) && index >= 0 && index < this.queue.length) {
          this.currentIndex = index;
        }
        if (typeof payload.positionMs === 'number') {
          this.lastPositionMs = payload.positionMs;
          this.lastStateAt = Date.now();
        }
        this.callbacks.onTransition?.(this.queue[this.currentIndex] ?? null, index);
        break;
      }
      case 'position': {
        if (typeof payload.positionMs === 'number') {
          this.lastPositionMs = payload.positionMs;
          this.lastStateAt = Date.now();
        }
        break;
      }
      case 'skip': {
        const idx = Number(payload.payloadIndex ?? -1);
        if (Number.isFinite(idx) && idx === this.currentIndex) this.currentIndex = -1;
        this.callbacks.onError?.(String(payload.title ?? 'Track unavailable'));
        break;
      }
      case 'error': {
        this.callbacks.onError?.(String(payload.message ?? 'Native playback error'));
        break;
      }
    }
  }

  playWithQueue(
    queue: NativeTrackPayload[],
    startIndex: number,
    startMs: number,
    repeatMode: NativeRepeatMode,
    volumePct: number
  ): boolean {
    const bridge = this.getBridge();
    if (!bridge || queue.length === 0) return false;
    this.ensureInstalled();
    const payload = {
      tracks: queue,
      startIndex: Math.max(0, Math.min(startIndex, queue.length - 1)),
      startMs: Math.max(0, Math.round(startMs)),
      repeatMode,
      volumePct: Math.max(0, Math.min(100, Math.round(volumePct))),
    };
    try {
      const ok = bridge.playQueue(JSON.stringify(payload)) !== false;
      if (ok) {
        this.queue = [...queue];
        this.currentIndex = payload.startIndex;
        this.lastState = 'buffering';
        this.lastStateAt = Date.now();
        this.lastPositionMs = payload.startMs;
        this.bufferingState = true;
      }
      return ok;
    } catch {
      return false;
    }
  }

  updateQueue(queue: NativeTrackPayload[], currentTrackId: string | null, repeatMode: NativeRepeatMode): boolean {
    const bridge = this.getBridge();
    if (!bridge) return false;
    let startIndex = currentTrackId ? queue.findIndex((t) => t.id === currentTrackId) : -1;
    if (startIndex < 0) startIndex = Math.max(0, this.currentIndex);
    const payload = {
      tracks: queue,
      startIndex,
      startMs: this.getCurrentPositionMs(),
      repeatMode,
      volumePct: 100,
    };
    try {
      const ok = bridge.updateQueue(JSON.stringify(payload)) !== false;
      if (ok) this.queue = [...queue];
      return ok;
    } catch {
      return false;
    }
  }

  pause(): void {
    try { this.getBridge()?.pause(); } catch { /* noop */ }
  }

  resume(): void {
    try { this.getBridge()?.resume(); } catch { /* noop */ }
  }

  seekTo(seconds: number): void {
    const ms = Math.max(0, Math.round(seconds * 1000));
    this.lastPositionMs = ms;
    this.lastStateAt = Date.now();
    try { this.getBridge()?.seekTo(ms); } catch { /* noop */ }
  }

  next(): void {
    try { this.getBridge()?.next(); } catch { /* noop */ }
  }

  prev(): void {
    try { this.getBridge()?.prev(); } catch { /* noop */ }
  }

  stop(): void {
    try { this.getBridge()?.stop(); } catch { /* noop */ }
    this.queue = [];
    this.currentIndex = -1;
    this.lastState = 'idle';
    this.lastStateAt = Date.now();
    this.lastPositionMs = 0;
    this.bufferingState = false;
  }

  setVolume(volumePct: number): void {
    try { this.getBridge()?.setVolume(Math.max(0, Math.min(100, Math.round(volumePct)))); } catch { /* noop */ }
  }

  setRepeatMode(mode: NativeRepeatMode): void {
    try { this.getBridge()?.setRepeatMode(mode); } catch { /* noop */ }
  }

  isActive(): boolean {
    try { return this.getBridge()?.isActive() === true; } catch { return false; }
  }

  // ----------------------------------------------------------------------
  // UI-facing state (used by audioEngine for time/duration/visualizer hooks)
  // ----------------------------------------------------------------------

  isPlaying(): boolean {
    return this.lastState === 'playing';
  }

  isBuffering(): boolean {
    return this.bufferingState;
  }

  hasOwningQueue(): boolean {
    return this.queue.length > 0 && this.lastState !== 'idle' && this.lastState !== 'ended';
  }

  getCurrentPositionMs(): number {
    if (this.lastState === 'playing') {
      const elapsed = Date.now() - this.lastStateAt;
      return this.lastPositionMs + Math.max(0, elapsed);
    }
    return this.lastPositionMs;
  }

  getDurationSec(): number {
    const track = this.currentIndex >= 0 ? this.queue[this.currentIndex] : null;
    return track?.durationSec ?? 0;
  }
}

export const androidNativePlayback = new AndroidNativePlayback();
