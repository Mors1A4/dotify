import { Track, TrackSource } from './track';

export type DeviceType = 'desktop' | 'mobile' | 'web';

export type PlayOrigin =
  | 'search'          // User searched for track/artist and clicked to play
  | 'artist'          // User clicked on artist (artist profile, artist top songs, album by artist)
  | 'song'            // User explicitly clicked directly on the song row
  | 'library'         // User played from library or Liked Songs
  | 'user_playlist'   // User played from a custom/saved playlist
  | 'vibe_playlist'   // User played from a daily/gemini/custom vibe playlist
  | 'vibe_dj'         // Live Vibe DJ sequential stream
  | 'discover_track'  // User played a discovery track / break / echo
  | 'discover_weekly' // User played from Discover Weekly shelf
  | 'autoplay'        // Autoplay queue exhaustion continuation
  | 'radio'           // Artist radio or genre station
  | 'recommendation'  // Played from Daily Mix, Heavy Rotation, Forgotten Favorites, Community
  | 'charts'          // Played from top charts / explore
  | 'unknown';        // Legacy or unclassified

export type PlayIntent = 'favoured' | 'exploratory';

export interface UserListeningContext {
  likedTrackIds?: Set<string>;
  followedArtists?: Set<string>;
  followedArtistNames?: Set<string>;
  userPlaylistTrackIds?: Set<string>;
  playlistTrackIds?: Set<string>;
  vibePlaylistTrackIds?: Set<string>;
  searchHistoryQueries?: string[];
}

export interface PlayContext {
  origin: PlayOrigin;
  intent?: PlayIntent;
  searchQuery?: string;
  artistName?: string;
  playlistId?: string;
  playlistName?: string;
  albumTitle?: string;
  isDj?: boolean;
}

export interface ListeningSessionRecord {
  sessionId: string;
  startTime: number;
  startedAt?: number;
  endTime?: number;
  endedAt?: number;
  lastActiveAt?: number;
  deviceType: DeviceType;
  tracksPlayed?: number;
  totalPlayTimeMs?: number;
  totalDurationMs: number;
}

export interface TrackPlayRecord {
  playId: string;
  id?: string;
  sessionId: string;
  trackId: string;
  title: string;
  artist: string;
  genre?: string;
  source: TrackSource;
  startTime: number;
  playedAt?: number;
  durationPlayedMs: number;
  timePlayedMs?: number;
  totalDurationMs: number;
  durationMs?: number;
  completionRate: number; // 0.0 to 1.0
  skipped: boolean;
  completed?: boolean;
  replayed: boolean;
  userLiked?: boolean;
  artworkUrl?: string;

  // Origin & Intent classification
  origin?: PlayOrigin;
  intent?: PlayIntent;
  intentWeight?: number; // 1.0 for favoured, 0.05-0.2 for exploratory/skipped
  searchQuery?: string;
  contextMetadata?: {
    playlistId?: string;
    playlistName?: string;
    artistName?: string;
    albumTitle?: string;
  };
}

export interface GenreAffinityRecord {
  genre: string;
  playCount: number;
  favouredPlayCount?: number;
  passivePlayCount?: number;
  totalTimePlayedMs: number;
  affinityScore: number;
  lastUpdated?: number;
  lastPlayedAt?: number;
}

export interface ArtistAffinityRecord {
  artist: string;
  playCount: number;
  favouredPlayCount?: number;
  passivePlayCount?: number;
  totalTimePlayedMs: number;
  affinityScore: number;
  lastUpdated?: number;
  lastPlayedAt?: number;
}

export interface ExportableTelemetryDataset {
  schemaVersion?: 1;
  version?: 1;
  exportedAt: number | string;
  sessions: ListeningSessionRecord[];
  plays: TrackPlayRecord[];
  genreAffinities: GenreAffinityRecord[];
  artistAffinities?: ArtistAffinityRecord[];
}
