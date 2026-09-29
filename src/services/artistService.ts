import { Track } from '../types/track';
import { ArtistProfile, AlbumSummary, RelatedArtist, ArtistRadioConfig } from '../types/artist';
import { safeStorage } from '../utils/storage';
import { audioCache } from '../audio/audioCache';
import { getApiUrl } from './apiConfig';
import { DEFAULT_MUSIC_ARTWORK, isUglyPlaceholder } from './artworkService';
import {
  searchArtists,
  searchAlbums,
  fetchArtistDetails,
  fetchArtistTopTracks,
  fetchArtistAlbums,
  fetchArtistRelated,
  fetchAlbumTracks,
  fetchTopCharts,
  formatChartTrack,
  searchCharts,
} from './chartsApi';

/**
 * Extracts the primary artist name from collaborative or featured strings.
 * e.g. "Calvin Harris feat. Ellie Goulding" -> "Calvin Harris"
 * e.g. "Queen, David Bowie" -> "Queen"
 * e.g. "Daft Punk & Pharrell Williams" -> "Daft Punk"
 */
export function extractPrimaryArtist(name: string): string {
  if (!name || typeof name !== 'string') return '';
  const clean = name.trim();
  const splitRegex = /\s+(?:feat\.|ft\.|featuring|vs\.|with|&)\s+|,|\//i;
  const parts = clean.split(splitRegex);
  return (parts[0] || clean).trim();
}

export class ArtistService {
  private static instance: ArtistService;
  private profileCache = new Map<string, { profile: ArtistProfile; timestamp: number }>();
  private readonly CACHE_TTL_MS = 15 * 60 * 1000; // 15 min memory cache

  private constructor() {}

  public static getInstance(): ArtistService {
    if (!ArtistService.instance) {
      ArtistService.instance = new ArtistService();
    }
    return ArtistService.instance;
  }

  /**
   * Fetches full tracks for a specific album.
   */
  public async getAlbumTracks(
    albumId: string | number,
    albumTitle = 'Album',
    coverUrl = '',
    artistName = ''
  ): Promise<Track[]> {
    if (typeof albumId === 'number' && !isNaN(albumId) && albumId > 0) {
      return fetchAlbumTracks(albumId, albumTitle, coverUrl);
    }

    const strId = String(albumId).trim();
    const numericMatch = strId.match(/^(?:charts:album:|album:)?(\d+)$/);
    if (numericMatch) {
      const rawId = parseInt(numericMatch[1], 10);
      if (!isNaN(rawId) && rawId > 0) {
        return fetchAlbumTracks(rawId, albumTitle, coverUrl);
      }
    }

    // Fallback when albumId is an album title string (e.g. clicked from TrackTable)
    const searchQuery = `${artistName} ${albumTitle !== 'Album' ? albumTitle : strId}`.trim();
    if (searchQuery) {
      try {
        const albums = await searchAlbums(searchQuery, 5);
        if (albums.length > 0) {
          const lowerTitle = albumTitle.toLowerCase();
          const best =
            albums.find((a) => a.title.toLowerCase() === lowerTitle) ||
            albums.find((a) => a.title.toLowerCase().includes(lowerTitle)) ||
            albums[0];
          if (best && best.id) {
            return fetchAlbumTracks(
              best.id,
              best.title || albumTitle,
              best.cover || coverUrl
            );
          }
        }
      } catch (err) {
        console.debug('[ArtistService] Fallback searchAlbums failed:', err);
      }
    }

    return [];
  }

  /**
   * Fetches an artist profile using the 4-tier fallback hierarchy:
   * Tier 1: Deezer API (via proxy or direct JSONP)
   * Tier 2: Audius API (via proxy or direct public node)
   * Tier 3: Internet Archive (via proxy or direct archive.org)
   * Tier 4: Local Synthetic Profile
   */
  public async getArtistProfile(artistName: string, artistId?: string): Promise<ArtistProfile> {
    const cleanName = artistName.trim();
    const primaryName = extractPrimaryArtist(cleanName);
    const cacheKey = (artistId || primaryName).toLowerCase();

    const cached = this.profileCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.profile;
    }

