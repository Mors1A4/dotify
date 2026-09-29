import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { usePlayerStore } from '../../store/playerStore';
import {
  fetchSpotifyPreview,
  saveSpotifyPlaylistToStore,
  validateSpotifyUrl,
} from '../../services/spotifyImporter';
import { fetchTopCharts, searchCharts } from '../../services/chartsApi';
import { SpotifyImportPreview } from '../../types/playlist';
import { Track } from '../../types/track';
import { PlaylistArtwork } from '../common/PlaylistArtwork';
import { upgradeArtworkUrl } from '../../utils/artwork';
import {
  getTrackArtwork,
  resolveTrackArtwork,
  DEFAULT_MUSIC_ARTWORK,
  isUglyPlaceholder,
} from '../../services/artworkService';
import {
  X,
  Sparkles,
  Loader2,
  Check,
  Plus,
  ListMusic,
  Link2,
  Upload,
  Search,
  Play,
  Disc3,
  ClipboardPaste,
  Music,
  Wand2,
  CheckCircle2,
  Image as ImageIcon,
} from 'lucide-react';

export interface CoverPreset {
  id: string;
  label: string;
  url: string;
}

function makeSvgCover(
  bgStart: string,
  bgMid: string,
  bgEnd: string,
  accent: string,
  titleText: string
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bgStart}" />
        <stop offset="50%" stop-color="${bgMid}" />
        <stop offset="100%" stop-color="${bgEnd}" />
      </linearGradient>
      <radialGradient id="r" cx="75%" cy="25%" r="60%">
        <stop offset="0%" stop-color="${accent}" stop-opacity="0.45" />
        <stop offset="100%" stop-color="${bgEnd}" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect width="400" height="400" fill="url(#g)" />
    <rect width="400" height="400" fill="url(#r)" />
    <circle cx="200" cy="200" r="130" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2" />
    <circle cx="200" cy="200" r="95" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1.5" />
    <circle cx="200" cy="200" r="60" fill="none" stroke="${accent}" stroke-opacity="0.35" stroke-width="2" />
    <circle cx="200" cy="200" r="18" fill="${accent}" fill-opacity="0.85" />
    <text x="28" y="364" fill="rgba(255,255,255,0.9)" font-family="system-ui, -apple-system, sans-serif" font-weight="800" font-size="22" letter-spacing="1.5">${titleText}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const PLAYLIST_COVER_PRESETS: CoverPreset[] = [
  {
    id: 'auto',
    label: 'Auto Collage',
    url: '',
  },
  {
    id: 'emerald-pulse',
    label: 'Emerald Pulse',
    url: makeSvgCover('#052e16', '#064e3b', '#090d16', '#1DB954', 'DOTIFY MIX'),
  },
  {
    id: 'midnight-synth',
    label: 'Midnight Synth',
    url: makeSvgCover('#1e1b4b', '#3b0764', '#090a0f', '#c084fc', 'SYNTHWAVE'),
  },
  {
    id: 'sunset-vinyl',
    label: 'Sunset Vinyl',
    url: makeSvgCover('#450a0a', '#7c2d12', '#111827', '#fb923c', 'GOLDEN HOUR'),
  },
  {
    id: 'cyber-neon',
    label: 'Cyber Neon',
    url: makeSvgCover('#0f172a', '#1e3a8a', '#020617', '#38bdf8', 'NIGHT DRIVE'),
  },
  {
    id: 'velvet-lounge',
    label: 'Velvet R&B',
    url: makeSvgCover('#4c0519', '#831843', '#09090b', '#f472b6', 'VELVET VIBES'),
  },
  {
    id: 'deep-lofi',
    label: 'Lo-Fi Chill',
    url: makeSvgCover('#134e4a', '#115e59', '#042f2e', '#2dd4bf', 'LO-FI STUDY'),
  },
  {
    id: 'crimson-stage',
    label: 'Crimson Rock',
    url: makeSvgCover('#3f0d12', '#7f1d1d', '#09090b', '#f87171', 'ANTHEMS'),
  },
];

const NAME_SUGGESTIONS = [
  'Late Night Drive',
  'Chill Lo-Fi Study',
  'Workout & Hype',
  'Weekend Vibes',
  'Throwback Classics',
];

const FEATURED_SPOTIFY_PLAYLISTS = [
  {
    label: "Today's Top Hits",
    url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
  },
  {
    label: 'Chill Hits',
    url: 'https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6',
  },
  {
    label: 'Rock Classics',
    url: 'https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U',
  },
  {
    label: 'RapCaviar',
    url: 'https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd',
  },
];

