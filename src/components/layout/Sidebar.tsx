import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { usePlayerStore, AppView } from '../../store/playerStore';
import { SpotifyImportModal } from '../modals/SpotifyImportModal';
import { PlaylistArtwork } from '../common/PlaylistArtwork';
import { BrandLogo } from '../common/BrandLogo';
import {
  Home,
  Search,
  Library,
  Heart,
  Plus,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  X,
  Check,
  Pin,
  Users,
  Music2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useUpdateStore } from '../../store/updateStore';

type LibraryFilter = 'all' | 'playlists' | 'artists';

export const Sidebar: React.FC = () => {
  const {
    activeView,
    setActiveView,
    searchQuery,
    setSearchQuery,
    selectedPlaylistId,
    selectedArtist,
    navigateToPlaylist,
    navigateToArtist,
    isSidebarCollapsed,
    toggleSidebarCollapse,
    likedTracks,
    playlists,
    followedArtists,
    createPlaylist,
    playTrack,
    currentTrack,
    isPlaying,
    togglePlay,
  } = usePlayerStore();

  const { currentVersion, isChecking, checkForUpdates } = useUpdateStore();

  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all');
  const [librarySearch, setLibrarySearch] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isSpotifyModalOpen, setIsSpotifyModalOpen] = useState(false);

  const createInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreatingPlaylist) {
      createInputRef.current?.focus();
    }
  }, [isCreatingPlaylist]);

  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isSearchOpen]);

  const navItems: { id: AppView; label: string; icon: React.ReactNode }[] = [
    { id: 'home', label: 'Home', icon: <Home size={20} /> },
    { id: 'search', label: 'Search', icon: <Search size={20} /> },
  ];

  const handleCreatePlaylistSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newPlaylistName.trim();
    if (!trimmed) return;
    const newId = createPlaylist(trimmed);
    setNewPlaylistName('');
    setIsCreatingPlaylist(false);
    if (newId) {
      navigateToPlaylist(newId);
    }
  };

  const normalizedQuery = librarySearch.trim().toLowerCase();

  const filteredPlaylists = playlists.filter((pl) =>
    !normalizedQuery ? true : pl.name.toLowerCase().includes(normalizedQuery)
  );

  const filteredArtists = (followedArtists || []).filter((artist) =>
    !normalizedQuery ? true : artist.name.toLowerCase().includes(normalizedQuery)
  );

  const showLikedSongs =
    libraryFilter !== 'artists' &&
    (!normalizedQuery || 'liked songs'.includes(normalizedQuery));

  const showPlaylists = libraryFilter === 'all' || libraryFilter === 'playlists';
  const showArtists = libraryFilter === 'all' || libraryFilter === 'artists';

  const handleBrandClick = () => {
    if (activeView !== 'home') {
      setActiveView('home');
    }
    if (searchQuery) {
      setSearchQuery('');
    }
    const content = document.getElementById('content');
    if (content) {
      content.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const isLikedPlaying =
    Boolean(currentTrack) &&
    likedTracks.some((t) => t.id === currentTrack?.id) &&
    activeView === 'library';

  return (
    <aside
      data-testid="desktop-sidebar"
      style={{
        width: isSidebarCollapsed ? 72 : 280,
        minWidth: isSidebarCollapsed ? 72 : 280,
      }}
      className="hidden md:flex flex-col bg-base p-2 gap-2 select-none z-20 transition-[width,min-width] duration-200 ease-out"
    >
      {/* Top Card: Brand + Primary Navigation */}
      <div className="bg-surface rounded-xl border border-customBorder/60 p-3 flex flex-col gap-2 shadow-sm">
        {/* Brand Header */}
        <div
          className={`flex items-center ${
            isSidebarCollapsed ? 'justify-center' : 'justify-between'
          } px-1 py-1`}
        >
          {!isSidebarCollapsed && (
            <div
              className="flex items-center gap-2.5 cursor-pointer group select-none"
              onClick={handleBrandClick}
              title="Dotify Home"
            >
              <BrandLogo
                size={28}
                className="transition-opacity group-hover:opacity-85"
              />
              <span className="font-extrabold text-lg tracking-tight text-primary group-hover:text-accent transition-colors">
                dotify
              </span>
            </div>
          )}

          {isSidebarCollapsed && (
            <button
              onClick={handleBrandClick}
              title="Dotify Home"
              aria-label="Dotify Home"
              className="p-1.5 rounded-lg hover:bg-elevated transition-colors cursor-pointer flex items-center justify-center"
            >
              <BrandLogo
                size={24}
              />
            </button>
          )}

          {!isSidebarCollapsed && (
            <button
              onClick={toggleSidebarCollapse}
              data-testid="collapse-sidebar"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
            >
              <ChevronLeft size={17} />
            </button>
          )}
        </div>

        {isSidebarCollapsed && (
          <button
            onClick={toggleSidebarCollapse}
            data-testid="collapse-sidebar"
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="mx-auto p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
          >
            <ChevronRight size={17} />
          </button>
        )}

        {/* Primary Nav Links */}
        <nav aria-label="Primary Navigation" className="flex flex-col gap-1">
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveView(item.id)}
                title={isSidebarCollapsed ? item.label : undefined}
                className={`group relative flex items-center gap-3.5 px-3 py-2.5 rounded-lg transition-all duration-150 text-sm cursor-pointer ${
                  isActive
                    ? 'bg-elevated text-primary font-bold shadow-sm'
                    : 'text-secondary hover:text-primary hover:bg-elevated/50 font-medium'
                } ${isSidebarCollapsed ? 'justify-center px-0' : ''}`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-accent" />
                )}
                <span
                  className={`transition-colors ${
                    isActive
                      ? 'text-accent'
                      : 'text-secondary group-hover:text-primary'
                  }`}
                >
                  {item.icon}
                </span>
                {!isSidebarCollapsed && (
                  <span className="truncate">{item.label}</span>
                )}
              </button>
            );
          })}

        </nav>
      </div>

      {/* Bottom Card: Your Library */}
      <div className="flex-1 bg-surface rounded-xl border border-customBorder/60 flex flex-col min-h-0 shadow-sm overflow-hidden">
        {/* Library Header */}
        <div className="px-3 pt-3 pb-2 flex flex-col gap-2.5 border-b border-customBorder/40">
          <div
            className={`flex items-center ${
              isSidebarCollapsed ? 'justify-center' : 'justify-between'
            }`}
          >
            <button
              onClick={() => setActiveView('library')}
              title={isSidebarCollapsed ? 'Your Library' : 'Open Your Library'}
              className={`group flex items-center gap-3 px-2 py-1.5 rounded-lg transition-colors cursor-pointer ${
                activeView === 'library'
                  ? 'text-primary font-bold'
                  : 'text-secondary hover:text-primary font-semibold'
              }`}
            >
              <Library
                size={20}
                className={
                  activeView === 'library'
                    ? 'text-accent'
                    : 'text-secondary group-hover:text-primary transition-colors'
                }
              />
              {!isSidebarCollapsed && (
                <span className="text-sm tracking-tight">Your Library</span>
              )}
            </button>

            {!isSidebarCollapsed && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setIsSearchOpen((prev) => {
                      if (prev) setLibrarySearch('');
                      return !prev;
                    });
                  }}
                  aria-label="Filter library"
                  title="Search in Your Library"
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    isSearchOpen || librarySearch
                      ? 'bg-elevated text-accent'
                      : 'text-secondary hover:text-primary hover:bg-elevated'
                  }`}
                >
                  <Search size={15} />
                </button>

                <button
                  onClick={() => setIsSpotifyModalOpen(true)}
                  aria-label="Import from Spotify"
                  title="Import Spotify Playlist"
                  className="p-1.5 rounded-lg text-secondary hover:text-accent hover:bg-elevated transition-colors cursor-pointer"
                >
                  <Sparkles size={15} />
                </button>

                <button
                  onClick={() => setIsCreatingPlaylist((prev) => !prev)}
                  data-testid="sidebar-create-playlist-btn"
                  aria-label="Create playlist"
                  title="Create new playlist"
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    isCreatingPlaylist
                      ? 'bg-accent text-accent-content'
                      : 'text-secondary hover:text-primary hover:bg-elevated'
                  }`}
                >
                  <Plus size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Filter Pills */}
          {!isSidebarCollapsed && (
            <div className="flex items-center gap-1.5 px-1">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'playlists', label: 'Playlists' },
                  { id: 'artists', label: 'Artists' },
                ] as { id: LibraryFilter; label: string }[]
              ).map((tab) => {
                const active = libraryFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setLibraryFilter(tab.id)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer ${
                      active
                        ? 'bg-accent text-accent-content shadow-sm'
                        : 'bg-elevated/70 text-secondary hover:text-primary hover:bg-elevated'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Inline Library Search Box */}
          {!isSidebarCollapsed && isSearchOpen && (
            <div className="relative flex items-center px-1 animate-in fade-in duration-150">
              <Search
                size={13}
                className="absolute left-3.5 text-muted pointer-events-none"
              />
              <input
                ref={searchInputRef}
                type="text"
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setLibrarySearch('');
                    setIsSearchOpen(false);
                  }
                }}
                placeholder="Filter library..."
                className="w-full bg-elevated/90 text-primary placeholder-muted text-xs pl-7 pr-7 py-1.5 rounded-lg border border-customBorder focus:border-accent outline-none transition-colors"
              />
              {librarySearch && (
                <button
                  onClick={() => setLibrarySearch('')}
                  className="absolute right-3 text-muted hover:text-primary p-0.5 cursor-pointer"
                  title="Clear filter"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}

          {/* Inline Create Playlist Input Card */}
          {!isSidebarCollapsed && isCreatingPlaylist && (
            <form
              onSubmit={handleCreatePlaylistSubmit}
              className="mx-1 p-2.5 rounded-xl bg-elevated border border-accent/40 flex flex-col gap-2 shadow-lg animate-in fade-in duration-150"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-primary">
                  New Playlist
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingPlaylist(false);
                    setNewPlaylistName('');
                  }}
                  className="text-muted hover:text-primary p-0.5 cursor-pointer"
                >
                  <X size={13} />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  ref={createInputRef}
                  type="text"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsCreatingPlaylist(false);
                      setNewPlaylistName('');
                    }
                  }}
                  placeholder="My Awesome Mix..."
                  className="flex-1 min-w-0 bg-base text-primary placeholder-muted text-xs px-2.5 py-1.5 rounded-lg border border-customBorder focus:border-accent outline-none"
                />
                <button
                  type="submit"
                  disabled={!newPlaylistName.trim()}
                  className="p-1.5 rounded-lg bg-accent text-accent-content hover:brightness-110 disabled:opacity-40 transition-all cursor-pointer flex-shrink-0"
                  title="Create Playlist"
                >
                  <Check size={14} />
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Scrollable Library Items */}
        <div className="flex-1 px-2 py-2 flex flex-col gap-1 overflow-y-auto scrollbar-thin">
          {/* Liked Songs Pinned Row */}
          {showLikedSongs && (
            <div
              onClick={() => setActiveView('library')}
              title={
                isSidebarCollapsed
                  ? `Liked Songs (${likedTracks.length})`
                  : undefined
              }
              className={`group flex items-center gap-3 p-2 rounded-lg transition-all duration-150 cursor-pointer ${
                activeView === 'library'
                  ? 'bg-elevated text-primary'
                  : 'text-secondary hover:text-primary hover:bg-elevated/50'
              } ${isSidebarCollapsed ? 'justify-center px-0' : ''}`}
            >
              <div className="relative w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-400 flex items-center justify-center text-white flex-shrink-0 shadow-md overflow-hidden">
                <Heart
                  size={17}
                  fill="currentColor"
                  className={
                    likedTracks.length > 0
                      ? 'group-hover:opacity-0 transition-opacity'
                      : ''
                  }
                />
                {likedTracks.length > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isLikedPlaying && isPlaying) {
                        togglePlay();
                      } else {
                        playTrack(likedTracks[0], likedTracks);
                      }
                    }}
                    aria-label="Play Liked Songs"
                    title="Play Liked Songs"
                    className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity cursor-pointer"
                  >
                    {isLikedPlaying && isPlaying ? (
                      <Pause size={16} fill="currentColor" />
                    ) : (
                      <Play size={16} fill="currentColor" className="ml-0.5" />
                    )}
                  </button>
                )}
              </div>

              {!isSidebarCollapsed && (
                <div className="flex-1 min-w-0 flex flex-col">
                  <span
                    className={`text-sm font-semibold truncate ${
                      activeView === 'library' ? 'text-accent' : 'text-primary'
                    }`}
                  >
                    Liked Songs
                  </span>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted truncate">
                    <Pin size={11} className="text-accent rotate-45 shrink-0" />
                    <span>
                      Playlist • {likedTracks.length}{' '}
                      {likedTracks.length === 1 ? 'song' : 'songs'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Custom Playlists */}
          {showPlaylists &&
            filteredPlaylists.map((pl) => {
              const isSelected =
                activeView === 'playlist' && selectedPlaylistId === pl.id;
              const isPlaylistPlaying =
                Boolean(currentTrack) &&
                pl.tracks.some((t) => t.id === currentTrack?.id);

              const collageArtworks = pl.tracks
                .map((t) => t.artworkUrl)
                .filter((url): url is string => Boolean(url))
                .slice(0, 4);

              return (
                <div
                  key={pl.id}
                  onClick={() => navigateToPlaylist(pl.id)}
                  title={
                    isSidebarCollapsed
                      ? `${pl.name} (${pl.tracks.length} songs)`
                      : undefined
                  }
                  className={`group flex items-center gap-3 p-2 rounded-lg transition-all duration-150 cursor-pointer ${
                    isSelected
                      ? 'bg-elevated text-primary'
                      : 'text-secondary hover:text-primary hover:bg-elevated/50'
                  } ${isSidebarCollapsed ? 'justify-center px-0' : ''}`}
                >
                  {/* 40x40 Playlist Thumbnail with Hover Play */}
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-elevated border border-customBorder/60 flex-shrink-0 shadow-sm flex items-center justify-center">
                    <PlaylistArtwork
                      coverArt={pl.coverArt}
                      tracks={pl.tracks}
                      alt={pl.name}
                      iconSize={17}
                    />

                    {pl.tracks.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isPlaylistPlaying && isPlaying) {
                            togglePlay();
                          } else {
                            playTrack(pl.tracks[0], pl.tracks);
                          }
                        }}
                        aria-label={`Play ${pl.name}`}
                        title={`Play ${pl.name}`}
                        className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity cursor-pointer"
                      >
                        {isPlaylistPlaying && isPlaying ? (
                          <Pause size={16} fill="currentColor" />
                        ) : (
                          <Play
                            size={16}
                            fill="currentColor"
                            className="ml-0.5"
                          />
                        )}
                      </button>
                    )}
                  </div>

                  {!isSidebarCollapsed && (
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex flex-col">
                        <span
                          className={`text-sm font-semibold truncate ${
                            isSelected || isPlaylistPlaying
                              ? 'text-accent'
                              : 'text-primary'
                          }`}
                        >
                          {pl.name}
                        </span>
                        <span className="text-[11px] text-muted truncate">
                          Playlist • {pl.tracks.length}{' '}
                          {pl.tracks.length === 1 ? 'song' : 'songs'}
                        </span>
                      </div>

                      {isPlaylistPlaying && isPlaying && (
                        <Music2
                          size={14}
                          className="text-accent animate-pulse shrink-0"
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}

          {/* Followed Artists */}
          {showArtists &&
            filteredArtists.map((artist) => {
              const isSelected =
                activeView === 'artist' &&
                selectedArtist?.name.toLowerCase() ===
                  artist.name.toLowerCase();

              return (
                <div
                  key={artist.id || artist.name}
                  onClick={() => navigateToArtist(artist.name, artist.id)}
                  title={isSidebarCollapsed ? artist.name : undefined}
                  className={`group flex items-center gap-3 p-2 rounded-lg transition-all duration-150 cursor-pointer ${
                    isSelected
                      ? 'bg-elevated text-primary'
                      : 'text-secondary hover:text-primary hover:bg-elevated/50'
                  } ${isSidebarCollapsed ? 'justify-center px-0' : ''}`}
                >
                  <div className="relative w-10 h-10 rounded-full overflow-hidden bg-highlight border border-customBorder/60 flex-shrink-0 shadow-sm flex items-center justify-center">
                    {artist.imageUrl ? (
                      <img
                        src={artist.imageUrl}
                        alt={artist.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        loading="lazy"
                      />
                    ) : (
                      <span className="text-xs font-bold text-accent">
                        {artist.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>

                  {!isSidebarCollapsed && (
                    <div className="flex-1 min-w-0 flex flex-col">
                      <span
                        className={`text-sm font-semibold truncate ${
                          isSelected ? 'text-accent' : 'text-primary'
                        }`}
                      >
                        {artist.name}
                      </span>
                      <span className="text-[11px] text-muted truncate">
                        Artist
                      </span>
                    </div>
                  )}
                </div>
              );
            })}

          {/* Empty State when library filter has no matches */}
          {!isSidebarCollapsed &&
            !showLikedSongs &&
            filteredPlaylists.length === 0 &&
            filteredArtists.length === 0 && (
              <div className="px-3 py-8 text-center flex flex-col items-center gap-2 text-muted">
                <Users size={24} className="opacity-40" />
                <p className="text-xs font-medium text-secondary">
                  {librarySearch
                    ? `No matches for "${librarySearch}"`
                    : libraryFilter === 'artists'
                    ? 'No followed artists yet'
                    : 'No playlists yet'}
                </p>
              </div>
            )}
        </div>

        {/* Sidebar Version & Manual Update Trigger */}
        <div className="mt-auto border-t border-customBorder/40 bg-surface/80 px-3 py-2 flex items-center justify-between text-[11px] text-muted select-none">
          {!isSidebarCollapsed ? (
            <>
              <span className="font-mono text-secondary">v{currentVersion}</span>
              <button
                type="button"
                onClick={() => checkForUpdates(true)}
                className="hover:text-primary transition-colors flex items-center gap-1.5 cursor-pointer font-medium"
                title="Check for updates"
              >
                <RefreshCw size={11} className={isChecking ? 'animate-spin text-accent' : ''} />
                <span>{isChecking ? 'Checking...' : 'Check updates'}</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => checkForUpdates(true)}
              title={`Dotify v${currentVersion} (Check updates)`}
              className="mx-auto p-1 rounded-md text-muted hover:text-primary transition-colors cursor-pointer"
            >
              <RefreshCw size={13} className={isChecking ? 'animate-spin text-accent' : ''} />
            </button>
          )}
        </div>
      </div>

      {/* Portal-mounted Spotify Import Modal (prevents CSS containing-block clipping) */}
      {isSpotifyModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <SpotifyImportModal
            isOpen={isSpotifyModalOpen}
            onClose={() => setIsSpotifyModalOpen(false)}
            onImportSuccess={(newPlaylistId) => {
              setIsSpotifyModalOpen(false);
              navigateToPlaylist(newPlaylistId);
            }}
          />,
          document.body
        )}
    </aside>
  );
};
