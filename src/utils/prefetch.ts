import { Track } from '../types/track';

const prefetchedSet = new Set<string>();

/**
 * Pre-warms the audio stream URL in the background.
 * Resolves the upstream stream URL so that clicking Play starts audio instantaneously.
 */
export function prefetchTrack(track?: Track | null) {
  if (!track?.streamUrl) return;
  if (!track.streamUrl.includes('/api/stream/track')) return;

  const key = track.id || track.streamUrl;
  if (prefetchedSet.has(key)) return;
  prefetchedSet.add(key);

  const url = track.streamUrl.includes('?')
    ? `${track.streamUrl}&preload=true`
    : `${track.streamUrl}?preload=true`;

  fetch(url, { priority: 'low' } as any).catch(() => {});
}

/**
 * Pre-warms multiple tracks sequentially or in a batch.
 */
export function prefetchTracks(tracks: Track[], count = 2) {
  tracks.slice(0, count).forEach(prefetchTrack);
}
