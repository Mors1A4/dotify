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
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useVibeDjStore } from '../../store/vibeDjStore';
import { recommendationEngine, DailyMix } from '../../services/recommendationEngine';
import { telemetryDb } from '../../services/telemetryDb';
import { dailyVibeManager } from '../../services/dailyVibeManager';
import { DailyVibePlaylist } from '../../types/vibes';
import { useAuthStore } from '../../store/authStore';
import { CustomizeVibesModal } from '../modals/CustomizeVibesModal';
import { artistService, extractPrimaryArtist } from '../../services/artistService';
import { communityListeningService } from '../../services/communityListeningService';
import {
  DEFAULT_MUSIC_ARTWORK,
  getTrackArtwork,
  resolveTrackArtwork,
  isUglyPlaceholder,
  markArtworkUrlFailed,
  getCacheKey,
} from '../../services/artworkService';
import { isUserFavouredPlay } from '../../services/listeningClassifier';

const ShelfTrackImage: React.FC<{ track: Track }> = ({ track }) => {
  const initialArt = getTrackArtwork(track);
  const [imgSrc, setImgSrc] = useState<string>(() =>
    isUglyPlaceholder(initialArt) ? DEFAULT_MUSIC_ARTWORK : initialArt
  );
  const [hasResolved, setHasResolved] = useState(false);

  useEffect(() => {
    let mounted = true;
    const current = getTrackArtwork(track);
    if (isUglyPlaceholder(current)) {
      setImgSrc(DEFAULT_MUSIC_ARTWORK);
      resolveTrackArtwork(track.artist, track.title).then((resolved) => {
        if (mounted && resolved && !isUglyPlaceholder(resolved)) {
          track.artworkUrl = resolved;
          setImgSrc(resolved);
        }
      });
    } else {
      setImgSrc(current);
    }
    return () => {
      mounted = false;
    };
  }, [track.id, track.artworkUrl, track.artist, track.title]);

  const handleError = () => {
    if (imgSrc && imgSrc !== DEFAULT_MUSIC_ARTWORK) {
      markArtworkUrlFailed(imgSrc, track.artist, track.title);
    }
    setImgSrc(DEFAULT_MUSIC_ARTWORK);
    if (!hasResolved) {
      setHasResolved(true);
      resolveTrackArtwork(track.artist, track.title, { forceFresh: true, ignoreUrl: imgSrc }).then(
        (resolved) => {
          if (resolved && !isUglyPlaceholder(resolved) && resolved !== imgSrc) {
            track.artworkUrl = resolved;
            setImgSrc(resolved);
          }
        }
      );
    }
  };

  return (
    <img
      data-testid="track-artwork"
      data-artwork-key={getCacheKey(track.artist || '', track.title || '')}
      src={imgSrc}
      alt={track.title}
      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      loading="lazy"
      onError={handleError}
    />
  );
};

/**
 * Enriches the candidate catalogue with top songs from the user's recently listened artists.
 * This ensures "Made For You" curates great songs by those artists rather than repeating only what was already played.
 */
