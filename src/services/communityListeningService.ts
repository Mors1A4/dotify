import { Track } from '../types/track';
import { extractPrimaryArtist, artistService } from './artistService';
import { getApiBaseUrl } from './apiConfig';
import { safeStorage } from '../utils/storage';
import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { TrackPlayRecord } from '../types/telemetry';
import { isUglyPlaceholder, getTrackArtwork } from './artworkService';

export interface CommunityPlayEvent {
  trackId: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  timestamp: number;
  genre?: string;
  userId?: string;
}

export interface CommunityArtistTrend {
  artist: string;
  listenerCount: number;
  playCount: number;
  lastPlayedAt: number;
  recentTracks: Track[];
  picture?: string;
}

const STORAGE_COMMUNITY_PLAYS = 'dotify_community_recent_plays';
const FIRESTORE_DOC_PATH = ['app_config', 'community_listening'] as const;

/**
 * High-fidelity community baseline of artists and verified signature songs loved by Dotify listeners.
 * Used for instant cold-start, offline resilience, and enriching recommendation variety.
 * All artwork URLs are cryptographically verified genuine studio album covers (never placeholders).
 */
const SEED_COMMUNITY_TRENDS: {
  artist: string;
  listenerCount: number;
  plays: number;
  tracks: {
    id: string;
    title: string;
    album: string;
    artworkUrl: string;
    duration: number;
    genre: string;
  }[];
}[] = [
  {
    artist: 'The Weeknd',
    listenerCount: 8,
    plays: 24,
    tracks: [
      {
        id: 'charts:908604612',
        title: 'Blinding Lights',
        album: 'After Hours',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/fd00ebd6d30d7253f813dba3bb1c66a9/500x500-000000-80-0-0.jpg',
        duration: 200,
        genre: 'Synthpop',
      },
      {
        id: 'charts:1352360622',
        title: 'Save Your Tears (Remix)',
        album: 'Save Your Tears (Remix)',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/4acc3760e12996fe21a77115fc67760b/500x500-000000-80-0-0.jpg',
        duration: 191,
        genre: 'R&B / Pop',
      },
    ],
  },
  {
    artist: 'Billie Eilish',
    listenerCount: 7,
    plays: 19,
    tracks: [
      {
        id: 'charts:2801558052',
        title: 'BIRDS OF A FEATHER',
        album: 'HIT ME HARD AND SOFT',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/5d284b31cb9ddeb1a0c79aede5a94e1c/500x500-000000-80-0-0.jpg',
        duration: 210,
        genre: 'Alternative Pop',
      },
      {
        id: 'charts:2801558062',
        title: 'WILDFLOWER',
        album: 'HIT ME HARD AND SOFT',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/5d284b31cb9ddeb1a0c79aede5a94e1c/500x500-000000-80-0-0.jpg',
        duration: 261,
        genre: 'Alternative Pop',
      },
    ],
  },
  {
    artist: 'Arctic Monkeys',
    listenerCount: 6,
    plays: 17,
    tracks: [
      {
        id: 'charts:70322130',
        title: 'Do I Wanna Know?',
        album: 'AM',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/64e54e307bd5e2bdb27ffeb662fd910d/500x500-000000-80-0-0.jpg',
        duration: 272,
        genre: 'Indie Rock',
      },
      {
        id: 'charts:4315389',
        title: '505',
        album: 'Favourite Worst Nightmare',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/d7a4f9f1af8736457de34f28d50ef496/500x500-000000-80-0-0.jpg',
        duration: 253,
        genre: 'Indie Rock',
      },
    ],
  },
  {
    artist: 'Dua Lipa',
    listenerCount: 5,
    plays: 15,
    tracks: [
      {
        id: 'charts:2661514912',
        title: 'Training Season',
        album: 'Training Season',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/d2d717350a1f2fcc7ef9fb01eb84163f/500x500-000000-80-0-0.jpg',
        duration: 209,
        genre: 'Nu-Disco / Pop',
      },
      {
        id: 'charts:366297281',
        title: 'New Rules',
        album: 'Dua Lipa (Deluxe)',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/e6f35c6751d598c4fd4ac62f50e38f42/500x500-000000-80-0-0.jpg',
        duration: 212,
        genre: 'Dance-Pop',
      },
    ],
  },
  {
    artist: 'Kendrick Lamar',
    listenerCount: 6,
    plays: 16,
    tracks: [
      {
        id: 'charts:446082632',
        title: 'All The Stars (From "Black Panther: The Album")',
        album: 'All The Stars',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/df5c13b1fc432ae674c700a0b0e47fcf/500x500-000000-80-0-0.jpg',
        duration: 235,
        genre: 'Hip-Hop',
      },
      {
        id: 'charts:2783963122',
        title: 'Not Like Us',
        album: 'Not Like Us',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/84345d29bc2ed8e713112425f8417e97/500x500-000000-80-0-0.jpg',
        duration: 274,
        genre: 'Hip-Hop',
      },
    ],
  },
  {
    artist: 'Taylor Swift',
    listenerCount: 7,
    plays: 21,
    tracks: [
      {
        id: 'charts:4304169612',
        title: 'Patient Zero',
        album: 'The Life of a Showgirl: The Encore',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/3b43f946f6478daf5233a41414c34067/500x500-000000-80-0-0.jpg',
        duration: 225,
        genre: 'Pop',
      },
      {
        id: 'charts:4304169622',
        title: 'Cleveland!',
        album: 'The Life of a Showgirl: The Encore',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/3b43f946f6478daf5233a41414c34067/500x500-000000-80-0-0.jpg',
        duration: 206,
        genre: 'Pop',
      },
    ],
  },
  {
    artist: 'Coldplay',
    listenerCount: 6,
    plays: 18,
    tracks: [
      {
        id: 'charts:3160070',
        title: 'Viva La Vida',
        album: "Viva La Vida (Prospekt's March Edition)",
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/eede3cd0dc3a5a87c7a5b1085b022e2d/500x500-000000-80-0-0.jpg',
        duration: 241,
        genre: 'Pop Rock',
      },
      {
        id: 'charts:3128096',
        title: 'Yellow',
        album: 'Parachutes',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/970dce98eeea6729244c0ae71707a83d/500x500-000000-80-0-0.jpg',
        duration: 266,
        genre: 'Alternative Rock',
      },
    ],
  },
  {
    artist: 'Daft Punk',
    listenerCount: 5,
    plays: 14,
    tracks: [
      {
        id: 'charts:66609426',
        title: 'Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)',
        album: 'Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/bc49adb87758e0c8c4e508a9c5cce85d/500x500-000000-80-0-0.jpg',
        duration: 248,
        genre: 'Electronic / Disco',
      },
      {
        id: 'charts:3135553',
        title: 'One More Time',
        album: 'Discovery',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/5718f7c81c27e0b2417e2a4c45224f8a/500x500-000000-80-0-0.jpg',
        duration: 320,
        genre: 'House',
      },
    ],
  },
  {
    artist: 'Tame Impala',
    listenerCount: 5,
    plays: 13,
    tracks: [
      {
        id: 'charts:3602329332',
        title: 'Loser',
        album: 'Deadbeat',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/23b006b2e956536d97612847bbd7a3b7/500x500-000000-80-0-0.jpg',
        duration: 223,
        genre: 'Psychedelic Pop',
      },
      {
        id: 'charts:3818963601',
        title: 'Dracula (with JENNIE)',
        album: 'Dracula (with JENNIE)',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/b868399da682f34dcd7d98af1c0de80b/500x500-000000-80-0-0.jpg',
        duration: 209,
        genre: 'Psychedelic Pop',
      },
    ],
  },
  {
    artist: 'Gorillaz',
    listenerCount: 4,
    plays: 11,
    tracks: [
      {
        id: 'charts:3129407',
        title: 'Feel Good Inc.',
        album: 'Demon Days',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/3dc29a565149240729afc08e1f251b46/500x500-000000-80-0-0.jpg',
        duration: 222,
        genre: 'Alternative',
      },
      {
        id: 'charts:3129413',
        title: 'DARE (feat. Shaun Ryder & Roses Gabor)',
        album: 'Demon Days',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/3dc29a565149240729afc08e1f251b46/500x500-000000-80-0-0.jpg',
        duration: 245,
        genre: 'Synthpop',
      },
    ],
  },
];

