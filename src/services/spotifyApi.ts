import { Track } from '../types/track';
import { getApiUrl } from './apiConfig';
import { normalizeSpotifyTrack } from './spotifyImporter';

export interface SpotifyResolutionResult {
  type: 'track' | 'playlist' | 'album';
  track?: Track;
  title?: string;
  description?: string;
  owner?: string;
  artworkUrl?: string;
  trackCount?: number;
  tracks?: Track[];
}

export function isSpotifyLink(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return lower.includes('open.spotify.com/') || lower.startsWith('spotify:');
}

export async function resolveSpotifyUrl(url: string): Promise<SpotifyResolutionResult> {
  const res = await fetch(getApiUrl(`/api/spotify/resolve?url=${encodeURIComponent(url.trim())}`));
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to resolve Spotify link (${res.status})`);
  }
  const data: SpotifyResolutionResult = await res.json();
  if (data.track) {
    data.track = normalizeSpotifyTrack(data.track, data.track.artworkUrl);
  }
  if (data.tracks) {
    data.tracks = data.tracks.map((t) => normalizeSpotifyTrack(t, data.artworkUrl));
  }
  return data;
}
