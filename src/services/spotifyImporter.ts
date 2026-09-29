import { Track } from '../types/track';
import { SpotifyImportPreview, SpotifyParseResult } from '../types/playlist';
import { usePlayerStore } from '../store/playerStore';
import { getApiUrl } from './apiConfig';
import { upgradeArtworkUrl } from '../utils/artwork';

/**
 * Validates and extracts Spotify entities from URLs and URIs.
 * Supports:
 * - https://open.spotify.com/playlist/{id}?si=...
 * - https://open.spotify.com/album/{id}
 * - https://open.spotify.com/track/{id}
 * - spotify:playlist:{id}
 */
export function validateSpotifyUrl(input: string): SpotifyParseResult {
  if (!input || typeof input !== 'string') {
    return { isValid: false, error: 'Please enter a Spotify URL' };
  }

  const clean = input.trim();
  const isWebUrl = clean.includes('spotify.com');
  const isUri = clean.startsWith('spotify:');

  if (!isWebUrl && !isUri) {
    return { isValid: false, error: 'URL must be a valid open.spotify.com link or spotify: URI' };
  }

  // Extract ID and entity type
  const playlistMatch = clean.match(/(?:playlist\/|playlist:)([a-zA-Z0-9]+)/);
  if (playlistMatch) {
    return {
      isValid: true,
      type: 'playlist',
      id: playlistMatch[1],
      sanitizedUrl: `https://open.spotify.com/playlist/${playlistMatch[1]}`,
    };
  }

  const albumMatch = clean.match(/(?:album\/|album:)([a-zA-Z0-9]+)/);
  if (albumMatch) {
    return {
      isValid: true,
      type: 'album',
      id: albumMatch[1],
      sanitizedUrl: `https://open.spotify.com/album/${albumMatch[1]}`,
    };
  }

  const trackMatch = clean.match(/(?:track\/|track:)([a-zA-Z0-9]+)/);
  if (trackMatch) {
    return {
      isValid: true,
      type: 'track',
      id: trackMatch[1],
      sanitizedUrl: `https://open.spotify.com/track/${trackMatch[1]}`,
    };
  }

  return { isValid: false, error: 'Could not detect a playlist, album, or track in this Spotify link' };
}

/**
 * Ensures resolved Spotify tracks have full API stream URLs, HD 640px artwork, and valid sourceMetadata
 * so playback works seamlessly in both browser and standalone Tauri desktop/mobile builds.
 */
export function normalizeSpotifyTrack(raw: Track, fallbackCover = ''): Track {
  const rawStream = raw.streamUrl || '';
  const streamUrl = rawStream.startsWith('/api/') ? getApiUrl(rawStream) : rawStream;
  return {
    ...raw,
    artworkUrl: upgradeArtworkUrl(raw.artworkUrl || fallbackCover),
    streamUrl,
    sourceMetadata: raw.sourceMetadata || {
      format: 'mp3',
      license: 'Spotify Resolved Stream',
    },
  };
}

/**
 * Resolves a Spotify public link via the backend embed resolver endpoint.
 * Requires zero Spotify API keys or user logins.
 */
export async function fetchSpotifyPreview(url: string): Promise<SpotifyImportPreview> {
  const validation = validateSpotifyUrl(url);
  if (!validation.isValid || !validation.sanitizedUrl) {
    throw new Error(validation.error || 'Invalid Spotify URL');
  }

  const targetUrl = getApiUrl(`/api/spotify/resolve?url=${encodeURIComponent(validation.sanitizedUrl)}`);
  const response = await fetch(targetUrl);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch Spotify playlist (HTTP ${response.status})`);
  }

  const data = await response.json();

  if (data.type === 'track' && data.track) {
    const normalizedTrack = normalizeSpotifyTrack(data.track, data.track.artworkUrl);
    return {
      playlistTitle: `${normalizedTrack.title} - Single`,
      playlistDescription: `Imported Spotify single by ${normalizedTrack.artist}`,
      playlistCoverUrl: upgradeArtworkUrl(normalizedTrack.artworkUrl),
      playlistOwner: normalizedTrack.artist,
      entityType: 'track',
      sourceUrl: validation.sanitizedUrl,
      totalTracks: 1,
      resolvedTracks: [normalizedTrack],
      unresolvedCount: 0,
    };
  }

  const coverUrl = upgradeArtworkUrl(data.artworkUrl || '');
  const rawTracks: Track[] = data.tracks || [];
  const resolvedTracks: Track[] = rawTracks.map((t) => normalizeSpotifyTrack(t, coverUrl));
  const totalTracks = data.trackCount || resolvedTracks.length;

  return {
    playlistTitle: data.title || 'Spotify Playlist',
    playlistDescription: data.description || 'Imported via Dotify Spotify Resolver',
    playlistCoverUrl: coverUrl || resolvedTracks[0]?.artworkUrl || '',
    playlistOwner: data.owner || 'Spotify',
    followers: data.followers,
    entityType: data.type || validation.type || 'playlist',
    sourceUrl: validation.sanitizedUrl,
    totalTracks,
    resolvedTracks,
    unresolvedCount: Math.max(0, totalTracks - resolvedTracks.length),
  };
}

export interface SaveSpotifyPlaylistOptions {
  customName?: string;
  customDescription?: string;
  customCoverUrl?: string;
  tracks?: Track[];
}

/**
 * Saves a resolved Spotify preview directly into Dotify custom playlists.
 */
export function saveSpotifyPlaylistToStore(
  preview: SpotifyImportPreview,
  options?: SaveSpotifyPlaylistOptions
): string {
  const store = usePlayerStore.getState();
  const finalName = (options?.customName ?? preview.playlistTitle).trim() || 'Spotify Playlist';
  const finalDesc =
    options?.customDescription !== undefined
      ? options.customDescription.trim()
      : preview.playlistDescription || 'Imported from Spotify';
  const finalCover = upgradeArtworkUrl(options?.customCoverUrl ?? preview.playlistCoverUrl ?? '');
  const finalTracks = (options?.tracks ?? preview.resolvedTracks).map((t) => ({
    ...t,
    artworkUrl: upgradeArtworkUrl(t.artworkUrl),
  }));

  const playlistId = store.importCustomPlaylist({
    name: finalName,
    description: finalDesc,
    coverArt: finalCover,
    sourceSpotifyUrl: preview.sourceUrl,
    tracks: finalTracks,
  });

  return playlistId;
}
