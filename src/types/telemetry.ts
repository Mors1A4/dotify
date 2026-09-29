import { Track, TrackSource } from './track';

export type DeviceType = 'desktop' | 'mobile' | 'web';

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
  durationPlayedMs: number;
  timePlayedMs?: number;
  totalDurationMs: number;
  durationMs?: number;
  completionRate: number; // 0.0 to 1.0
  skipped: boolean;
  completed?: boolean;
  replayed: boolean;
  artworkUrl?: string;
}

export interface GenreAffinityRecord {
  genre: string;
  playCount: number;
  totalTimePlayedMs: number;
  affinityScore: number;
  lastUpdated?: number;
  lastPlayedAt?: number;
}

export interface ArtistAffinityRecord {
  artist: string;
  playCount: number;
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