async function enrichCatalogueWithRecentArtists(plays: any[], baseCatalogue: Track[]): Promise<Track[]> {
  try {
    const favouredPlays = plays.filter((p) => isUserFavouredPlay(p));
    const candidatePlays =
      favouredPlays.length > 0
        ? favouredPlays
        : plays.filter((p) => !p.skipped && p.completionRate >= 0.8 && !p.trackId?.startsWith('vibe:'));

    const recentArtistNames = Array.from(
      new Set(
        [...candidatePlays]
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
    navigateToVibeDj,
    deletePlaylist,
  } = usePlayerStore();

  const { isActive: isVibeDjActive, vibeLabel, startVibeDj } = useVibeDjStore();

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

  // Community Recommendations: Specific songs others have been listening to
  const [communityTracks, setCommunityTracks] = useState<Track[]>([]);
  const [isCommunityLoading, setIsCommunityLoading] = useState(true);

  const handleRefreshVibes = useCallback(async () => {
    const accountId = user?.uid || 'guest';
    const configured = dailyVibeManager.hasUserConfiguredVibes(accountId);
    setHasVibesConfigured(configured);

    if (!configured) {
      setIsCustomizeVibesOpen(true);
      return;
    }

    setVibePlaylists([]);
    setIsVibesLoading(true);
    try {
      const fresh = await dailyVibeManager.getDailyVibes(accountId, true);
      if (Array.isArray(fresh) && fresh.length > 0) {
        setVibePlaylists(fresh);
      }
    } catch (err) {
      console.warn('[HomeView] Failed refreshing vibes:', err);
    } finally {
      setIsVibesLoading(false);
    }
  }, [user?.uid]);

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

            // 3. Fetch community recommendations: specific songs others have been listening to

            communityListeningService
              .getRecommendedSongsFromCommunityArtists({
                excludeUserId: user?.uid,
                userPlays: plays,
                catalogue: enrichedCatalogue,
              })
              .then((tracks) => {
                if (mounted && tracks.length > 0) {
                  setCommunityTracks(tracks);
                }
              })
              .catch(() => {})
              .finally(() => {
                if (mounted) setIsCommunityLoading(false);
              });
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

        communityListeningService
          .getRecommendedSongsFromCommunityArtists({
            excludeUserId: user?.uid,
            userPlays: plays,
            catalogue: enrichedCatalogue,
          })
          .then((tracks) => {
            if (tracks.length > 0) setCommunityTracks(tracks);
          })
          .catch(() => {});
      }).catch(() => {});
    }
  }, [likedTracks, followedArtists, user?.uid]);

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
                onClick={() => playTrack(heroTrack, chartTracks, 0, { origin: 'charts' })}
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
        {/* Vibe DJ Live Feature Banner */}
        <div className="relative rounded-2xl p-5 md:p-6 bg-gradient-to-r from-purple-950/80 via-slate-900 to-indigo-950 border border-purple-500/30 shadow-xl overflow-hidden flex flex-col md:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center flex-shrink-0 text-purple-400 shadow-inner">
              <Sparkles size={24} className={isVibeDjActive ? 'animate-spin' : ''} />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Live AI DJ
                </span>
                {isVibeDjActive && (
                  <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    Live Now • {vibeLabel}
                  </span>
                )}
              </div>
              <h2 className="text-lg md:text-xl font-bold text-white tracking-tight">
                Endless Live Flow with Vibe DJ
              </h2>
              <p className="text-xs text-white/70 max-w-xl line-clamp-2">
                Sequentially streams tracks and artists tailored to what you love right now. Learns from every play, skip, and replay with a 1-click Shake Up button.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-shrink-0 w-full md:w-auto justify-end">
            <button
              onClick={() => {
                if (!isVibeDjActive) {
                  startVibeDj();
                }
                navigateToVibeDj();
              }}
              className="flex-1 md:flex-initial px-5 py-2.5 rounded-xl bg-accent text-accent-content font-bold text-xs hover:scale-105 active:scale-95 transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <Play size={14} fill="currentColor" />
              <span>{isVibeDjActive ? 'Open DJ Console' : 'Start Vibe DJ'}</span>
            </button>
          </div>
        </div>

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
                  onClick={() => playTrack(madeForYou[0], madeForYou, 0, { origin: 'recommendation' })}
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
                      onClick={() => playTrack(track, madeForYou, undefined, { origin: 'recommendation' })}
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
                            else playTrack(track, madeForYou, undefined, { origin: 'recommendation' });
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
                      <h2 className="text-xl font-bold text-primary">Vibe Playlists</h2>
                      <p className="text-xs text-muted font-medium">
                        Personalized soundscapes tailored to your taste · Click Refresh anytime for a fresh mix
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      data-testid="refresh-vibes-btn"
                      onClick={handleRefreshVibes}
                      disabled={isVibesLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-elevated/80 hover:bg-elevated text-secondary hover:text-primary text-xs font-semibold transition-all border border-subtle/50 hover:border-subtle cursor-pointer shadow-sm disabled:opacity-50"
                      title="Curate a fresh rotation of tracks for all your 5 vibes"
                    >
                      <RefreshCw size={13} className={isVibesLoading ? 'animate-spin text-accent' : ''} />
                      <span>{isVibesLoading ? 'Refreshing...' : 'Refresh Vibes'}</span>
                    </button>

                    <button
                      data-testid="customize-vibes-btn"
                      onClick={() => setIsCustomizeVibesOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-elevated/80 hover:bg-elevated text-secondary hover:text-primary text-xs font-semibold transition-all border border-subtle/50 hover:border-subtle cursor-pointer shadow-sm"
                      title="Customize your 5 vibes"
                    >
                      <SlidersHorizontal size={13} />
                      <span>Customize Vibes</span>
                    </button>

                    {vibePlaylists.length > 0 && (
                      <button
                        data-testid="play-shelf-daily-vibes"
                        onClick={() => {
                          if (vibePlaylists[0]?.tracks?.length > 0) {
                            playTrack(vibePlaylists[0].tracks[0], vibePlaylists[0].tracks, 0, {
                              origin: 'vibe_playlist',
                              playlistId: vibePlaylists[0].id,
                              playlistName: vibePlaylists[0].name,
                            });
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
                            {vPl.isExtraLong && (
                              <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-md text-[10px] font-bold text-cyan-300 border border-cyan-500/40 shadow-md">
                                Extra Long
                              </span>
                            )}
                            <button
                              data-testid="vibe-play-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isCurrentPlaylist) {
                                  togglePlay();
                                } else if (vPl.tracks.length > 0) {
                                  playTrack(vPl.tracks[0], vPl.tracks, 0, {
                                    origin: 'vibe_playlist',
                                    playlistId: vPl.id,
                                    playlistName: vPl.name,
                                  });
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
                              {vPl.isExtraLong ? ' · Extra Long' : ''}
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

          {/* Shelf: Trending Among Other Listeners (Specific songs others have been listening to) */}
          {(communityTracks.length > 0 || isCommunityLoading) && (
            <section data-testid="community-recommendations-shelf" className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Headphones className="text-accent" size={22} />
                  <div>
                    <h2 className="text-xl font-bold text-primary">Trending Among Other Listeners</h2>
                    <p className="text-xs text-muted font-medium">
                      Songs that others who have been using the app have been listening to
                    </p>
                  </div>
                </div>
                {communityTracks.length > 0 && (
                  <button
                    data-testid="play-shelf-community"
                    onClick={() => playTrack(communityTracks[0], communityTracks, 0, { origin: 'recommendation' })}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent text-accent-content text-xs font-bold hover:scale-105 transition-all shadow-md cursor-pointer"
                  >
                    <Play size={14} fill="currentColor" />
                    <span>Play Shelf</span>
                  </button>
                )}
              </div>

              {/* Track list carousel */}
              {isCommunityLoading && communityTracks.length === 0 ? (
                <div className="flex gap-4 overflow-x-auto pb-3 pt-1">
                  {[...Array(6)].map((_, i) => (
                    <div
                      key={`comm-skeleton-${i}`}
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
                  {communityTracks.map((track) => {
                    const isCurrent = currentTrack?.id === track.id;

                    return (
                      <div
                        key={`comm-${track.id}`}
                        data-testid="track-item"
                        onClick={() => playTrack(track, communityTracks, undefined, { origin: 'recommendation' })}
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
                              else playTrack(track, communityTracks, undefined, { origin: 'recommendation' });
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
              )}
            </section>
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
                  onClick={() => playTrack(discoverWeekly[0], discoverWeekly, 0, { origin: 'discover_weekly' })}
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
                      onClick={() => playTrack(track, discoverWeekly, undefined, { origin: 'discover_weekly' })}
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
                            else playTrack(track, discoverWeekly, undefined, { origin: 'discover_weekly' });
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
                  onClick={() => playTrack(heavyRotation[0], heavyRotation, 0, { origin: 'recommendation' })}
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
                      onClick={() => playTrack(track, heavyRotation, undefined, { origin: 'recommendation' })}
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
                            else playTrack(track, heavyRotation, undefined, { origin: 'recommendation' });
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
                  onClick={() => playTrack(forgottenFavorites[0], forgottenFavorites, 0, { origin: 'recommendation' })}
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
                      onClick={() => playTrack(track, forgottenFavorites, undefined, { origin: 'recommendation' })}
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
                            else playTrack(track, forgottenFavorites, undefined, { origin: 'recommendation' });
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
                  onClick={() => playTrack(track, chartTracks, undefined, { origin: 'charts' })}
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
                        else playTrack(track, chartTracks, undefined, { origin: 'charts' });
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