export const CreatePlaylistModal: React.FC = () => {
  const {
    isCreatePlaylistModalOpen,
    createPlaylistModalTab,
    createPlaylistInitialTracks,
    closeCreatePlaylistModal,
    createPlaylist,
    navigateToPlaylist,
    playTrack,
    likedTracks,
  } = usePlayerStore();

  const [activeTab, setActiveTab] = useState<'custom' | 'spotify'>('custom');

  // Custom Playlist State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coverArt, setCoverArt] = useState('');
  const [customImageUrlInput, setCustomImageUrlInput] = useState('');
  const [showImageUrlInput, setShowImageUrlInput] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState<Track[]>([]);
  const [starterSearchQuery, setStarterSearchQuery] = useState('');
  const [starterCandidates, setStarterCandidates] = useState<Track[]>([]);
  const [isSearchingStarter, setIsSearchingStarter] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Spotify Import State
  const [spotifyUrl, setSpotifyUrl] = useState('');
  const [isResolvingSpotify, setIsResolvingSpotify] = useState(false);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  const [spotifyPreview, setSpotifyPreview] = useState<SpotifyImportPreview | null>(null);
  const [editableSpotifyTitle, setEditableSpotifyTitle] = useState('');
  const [editableSpotifyDesc, setEditableSpotifyDesc] = useState('');
  const [excludedSpotifyTrackIndices, setExcludedSpotifyTrackIndices] = useState<Set<number>>(
    new Set()
  );
  const [spotifyTrackFilter, setSpotifyTrackFilter] = useState('');

  // Sync initial state when modal opens
  useEffect(() => {
    if (isCreatePlaylistModalOpen) {
      setActiveTab(createPlaylistModalTab || 'custom');
      setName('');
      setDescription('');
      setCoverArt('');
      setCustomImageUrlInput('');
      setShowImageUrlInput(false);
      setSelectedTracks(createPlaylistInitialTracks || []);
      setStarterSearchQuery('');
      setSpotifyUrl('');
      setSpotifyError(null);
      setSpotifyPreview(null);
      setEditableSpotifyTitle('');
      setEditableSpotifyDesc('');
      setExcludedSpotifyTrackIndices(new Set());
      setSpotifyTrackFilter('');

      // Load initial starter track suggestions (Liked Songs or Top Charts)
      if (likedTracks.length > 0) {
        setStarterCandidates(likedTracks.slice(0, 12));
      } else {
        fetchTopCharts(10)
          .then((charts) => setStarterCandidates(charts))
          .catch(() => {});
      }
    }
  }, [isCreatePlaylistModalOpen, createPlaylistModalTab, createPlaylistInitialTracks]);

  // Search starter tracks when query changes
  useEffect(() => {
    if (!isCreatePlaylistModalOpen || activeTab !== 'custom') return;
    if (!starterSearchQuery.trim()) {
      if (likedTracks.length > 0) {
        setStarterCandidates(likedTracks.slice(0, 12));
      } else {
        fetchTopCharts(10)
          .then((charts) => setStarterCandidates(charts))
          .catch(() => {});
      }
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingStarter(true);
      try {
        const results = await searchCharts(starterSearchQuery, 12);
        setStarterCandidates(results);
      } catch {
        // Ignore error
      } finally {
        setIsSearchingStarter(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [starterSearchQuery, isCreatePlaylistModalOpen, activeTab]);

  if (!isCreatePlaylistModalOpen) return null;

  const detectedSpotifyInName = validateSpotifyUrl(name);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCoverArt(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const toggleSelectStarterTrack = (track: Track) => {
    setSelectedTracks((prev) => {
      const exists = prev.some((t) => t.id === track.id);
      if (exists) return prev.filter((t) => t.id !== track.id);
      return [...prev, track];
    });
  };

  const handleCreateCustomPlaylist = (e?: React.FormEvent, playImmediately = false) => {
    if (e) e.preventDefault();
    const finalName = name.trim() || 'My Playlist';
    const finalCover = showImageUrlInput && customImageUrlInput.trim() ? customImageUrlInput.trim() : coverArt;
    const newId = createPlaylist(finalName, description.trim(), finalCover, selectedTracks);
    closeCreatePlaylistModal();
    if (newId) {
      navigateToPlaylist(newId);
      if (playImmediately && selectedTracks.length > 0) {
        playTrack(selectedTracks[0], selectedTracks);
      }
    }
  };

  const handleResolveSpotify = async (urlToResolve?: string) => {
    const target = (urlToResolve ?? spotifyUrl).trim();
    if (!target) return;

    setIsResolvingSpotify(true);
    setSpotifyError(null);
    try {
      const result = await fetchSpotifyPreview(target);
      setSpotifyPreview(result);
      setEditableSpotifyTitle(result.playlistTitle);
      setEditableSpotifyDesc(result.playlistDescription || '');
      setExcludedSpotifyTrackIndices(new Set());
    } catch (err: any) {
      setSpotifyError(
        err.message || 'Failed to resolve Spotify link. Make sure the playlist is public.'
      );
      setSpotifyPreview(null);
    } finally {
      setIsResolvingSpotify(false);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        setSpotifyUrl(text.trim());
        const validation = validateSpotifyUrl(text.trim());
        if (validation.isValid) {
          handleResolveSpotify(text.trim());
        }
      }
    } catch {
      // Clipboard permission denied or unavailable
    }
  };

  const toggleSpotifyTrackSelection = (idx: number) => {
    setExcludedSpotifyTrackIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const handleSaveSpotifyPlaylist = (playImmediately = false) => {
    if (!spotifyPreview) return;
    const finalTracks = spotifyPreview.resolvedTracks.filter(
      (_, idx) => !excludedSpotifyTrackIndices.has(idx)
    );
    const playlistId = saveSpotifyPlaylistToStore(spotifyPreview, {
      customName: editableSpotifyTitle,
      customDescription: editableSpotifyDesc,
      customCoverUrl: spotifyPreview.playlistCoverUrl,
      tracks: finalTracks,
    });
    closeCreatePlaylistModal();
    navigateToPlaylist(playlistId);
    if (playImmediately && finalTracks.length > 0) {
      playTrack(finalTracks[0], finalTracks);
    }
  };

  const formatDuration = (sec: number) => {
    if (!sec || !isFinite(sec)) return '3:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const includedSpotifyTracksCount = spotifyPreview
    ? spotifyPreview.resolvedTracks.length - excludedSpotifyTrackIndices.size
    : 0;

  const totalSpotifyDurationSec = spotifyPreview
    ? spotifyPreview.resolvedTracks
        .filter((_, idx) => !excludedSpotifyTrackIndices.has(idx))
        .reduce((acc, t) => acc + (t.duration || 0), 0)
    : 0;

  const previewCollageUrls = selectedTracks
    .map((t) => t.artworkUrl)
    .filter((u): u is string => Boolean(u))
    .slice(0, 4);

  const modalContent = (
    <div
      data-testid="create-playlist-modal"
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={closeCreatePlaylistModal}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl bg-surface border border-customBorder rounded-3xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden"
      >
        {/* Top Ambient Accent Bar */}
        <div
          className={`h-1.5 w-full ${
            activeTab === 'spotify'
              ? 'bg-gradient-to-r from-[#1DB954] via-emerald-400 to-[#1DB954]'
              : 'bg-gradient-to-r from-accent via-purple-500 to-accent'
          }`}
        />

        {/* Modal Header & Mode Switcher */}
        <div className="px-6 pt-5 pb-4 border-b border-customBorder/60 flex flex-col gap-4 bg-elevated/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg ${
                  activeTab === 'spotify'
                    ? 'bg-[#1DB954]/20 text-[#1DB954] border border-[#1DB954]/30'
                    : 'bg-accent/20 text-accent border border-accent/30'
                }`}
              >
                {activeTab === 'spotify' ? <Sparkles size={20} /> : <ListMusic size={20} />}
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-extrabold text-primary tracking-tight">
                  {activeTab === 'spotify' ? 'Copy Playlist from Spotify' : 'Create New Playlist'}
                </h2>
                <p className="text-xs text-secondary">
                  {activeTab === 'spotify'
                    ? 'Paste a Spotify playlist or album link for an exact 1:1 copy'
                    : 'Design a custom playlist with cover art, vibe notes, and starter tracks'}
                </p>
              </div>
            </div>

            <button
              onClick={closeCreatePlaylistModal}
              aria-label="Close modal"
              className="p-2 rounded-full bg-elevated hover:bg-highlight text-secondary hover:text-primary transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Segmented Mode Tabs */}
          <div className="grid grid-cols-2 p-1 rounded-2xl bg-base/80 border border-customBorder/60">
            <button
              type="button"
              data-testid="tab-custom-playlist"
              onClick={() => setActiveTab('custom')}
              className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'custom'
                  ? 'bg-elevated text-primary shadow-md border border-customBorder'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              <Wand2 size={15} className={activeTab === 'custom' ? 'text-accent' : ''} />
              <span>Custom Playlist</span>
            </button>

            <button
              type="button"
              data-testid="tab-spotify-import"
              onClick={() => setActiveTab('spotify')}
              className={`flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold transition-all ${
                activeTab === 'spotify'
                  ? 'bg-[#1DB954] text-white shadow-md font-extrabold'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              <Link2 size={15} />
              <span>Copy from Spotify Link</span>
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          {activeTab === 'custom' ? (
            <>
              {/* Top Studio Section: Cover Art + Name/Description */}
              <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start">
                {/* Left: Live Cover Art Preview */}
                <div className="flex flex-col items-center gap-2.5 shrink-0">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="group relative w-36 h-36 sm:w-40 sm:h-40 rounded-2xl overflow-hidden bg-elevated border-2 border-customBorder hover:border-accent shadow-2xl cursor-pointer flex items-center justify-center transition-all"
                    title="Click to upload custom cover image"
                  >
                    {showImageUrlInput && customImageUrlInput.trim() ? (
                      <PlaylistArtwork
                        coverArt={customImageUrlInput.trim()}
                        tracks={selectedTracks}
                        alt="Cover Preview"
                        className="w-full h-full object-cover"
                        iconSize={42}
                      />
                    ) : coverArt ? (
                      <PlaylistArtwork
                        coverArt={coverArt}
                        tracks={selectedTracks}
                        alt="Cover Preview"
                        className="w-full h-full object-cover"
                        iconSize={42}
                      />
                    ) : selectedTracks.length > 0 ? (
                      <PlaylistArtwork
                        coverArt={null}
                        tracks={selectedTracks}
                        alt="Cover Preview"
                        className="w-full h-full object-cover"
                        iconSize={42}
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-accent/25 via-elevated to-purple-900/40 flex flex-col items-center justify-center gap-2 text-accent p-4 text-center">
                        <ListMusic size={42} className="opacity-85" />
                        <span className="text-[11px] font-bold text-primary/90 truncate max-w-full px-1">
                          {name.trim() || 'My Playlist'}
                        </span>
                      </div>
                    )}

                    {/* Hover Upload Overlay */}
                    <div className="absolute inset-0 bg-black/65 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 text-white p-2 text-center">
                      <Upload size={22} className="text-accent" />
                      <span className="text-[11px] font-bold">Upload Photo</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[11px] font-semibold text-secondary hover:text-primary flex items-center gap-1 px-2 py-1 rounded-lg bg-elevated hover:bg-highlight border border-customBorder/60 transition-colors"
                    >
                      <Upload size={11} />
                      <span>Upload</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowImageUrlInput(!showImageUrlInput)}
                      className="text-[11px] font-semibold text-secondary hover:text-primary flex items-center gap-1 px-2 py-1 rounded-lg bg-elevated hover:bg-highlight border border-customBorder/60 transition-colors"
                    >
                      <ImageIcon size={11} />
                      <span>Image URL</span>
                    </button>
                  </div>
                </div>

                {/* Right: Form Inputs */}
                <div className="flex-1 flex flex-col gap-3.5 w-full">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-secondary uppercase tracking-wider">
                      Playlist Name
                    </label>
                    <input
                      type="text"
                      data-testid="custom-playlist-name-input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !detectedSpotifyInName.isValid) {
                          handleCreateCustomPlaylist();
                        }
                      }}
                      placeholder="e.g., Late Night Drive, Workout Mix..."
                      autoFocus
                      className="w-full bg-elevated border border-customBorder focus:border-accent rounded-xl px-4 py-2.5 text-sm font-semibold text-primary placeholder-muted focus:outline-none transition-colors"
                    />

                    {/* Quick Name Suggestion Chips */}
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      <span className="text-[10px] font-semibold text-muted mr-0.5">Ideas:</span>
                      {NAME_SUGGESTIONS.map((idea) => (
                        <button
                          key={idea}
                          type="button"
                          onClick={() => setName(idea)}
                          className={`text-[11px] px-2.5 py-0.5 rounded-full border transition-all ${
                            name === idea
                              ? 'bg-accent/20 border-accent text-accent font-bold'
                              : 'bg-elevated/60 hover:bg-elevated border-customBorder/60 text-secondary hover:text-primary'
                          }`}
                        >
                          {idea}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Smart Detection if user pasted a Spotify link into Name */}
                  {detectedSpotifyInName.isValid && (
                    <div className="p-3 rounded-xl bg-[#1DB954]/15 border border-[#1DB954]/40 flex items-center justify-between gap-3 animate-in fade-in">
                      <div className="flex items-center gap-2 text-xs text-primary">
                        <Sparkles size={16} className="text-[#1DB954] shrink-0" />
                        <span>Spotify link detected! Want to copy all tracks & artwork 1:1?</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const link = name.trim();
                          setName('');
                          setSpotifyUrl(link);
                          setActiveTab('spotify');
                          handleResolveSpotify(link);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-[#1DB954] text-white font-extrabold text-xs shrink-0 hover:bg-[#1ed760] transition-colors"
                      >
                        Clone from Spotify
                      </button>
                    </div>
                  )}

                  {showImageUrlInput && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[11px] font-bold text-secondary uppercase tracking-wider">
                        Custom Cover Image URL
                      </label>
                      <input
                        type="url"
                        value={customImageUrlInput}
                        onChange={(e) => setCustomImageUrlInput(e.target.value)}
                        placeholder="https://images.unsplash.com/..."
                        className="w-full bg-elevated border border-customBorder focus:border-accent rounded-xl px-3.5 py-2 text-xs text-primary placeholder-muted focus:outline-none"
                      />
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-secondary uppercase tracking-wider">
                      Description <span className="text-muted font-normal lowercase">(optional)</span>
                    </label>
                    <textarea
                      rows={2}
                      data-testid="custom-playlist-desc-input"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Add an optional description, mood, or story for this playlist..."
                      className="w-full bg-elevated border border-customBorder focus:border-accent rounded-xl px-3.5 py-2 text-xs text-primary placeholder-muted focus:outline-none resize-none transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Cover Art Studio Presets Row */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-secondary uppercase tracking-wider">
                    Cover Art Style
                  </span>
                  <span className="text-[11px] text-muted">
                    Pick a studio cover or let tracks form a collage
                  </span>
                </div>

                <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                  {PLAYLIST_COVER_PRESETS.map((preset) => {
                    const isSelected = !showImageUrlInput && coverArt === preset.url;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setShowImageUrlInput(false);
                          setCoverArt(preset.url);
                        }}
                        className={`group flex flex-col items-center gap-1 p-1.5 rounded-xl border transition-all ${
                          isSelected
                            ? 'border-accent bg-accent/15 scale-105 shadow-md'
                            : 'border-customBorder/50 bg-elevated/40 hover:bg-elevated'
                        }`}
                        title={preset.label}
                      >
                        <div className="w-11 h-11 rounded-lg overflow-hidden bg-highlight flex items-center justify-center border border-white/10">
                          {preset.url ? (
                            <img
                              src={preset.url}
                              alt={preset.label}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="grid grid-cols-2 grid-rows-2 w-full h-full bg-gradient-to-br from-indigo-900 to-purple-900 p-1.5 gap-0.5">
                              <span className="bg-white/25 rounded-xs" />
                              <span className="bg-accent/40 rounded-xs" />
                              <span className="bg-accent/40 rounded-xs" />
                              <span className="bg-white/25 rounded-xs" />
                            </div>
                          )}
                        </div>
                        <span className="text-[10px] font-medium text-secondary truncate max-w-full">
                          {preset.label.split(' ')[0]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quick-Add Starter Songs Section */}
              <div className="flex flex-col gap-3 pt-2 border-t border-customBorder/50">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                      <Music size={14} className="text-accent" />
                      <span>Quick-Add Starter Songs</span>
                      {selectedTracks.length > 0 && (
                        <span className="ml-1 px-2 py-0.5 rounded-full bg-accent text-accent-content text-[10px] font-extrabold">
                          {selectedTracks.length} selected
                        </span>
                      )}
                    </h3>
                    <p className="text-[11px] text-secondary">
                      Search any song or pick from your favorites to pre-load your playlist
                    </p>
                  </div>

                  <div className="relative w-full sm:w-60">
                    <Search
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                    />
                    <input
                      type="text"
                      value={starterSearchQuery}
                      onChange={(e) => setStarterSearchQuery(e.target.value)}
                      placeholder="Search songs to add..."
                      className="w-full bg-elevated border border-customBorder focus:border-accent rounded-full pl-8 pr-3 py-1.5 text-xs text-primary placeholder-muted focus:outline-none"
                    />
                  </div>
                </div>

                {/* Candidate Track List */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-1">
                  {isSearchingStarter ? (
                    <div className="col-span-2 py-6 flex items-center justify-center gap-2 text-xs text-secondary">
                      <Loader2 size={16} className="animate-spin text-accent" />
                      <span>Searching tracks...</span>
                    </div>
                  ) : starterCandidates.length > 0 ? (
                    starterCandidates.map((track) => {
                      const isAdded = selectedTracks.some((t) => t.id === track.id);
                      return (
                        <div
                          key={track.id}
                          onClick={() => toggleSelectStarterTrack(track)}
                          className={`flex items-center justify-between gap-2.5 p-2 rounded-xl border cursor-pointer transition-all ${
                            isAdded
                              ? 'bg-accent/15 border-accent/50'
                              : 'bg-elevated/50 hover:bg-elevated border-customBorder/40'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <img
                              src={getTrackArtwork(track)}
                              alt={track.title}
                              className="w-9 h-9 rounded-lg object-cover bg-highlight shrink-0"
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
                              <p className="text-xs font-bold text-primary truncate">
                                {track.title}
                              </p>
                              <p className="text-[11px] text-secondary truncate">{track.artist}</p>
                            </div>
                          </div>

                          <button
                            type="button"
                            className={`px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1 shrink-0 transition-all ${
                              isAdded
                                ? 'bg-accent text-accent-content'
                                : 'bg-highlight text-secondary hover:text-primary'
                            }`}
                          >
                            {isAdded ? (
                              <>
                                <Check size={12} />
                                <span>Added</span>
                              </>
                            ) : (
                              <>
                                <Plus size={12} />
                                <span>Add</span>
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="col-span-2 py-4 text-center text-xs text-muted">
                      Type above to search millions of tracks.
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            /* TAB 2: SPOTIFY LINK CLONER */
            <div className="flex flex-col gap-5">
              {/* URL Input Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleResolveSpotify();
                }}
                className="flex flex-col gap-2.5"
              >
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-secondary uppercase tracking-wider">
                    Spotify Playlist, Album, or Track Link
                  </label>
                  <span className="text-[11px] text-[#1DB954] font-semibold flex items-center gap-1">
                    <CheckCircle2 size={12} />
                    <span>No Spotify login required</span>
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Link2
                      size={16}
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                    />
                    <input
                      type="text"
                      data-testid="spotify-url-input"
                      value={spotifyUrl}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSpotifyUrl(val);
                      }}
                      onPaste={(e) => {
                        const pasted = e.clipboardData.getData('text');
                        if (pasted && validateSpotifyUrl(pasted).isValid) {
                          setTimeout(() => handleResolveSpotify(pasted), 50);
                        }
                      }}
                      placeholder="https://open.spotify.com/playlist/..."
                      autoFocus
                      className="w-full bg-elevated border border-customBorder focus:border-[#1DB954] rounded-xl pl-10 pr-20 py-3 text-sm text-primary placeholder-muted focus:outline-none transition-colors"
                    />
                    <button
                      type="button"
                      onClick={handlePasteFromClipboard}
                      className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-highlight hover:bg-surface text-secondary hover:text-primary text-[11px] font-bold flex items-center gap-1 transition-colors"
                      title="Paste from clipboard"
                    >
                      <ClipboardPaste size={12} />
                      <span>Paste</span>
                    </button>
                  </div>

                  <button
                    type="submit"
                    data-testid="resolve-spotify-btn"
                    disabled={isResolvingSpotify || !spotifyUrl.trim()}
                    className="px-5 py-3 rounded-xl bg-[#1DB954] hover:bg-[#1ed760] text-black font-extrabold text-xs flex items-center gap-2 shadow-lg hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 transition-all shrink-0"
                  >
                    {isResolvingSpotify ? (
                      <>
                        <Loader2 size={15} className="animate-spin" />
                        <span>Cloning...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={15} />
                        <span>Fetch Playlist</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Quick-Try Featured Spotify Playlists */}
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  <span className="text-[10px] font-semibold text-muted mr-1">
                    Try popular Spotify playlists:
                  </span>
                  {FEATURED_SPOTIFY_PLAYLISTS.map((fp) => (
                    <button
                      key={fp.label}
                      type="button"
                      onClick={() => {
                        setSpotifyUrl(fp.url);
                        handleResolveSpotify(fp.url);
                      }}
                      className="text-[11px] px-2.5 py-0.5 rounded-full bg-elevated/70 hover:bg-[#1DB954]/20 border border-customBorder/60 hover:border-[#1DB954]/50 text-secondary hover:text-[#1DB954] font-medium transition-all"
                    >
                      {fp.label}
                    </button>
                  ))}
                </div>
              </form>

              {/* Loading Skeleton State */}
              {isResolvingSpotify && (
                <div className="p-8 rounded-2xl bg-elevated/40 border border-customBorder/60 flex flex-col items-center justify-center gap-3 text-center animate-pulse">
                  <div className="w-12 h-12 rounded-full bg-[#1DB954]/20 text-[#1DB954] flex items-center justify-center">
                    <Loader2 size={24} className="animate-spin" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-primary">
                      Extracting exact playlist & track artwork from Spotify...
                    </p>
                    <p className="text-xs text-secondary mt-0.5">
                      Matching cover art, album titles, and full-length audio streams
                    </p>
                  </div>
                </div>
              )}

              {/* Error Alert */}
              {spotifyError && (
                <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center justify-between gap-3">
                  <span>{spotifyError}</span>
                  <button
                    type="button"
                    onClick={() => setSpotifyError(null)}
                    className="text-red-300 hover:text-white font-bold"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Resolved 1:1 Preview Card */}
              {spotifyPreview && !isResolvingSpotify && (
                <div className="flex flex-col gap-4 p-4 sm:p-5 rounded-2xl bg-gradient-to-b from-elevated/90 to-elevated/40 border border-[#1DB954]/40 shadow-xl animate-in fade-in">
                  {/* Playlist Identity Header */}
                  <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
                    <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-2xl overflow-hidden shadow-2xl bg-highlight shrink-0 border border-white/10">
                      <PlaylistArtwork
                        coverArt={spotifyPreview.playlistCoverUrl}
                        tracks={spotifyPreview.resolvedTracks}
                        alt={editableSpotifyTitle}
                        className="w-full h-full object-cover"
                        iconSize={32}
                      />
                      <span className="absolute bottom-1.5 left-1.5 right-1.5 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md text-[#1DB954] font-extrabold text-[9px] uppercase tracking-wider text-center">
                        1:1 Exact Match
                      </span>
                    </div>

                    <div className="flex-1 flex flex-col gap-2 w-full min-w-0">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase tracking-wider">
                          Playlist Name (Editable)
                        </label>
                        <input
                          type="text"
                          value={editableSpotifyTitle}
                          onChange={(e) => setEditableSpotifyTitle(e.target.value)}
                          className="w-full bg-base/80 border border-customBorder focus:border-[#1DB954] rounded-xl px-3 py-1.5 text-base font-extrabold text-primary focus:outline-none"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-muted uppercase tracking-wider">
                          Description
                        </label>
                        <input
                          type="text"
                          value={editableSpotifyDesc}
                          onChange={(e) => setEditableSpotifyDesc(e.target.value)}
                          className="w-full bg-base/80 border border-customBorder focus:border-[#1DB954] rounded-xl px-3 py-1.5 text-xs text-secondary focus:text-primary focus:outline-none"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {spotifyPreview.playlistOwner && (
                          <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-highlight text-primary">
                            By {spotifyPreview.playlistOwner}
                          </span>
                        )}
                        <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#1DB954]/20 text-[#1DB954]">
                          {includedSpotifyTracksCount} of {spotifyPreview.resolvedTracks.length} songs
                        </span>
                        {totalSpotifyDurationSec > 0 && (
                          <span className="text-[11px] text-muted font-medium">
                            • {Math.max(1, Math.round(totalSpotifyDurationSec / 60))} min total
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Tracklist Filter & Select All Controls */}
                  <div className="flex flex-col gap-2 border-t border-customBorder/50 pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] uppercase font-bold text-muted tracking-wider">
                          Tracks Included ({includedSpotifyTracksCount})
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (excludedSpotifyTrackIndices.size > 0) {
                              setExcludedSpotifyTrackIndices(new Set());
                            } else {
                              setExcludedSpotifyTrackIndices(
                                new Set(spotifyPreview.resolvedTracks.map((_, i) => i))
                              );
                            }
                          }}
                          className="text-[11px] text-[#1DB954] hover:underline font-semibold"
                        >
                          {excludedSpotifyTrackIndices.size > 0 ? 'Select All' : 'Deselect All'}
                        </button>
                      </div>

                      {spotifyPreview.resolvedTracks.length > 6 && (
                        <input
                          type="text"
                          value={spotifyTrackFilter}
                          onChange={(e) => setSpotifyTrackFilter(e.target.value)}
                          placeholder="Filter tracks..."
                          className="bg-base/70 border border-customBorder rounded-lg px-2.5 py-1 text-xs text-primary placeholder-muted focus:outline-none focus:border-[#1DB954] w-40"
                        />
                      )}
                    </div>

                    {/* Scrollable Track Rows with Individual Cover Art */}
                    <div className="flex flex-col gap-1 max-h-56 overflow-y-auto pr-1">
                      {spotifyPreview.resolvedTracks.map((track, idx) => {
                        if (
                          spotifyTrackFilter.trim() &&
                          !track.title.toLowerCase().includes(spotifyTrackFilter.toLowerCase()) &&
                          !track.artist.toLowerCase().includes(spotifyTrackFilter.toLowerCase())
                        ) {
                          return null;
                        }
                        const isIncluded = !excludedSpotifyTrackIndices.has(idx);
                        return (
                          <div
                            key={track.id || idx}
                            onClick={() => toggleSpotifyTrackSelection(idx)}
                            className={`flex items-center justify-between gap-3 p-2 rounded-xl cursor-pointer transition-colors ${
                              isIncluded
                                ? 'hover:bg-highlight/70 bg-base/40'
                                : 'opacity-45 bg-base/20 hover:opacity-70'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div
                                className={`w-4 h-4 rounded flex items-center justify-center border text-[10px] shrink-0 transition-colors ${
                                  isIncluded
                                    ? 'bg-[#1DB954] border-[#1DB954] text-black font-bold'
                                    : 'border-muted bg-transparent'
                                }`}
                              >
                                {isIncluded && <Check size={11} strokeWidth={3} />}
                              </div>

                              <span className="text-[11px] font-mono text-muted w-5 text-right shrink-0">
                                {idx + 1}
                              </span>

                              <img
                                src={track.artworkUrl || spotifyPreview.playlistCoverUrl || getTrackArtwork(track)}
                                alt={track.title}
                                className="w-9 h-9 rounded-lg object-cover bg-highlight shrink-0"
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
                                <p className="text-xs font-bold text-primary truncate">
                                  {track.title}
                                </p>
                                <p className="text-[11px] text-secondary truncate">
                                  {track.artist}
                                  {track.album && track.album !== spotifyPreview.playlistTitle
                                    ? ` • ${track.album}`
                                    : ''}
                                </p>
                              </div>
                            </div>

                            <span className="text-[11px] font-mono text-muted shrink-0">
                              {formatDuration(track.duration)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-customBorder/60 bg-elevated/40 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={closeCreatePlaylistModal}
            className="px-4 py-2.5 rounded-full bg-elevated hover:bg-highlight text-secondary hover:text-primary text-xs font-bold transition-colors"
          >
            Cancel
          </button>

          {activeTab === 'custom' ? (
            <div className="flex items-center gap-2.5">
              {selectedTracks.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleCreateCustomPlaylist(undefined, true)}
                  className="px-4 py-2.5 rounded-full bg-elevated hover:bg-highlight border border-accent/40 text-accent text-xs font-bold flex items-center gap-1.5 transition-all"
                >
                  <Play size={14} fill="currentColor" />
                  <span>Create & Play</span>
                </button>
              )}
              <button
                type="button"
                data-testid="confirm-create-playlist-btn"
                onClick={() => handleCreateCustomPlaylist()}
                className="px-6 py-2.5 rounded-full bg-accent text-accent-content font-extrabold text-xs flex items-center gap-2 shadow-xl hover:scale-105 active:scale-95 transition-all"
              >
                <Check size={15} />
                <span>
                  Create Playlist
                  {selectedTracks.length > 0 ? ` (${selectedTracks.length})` : ''}
                </span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              {spotifyPreview && includedSpotifyTracksCount > 0 && (
                <button
                  type="button"
                  onClick={() => handleSaveSpotifyPlaylist(true)}
                  className="px-4 py-2.5 rounded-full bg-elevated hover:bg-highlight border border-[#1DB954]/50 text-[#1DB954] text-xs font-bold flex items-center gap-1.5 transition-all"
                >
                  <Play size={14} fill="currentColor" />
                  <span>Create & Play Now</span>
                </button>
              )}
              <button
                type="button"
                data-testid="save-spotify-playlist-btn"
                disabled={!spotifyPreview || includedSpotifyTracksCount === 0}
                onClick={() => handleSaveSpotifyPlaylist(false)}
                className="px-6 py-2.5 rounded-full bg-[#1DB954] hover:bg-[#1ed760] text-black font-extrabold text-xs flex items-center gap-2 shadow-xl hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 transition-all"
              >
                <Check size={15} />
                <span>
                  {spotifyPreview
                    ? `Create Playlist (${includedSpotifyTracksCount} Songs)`
                    : 'Save as Dotify Playlist'}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
};
