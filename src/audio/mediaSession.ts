import { Track } from '../types/track';
import { getTrackArtwork } from '../services/artworkService';

export interface MediaActionHandlers {
  onPlay: () => void;
  onPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeekTo?: (time: number) => void;
}

let activeHandlers: MediaActionHandlers | null = null;

// Initialize global dispatcher for Android native callbacks
if (typeof window !== 'undefined') {
  (window as any).__dotifyNativeMediaAction = (action: string, data?: number) => {
    if (!activeHandlers) return;
    try {
      switch (action) {
        case 'play':
          activeHandlers.onPlay();
          break;
        case 'pause':
          activeHandlers.onPause();
          break;
        case 'next':
          activeHandlers.onNext();
          break;
        case 'prev':
          activeHandlers.onPrevious();
          break;
        case 'seek':
          if (activeHandlers.onSeekTo && typeof data === 'number') {
            activeHandlers.onSeekTo(data / 1000);
          }
          break;
        case 'stop':
          activeHandlers.onPause();
          break;
      }
    } catch (err) {
      console.warn('[DotifyMediaSession] Action dispatch error:', action, err);
    }
  };
}

export function updateMediaSession(
  track: Track | null,
  handlers: MediaActionHandlers,
  isPlaying: boolean = true,
  positionSec: number = 0
) {
  activeHandlers = handlers;

  // Android Native Notification Bridge
  if (typeof window !== 'undefined' && (window as any).AndroidNativeMediaSession) {
    try {
      if (track) {
        const artworkSrc = getTrackArtwork(track);
        const durationMs = Math.round((track.duration && isFinite(track.duration) ? track.duration : 0) * 1000);
        const positionMs = Math.round((positionSec || 0) * 1000);
        (window as any).AndroidNativeMediaSession.updateTrack(
          track.title || 'Unknown Title',
          track.artist || 'Unknown Artist',
          track.album || 'Dotify',
          artworkSrc || '',
          durationMs,
          positionMs,
          isPlaying
        );
      } else {
        (window as any).AndroidNativeMediaSession.stop();
      }
    } catch (err) {
      console.warn('[DotifyMediaSession] AndroidNativeMediaSession update failed:', err);
    }
  }

  // Standard Web MediaSession API
  if (!('mediaSession' in navigator)) return;

  if (!track) {
    navigator.mediaSession.playbackState = 'none';
    return;
  }

  const artworkSrc = getTrackArtwork(track);

  try {
    if (typeof MediaMetadata !== 'undefined') {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album || 'dotify',
        artwork: [
          { src: artworkSrc, sizes: '96x96', type: 'image/jpeg' },
          { src: artworkSrc, sizes: '128x128', type: 'image/jpeg' },
          { src: artworkSrc, sizes: '192x192', type: 'image/jpeg' },
          { src: artworkSrc, sizes: '256x256', type: 'image/jpeg' },
          { src: artworkSrc, sizes: '384x384', type: 'image/jpeg' },
          { src: artworkSrc, sizes: '512x512', type: 'image/jpeg' },
        ],
      });
    }
  } catch {
    // Insecure context or unsupported
  }

  try {
    navigator.mediaSession.setActionHandler('play', () => handlers.onPlay());
    navigator.mediaSession.setActionHandler('pause', () => handlers.onPause());
    navigator.mediaSession.setActionHandler('previoustrack', () => handlers.onPrevious());
    navigator.mediaSession.setActionHandler('nexttrack', () => handlers.onNext());

    if (handlers.onSeekTo) {
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) {
          handlers.onSeekTo!(details.seekTime);
        }
      });
    }
  } catch {
    // Action handlers might be unsupported on certain platforms
  }
}

export function updateMediaSessionPlaybackState(isPlaying: boolean, positionSec?: number) {
  if (typeof window !== 'undefined' && (window as any).AndroidNativeMediaSession) {
    try {
      const positionMs = positionSec !== undefined ? Math.round(positionSec * 1000) : 0;
      (window as any).AndroidNativeMediaSession.updatePlaybackState(isPlaying, positionMs);
    } catch (err) {
      console.warn('[DotifyMediaSession] AndroidNativeMediaSession state update failed:', err);
    }
  }

  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }
}

export function clearMediaSession() {
  if (typeof window !== 'undefined' && (window as any).AndroidNativeMediaSession) {
    try {
      (window as any).AndroidNativeMediaSession.stop();
    } catch {}
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = 'none';
  }
}