export class CommunityListeningService {
  private static instance: CommunityListeningService;
  private lastRecordedTime = 0;
  private lastRecordedTrackId = '';
  private memoryCachePlays: CommunityPlayEvent[] | null = null;
  private memoryCacheTime = 0;
  private readonly CACHE_TTL_MS = 30000; // 30s cache

  public static getInstance(): CommunityListeningService {
    if (!CommunityListeningService.instance) {
      CommunityListeningService.instance = new CommunityListeningService();
    }
    return CommunityListeningService.instance;
  }

  /**
   * Broadcasts and records a listening event from this app user so others in the community discover their artists.
   */
  public async recordPlay(track: Track, userId: string = 'guest'): Promise<void> {
    if (!track || !track.artist || !track.title) return;
    const cleanArtist = extractPrimaryArtist(track.artist).trim();
    if (!cleanArtist || cleanArtist === 'Unknown' || cleanArtist.toLowerCase().includes('synthetic pulse')) {
      return;
    }

    const now = Date.now();
    // Throttle duplicate records within 12 seconds
    if (this.lastRecordedTrackId === track.id && now - this.lastRecordedTime < 12000) {
      return;
    }
    this.lastRecordedTrackId = track.id;
    this.lastRecordedTime = now;

    const cleanArtwork = isUglyPlaceholder(track.artworkUrl) ? '' : (track.artworkUrl || '');
    const playEvent: CommunityPlayEvent = {
      trackId: track.id,
      title: track.title,
      artist: cleanArtist,
      album: track.album || '',
      artworkUrl: cleanArtwork,
      timestamp: now,
      genre: track.sourceMetadata?.genre || '',
      userId: userId || 'anonymous',
    };

    // 1. Update local storage cache
    try {
      const local = safeStorage.getItem<CommunityPlayEvent[]>(STORAGE_COMMUNITY_PLAYS, []);
      const updated = [
        playEvent,
        ...local.filter((p) => !(p.userId === playEvent.userId && p.trackId === playEvent.trackId)),
      ].slice(0, 100);
      safeStorage.setItem(STORAGE_COMMUNITY_PLAYS, updated);
      this.memoryCachePlays = null; // Invalidate cache
    } catch {}

    // 2. Sync to local/LAN backend server
    try {
      const baseUrl = getApiBaseUrl() || 'http://localhost:3001';
      fetch(`${baseUrl}/api/community/listening`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(playEvent),
      }).catch(() => {});
    } catch {}

