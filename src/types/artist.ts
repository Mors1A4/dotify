import { Track } from './track';

/**
 * Summary metadata for an artist's album or single release.
 */
export interface AlbumSummary {
  id: string;
  title: string;
  coverUrl?: string;
  artworkUrl?: string; // Backwards-compatible alias for coverUrl
  releaseYear?: string | number;
  trackCount?: number;
  recordType?: 'album' | 'single' | 'ep' | 'compilation';
  tracks?: Track[];
}

/**
 * Summary for a related artist displayed in "Fans Also Like".
 */
export interface RelatedArtist {
  id: string;
  name: string;
  imageUrl?: string;
  avatarUrl?: string; // Backwards-compatible alias for imageUrl
  genres?: string[];
  similarityScore?: number; // 0.0 to 1.0
  trackCount?: number;
}

/**
 * Complete Artist Profile data contract.
 */
export interface ArtistProfile {
  id: string;
  name: string;
  bio?: string;
  imageUrl?: string;
  avatarUrl?: string; // Backwards-compatible alias
  bannerUrl?: string;
  monthlyListeners?: number;
  genres: string[];
  topTracks: Track[];
  albums: AlbumSummary[];
  discography: Track[];
  singlesAndEPs?: AlbumSummary[];
  relatedArtists: RelatedArtist[];
  isSynthetic?: boolean;
  externalLinks?: {
    deezer?: string;
    audius?: string;
    archive?: string;
    radio?: string;
  };
}

/**
 * Configuration for the algorithmic Artist Radio generation.
 */
export interface ArtistRadioConfig {
  artistId: string;
  artistName: string;
  anchorRatio?: number; // default 0.40
  relatedRatio?: number; // default 0.35
  discoveryRatio?: number; // default 0.25
  length?: number; // default 25
}

/**
 * Persisted record for a user-followed artist.
 */
export interface FollowedArtist {
  id: string;
  name: string;
  imageUrl?: string;
  genres?: string[];
  followedAt: number;
}
