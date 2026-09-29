import React from 'react';
import { Track } from '../../types/track';
import { upgradeArtworkUrl, extractMosaicQuadrants } from '../../utils/artwork';
import { ListMusic } from 'lucide-react';

export interface PlaylistArtworkProps {
  coverArt?: string | null;
  tracks?: Track[];
  alt?: string;
  className?: string;
  iconSize?: number;
}

export const PlaylistArtwork: React.FC<PlaylistArtworkProps> = ({
  coverArt,
  tracks = [],
  alt = 'Playlist cover',
  className = 'w-full h-full object-cover',
  iconSize = 28,
}) => {
  const cleanCover = coverArt ? upgradeArtworkUrl(coverArt) : '';

  // 1. If cover is a Spotify 2x2 mosaic, extract the 4 individual 640px HD master covers
  // to render a crisp 1280x1280 2x2 grid instead of a compressed/blurry mosaic thumbnail.
  const mosaicQuadrants = cleanCover ? extractMosaicQuadrants(cleanCover) : null;
  if (mosaicQuadrants && mosaicQuadrants.length === 4) {
    return (
      <div className="grid grid-cols-2 grid-rows-2 w-full h-full overflow-hidden select-none bg-highlight">
        {mosaicQuadrants.map((url, idx) => (
          <img
            key={idx}
            src={url}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ))}
      </div>
    );
  }

  // 2. If an explicit cover image or SVG preset is provided, render it in full HD
  if (cleanCover) {
    return (
      <img
        src={cleanCover}
        alt={alt}
        loading="lazy"
        className={className}
      />
    );
  }

  // 3. Fallback: generate a 2x2 collage from the first 4 distinct track artworks
  const distinctArtworks = Array.from(
    new Set(
      tracks
        .map((t) => t.artworkUrl ? upgradeArtworkUrl(t.artworkUrl) : '')
        .filter(Boolean)
    )
  ).slice(0, 4);

  if (distinctArtworks.length >= 4) {
    return (
      <div className="grid grid-cols-2 grid-rows-2 w-full h-full overflow-hidden select-none bg-highlight">
        {distinctArtworks.map((url, idx) => (
          <img
            key={idx}
            src={url}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ))}
      </div>
    );
  }

  // 4. Single track artwork fallback
  if (distinctArtworks.length > 0) {
    return (
      <img
        src={distinctArtworks[0]}
        alt={alt}
        loading="lazy"
        className={className}
      />
    );
  }

  // 5. Default Dotify gradient
  return (
    <div className="w-full h-full bg-gradient-to-br from-indigo-900/60 to-purple-900/60 flex items-center justify-center text-accent select-none">
      <ListMusic size={iconSize} className="opacity-80" />
    </div>
  );
};
