import React, { useEffect, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { artistService } from '../../services/artistService';
import { ArtistProfile } from '../../types/artist';
import { TrackTable } from '../common/TrackTable';
import {
  Play,
  Radio,
  Library,
  ArrowLeft,
  Users,
  Disc3,
  CheckCircle2,
  Share2,
  Heart,
  Loader2,
  Music,
  X,
  Shuffle,
} from 'lucide-react';
import {
  DEFAULT_MUSIC_ARTWORK,
  getTrackArtwork,
  isUglyPlaceholder,
  resolveTrackArtwork,
} from '../../services/artworkService';

export const ArtistView: React.FC = () => {
  const {
    selectedArtist,
    navigateBack,
    playTrack,
    navigateToArtist,
    navigateToAlbum,
    isFollowingArtist,
    toggleFollowArtist,
  } = usePlayerStore();

  const [profile, setProfile] = useState<ArtistProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [isRadioLoading, setIsRadioLoading] = useState(false);
  const [loadingAlbumId, setLoadingAlbumId] = useState<string | null>(null);

  const currentArtistName = profile?.name || selectedArtist?.name || '';
  const isFollowing = isFollowingArtist(currentArtistName);

  const handleToggleFollow = () => {
    if (!currentArtistName) return;
    toggleFollowArtist({
      id: profile?.id || selectedArtist?.id,
      name: currentArtistName,
      imageUrl: profile?.imageUrl || profile?.avatarUrl,
      genres: profile?.genres || [],
    });
  };

  useEffect(() => {
    let isMounted = true;
    if (!selectedArtist?.name) return;

    async function loadArtist() {
      setIsLoading(true);
      try {
        const data = await artistService.getArtistProfile(
          selectedArtist!.name,
          selectedArtist!.id
        );
        if (isMounted) {
          setProfile(data);
        }
      } catch (err) {
        console.warn('[ArtistView] Failed to load artist:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadArtist();
    return () => {
      isMounted = false;
    };
  }, [selectedArtist?.id, selectedArtist?.name]);

  const handlePlayTopHits = async () => {
    if (profile && profile.topTracks.length > 0) {
      playTrack(profile.topTracks[0], profile.topTracks, 0, {
        origin: 'artist',
        artistName: profile.name,
      });
      return;
    }
    // Fallback: If topTracks is empty but artist has albums, play from first album
    if (profile && profile.albums.length > 0) {
      await handlePlayAlbum(profile.albums[0]);
    }
  };

  const handleStartArtistRadio = async () => {
    if (!profile) return;
    setIsRadioLoading(true);
    try {
      const radioTracks = await artistService.generateArtistRadio(
        { id: profile.id, name: profile.name },
        { length: 50 }
      );
      if (radioTracks.length > 0) {
        playTrack(radioTracks[0], radioTracks, 0, {
          origin: 'radio',
          artistName: profile.name,
        });
      }
    } catch (err) {
      console.warn('[ArtistView] Failed to start Artist Radio:', err);
    } finally {
      setIsRadioLoading(false);
    }
  };

  const handlePlayAlbum = async (album: any) => {
    let tracks = album.tracks;
    if (!tracks || tracks.length === 0) {
      setLoadingAlbumId(album.id);
      try {
        tracks = await artistService.getAlbumTracks(
          album.id,
          album.title,
          album.coverUrl,
          profile?.name
        );
        album.tracks = tracks;
      } catch (err) {
        console.warn('[ArtistView] Failed to load album tracks for playback:', err);
      } finally {
        setLoadingAlbumId(null);
      }
    }

    if (tracks && tracks.length > 0) {
      playTrack(tracks[0], tracks, 0, {
        origin: 'artist',
        artistName: profile?.name,
        albumTitle: album.title,
      });
    }
  };

  if (isLoading) {
    return (
      <div data-testid="artist-view-loading" className="p-4 md:p-8 flex flex-col gap-6 animate-pulse">
        <div className="h-8 w-24 bg-elevated rounded-full" />
        <div className="h-64 bg-elevated rounded-2xl w-full" />
        <div className="h-8 w-48 bg-elevated rounded" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-elevated rounded-lg w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-8 text-center text-muted flex flex-col items-center justify-center min-h-[50vh]">
        <Disc3 size={48} className="opacity-40 mb-3" />
        <h2 className="text-xl font-bold text-primary">Artist Not Found</h2>
        <p className="text-xs text-secondary mt-1">
          Could not find an artist matching "{selectedArtist?.name}".
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

  const displayedTracks = showAllTracks
    ? profile.topTracks
    : profile.topTracks.slice(0, 5);

  return (
    <div data-testid="artist-view" className="flex flex-col gap-8 pb-32">
      {/* Hero Banner Section */}
      <div className="relative min-h-[340px] md:min-h-[400px] w-full overflow-hidden bg-gradient-to-b from-surface/80 via-elevated to-base flex flex-col justify-between p-6 md:p-10 border-b border-customBorder/40">
        {/* Background Image Ambient Glow */}
        {profile.imageUrl && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-25 filter blur-2xl scale-110 pointer-events-none"
            style={{ backgroundImage: `url(${profile.imageUrl})` }}
          />
        )}

        {/* Top Navigation Row */}
        <div className="relative z-10 flex items-center justify-between">
          <button
            data-testid="artist-back-btn"
            onClick={navigateBack}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-base/60 backdrop-blur-md hover:bg-highlight text-xs font-bold text-primary transition-all border border-customBorder/50"
          >
            <ArrowLeft size={14} />
            <span>Back</span>
          </button>

          {profile.isSynthetic && (
            <span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] font-medium flex items-center gap-1.5 backdrop-blur-sm">
              <Library size={12} />
              <span>Library Profile · Synthesized from your collection</span>
            </span>
          )}
        </div>

        {/* Artist Identity Block */}
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-end gap-6 mt-6">
          <img
            src={getTrackArtwork({
              artist: profile.name,
              title: profile.topTracks[0]?.title || profile.name,
              artworkUrl: profile.imageUrl,
            })}
            alt={profile.name}
            className="w-36 h-36 md:w-52 md:h-52 rounded-full object-cover shadow-2xl border-4 border-base/40 shrink-0 bg-highlight"
            onError={(e) => {
              const target = e.currentTarget;
              if (target.src !== DEFAULT_MUSIC_ARTWORK) {
                target.src = DEFAULT_MUSIC_ARTWORK;
                resolveTrackArtwork(
                  profile.name,
                  profile.topTracks[0]?.title || profile.name
                ).then((url) => {
                  if (url && !isUglyPlaceholder(url)) target.src = url;
                });
              }
            }}
          />

          <div className="flex flex-col gap-2 min-w-0">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-accent" />
              <span className="text-xs font-bold uppercase tracking-wider text-muted">
                Verified Artist
              </span>
            </div>

            <h1
              data-testid="artist-name"
              className="text-3xl md:text-6xl font-black text-primary tracking-tight"
            >
              {profile.name}
            </h1>

            <div className="flex flex-wrap items-center gap-2 text-xs text-secondary mt-1">
              <span>
                {profile.monthlyListeners?.toLocaleString()} monthly listeners
              </span>
              {profile.genres && profile.genres.length > 0 && (
                <>
                  <span>•</span>
                  <span>{profile.genres.join(', ')}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Transport & Action Bar */}
        <div className="relative z-10 flex flex-wrap items-center gap-4 mt-6">
          <button
            data-testid="artist-play-btn"
            onClick={handlePlayTopHits}
            className="flex items-center gap-2 px-6 py-3 rounded-full bg-accent text-accent-content font-bold text-sm hover:scale-105 active:scale-95 transition-all shadow-xl"
          >
            <Play size={18} fill="currentColor" />
            <span>Play Top Hits</span>
          </button>

          <button
            data-testid="artist-radio-btn"
            onClick={handleStartArtistRadio}
            disabled={isRadioLoading}
            className="flex items-center gap-2 px-5 py-3 rounded-full bg-elevated hover:bg-highlight border border-customBorder/60 text-primary font-bold text-sm hover:scale-105 active:scale-95 transition-all shadow-md disabled:opacity-50"
          >
            <Radio size={18} className="text-accent" />
            <span>{isRadioLoading ? 'Starting Radio...' : 'Artist Radio'}</span>
          </button>

          <button
            data-testid="artist-follow-btn"
            onClick={handleToggleFollow}
            className={`px-5 py-2.5 rounded-full border text-xs font-bold transition-all shadow-sm active:scale-95 ${
              isFollowing
                ? 'bg-accent/20 border-accent text-accent hover:bg-accent/30'
                : 'border-customBorder text-primary hover:bg-elevated'
            }`}
          >
            {isFollowing ? 'Following' : 'Follow'}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="px-4 md:px-10 flex flex-col gap-10">
        {/* Popular Tracks Section */}
        {profile.topTracks.length > 0 ? (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-primary">Popular Tracks</h2>
              {profile.topTracks.length > 5 && (
                <button
                  onClick={() => setShowAllTracks(!showAllTracks)}
                  className="text-xs font-bold text-secondary hover:text-primary transition-colors"
                >
                  {showAllTracks ? 'Show less' : 'See more'}
                </button>
              )}
            </div>

            <TrackTable tracks={displayedTracks} playOrigin="artist" />
          </section>
        ) : profile.albums.length > 0 ? (
          <div className="p-4 rounded-xl bg-elevated/40 border border-customBorder/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Disc3 className="text-accent shrink-0" size={24} />
              <div>
                <p className="text-sm font-semibold text-primary">Explore Discography</p>
                <p className="text-xs text-secondary">Browse any album below to inspect and stream individual songs.</p>
              </div>
            </div>
            <button
              onClick={() =>
                navigateToAlbum({
                  id: profile.albums[0].id,
                  title: profile.albums[0].title,
                  artist: profile.name,
                  coverUrl: profile.albums[0].coverUrl,
                  year: profile.albums[0].releaseYear ? String(profile.albums[0].releaseYear) : undefined,
                  recordType: profile.albums[0].recordType,
                  tracks: profile.albums[0].tracks,
                })
              }
              className="px-4 py-2 rounded-full bg-accent text-accent-content text-xs font-bold hover:scale-105 transition-all shrink-0 shadow-md"
            >
              Browse Latest Release
            </button>
          </div>
        ) : (
          <div className="p-8 text-center text-muted bg-elevated/20 rounded-2xl border border-customBorder/30">
            <Music size={32} className="mx-auto mb-2 opacity-40 text-muted" />
            <p className="text-sm font-semibold text-primary">No Tracks Found</p>
            <p className="text-xs text-secondary mt-1">There are currently no streamable tracks indexed for this artist.</p>
          </div>
        )}

        {/* Albums & Releases Section */}
        {profile.albums.length > 0 && (
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Disc3 className="text-accent" size={20} />
                <h2 className="text-xl font-bold text-primary">Albums & Discography</h2>
              </div>
              <span className="text-xs text-muted font-mono">{profile.albums.length} releases</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {profile.albums.map((album) => {
                return (
                  <div
                    key={album.id}
                    onClick={() =>
                      navigateToAlbum({
                        id: album.id,
                        title: album.title,
                        artist: profile.name,
                        coverUrl: album.coverUrl,
                        year: album.releaseYear ? String(album.releaseYear) : undefined,
                        recordType: album.recordType,
                        tracks: album.tracks,
                      })
                    }
                    className="group p-3 rounded-xl transition-all cursor-pointer border bg-elevated/40 hover:bg-elevated border-transparent hover:border-customBorder flex flex-col gap-2.5"
                  >
                    <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-highlight">
                      <img
                        src={getTrackArtwork({
                          artist: profile.name,
                          title: album.title,
                          artworkUrl: album.coverUrl,
                        })}
                        alt={album.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                        onError={(e) => {
                          const target = e.currentTarget;
                          if (target.src !== DEFAULT_MUSIC_ARTWORK) {
                            target.src = DEFAULT_MUSIC_ARTWORK;
                            resolveTrackArtwork(profile.name, album.title).then((url) => {
                              if (url && !isUglyPlaceholder(url)) target.src = url;
                            });
                          }
                        }}
                      />
                      <button
                        type="button"
                        aria-label={`Play ${album.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayAlbum(album);
                        }}
                        className={`absolute bottom-2 right-2 w-9 h-9 rounded-full bg-accent text-accent-content flex items-center justify-center shadow-lg transition-all duration-200 ${
                          loadingAlbumId === album.id
                            ? 'opacity-100 translate-y-0'
                            : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0'
                        }`}
                      >
                        {loadingAlbumId === album.id ? (
                          <Loader2 size={16} className="animate-spin text-accent-content" />
                        ) : (
                          <Play size={16} fill="currentColor" className="ml-0.5" />
                        )}
                      </button>
                    </div>

                    <div className="flex flex-col min-w-0">
                      <h3 className="text-xs font-semibold truncate text-primary group-hover:text-accent transition-colors">
                        {album.title}
                      </h3>
                      <p className="text-[11px] text-muted truncate">
                        {album.releaseYear ? `${album.releaseYear} • ` : ''}
                        {album.recordType ? album.recordType.toUpperCase() : 'Album'}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Fans Also Like (Related Artists) Section */}
        {profile.relatedArtists.length > 0 && (
          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Users className="text-purple-400" size={20} />
              <h2 className="text-xl font-bold text-primary">Fans Also Like</h2>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-4">
              {profile.relatedArtists.map((rel) => (
                <div
                  key={rel.id}
                  onClick={() => navigateToArtist(rel.name, rel.id)}
                  className="group p-3 rounded-2xl flex flex-col items-center gap-3 cursor-pointer bg-elevated/30 hover:bg-elevated transition-all"
                >
                  <div className="relative w-24 h-24 rounded-full overflow-hidden shadow-lg border-2 border-transparent group-hover:border-accent transition-all">
                    <img
                      src={getTrackArtwork({
                        artist: rel.name,
                        title: rel.name,
                        artworkUrl: rel.imageUrl,
                      })}
                      alt={rel.name}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                      loading="lazy"
                      onError={(e) => {
                        const target = e.currentTarget;
                        if (target.src !== DEFAULT_MUSIC_ARTWORK) {
                          target.src = DEFAULT_MUSIC_ARTWORK;
                          resolveTrackArtwork(rel.name, rel.name).then((url) => {
                            if (url && !isUglyPlaceholder(url)) target.src = url;
                          });
                        }
                      }}
                    />
                  </div>
                  <span className="text-xs font-bold text-primary text-center truncate w-full group-hover:text-accent transition-colors">
                    {rel.name}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
