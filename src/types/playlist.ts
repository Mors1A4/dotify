import { Track } from './track';

export interface CustomPlaylist {
  id: string;
  name: string;
  description?: string;
  coverArt?: string;
  createdAt: number;
  updatedAt: number;
  isPinned?: boolean;
  sourceSpotifyUrl?: string;
  tracks: Track[];
}

export interface SpotifyImportPreview {
  playlistTitle: string;
  playlistDescription?: string;
  playlistCoverUrl?: string;
  playlistOwner?: string;
  followers?: number;
  entityType?: 'playlist' | 'album' | 'track';
  sourceUrl?: string;
  totalTracks: number;
  resolvedTracks: Track[];
  unresolvedCount: number;
}

export interface SpotifyParseResult {
  isValid: boolean;
  type?: 'playlist' | 'album' | 'track';
  id?: string;
  sanitizedUrl?: string;
  error?: string;
}
