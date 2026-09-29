import { Track } from '../types/track';
import { getTrackArtwork } from '../services/artworkService';

export function updateMediaSession(
  track: Track | null,
  handlers: {
    onPlay: () => void;
    onPause: () => void;
    onPrevious: () => void;
    onNext: () => void;
    onSeekTo?: (time: number) => void;
  }
) {
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
  } catch (err) {
    // Action handlers might be unsupported on certain platforms
  }
}

export function updateMediaSessionPlaybackState(isPlaying: boolean) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }
}