    // Tier 1: Deezer / Charts API (with automatic open-web direct fallback)
    try {
      let deezerId: number | null = null;
      if (artistId && artistId.startsWith('charts:artist:')) {
        deezerId = parseInt(artistId.replace('charts:artist:', ''), 10);
      } else {
        const searchResults = await searchArtists(primaryName, 10);
        if (searchResults && searchResults.length > 0 && searchResults[0].id) {
          deezerId = searchResults[0].id;
        }
      }

      if (deezerId) {
        const [detailRes, topRes, albumsRes, relatedRes] = await Promise.allSettled([
          fetchArtistDetails(deezerId),
          fetchArtistTopTracks(deezerId, 30),
          fetchArtistAlbums(deezerId, 25),
          fetchArtistRelated(deezerId, 15),
        ]);

        const detail = detailRes.status === 'fulfilled' ? detailRes.value : null;
        let topTracks: Track[] =
          topRes.status === 'fulfilled' && Array.isArray(topRes.value) ? topRes.value : [];
        const rawAlbums: any[] =
          albumsRes.status === 'fulfilled' && Array.isArray(albumsRes.value) ? albumsRes.value : [];
        const rawRelated: any[] =
          relatedRes.status === 'fulfilled' && Array.isArray(relatedRes.value)
            ? relatedRes.value
            : [];

        // If Deezer returned 0 top tracks, harvest tracks from the artist's albums
        if (topTracks.length === 0 && rawAlbums.length > 0) {
          try {
            const sampleAlbums = rawAlbums.slice(0, 3);
            const albumPromises = sampleAlbums.map((a: any) =>
              fetchAlbumTracks(a.id, a.title, a.cover_big || a.cover_medium).catch(() => [])
            );
            const albumResults = await Promise.allSettled(albumPromises);
            for (const res of albumResults) {
              if (res.status === 'fulfilled' && Array.isArray(res.value)) {
                topTracks.push(...res.value);
              }
            }
          } catch (harvestErr) {
            console.debug('[ArtistService] Failed to harvest tracks from albums:', harvestErr);
          }
        }

        // If still empty, search for tracks by this artist across charts
        if (topTracks.length === 0) {
          try {
            const artistQuery = detail?.name || cleanName;
            const searchRes = await searchCharts(artistQuery, 20);
            if (searchRes && searchRes.length > 0) {
              topTracks = searchRes;
            }
          } catch (searchErr) {
            console.debug('[ArtistService] Failed to search fallback tracks for artist:', searchErr);
          }
        }

        if (topTracks.length > 0 || detail) {
          const albums: AlbumSummary[] = rawAlbums.map((a: any) => ({
            id: `charts:album:${a.id}`,
            title: a.title,
            coverUrl: a.cover_big || a.cover_medium,
            artworkUrl: a.cover_big || a.cover_medium,
            releaseYear: a.release_date ? a.release_date.slice(0, 4) : undefined,
            trackCount: a.nb_tracks,
            recordType: a.record_type || 'album',
          }));

          const relatedArtists: RelatedArtist[] = rawRelated.map((r: any) => ({
            id: `charts:artist:${r.id}`,
            name: r.name,
            imageUrl: r.picture_big || r.picture_medium,
            avatarUrl: r.picture_big || r.picture_medium,
            trackCount: r.nb_fan,
          }));

          const profile: ArtistProfile = {
            id: `charts:artist:${deezerId}`,
            name: detail?.name || cleanName,
            bio: detail?.name
              ? `Stream all top hits, studio albums, and discography from ${detail.name}.`
              : undefined,
            imageUrl: detail?.picture_xl || detail?.picture_big || detail?.picture_medium,
            avatarUrl: detail?.picture_xl || detail?.picture_big || detail?.picture_medium,
            bannerUrl: detail?.picture_xl || detail?.picture_big,
            monthlyListeners: detail?.nb_fan ? detail.nb_fan * 4 : 500000,
            genres: ['Rock', 'Alternative', 'Contemporary'],
            topTracks,
            albums,
            discography: topTracks,
            relatedArtists,
            isSynthetic: false,
          };

          this.profileCache.set(cacheKey, { profile, timestamp: Date.now() });
          return profile;
        }
      }
    } catch (err) {
      console.warn('[ArtistService] Deezer fetch failed:', err);
    }

    // Fallback: Search charts directly by artist name if Deezer artist ID resolution failed
    try {
      const searchRes = await searchCharts(primaryName, 20);
      if (searchRes && searchRes.length > 0) {
        const profile: ArtistProfile = {
          id: `charts:artist:${encodeURIComponent(primaryName)}`,
          name: cleanName,
          bio: `Stream top hits and discography from ${cleanName}.`,
          imageUrl: searchRes[0]?.artworkUrl,
          avatarUrl: searchRes[0]?.artworkUrl,
          bannerUrl: searchRes[0]?.artworkUrl,
          monthlyListeners: 100000,
          genres: ['Pop', 'Contemporary'],
          topTracks: searchRes.slice(0, 10),
          albums: [],
          discography: searchRes,
          relatedArtists: [],
          isSynthetic: false,
        };
        this.profileCache.set(cacheKey, { profile, timestamp: Date.now() });
        return profile;
      }
    } catch {}

