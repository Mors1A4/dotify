export type TrackSource = 'audius' | 'archive' | 'radio' | 'p2p' | 'charts';

export interface Track {
  id: string; // Globally unique: `audius:${id}` | `archive:${id}` | `radio:${stationuuid}` | `p2p:${infoHash}:${fileIndex}`
  source: TrackSource;
  title: string;
  artist: string;
  album?: string;
  duration: number; // In seconds. Live radio is Infinity or 0.
  streamUrl: string; // Direct audio URL or proxy URL
  artworkUrl?: string; // HTTPS image URL or SVG data-URI
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
    previewUrl?: string;
    fallbackUrl?: string;
    vibe?: string;
    communityArtist?: string;
    communityReason?: string;
    listenerCount?: number;
    [key: string]: any;
  };
}
