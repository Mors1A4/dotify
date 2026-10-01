import React, { useEffect, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { fetchAlbumTracks } from '../../services/chartsApi';
import { artistService } from '../../services/artistService';
import { Track } from '../../types/track';
import { TrackTable } from '../common/TrackTable';
import {
  Play,
  Shuffle,
  Plus,
  Check,
  ArrowLeft,
  Clock,
  Disc3,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import {
  DEFAULT_MUSIC_ARTWORK,
  getTrackArtwork,
  isUglyPlaceholder,
  resolveTrackArtwork,
} from '../../services/artworkService';

export const AlbumView: React.FC = () => {
  const {
    selectedAlbum,
    navigateBack,
    playTrack,
    navigateToArtist,
    addAlbumToLibrary,
    removeAlbumFromLibrary,
    isAlbumInLibrary,
  } = usePlayerStore();

  const [tracks, setTracks] = useState<Track[]>(selectedAlbum?.tracks || []);
  const [isLoading, setIsLoading] = useState(false);
  const [inLibrary, setInLibrary] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedAlbum) return;

    const mainEl = document.getElementById('content');
    if (mainEl) mainEl.scrollTop = 0;

    setInLibrary(isAlbumInLibrary(selectedAlbum.title));

    // If album already has tracks passed in, use them
    if (selectedAlbum.tracks && selectedAlbum.tracks.length > 0) {
      setTracks(selectedAlbum.tracks);
      return;
    }
    setTracks([]);

    let isMounted = true;
    async function loadTracks() {
      setIsLoading(true);
      try {
        let loadedTracks: Track[] = [];
        const numericId = Number(selectedAlbum!.id);

        if (!isNaN(numericId) && numericId > 0) {
          loadedTracks = await fetchAlbumTracks(
            numericId,
            selectedAlbum!.title,
            selectedAlbum!.coverUrl
          );
        } else {
          loadedTracks = await artistService.getAlbumTracks(
            String(selectedAlbum!.id),
            selectedAlbum!.title,
            selectedAlbum!.coverUrl,
            selectedAlbum!.artist
          );
        }

        if (isMounted) {
          setTracks(loadedTracks);
        }
      } catch (err) {
        console.warn('[AlbumView] Failed to load album tracks:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadTracks();
    return () => {
      isMounted = false;
    };
  }, [selectedAlbum?.id, selectedAlbum?.title]);

  if (!selectedAlbum) {
    return (
      <div className="p-8 text-center text-muted flex flex-col items-center justify-center min-h-[50vh]">
        <Disc3 size={48} className="opacity-40 mb-3" />
        <h2 className="text-xl font-bold text-primary">No Album Selected</h2>
        <button
          onClick={navigateBack}
          className="mt-4 px-4 py-2 rounded-full bg-elevated text-xs text-primary font-bold hover:bg-highlight transition-colors"
        >
          Go Back
        </button>
      </div>
    );
  }

  const handlePlayAll = () => {
    if (tracks.length > 0) {
      playTrack(tracks[0], tracks, 0, {
        origin: 'song',
        albumTitle: selectedAlbum?.title,
        artistName: selectedAlbum?.artist,
      });
    }
  };

  const handleShufflePlay = () => {
    if (tracks.length > 0) {
      const shuffled = [...tracks].sort(() => Math.random() - 0.5);
      playTrack(shuffled[0], shuffled, 0, {
        origin: 'song',
        albumTitle: selectedAlbum?.title,
        artistName: selectedAlbum?.artist,
      });
    }
  };

  const handleToggleLibrary = () => {
    if (!selectedAlbum) return;

    if (inLibrary) {
      removeAlbumFromLibrary(selectedAlbum.title);
      setInLibrary(false);
      setToastMsg(`Removed "${selectedAlbum.title}" from library`);
      setTimeout(() => setToastMsg(null), 3000);
    } else {
      addAlbumToLibrary(selectedAlbum, tracks);
      setInLibrary(true);
      setToastMsg(`Saved "${selectedAlbum.title}" to library playlists!`);
      setTimeout(() => setToastMsg(null), 3000);
    }
  };

  const totalDuration = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  const formattedDuration = `${Math.floor(totalDuration / 60)} min`;

  return (
    <div data-testid="album-view" className="p-4 md:p-8 flex flex-col gap-6 pb-32 animate-in fade-in duration-200">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed top-16 right-4 z-50 bg-accent text-accent-content font-bold text-xs px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 size={14} />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Back Button */}
      <div>
        <button
          onClick={navigateBack}
          className="flex items-center gap-2 text-xs font-bold text-secondary hover:text-primary transition-colors p-1 -ml-1 rounded-lg"
        >
          <ArrowLeft size={16} />
          <span>Back</span>
        </button>
      </div>

      {/* Album Hero Header (Playlist Style) */}
      <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 p-6 rounded-2xl bg-gradient-to-b from-surface via-surface/90 to-elevated border border-customBorder shadow-2xl">
        <div className="w-44 h-44 sm:w-52 sm:h-52 rounded-2xl overflow-hidden shadow-2xl border border-customBorder/80 bg-highlight shrink-0">
          <img
            src={getTrackArtwork({
              artist: selectedAlbum.artist,
              title: selectedAlbum.title,
              artworkUrl: selectedAlbum.coverUrl || tracks[0]?.artworkUrl,
            })}
            alt={selectedAlbum.title}
            className="w-full h-full object-cover"
            onError={(e) => {
              const target = e.currentTarget;
              if (target.src !== DEFAULT_MUSIC_ARTWORK) {
                target.src = DEFAULT_MUSIC_ARTWORK;
                resolveTrackArtwork(selectedAlbum.artist, selectedAlbum.title).then((url) => {
                  if (url && !isUglyPlaceholder(url)) target.src = url;
                });
              }
            }}
          />
        </div>

        <div className="flex-1 flex flex-col items-center sm:items-start text-center sm:text-left min-w-0">
          <span className="text-xs font-bold text-accent uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-accent/20 border border-accent/30 mb-2">
            {selectedAlbum.recordType ? selectedAlbum.recordType.toUpperCase() : 'ALBUM'}
          </span>

          <h1 className="text-2xl sm:text-4xl font-extrabold text-primary tracking-tight truncate w-full">
            {selectedAlbum.title}
          </h1>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5 mt-2 text-xs text-secondary font-medium">
            <span
              onClick={() => navigateToArtist(selectedAlbum.artist)}
              className="text-primary font-bold hover:underline cursor-pointer"
            >
              {selectedAlbum.artist}
            </span>
            {selectedAlbum.year && <span>• {selectedAlbum.year}</span>}
            <span>• {tracks.length} {tracks.length === 1 ? 'song' : 'songs'}</span>
            {totalDuration > 0 && <span>• {formattedDuration}</span>}
          </div>

          {/* Action Row */}
          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={handlePlayAll}
              disabled={tracks.length === 0}
              className="flex items-center gap-2 px-6 py-3 rounded-full bg-accent text-accent-content font-bold text-sm shadow-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
            >
              <Play size={18} fill="currentColor" />
              <span>Play All</span>
            </button>

            <button
              onClick={handleShufflePlay}
              disabled={tracks.length === 0}
              className="flex items-center gap-2 px-4 py-3 rounded-full bg-elevated hover:bg-highlight border border-customBorder text-primary font-bold text-xs shadow transition-all active:scale-95 disabled:opacity-50"
              title="Shuffle Album"
            >
              <Shuffle size={16} />
              <span className="hidden sm:inline">Shuffle</span>
            </button>

            <button
              onClick={handleToggleLibrary}
              disabled={tracks.length === 0}
              className={`flex items-center gap-2 px-4 py-3 rounded-full text-xs font-bold transition-all shadow active:scale-95 disabled:opacity-50 ${
                inLibrary
                  ? 'bg-accent/20 border border-accent text-accent hover:bg-accent/30'
                  : 'bg-elevated hover:bg-highlight border border-customBorder text-secondary hover:text-primary'
              }`}
              title={inLibrary ? 'Remove from Library' : 'Save album to library playlists'}
            >
              {inLibrary ? (
                <>
                  <Check size={16} className="text-accent" />
                  <span>In Library</span>
                </>
              ) : (
                <>
                  <Plus size={16} />
                  <span>Add to Library</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Track List */}
      <div className="flex flex-col gap-2">
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3 text-secondary">
            <Loader2 size={28} className="animate-spin text-accent" />
            <span className="text-xs font-medium">Loading album tracks...</span>
          </div>
        ) : tracks.length > 0 ? (
          <TrackTable tracks={tracks} showAlbum={false} showTrackNumber={true} playOrigin="song" />
        ) : (
          <div className="py-12 text-center text-xs text-muted bg-surface rounded-2xl border border-customBorder p-8">
            No streamable tracks found for this release.
          </div>
        )}
      </div>
    </div>
  );
};
