import React, { useEffect, useState, useCallback } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { fetchTopCharts, fetchTopArtists, TopArtist } from '../../services/chartsApi';
import { Track } from '../../types/track';
import { prefetchTrack, prefetchTracks } from '../../utils/prefetch';
import {
  Play,
  Flame,
  Disc3,
  Heart,
  Trophy,
  Users,
  Compass,
  Clock,
  Headphones,
  SlidersHorizontal,
} from 'lucide-react';
import { recommendationEngine, DailyMix } from '../../services/recommendationEngine';
import { telemetryDb } from '../../services/telemetryDb';
import { dailyVibeManager } from '../../services/dailyVibeManager';
import { DailyVibePlaylist } from '../../types/vibes';
import { useAuthStore } from '../../store/authStore';
import { CustomizeVibesModal } from '../modals/CustomizeVibesModal';
import { artistService, extractPrimaryArtist } from '../../services/artistService';
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

/**
 * Enriches the candidate catalogue with top songs from the user's recently listened artists.
 * This ensures "Made For You" curates great songs by those artists rather than repeating only what was already played.
 */
async function enrichCatalogueWithRecentArtists(plays: any[], baseCatalogue: Track[]): Promise<Track[]> {
  try {
    const recentArtistNames = Array.from(
      new Set(
        [...plays]
          .sort((a, b) => b.startTime - a.startTime)
          .map((p) => extractPrimaryArtist(p.artist || '').trim())
          .filter((name) => name && name !== 'Unknown' && !name.toLowerCase().includes('synthetic pulse'))
      )
    ).slice(0, 8);

    if (recentArtistNames.length === 0) return baseCatalogue;

    const profiles = await Promise.allSettled(
      recentArtistNames.map((name) => artistService.getArtistProfile(name))
    );

    const recentTracks: Track[] = [];
    for (const res of profiles) {
      if (res.status === 'fulfilled' && res.value?.topTracks && Array.isArray(res.value.topTracks)) {
        recentTracks.push(...res.value.topTracks.slice(0, 10));
      }
    }

    const seenIds = new Set<string>();
    const merged: Track[] = [];
    for (const t of [...baseCatalogue, ...recentTracks]) {
      if (!seenIds.has(t.id)) {
        seenIds.add(t.id);
        merged.push(t);
      }
    }
    return merged;
  } catch {
    return baseCatalogue;
  }
}

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
  const [isVibesLoading, setIsVibesLoading] = useState(true);
  const [isCustomizeVibesOpen, setIsCustomizeVibesOpen] = useState(false);
  const [hasVibesConfigured, setHasVibesConfigured] = useState<boolean>(() => {
    return dailyVibeManager.hasUserConfiguredVibes(user?.uid || 'guest');
  });

  // Personalized Shelves
  const [madeForYou, setMadeForYou] = useState<Track[]>([]);
  const [discoverWeekly, setDiscoverWeekly] = useState<Track[]>([]);
  const [dailyMixes, setDailyMixes] = useState<DailyMix[]>([]);
  const [heavyRotation, setHeavyRotation] = useState<Track[]>([]);
  const [forgottenFavorites, setForgottenFavorites] = useState<Track[]>([]);

  const refreshVibes = useCallback(async () => {
    const accountId = user?.uid || 'guest';
    const configured = dailyVibeManager.hasUserConfiguredVibes(accountId);
    setHasVibesConfigured(configured);

    if (!configured) {
      setVibePlaylists([]);
      setIsVibesLoading(false);
      return;
    }

    setIsVibesLoading(true);
    try {
      const playlists = await dailyVibeManager.getDailyVibes(accountId, false);
      if (Array.isArray(playlists) && playlists.length > 0) {
        setVibePlaylists(playlists);
      }
    } catch (err) {
      console.warn('[HomeView] Failed refreshing daily vibes:', err);
    } finally {
      setIsVibesLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    let mounted = true;
    const accountId = user?.uid || 'guest';
    const configured = dailyVibeManager.hasUserConfiguredVibes(accountId);
    setHasVibesConfigured(configured);

    if (!configured) {
      setIsVibesLoading(false);
      setVibePlaylists([]);
      return;
    }

    setIsVibesLoading(true);

    dailyVibeManager
      .getDailyVibes(accountId)
      .then((playlists) => {
        if (mounted && Array.isArray(playlists) && playlists.length > 0) {
          setVibePlaylists(playlists);
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
          telemetryDb.getAllPlays().then(async (plays) => {
            if (!mounted) return;
            // 1. Instant generation with charts
            setMadeForYou(recommendationEngine.generateMadeForYou(plays, charts, likedTracks, followedArtists));
            setDiscoverWeekly(recommendationEngine.generateDiscoverWeekly(plays, charts, 15, followedArtists));
            setDailyMixes(recommendationEngine.generateDailyMixes(plays, charts, followedArtists));
            setHeavyRotation(recommendationEngine.generateHeavyRotation(plays, charts, likedTracks));
            setForgottenFavorites(recommendationEngine.generateForgottenFavorites(plays, charts, likedTracks));

            // 2. Fetch top songs by recently listened artists to curate unplayed songs by them in Made For You
            const enrichedCatalogue = await enrichCatalogueWithRecentArtists(plays, charts);
            if (!mounted) return;
            setMadeForYou(recommendationEngine.generateMadeForYou(plays, enrichedCatalogue, likedTracks, followedArtists));
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
      telemetryDb.getAllPlays().then(async (plays) => {
        const enrichedCatalogue = await enrichCatalogueWithRecentArtists(plays, chartTracks);
        setMadeForYou(recommendationEngine.generateMadeForYou(plays, enrichedCatalogue, likedTracks, followedArtists));
        setDiscoverWeekly(recommendationEngine.generateDiscoverWeekly(plays, enrichedCatalogue, 15, followedArtists));
        setDailyMixes(recommendationEngine.generateDailyMixes(plays, enrichedCatalogue, followedArtists));
        setHeavyRotation(recommendationEngine.generateHeavyRotation(plays, enrichedCatalogue, likedTracks));
        setForgottenFavorites(recommendationEngine.generateForgottenFavorites(plays, enrichedCatalogue, likedTracks));
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
              <Flame size={14} />
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
          {/* Shelf 1: Made For You */}
          {madeForYou.length > 0 && (
            <section data-testid="made-for-you-shelf" className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Headphones className="text-accent" size={22} />
                  <div>
                    <h2 className="text-xl font-bold text-primary">Made For You</h2>
                    <p className="text-xs text-muted font-medium">
                      Curated songs from artists you've recently listened to and your personal taste
                    </p>
                  </div>
                </div>
                <button
                  data-testid="play-shelf-made-for-you"
                  onClick={() => playTrack(madeForYou[0], madeForYou)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent text-accent-content text-xs font-bold hover:scale-105 transition-all shadow-md cursor-pointer"
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

          {/* Shelf 2: Daily Vibe Playlists (or Onboarding Hero if not yet configured) */}
          {!hasVibesConfigured ? (
            <section
              data-testid="daily-vibe-onboarding-shelf"
              className="p-6 rounded-2xl bg-gradient-to-r from-purple-950/40 via-surface to-accent/10 border border-accent/25 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 shadow-lg"
            >
              <div className="flex items-start gap-3.5 max-w-xl">
                <div className="w-10 h-10 rounded-xl bg-accent/20 border border-accent/30 flex items-center justify-center text-accent shrink-0 mt-0.5">
                  <SlidersHorizontal size={20} />
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-primary">Set Up Your 5 Daily Vibes</h2>
                  <p className="text-xs sm:text-sm text-secondary mt-1 leading-relaxed">
                    Type the 5 vibes, moods, or activities you want soundtracks for every morning (e.g. Gaming, Late Night Coding, Morning Walk, Deep Work, Gym). Dotify AI curates 20–30 tracks for each vibe tailored to your taste daily.
                  </p>
                </div>
              </div>

              <button
                data-testid="onboard-vibes-btn"
                onClick={() => setIsCustomizeVibesOpen(true)}
                className="px-5 py-2.5 rounded-xl bg-accent text-accent-content text-xs sm:text-sm font-bold hover:scale-105 transition-all shadow-md flex items-center gap-2 shrink-0 cursor-pointer"
              >
                <SlidersHorizontal size={15} />
                <span>Choose or Type Your 5 Vibes</span>
              </button>
            </section>
          ) : (
            (vibePlaylists.length > 0 || isVibesLoading) && (
              <section data-testid="daily-vibe-shelf" className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Disc3 className="text-accent" size={22} />
                    <div>
                      <h2 className="text-xl font-bold text-primary">Daily Vibe Playlists</h2>
                      <p className="text-xs text-muted font-medium">
                        Curated daily playlists based on your listening history & taste profile
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      data-testid="customize-vibes-btn"
                      onClick={() => setIsCustomizeVibesOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-elevated/80 hover:bg-elevated text-secondary hover:text-primary text-xs font-semibold transition-all border border-subtle/50 hover:border-subtle cursor-pointer shadow-sm"
                      title="Customize your 5 daily curated vibes"
                    >
                      <span>Customize Vibes</span>
                    </button>

                    {vibePlaylists.length > 0 && (
                      <button
                        data-testid="play-shelf-daily-vibes"
                        onClick={() => {
                          if (vibePlaylists[0]?.tracks?.length > 0) {
                            playTrack(vibePlaylists[0].tracks[0], vibePlaylists[0].tracks);
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent text-accent-content text-xs font-bold hover:scale-105 transition-all shadow-md cursor-pointer"
                        title="Play first vibe playlist"
                      >
                        <Play size={14} fill="currentColor" />
                        <span>Play Shelf</span>
                      </button>
                    )}
                  </div>
                </div>

                {isVibesLoading && vibePlaylists.length === 0 ? (
                  <div className="flex gap-4 overflow-x-auto pb-3 pt-1">
                    {[...Array(5)].map((_, i) => (
                      <div
                        key={`skeleton-${i}`}
                        className="w-36 sm:w-44 p-3 rounded-xl bg-elevated/20 animate-pulse flex flex-col gap-2.5"
                      >
                        <div className="aspect-square w-full rounded-lg bg-highlight/40" />
                        <div className="h-4 bg-highlight/40 rounded w-3/4" />
                        <div className="h-3 bg-highlight/30 rounded w-1/2" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex gap-4 overflow-x-auto pb-3 pt-1 scrollbar-thin scrollbar-thumb-highlight scrollbar-track-transparent">
                    {vibePlaylists.map((vPl) => {
                      const isCurrentPlaylist =
                        Boolean(currentTrack) &&
                        isPlaying &&
                        vPl.tracks.some((t) => t.id === currentTrack?.id);

                      return (
                        <div
                          key={`vibe-${vPl.id}`}
                          data-testid="vibe-playlist-card"
                          onClick={() => navigateToPlaylist(vPl.id)}
                          onMouseEnter={() => {
                            if (vPl.tracks.length > 0) prefetchTrack(vPl.tracks[0]);
                          }}
                          className="group relative flex-shrink-0 w-36 sm:w-44 p-3 rounded-xl bg-elevated/40 hover:bg-elevated transition-all cursor-pointer border border-transparent hover:border-customBorder flex flex-col gap-2.5"
                        >
                          <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-highlight">
                            <img
                              src={vPl.coverArt}
                              alt={vPl.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                            <button
                              data-testid="vibe-play-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isCurrentPlaylist) {
                                  togglePlay();
                                } else if (vPl.tracks.length > 0) {
                                  playTrack(vPl.tracks[0], vPl.tracks);
                                }
                              }}
                              className={`absolute bottom-2 right-2 w-9 h-9 rounded-full bg-accent text-accent-content flex items-center justify-center shadow-xl transition-all duration-200 cursor-pointer ${
                                isCurrentPlaylist
                                  ? 'opacity-100 scale-100'
                                  : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0'
                              }`}
                              title={`Play ${vPl.name}`}
                            >
                              <Play size={16} fill="currentColor" className="ml-0.5" />
                            </button>
                          </div>

                          <div className="flex flex-col min-w-0">
                            <h3
                              data-testid="vibe-title"
                              className={`text-sm font-semibold truncate ${
                                isCurrentPlaylist ? 'text-accent' : 'text-primary'
                              }`}
                            >
                              {vPl.name}
                            </h3>
                            <p
                              data-testid="vibe-subtitle"
                              className="text-xs text-secondary truncate mt-0.5"
                            >
                              {vPl.vibeLabel} · {vPl.tracks.length} songs
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )
          )}

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

      {/* Customize Daily Vibes Modal */}
      <CustomizeVibesModal
        isOpen={isCustomizeVibesOpen}
        onClose={() => setIsCustomizeVibesOpen(false)}
        onSavedAndRegenerated={refreshVibes}
        isOnboarding={!hasVibesConfigured}
      />
    </div>
  );
};
