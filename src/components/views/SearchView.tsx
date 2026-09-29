import React, { useEffect, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { searchCharts, searchArtists, searchAlbums, SearchAlbum } from '../../services/chartsApi';
import { isSpotifyLink, resolveSpotifyUrl } from '../../services/spotifyApi';
import { Track } from '../../types/track';
import { prefetchTrack } from '../../utils/prefetch';
import { Search, Play, Heart, Disc3, Music2, Loader2, X, Plus, ListMusic } from 'lucide-react';
import {
  DEFAULT_MUSIC_ARTWORK,
  getTrackArtwork,
  isUglyPlaceholder,
  resolveTrackArtwork,
} from '../../services/artworkService';
import { SaveMp3Button } from '../common/SaveMp3Button';

const GENRES = [
  { name: 'Today\'s Top Hits', color: 'from-blue-900 to-indigo-700', query: 'hits' },
  { name: 'Hip-Hop & Rap', color: 'from-amber-900 to-orange-700', query: 'drake rap hip hop' },
  { name: 'Pop & Mainstream', color: 'from-rose-900 to-pink-700', query: 'taylor swift pop' },
  { name: 'Electronic / EDM', color: 'from-purple-900 to-indigo-700', query: 'electronic' },
  { name: 'Lo-Fi & Chillout', color: 'from-emerald-900 to-teal-700', query: 'lofi' },
  { name: 'Classic Rock', color: 'from-red-950 to-red-800', query: 'rock' },
  { name: 'R&B & Soul', color: 'from-yellow-950 to-amber-800', query: 'r&b soul' },
  { name: 'Synthwave / Retro', color: 'from-fuchsia-900 to-purple-800', query: 'synthwave' },
];

function rankSearchResults(tracks: Track[], query: string): Track[] {
  if (!query.trim()) return tracks;

  const cleanQ = query.trim().toLowerCase();
  const alphaQ = cleanQ.replace(/[^a-z0-9]/g, '');

  const seen = new Set<string>();
  const uniqueTracks = tracks.filter((t) => {
    const key = `${(t.artist || '').toLowerCase().trim()}:::${(t.title || '').toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return uniqueTracks
    .map((track) => {
      let score = 0;
      const artist = (track.artist || '').toLowerCase().trim();
      const title = (track.title || '').toLowerCase().trim();
      const cleanArtist = artist.replace(/[^a-z0-9]/g, '');
      const cleanTitle = title.replace(/[^a-z0-9]/g, '');

      // 1. Exact artist match (highest priority for artist queries)
      if (artist === cleanQ || (alphaQ.length > 2 && cleanArtist === alphaQ)) {
        score += 250;
      } else if (artist.startsWith(cleanQ) || (alphaQ.length > 2 && cleanArtist.startsWith(alphaQ))) {
        score += 150;
      } else if (alphaQ.length > 2 && cleanArtist.includes(alphaQ)) {
        score += 90;
      } else if (artist.includes(cleanQ)) {
        score += 70;
      }

      // 2. Exact or high title match
      if (title === cleanQ || (alphaQ.length > 2 && cleanTitle === alphaQ)) {
        score += 200;
      } else if (title.startsWith(cleanQ) || (alphaQ.length > 2 && cleanTitle.startsWith(alphaQ))) {
        score += 120;
      } else if (alphaQ.length > 2 && cleanTitle.includes(alphaQ)) {
        score += 60;
      } else if (title.includes(cleanQ)) {
        score += 50;
      }

      // 3. Word-level matching
      const qWords = cleanQ.split(/\s+/).filter((w) => w.length > 1);
      for (const w of qWords) {
        if (artist.includes(w)) score += 25;
        if (title.includes(w)) score += 20;
      }

      // 4. Heavily penalize spurious fuzzy matches that don't match the search keywords
      if (alphaQ.length > 2 && !cleanArtist.includes(alphaQ) && !cleanTitle.includes(alphaQ)) {
        score -= 100;
      }

      return { track, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.track);
}

export const SearchView: React.FC = () => {
  const {
    searchQuery,
    setSearchQuery,
    playTrack,
    currentTrack,
    toggleLike,
    isLiked,
    navigateToArtist,
    navigateToAlbum,
    playlists,
    addTrackToPlaylist,
    openCreatePlaylistModal,
  } = usePlayerStore();

  const [results, setResults] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<SearchAlbum[]>([]);
  const [topArtist, setTopArtist] = useState<{ id: number; name: string; picture: string; nb_fan?: number } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [activePlaylistMenuTrackId, setActivePlaylistMenuTrackId] = useState<string | null>(null);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setTopArtist(null);
      setAlbums([]);
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        if (isSpotifyLink(searchQuery)) {
          const spotifyRes = await resolveSpotifyUrl(searchQuery);
          if (spotifyRes.track) {
            setResults([spotifyRes.track]);
          } else if (spotifyRes.tracks) {
            setResults(spotifyRes.tracks);
          }
          return;
        }

        // Fetch top matching artist
        try {
          const artistItems = await searchArtists(searchQuery, 3);
          const artistItem = artistItems?.[0];
          if (artistItem) {
            setTopArtist({
              id: artistItem.id,
              name: artistItem.name,
              picture: artistItem.picture_big || artistItem.picture_medium || artistItem.picture,
              nb_fan: artistItem.nb_fan,
            });
          } else {
            setTopArtist(null);
          }
        } catch {
          setTopArtist(null);
        }

        // Fetch matching albums & tracks
        const [albumResults, chartResults] = await Promise.all([
          searchAlbums(searchQuery, 8).catch(() => []),
          searchCharts(searchQuery, 25).catch(() => []),
        ]);

        setAlbums(albumResults || []);
        const ranked = rankSearchResults(chartResults, searchQuery);
        setResults(ranked);
      } catch (err) {
        console.warn('Search query error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const formatDuration = (sec: number) => {
    if (!sec || !isFinite(sec)) return 'LIVE';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div data-testid="main-content" className="p-4 md:p-8 flex flex-col gap-6 pb-32">
      {/* Search Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-primary tracking-tight">
          {searchQuery.trim() ? `Search results for "${searchQuery}"` : 'Browse All Music'}
        </h1>
        <p className="text-xs md:text-sm text-secondary mt-1">
          Stream songs, studio albums, top artists, or paste a Spotify link.
        </p>
      </div>

      {/* Dedicated Touch-Friendly Search Input Container */}
      <div className="flex flex-col gap-3">
        <div className="relative flex items-center w-full">
          <Search
            size={18}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          />
          <input
            type="text"
            placeholder="What do you want to play? Search songs, artists, albums..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            data-testid="search-view-input"
            className="w-full bg-elevated text-primary placeholder-muted text-sm sm:text-base pl-10 pr-10 py-3 rounded-xl border border-customBorder focus:border-accent focus:bg-highlight outline-none transition-all select-text shadow-sm"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary p-1.5 rounded-full transition-colors cursor-pointer"
              title="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Loading Indicator */}
      {isSearching && (
        <div className="flex items-center gap-2 text-accent text-sm font-semibold py-4">
          <Loader2 size={18} className="animate-spin" />
          <span>Searching across feeds...</span>
        </div>
      )}

      {/* Top Result: Artist Card */}
      {topArtist && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-bold text-primary">Top Result</h2>
          <div
            data-testid="top-artist-result"
            onClick={() => navigateToArtist(topArtist.name, `charts:artist:${topArtist.id}`)}
            className="group relative flex flex-col sm:flex-row items-start sm:items-center gap-5 p-5 rounded-2xl bg-gradient-to-r from-elevated/90 to-elevated/40 hover:from-elevated hover:to-elevated/70 border border-customBorder/60 hover:border-accent/40 transition-all cursor-pointer shadow-xl max-w-xl"
          >
            <div className="relative">
              <img
                src={getTrackArtwork({
                  artist: topArtist.name,
                  title: topArtist.name,
                  artworkUrl: topArtist.picture,
                })}
                alt={topArtist.name}
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover shadow-2xl border-2 border-customBorder group-hover:scale-105 transition-transform duration-300 bg-highlight"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (target.src !== DEFAULT_MUSIC_ARTWORK) {
                    target.src = DEFAULT_MUSIC_ARTWORK;
                    resolveTrackArtwork(topArtist.name, topArtist.name).then((url) => {
                      if (url && !isUglyPlaceholder(url)) target.src = url;
                    });
                  }
                }}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateToArtist(topArtist.name, `charts:artist:${topArtist.id}`);
                }}
                className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-accent text-accent-content flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 group-hover:translate-y-0 translate-y-1 transition-all"
                title="Play Artist"
              >
                <Play size={16} fill="currentColor" className="ml-0.5" />
              </button>
            </div>

            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-accent/20 text-accent">
                  Artist
                </span>
                {topArtist.nb_fan ? (
                  <span className="text-xs text-muted font-medium">
                    {(topArtist.nb_fan * 4).toLocaleString()} monthly listeners
                  </span>
                ) : (
                  <span className="text-xs text-muted font-medium">Verified Artist</span>
                )}
              </div>

              <h3 className="text-2xl sm:text-3xl font-extrabold text-primary truncate group-hover:text-accent transition-colors">
                {topArtist.name}
              </h3>

              <p className="text-xs text-secondary mt-0.5">
                Studio albums, top hits, discography, and custom artist radio.
              </p>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                navigateToArtist(topArtist.name, `charts:artist:${topArtist.id}`);
              }}
              className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full bg-accent text-accent-content font-bold text-xs shadow-lg hover:scale-105 active:scale-95 transition-all self-center flex-shrink-0"
            >
              <span>View Artist</span>
            </button>
          </div>
        </div>
      )}

      {/* Albums Shelf */}
      {albums.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-primary flex items-center gap-2">
              <Disc3 size={20} className="text-accent" />
              <span>Albums</span>
            </h2>
            <span className="text-xs text-muted font-mono">{albums.length} results</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
            {albums.map((album) => (
              <div
                key={album.id}
                onClick={() =>
                  navigateToAlbum({
                    id: album.id,
                    title: album.title,
                    artist: album.artist,
                    coverUrl: album.cover,
                    recordType: album.recordType,
                  })
                }
                className="group flex flex-col p-3 rounded-xl bg-elevated/60 hover:bg-elevated border border-customBorder/50 hover:border-accent/40 transition-all cursor-pointer shadow-sm hover:shadow-lg select-none"
              >
                <div className="relative aspect-square rounded-lg overflow-hidden mb-2.5 bg-highlight shadow">
                  <img
                    src={getTrackArtwork({
                      artist: album.artist,
                      title: album.title,
                      artworkUrl: album.cover,
                    })}
                    alt={album.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => {
                      const target = e.currentTarget;
                      if (target.src !== DEFAULT_MUSIC_ARTWORK) {
                        target.src = DEFAULT_MUSIC_ARTWORK;
                        resolveTrackArtwork(album.artist, album.title).then((url) => {
                          if (url && !isUglyPlaceholder(url)) target.src = url;
                        });
                      }
                    }}
                  />
                  <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-black/75 text-white backdrop-blur-md">
                    {album.recordType || 'Album'}
                  </span>
                </div>

                <h3 className="text-xs sm:text-sm font-bold text-primary truncate group-hover:text-accent transition-colors" title={album.title}>
                  {album.title}
                </h3>

                <p
                  onClick={(e) => {
                    e.stopPropagation();
                    navigateToArtist(album.artist);
                  }}
                  className="text-[11px] text-secondary truncate mt-0.5 hover:underline hover:text-primary cursor-pointer transition-colors"
                >
                  {album.artist}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search Results Table */}
      {results.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-12 px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider border-b border-customBorder/50">
            <span className="col-span-1">#</span>
            <span className="col-span-7 sm:col-span-6">Title</span>
            <span className="hidden sm:block sm:col-span-3">Album</span>
            <span className="col-span-4 sm:col-span-2 text-right">Duration</span>
          </div>

          <div className="flex flex-col gap-1 mt-1">
            {results.map((track, idx) => {
              const isCurrent = currentTrack?.id === track.id;
              return (
                <div
                  key={track.id}
                  data-testid="track-item"
                  onClick={() => playTrack(track, results)}
                  onMouseEnter={() => prefetchTrack(track)}
                  className={`group grid grid-cols-12 items-center px-4 py-2.5 rounded-lg transition-colors cursor-pointer ${
                    isCurrent ? 'bg-elevated' : 'hover:bg-elevated/50'
                  }`}
                >
                  <span className="col-span-1 text-xs text-muted group-hover:hidden">
                    {idx + 1}
                  </span>
                  <span className="col-span-1 hidden group-hover:block text-accent">
                    <Play size={14} fill="currentColor" />
                  </span>

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
                      <p className="text-xs text-secondary truncate">
                        <span
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

                  <span className="hidden sm:block sm:col-span-3 text-xs text-muted truncate pr-2">
                    {track.album || 'Single'}
                  </span>

                  <div className="col-span-4 sm:col-span-2 flex items-center justify-end gap-2.5 text-xs font-mono text-muted relative">
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

                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActivePlaylistMenuTrackId(
                            activePlaylistMenuTrackId === track.id ? null : track.id
                          );
                        }}
                        className="p-1 text-secondary hover:text-primary transition-colors cursor-pointer"
                        title="Add to playlist"
                      >
                        <Plus size={15} />
                      </button>

                      {activePlaylistMenuTrackId === track.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 top-full mt-1 z-30 w-48 bg-elevated border border-customBorder rounded-xl shadow-2xl py-1.5 text-xs text-primary font-sans flex flex-col"
                        >
                          <span className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                            Add to Playlist
                          </span>
                          {playlists.slice(0, 6).map((pl) => (
                            <button
                              key={pl.id}
                              onClick={() => {
                                addTrackToPlaylist(pl.id, track);
                                setActivePlaylistMenuTrackId(null);
                              }}
                              className="px-3 py-1.5 text-left hover:bg-highlight flex items-center gap-2 truncate cursor-pointer"
                            >
                              <ListMusic size={12} className="text-accent shrink-0" />
                              <span className="truncate">{pl.name}</span>
                            </button>
                          ))}
                          <button
                            onClick={() => {
                              setActivePlaylistMenuTrackId(null);
                              openCreatePlaylistModal('custom', [track]);
                            }}
                            className="px-3 py-1.5 text-left hover:bg-highlight flex items-center gap-2 text-accent font-semibold border-t border-customBorder/40 mt-0.5 pt-1.5 cursor-pointer"
                          >
                            <Plus size={12} />
                            <span>New Playlist with Song</span>
                          </button>
                        </div>
                      )}
                    </div>

                    <span>{formatDuration(track.duration)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No results found */}
      {!isSearching && searchQuery.trim() && results.length === 0 && (
        <div className="text-center py-16 text-muted">
          <Search size={40} className="mx-auto opacity-30 mb-3" />
          <p className="text-base font-semibold text-primary">No results found for "{searchQuery}"</p>
          <p className="text-xs text-secondary mt-1">
            Try checking the spelling or searching for another song, artist, or album.
          </p>
        </div>
      )}

      {/* Explore Genre Cards when not searching */}
      {!searchQuery.trim() && (
        <div className="flex flex-col gap-4 mt-2">
          <h2 className="text-lg font-bold text-primary">Explore Genres & Categories</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {GENRES.map((g) => (
              <div
                key={g.name}
                onClick={() => setSearchQuery(g.query)}
                className={`relative h-28 md:h-36 rounded-xl p-4 bg-gradient-to-br ${g.color} cursor-pointer overflow-hidden shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98]`}
              >
                <h3 className="text-sm md:text-base font-extrabold text-white">{g.name}</h3>
                <Music2 className="absolute -bottom-2 -right-2 text-white/20 w-16 h-16 pointer-events-none" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