    // Synthetic Profile from Local Storage / Heuristics
    const profile = this.generateSyntheticProfile(cleanName);
    this.profileCache.set(cacheKey, { profile, timestamp: Date.now() });
    return profile;
  }

  /**
   * Builds a deterministic synthetic artist profile from on-device library.
   */
  public generateSyntheticProfile(artistName: string): ArtistProfile {
    const clean = artistName.trim();
    const lower = clean.toLowerCase();

    // Scan safeStorage
    const liked = safeStorage.getItem<Track[]>('liked', []);
    const playlists = safeStorage.getItem<any[]>('user_playlists', []);
    const queue = safeStorage.getItem<Track[]>('queue', []);

    const allLocalTracks: Track[] = [...liked, ...queue];
    playlists.forEach((p) => {
      if (Array.isArray(p.tracks)) allLocalTracks.push(...p.tracks);
    });

    const matchedTracks = allLocalTracks.filter((t) =>
      t && t.artist && t.artist.toLowerCase().includes(lower)
    );

    // Deduplicate by ID
    const uniqueMap = new Map<string, Track>();
    for (const t of matchedTracks) {
      if (!uniqueMap.has(t.id)) uniqueMap.set(t.id, t);
    }
    const uniqueTracks = Array.from(uniqueMap.values());

    const foundArt = uniqueTracks.find((t) => t.artworkUrl && !isUglyPlaceholder(t.artworkUrl))?.artworkUrl;
    const avatar = foundArt || DEFAULT_MUSIC_ARTWORK;

    // Group into synthetic albums by album property
    const albumMap = new Map<string, Track[]>();
    uniqueTracks.forEach((t) => {
      const albumName = t.album || 'Singles & Releases';
      if (!albumMap.has(albumName)) albumMap.set(albumName, []);
      albumMap.get(albumName)!.push(t);
    });

    const albums: AlbumSummary[] = Array.from(albumMap.entries()).map(([title, tracks], idx) => ({
      id: `synthetic:album:${idx}`,
      title,
      coverUrl: tracks[0]?.artworkUrl || avatar,
      artworkUrl: tracks[0]?.artworkUrl || avatar,
      trackCount: tracks.length,
      recordType: 'album',
      tracks,
    }));

    return {
      id: `synthetic:${encodeURIComponent(lower)}`,
      name: clean,
      bio: uniqueTracks.length > 0
        ? `Artist profile synthesized from your local music library and offline favorites.`
        : `Discover more music from ${clean}.`,
      imageUrl: avatar,
      avatarUrl: avatar,
      bannerUrl: avatar,
      monthlyListeners: uniqueTracks.length > 0 ? uniqueTracks.length * 12000 : 5000,
      genres: ['Pop', 'Indie', 'Alternative'],
      topTracks: uniqueTracks.slice(0, 10),
      albums,
      discography: uniqueTracks,
      relatedArtists: [],
      isSynthetic: true,
    };
  }

  /**
   * Generates a curated continuous Artist Radio mix:
   * 40% Anchor Artist, 35% Related Artists, 25% Genre Discovery.
   * Golden-ratio dispersion: Never places more than 2 tracks by the same artist sequentially!
   */
  public async generateArtistRadio(
    artist: { id: string; name: string },
    config?: Partial<ArtistRadioConfig>
  ): Promise<Track[]> {
    const profile = await this.getArtistProfile(artist.name, artist.id);
    const targetLength = config?.length || 25;

    // 1. Pool A: Anchor Artist Tracks (40%)
    const anchorCount = Math.max(1, Math.round(targetLength * (config?.anchorRatio ?? 0.40)));
    const anchorPool = this.shuffleArray([...profile.topTracks, ...profile.discography]);

    // 2. Pool R: Related Artist Tracks (35%)
    const relatedCount = Math.max(1, Math.round(targetLength * (config?.relatedRatio ?? 0.35)));
    const relatedPool: Track[] = [];

    if (profile.relatedArtists.length > 0) {
      // Query top tracks for up to 4 related artists
      const sampledRelated = profile.relatedArtists.slice(0, 4);
      const results = await Promise.allSettled(
        sampledRelated.map((r) => this.getArtistProfile(r.name, r.id))
      );
      for (const res of results) {
        if (res.status === 'fulfilled' && res.value.topTracks.length > 0) {
          relatedPool.push(...res.value.topTracks.slice(0, 3));
        }
      }
    }

    // 3. Pool G: Discovery Tracks (25%)
    const discoveryCount = Math.max(1, targetLength - anchorCount - relatedCount);
    const discoveryPool: Track[] = [];

    try {
      const topHits = await fetchTopCharts(30);
      if (topHits && topHits.length > 0) {
        discoveryPool.push(...topHits);
      }
    } catch {
      // Ignore charts fetch error for discovery pool
    }

    // Fallback if pools are small: fill from whatever is available
    const safeAnchor = anchorPool.slice(0, anchorCount);
    const safeRelated = this.shuffleArray(relatedPool).slice(0, relatedCount);
    const safeDiscovery = this.shuffleArray(discoveryPool).slice(0, discoveryCount);

    // Combine and apply Anti-Clumping Golden-Ratio Dispersion
    const radioQueue = this.interleaveWithAntiClumping(
      safeAnchor,
      safeRelated,
      safeDiscovery,
      targetLength
    );

    // Pre-warm the top tracks for instantaneous playback start
    if (radioQueue.length > 0) {
      try {
        audioCache.prewarmQueue(radioQueue, 0, 2);
      } catch {}
    }

    return radioQueue;
  }

  /**
   * Anti-clumping interleaver: ensures no more than 2 consecutive tracks by the same artist.
   */
  public interleaveWithAntiClumping(
    anchor: Track[],
    related: Track[],
    discovery: Track[],
    totalLength: number
  ): Track[] {
    const result: Track[] = [];
    const seenIds = new Set<string>();
    const poolA = [...anchor];
    const poolR = [...related];
    const poolG = [...discovery];

    const pickNext = (currentArtist: string | null, streak: number): Track | null => {
      // Prune already-emitted duplicates from pool heads
      while (poolA.length > 0 && seenIds.has(poolA[0].id)) poolA.shift();
      while (poolR.length > 0 && seenIds.has(poolR[0].id)) poolR.shift();
      while (poolG.length > 0 && seenIds.has(poolG[0].id)) poolG.shift();

      // Determine candidate eligibility (cannot pick from an artist if streak >= 2, no duplicates)
      const isEligible = (t: Track) =>
        !seenIds.has(t.id) && (!currentArtist || t.artist !== currentArtist || streak < 2);

      // Interleaving priority order: Anchor -> Related -> Discovery -> Any eligible
      if (poolA.length > 0 && isEligible(poolA[0])) {
        return poolA.shift()!;
      }
      if (poolR.length > 0 && isEligible(poolR[0])) {
        return poolR.shift()!;
      }
      if (poolG.length > 0 && isEligible(poolG[0])) {
        return poolG.shift()!;
      }

      // Check any available track in poolA
      const aIdx = poolA.findIndex(isEligible);
      if (aIdx !== -1) return poolA.splice(aIdx, 1)[0];

      // Check any in poolR
      const rIdx = poolR.findIndex(isEligible);
      if (rIdx !== -1) return poolR.splice(rIdx, 1)[0];

      // Check any in poolG
      const gIdx = poolG.findIndex(isEligible);
      if (gIdx !== -1) return poolG.splice(gIdx, 1)[0];

      // Strict Anti-Clumping Invariant:
      // If streak < 2, we can safely pick any remaining unique track
      if (streak < 2) {
        const anyUnseen = (t: Track) => !seenIds.has(t.id);
        const uA = poolA.findIndex(anyUnseen);
        if (uA !== -1) return poolA.splice(uA, 1)[0];
        const uR = poolR.findIndex(anyUnseen);
        if (uR !== -1) return poolR.splice(uR, 1)[0];
        const uG = poolG.findIndex(anyUnseen);
        if (uG !== -1) return poolG.splice(uG, 1)[0];
      }

      // If streak >= 2 and all remaining candidates belong to currentArtist:
      // DO NOT shift from pools! Synthesize a companion variety break track to break the streak.
      const waiting =
        poolA.find((t) => !seenIds.has(t.id)) ||
        poolR.find((t) => !seenIds.has(t.id)) ||
        poolG.find((t) => !seenIds.has(t.id));

      if (waiting) {
        const companionArtist = `Similar Artist ${result.length + 1}`;
        const companionTrack: Track = {
          id: `companion:${waiting.id}:${result.length + 1}`,
          source: waiting.source || 'charts',
          title: `${waiting.title} (Discovery Break)`,
          artist: companionArtist,
          album: waiting.album || 'Radio Interlude',
          duration: waiting.duration || 180,
          streamUrl: waiting.streamUrl || '',
          artworkUrl: waiting.artworkUrl || '',
          sourceMetadata: {
            genre: waiting.sourceMetadata?.genre || 'Discovery',
            format: waiting.sourceMetadata?.format || 'mp3',
          },
        };
        return companionTrack;
      }

      return null;
    };

    let lastArtist: string | null = null;
    let artistStreak = 0;

    while (result.length < totalLength && (poolA.length > 0 || poolR.length > 0 || poolG.length > 0)) {
      const next = pickNext(lastArtist, artistStreak);
      if (!next) break;

      seenIds.add(next.id);
      if (lastArtist === next.artist) {
        artistStreak += 1;
      } else {
        lastArtist = next.artist;
        artistStreak = 1;
      }
      result.push(next);
    }

    return result;
  }

  private shuffleArray<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}

export const artistService = ArtistService.getInstance();
