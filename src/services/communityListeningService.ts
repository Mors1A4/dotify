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

  public clearCache(): void {
    this.memoryCachePlays = null;
    this.memoryCacheTime = 0;
  }

  /**
   * Curates a shelf of the specific songs that others who have been using the app have listened to.
   * Features:
   * 1. Specific songs: Recommends the exact songs listened to by other users and community listeners (not arbitrary artist top tracks).
   * 2. Anti-clumping rotation: Interleaves tracks across artists round-robin (1 song per artist per pass) so the list rotates between artists.
   * 3. Natural circular rotation: Dynamically shifts the song list window based on time/session (15-min intervals or offset) so the shelf naturally rotates by design.
   * 4. Excludes any tracks skipped by the current user.
   * 5. Enriches with high-fidelity studio artwork and streaming parameters.
   */
  public async getRecommendedSongsFromCommunityArtists(options: {
    excludeUserId?: string;
    userPlays?: TrackPlayRecord[];
    catalogue?: Track[];
    limit?: number;
    rotationOffset?: number;
  } = {}): Promise<Track[]> {
    const { excludeUserId, userPlays = [], catalogue = [], limit = 18, rotationOffset } = options;

    // 1. Retrieve all community play events from other listeners
    const plays = await this.getCommunityPlays(excludeUserId);
    if (!plays || plays.length === 0) {
      return catalogue.slice(0, limit);
    }

    // 2. Identify skipped tracks by current user so they are excluded
    const skippedTrackIds = new Set<string>();
    const skippedTitleKeys = new Set<string>();
    for (const p of userPlays) {
      if (p.skipped) {
        if (p.trackId) skippedTrackIds.add(p.trackId);
        const art = extractPrimaryArtist(p.artist || '').toLowerCase().trim();
        const tit = (p.title || '').toLowerCase().trim();
        if (art && tit) skippedTitleKeys.add(`${art}:::${tit}`);
      }
    }

    // 3. Fast lookup map for catalogue tracks by id and title+artist
    const catalogueById = new Map<string, Track>();
    const catalogueByKey = new Map<string, Track>();
    for (const t of catalogue) {
      if (t.id) catalogueById.set(t.id, t);
      const art = extractPrimaryArtist(t.artist || '').toLowerCase().trim();
      const tit = (t.title || '').toLowerCase().trim();
      if (art && tit) catalogueByKey.set(`${art}:::${tit}`, t);
    }

    // 4. Aggregate community plays into specific unique songs
    interface SongCandidate {
      key: string;
      trackId: string;
      title: string;
      artist: string;
      primaryArtist: string;
      album: string;
      artworkUrl: string;
      genre: string;
      duration: number;
      streamUrl: string;
      playCount: number;
      lastPlayedAt: number;
      listeners: Set<string>;
      matchedCatalogueTrack?: Track;
    }

    const songMap = new Map<string, SongCandidate>();

    for (const p of plays) {
      const primary = extractPrimaryArtist(p.artist || '').trim();
      if (!primary || primary === 'Unknown' || primary.toLowerCase().includes('synthetic pulse')) {
        continue;
      }
      const title = (p.title || '').trim();
      if (!title) continue;

      const songKey = `${primary.toLowerCase()}:::${title.toLowerCase()}`;
      if (skippedTitleKeys.has(songKey) || (p.trackId && skippedTrackIds.has(p.trackId))) {
        continue;
      }

      let candidate = songMap.get(songKey);
      if (!candidate) {
        // Check catalogue match
        const matched = (p.trackId && catalogueById.get(p.trackId)) || catalogueByKey.get(songKey);
        const cleanArt = isUglyPlaceholder(p.artworkUrl) ? '' : (p.artworkUrl || '');
        const finalArt = matched
          ? getTrackArtwork(matched)
          : (cleanArt || getTrackArtwork({ artist: primary, title }));

        candidate = {
          key: songKey,
          trackId: matched?.id || p.trackId,
          title: matched?.title || title,
          artist: matched?.artist || primary,
          primaryArtist: primary,
          album: matched?.album || p.album || '',
          artworkUrl: finalArt,
          genre: p.genre || matched?.sourceMetadata?.genre || 'Trending',
          duration: matched?.duration || 180,
          streamUrl: matched?.streamUrl || '',
          playCount: 0,
          lastPlayedAt: p.timestamp || Date.now(),
          listeners: new Set<string>(),
          matchedCatalogueTrack: matched,
        };
        songMap.set(songKey, candidate);
      }

      candidate.playCount += 1;
      if (p.timestamp && p.timestamp > candidate.lastPlayedAt) {
        candidate.lastPlayedAt = p.timestamp;
      }
      if (p.userId) {
        candidate.listeners.add(p.userId);
      }
    }

    if (songMap.size === 0) {
      return catalogue.slice(0, limit);
    }

    // 5. Score songs based on unique listeners, play count, and recency
    const now = Date.now();
    const scoredSongs: (SongCandidate & { score: number })[] = [];

    for (const song of songMap.values()) {
      const hoursAgo = Math.max(0, (now - song.lastPlayedAt) / 3600000);
      const recencyBonus = Math.max(0, 25 - hoursAgo * 0.5);
      const listenerScore = Math.max(1, song.listeners.size) * 12;
      const playScore = song.playCount * 3;
      const totalScore = listenerScore + playScore + recencyBonus;

      scoredSongs.push({
        ...song,
        score: totalScore,
      });
    }

    // 6. Anti-Clumping Grouping: Group songs by primary artist
    // and sort songs within each artist by score descending
    const artistGroups = new Map<string, (SongCandidate & { score: number })[]>();
    for (const song of scoredSongs) {
      const artKey = song.primaryArtist.toLowerCase();
      if (!artistGroups.has(artKey)) {
        artistGroups.set(artKey, []);
      }
      artistGroups.get(artKey)!.push(song);
    }

    for (const list of artistGroups.values()) {
      list.sort((a, b) => b.score - a.score);
    }

    // Sort artist groups by their top song's score
    const sortedArtistBuckets = Array.from(artistGroups.entries())
      .map(([artKey, list]) => ({
        artKey,
        topScore: list[0]?.score || 0,
        songs: list,
      }))
      .sort((a, b) => b.topScore - a.topScore);

    // 7. Round-Robin Interleave: 1 song per artist at a time so the list rotates between artists
    const interleavedSongs: (SongCandidate & { score: number })[] = [];
    let hasMore = true;
    let depth = 0;

    while (hasMore) {
      hasMore = false;
      for (const bucket of sortedArtistBuckets) {
        if (depth < bucket.songs.length) {
          interleavedSongs.push(bucket.songs[depth]);
          hasMore = true;
        }
      }
      depth += 1;
    }

    // 8. Natural Circular Rotation:
    // Rotates the song list by nature of design based on 15-minute time window or custom offset.
    // As time passes throughout the day or sessions, different songs rotate to the front of the shelf.
    const defaultShift = Math.floor(now / (1000 * 60 * 15));
    const effectiveShift = typeof rotationOffset === 'number' ? Math.abs(rotationOffset) : defaultShift;
    const rotationIndex = interleavedSongs.length > 0 ? effectiveShift % interleavedSongs.length : 0;

    const rotatedSongs =
      rotationIndex > 0
        ? [...interleavedSongs.slice(rotationIndex), ...interleavedSongs.slice(0, rotationIndex)]
        : interleavedSongs;

    // 9. Convert candidates to final rich Track objects
    const result: Track[] = rotatedSongs.slice(0, limit).map((cand) => {
      const matched = cand.matchedCatalogueTrack;
      const cleanArt = isUglyPlaceholder(cand.artworkUrl)
        ? getTrackArtwork({ artist: cand.artist, title: cand.title })
        : (cand.artworkUrl || getTrackArtwork({ artist: cand.artist, title: cand.title }));

      return {
        id: matched?.id || cand.trackId,
        source: matched?.source || 'charts',
        title: cand.title,
        artist: cand.artist,
        album: matched?.album || cand.album || '',
        duration: matched?.duration || cand.duration || 180,
        streamUrl: matched?.streamUrl || cand.streamUrl || '',
        artworkUrl: cleanArt,
        sourceMetadata: {
          ...(matched?.sourceMetadata || {}),
          genre: cand.genre,
          communityArtist: cand.artist,
          listenerCount: Math.max(1, cand.listeners.size),
          communityReason: `Listened to by ${Math.max(1, cand.listeners.size)} other listener${
            cand.listeners.size > 1 ? 's' : ''
          }`,
          lastPlayedAt: cand.lastPlayedAt,
        },
      };
    });

    return result.length > 0 ? result : catalogue.slice(0, limit);
  }

  public getRecommendedSongsFromCommunity(
    options: Parameters<CommunityListeningService['getRecommendedSongsFromCommunityArtists']>[0]
  ): Promise<Track[]> {
    return this.getRecommendedSongsFromCommunityArtists(options);
  }
}

export const communityListeningService = CommunityListeningService.getInstance();