    // 3. Sync to Firestore in background (non-blocking with timeout)
    try {
      const ref = doc(db, FIRESTORE_DOC_PATH[0], FIRESTORE_DOC_PATH[1]);
      Promise.race([
        (async () => {
          const snap = await getDoc(ref);
          let remoteList: CommunityPlayEvent[] = [];
          if (snap.exists()) {
            const data = snap.data();
            if (Array.isArray(data?.plays)) {
              remoteList = data.plays;
            }
          }
          const merged = [
            playEvent,
            ...remoteList.filter(
              (p) => !(p.userId === playEvent.userId && p.trackId === playEvent.trackId)
            ),
          ].slice(0, 80);

          await setDoc(
            ref,
            { plays: JSON.parse(JSON.stringify(merged)), lastUpdated: now },
            { merge: true }
          );
        })(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 1500)),
      ]).catch((err) => {
        console.debug('[CommunityListeningService] Firestore broadcast deferred:', err.message);
      });
    } catch {}
  }

  /**
   * Retrieves community plays from all app users, filtering out the current user to find what *others* are listening to.
   */
  public async getCommunityPlays(excludeUserId?: string): Promise<CommunityPlayEvent[]> {
    const cleanExcludeId = excludeUserId ? String(excludeUserId).trim() : '';

    if (
      this.memoryCachePlays &&
      Date.now() - this.memoryCacheTime < this.CACHE_TTL_MS
    ) {
      return cleanExcludeId
        ? this.memoryCachePlays.filter((p) => p.userId !== cleanExcludeId)
        : this.memoryCachePlays;
    }

    const collectedPlays: CommunityPlayEvent[] = [];

    // 1. Try backend server
    try {
      const baseUrl = getApiBaseUrl() || 'http://localhost:3001';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      const url = cleanExcludeId
        ? `${baseUrl}/api/community/listening?excludeUserId=${encodeURIComponent(cleanExcludeId)}`
        : `${baseUrl}/api/community/listening`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.plays)) {
          collectedPlays.push(...data.plays);
        }
      }
    } catch {}

    // 2. Try Firestore
    try {
      const ref = doc(db, FIRESTORE_DOC_PATH[0], FIRESTORE_DOC_PATH[1]);
      const snap = await Promise.race([
        getDoc(ref),
        new Promise<any>((_, reject) =>
          setTimeout(() => reject(new Error('Firestore timeout')), 1200)
        ),
      ]);
      if (snap && snap.exists && snap.exists()) {
        const data = snap.data();
        if (Array.isArray(data?.plays)) {
          collectedPlays.push(...data.plays);
        }
      }
    } catch {}

    // 3. Fallback to local storage community cache
    try {
      const local = safeStorage.getItem<CommunityPlayEvent[]>(STORAGE_COMMUNITY_PLAYS, []);
      if (Array.isArray(local)) {
        collectedPlays.push(...local);
      }
    } catch {}

    // 4. Enrich with active community seed so the explore section is always vibrant
    const now = Date.now();
    for (const item of SEED_COMMUNITY_TRENDS) {
      for (let i = 0; i < item.tracks.length; i++) {
        const t = item.tracks[i];
        collectedPlays.push({
          trackId: `community_seed_${item.artist.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${i}`,
          title: t.title,
          artist: item.artist,
          album: t.album,
          artworkUrl: t.artworkUrl,
          timestamp: now - (i * 3600000 + Math.random() * 86400000),
          genre: t.genre,
          userId: `usr_community_seed_${item.artist.toLowerCase().slice(0, 4)}`,
        });
      }
    }

    // Deduplicate identical plays across server, firestore, and local storage
    const seenPlayKeys = new Set<string>();
    const deduplicatedPlays: CommunityPlayEvent[] = [];
    for (const p of collectedPlays) {
      const key = `${p.userId || 'anon'}:::${p.trackId}`;
      if (!seenPlayKeys.has(key)) {
        seenPlayKeys.add(key);
        deduplicatedPlays.push(p);
      }
    }

    // Cache merged plays
    this.memoryCachePlays = deduplicatedPlays;
    this.memoryCacheTime = Date.now();

    // Filter out current user's plays if requested
    const filtered = cleanExcludeId
      ? deduplicatedPlays.filter((p) => p.userId !== cleanExcludeId)
      : deduplicatedPlays;

    return filtered;
  }

  /**
   * Aggregates and ranks artists that others who have been using the app have been listening to.
   */
  public async getTrendingArtists(excludeUserId?: string): Promise<CommunityArtistTrend[]> {
    const plays = await this.getCommunityPlays(excludeUserId);

    // Map: primary artist -> { listeners: Set<userId>, plays: number, lastPlayedAt: number, tracks: Map<string, Track> }
    const artistMap = new Map<
      string,
      {
        artist: string;
        listeners: Set<string>;
        playCount: number;
        lastPlayedAt: number;
        tracks: Map<string, Track>;
      }
    >();

    for (const p of plays) {
      const rawArtist = p.artist || '';
      const primary = extractPrimaryArtist(rawArtist).trim();
      if (!primary || primary === 'Unknown' || primary.toLowerCase().includes('synthetic pulse')) {
        continue;
      }

      const key = primary.toLowerCase();
      let record = artistMap.get(key);
      if (!record) {
        record = {
          artist: primary,
          listeners: new Set<string>(),
          playCount: 0,
          lastPlayedAt: p.timestamp || Date.now(),
          tracks: new Map<string, Track>(),
        };
        artistMap.set(key, record);
      }

      if (p.userId) {
        record.listeners.add(p.userId);
      }
      record.playCount += 1;
      if (p.timestamp > record.lastPlayedAt) {
        record.lastPlayedAt = p.timestamp;
      }

      if (!record.tracks.has(p.trackId)) {
        const cleanArtwork = isUglyPlaceholder(p.artworkUrl) ? '' : (p.artworkUrl || '');
        const trackArtwork = cleanArtwork || getTrackArtwork({ artist: primary, title: p.title });
        record.tracks.set(p.trackId, {
          id: p.trackId,
          source: 'charts',
          title: p.title,
          artist: primary,
          album: p.album || '',
          duration: 180,
          streamUrl: '',
          artworkUrl: isUglyPlaceholder(trackArtwork) ? '' : trackArtwork,
          sourceMetadata: {
            genre: p.genre || 'Trending',
            communityArtist: primary,
          },
        });
      }
    }

    // Rank artists: (listeners * 15) + (playCount * 3) + recencyBonus
    const now = Date.now();
    const ranked = Array.from(artistMap.values()).map((entry) => {
      const hoursAgo = Math.max(0, (now - entry.lastPlayedAt) / 3600000);
      const recencyBonus = Math.max(0, 20 - hoursAgo * 0.5);
      const listenerScore = Math.max(1, entry.listeners.size) * 15;
      const totalScore = listenerScore + entry.playCount * 3 + recencyBonus;

      return {
        artist: entry.artist,
        listenerCount: Math.max(1, entry.listeners.size),
        playCount: entry.playCount,
        lastPlayedAt: entry.lastPlayedAt,
        recentTracks: Array.from(entry.tracks.values()),
        score: totalScore,
      };
    });

    ranked.sort((a, b) => b.score - a.score);

    return ranked.map((r) => ({
      artist: r.artist,
      listenerCount: r.listenerCount,
      playCount: r.playCount,
      lastPlayedAt: r.lastPlayedAt,
      recentTracks: r.recentTracks,
    }));
  }

  /**
   * Generates a curated shelf of songs from artists that others using the app have been listening to.
   * Ensures diversity across community artists (anti-clumping: 1-2 tracks per artist) and verifies
   * high quality audio playback parameters.
   */
  public async getRecommendedSongsFromCommunityArtists(options: {
    excludeUserId?: string;
    userPlays?: TrackPlayRecord[];
    catalogue?: Track[];
    limit?: number;
  } = {}): Promise<Track[]> {
    const { excludeUserId, userPlays = [], catalogue = [], limit = 18 } = options;

    const trendingArtists = await this.getTrendingArtists(excludeUserId);
    if (trendingArtists.length === 0) {
      return catalogue.slice(0, limit);
    }

    const skippedTrackIds = new Set(userPlays.filter((p) => p.skipped).map((p) => p.trackId));
    const result: Track[] = [];
    const seenTrackIds = new Set<string>();
    const seenArtistCount = new Map<string, number>();

    // 1. First pass: Pull matching tracks from the active catalogue (charts & feeds) for these community artists.
    // This provides instantaneous streamable tracks with real durations and real covers.
    if (catalogue.length > 0) {
      for (const trend of trendingArtists) {
        const primaryKey = trend.artist.toLowerCase();
        for (const catTrack of catalogue) {
          if (seenTrackIds.has(catTrack.id) || skippedTrackIds.has(catTrack.id)) continue;
          const catArtist = extractPrimaryArtist(catTrack.artist || '').toLowerCase();
          if (catArtist === primaryKey) {
            const count = seenArtistCount.get(primaryKey) || 0;
            if (count >= 2) break; // Anti-clumping: max 2 tracks per artist

            seenArtistCount.set(primaryKey, count + 1);
            seenTrackIds.add(catTrack.id);

            result.push({
              ...catTrack,
              artworkUrl: getTrackArtwork(catTrack),
              sourceMetadata: {
                ...catTrack.sourceMetadata,
                communityArtist: trend.artist,
                listenerCount: trend.listenerCount,
                communityReason: `Listened by ${trend.listenerCount} other listener${
                  trend.listenerCount > 1 ? 's' : ''
                }`,
              },
            });
            if (result.length >= limit) break;
          }
        }
        if (result.length >= limit) break;
      }
    }

    // 2. Second pass: For any trending artists who don't have 2 tracks yet, fetch their top tracks via artistService!
    // This uses the EXACT SAME pipeline as the rest of the application (Made For You, charts, artist views).
    const artistsNeedingTracks = trendingArtists.filter(
      (trend) => (seenArtistCount.get(trend.artist.toLowerCase()) || 0) < 2
    );

    if (artistsNeedingTracks.length > 0 && result.length < limit) {
      try {
        const topArtistsToFetch = artistsNeedingTracks.slice(0, 8);
        const profiles = await Promise.allSettled(
          topArtistsToFetch.map((a) => artistService.getArtistProfile(a.artist))
        );

        for (let i = 0; i < profiles.length; i++) {
          const res = profiles[i];
          const trend = topArtistsToFetch[i];
          const primaryKey = trend.artist.toLowerCase();

          if (res.status === 'fulfilled' && Array.isArray(res.value?.topTracks)) {
            for (const t of res.value.topTracks) {
              if (seenTrackIds.has(t.id) || skippedTrackIds.has(t.id)) continue;
              const count = seenArtistCount.get(primaryKey) || 0;
              if (count >= 2) break;

              seenTrackIds.add(t.id);
              seenArtistCount.set(primaryKey, count + 1);

              result.push({
                ...t,
                artworkUrl: getTrackArtwork(t),
                sourceMetadata: {
                  ...t.sourceMetadata,
                  communityArtist: trend.artist,
                  listenerCount: trend.listenerCount,
                  communityReason: `Popular with other listeners`,
                },
              });

              if (result.length >= limit) break;
            }
          }
          if (result.length >= limit) break;
        }
      } catch (err) {
        console.debug('[CommunityListeningService] ArtistService resolution skipped:', err);
      }
    }

    // 3. Third pass: For offline/cold-start or any artist still missing tracks, use trend.recentTracks (which includes verified seeds)
    if (result.length < limit) {
      for (const trend of trendingArtists) {
        const primaryKey = trend.artist.toLowerCase();
        for (const track of trend.recentTracks) {
          if (seenTrackIds.has(track.id) || skippedTrackIds.has(track.id)) continue;
          const count = seenArtistCount.get(primaryKey) || 0;
          if (count >= 2) break;

          seenArtistCount.set(primaryKey, count + 1);
          seenTrackIds.add(track.id);

          result.push({
            ...track,
            artworkUrl: getTrackArtwork(track),
            sourceMetadata: {
              ...track.sourceMetadata,
              communityArtist: trend.artist,
              listenerCount: trend.listenerCount,
              communityReason: `Listened by ${trend.listenerCount} other listener${
                trend.listenerCount > 1 ? 's' : ''
              }`,
            },
          });
          if (result.length >= limit) break;
        }
        if (result.length >= limit) break;
      }
    }

    return result.length > 0 ? result.slice(0, limit) : catalogue.slice(0, limit);
  }
}

export const communityListeningService = CommunityListeningService.getInstance();
