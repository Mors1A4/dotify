import { Track } from '../types/track';
import { extractPrimaryArtist, artistService } from './artistService';
import { getApiBaseUrl } from './apiConfig';
import { safeStorage } from '../utils/storage';
import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { TrackPlayRecord } from '../types/telemetry';

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
 * High-fidelity community baseline of artists and signature songs loved by Dotify listeners.
 * Used for instant cold-start, offline resilience, and enriching recommendation variety.
 */
const SEED_COMMUNITY_TRENDS: { artist: string; listenerCount: number; plays: number; tracks: { title: string; album: string; artworkUrl: string; genre: string }[] }[] = [
  {
    artist: 'The Weeknd',
    listenerCount: 8,
    plays: 24,
    tracks: [
      {
        title: 'Blinding Lights',
        album: 'After Hours',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/37/f5/e0/37f5e07c-53c6-6a8e-6d49-d80fef6fb1e6/00602508818233.rgb.jpg/600x600bb.jpg',
        genre: 'Synthpop',
      },
      {
        title: 'Starboy',
        album: 'Starboy',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music71/v4/d3/03/6a/d3036a42-a937-18a6-f3a4-3154e9b2ab36/00602547954312.rgb.jpg/600x600bb.jpg',
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
        title: 'BIRDS OF A FEATHER',
        album: 'HIT ME HARD AND SOFT',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/d5/38/1b/d5381be2-6e7d-7b93-4c5d-4aeb8ce33a4b/24UM1IM16988.rgb.jpg/600x600bb.jpg',
        genre: 'Alternative Pop',
      },
      {
        title: 'bad guy',
        album: 'WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/00/58/40/005840c1-3032-b3e5-1e49-9d60d1028b15/19UMGIM24705.rgb.jpg/600x600bb.jpg',
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
        title: 'Do I Wanna Know?',
        album: 'AM',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music113/v4/f5/62/37/f562374a-b5f3-3e4c-eb9a-e5cb34a4a5b5/13UMGIM17645.rgb.jpg/600x600bb.jpg',
        genre: 'Indie Rock',
      },
      {
        title: '505',
        album: 'Favourite Worst Nightmare',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/4e/ce/18/4ece18ff-8dc6-f5a0-4e27-6898a50ed7e3/dj.bjflymf.jpg/600x600bb.jpg',
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
        title: 'Levitating',
        album: 'Future Nostalgia',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/4c/b3/55/4cb35510-26c4-2b91-6c57-30da52a6ac74/20UM1IM01576.rgb.jpg/600x600bb.jpg',
        genre: 'Nu-Disco / Pop',
      },
      {
        title: 'Houdini',
        album: 'Radical Optimism',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/49/e7/c6/49e7c648-b62e-ce08-cbf0-01a03d6c6463/196589790643.rgb.jpg/600x600bb.jpg',
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
        title: 'Not Like Us',
        album: 'Not Like Us',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/e9/74/46/e974469a-4e56-54e0-c5cc-8dbf49c5b7b5/24PGEM09695.rgb.jpg/600x600bb.jpg',
        genre: 'Hip-Hop',
      },
      {
        title: 'HUMBLE.',
        album: 'DAMN.',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/c0/63/d5/c063d5f2-2b28-8c49-ddc2-47ec18f97a78/17UMGIM24760.rgb.jpg/600x600bb.jpg',
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
        title: 'Cruel Summer',
        album: 'Lover',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/b2/e3/28/b2e32809-9a2e-5e4d-7ff1-0f5c4bf76e1b/19UMGIM64263.rgb.jpg/600x600bb.jpg',
        genre: 'Pop',
      },
      {
        title: 'Anti-Hero',
        album: 'Midnights',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/b7/73/87/b77387af-5d5f-9f01-da98-13e5b4eb4b3d/22UMGIM83498.rgb.jpg/600x600bb.jpg',
        genre: 'Pop',
      },
    ],
  },
  {
    artist: 'Daft Punk',
    listenerCount: 5,
    plays: 14,
    tracks: [
      {
        title: 'Get Lucky',
        album: 'Random Access Memories',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music113/v4/e5/c5/ef/e5c5ef1d-0748-7e6a-3d30-02a35028e61e/13UMGIM20395.rgb.jpg/600x600bb.jpg',
        genre: 'Electronic / Disco',
      },
      {
        title: 'Around the World',
        album: 'Homework',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/c8/cd/1d/c8cd1df5-6e9e-f2ed-36fc-c7e6b2ba9a55/09UMGIM21023.rgb.jpg/600x600bb.jpg',
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
        title: 'The Less I Know the Better',
        album: 'Currents',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/62/49/6e/62496ee8-2a35-bb04-a8d7-b77d85fef810/887828045976.rgb.jpg/600x600bb.jpg',
        genre: 'Psychedelic Pop',
      },
      {
        title: 'Borderline',
        album: 'The Slow Rush',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music113/v4/2f/07/e1/2f07e1ae-b20a-e4e1-0e76-01e6d2b8edce/00602507259518.rgb.jpg/600x600bb.jpg',
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
        title: 'Feel Good Inc.',
        album: 'Demon Days',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/c2/8e/2d/c28e2db8-4e3f-a5e1-f0d0-8a9b4e69f65f/00724386785050.rgb.jpg/600x600bb.jpg',
        genre: 'Alternative',
      },
      {
        title: 'On Melancholy Hill',
        album: 'Plastic Beach',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/f2/b9/70/f2b970e1-e413-c36c-6c42-8fcf4e0028b2/00602527340517.rgb.jpg/600x600bb.jpg',
        genre: 'Synthpop',
      },
    ],
  },
  {
    artist: 'Coldplay',
    listenerCount: 6,
    plays: 18,
    tracks: [
      {
        title: 'Viva La Vida',
        album: 'Viva La Vida or Death and All His Friends',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/4f/73/3a/4f733aab-4b5b-d5d8-0399-16e89f0a2f7c/886973382226.jpg/600x600bb.jpg',
        genre: 'Pop Rock',
      },
      {
        title: 'Yellow',
        album: 'Parachutes',
        artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/62/d2/d1/62d2d1de-9b2e-ae9b-b4ad-a9e04bcea9a3/00724352474920.jpg/600x600bb.jpg',
        genre: 'Alternative Rock',
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

    const playEvent: CommunityPlayEvent = {
      trackId: track.id,
      title: track.title,
      artist: cleanArtist,
      album: track.album || '',
      artworkUrl: track.artworkUrl || '',
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
        record.tracks.set(p.trackId, {
          id: p.trackId,
          source: 'charts',
          title: p.title,
          artist: primary,
          album: p.album || '',
          duration: 180,
          streamUrl: '',
          artworkUrl: p.artworkUrl || '',
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

    const playedTrackIds = new Set(userPlays.map((p) => p.trackId));
    const result: Track[] = [];
    const seenTrackIds = new Set<string>();
    const seenArtistCount = new Map<string, number>();

    // 1. First pass: Gather actual tracks that other users have been listening to from each artist
    for (const trend of trendingArtists) {
      const primaryKey = trend.artist.toLowerCase();
      for (const track of trend.recentTracks) {
        if (seenTrackIds.has(track.id)) continue;
        const count = seenArtistCount.get(primaryKey) || 0;
        if (count >= 2) break; // Anti-clumping: max 2 songs per artist

        seenArtistCount.set(primaryKey, count + 1);
        seenTrackIds.add(track.id);

        const enrichedTrack: Track = {
          ...track,
          sourceMetadata: {
            ...track.sourceMetadata,
            communityArtist: trend.artist,
            listenerCount: trend.listenerCount,
            communityReason: `Listened by ${trend.listenerCount} other listener${
              trend.listenerCount > 1 ? 's' : ''
            }`,
          },
        };
        result.push(enrichedTrack);
      }
    }

    // 2. Second pass: Pull matching tracks from the current catalogue (charts & feeds) for these community artists
    if (result.length < limit && catalogue.length > 0) {
      for (const trend of trendingArtists) {
        const primaryKey = trend.artist.toLowerCase();
        const currentCount = seenArtistCount.get(primaryKey) || 0;
        if (currentCount >= 2) continue;

        for (const catTrack of catalogue) {
          const catArtist = extractPrimaryArtist(catTrack.artist || '').toLowerCase();
          if (catArtist === primaryKey && !seenTrackIds.has(catTrack.id)) {
            seenTrackIds.add(catTrack.id);
            seenArtistCount.set(primaryKey, (seenArtistCount.get(primaryKey) || 0) + 1);

            const enriched: Track = {
              ...catTrack,
              sourceMetadata: {
                ...catTrack.sourceMetadata,
                communityArtist: trend.artist,
                listenerCount: trend.listenerCount,
                communityReason: `Trending with Dotify listeners`,
              },
            };
            result.push(enriched);
            if (result.length >= limit) break;
          }
        }
        if (result.length >= limit) break;
      }
    }

    // 3. Third pass: If still under target, fetch top tracks for top 4 community artists via artistService
    if (result.length < limit) {
      try {
        const topArtistsToFetch = trendingArtists.slice(0, 4);
        const profiles = await Promise.allSettled(
          topArtistsToFetch.map((a) => artistService.getArtistProfile(a.artist))
        );

        for (let i = 0; i < profiles.length; i++) {
          const res = profiles[i];
          const trend = topArtistsToFetch[i];
          const primaryKey = trend.artist.toLowerCase();

          if (res.status === 'fulfilled' && Array.isArray(res.value?.topTracks)) {
            for (const t of res.value.topTracks) {
              if (seenTrackIds.has(t.id)) continue;
              const count = seenArtistCount.get(primaryKey) || 0;
              if (count >= 2) break;

              seenTrackIds.add(t.id);
              seenArtistCount.set(primaryKey, count + 1);

              result.push({
                ...t,
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
        console.debug('[CommunityListeningService] ArtistService enrichment fallback skipped:', err);
      }
    }

    return result.length > 0 ? result.slice(0, limit) : catalogue.slice(0, limit);
  }
}

export const communityListeningService = CommunityListeningService.getInstance();
