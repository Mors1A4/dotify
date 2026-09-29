import React, { useEffect, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { fetchTopCharts, fetchTopArtists, TopArtist, searchCharts } from '../../services/chartsApi';
import { Track } from '../../types/track';
import { RecentArtistItem } from '../../types/artist';
import { prefetchTrack, prefetchTracks } from '../../utils/prefetch';
import {
  Play,
  Flame,
  Disc3,
  Sparkles,
  Heart,
  Trophy,
  Users,
  Compass,
  Clock,
  Loader2,
} from 'lucide-react';
import { recommendationEngine, DailyMix } from '../../services/recommendationEngine';
import { telemetryDb } from '../../services/telemetryDb';
import { dailyVibeManager } from '../../services/dailyVibeManager';
import { DailyVibePlaylist, VibeCategory } from '../../types/vibes';
import { useAuthStore } from '../../store/authStore';
import { artistService } from '../../services/artistService';
import {
  DEFAULT_MUSIC_ARTWORK,
  getTrackArtwork,
  resolveTrackArtwork,
  isUglyPlaceholder,
} from '../../services/artworkService';

const ShelfTrackImage: React.FC<{ track: Track }> = ({ track }) => {
  const [imgSrc, setImgSrc] = useState(() => getTrackArtwork(track));

  useEffect(() => {
    let mounted = true;
    const current = getTrackArtwork(track);
    setImgSrc(current);
    if (isUglyPlaceholder(current)) {
      resolveTrackArtwork(track.artist, track.title).then((resolved) => {
        if (mounted && resolved && !isUglyPlaceholder(resolved)) {
          track.artworkUrl = resolved;
          setImgSrc(resolved);
        }
      });
    }
    return () => {
      mounted = false;
    };
  }, [track.id, track.artworkUrl, track.artist, track.title]);

  return (
    <img
      data-testid="track-artwork"
      src={imgSrc}
      alt={track.title}
      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      loading="lazy"
      onError={() => {
        if (imgSrc !== DEFAULT_MUSIC_ARTWORK) {
          setImgSrc(DEFAULT_MUSIC_ARTWORK);
          resolveTrackArtwork(track.artist, track.title).then((resolved) => {
            if (resolved && !isUglyPlaceholder(resolved)) {
              track.artworkUrl = resolved;
              setImgSrc(resolved);
            }
          });
        }
      }}
    />
  );
};

const RecentArtistCard: React.FC<{
  artist: RecentArtistItem;
  onPlayArtist: (artist: RecentArtistItem) => void;
  isPlayingArtist: boolean;
  onArtistClick: (artist: RecentArtistItem) => void;
}> = ({ artist, onPlayArtist, isPlayingArtist, onArtistClick }) => {
  const [imgSrc, setImgSrc] = useState(artist.picture || DEFAULT_MUSIC_ARTWORK);

  useEffect(() => {
    let mounted = true;
    if (artist.picture && !isUglyPlaceholder(artist.picture)) {
      setImgSrc(artist.picture);
    } else {
      artistService
        .getArtistProfile(artist.name)
        .then((profile) => {
          if (mounted && profile?.imageUrl && !isUglyPlaceholder(profile.imageUrl)) {
            artist.picture = profile.imageUrl;
            setImgSrc(profile.imageUrl);
          }
        })
        .catch(() => {});
    }
    return () => {
      mounted = false;
    };
  }, [artist.name, artist.picture]);

  return (
    <div
      data-testid="recent-artist-card"
      onClick={() => onArtistClick(artist)}
      className="group relative flex-shrink-0 w-32 sm:w-36 p-3 rounded-2xl bg-elevated/40 hover:bg-elevated transition-all duration-200 cursor-pointer border border-transparent hover:border-customBorder flex flex-col items-center gap-2.5 text-center"
    >
      <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden shadow-lg border-2 border-transparent group-hover:border-accent transition-all duration-300 bg-highlight flex items-center justify-center">
        <img
          src={imgSrc}
          alt={artist.name}
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
          loading="lazy"
          onError={() => {
            if (imgSrc !== DEFAULT_MUSIC_ARTWORK) {
              setImgSrc(DEFAULT_MUSIC_ARTWORK);
              artistService
                .getArtistProfile(artist.name)
                .then((profile) => {
                  if (profile?.imageUrl && !isUglyPlaceholder(profile.imageUrl)) {
                    artist.picture = profile.imageUrl;
                    setImgSrc(profile.imageUrl);
                  }
                })
                .catch(() => {});
            }
          }}
        />
        <button
          data-testid="artist-play-btn"
          aria-label={`Play ${artist.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onPlayArtist(artist);
          }}
          disabled={isPlayingArtist}
          className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-accent text-accent-content flex items-center justify-center shadow-xl opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 hover:scale-110 active:scale-95 transition-all duration-200 cursor-pointer"
        >
          {isPlayingArtist ? (
            <Loader2 size={18} className="animate-spin" />
          ) : (
            <Play size={18} fill="currentColor" className="ml-0.5" />
          )}
        </button>
      </div>

      <div className="flex flex-col items-center w-full min-w-0">
        <h3 className="text-xs sm:text-sm font-bold text-primary truncate w-full group-hover:text-accent transition-colors">
          {artist.name}
        </h3>
        <p className="text-[11px] text-secondary truncate w-full mt-0.5">
          {artist.isFollowed
            ? 'Followed Artist'
            : artist.recentTrackTitle
            ? artist.recentTrackTitle
            : artist.playCount > 1
            ? `${artist.playCount} plays`
            : 'Recently Played'}
        </p>
      </div>
    </div>
  );
};

export const HomeView: React.FC = () => {
  const {
    playTrack,
    currentTrack,
    isPlaying,
    togglePlay,
    toggleLike,
    isLiked,
    likedTracks,
    followedArtists,
    playlists,
    navigateToArtist,
    navigateToPlaylist,
    deletePlaylist,
  } = usePlayerStore();

  const { user } = useAuthStore();

  const [chartTracks, setChartTracks] = useState<Track[]>([]);
  const [topArtists, setTopArtists] = useState<TopArtist[]>([]);
  const [activeArtistName, setActiveArtistName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Daily AI Vibe Playlists
  const [vibePlaylists, setVibePlaylists] = useState<DailyVibePlaylist[]>([]);
  const [activeVibe, setActiveVibe] = useState<VibeCategory>('gaming');
  const [isVibesLoading, setIsVibesLoading] = useState(true);
  const [savedVibes, setSavedVibes] = useState<Set<string>>(new Set());
  const [vibeToast, setVibeToast] = useState<string | null>(null);

  // Personalized Shelves
  const [madeForYou, setMadeForYou] = useState<Track[]>([]);
  const [madeForYouArtists, setMadeForYouArtists] = useState<RecentArtistItem[]>([]);
  const [mfyFilter, setMfyFilter] = useState<'all' | 'artists' | 'tracks'>('all');
  const [playingArtistId, setPlayingArtistId] = useState<string | null>(null);
  const [discoverWeekly, setDiscoverWeekly] = useState<Track[]>([]);
  const [dailyMixes, setDailyMixes] = useState<DailyMix[]>([]);
  const [heavyRotation, setHeavyRotation] = useState<Track[]>([]);
  const [forgottenFavorites, setForgottenFavorites] = useState<Track[]>([]);

  useEffect(() => {
    let mounted = true;
    const accountId = user?.uid || 'guest';
    setIsVibesLoading(true);

    dailyVibeManager
      .getDailyVibes(accountId)
      .then((playlists) => {
        if (mounted && Array.isArray(playlists) && playlists.length > 0) {
          setVibePlaylists(playlists);
          if (!activeVibe || !playlists.some((p) => p.vibe === activeVibe)) {
            setActiveVibe(playlists[0].vibe);
          }
        }
      })
      .catch((err) => {
        console.warn('[HomeView] Failed loading daily vibe playlists:', err);
      })
      .finally(() => {
        if (mounted) setIsVibesLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [user?.uid]);

  useEffect(() => {
    let mounted = true;

    async function loadFeeds() {
      setIsLoading(true);
      try {
        const [charts, artists] = await Promise.all([
          fetchTopCharts(24),
          fetchTopArtists(12),
        ]);

        if (mounted) {
          setChartTracks(charts);
          setTopArtists(artists);
          // Pre-warm top 2 hits so clicking Play on hero or #1 starts instantaneously
          prefetchTracks(charts, 2);

          // Generate personalized recommendation shelves
          const catalogue = [...charts];
          Promise.all([
            telemetryDb.getAllPlays(),
            telemetryDb.getArtistAffinities(),
          ]).then(([plays, affinities]) => {
            if (!mounted) return;
            setMadeForYou(recommendationEngine.generateMadeForYou(plays, catalogue, likedTracks, followedArtists));
            setMadeForYouArtists(recommendationEngine.generateMadeForYouArtists(plays, affinities, followedArtists, catalogue, 12));
            setDiscoverWeekly(recommendationEngine.generateDiscoverWeekly(plays, catalogue, 15, followedArtists));
            setDailyMixes(recommendationEngine.generateDailyMixes(plays, catalogue, followedArtists));
            setHeavyRotation(recommendationEngine.generateHeavyRotation(plays, catalogue, likedTracks));
            setForgottenFavorites(recommendationEngine.generateForgottenFavorites(plays, catalogue, likedTracks));
          }).catch(() => {});
        }
      } catch (err) {
        console.warn('Failed loading home feeds:', err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    loadFeeds();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (chartTracks.length > 0) {
      const catalogue = [...chartTracks];
      Promise.all([
        telemetryDb.getAllPlays(),
        telemetryDb.getArtistAffinities(),
      ]).then(([plays, affinities]) => {
        setMadeForYou(recommendationEngine.generateMadeForYou(plays, catalogue, likedTracks, followedArtists));
        setMadeForYouArtists(recommendationEngine.generateMadeForYouArtists(plays, affinities, followedArtists, catalogue, 12));
        setDiscoverWeekly(recommendationEngine.generateDiscoverWeekly(plays, catalogue, 15, followedArtists));
        setDailyMixes(recommendationEngine.generateDailyMixes(plays, catalogue, followedArtists));
        setHeavyRotation(recommendationEngine.generateHeavyRotation(plays, catalogue, likedTracks));
        setForgottenFavorites(recommendationEngine.generateForgottenFavorites(plays, catalogue, likedTracks));
      }).catch(() => {});
    }
  }, [likedTracks, followedArtists]);

  const handlePlayArtist = async (artist: RecentArtistItem) => {
    setPlayingArtistId(artist.id);
    try {
      const profile = await artistService.getArtistProfile(artist.name);
      if (profile && Array.isArray(profile.topTracks) && profile.topTracks.length > 0) {
        playTrack(profile.topTracks[0], profile.topTracks);
        return;
      }
    } catch (err) {
      console.warn('[HomeView] Failed fetching artist profile for playback:', err);
    } finally {
      setPlayingArtistId(null);
    }

    // Fallback: look in chartTracks / catalogue or likedTracks
    const matchingTracks = [
      ...likedTracks.filter((t) => (t.artist || '').toLowerCase().includes(artist.name.toLowerCase())),
      ...chartTracks.filter((t) => (t.artist || '').toLowerCase().includes(artist.name.toLowerCase())),
    ];
    if (matchingTracks.length > 0) {
      playTrack(matchingTracks[0], matchingTracks);
    } else {
      try {
        const searched = await searchCharts(artist.name, 10);
        if (searched.length > 0) {
          playTrack(searched[0], searched);
        }
      } catch {}
    }
  };

  const handleArtistClick = (artist: TopArtist) => {
    setActiveArtistName(artist.name);
    navigateToArtist(artist.name, `charts:artist:${artist.id}`);
  };

  const heroTrack = chartTracks[0] || null;

  return (
    <div data-testid="main-content" className="p-4 md:p-8 flex flex-col gap-8 pb-32">
      {/* Hero Banner */}
      {heroTrack && (
        <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-emerald-950/80 via-surface to-elevated border border-customBorder p-6 md:p-8 flex flex-col md:flex-row items-center gap-6 shadow-2xl">
          <img
            src={getTrackArtwork(heroTrack)}
            alt={heroTrack.title}
            className="w-40 h-40 md:w-48 md:h-48 rounded-xl object-cover shadow-2xl flex-shrink-0"
            onError={(e) => {
              const target = e.currentTarget;
              target.src = DEFAULT_MUSIC_ARTWORK;
              resolveTrackArtwork(heroTrack.artist, heroTrack.title).then((url) => {
                if (url && !isUglyPlaceholder(url)) target.src = url;
              });
            }}
          />

          <div className="flex-1 flex flex-col items-start gap-2">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-accent/20 text-accent text-xs font-bold">
              <Sparkles size={14} />
              <span>#1 GLOBAL HIT TODAY</span>
            </div>

            <h1 className="text-2xl md:text-4xl font-extrabold text-primary tracking-tight">
              {heroTrack.title}
            </h1>
            <p className="text-sm md:text-base text-secondary font-medium">
              By <span
                onClick={() => navigateToArtist(heroTrack.artist)}
                className="text-primary font-bold hover:underline cursor-pointer"
              >
                {heroTrack.artist}
              </span> · {heroTrack.album || 'Studio Single'}
            </p>

            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={() => playTrack(heroTrack, chartTracks)}
                className="flex items-center gap-2 px-6 py-3 rounded-full bg-accent text-accent-content font-bold text-sm hover:scale-105 active:scale-95 transition-all shadow-lg cursor-pointer"
              >
                <Play size={18} fill="currentColor" />
                <span>Play Now</span>
              </button>

              <button
                onClick={() => toggleLike(heroTrack)}
                className="p-3 rounded-full bg-elevated hover:bg-highlight text-secondary hover:text-accent transition-colors cursor-pointer"
              >
                <Heart
                  size={18}
                  className={isLiked(heroTrack.id) ? 'text-accent fill-accent' : ''}
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Personalized Recommendations Section */}
      <div className="flex flex-col gap-8">
          {/* Shelf 1: Made For You */}
          {(madeForYou.length > 0 || madeForYouArtists.length > 0) && (
            <section data-testid="made-for-you-shelf" className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="text-accent" size={22} />
                  <div>
                    <h2 className="text-xl font-bold text-primary">Made For You</h2>
                    <p className="text-xs text-muted font-medium">
                      Your personalized mix of recent artists, favorite tracks, and tailored discoveries
                    </p>
                  </div>
                </div>

                {/* View Filter Pills & Quick Actions */}
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <div className="flex items-center p-0.5 rounded-full bg-elevated border border-customBorder">
                    <button
                      data-testid="mfy-filter-all"
                      onClick={() => setMfyFilter('all')}
                      className={`px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${
                        mfyFilter === 'all'
                          ? 'bg-accent text-accent-content shadow-sm'
                          : 'text-secondary hover:text-primary'
                      }`}
                    >
                      All
                    </button>
                    <button
                      data-testid="mfy-filter-artists"
                      onClick={() => setMfyFilter('artists')}
                      className={`px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${
                        mfyFilter === 'artists'
                          ? 'bg-accent text-accent-content shadow-sm'
                          : 'text-secondary hover:text-primary'
                      }`}
                    >
                      Artists
                    </button>
                    <button
                      data-testid="mfy-filter-tracks"
                      onClick={() => setMfyFilter('tracks')}
                      className={`px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${
                        mfyFilter === 'tracks'
                          ? 'bg-accent text-accent-content shadow-sm'
                          : 'text-secondary hover:text-primary'
                      }`}
                    >
                      Songs
                    </button>
                  </div>

                  {madeForYou.length > 0 && mfyFilter !== 'artists' && (
                    <button
                      data-testid="play-shelf-made-for-you"
                      onClick={() => playTrack(madeForYou[0], madeForYou)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent text-accent-content text-xs font-bold hover:scale-105 transition-all shadow-md cursor-pointer ml-1"
                    >
                      <Play size={13} fill="currentColor" />
                      <span>Play Shelf</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Sub-Shelf A: Recent Artists (visible in 'all' and 'artists' modes) */}
              {mfyFilter !== 'tracks' && madeForYouArtists.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  {mfyFilter === 'all' && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-secondary uppercase tracking-wider">
                        <Users size={14} className="text-accent" />
                        <span>Artists You Listen To</span>
                      </div>
                      <button
                        onClick={() => setMfyFilter('artists')}
                        className="text-xs font-bold text-accent hover:underline cursor-pointer"
                      >
                        View all ({madeForYouArtists.length})
                      </button>
                    </div>
                  )}

                  <div
                    data-testid="mfy-artists-shelf"
                    className={
                      mfyFilter === 'artists'
                        ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 pt-1'
                        : 'flex gap-4 overflow-x-auto pb-2 pt-1 scrollbar-thin scrollbar-thumb-highlight scrollbar-track-transparent'
                    }
                  >
                    {madeForYouArtists.map((artist) => (
                      <RecentArtistCard
                        key={`mfy-art-${artist.id}`}
                        artist={artist}
                        onPlayArtist={handlePlayArtist}
                        isPlayingArtist={playingArtistId === artist.id}
                        onArtistClick={(art) => navigateToArtist(art.name)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Sub-Shelf B: Personalized Songs (visible in 'all' and 'tracks' modes) */}
              {mfyFilter !== 'artists' && madeForYou.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  {mfyFilter === 'all' && madeForYouArtists.length > 0 && (
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-secondary uppercase tracking-wider">
                        <Disc3 size={14} className="text-accent" />
                        <span>Recommended Songs For You</span>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-4 overflow-x-auto pb-3 pt-1 scrollbar-thin scrollbar-thumb-highlight scrollbar-track-transparent">
                    {madeForYou.map((track) => {
                      const isCurrent = currentTrack?.id === track.id;
                      return (
                        <div
                          key={`mfy-${track.id}`}
                          data-testid="track-item"
                          onClick={() => playTrack(track, madeForYou)}
                          onMouseEnter={() => prefetchTrack(track)}
                          className="group relative flex-shrink-0 w-36 sm:w-44 p-3 rounded-xl bg-elevated/40 hover:bg-elevated transition-all cursor-pointer border border-transparent hover:border-customBorder flex flex-col gap-2.5"
                        >
                          <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-highlight">
                            <ShelfTrackImage track={track} />
                            <button
                              data-testid="track-play-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isCurrent) togglePlay();
                                else playTrack(track, madeForYou);
                              }}
                              className={`absolute bottom-2 right-2 w-9 h-9 rounded-full bg-accent text-accent-content flex items-center justify-center shadow-xl transition-all duration-200 ${
                                isCurrent
                                  ? 'opacity-100 scale-100'
                                  : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0'
                              }`}
                            >
                              <Play size={16} fill="currentColor" className="ml-0.5" />
                            </button>
                          </div>

                          <div className="flex flex-col min-w-0">
                            <h3
                              data-testid="track-title"
                              className={`text-sm font-semibold truncate ${
                                isCurrent ? 'text-accent' : 'text-primary'
                              }`}
                            >
                              {track.title}
                            </h3>
                            <p
                              data-testid="track-artist"
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
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Shelf 2: Daily Vibe Curation (Curated Daily by Gemini 3.8 Flash) */}
          <section data-testid="daily-vibe-shelf" className="flex flex-col gap-5">
            {vibeToast && (
              <div className="fixed top-20 right-6 z-50 bg-neutral-900 border border-white/20 text-white font-mono text-xs px-4 py-2.5 rounded-sm shadow-2xl tracking-wider uppercase animate-in fade-in slide-in-from-top-2">
                <span>{vibeToast}</span>
              </div>
            )}

            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-3 border-b border-white/[0.08]">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl sm:text-2xl font-bold text-primary tracking-tight">
                    Daily Vibe Playlists
                  </h2>
                  <span className="text-[11px] font-mono tracking-widest uppercase text-muted">
                    / CURATED DAILY
                  </span>
                </div>
                <p className="text-xs text-secondary mt-1 max-w-xl">
                  Algorithmic audio sets calibrated from your playback telemetry and live music intelligence.
                </p>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono tracking-wider text-muted">
                <span className="w-1.5 h-1.5 bg-accent" />
                <span>ENGINE: GEMINI 3.8 FLASH</span>
              </div>
            </div>

            {/* Interactive Vibe Selector Rail */}
            <div className="flex items-center gap-1 border-b border-white/[0.06] overflow-x-auto scrollbar-none">
              {[
                { id: 'gaming' as VibeCategory, label: 'GAMING', index: '01' },
                { id: 'working' as VibeCategory, label: 'WORKING', index: '02' },
                { id: 'partying' as VibeCategory, label: 'PARTYING', index: '03' },
                { id: 'chilling' as VibeCategory, label: 'CHILLING', index: '04' },
                { id: 'workout' as VibeCategory, label: 'WORKOUT', index: '05' },
              ].map((tab) => {
                const isActive = activeVibe === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveVibe(tab.id)}
                    className={`px-4 py-3 text-xs font-semibold tracking-wider transition-all cursor-pointer whitespace-nowrap border-b-2 flex items-center gap-2 ${
                      isActive
                        ? 'border-accent text-primary bg-white/[0.03]'
                        : 'border-transparent text-secondary hover:text-primary hover:border-white/20'
                    }`}
                  >
                    <span className="text-[10px] font-mono text-muted">{tab.index}</span>
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Active Vibe Spotlight Banner */}
            {(() => {
              const currentVibe = vibePlaylists.find((p) => p.vibe === activeVibe) || vibePlaylists[0];
              if (!currentVibe) {
                return (
                  <div className="p-8 rounded-sm bg-elevated/40 border border-white/[0.08] flex items-center justify-center gap-3 text-secondary text-xs font-mono tracking-wider uppercase">
                    <span className="w-1.5 h-1.5 bg-accent animate-ping" />
                    <span>LOADING CURATED SETS...</span>
                  </div>
                );
              }

              const isSaved =
                savedVibes.has(currentVibe.id) ||
                (playlists || []).some(
                  (p) =>
                    p.id === currentVibe.id ||
                    p.name.trim().toLowerCase() === currentVibe.name.trim().toLowerCase()
                );

              return (
                <div
                  className="relative overflow-hidden rounded-sm bg-elevated/40 border border-white/[0.08] p-6 sm:p-8 flex flex-col gap-6 backdrop-blur-md shadow-2xl transition-all"
                >
                  {/* Backdrop Glow */}
                  {currentVibe.coverArt && (
                    <img
                      src={currentVibe.coverArt}
                      alt=""
                      aria-hidden="true"
                      className="absolute -top-20 -right-20 w-80 h-80 object-cover blur-3xl opacity-20 pointer-events-none select-none scale-125"
                    />
                  )}

                  <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center gap-6 justify-between">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                      {/* Gallery Framed Artwork (No stickers or bubbles) */}
                      <div className="relative w-32 h-32 sm:w-36 sm:h-36 rounded-sm overflow-hidden border border-white/10 shrink-0 bg-highlight">
                        <img
                          src={currentVibe.coverArt}
                          alt={currentVibe.name}
                          className="w-full h-full object-cover"
                        />
                      </div>

                      <div className="flex flex-col gap-2">
                        {/* Editorial Eyebrow (No curved pill) */}
                        <div className="text-[10px] font-mono tracking-widest text-accent uppercase font-medium">
                          CURATION FOCUS // {currentVibe.vibeTagline || 'TAILORED DAILY ROTATION'}
                        </div>

                        <h3 className="text-2xl sm:text-3xl font-bold text-primary tracking-tight">
                          {currentVibe.name}
                        </h3>

                        <p className="text-xs sm:text-sm text-secondary max-w-xl line-clamp-2">
                          {currentVibe.description}
                        </p>

                        {/* Technical Data Readout */}
                        <div className="flex items-center gap-3 text-[11px] font-mono text-muted mt-1">
                          <span>{currentVibe.tracks.length} TRACKS</span>
                          <span>/</span>
                          <span>{currentVibe.modelUsed || 'GEMINI 3.8 FLASH'}</span>
                          <span>/</span>
                          <span>UPDATED TODAY</span>
                        </div>
                      </div>
                    </div>

                    {/* Precision Geometric Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
                      <button
                        onClick={() => {
                          if (currentVibe.tracks.length > 0) {
                            playTrack(currentVibe.tracks[0], currentVibe.tracks);
                          }
                        }}
                        className="px-6 py-2.5 rounded-sm bg-white text-black font-semibold text-xs tracking-wider uppercase hover:bg-neutral-200 active:scale-95 transition-all cursor-pointer"
                      >
                        PLAY VIBE
                      </button>

                      <button
                        onClick={() => {
                          navigateToPlaylist(currentVibe.id);
                        }}
                        className="px-5 py-2.5 rounded-sm bg-white/[0.05] hover:bg-white/[0.10] border border-white/10 text-primary font-semibold text-xs tracking-wider uppercase active:scale-95 transition-all cursor-pointer"
                      >
                        VIEW PLAYLIST
                      </button>

                      <button
                        onClick={() => {
                          if (!isSaved) {
                            dailyVibeManager.saveVibeToLibrary(currentVibe);
                            setSavedVibes((prev) => new Set(prev).add(currentVibe.id));
                            setVibeToast(`SAVED TO LIBRARY: ${currentVibe.name}`);
                            setTimeout(() => setVibeToast(null), 3000);
                          } else {
                            const found = (playlists || []).find(
                              (p) =>
                                p.id === currentVibe.id ||
                                p.name.trim().toLowerCase() === currentVibe.name.trim().toLowerCase()
                            );
                            if (found && confirm(`Remove "${found.name}" from your library?`)) {
                              deletePlaylist(found.id);
                              setSavedVibes((prev) => {
                                const next = new Set(prev);
                                next.delete(currentVibe.id);
                                return next;
                              });
                              setVibeToast(`REMOVED FROM LIBRARY: ${currentVibe.name}`);
                              setTimeout(() => setVibeToast(null), 3000);
                            }
                          }
                        }}
                        className={`px-4 py-2.5 rounded-sm border text-xs font-semibold tracking-wider uppercase active:scale-95 transition-all cursor-pointer ${
                          isSaved
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30'
                            : 'bg-white/[0.05] hover:bg-white/[0.10] text-secondary hover:text-primary border-white/10'
                        }`}
                        title={isSaved ? 'In your library (Click to remove)' : 'Save to Library'}
                      >
                        {isSaved ? 'SAVED' : 'SAVE TO LIBRARY'}
                      </button>
                    </div>
                  </div>

                  {/* Tracklist Preview Section */}
                  <div className="relative z-10 flex flex-col gap-3 pt-4 border-t border-white/[0.08]">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono tracking-widest text-muted uppercase">
                        TRACKLIST PREVIEW
                      </span>
                      <button
                        onClick={() => navigateToPlaylist(currentVibe.id)}
                        className="text-[11px] font-mono tracking-wider text-accent hover:underline uppercase cursor-pointer"
                      >
                        VIEW ALL {currentVibe.tracks.length} TRACKS
                      </button>
                    </div>

                    {/* Track Micro-Cards */}
                    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-highlight scrollbar-track-transparent">
                      {currentVibe.tracks.slice(0, 8).map((track, trackIdx) => {
                        const isCurrent = currentTrack?.id === track.id;
                        return (
                          <div
                            key={`vibe-track-${track.id}-${trackIdx}`}
                            onClick={() => playTrack(track, currentVibe.tracks)}
                            onMouseEnter={() => prefetchTrack(track)}
                            className={`group flex-shrink-0 w-40 sm:w-44 p-2.5 rounded-sm border transition-all cursor-pointer flex flex-col gap-2 ${
                              isCurrent
                                ? 'bg-white/[0.08] border-accent shadow-md'
                                : 'bg-surface/50 hover:bg-surface border-white/[0.06] hover:border-white/20'
                            }`}
                          >
                            <div className="relative aspect-square w-full rounded-sm overflow-hidden bg-highlight">
                              <ShelfTrackImage track={track} />
                            </div>

                            <div className="flex flex-col min-w-0">
                              <h4
                                className={`text-xs font-semibold truncate ${
                                  isCurrent ? 'text-accent' : 'text-primary'
                                }`}
                              >
                                {track.title}
                              </h4>
                              <p className="text-[11px] text-muted truncate mt-0.5">
                                {track.artist}
                              </p>
                              {track.vibeReason && (
                                <p className="text-[10px] text-secondary/80 italic truncate mt-1">
                                  {track.vibeReason}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Quick Switch Studio Matrix */}
            {vibePlaylists.length > 1 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-1">
                {vibePlaylists.map((vPl, idx) => {
                  const isSelected = activeVibe === vPl.vibe;
                  const channelNumber = String(idx + 1).padStart(2, '0');
                  return (
                    <div
                      key={`card-${vPl.id}`}
                      onClick={() => setActiveVibe(vPl.vibe)}
                      className={`p-3.5 rounded-sm border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                        isSelected
                          ? 'bg-elevated border-accent shadow-sm'
                          : 'bg-elevated/30 hover:bg-elevated/60 border-white/[0.06] hover:border-white/15'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono tracking-wider">
                        <span className="text-muted">CH.{channelNumber}</span>
                        <span className={isSelected ? 'text-accent font-semibold' : 'text-muted'}>
                          {isSelected ? 'ACTIVE' : 'SELECT'}
                        </span>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold text-primary truncate">
                          {vPl.name}
                        </h4>
                        <p className="text-[10px] font-mono text-muted uppercase mt-0.5">
                          {vPl.tracks.length} TRACKS // {vPl.vibeLabel}
                        </p>
                      </div>

                      <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] font-mono">
                        <span className="text-secondary/70">SWITCH VIBE</span>
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            navigateToPlaylist(vPl.id);
                          }}
                          className="text-accent hover:underline uppercase"
                        >
                          DETAILS
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Shelf 3: Discover Weekly */}
          {discoverWeekly.length > 0 && (
            <section data-testid="discover-weekly-shelf" className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Compass className="text-accent" size={22} />
                  <div>
                    <h2 className="text-xl font-bold text-primary">Discover Weekly</h2>
                    <p className="text-xs text-muted font-medium">Unheard tracks matching your taste, diversified with MMR novelty filtering</p>
                  </div>
                </div>
                <button
                  data-testid="play-shelf-discover-weekly"
                  onClick={() => playTrack(discoverWeekly[0], discoverWeekly)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent text-accent-content text-xs font-bold hover:scale-105 transition-all shadow-md"
                >
                  <Play size={14} fill="currentColor" />
                  <span>Play Shelf</span>
                </button>
              </div>

              <div className="flex gap-4 overflow-x-auto pb-3 pt-1 scrollbar-thin scrollbar-thumb-highlight scrollbar-track-transparent">
                {discoverWeekly.map((track) => {
                  const isCurrent = currentTrack?.id === track.id;
                  return (
                    <div
                      key={`dw-${track.id}`}
                      data-testid="track-item"
                      onClick={() => playTrack(track, discoverWeekly)}
                      onMouseEnter={() => prefetchTrack(track)}
                      className="group relative flex-shrink-0 w-36 sm:w-44 p-3 rounded-xl bg-elevated/40 hover:bg-elevated transition-all cursor-pointer border border-transparent hover:border-customBorder flex flex-col gap-2.5"
                    >
                      <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-highlight">
                        <ShelfTrackImage track={track} />
                        <button
                          data-testid="track-play-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isCurrent) togglePlay();
                            else playTrack(track, discoverWeekly);
                          }}
                          className={`absolute bottom-2 right-2 w-9 h-9 rounded-full bg-accent text-accent-content flex items-center justify-center shadow-xl transition-all duration-200 ${
                            isCurrent
                              ? 'opacity-100 scale-100'
                              : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0'
                          }`}
                        >
                          <Play size={16} fill="currentColor" className="ml-0.5" />
                        </button>
                      </div>

                      <div className="flex flex-col min-w-0">
                        <h3
                          data-testid="track-title"
                          className={`text-sm font-semibold truncate ${
                            isCurrent ? 'text-accent' : 'text-primary'
                          }`}
                        >
                          {track.title}
                        </h3>
                        <p
                          data-testid="track-artist"
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
                  );
                })}
              </div>
            </section>
          )}

          {/* Shelf 4: Heavy Rotation */}
          {heavyRotation.length > 0 && (
            <section data-testid="heavy-rotation-shelf" className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Flame className="text-orange-400" size={22} />
                  <div>
                    <h2 className="text-xl font-bold text-primary">Heavy Rotation</h2>
                    <p className="text-xs text-muted font-medium">Your high-frequency repeat obsessions from the last 5 days</p>
                  </div>
                </div>
                <button
                  data-testid="play-shelf-heavy-rotation"
                  onClick={() => playTrack(heavyRotation[0], heavyRotation)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent text-accent-content text-xs font-bold hover:scale-105 transition-all shadow-md"
                >
                  <Play size={14} fill="currentColor" />
                  <span>Play Shelf</span>
                </button>
              </div>

              <div className="flex gap-4 overflow-x-auto pb-3 pt-1 scrollbar-thin scrollbar-thumb-highlight scrollbar-track-transparent">
                {heavyRotation.map((track) => {
                  const isCurrent = currentTrack?.id === track.id;
                  return (
                    <div
                      key={`hr-${track.id}`}
                      data-testid="track-item"
                      onClick={() => playTrack(track, heavyRotation)}
                      onMouseEnter={() => prefetchTrack(track)}
                      className="group relative flex-shrink-0 w-36 sm:w-44 p-3 rounded-xl bg-elevated/40 hover:bg-elevated transition-all cursor-pointer border border-transparent hover:border-customBorder flex flex-col gap-2.5"
                    >
                      <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-highlight">
                        <ShelfTrackImage track={track} />
                        <button
                          data-testid="track-play-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isCurrent) togglePlay();
                            else playTrack(track, heavyRotation);
                          }}
                          className={`absolute bottom-2 right-2 w-9 h-9 rounded-full bg-accent text-accent-content flex items-center justify-center shadow-xl transition-all duration-200 ${
                            isCurrent
                              ? 'opacity-100 scale-100'
                              : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0'
                          }`}
                        >
                          <Play size={16} fill="currentColor" className="ml-0.5" />
                        </button>
                      </div>

                      <div className="flex flex-col min-w-0">
                        <h3
                          data-testid="track-title"
                          className={`text-sm font-semibold truncate ${
                            isCurrent ? 'text-accent' : 'text-primary'
                          }`}
                        >
                          {track.title}
                        </h3>
                        <p
                          data-testid="track-artist"
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
                  );
                })}
              </div>
            </section>
          )}

          {/* Shelf 5: Forgotten Favorites */}
          {forgottenFavorites.length > 0 && (
            <section data-testid="forgotten-favorites-shelf" className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="text-accent" size={22} />
                  <div>
                    <h2 className="text-xl font-bold text-primary">Forgotten Favorites</h2>
                    <p className="text-xs text-muted font-medium">Cherished tracks you loved in the past that haven't played in over 21 days</p>
                  </div>
                </div>
                <button
                  data-testid="play-shelf-forgotten-favorites"
                  onClick={() => playTrack(forgottenFavorites[0], forgottenFavorites)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent text-accent-content text-xs font-bold hover:scale-105 transition-all shadow-md"
                >
                  <Play size={14} fill="currentColor" />
                  <span>Play Shelf</span>
                </button>
              </div>

              <div className="flex gap-4 overflow-x-auto pb-3 pt-1 scrollbar-thin scrollbar-thumb-highlight scrollbar-track-transparent">
                {forgottenFavorites.map((track) => {
                  const isCurrent = currentTrack?.id === track.id;
                  return (
                    <div
                      key={`ff-${track.id}`}
                      data-testid="track-item"
                      onClick={() => playTrack(track, forgottenFavorites)}
                      onMouseEnter={() => prefetchTrack(track)}
                      className="group relative flex-shrink-0 w-36 sm:w-44 p-3 rounded-xl bg-elevated/40 hover:bg-elevated transition-all cursor-pointer border border-transparent hover:border-customBorder flex flex-col gap-2.5"
                    >
                      <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-highlight">
                        <ShelfTrackImage track={track} />
                        <button
                          data-testid="track-play-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isCurrent) togglePlay();
                            else playTrack(track, forgottenFavorites);
                          }}
                          className={`absolute bottom-2 right-2 w-9 h-9 rounded-full bg-accent text-accent-content flex items-center justify-center shadow-xl transition-all duration-200 ${
                            isCurrent
                              ? 'opacity-100 scale-100'
                              : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0'
                          }`}
                        >
                          <Play size={16} fill="currentColor" className="ml-0.5" />
                        </button>
                      </div>

                      <div className="flex flex-col min-w-0">
                        <h3
                          data-testid="track-title"
                          className={`text-sm font-semibold truncate ${
                            isCurrent ? 'text-accent' : 'text-primary'
                          }`}
                        >
                          {track.title}
                        </h3>
                        <p
                          data-testid="track-artist"
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
                  );
                })}
              </div>
            </section>
          )}
      </div>

      {/* Section 1: Global Top Charts (Mainstream Hits) */}
      {chartTracks.length > 0 && (
        <section data-testid="charts-section" className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="text-yellow-400" size={22} />
              <h2 className="text-xl font-bold text-primary">Global Top Hits & Charts</h2>
            </div>
            <span className="text-xs text-muted font-medium">Mainstream Hits · Full Stream</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {chartTracks.slice(0, 12).map((track) => {
              const isCurrent = currentTrack?.id === track.id;
              return (
                <div
                  key={track.id}
                  data-testid="track-item"
                  data-source="charts"
                  onClick={() => playTrack(track, chartTracks)}
                  onMouseEnter={() => prefetchTrack(track)}
                  className="group relative p-3 rounded-xl bg-elevated/40 hover:bg-elevated transition-all cursor-pointer border border-transparent hover:border-customBorder flex flex-col gap-2.5"
                >
                  <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-highlight">
                    <ShelfTrackImage track={track} />
                    <button
                      data-testid="track-play-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isCurrent) togglePlay();
                        else playTrack(track, chartTracks);
                      }}
                      className={`absolute bottom-2 right-2 w-10 h-10 rounded-full bg-accent text-accent-content flex items-center justify-center shadow-xl transition-all duration-200 ${
                        isCurrent
                          ? 'opacity-100 scale-100'
                          : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0'
                      }`}
                    >
                      <Play size={18} fill="currentColor" className="ml-0.5" />
                    </button>
                  </div>

                  <div className="flex flex-col min-w-0">
                    <h3
                      data-testid="track-title"
                      className={`text-sm font-semibold truncate ${
                        isCurrent ? 'text-accent' : 'text-primary'
                      }`}
                    >
                      {track.title}
                    </h3>
                    <p
                      data-testid="track-artist"
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
              );
            })}
          </div>
        </section>
      )}

      {/* Section 2: Popular Artists Carousel */}
      {topArtists.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="text-purple-400" size={22} />
              <h2 className="text-xl font-bold text-primary">Popular Artists</h2>
            </div>
            <span className="text-xs text-muted font-medium">Click artist to stream top tracks</span>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
            {topArtists.map((artist) => {
              const isSelected = activeArtistName === artist.name;
              return (
                <div
                  key={artist.id}
                  onClick={() => handleArtistClick(artist)}
                  className={`group p-3 rounded-2xl flex flex-col items-center gap-3 cursor-pointer transition-all ${
                    isSelected ? 'bg-accent/20 border border-accent/40' : 'bg-elevated/30 hover:bg-elevated'
                  }`}
                >
                  <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden shadow-lg border-2 border-transparent group-hover:border-accent transition-all">
                    <img
                      src={artist.picture}
                      alt={artist.name}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Play size={20} fill="white" className="text-white ml-0.5" />
                    </div>
                  </div>
                  <span className="text-xs sm:text-sm font-bold text-primary text-center truncate w-full">
                    {artist.name}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
};
