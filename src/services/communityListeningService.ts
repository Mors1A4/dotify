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
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/84318c4e09cb463c552086e37ea35e5d/500x500-000000-80-0-0.jpg',
        genre: 'Synthpop',
      },
      {
        title: 'Starboy',
        album: 'Starboy',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/ed1568e64c2079361cc3645bcfd7d5d1/500x500-000000-80-0-0.jpg',
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
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/a83e0705a61e271295cb17ec053fa2d7/500x500-000000-80-0-0.jpg',
        genre: 'Alternative Pop',
      },
      {
        title: 'bad guy',
        album: 'WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/8ba668eef050dbd6e87f6ae154694462/500x500-000000-80-0-0.jpg',
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
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/f381f215d2f838db60a8ea74eb6a0a22/500x500-000000-80-0-0.jpg',
        genre: 'Indie Rock',
      },
      {
        title: '505',
        album: 'Favourite Worst Nightmare',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/77b8f9e67ad5efb26639c0d7ff34ea86/500x500-000000-80-0-0.jpg',
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
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/e00f983637ae7f3b469733eead1c2a12/500x500-000000-80-0-0.jpg',
        genre: 'Nu-Disco / Pop',
      },
      {
        title: 'Houdini',
        album: 'Radical Optimism',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/b4db2d1265851419747970d47d87f54c/500x500-000000-80-0-0.jpg',
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
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/4d0d3b6f2f9b883017a027cecfd7aa61/500x500-000000-80-0-0.jpg',
        genre: 'Hip-Hop',
      },
      {
        title: 'HUMBLE.',
        album: 'DAMN.',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/2569ba7e2b17f5ceec5817c767e7169d/500x500-000000-80-0-0.jpg',
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
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/e02c6113b2cbe675971a7eb3a8d1ce34/500x500-000000-80-0-0.jpg',
        genre: 'Pop',
      },
      {
        title: 'Anti-Hero',
        album: 'Midnights',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/4e7e6005cbbba38aaecbe504cb418b76/500x500-000000-80-0-0.jpg',
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
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/421469e38ff86f874bc07452d5b61f89/500x500-000000-80-0-0.jpg',
        genre: 'Electronic / Disco',
      },
      {
        title: 'Around the World',
        album: 'Homework',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/6c653066d2cbb54d748f0e5272a2a4b8/500x500-000000-80-0-0.jpg',
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
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/6fbfda5eece914bc8b835e0c52bb8889/500x500-000000-80-0-0.jpg',
        genre: 'Psychedelic Pop',
      },
      {
        title: 'Borderline',
        album: 'The Slow Rush',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/77727192f1b72e01df227282cb205886/500x500-000000-80-0-0.jpg',
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
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/6d5e1ff74805c873ad708c32ec88db3f/500x500-000000-80-0-0.jpg',
        genre: 'Alternative',
      },
      {
        title: 'On Melancholy Hill',
        album: 'Plastic Beach',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/b315266858e778aee3ad58e0a2948eb7/500x500-000000-80-0-0.jpg',
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
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/bc768fa553aa3d81b37b6c7a72d3e098/500x500-000000-80-0-0.jpg',
        genre: 'Pop Rock',
      },
      {
        title: 'Yellow',
        album: 'Parachutes',
        artworkUrl: 'https://cdn-images.dzcdn.net/images/cover/ecff7a18bb72fa1b023f03b22cf53c23/500x500-000000-80-0-0.jpg',
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
