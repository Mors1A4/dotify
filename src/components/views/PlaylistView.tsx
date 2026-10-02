import React, { useState, useEffect, useRef } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { useAuthStore } from '../../store/authStore';
import { PLAYLIST_COVER_PRESETS } from '../modals/CreatePlaylistModal';
import { PlaylistArtwork } from '../common/PlaylistArtwork';
import { upgradeArtworkUrl } from '../../utils/artwork';
import { fetchTopCharts, searchCharts } from '../../services/chartsApi';
import { fetchSpotifyPreview } from '../../services/spotifyImporter';
import { Track } from '../../types/track';
import { PlayOrigin } from '../../types/telemetry';
import {
  getTrackArtwork,
  resolveTrackArtwork,
  DEFAULT_MUSIC_ARTWORK,
  isUglyPlaceholder,
} from '../../services/artworkService';
import { dailyVibeManager } from '../../services/dailyVibeManager';
import { SaveMp3Button } from '../common/SaveMp3Button';
import {
  Play,
  Pause,
  Shuffle,
  Trash2,
  Edit2,
  Check,
  X,
  ArrowLeft,
  Clock,
  Heart,
  ListMusic,
  ChevronUp,
  ChevronDown,
  Wand2,
  Copy,
  Download,
  Search,
  Plus,
  Upload,
  Link2,
  Loader2,
  CheckCircle2,
  Music,
  Cpu,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

export const PlaylistView: React.FC = () => {
  const {
    selectedPlaylistId,
    playlists,
    likedTracks,
    currentTrack,
    isPlaying,
    togglePlay,
    navigateBack,
    playTrack,
    updatePlaylistDetails,
    deletePlaylist,
    reorderPlaylistTracks,
    removeTrackFromPlaylist,
    addTrackToPlaylist,
    addTracksToPlaylist,
    toggleLike,
    isLiked,
    navigateToArtist,
    navigateToAlbum,
  } = usePlayerStore();

  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCoverArt, setEditCoverArt] = useState('');
  const [showCoverUrlInput, setShowCoverUrlInput] = useState(false);

  // Track filter inside playlist
  const [trackFilter, setTrackFilter] = useState('');

  // Inline Spotify Append Importer
  const [showSpotifyAppender, setShowSpotifyAppender] = useState(false);
  const [spotifyAppendUrl, setSpotifyAppendUrl] = useState('');
  const [isAppendingSpotify, setIsAppendingSpotify] = useState(false);
  const [spotifyAppendError, setSpotifyAppendError] = useState<string | null>(null);

  // Inline Bottom Song Finder ("Let's find something for your playlist")
  const [finderTab, setFinderTab] = useState<'trending' | 'liked' | 'search'>('trending');
  const [finderQuery, setFinderQuery] = useState('');
  const [finderResults, setFinderResults] = useState<Track[]>([]);
  const [trendingCatalog, setTrendingCatalog] = useState<Track[]>([]);
  const [isSearchingFinder, setIsSearchingFinder] = useState(false);

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isRefreshingVibe, setIsRefreshingVibe] = useState(false);
  const [, setRefreshTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const vibePlaylist = selectedPlaylistId ? dailyVibeManager.getVibePlaylistById(selectedPlaylistId) : null;
  const playlist = playlists.find((p) => p.id === selectedPlaylistId) || vibePlaylist || null;
  const libraryPlaylist = playlist
    ? playlists.find(
        (p) => p.id === playlist.id || p.name.trim().toLowerCase() === playlist.name.trim().toLowerCase()
      )
    : null;
  const isPlaylistInLibrary = Boolean(libraryPlaylist);
  const isVibe = Boolean(vibePlaylist || selectedPlaylistId?.startsWith('daily-vibe-'));
  const playlistOrigin: PlayOrigin = isVibe ? 'vibe_playlist' : 'user_playlist';

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2800);
  };

  const handleRefreshCurrentVibe = async () => {
    if (isRefreshingVibe) return;
    setIsRefreshingVibe(true);
    try {
      const user = useAuthStore.getState().user;
      const accountId = user?.uid || 'guest';
      const refreshed = await dailyVibeManager.getDailyVibes(accountId, true);

      if (selectedPlaylistId) {
        const currentVibeKey = selectedPlaylistId.replace(/^daily-vibe-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '');
        const matching = refreshed.find(
          (p) =>
            p.id === selectedPlaylistId ||
            p.vibe === currentVibeKey ||
            p.name.trim().toLowerCase() === playlist?.name.trim().toLowerCase()
        );
        if (matching && matching.id !== selectedPlaylistId && !playlists.some((p) => p.id === selectedPlaylistId)) {
          usePlayerStore.setState({ selectedPlaylistId: matching.id });
        }
      }

      setRefreshTick((t) => t + 1);
      showToast('Refreshed vibe playlist with fresh tracks!');
    } catch (err) {
      console.error('Failed to refresh vibe playlist:', err);
      showToast('Could not refresh vibe right now.');
    } finally {
      setIsRefreshingVibe(false);
    }
  };

  useEffect(() => {
    const mainEl = document.getElementById('content');
    if (mainEl) mainEl.scrollTop = 0;
    setIsEditingDetails(false);
    setTrackFilter('');
    setShowSpotifyAppender(false);
    setSpotifyAppendError(null);
  }, [selectedPlaylistId]);

  // Load trending tracks for the bottom quick-add section
  useEffect(() => {
    let cancelled = false;
    fetchTopCharts(16)
      .then((tracks) => {
        if (!cancelled && Array.isArray(tracks)) {
          setTrendingCatalog(tracks);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced search for bottom song finder
  useEffect(() => {
    const q = finderQuery.trim();
    if (!q) {
      setFinderResults([]);
      if (finderTab === 'search') {
        setFinderTab('trending');
      }
      return;
    }

    setFinderTab('search');
    let cancelled = false;
    setIsSearchingFinder(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchCharts(q, 16);
        if (!cancelled) {
          setFinderResults(res);
        }
      } catch {
        if (!cancelled) setFinderResults([]);
      } finally {
        if (!cancelled) setIsSearchingFinder(false);
      }
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [finderQuery]);

  if (!playlist) {
    return (
      <div
        data-testid="playlist-view"
        className="p-8 text-center text-muted flex flex-col items-center justify-center min-h-[50vh]"
      >
        <ListMusic size={48} className="opacity-40 mb-3" />
        <h2 className="text-xl font-bold text-primary">Playlist Not Found</h2>
        <p className="text-xs text-secondary mt-1">
          This playlist might have been deleted or does not exist.
        </p>
        <button
          onClick={navigateBack}
          className="mt-4 px-4 py-2 rounded-full bg-elevated text-xs text-primary font-bold hover:bg-highlight transition-colors"
        >
          Go Back
        </button>
      </div>
    );
  }

  const openDetailsEditor = () => {
    setEditName(playlist.name);
    setEditDescription(playlist.description || '');
    setEditCoverArt(playlist.coverArt || '');
    setShowCoverUrlInput(false);
    setIsEditingDetails(true);
  };

  const saveDetails = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!editName.trim()) return;
    updatePlaylistDetails(playlist.id, {
      name: editName.trim(),
      description: editDescription.trim(),
      coverArt: editCoverArt.trim() || undefined,
    });
    setIsEditingDetails(false);
    showToast('Playlist details updated');
  };

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setEditCoverArt(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSpotifyAppend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spotifyAppendUrl.trim()) return;
    setIsAppendingSpotify(true);
    setSpotifyAppendError(null);
    try {
      const preview = await fetchSpotifyPreview(spotifyAppendUrl.trim());
      if (preview.resolvedTracks.length > 0) {
        addTracksToPlaylist(playlist.id, preview.resolvedTracks);
        showToast(
          `Added ${preview.resolvedTracks.length} tracks from "${preview.playlistTitle}"`
        );
        setSpotifyAppendUrl('');
        setShowSpotifyAppender(false);
      } else {
        setSpotifyAppendError('No playable tracks found in that Spotify link.');
      }
    } catch (err: any) {
      setSpotifyAppendError(
        err.message || 'Could not resolve Spotify link. Make sure it is a public link.'
      );
    } finally {
      setIsAppendingSpotify(false);
    }
  };

  const handleDeletePlaylist = () => {
    if (!playlist) return;
    const targetId = libraryPlaylist ? libraryPlaylist.id : playlist.id;
    if (confirm(`Are you sure you want to delete playlist "${playlist.name}"?`)) {
      deletePlaylist(targetId);
      navigateBack();
    }
  };

  const isPlaylistCurrentlyPlaying =
    Boolean(currentTrack) &&
    isPlaying &&
    playlist.tracks.some((t) => t.id === currentTrack?.id);

  const handlePlayAll = () => {
    if (playlist.tracks.length === 0) return;
    if (isPlaylistCurrentlyPlaying) {
      togglePlay();
    } else {
      playTrack(playlist.tracks[0], playlist.tracks, 0, {
        origin: playlistOrigin,
        playlistId: playlist.id,
      });
    }
  };

  const handleShufflePlay = () => {
    if (playlist.tracks.length > 0) {
      const shuffled = [...playlist.tracks].sort(() => Math.random() - 0.5);
      playTrack(shuffled[0], shuffled, 0, {
        origin: playlistOrigin,
        playlistId: playlist.id,
      });
    }
  };

  const formatDuration = (sec: number) => {
    if (!sec || !isFinite(sec)) return 'LIVE';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const totalDuration = playlist.tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  const formattedTotalTime =
    totalDuration > 3600
      ? `${Math.floor(totalDuration / 3600)} hr ${Math.floor((totalDuration % 3600) / 60)} min`
      : `${Math.max(1, Math.floor(totalDuration / 60))} min`;

  // Get up to 4 distinct artworks for collage
  const collageArtworks = Array.from(
    new Set(
      playlist.tracks
        .map((t) => t.artworkUrl)
        .filter((url): url is string => Boolean(url))
    )
  ).slice(0, 4);

  const heroBackdropUrl = playlist.coverArt || collageArtworks[0] || '';

  const normalizedFilter = trackFilter.trim().toLowerCase();
  const displayedTracks = playlist.tracks
    .map((track, originalIndex) => ({ track, originalIndex }))
    .filter(({ track }) => {
      if (!normalizedFilter) return true;
      return (
        track.title.toLowerCase().includes(normalizedFilter) ||
        track.artist.toLowerCase().includes(normalizedFilter) ||
        (track.album && track.album.toLowerCase().includes(normalizedFilter))
      );
    });

  const finderPool =
    finderTab === 'search'
      ? finderResults
      : finderTab === 'liked'
      ? likedTracks
      : trendingCatalog;

  return (
    <div
      data-testid="playlist-view"
      className="p-4 md:p-8 flex flex-col gap-6 pb-32 animate-in fade-in duration-200"
    >
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed top-16 right-4 z-50 bg-accent text-accent-content font-bold text-xs px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 size={14} />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Back Button */}
      <div className="flex items-center justify-between">
        <button
          onClick={navigateBack}
          className="flex items-center gap-2 text-xs font-bold text-secondary hover:text-primary transition-colors p-1.5 -ml-1.5 rounded-lg hover:bg-elevated/50 cursor-pointer"
        >
          <ArrowLeft size={16} />
          <span>Back</span>
        </button>
      </div>

      {/* Playlist Hero Header with Ambient Cover Glow */}
      <div className="relative overflow-hidden flex flex-col sm:flex-row items-center sm:items-end gap-6 p-6 sm:p-7 rounded-3xl bg-gradient-to-b from-surface via-surface/95 to-elevated border border-customBorder shadow-2xl">
        {/* Ambient Blurred Artwork Glow */}
        {heroBackdropUrl && (
          <img
            src={heroBackdropUrl}
            alt=""
            aria-hidden="true"
            className="absolute -top-24 -left-24 w-96 h-96 object-cover blur-3xl opacity-20 pointer-events-none select-none scale-125"
          />
        )}

        {/* Cover Art / Collage */}
        <div
          onClick={openDetailsEditor}
          title="Click to edit cover art & details"
          className="group relative w-44 h-44 sm:w-52 sm:h-52 rounded-2xl overflow-hidden shadow-2xl border border-customBorder/80 bg-highlight shrink-0 flex items-center justify-center cursor-pointer z-10"
        >
          <PlaylistArtwork
            coverArt={playlist.coverArt}
            tracks={playlist.tracks}
            alt={playlist.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            iconSize={64}
          />

          {/* Hover Edit Overlay */}
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 text-white">
            <Edit2 size={22} />
            <span className="text-xs font-bold tracking-wide">Edit Cover & Info</span>
          </div>
        </div>

        {/* Metadata */}
        <div className="relative z-10 flex-1 flex flex-col items-center sm:items-start text-center sm:text-left min-w-0">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-2">
            <span className="text-[11px] font-extrabold text-accent uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-accent/15 border border-accent/30">
              PLAYLIST
            </span>
            {((playlist as any)?.isAIGenerated || vibePlaylist) && (
              <span className="text-[11px] font-bold text-accent px-2.5 py-0.5 rounded-full bg-accent/15 border border-accent/30 flex items-center gap-1 shadow-sm">
                <Wand2 size={11} />
                <span>Curated by Gemini 3.8 Flash</span>
              </span>
            )}
            {playlist.sourceSpotifyUrl && (
              <span className="text-[11px] font-bold text-[#1DB954] px-2.5 py-0.5 rounded-full bg-[#1DB954]/15 border border-[#1DB954]/30 flex items-center gap-1">
                <Copy size={11} />
                <span>Cloned 1:1 from Spotify</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 max-w-full group">
            <h1
              onClick={openDetailsEditor}
              className="text-2xl sm:text-4xl md:text-5xl font-extrabold text-primary tracking-tight truncate cursor-pointer hover:text-accent transition-colors"
              title="Click to edit playlist details"
            >
              {playlist.name}
            </h1>
            <button
              onClick={openDetailsEditor}
              className="p-1.5 text-muted hover:text-primary hover:bg-elevated/60 rounded-lg transition-colors cursor-pointer shrink-0"
              title="Edit Playlist Details"
            >
              <Edit2 size={16} />
            </button>
          </div>

          {playlist.description ? (
            <p
              onClick={openDetailsEditor}
              className="text-xs sm:text-sm text-secondary mt-1.5 max-w-xl line-clamp-2 cursor-pointer hover:text-primary transition-colors"
            >
              {playlist.description}
            </p>
          ) : (
            <button
              onClick={openDetailsEditor}
              className="text-xs text-muted hover:text-secondary mt-1 transition-colors cursor-pointer"
            >
              + Add a description...
            </button>
          )}

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5 mt-3 text-xs text-secondary font-medium">
            <span className="text-primary font-bold">Dotify Library</span>
            <span>
              • {playlist.tracks.length}{' '}
              {playlist.tracks.length === 1 ? 'song' : 'songs'}
            </span>
            {totalDuration > 0 && <span>• {formattedTotalTime}</span>}
          </div>

          {/* Action Row */}
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 mt-5">
            <button
              onClick={handlePlayAll}
              disabled={playlist.tracks.length === 0}
              className="flex items-center gap-2 px-6 py-3 rounded-full bg-accent text-accent-content font-extrabold text-sm shadow-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isPlaylistCurrentlyPlaying ? (
                <>
                  <Pause size={18} fill="currentColor" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play size={18} fill="currentColor" />
                  <span>Play</span>
                </>
              )}
            </button>

            <button
              onClick={handleShufflePlay}
              disabled={playlist.tracks.length === 0}
              className="flex items-center gap-2 px-4 py-3 rounded-full bg-elevated hover:bg-highlight border border-customBorder text-primary font-bold text-xs shadow transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              title="Shuffle Playlist"
            >
              <Shuffle size={15} />
              <span>Shuffle</span>
            </button>

            {vibePlaylist && (
              <button
                onClick={() => {
                  if (isPlaylistInLibrary && libraryPlaylist) {
                    if (confirm(`Remove "${libraryPlaylist.name}" from your library?`)) {
                      deletePlaylist(libraryPlaylist.id);
                      showToast('Removed playlist from your library');
                    }
                  } else {
                    dailyVibeManager.saveVibeToLibrary(vibePlaylist);
                    showToast('Saved daily vibe playlist to your library!');
                  }
                }}
                className={`flex items-center gap-1.5 px-4 py-3 rounded-full font-bold text-xs shadow-lg hover:scale-105 transition-all active:scale-95 cursor-pointer ${
                  isPlaylistInLibrary
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/40'
                    : 'bg-accent text-accent-content'
                }`}
                title={isPlaylistInLibrary ? 'In your library (Click to remove)' : 'Save this daily vibe playlist permanently to your library'}
              >
                {isPlaylistInLibrary ? <Check size={14} /> : <Plus size={14} />}
                <span>{isPlaylistInLibrary ? 'In Library' : 'Save to Library'}</span>
              </button>
            )}

            {(vibePlaylist || (playlist as any)?.isAIGenerated) && (
              <button
                data-testid="refresh-vibe-playlist-btn"
                onClick={handleRefreshCurrentVibe}
                disabled={isRefreshingVibe}
                className="flex items-center gap-1.5 px-4 py-3 rounded-full bg-elevated hover:bg-highlight border border-customBorder text-secondary hover:text-primary font-bold text-xs shadow transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                title="Refresh tracks for this vibe playlist"
              >
                <RefreshCw size={14} className={isRefreshingVibe ? 'animate-spin text-accent' : ''} />
                <span>{isRefreshingVibe ? 'Refreshing...' : 'Refresh Vibe'}</span>
              </button>
            )}

            {isPlaylistInLibrary && (
              <button
                onClick={openDetailsEditor}
                className="flex items-center gap-1.5 px-4 py-3 rounded-full bg-elevated hover:bg-highlight border border-customBorder text-secondary hover:text-primary font-bold text-xs shadow transition-all active:scale-95 cursor-pointer"
                title="Edit Playlist Cover, Title & Description"
              >
                <Edit2 size={14} />
                <span className="hidden sm:inline">Edit Details</span>
              </button>
            )}

            {isPlaylistInLibrary && (
              <button
                onClick={() => setShowSpotifyAppender((prev) => !prev)}
                className={`flex items-center gap-1.5 px-4 py-3 rounded-full border font-bold text-xs shadow transition-all active:scale-95 cursor-pointer ${
                  showSpotifyAppender
                    ? 'bg-[#1DB954] text-white border-[#1DB954]'
                    : 'bg-elevated hover:bg-[#1DB954]/15 border-customBorder hover:border-[#1DB954]/40 text-secondary hover:text-[#1DB954]'
                }`}
                title="Import tracks from a Spotify link into this playlist"
              >
                <Download size={14} />
                <span>Import from Spotify</span>
              </button>
            )}

            {isPlaylistInLibrary && (
              <button
                data-testid="delete-playlist-action-btn"
                onClick={handleDeletePlaylist}
                className="flex items-center gap-1.5 px-3.5 py-3 rounded-full bg-elevated hover:bg-red-500/10 hover:border-red-500/40 border border-customBorder text-secondary hover:text-red-400 font-bold text-xs shadow transition-all active:scale-95 cursor-pointer"
                title="Delete Playlist from Library"
              >
                <Trash2 size={15} />
                <span className="hidden md:inline">Delete</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* AI Curator Multi-Domain Reasoning Card (if available on Daily Vibe Playlist) */}
      {vibePlaylist?.domainReasoning && (
        <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-surface/90 via-surface to-elevated/40 border border-accent/25 shadow-xl flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-accent/20 border border-accent/30 flex items-center justify-center text-accent">
                <Cpu size={17} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-primary flex items-center gap-2">
                  <span>AI Curator Domain Reasoning</span>
                  {vibePlaylist.isExtraLong && (
                    <span className="text-[10px] font-extrabold text-cyan-400 px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30">
                      Extra-Long Edition ({vibePlaylist.tracks.length} Tracks)
                    </span>
                  )}
                </h3>
                <p className="text-xs text-secondary">
                  Prior multi-domain analysis formulated before track selection
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
            {vibePlaylist.domainReasoning.thematicDomain && (
              <div className="p-3.5 rounded-xl bg-elevated/30 border border-subtle/40 flex flex-col gap-1">
                <span className="text-[11px] font-bold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>Thematic & Conceptual Domain</span>
                </span>
                <p className="text-xs text-secondary leading-relaxed">
                  {vibePlaylist.domainReasoning.thematicDomain}
                </p>
              </div>
            )}

            {vibePlaylist.domainReasoning.sonicDomain && (
              <div className="p-3.5 rounded-xl bg-elevated/30 border border-subtle/40 flex flex-col gap-1">
                <span className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>Sonic & Acoustic Architecture</span>
                </span>
                <p className="text-xs text-secondary leading-relaxed">
                  {vibePlaylist.domainReasoning.sonicDomain}
                </p>
              </div>
            )}

            {vibePlaylist.domainReasoning.emotionalDomain && (
              <div className="p-3.5 rounded-xl bg-elevated/30 border border-subtle/40 flex flex-col gap-1">
                <span className="text-[11px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>Emotional & Psychological Arc</span>
                </span>
                <p className="text-xs text-secondary leading-relaxed">
                  {vibePlaylist.domainReasoning.emotionalDomain}
                </p>
              </div>
            )}

            {vibePlaylist.domainReasoning.curationStrategy && (
              <div className="p-3.5 rounded-xl bg-elevated/30 border border-subtle/40 flex flex-col gap-1">
                <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>Curation Strategy & Discography Selection</span>
                </span>
                <p className="text-xs text-secondary leading-relaxed">
                  {vibePlaylist.domainReasoning.curationStrategy}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Inline Studio Details Editor Panel */}
      {isEditingDetails && (
        <form
          onSubmit={saveDetails}
          className="p-5 sm:p-6 rounded-2xl bg-surface border border-accent/40 shadow-2xl flex flex-col gap-5 animate-in fade-in duration-150"
        >
          <div className="flex items-center justify-between border-b border-customBorder/60 pb-3">
            <div className="flex items-center gap-2">
              <Edit2 size={16} className="text-accent" />
              <h3 className="text-sm font-extrabold text-primary">
                Edit Playlist Studio Details
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setIsEditingDetails(false)}
              className="p-1 rounded-lg text-secondary hover:text-primary cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
            {/* Name & Description */}
            <div className="md:col-span-6 flex flex-col gap-3.5">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-secondary uppercase tracking-wider">
                  Playlist Title
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="bg-elevated border border-customBorder focus:border-accent rounded-xl px-3.5 py-2.5 text-sm font-bold text-primary focus:outline-none"
                  placeholder="Playlist name..."
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-secondary uppercase tracking-wider">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="bg-elevated border border-customBorder focus:border-accent rounded-xl px-3.5 py-2 text-xs text-primary focus:outline-none resize-none"
                  placeholder="Add an optional description or mood notes..."
                />
              </div>
            </div>

            {/* Cover Art Studio Picker */}
            <div className="md:col-span-6 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-secondary uppercase tracking-wider">
                  Cover Art Theme
                </label>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleCoverUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 text-[11px] font-semibold text-secondary hover:text-primary px-2 py-1 rounded-lg bg-elevated hover:bg-highlight border border-customBorder/60 cursor-pointer"
                  >
                    <Upload size={11} />
                    <span>Upload Photo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCoverUrlInput((prev) => !prev)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-secondary hover:text-primary px-2 py-1 rounded-lg bg-elevated hover:bg-highlight border border-customBorder/60 cursor-pointer"
                  >
                    <Link2 size={11} />
                    <span>Image URL</span>
                  </button>
                </div>
              </div>

              {showCoverUrlInput && (
                <input
                  type="url"
                  value={editCoverArt.startsWith('data:') ? '' : editCoverArt}
                  onChange={(e) => setEditCoverArt(e.target.value)}
                  placeholder="https://example.com/cover.jpg"
                  className="w-full bg-elevated border border-customBorder focus:border-accent rounded-xl px-3 py-1.5 text-xs text-primary placeholder-muted focus:outline-none"
                />
              )}

              <div className="grid grid-cols-4 sm:grid-cols-8 md:grid-cols-4 lg:grid-cols-8 gap-2 pt-1">
                {PLAYLIST_COVER_PRESETS.map((preset) => {
                  const isSelected =
                    preset.id === 'auto'
                      ? !editCoverArt
                      : editCoverArt === preset.url;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setEditCoverArt(preset.url)}
                      title={preset.label}
                      className={`group relative aspect-square rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${
                        isSelected
                          ? 'border-accent ring-2 ring-accent/30 scale-105'
                          : 'border-customBorder/60 hover:border-secondary opacity-80 hover:opacity-100'
                      }`}
                    >
                      {preset.url ? (
                        <img
                          src={preset.url}
                          alt={preset.label}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-elevated flex flex-col items-center justify-center text-[9px] font-bold text-secondary p-1">
                          <ListMusic size={14} className="text-accent mb-0.5" />
                          <span>Auto</span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-customBorder/50">
            <button
              type="button"
              onClick={() => setIsEditingDetails(false)}
              className="px-4 py-2 rounded-full bg-elevated hover:bg-highlight text-xs font-bold text-secondary hover:text-primary transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!editName.trim()}
              className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-accent text-accent-content text-xs font-extrabold shadow-lg hover:brightness-110 transition-all cursor-pointer"
            >
              <Check size={14} />
              <span>Save Changes</span>
            </button>
          </div>
        </form>
      )}

      {/* Inline Spotify Appender Bar */}
      {showSpotifyAppender && (
        <form
          onSubmit={handleSpotifyAppend}
          className="p-4 sm:p-5 rounded-2xl bg-surface border border-[#1DB954]/40 shadow-xl flex flex-col gap-3 animate-in fade-in duration-150"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Download size={16} className="text-[#1DB954]" />
              <span className="text-xs font-extrabold text-primary">
                Copy Songs from a Spotify Playlist or Album into "{playlist.name}"
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowSpotifyAppender(false)}
              className="text-muted hover:text-primary p-1 cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              value={spotifyAppendUrl}
              onChange={(e) => setSpotifyAppendUrl(e.target.value)}
              placeholder="Paste Spotify playlist, album, or track URL (https://open.spotify.com/playlist/...)"
              className="flex-1 bg-elevated border border-customBorder focus:border-[#1DB954] rounded-xl px-3.5 py-2.5 text-xs text-primary placeholder-muted focus:outline-none"
              autoFocus
            />
            <button
              type="submit"
              disabled={isAppendingSpotify || !spotifyAppendUrl.trim()}
              className="px-5 py-2.5 rounded-xl bg-[#1DB954] hover:bg-[#1ed760] text-white font-extrabold text-xs flex items-center justify-center gap-2 shadow-md disabled:opacity-40 transition-all cursor-pointer shrink-0"
            >
              {isAppendingSpotify ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Importing...</span>
                </>
              ) : (
                <>
                  <Plus size={14} />
                  <span>Import Tracks</span>
                </>
              )}
            </button>
          </div>

          {spotifyAppendError && (
            <p className="text-xs text-red-400 font-medium">{spotifyAppendError}</p>
          )}
        </form>
      )}

      {/* Track List */}
      {isRefreshingVibe && isVibe ? (
        <div className="flex flex-col items-center justify-center gap-5 py-16 px-6 rounded-2xl bg-elevated/30 border border-accent/20">
          <div className="w-12 h-12 rounded-2xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
            <RefreshCw size={22} className="animate-spin" />
          </div>
          <div className="flex flex-col items-center gap-1.5 text-center">
            <p className="text-sm font-bold text-primary">Selecting new playlists…</p>
            <p className="text-xs text-secondary max-w-xs">
              Gemini is curating a fresh set of tracks for this vibe. This usually takes a few seconds.
            </p>
          </div>
          <div className="flex gap-2 pt-1">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-accent/40 animate-pulse"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
        </div>
      ) : playlist.tracks.length > 0 ? (
        <div className="flex flex-col gap-2">
          {/* Filter Bar */}
          {playlist.tracks.length > 3 && (
            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                />
                <input
                  type="text"
                  value={trackFilter}
                  onChange={(e) => setTrackFilter(e.target.value)}
                  placeholder="Search in playlist..."
                  className="w-full bg-elevated/70 border border-customBorder/70 focus:border-accent rounded-xl pl-8 pr-7 py-1.5 text-xs text-primary placeholder-muted focus:outline-none transition-colors"
                />
                {trackFilter && (
                  <button
                    onClick={() => setTrackFilter('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <span className="text-xs text-muted font-medium">
                Showing {displayedTracks.length} of {playlist.tracks.length} songs
              </span>
            </div>
          )}

          {/* Table Header */}
          <div className="grid grid-cols-12 px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider border-b border-customBorder/50">
            <span className="col-span-1">#</span>
            <span className="col-span-7 sm:col-span-6">Title</span>
            <span className="hidden sm:block sm:col-span-3">Album</span>
            <span className="col-span-4 sm:col-span-2 text-right">
              <Clock size={13} className="inline ml-auto" />
            </span>
          </div>

          {/* Table Rows */}
          <div className="flex flex-col gap-1 mt-1">
            {displayedTracks.map(({ track, originalIndex }) => {
              const isCurrent = currentTrack?.id === track.id;
              return (
                <div
                  key={`${track.id}-${originalIndex}`}
                  data-testid="track-item"
                  onClick={() =>
                    playTrack(track, playlist.tracks, originalIndex, {
                      origin: playlistOrigin,
                      playlistId: playlist.id,
                    })
                  }
                  className={`group grid grid-cols-12 items-center px-4 py-2.5 rounded-xl transition-colors cursor-pointer ${
                    isCurrent ? 'bg-elevated' : 'hover:bg-elevated/50'
                  }`}
                >
                  {/* Track Index / Reorder controls */}
                  <div
                    className="col-span-1 flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-xs text-muted group-hover:hidden w-5 text-center font-mono">
                      {isCurrent && isPlaying ? (
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-accent animate-pulse" />
                      ) : (
                        originalIndex + 1
                      )}
                    </span>
                    <span
                      onClick={() =>
                        playTrack(track, playlist.tracks, originalIndex, {
                          origin: playlistOrigin,
                          playlistId: playlist.id,
                        })
                      }
                      className="hidden group-hover:block text-accent cursor-pointer w-5 text-center"
                    >
                      <Play size={14} fill="currentColor" />
                    </span>

                    {/* Move Up / Down Reorder (only when unfiltered) */}
                    {!normalizedFilter && (
                      <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                        <button
                          disabled={originalIndex === 0}
                          onClick={() =>
                            reorderPlaylistTracks(
                              playlist.id,
                              originalIndex,
                              originalIndex - 1
                            )
                          }
                          className="text-muted hover:text-primary disabled:opacity-20 p-0.5 cursor-pointer"
                          title="Move up"
                        >
                          <ChevronUp size={11} />
                        </button>
                        <button
                          disabled={originalIndex === playlist.tracks.length - 1}
                          onClick={() =>
                            reorderPlaylistTracks(
                              playlist.id,
                              originalIndex,
                              originalIndex + 1
                            )
                          }
                          className="text-muted hover:text-primary disabled:opacity-20 p-0.5 cursor-pointer"
                          title="Move down"
                        >
                          <ChevronDown size={11} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Title & Artwork */}
                  <div className="col-span-7 sm:col-span-6 flex items-center gap-3 min-w-0 pr-2">
                    <img
                      src={getTrackArtwork(track)}
                      alt={track.title}
                      className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-highlight shadow-sm"
                      loading="lazy"
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
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm font-semibold truncate ${
                          isCurrent ? 'text-accent font-bold' : 'text-primary'
                        }`}
                      >
                        {track.title}
                      </p>
                      <p
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateToArtist(track.artist);
                        }}
                        className="text-xs text-secondary truncate hover:underline hover:text-primary cursor-pointer transition-colors"
                      >
                        {track.artist}
                      </p>
                    </div>
                  </div>

                  {/* Album */}
                  <span
                    onClick={(e) => {
                      if (track.album) {
                        e.stopPropagation();
                        navigateToAlbum({
                          id: track.album,
                          title: track.album,
                          artist: track.artist,
                          coverUrl: track.artworkUrl,
                        });
                      }
                    }}
                    className="hidden sm:block sm:col-span-3 text-xs text-muted truncate hover:text-secondary cursor-pointer pr-2"
                  >
                    {track.album || track.artist}
                  </span>

                  {/* Actions & Duration */}
                  <div className="col-span-4 sm:col-span-2 flex items-center justify-end gap-2.5 text-xs font-mono text-muted">
                    <SaveMp3Button track={track} size={15} />

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLike(track);
                      }}
                      className="p-1 text-secondary hover:text-accent transition-colors cursor-pointer"
                      title={isLiked(track.id) ? 'Unlike' : 'Like'}
                    >
                      <Heart
                        size={15}
                        className={isLiked(track.id) ? 'text-accent fill-accent' : ''}
                      />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTrackFromPlaylist(playlist.id, track.id);
                      }}
                      className="p-1 text-muted hover:text-red-400 transition-colors cursor-pointer"
                      title="Remove from playlist"
                    >
                      <Trash2 size={14} />
                    </button>

                    <span>{formatDuration(track.duration)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-muted bg-surface/40 rounded-2xl border border-customBorder/60 p-6 flex flex-col items-center">
          <ListMusic size={40} className="opacity-30 mb-2.5 text-accent" />
          <p className="text-base font-bold text-primary">
            Your playlist is ready for music
          </p>
          <p className="text-xs text-secondary mt-1 max-w-md">
            Search below to add songs with 1 click, or click{' '}
            <button
              type="button"
              onClick={() => setShowSpotifyAppender(true)}
              className="text-[#1DB954] font-bold hover:underline cursor-pointer"
            >
              Import from Spotify
            </button>{' '}
            to copy any Spotify playlist into "{playlist.name}".
          </p>
        </div>
      )}

      {/* Spotify-Style Inline Song Finder ("Let's find something for your playlist") */}
      <div className="mt-4 pt-6 border-t border-customBorder/50 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-primary flex items-center gap-2">
              <Music size={18} className="text-accent" />
              <span>Let's find something for your playlist</span>
            </h2>
            <p className="text-xs text-secondary mt-0.5">
              Search any song or artist, or pick from trending charts and your liked songs.
            </p>
          </div>

          {/* Source Switch Pills */}
          <div className="flex items-center gap-1.5 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => {
                setFinderQuery('');
                setFinderTab('trending');
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                finderTab === 'trending'
                  ? 'bg-accent text-accent-content shadow-sm'
                  : 'bg-elevated text-secondary hover:text-primary'
              }`}
            >
              Trending Hits
            </button>
            <button
              type="button"
              onClick={() => {
                setFinderQuery('');
                setFinderTab('liked');
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                finderTab === 'liked'
                  ? 'bg-accent text-accent-content shadow-sm'
                  : 'bg-elevated text-secondary hover:text-primary'
              }`}
            >
              Liked Songs ({likedTracks.length})
            </button>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative max-w-xl">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            type="text"
            value={finderQuery}
            onChange={(e) => setFinderQuery(e.target.value)}
            placeholder="Search for songs or artists to add..."
            className="w-full bg-elevated border border-customBorder focus:border-accent rounded-xl pl-10 pr-9 py-2.5 text-sm text-primary placeholder-muted focus:outline-none transition-colors"
          />
          {finderQuery && (
            <button
              type="button"
              onClick={() => setFinderQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Song Finder Results List */}
        <div className="rounded-2xl bg-surface/60 border border-customBorder/60 divide-y divide-customBorder/30 overflow-hidden">
          {isSearchingFinder ? (
            <div className="py-10 flex items-center justify-center gap-2 text-xs text-secondary">
              <Loader2 size={16} className="animate-spin text-accent" />
              <span>Searching catalog...</span>
            </div>
          ) : finderPool.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted">
              {finderTab === 'liked'
                ? 'No liked songs yet. Search above or switch to Trending Hits.'
                : 'No matching tracks found.'}
            </div>
          ) : (
            finderPool.slice(0, 12).map((track) => {
              const alreadyInPlaylist = playlist.tracks.some(
                (t) => t.id === track.id
              );
              return (
                <div
                  key={track.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-elevated/60 transition-colors"
                >
                  <div
                    onClick={() => {
                      const finderOrigin: PlayOrigin =
                        finderTab === 'liked'
                          ? 'library'
                          : finderTab === 'search'
                          ? 'search'
                          : 'charts';
                      playTrack(track, finderPool, undefined, {
                        origin: finderOrigin,
                        searchQuery: finderTab === 'search' ? finderQuery : undefined,
                      });
                    }}
                    className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer group"
                  >
                    <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-highlight shrink-0">
                      <img
                        src={getTrackArtwork(track)}
                        alt={track.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
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
                      <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                        <Play size={14} fill="currentColor" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm font-semibold text-primary truncate group-hover:text-accent transition-colors">
                        {track.title}
                      </p>
                      <p className="text-[11px] text-secondary truncate">
                        {track.artist}
                        {track.album ? ` • ${track.album}` : ''}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (alreadyInPlaylist) {
                        removeTrackFromPlaylist(playlist.id, track.id);
                      } else {
                        addTrackToPlaylist(playlist.id, track);
                        showToast(`Added "${track.title}"`);
                      }
                    }}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                      alreadyInPlaylist
                        ? 'bg-accent/15 text-accent border border-accent/30 hover:bg-red-500/15 hover:text-red-400 hover:border-red-500/30'
                        : 'bg-elevated hover:bg-accent hover:text-accent-content text-primary border border-customBorder'
                    }`}
                  >
                    {alreadyInPlaylist ? (
                      <>
                        <CheckCircle2 size={13} />
                        <span>Added</span>
                      </>
                    ) : (
                      <>
                        <Plus size={13} />
                        <span>Add</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
