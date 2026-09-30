import React from 'react';
import { Track } from '../../types/track';
import { usePlayerStore } from '../../store/playerStore';
import { Play, Heart, Clock, MoreVertical, Plus, ListMusic } from 'lucide-react';
import {
  getTrackArtwork,
  resolveTrackArtwork,
  DEFAULT_MUSIC_ARTWORK,
  isUglyPlaceholder,
} from '../../services/artworkService';
import { SaveMp3Button } from './SaveMp3Button';
import { prewarmCandidate } from '../../services/youtubeResolver';

export interface TrackTableProps {
  tracks: Track[];
  showArtwork?: boolean;
  showAlbum?: boolean;
  showSource?: boolean;
  showTrackNumber?: boolean;
  onPlayTrack?: (track: Track, queue: Track[]) => void;
  showActions?: boolean;
}

export const TrackTable: React.FC<TrackTableProps> = ({
  tracks,
  showArtwork = true,
  showAlbum = true,
  showSource = false,
  showTrackNumber = true,
  onPlayTrack,
  showActions = true,
}) => {
  const {
    currentTrack,
    playTrack,
    toggleLike,
    isLiked,
    navigateToArtist,
    navigateToAlbum,
    playNext,
    addToEnd,
    playlists,
    addTrackToPlaylist,
    openCreatePlaylistModal,
  } = usePlayerStore();

  const [activeMenuIndex, setActiveMenuIndex] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (tracks && tracks.length > 0) {
      const topTracks = tracks.slice(0, 3);
      for (const t of topTracks) {
        if (t.artist && t.title) {
          prewarmCandidate(t.artist, t.title, t.duration);
        }
      }
    }
  }, [tracks]);

  const handlePlay = (track: Track) => {
    if (onPlayTrack) {
      onPlayTrack(track, tracks);
    } else {
      playTrack(track, tracks);
    }
  };

  const formatDuration = (sec: number) => {
    if (!sec || !isFinite(sec)) return 'LIVE';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="flex flex-col gap-1 w-full" onClick={() => setActiveMenuIndex(null)}>
      {/* Table Header */}
      <div className="grid grid-cols-12 px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider border-b border-customBorder/50">
        {showTrackNumber && <span className="col-span-1">#</span>}
        <span className={showAlbum ? 'col-span-7 sm:col-span-5' : 'col-span-8 sm:col-span-8'}>Title</span>
        {showAlbum && <span className="hidden sm:block sm:col-span-4">Album</span>}
        <span className="col-span-4 sm:col-span-2 text-right">
          <Clock size={13} className="inline ml-auto" />
        </span>
      </div>

      {/* Table Rows */}
      <div className="flex flex-col gap-0.5 mt-1">
        {tracks.map((track, idx) => {
          const isCurrent = currentTrack?.id === track.id;
          const isMenuOpen = activeMenuIndex === idx;

          return (
            <div
              key={`${track.id}-${idx}`}
              data-testid="track-item"
              onClick={() => handlePlay(track)}
              onMouseEnter={() => {
                if (track.artist && track.title) {
                  prewarmCandidate(track.artist, track.title, track.duration);
                }
              }}
              onPointerDown={() => {
                if (track.artist && track.title) {
                  prewarmCandidate(track.artist, track.title, track.duration);
                }
              }}
              className={`group relative grid grid-cols-12 items-center px-4 py-2.5 rounded-lg transition-colors cursor-pointer ${
                isCurrent ? 'bg-elevated' : 'hover:bg-elevated/50'
              }`}
            >
              {/* Track Number / Play Button */}
              {showTrackNumber && (
                <div className="col-span-1 text-xs text-muted flex items-center">
                  <span className="group-hover:hidden">{idx + 1}</span>
                  <span className="hidden group-hover:block text-accent">
                    <Play size={14} fill="currentColor" />
                  </span>
                </div>
              )}

              {/* Title & Artist */}
              <div
                className={`${
                  showAlbum ? 'col-span-7 sm:col-span-5' : 'col-span-8 sm:col-span-8'
                } flex items-center gap-3 min-w-0 pr-2`}
              >
                {showArtwork && (
                  <img
                    src={getTrackArtwork(track)}
                    alt={track.title}
                    className="w-10 h-10 rounded object-cover flex-shrink-0 bg-highlight"
                    onError={(e) => {
                      const target = e.currentTarget;
                      if (target.src !== DEFAULT_MUSIC_ARTWORK) {
                        target.src = DEFAULT_MUSIC_ARTWORK;
                        resolveTrackArtwork(track.artist, track.title).then((url) => {
                          if (url && !isUglyPlaceholder(url)) target.src = url;
                        });
                      }
                    }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p
                    data-testid="track-title"
                    className={`text-sm font-semibold truncate ${
                      isCurrent ? 'text-accent' : 'text-primary'
                    }`}
                  >
                    {track.title}
                  </p>
                  <p className="text-xs text-secondary truncate">
                    <span
                      data-testid="track-artist-link"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigateToArtist(track.artist);
                      }}
                      className="hover:underline hover:text-primary cursor-pointer transition-colors"
                    >
                      {track.artist}
                    </span>
                  </p>
                </div>
              </div>

              {/* Album */}
              {showAlbum && (
                <span className="hidden sm:block sm:col-span-4 text-xs text-muted truncate pr-2">
                  {track.album ? (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        navigateToAlbum({
                          id: track.album!,
                          title: track.album!,
                          artist: track.artist,
                          coverUrl: track.artworkUrl,
                        });
                      }}
                      className="hover:underline hover:text-primary cursor-pointer transition-colors"
                      title={`View album: ${track.album}`}
                    >
                      {track.album}
                    </span>
                  ) : (
                    track.artist
                  )}
                </span>
              )}

              {/* Actions & Duration */}
              <div className="col-span-4 sm:col-span-2 flex items-center justify-end gap-1.5 text-xs font-mono text-muted">
                <SaveMp3Button track={track} size={15} />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLike(track);
                  }}
                  className="p-1 text-secondary hover:text-accent transition-colors"
                  title={isLiked(track.id) ? 'Unlike' : 'Like'}
                >
                  <Heart
                    size={15}
                    className={isLiked(track.id) ? 'text-accent fill-accent' : ''}
                  />
                </button>

                {showActions && (
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuIndex(isMenuOpen ? null : idx);
                      }}
                      className="p-1 text-secondary hover:text-primary transition-colors"
                      title="More options"
                    >
                      <MoreVertical size={14} />
                    </button>

                    {isMenuOpen && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 top-full mt-1 z-30 w-48 bg-elevated border border-customBorder rounded-xl shadow-2xl py-1.5 text-xs text-primary font-sans flex flex-col"
                      >
                        <button
                          onClick={() => {
                            playNext(track);
                            setActiveMenuIndex(null);
                          }}
                          className="px-3 py-1.5 text-left hover:bg-highlight flex items-center gap-2 cursor-pointer"
                        >
                          <Plus size={12} />
                          <span>Play Next</span>
                        </button>
                        <button
                          onClick={() => {
                            addToEnd(track);
                            setActiveMenuIndex(null);
                          }}
                          className="px-3 py-1.5 text-left hover:bg-highlight flex items-center gap-2 cursor-pointer"
                        >
                          <Plus size={12} />
                          <span>Add to Queue</span>
                        </button>

                        <div className="border-t border-customBorder/50 my-1 pt-1">
                          <span className="px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted block">
                            Add to Playlist
                          </span>
                          {playlists.slice(0, 5).map((pl) => (
                            <button
                              key={pl.id}
                              onClick={() => {
                                addTrackToPlaylist(pl.id, track);
                                setActiveMenuIndex(null);
                              }}
                              className="w-full px-3 py-1.5 text-left hover:bg-highlight flex items-center gap-2 truncate cursor-pointer"
                            >
                              <ListMusic size={12} className="text-accent shrink-0" />
                              <span className="truncate">{pl.name}</span>
                            </button>
                          ))}
                          <button
                            onClick={() => {
                              setActiveMenuIndex(null);
                              openCreatePlaylistModal('custom', [track]);
                            }}
                            className="w-full px-3 py-1.5 text-left hover:bg-highlight flex items-center gap-2 text-accent font-semibold cursor-pointer"
                          >
                            <Plus size={12} />
                            <span>New Playlist with Song</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <span>{formatDuration(track.duration)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
