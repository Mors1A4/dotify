import React, { useState, useRef, useEffect } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { useAuthStore } from '../../store/authStore';
import {
  Heart,
  ListMusic,
  Play,
  Trash2,
  Plus,
  Clock,
  Disc3,
  Edit2,
  Check,
  X,
  ChevronUp,
  ChevronDown,
  Cloud,
  Copy,
  ShieldCheck,
  Download,
  Upload,
  BarChart2,
  Flame,
  Users,
  HardDrive,
  Wifi,
} from 'lucide-react';
import { telemetryDb } from '../../services/telemetryDb';
import { ExportableTelemetryDataset } from '../../types/telemetry';
import { PlaylistArtwork } from '../common/PlaylistArtwork';
import {
  getTrackArtwork,
  resolveTrackArtwork,
  DEFAULT_MUSIC_ARTWORK,
  isUglyPlaceholder,
} from '../../services/artworkService';
import { useMp3VaultStore } from '../../services/mp3VaultService';
import { Mp3VaultPanel } from './Mp3VaultPanel';
import { SaveMp3Button } from '../common/SaveMp3Button';

export const LibraryView: React.FC = () => {
  const {
    likedTracks,
    playlists,
    followedArtists,
    toggleFollowArtist,
    playTrack,
    currentTrack,
    toggleLike,
    deletePlaylist,
    renamePlaylist,
    reorderPlaylistTracks,
    removeTrackFromPlaylist,
    openCreatePlaylistModal,
    navigateToPlaylist,
    navigateToArtist,
    isLiked,
  } = usePlayerStore();

  const { user, openAuthModal } = useAuthStore();
  const { savedTracks, peers } = useMp3VaultStore();

  const [activeTab, setActiveTab] = useState<'liked' | 'playlists' | 'artists' | 'mp3s' | 'profile'>('liked');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameInput, setRenameInput] = useState('');

  // Private Listening Profile State
  const [profileData, setProfileData] = useState<ExportableTelemetryDataset | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadProfileData = async () => {
    try {
      const data = await telemetryDb.exportDataset();
      setProfileData(data);
    } catch (err) {
      console.warn('Failed to load profile data:', err);
    }
  };

  useEffect(() => {
    if (activeTab === 'profile') {
      loadProfileData();
    }
  }, [activeTab]);

  const handleExportProfile = async () => {
    try {
      const json = await telemetryDb.exportTelemetryDataset();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dotify_profile_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatusMsg('Profile successfully exported!');
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      alert('Export failed: ' + err.message);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = await telemetryDb.importTelemetryDataset(text);
      await loadProfileData();
      setStatusMsg(`Successfully imported ${result.importedPlays} plays and ${result.importedSessions} sessions!`);
      setTimeout(() => setStatusMsg(null), 4000);
    } catch (err: any) {
      alert('Import failed: ' + err.message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleClearHistory = async () => {
    if (confirm('Are you sure you want to clear your local listening history and affinity profile? This cannot be undone.')) {
      await telemetryDb.clearTelemetry();
      await loadProfileData();
      setStatusMsg('Listening history cleared.');
      setTimeout(() => setStatusMsg(null), 3000);
    }
  };

  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId) || null;

  const handlePlayAll = () => {
    if (activeTab === 'liked' && likedTracks.length > 0) {
      playTrack(likedTracks[0], likedTracks, 0, { origin: 'library' });
    } else if (selectedPlaylist && selectedPlaylist.tracks.length > 0) {
      playTrack(selectedPlaylist.tracks[0], selectedPlaylist.tracks, 0, {
        origin: 'user_playlist',
        playlistId: selectedPlaylist.id,
      });
    }
  };

  const startRenaming = () => {
    if (!selectedPlaylist) return;
    setRenameInput(selectedPlaylist.name);
    setIsRenaming(true);
  };

  const saveRenaming = () => {
    if (!selectedPlaylist || !renameInput.trim()) return;
    renamePlaylist(selectedPlaylist.id, renameInput.trim());
    setIsRenaming(false);
  };

  const formatDuration = (sec: number) => {
    if (!sec || !isFinite(sec)) return 'LIVE';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const currentList = activeTab === 'liked' ? likedTracks : selectedPlaylist ? selectedPlaylist.tracks : [];

  return (
    <div data-testid="main-content" className="p-4 md:p-8 flex flex-col gap-6 pb-32">
      {/* Cloud Library Sync Banner (when not signed in) */}
      {!user && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-gradient-to-r from-accent/15 via-surface to-elevated border border-accent/20 shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent/20 text-accent flex items-center justify-center font-bold flex-shrink-0">
              <Cloud size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-primary">Sync your library across devices</h3>
              <p className="text-xs text-secondary">Sign in with a 1-click nickname or Google to access your liked songs and playlists anywhere.</p>
            </div>
          </div>
          <button
            onClick={openAuthModal}
            className="px-5 py-2 rounded-full bg-accent text-accent-content font-bold text-xs hover:brightness-110 active:scale-95 transition-all shadow-md flex-shrink-0 self-start sm:self-auto"
          >
            Connect Account
          </button>
        </div>
      )}

      {/* Header Tabs & Spotify Import Button */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setActiveTab('liked');
              setSelectedPlaylistId(null);
              setIsRenaming(false);
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all ${
              activeTab === 'liked'
                ? 'bg-accent text-accent-content shadow'
                : 'bg-elevated text-secondary hover:text-primary'
            }`}
          >
            <Heart size={14} fill="currentColor" />
            <span>Liked Songs ({likedTracks.length})</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('playlists');
              setIsRenaming(false);
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all ${
              activeTab === 'playlists'
                ? 'bg-accent text-accent-content shadow'
                : 'bg-elevated text-secondary hover:text-primary'
            }`}
          >
            <ListMusic size={14} />
            <span>Playlists ({playlists.length})</span>
          </button>

          <button
            data-testid="artists-tab-btn"
            onClick={() => {
              setActiveTab('artists');
              setSelectedPlaylistId(null);
              setIsRenaming(false);
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all ${
              activeTab === 'artists'
                ? 'bg-accent text-accent-content shadow'
                : 'bg-elevated text-secondary hover:text-primary'
            }`}
          >
            <Users size={14} />
            <span>Artists ({(followedArtists || []).length})</span>
          </button>

          <button
            data-testid="mp3-vault-tab-btn"
            onClick={() => {
              setActiveTab('mp3s');
              setSelectedPlaylistId(null);
              setIsRenaming(false);
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all ${
              activeTab === 'mp3s'
                ? 'bg-accent text-accent-content shadow'
                : 'bg-elevated text-secondary hover:text-primary'
            }`}
          >
            <HardDrive size={14} />
            <span>Saved MP3s & WiFi ({savedTracks.length})</span>
            {peers.length > 0 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-400 text-[10px] font-extrabold">
                <Wifi size={10} />
                {peers.length}
              </span>
            )}
          </button>

          <button
            data-testid="profile-tab-btn"
            onClick={() => {
              setActiveTab('profile');
              setSelectedPlaylistId(null);
              setIsRenaming(false);
              loadProfileData();
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all ${
              activeTab === 'profile'
                ? 'bg-accent text-accent-content shadow'
                : 'bg-elevated text-secondary hover:text-primary'
            }`}
          >
            <ShieldCheck size={14} />
            <span>Private Profile</span>
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Import from Spotify Button */}
          <button
            data-testid="import-spotify-btn"
            onClick={() => openCreatePlaylistModal('spotify')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-extrabold text-xs shadow-md transition-all hover:scale-105 active:scale-95 cursor-pointer"
          >
            <Download size={14} />
            <span>Import from Spotify</span>
          </button>

          <button
            data-testid="library-create-playlist-btn"
            onClick={() => openCreatePlaylistModal('custom')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-highlight hover:bg-elevated text-xs font-bold text-primary transition-colors border border-customBorder cursor-pointer"
          >
            <Plus size={14} />
            <span>New Playlist</span>
          </button>
        </div>
      </div>

      {/* Playlist Cards Grid & Selector */}
      {activeTab === 'playlists' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {/* Create Custom Playlist Card */}
            <div
              onClick={() => openCreatePlaylistModal('custom')}
              className="group flex flex-col justify-between p-4 rounded-2xl bg-gradient-to-br from-accent/15 via-surface to-elevated hover:from-accent/25 border border-accent/30 hover:border-accent/60 transition-all cursor-pointer shadow-sm hover:shadow-xl hover:-translate-y-1"
            >
              <div className="w-full aspect-square rounded-xl bg-elevated/80 border border-dashed border-accent/40 flex flex-col items-center justify-center gap-2 mb-3 group-hover:scale-[1.02] transition-transform">
                <div className="w-12 h-12 rounded-full bg-accent text-accent-content flex items-center justify-center shadow-lg">
                  <Plus size={24} />
                </div>
                <span className="text-[11px] font-bold text-accent">Studio Creator</span>
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-primary truncate">
                  Create Playlist
                </h3>
                <p className="text-[11px] text-secondary mt-0.5 truncate">
                  Custom art & starter tracks
                </p>
              </div>
            </div>

            {/* Clone from Spotify Card */}
            <div
              onClick={() => openCreatePlaylistModal('spotify')}
              className="group flex flex-col justify-between p-4 rounded-2xl bg-gradient-to-br from-[#1DB954]/15 via-surface to-elevated hover:from-[#1DB954]/25 border border-[#1DB954]/30 hover:border-[#1DB954]/60 transition-all cursor-pointer shadow-sm hover:shadow-xl hover:-translate-y-1"
            >
              <div className="w-full aspect-square rounded-xl bg-elevated/80 border border-dashed border-[#1DB954]/40 flex flex-col items-center justify-center gap-2 mb-3 group-hover:scale-[1.02] transition-transform">
                <div className="w-12 h-12 rounded-full bg-[#1DB954] text-black flex items-center justify-center shadow-lg">
                  <Copy size={22} />
                </div>
                <span className="text-[11px] font-bold text-[#1DB954]">1:1 Cloner</span>
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-primary truncate">
                  Copy from Spotify
                </h3>
                <p className="text-[11px] text-secondary mt-0.5 truncate">
                  Paste any Spotify playlist link
                </p>
              </div>
            </div>

            {/* User Playlists */}
            {/* User Playlists */}
            {playlists.map((pl) => (
              <div
                key={pl.id}
                onClick={() => navigateToPlaylist(pl.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (confirm(`Delete playlist "${pl.name}"?`)) {
                    deletePlaylist(pl.id);
                    if (selectedPlaylistId === pl.id) setSelectedPlaylistId(null);
                  }
                }}
                className="group relative flex flex-col justify-between p-3.5 rounded-2xl bg-elevated/45 hover:bg-elevated border border-customBorder/50 hover:border-accent/40 transition-all cursor-pointer shadow-sm hover:shadow-xl hover:-translate-y-1"
              >
                <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-highlight mb-3 shadow-md">
                  <PlaylistArtwork
                    coverArt={pl.coverArt}
                    tracks={pl.tracks}
                    alt={pl.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    iconSize={36}
                  />

                  {/* Easy Delete Playlist Button on Card */}
                  <button
                    type="button"
                    data-testid={`library-delete-playlist-${pl.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete playlist "${pl.name}"?`)) {
                        deletePlaylist(pl.id);
                        if (selectedPlaylistId === pl.id) {
                          setSelectedPlaylistId(null);
                        }
                      }
                    }}
                    aria-label={`Delete ${pl.name}`}
                    title={`Delete "${pl.name}"`}
                    className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-black/65 hover:bg-red-600 text-white/80 hover:text-white opacity-80 md:opacity-0 md:group-hover:opacity-100 transition-all flex items-center justify-center shadow-lg hover:scale-110 cursor-pointer z-10"
                  >
                    <Trash2 size={14} />
                  </button>

                  {pl.tracks.length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        playTrack(pl.tracks[0], pl.tracks, 0, {
                          origin: 'user_playlist',
                          playlistId: pl.id,
                        });
                      }}
                      aria-label={`Play ${pl.name}`}
                      className="absolute bottom-2.5 right-2.5 w-10 h-10 rounded-full bg-accent text-accent-content shadow-xl opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all flex items-center justify-center hover:scale-105 cursor-pointer"
                    >
                      <Play size={17} fill="currentColor" className="ml-0.5" />
                    </button>
                  )}
                </div>

                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-primary truncate group-hover:text-accent transition-colors">
                    {pl.name}
                  </h3>
                  <p className="text-[11px] text-secondary mt-0.5 truncate">
                    {pl.tracks.length} {pl.tracks.length === 1 ? 'song' : 'songs'}
                    {pl.description ? ` • ${pl.description}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {playlists.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-2 border-t border-customBorder/30">
              {playlists.map((pl) => (
                <div key={pl.id} className="relative group/pill flex items-center shrink-0">
                  <button
                    onClick={() => {
                      setSelectedPlaylistId(pl.id);
                      setIsRenaming(false);
                    }}
                    className={`px-3.5 py-1.5 pr-7 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-2 cursor-pointer ${
                      selectedPlaylistId === pl.id
                        ? 'bg-elevated text-primary font-bold border border-accent/40 shadow-sm'
                        : 'bg-elevated/40 text-secondary hover:text-primary'
                    }`}
                  >
                    <span>{pl.name}</span>
                    <span className="text-[10px] bg-highlight px-1.5 py-0.5 rounded-full text-muted">
                      {pl.tracks.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete playlist "${pl.name}"?`)) {
                        deletePlaylist(pl.id);
                        if (selectedPlaylistId === pl.id) setSelectedPlaylistId(null);
                      }
                    }}
                    title={`Delete "${pl.name}"`}
                    aria-label={`Delete ${pl.name}`}
                    className="absolute right-1.5 p-1 text-muted hover:text-red-400 opacity-60 hover:opacity-100 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Followed Artists Tab */}
      {activeTab === 'artists' ? (
        <div data-testid="followed-artists-view" className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-primary">Followed Artists ({(followedArtists || []).length})</h2>
              <p className="text-xs text-secondary mt-0.5">Artists you follow shape your Daily Mixes, Discover Weekly, and Autoplay.</p>
            </div>
          </div>

          {(followedArtists || []).length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {followedArtists.map((artist) => (
                <div
                  key={artist.id || artist.name}
                  onClick={() => navigateToArtist(artist.name, artist.id)}
                  className="group relative flex flex-col items-center text-center p-4 rounded-2xl bg-elevated/40 hover:bg-elevated border border-customBorder/40 hover:border-accent/40 transition-all cursor-pointer shadow-sm hover:shadow-xl hover:-translate-y-1"
                >
                  <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full overflow-hidden mb-3.5 bg-highlight shadow-lg flex-shrink-0">
                    {artist.imageUrl ? (
                      <img
                        src={artist.imageUrl}
                        alt={artist.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-accent/30 to-elevated text-accent font-bold text-2xl">
                        {artist.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>

                  <h3 className="text-sm font-bold text-primary truncate max-w-full group-hover:text-accent transition-colors">
                    {artist.name}
                  </h3>

                  <p className="text-[11px] text-secondary mt-0.5 truncate max-w-full">
                    {artist.genres && artist.genres.length > 0 ? artist.genres.slice(0, 2).join(', ') : 'Artist'}
                  </p>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFollowArtist(artist);
                    }}
                    className="mt-3 px-3 py-1 rounded-full text-[11px] font-bold border border-accent/60 bg-accent/15 text-accent hover:bg-red-500/20 hover:border-red-500/50 hover:text-red-400 transition-colors"
                    title="Click to unfollow"
                  >
                    Following
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-20 text-muted">
              <Users size={40} className="mx-auto opacity-30 mb-3" />
              <p className="text-base font-semibold text-primary">No followed artists yet</p>
              <p className="text-xs text-secondary mt-1 max-w-md mx-auto">
                Explore charts or search for your favorite musicians and click "Follow" to build your artist library and personalize your recommendations.
              </p>
            </div>
          )}
        </div>
      ) : activeTab === 'mp3s' ? (
        <Mp3VaultPanel />
      ) : activeTab === 'profile' ? (
        <div data-testid="private-profile-view" className="flex flex-col gap-6">
          {/* Privacy Banner */}
          <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-950/60 via-surface to-elevated border border-emerald-800/40 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-accent/20 text-accent flex-shrink-0 mt-0.5">
                <ShieldCheck size={26} />
              </div>
              <div>
                <h3 className="text-base font-bold text-primary flex items-center gap-2">
                  100% On-Device Listening Privacy
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent/20 text-accent uppercase">
                    IndexedDB v1
                  </span>
                </h3>
                <p className="text-xs text-secondary mt-1 max-w-2xl leading-relaxed">
                  Dotify stores your entire listening dataset, playback telemetry, skip tracking, and affinity models exclusively inside your browser's IndexedDB. Zero listening metrics or telemetry ever leave this device.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0 self-end md:self-auto">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFile}
              />
              <button
                data-testid="export-profile-btn"
                onClick={handleExportProfile}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent text-accent-content text-xs font-bold shadow-md hover:scale-105 active:scale-95 transition-all"
                title="Export complete telemetry dataset to JSON file"
              >
                <Download size={14} />
                <span>Export JSON</span>
              </button>

              <button
                data-testid="import-profile-btn"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-elevated hover:bg-highlight text-primary text-xs font-bold border border-customBorder transition-all"
                title="Import existing telemetry dataset from JSON file"
              >
                <Upload size={14} />
                <span>Import JSON</span>
              </button>

              <button
                data-testid="clear-profile-btn"
                onClick={handleClearHistory}
                className="p-2 rounded-xl bg-elevated hover:bg-red-950/40 text-muted hover:text-red-400 border border-customBorder transition-all"
                title="Clear local listening telemetry"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {statusMsg && (
            <div className="px-4 py-2 rounded-xl bg-accent/20 border border-accent/40 text-accent text-xs font-semibold">
              {statusMsg}
            </div>
          )}

          {/* Metrics Overview Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-elevated/40 border border-customBorder flex flex-col gap-1">
              <span className="text-xs text-muted font-medium">Total Tracks Played</span>
              <span className="text-2xl font-extrabold text-primary">{profileData?.plays.length || 0}</span>
              <span className="text-[11px] text-secondary">Logged in IndexedDB</span>
            </div>

            <div className="p-4 rounded-xl bg-elevated/40 border border-customBorder flex flex-col gap-1">
              <span className="text-xs text-muted font-medium">Listening Time</span>
              <span className="text-2xl font-extrabold text-primary">
                {(() => {
                  const totalMs = (profileData?.plays || []).reduce((acc, p) => acc + (p.durationPlayedMs || 0), 0);
                  const totalMin = Math.floor(totalMs / 60000);
                  const hours = Math.floor(totalMin / 60);
                  const mins = totalMin % 60;
                  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                })()}
              </span>
              <span className="text-[11px] text-secondary">Cumulative audio played</span>
            </div>

            <div className="p-4 rounded-xl bg-elevated/40 border border-customBorder flex flex-col gap-1">
              <span className="text-xs text-muted font-medium">Listening Sessions</span>
              <span className="text-2xl font-extrabold text-primary">{profileData?.sessions.length || 0}</span>
              <span className="text-[11px] text-secondary">Contiguous listening</span>
            </div>

            <div className="p-4 rounded-xl bg-elevated/40 border border-customBorder flex flex-col gap-1">
              <span className="text-xs text-muted font-medium">Top Affinity Genre</span>
              <span className="text-2xl font-extrabold text-accent truncate">
                {profileData?.genreAffinities && profileData.genreAffinities.length > 0
                  ? [...profileData.genreAffinities].sort((a, b) => b.affinityScore - a.affinityScore)[0].genre
                  : 'N/A'}
              </span>
              <span className="text-[11px] text-secondary">Exponentially smoothed</span>
            </div>
          </div>

          {/* Genre & Artist Affinity Grids */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Top Genres */}
            <div className="p-5 rounded-2xl bg-elevated/40 border border-customBorder flex flex-col gap-4">
              <h3 className="text-sm font-bold text-primary flex items-center gap-2">
                <BarChart2 size={16} className="text-accent" />
                <span>Top Genre Affinities</span>
              </h3>

              {profileData?.genreAffinities && profileData.genreAffinities.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {[...profileData.genreAffinities]
                    .sort((a, b) => b.affinityScore - a.affinityScore)
                    .slice(0, 6)
                    .map((g) => (
                      <div key={g.genre} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-primary">{g.genre}</span>
                          <span className="text-secondary font-mono">{g.affinityScore}/100 ({g.playCount} plays)</span>
                        </div>
                        <div className="h-2 w-full bg-highlight rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, Math.max(5, g.affinityScore))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="text-xs text-muted py-6 text-center">No genre affinity data recorded yet. Listen to tracks to generate your profile.</p>
              )}
            </div>

            {/* Top Artists */}
            <div className="p-5 rounded-2xl bg-elevated/40 border border-customBorder flex flex-col gap-4">
              <h3 className="text-sm font-bold text-primary flex items-center gap-2">
                <Flame size={16} className="text-orange-400" />
                <span>Top Artist Affinities</span>
              </h3>

              {profileData?.artistAffinities && profileData.artistAffinities.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {[...profileData.artistAffinities]
                    .sort((a, b) => b.affinityScore - a.affinityScore)
                    .slice(0, 6)
                    .map((a) => (
                      <div key={a.artist} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-xs">
                          <span
                            onClick={() => navigateToArtist(a.artist)}
                            className="font-semibold text-primary hover:underline hover:text-accent cursor-pointer"
                          >
                            {a.artist}
                          </span>
                          <span className="text-secondary font-mono">{a.affinityScore}/100 ({a.playCount} plays)</span>
                        </div>
                        <div className="h-2 w-full bg-highlight rounded-full overflow-hidden">
                          <div
                            className="h-full bg-orange-400 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, Math.max(5, a.affinityScore))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="text-xs text-muted py-6 text-center">No artist affinity data recorded yet. Play favorite artists to train your profile.</p>
              )}
            </div>
          </div>

          {/* Recent Play Records */}
          <div className="p-5 rounded-2xl bg-elevated/40 border border-customBorder flex flex-col gap-4">
            <h3 className="text-sm font-bold text-primary flex items-center gap-2">
              <Clock size={16} className="text-accent" />
              <span>Recent Play Records ({profileData?.plays.length || 0} Total)</span>
            </h3>

            {profileData?.plays && profileData.plays.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-customBorder text-muted">
                      <th className="pb-2 font-medium">Title</th>
                      <th className="pb-2 font-medium">Artist</th>
                      <th className="pb-2 font-medium">Genre</th>
                      <th className="pb-2 font-medium">Completion</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-customBorder/40">
                    {[...profileData.plays]
                      .sort((a, b) => b.startTime - a.startTime)
                      .slice(0, 10)
                      .map((p) => (
                        <tr key={p.playId} className="hover:bg-elevated/50 transition-colors">
                          <td className="py-2.5 font-semibold text-primary max-w-[200px] truncate">{p.title}</td>
                          <td className="py-2.5 text-secondary">{p.artist}</td>
                          <td className="py-2.5 text-secondary">{p.genre || 'Unknown'}</td>
                          <td className="py-2.5 font-mono">{Math.round(p.completionRate * 100)}%</td>
                          <td className="py-2.5">
                            {p.replayed ? (
                              <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 font-bold text-[10px]">
                                Replay
                              </span>
                            ) : p.completed ? (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[10px]">
                                Completed
                              </span>
                            ) : p.skipped ? (
                              <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-bold text-[10px]">
                                Skipped
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 font-bold text-[10px]">
                                Partial
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted py-6 text-center">No plays recorded yet. Start playing music to build your local dataset.</p>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Action Bar (Play All / Rename / Delete) */}
          {(selectedPlaylist || (activeTab === 'liked' && likedTracks.length > 0)) && (
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-elevated/40 border border-customBorder/40">
          <div className="flex items-center gap-4">
            {currentList.length > 0 && (
              <button
                onClick={handlePlayAll}
                className="w-11 h-11 rounded-full bg-accent text-accent-content flex items-center justify-center shadow-xl hover:scale-105 active:scale-95 transition-all"
                title="Play All"
              >
                <Play size={20} fill="currentColor" className="ml-0.5" />
              </button>
            )}

            {/* Playlist Title & Rename Section */}
            {activeTab === 'playlists' && selectedPlaylist && (
              <div className="flex items-center gap-2">
                {isRenaming ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={renameInput}
                      onChange={(e) => setRenameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveRenaming();
                        if (e.key === 'Escape') setIsRenaming(false);
                      }}
                      className="bg-base border border-accent rounded-lg px-2.5 py-1 text-sm font-bold text-primary focus:outline-none"
                      autoFocus
                    />
                    <button
                      onClick={saveRenaming}
                      className="p-1 rounded bg-accent text-accent-content"
                      title="Save"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={() => setIsRenaming(false)}
                      className="p-1 rounded bg-highlight text-secondary hover:text-primary"
                      title="Cancel"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-primary">{selectedPlaylist.name}</h2>
                    <button
                      onClick={startRenaming}
                      className="p-1 text-muted hover:text-primary transition-colors"
                      title="Rename Playlist"
                    >
                      <Edit2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'liked' && (
              <h2 className="text-lg font-bold text-primary">Liked Songs</h2>
            )}
          </div>

          {activeTab === 'playlists' && selectedPlaylist && (
            <button
              onClick={() => {
                if (confirm(`Delete playlist "${selectedPlaylist.name}"?`)) {
                  deletePlaylist(selectedPlaylist.id);
                  setSelectedPlaylistId(null);
                }
              }}
              className="text-xs text-muted hover:text-red-400 transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-elevated"
            >
              <Trash2 size={13} />
              <span>Delete Playlist</span>
            </button>
          )}
        </div>
      )}

      {/* Track Listing Table */}
      {currentList.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-12 px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider border-b border-customBorder/50">
            <span className="col-span-1">#</span>
            <span className="col-span-7 sm:col-span-6">Title</span>
            <span className="hidden sm:block sm:col-span-3">Artist / Album</span>
            <span className="col-span-4 sm:col-span-2 text-right">
              <Clock size={13} className="inline ml-auto" />
            </span>
          </div>

          <div className="flex flex-col gap-1 mt-1">
            {currentList.map((track, idx) => {
              const isCurrent = currentTrack?.id === track.id;
              return (
                <div
                  key={`${track.id}-${idx}`}
                  data-testid="track-item"
                  onClick={() =>
                    playTrack(track, currentList, idx, {
                      origin: activeTab === 'liked' ? 'library' : 'user_playlist',
                      playlistId: selectedPlaylist?.id,
                    })
                  }
                  className={`group grid grid-cols-12 items-center px-4 py-2.5 rounded-lg transition-colors cursor-pointer ${
                    isCurrent ? 'bg-elevated' : 'hover:bg-elevated/50'
                  }`}
                >
                  {/* Track Index / Reorder controls in playlists */}
                  <div className="col-span-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <span className="text-xs text-muted group-hover:hidden w-4 text-center">
                      {idx + 1}
                    </span>
                    <span
                      onClick={() =>
                        playTrack(track, currentList, idx, {
                          origin: activeTab === 'liked' ? 'library' : 'user_playlist',
                          playlistId: selectedPlaylist?.id,
                        })
                      }
                      className="hidden group-hover:block text-accent cursor-pointer w-4 text-center"
                    >
                      <Play size={14} fill="currentColor" />
                    </span>

                    {activeTab === 'playlists' && selectedPlaylist && (
                      <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                        <button
                          disabled={idx === 0}
                          onClick={() => reorderPlaylistTracks(selectedPlaylist.id, idx, idx - 1)}
                          className="text-muted hover:text-primary disabled:opacity-20 p-0.5"
                          title="Move up"
                        >
                          <ChevronUp size={11} />
                        </button>
                        <button
                          disabled={idx === currentList.length - 1}
                          onClick={() => reorderPlaylistTracks(selectedPlaylist.id, idx, idx + 1)}
                          className="text-muted hover:text-primary disabled:opacity-20 p-0.5"
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
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm font-semibold truncate ${
                          isCurrent ? 'text-accent' : 'text-primary'
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
                  <span className="hidden sm:block sm:col-span-3 text-xs text-muted truncate">
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
                      className="p-1 text-secondary hover:text-accent transition-colors"
                      title={isLiked(track.id) ? 'Unlike' : 'Like'}
                    >
                      <Heart
                        size={15}
                        className={isLiked(track.id) ? 'text-accent fill-accent' : ''}
                      />
                    </button>

                    {activeTab === 'playlists' && selectedPlaylist && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTrackFromPlaylist(selectedPlaylist.id, track.id);
                        }}
                        className="p-1 text-muted hover:text-red-400 transition-colors"
                        title="Remove from playlist"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}

                    <span>{formatDuration(track.duration)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-center py-20 text-muted">
          <Disc3 size={40} className="mx-auto opacity-30 mb-3" />
          <p className="text-base font-semibold text-primary">
            {activeTab === 'liked' ? 'No liked songs yet' : 'This playlist is empty'}
          </p>
          <p className="text-xs text-secondary mt-1">
            {activeTab === 'liked'
              ? 'Tap the heart icon on any song to save it to your library.'
              : 'Add tracks to this playlist or click "Import from Spotify" to import a playlist.'}
          </p>
        </div>
      )}
        </>
      )}
    </div>
  );
};
