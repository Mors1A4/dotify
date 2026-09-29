import { Track } from './track';
import { CustomPlaylist } from './playlist';

export type VibeCategory = 'gaming' | 'working' | 'partying' | 'chilling' | 'workout';

export type MacroGenre =
  | 'Electronic & Dance'
  | 'Hip-Hop & Urban'
  | 'Rock & Alternative'
  | 'Pop & Anthems'
  | 'Chill & Lo-Fi'
  | 'Acoustic & Folk'
  | 'Jazz & Soul'
  | 'Classical & Cinematic';

export interface GenreGroupAffinity {
  group: MacroGenre;
  affinityScore: number; // 0 to 100
  playCount: number;
  totalTimePlayedMs: number;
  percentage: number; // 0.0 to 100.0
  topSubgenres: string[];
  sampleArtists: string[];
}

export interface UserTasteProfile {
  topGenreGroups: GenreGroupAffinity[];
  dominantGenre: MacroGenre | string;
  topArtists: { name: string; playCount: number; genreGroup?: string }[];
  topTracks: { title: string; artist: string; playCount: number }[];
  totalPlays: number;
  totalListeningTimeMs: number;
  isColdStart: boolean;
  summaryText: string;
}

export interface VibePlaylistTrack extends Track {
  vibeReason?: string;
  isWebDiscovery?: boolean;
}

export interface DailyVibePlaylist extends CustomPlaylist {
  vibe: VibeCategory;
  vibeLabel: string;
  vibeIcon: string;
  vibeTagline: string;
  themeGradient: string;
  accentColor: string;
  generatedDate: string; // YYYY-MM-DD
  isAIGenerated: boolean;
  modelUsed?: string;
  tracks: VibePlaylistTrack[];
}

export interface DailyVibesCache {
  date: string; // YYYY-MM-DD
  accountId: string;
  generatedAt: number;
  playlists: DailyVibePlaylist[];
  tasteProfileSummary?: string;
}
