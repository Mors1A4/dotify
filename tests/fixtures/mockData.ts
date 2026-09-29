import { SILENT_WAV_BASE64 } from './mockAudio';

export type TrackSource = 'audius' | 'archive' | 'radio' | 'p2p';

export interface Track {
  id: string;
  source: TrackSource;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  streamUrl: string;
  artworkUrl?: string;
  sourceMetadata: {
    genre?: string;
    year?: string;
    bitrate?: number;
    format?: 'mp3' | 'aac' | 'flac' | 'ogg';
    license?: string;
    stationCountry?: string;
    stationCodec?: string;
    infoHash?: string;
    fileIndex?: number;
    fileName?: string;
    fileSize?: number;
  };
}

export const MOCK_AUDIUS_TRACK: Track = {
  id: 'audius:mock-track-1',
  source: 'audius',
  title: 'Neon Odyssey',
  artist: 'Synthetic Pulse',
  album: 'Cyber Dreams',
  duration: 180,
  streamUrl: SILENT_WAV_BASE64,
  artworkUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%231DB954"/></svg>',
  sourceMetadata: {
    genre: 'Electronic',
    year: '2024',
    bitrate: 320,
    format: 'mp3',
  },
};

export const MOCK_ARCHIVE_TRACK: Track = {
  id: 'archive:mock-concert-1',
  source: 'archive',
  title: 'Live at Red Rocks 1978 - Track 01',
  artist: 'Grateful Dead',
  album: 'Live at Red Rocks Amphitheatre',
  duration: 420,
  streamUrl: SILENT_WAV_BASE64,
  artworkUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%23e74c3c"/></svg>',
  sourceMetadata: {
    genre: 'Rock',
    year: '1978',
    format: 'mp3',
    license: 'Public Domain',
  },
};

export const MOCK_RADIO_TRACK: Track = {
  id: 'radio:mock-station-1',
  source: 'radio',
  title: 'Chillout Lounge FM',
  artist: 'Live Radio Stream',
  album: 'Global Stations',
  duration: Infinity, // Live continuous radio stream
  streamUrl: SILENT_WAV_BASE64,
  artworkUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%233498db"/></svg>',
  sourceMetadata: {
    genre: 'Ambient',
    stationCountry: 'Germany',
    stationCodec: 'MP3',
    bitrate: 192,
  },
};

export const MOCK_P2P_TRACK: Track = {
  id: 'p2p:0123456789abcdef0123456789abcdef01234567:0',
  source: 'p2p',
  title: 'Open Source Symphonics.flac',
  artist: 'Open Source Collective',
  album: 'BitTorrent Audio Pack',
  duration: 240,
  streamUrl: SILENT_WAV_BASE64,
  artworkUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="%239b59b6"/></svg>',
  sourceMetadata: {
    infoHash: '0123456789abcdef0123456789abcdef01234567',
    fileIndex: 0,
    fileName: 'Open Source Symphonics.flac',
    fileSize: 34567890,
    format: 'flac',
  },
};

export const MOCK_ALL_TRACKS: Track[] = [
  MOCK_AUDIUS_TRACK,
  MOCK_ARCHIVE_TRACK,
  MOCK_RADIO_TRACK,
  MOCK_P2P_TRACK,
];

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const THEME_PRESETS = [
  'spotify-oled',
  'nord-frost',
  'cyberpunk-neon',
  'retro-winamp',
  'rose-pine',
] as const;

export const EQ_PRESETS = [
  'flat',
  'bass-boost',
  'vocal',
  'rock',
  'electronic',
  'custom',
] as const;
