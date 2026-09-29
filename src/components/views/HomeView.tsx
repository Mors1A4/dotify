import React, { useEffect, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { fetchTopCharts, fetchTopArtists, TopArtist } from '../../services/chartsApi';
import { Track } from '../../types/track';
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
  Gamepad2,
  Briefcase,
  PartyPopper,
  Coffee,
  Dumbbell,
  ExternalLink,
  Plus,
  Check,
  Loader2,
} from 'lucide-react';
import { recommendationEngine, DailyMix } from '../../services/recommendationEngine';
import { telemetryDb } from '../../services/telemetryDb';
import { dailyVibeManager } from '../../services/dailyVibeManager';
import { DailyVibePlaylist, VibeCategory } from '../../types/vibes';
import { useAuthStore } from '../../store/authStore';
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
          telemetryDb.getAllPlays().then((plays) => {
            if (!mounted) return;
            setMadeForYou(recommendationEngine.generateMadeForYou(plays, catalogue, likedTracks, followedArtists));
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
      telemetryDb.getAllPlays().then((plays) => {
        setMadeForYou(recommendationEngine.generateMadeForYou(plays, catalogue, likedTracks, followedArtists));
        setDiscoverWeekly(recommendationEngine.generateDiscoverWeekly(plays, catalogue, 15, followedArtists));
        setDailyMixes(recommendationEngine.generateDailyMixes(plays, catalogue, followedArtists));
        setHeavyRotation(recommendationEngine.generateHeavyRotation(plays, catalogue, likedTracks));
        setForgottenFavorites(recommendationEngine.generateForgottenFavorites(plays, catalogue, likedTracks));
      }).catch(() => {});
    }
  }, [likedTracks, followedArtists]);

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
          {madeForYou.length > 0 && (
            <section data-testid="made-for-you-shelf" className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="text-accent" size={22} />
                  <div>
                    <h2 className="text-xl font-bold text-primary">Made For You</h2>
                    <p className="text-xs text-muted font-medium">Your personalized mix of high-affinity favorites and tailored discoveries</p>
                  </div>
                </div>
                <button
                  data-testid="play-shelf-made-for-you"
                  onClick={() => playTrack(madeForYou[0], madeForYou)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent text-accent-content text-xs font-bold hover:scale-105 transition-all shadow-md"
                >
                  <Play size={14} fill="currentColor" />
                  <span>Play Shelf</span>
                </button>
              </div>

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
            </section>
          )}

          {/* Shelf 2: Daily Vibe Curation (Curated Daily by Gemini 3.8 Flash) */}
          <section data-testid="daily-vibe-shelf" className="flex flex-col gap-5">
            {vibeToast && (
              <div className="fixed top-20 right-6 z-50 bg-accent text-accent-content font-bold text-xs px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                <Sparkles size={14} />
                <span>{vibeToast}</span>
              </div>
            )}

            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-accent/15 text-accent border border-accent/30 shadow-md">
                  <Sparkles size={24} className="animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-xl sm:text-2xl font-black text-primary tracking-tight">
                      Daily Vibe Playlists
                    </h2>
                    <span className="text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full bg-accent/20 text-accent border border-accent/30 tracking-wider">
                      Gemini 3.8 Flash
                    </span>
                  </div>
                  <p className="text-xs text-secondary font-medium mt-0.5">
                    Curated once per day based on your listening history & live web search discoveries
                  </p>
                </div>
              </div>
            </div>

            {/* Interactive Vibe Selector Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              {[
                { id: 'gaming' as VibeCategory, label: 'Gaming', icon: Gamepad2, color: 'text-purple-400' },
                { id: 'working' as VibeCategory, label: 'Working', icon: Briefcase, color: 'text-emerald-400' },
                { id: 'partying' as VibeCategory, label: 'Partying', icon: PartyPopper, color: 'text-rose-400' },
                { id: 'chilling' as VibeCategory, label: 'Chilling', icon: Coffee, color: 'text-sky-400' },
                { id: 'workout' as VibeCategory, label: 'Workout', icon: Dumbbell, color: 'text-amber-400' },
              ].map((tab) => {
                const isActive = activeVibe === tab.id;
                const IconComponent = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveVibe(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-xs transition-all cursor-pointer whitespace-nowrap border ${
                      isActive
                        ? 'bg-accent text-accent-content border-accent shadow-lg shadow-accent/20 scale-[1.02]'
                        : 'bg-elevated/70 hover:bg-elevated text-secondary hover:text-primary border-customBorder/60 hover:border-customBorder'
                    }`}
                  >
                    <IconComponent size={16} className={isActive ? 'text-accent-content' : tab.color} />
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
                  <div className="p-8 rounded-3xl bg-elevated/40 border border-customBorder flex items-center justify-center gap-3 text-secondary text-sm">
                    <Loader2 size={18} className="animate-spin text-accent" />
                    <span>Loading today's curated vibes...</span>
                  </div>
                );
              }

              const isSaved = savedVibes.has(currentVibe.id) || (playlists || []).some((p) => p.name === currentVibe.name);

              return (
                <div
                  className={`relative overflow-hidden rounded-3xl p-6 sm:p-8 bg-gradient-to-br ${currentVibe.themeGradient} border shadow-2xl transition-all flex flex-col gap-6`}
                >
                  {/* Backdrop Glow */}
                  {currentVibe.coverArt && (
                    <img
                      src={currentVibe.coverArt}
                      alt=""
                      aria-hidden="true"
                      className="absolute -top-20 -right-20 w-80 h-80 object-cover blur-3xl opacity-25 pointer-events-none select-none scale-125"
                    />
                  )}

                  <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center gap-6 justify-between">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
                      <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-2xl overflow-hidden shadow-2xl border border-white/10 shrink-0 bg-highlight group">
                        <img
                          src={currentVibe.coverArt}
                          alt={currentVibe.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[11px] font-extrabold text-white flex items-center gap-1">
                          <span>{currentVibe.vibeIcon}</span>
                          <span>{currentVibe.vibeLabel}</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-accent px-2.5 py-0.5 rounded-full bg-accent/20 border border-accent/30">
                            {currentVibe.vibeTagline || 'Curated for today'}
                          </span>
                        </div>

                        <h3 className="text-2xl sm:text-3xl font-black text-primary tracking-tight">
                          {currentVibe.name}
                        </h3>

                        <p className="text-xs sm:text-sm text-secondary max-w-xl line-clamp-2">
                          {currentVibe.description}
                        </p>

                        <div className="flex items-center gap-2 text-xs text-muted font-medium mt-1">
                          <span>{currentVibe.tracks.length} songs</span>
                          <span>•</span>
                          <span>{currentVibe.modelUsed || 'Gemini 3.8 Flash'}</span>
                          <span>•</span>
                          <span>Updated for Today</span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-3 w-full md:w-auto mt-2 md:mt-0">
                      <button
                        onClick={() => {
                          if (currentVibe.tracks.length > 0) {
                            playTrack(currentVibe.tracks[0], currentVibe.tracks);
                          }
                        }}
                        className="flex-1 md:flex-initial flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-accent text-accent-content font-extrabold text-xs sm:text-sm shadow-xl hover:scale-105 active:scale-95 transition-all cursor-pointer"
                      >
                        <Play size={18} fill="currentColor" />
                        <span>Play Vibe</span>
                      </button>

                      <button
                        onClick={() => {
                          navigateToPlaylist(currentVibe.id);
                        }}
                        className="flex-1 md:flex-initial flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-elevated/80 hover:bg-highlight border border-customBorder text-primary font-bold text-xs shadow transition-all active:scale-95 cursor-pointer"
                        title="View complete playlist and tracks list"
                      >
                        <ExternalLink size={15} />
                        <span>View Full Playlist</span>
                      </button>

                      <button
                        onClick={() => {
                          if (!isSaved) {
                            dailyVibeManager.saveVibeToLibrary(currentVibe);
                            setSavedVibes((prev) => new Set(prev).add(currentVibe.id));
                            setVibeToast(`Saved "${currentVibe.name}" to your library!`);
                            setTimeout(() => setVibeToast(null), 3000);
                          }
                        }}
                        className={`flex items-center justify-center gap-1.5 p-3 rounded-full border text-xs font-bold transition-all active:scale-95 cursor-pointer ${
                          isSaved
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                            : 'bg-elevated/80 hover:bg-highlight text-secondary hover:text-primary border-customBorder'
                        }`}
                        title={isSaved ? 'Saved to Library' : 'Save to Library'}
                      >
                        {isSaved ? <Check size={16} /> : <Plus size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Track Peek Preview Carousel */}
                  <div className="relative z-10 flex flex-col gap-2.5 pt-2 border-t border-white/10">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-primary uppercase tracking-wider">
                        Curated Songs in this Vibe
                      </span>
                      <button
                        onClick={() => navigateToPlaylist(currentVibe.id)}
                        className="text-xs font-bold text-accent hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <span>View all {currentVibe.tracks.length} tracks</span>
                        <span>→</span>
                      </button>
                    </div>

                    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-highlight scrollbar-track-transparent">
                      {currentVibe.tracks.slice(0, 8).map((track, trackIdx) => {
                        const isCurrent = currentTrack?.id === track.id;
                        return (
                          <div
                            key={`vibe-track-${track.id}-${trackIdx}`}
                            onClick={() => playTrack(track, currentVibe.tracks)}
                            onMouseEnter={() => prefetchTrack(track)}
                            className="group relative flex-shrink-0 w-36 sm:w-44 p-3 rounded-2xl bg-surface/70 hover:bg-surface border border-white/5 hover:border-customBorder transition-all cursor-pointer flex flex-col gap-2 shadow-md"
                          >
                            <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-highlight">
                              <ShelfTrackImage track={track} />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isCurrent) togglePlay();
                                  else playTrack(track, currentVibe.tracks);
                                }}
                                className={`absolute bottom-2 right-2 w-8 h-8 rounded-full bg-accent text-accent-content flex items-center justify-center shadow-xl transition-all duration-200 ${
                                  isCurrent
                                    ? 'opacity-100 scale-100'
                                    : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0'
                                }`}
                              >
                                <Play size={14} fill="currentColor" className="ml-0.5" />
                              </button>
                            </div>

                            <div className="flex flex-col min-w-0">
                              <h4
                                className={`text-xs font-bold truncate ${
                                  isCurrent ? 'text-accent' : 'text-primary'
                                }`}
                              >
                                {track.title}
                              </h4>
                              <p className="text-[11px] text-secondary truncate mt-0.5">
                                {track.artist}
                              </p>
                              {track.vibeReason && (
                                <span className="text-[10px] text-accent/90 truncate mt-1 bg-accent/10 px-1.5 py-0.5 rounded-md font-medium">
                                  ✨ {track.vibeReason}
                                </span>
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

            {/* Quick Switch Cards for All Vibes */}
            {vibePlaylists.length > 1 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-1">
                {vibePlaylists.map((vPl) => {
                  const isSelected = activeVibe === vPl.vibe;
                  return (
                    <div
                      key={`card-${vPl.id}`}
                      onClick={() => setActiveVibe(vPl.vibe)}
                      className={`group p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                        isSelected
                          ? 'bg-elevated border-accent shadow-md scale-[1.02]'
                          : 'bg-elevated/40 hover:bg-elevated border-customBorder/60 hover:border-customBorder'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xl">{vPl.vibeIcon}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (vPl.tracks.length > 0) {
                              playTrack(vPl.tracks[0], vPl.tracks);
                            }
                          }}
                          className="w-8 h-8 rounded-full bg-accent text-accent-content flex items-center justify-center opacity-80 group-hover:opacity-100 transition-all hover:scale-105 shadow"
                          title={`Play ${vPl.vibeLabel} Vibe`}
                        >
                          <Play size={14} fill="currentColor" className="ml-0.5" />
                        </button>
                      </div>

                      <div>
                        <h4 className="text-xs font-extrabold text-primary truncate group-hover:text-accent transition-colors">
                          {vPl.name}
                        </h4>
                        <p className="text-[11px] text-secondary truncate mt-0.5">
                          {vPl.tracks.length} tracks • {vPl.vibeLabel}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[10px] text-muted">
                        <span className="group-hover:text-primary font-medium">
                          {isSelected ? 'Active Vibe' : 'Select Vibe'}
                        </span>
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            navigateToPlaylist(vPl.id);
                          }}
                          className="text-accent hover:underline font-bold"
                        >
                          View
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
