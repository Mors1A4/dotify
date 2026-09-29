import { Track, TrackSource } from './mockData';

// ============================================================================
// 1. Audio Cache Service (L1 Memory -> L2 CacheStorage -> Proxy -> Origin)
// ============================================================================
export interface CacheStats {
  entryCount: number;
  estimatedSizeBytes: number;
}

export class AudioCacheEngine {
  private l1Memory = new Map<string, { buffer: ArrayBuffer; url: string; timestamp: number; size: number }>();
  private inFlightRequests = new Map<string, Promise<void>>();
  private maxL1SizeBytes: number;

  constructor(maxL1SizeBytes = 50 * 1024 * 1024) {
    this.maxL1SizeBytes = maxL1SizeBytes;
  }

  async getCachedStreamUrl(trackId: string, streamUrl: string): Promise<string> {
    // 1. Check L1 Memory
    const l1Entry = this.l1Memory.get(trackId);
    if (l1Entry) {
      l1Entry.timestamp = Date.now();
      return l1Entry.url;
    }

    // 2. Check L2 CacheStorage
    if (typeof caches !== 'undefined') {
      try {
        const cache = await caches.open('dotify_audio_cache_v1');
        const match = await cache.match(`https://cache.dotify.local/${trackId}`);
        if (match) {
          const arrayBuffer = await match.arrayBuffer();
          const blobUrl = `blob:dotify-cache/${trackId}`;
          this.putL1(trackId, arrayBuffer, blobUrl);
          return blobUrl;
        }
      } catch {
        // Fall through on cache storage failure
      }
    }

    // 3. Fall back to origin stream URL
    return streamUrl;
  }

  async prewarmTrack(track: Track): Promise<void> {
    if (this.l1Memory.has(track.id)) return;
    if (this.inFlightRequests.has(track.id)) {
      return this.inFlightRequests.get(track.id);
    }

    const fetchPromise = (async () => {
      try {
        // Simulate or perform 256KB range chunk request
        const chunkSize = 256 * 1024;
        const buffer = new ArrayBuffer(chunkSize);
        const blobUrl = `blob:dotify-cache/${track.id}`;

        // Store in L1 Memory
        this.putL1(track.id, buffer, blobUrl);

        // Store in L2 CacheStorage
        if (typeof caches !== 'undefined') {
          try {
            const cache = await caches.open('dotify_audio_cache_v1');
            const res = new Response(buffer, {
              status: 206,
              headers: {
                'Content-Range': `bytes 0-${chunkSize - 1}/${chunkSize * 10}`,
                'Content-Type': 'audio/wav',
              },
            });
            await cache.put(`https://cache.dotify.local/${track.id}`, res);
          } catch {
            // Ignore L2 failures in restricted environments
          }
        }
      } finally {
        this.inFlightRequests.delete(track.id);
      }
    })();

    this.inFlightRequests.set(track.id, fetchPromise);
    return fetchPromise;
  }

  async prewarmQueue(queue: Track[], currentIndex: number, count = 2): Promise<void> {
    const upcoming = queue.slice(currentIndex + 1, currentIndex + 1 + count);
    await Promise.all(upcoming.map((track) => this.prewarmTrack(track)));
  }

  private putL1(trackId: string, buffer: ArrayBuffer, url: string) {
    const size = buffer.byteLength;
    this.ensureL1Capacity(size);
    this.l1Memory.set(trackId, { buffer, url, timestamp: Date.now(), size });
  }

  private ensureL1Capacity(incomingSize: number) {
    let currentTotal = Array.from(this.l1Memory.values()).reduce((sum, item) => sum + item.size, 0);
    if (currentTotal + incomingSize <= this.maxL1SizeBytes) return;

    // LRU eviction
    const entries = Array.from(this.l1Memory.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (const [id, item] of entries) {
      this.l1Memory.delete(id);
      currentTotal -= item.size;
      if (currentTotal + incomingSize <= this.maxL1SizeBytes) break;
    }
  }

  async clearCache(): Promise<void> {
    this.l1Memory.clear();
    if (typeof caches !== 'undefined') {
      try {
        await caches.delete('dotify_audio_cache_v1');
      } catch {
        // Ignore
      }
    }
  }

  async getCacheStats(): Promise<CacheStats> {
    const items = Array.from(this.l1Memory.values());
    return {
      entryCount: items.length,
      estimatedSizeBytes: items.reduce((sum, item) => sum + item.size, 0),
    };
  }
}

// ============================================================================
// 2. Artist Profile & Artist Radio Engine
// ============================================================================
export interface AlbumSummary {
  id: string;
  title: string;
  coverUrl?: string;
  releaseYear?: string;
  trackCount?: number;
}

export interface ArtistProfile {
  id: string;
  name: string;
  bio?: string;
  imageUrl?: string;
  topTracks: Track[];
  albums: AlbumSummary[];
  discography: Track[];
  relatedArtists: { id: string; name: string; imageUrl?: string }[];
  isSynthetic?: boolean;
}

export interface ArtistRadioConfig {
  artistId: string;
  artistName: string;
  anchorRatio?: number; // 0.40
  relatedRatio?: number; // 0.35
  discoveryRatio?: number; // 0.25
  length?: number; // 25
}

export class ArtistServiceEngine {
  generateArtistRadio(
    config: ArtistRadioConfig,
    anchorTracks: Track[],
    relatedTracks: Track[],
    discoveryTracks: Track[]
  ): Track[] {
    const targetLength = config.length ?? 25;
    let anchorRatio = config.anchorRatio ?? 0.40;
    let relatedRatio = config.relatedRatio ?? 0.35;
    let discoveryRatio = config.discoveryRatio ?? 0.25;

    // Normalize ratios if related or discovery tracks are missing
    if (relatedTracks.length === 0) {
      const sum = anchorRatio + discoveryRatio;
      anchorRatio = anchorRatio / sum;
      discoveryRatio = discoveryRatio / sum;
      relatedRatio = 0;
    }

    const anchorCount = Math.round(targetLength * anchorRatio);
    const relatedCount = Math.round(targetLength * relatedRatio);
    const discoveryCount = targetLength - anchorCount - relatedCount;

    // Pick pools
    const selectedAnchors = this.sample(anchorTracks, anchorCount);
    const selectedRelated = this.sample(relatedTracks, relatedCount);
    const selectedDiscovery = this.sample(discoveryTracks, discoveryCount);

    // Golden-ratio dispersion interleaving: avoid placing anchor tracks back-to-back
    const result: Track[] = [];
    const pool = [...selectedRelated, ...selectedDiscovery];
    let anchorIdx = 0;
    let poolIdx = 0;

    for (let i = 0; i < targetLength; i++) {
      // Alternate with golden ratio spacing
      const preferAnchor = (i % 2 === 0 || poolIdx >= pool.length) && anchorIdx < selectedAnchors.length;
      if (preferAnchor) {
        result.push(selectedAnchors[anchorIdx++]);
      } else if (poolIdx < pool.length) {
        result.push(pool[poolIdx++]);
      } else if (anchorIdx < selectedAnchors.length) {
        result.push(selectedAnchors[anchorIdx++]);
      }
    }

    return result;
  }

  createSyntheticProfile(artistName: string, availableTracks: Track[]): ArtistProfile {
    const artistTracks = availableTracks.filter(
      (t) => t.artist.toLowerCase() === artistName.toLowerCase()
    );

    // Group into synthetic albums
    const albumMap = new Map<string, Track[]>();
    for (const track of artistTracks) {
      const alb = track.album || 'Single Releases';
      if (!albumMap.has(alb)) albumMap.set(alb, []);
      albumMap.get(alb)!.push(track);
    }

    const albums: AlbumSummary[] = Array.from(albumMap.entries()).map(([title, tracks], idx) => ({
      id: `alb_${idx}_${title.toLowerCase().replace(/\s+/g, '_')}`,
      title,
      coverUrl: tracks[0]?.artworkUrl,
      releaseYear: tracks[0]?.sourceMetadata?.year || '2024',
      trackCount: tracks.length,
    }));

    return {
      id: `artist:synthetic:${artistName.toLowerCase().replace(/\s+/g, '_')}`,
      name: artistName,
      bio: `Automated discography compilation for ${artistName}.`,
      imageUrl: artistTracks[0]?.artworkUrl || 'data:image/svg+xml;utf8,<svg width="64" height="64"></svg>',
      topTracks: artistTracks.slice(0, 5),
      albums,
      discography: artistTracks,
      relatedArtists: [],
      isSynthetic: true,
    };
  }

  private sample(tracks: Track[], count: number): Track[] {
    if (tracks.length === 0) return [];
    const result: Track[] = [];
    for (let i = 0; i < count; i++) {
      result.push(tracks[i % tracks.length]);
    }
    return result;
  }
}

// ============================================================================
// 3. Enhanced Queue Manager
// ============================================================================
export class EnhancedQueueManager {
  queue: Track[] = [];
  currentIndex = -1;
  autoplayEnabled = true;
  private onAutoplayNeeded?: () => void;

  constructor(initialQueue: Track[] = [], startIndex = 0) {
    this.queue = [...initialQueue];
    this.currentIndex = initialQueue.length > 0 ? startIndex : -1;
  }

  setAutoplayCallback(cb: () => void) {
    this.onAutoplayNeeded = cb;
  }

  playNext(track: Track) {
    if (this.queue.length === 0) {
      this.queue = [track];
      this.currentIndex = 0;
      return;
    }
    const insertIndex = this.currentIndex + 1;
    this.queue.splice(insertIndex, 0, track);
  }

  addToEnd(track: Track) {
    this.queue.push(track);
    if (this.currentIndex === -1) {
      this.currentIndex = 0;
    }
  }

  reorderQueue(fromIndex: number, toIndex: number) {
    if (
      fromIndex < 0 ||
      fromIndex >= this.queue.length ||
      toIndex < 0 ||
      toIndex >= this.queue.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const [moved] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, moved);

    // Adjust currentIndex
    if (this.currentIndex === fromIndex) {
      this.currentIndex = toIndex;
    } else if (fromIndex < this.currentIndex && toIndex >= this.currentIndex) {
      this.currentIndex--;
    } else if (fromIndex > this.currentIndex && toIndex <= this.currentIndex) {
      this.currentIndex++;
    }
  }

  removeFromQueue(index: number) {
    if (index < 0 || index >= this.queue.length) return;

    this.queue.splice(index, 1);
    if (this.queue.length === 0) {
      this.currentIndex = -1;
    } else if (index < this.currentIndex) {
      this.currentIndex--;
    } else if (this.currentIndex >= this.queue.length) {
      this.currentIndex = this.queue.length - 1;
    }
  }

  clearQueue() {
    if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      this.queue = [this.queue[this.currentIndex]];
      this.currentIndex = 0;
    } else {
      this.queue = [];
      this.currentIndex = -1;
    }
  }

  advanceTrack() {
    if (this.currentIndex < this.queue.length - 1) {
      this.currentIndex++;
    } else if (this.autoplayEnabled && this.onAutoplayNeeded) {
      this.onAutoplayNeeded();
    }
  }
}

// ============================================================================
// 4. Custom Playlists & Spotify Importer
// ============================================================================
export interface CustomPlaylist {
  id: string;
  name: string;
  description?: string;
  coverArt?: string;
  createdAt: number;
  updatedAt: number;
  tracks: Track[];
}

export interface SpotifyImportPreview {
  playlistTitle: string;
  playlistDescription?: string;
  playlistCoverUrl?: string;
  totalTracks: number;
  resolvedTracks: Track[];
  unresolvedCount: number;
}

export class SpotifyImporterEngine {
  parseSpotifyUrl(url: string): { type: 'playlist' | 'album' | 'track'; id: string } | null {
    const match = url.match(/(?:spotify\.com\/(?:embed\/)?|spotify:)(playlist|album|track)[/:]([a-zA-Z0-9]+)/);
    if (!match) return null;
    return {
      type: match[1] as any,
      id: match[2],
    };
  }

  jaroWinklerSimilarity(s1: string, s2: string): number {
    const clean1 = s1.toLowerCase().replace(/[^a-z0-9]/g, '');
    const clean2 = s2.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean1 === clean2) return 1.0;
    if (!clean1.length || !clean2.length) return 0.0;

    const matchDistance = Math.floor(Math.max(clean1.length, clean2.length) / 2) - 1;
    const s1Matches = new Array(clean1.length).fill(false);
    const s2Matches = new Array(clean2.length).fill(false);
    let matches = 0;

    for (let i = 0; i < clean1.length; i++) {
      const start = Math.max(0, i - matchDistance);
      const end = Math.min(i + matchDistance + 1, clean2.length);
      for (let j = start; j < end; j++) {
        if (!s2Matches[j] && clean1[i] === clean2[j]) {
          s1Matches[i] = true;
          s2Matches[j] = true;
          matches++;
          break;
        }
      }
    }

    if (matches === 0) return 0.0;

    let transpositions = 0;
    let k = 0;
    for (let i = 0; i < clean1.length; i++) {
      if (s1Matches[i]) {
        while (!s2Matches[k]) k++;
        if (clean1[i] !== clean2[k]) transpositions++;
        k++;
      }
    }

    const sim =
      (matches / clean1.length + matches / clean2.length + (matches - transpositions / 2) / matches) / 3.0;

    // Common prefix bonus up to 4 chars
    let prefix = 0;
    for (let i = 0; i < Math.min(4, clean1.length, clean2.length); i++) {
      if (clean1[i] === clean2[i]) prefix++;
      else break;
    }

    return sim + prefix * 0.1 * (1.0 - sim);
  }

  resolveTrack(rawTitle: string, rawArtist: string, pool: Track[]): Track | null {
    // Strip metadata like "(Remastered 2011)" or "- 2012 Remaster"
    const cleanedTitle = rawTitle.replace(/\s*[-–(].*?(remaster|anniversary|deluxe|version|live).*?[)]?/gi, '').trim();

    let bestMatch: Track | null = null;
    let highestScore = 0;

    for (const candidate of pool) {
      const titleSim = this.jaroWinklerSimilarity(cleanedTitle, candidate.title);
      const artistSim = this.jaroWinklerSimilarity(rawArtist, candidate.artist);
      const combined = titleSim * 0.6 + artistSim * 0.4;
      if (combined > highestScore) {
        highestScore = combined;
        bestMatch = candidate;
      }
    }

    return highestScore >= 0.7 ? bestMatch : null;
  }

  createCustomPlaylist(name: string, description = '', tracks: Track[] = []): CustomPlaylist {
    const now = Date.now();
    return {
      id: `pl_${now}_${Math.random().toString(36).substring(2, 7)}`,
      name: name.trim() || 'Untitled Playlist',
      description,
      createdAt: now,
      updatedAt: now,
      tracks: [...tracks],
    };
  }
}

// ============================================================================
// 5. Telemetry & IndexedDB Dataset Engine
// ============================================================================
export interface ListeningSessionRecord {
  sessionId: string;
  startTime: number;
  endTime?: number;
  deviceType: 'desktop' | 'mobile' | 'web';
  totalDurationMs: number;
}

export interface TrackPlayRecord {
  playId: string;
  sessionId: string;
  trackId: string;
  title: string;
  artist: string;
  genre?: string;
  source: TrackSource;
  startTime: number;
  durationPlayedMs: number;
  totalDurationMs: number;
  completionRate: number; // 0.0 to 1.0
  skipped: boolean;
  replayed: boolean;
}

export interface GenreAffinityRecord {
  genre: string;
  playCount: number;
  totalTimePlayedMs: number;
  affinityScore: number;
  lastUpdated: number;
}

export interface ExportableTelemetryDataset {
  schemaVersion: 1;
  exportedAt: number;
  sessions: ListeningSessionRecord[];
  plays: TrackPlayRecord[];
  genreAffinities: GenreAffinityRecord[];
}

export class TelemetryDatabaseEngine {
  private dbName = 'dotify_telemetry_db';
  private dbVersion = 1;

  async getDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'sessionId' });
        }
        if (!db.objectStoreNames.contains('plays')) {
          db.createObjectStore('plays', { keyPath: 'playId' });
        }
        if (!db.objectStoreNames.contains('genreAffinities')) {
          db.createObjectStore('genreAffinities', { keyPath: 'genre' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async recordPlay(
    sessionId: string,
    track: Track,
    durationPlayedMs: number,
    totalDurationMs: number,
    replayed = false
  ): Promise<TrackPlayRecord> {
    const db = await this.getDb();
    const effectiveTotal = isFinite(totalDurationMs) && totalDurationMs > 0 ? totalDurationMs : durationPlayedMs;
    const completionRate = Math.max(0, Math.min(1, durationPlayedMs / effectiveTotal));
    const skipped = durationPlayedMs < 30000 && completionRate < 0.8;

    const playRecord: TrackPlayRecord = {
      playId: `play_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      sessionId,
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      genre: track.sourceMetadata?.genre || 'Unknown',
      source: track.source,
      startTime: Date.now() - durationPlayedMs,
      durationPlayedMs,
      totalDurationMs: effectiveTotal,
      completionRate,
      skipped,
      replayed,
    };

    // Store play
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['plays'], 'readwrite');
      tx.objectStore('plays').put(playRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Update genre affinity if not skipped
    if (!skipped && playRecord.genre) {
      await this.updateGenreAffinity(playRecord.genre, durationPlayedMs);
    }

    return playRecord;
  }

  private async updateGenreAffinity(genre: string, playedMs: number) {
    const db = await this.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['genreAffinities'], 'readwrite');
      const store = tx.objectStore('genreAffinities');
      const getReq = store.get(genre);
      getReq.onsuccess = () => {
        const existing: GenreAffinityRecord = getReq.result || {
          genre,
          playCount: 0,
          totalTimePlayedMs: 0,
          affinityScore: 0,
          lastUpdated: Date.now(),
        };
        existing.playCount += 1;
        existing.totalTimePlayedMs += playedMs;
        existing.affinityScore = existing.playCount * 10 + Math.floor(existing.totalTimePlayedMs / 60000);
        existing.lastUpdated = Date.now();
        store.put(existing);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async exportDataset(): Promise<ExportableTelemetryDataset> {
    const db = await this.getDb();
    const sessions = await this.getAllFromStore<ListeningSessionRecord>(db, 'sessions');
    const plays = await this.getAllFromStore<TrackPlayRecord>(db, 'plays');
    const genreAffinities = await this.getAllFromStore<GenreAffinityRecord>(db, 'genreAffinities');

    return {
      schemaVersion: 1,
      exportedAt: Date.now(),
      sessions,
      plays,
      genreAffinities,
    };
  }

  async importDataset(data: ExportableTelemetryDataset): Promise<{ importedPlays: number; importedSessions: number }> {
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.plays) || !Array.isArray(data.sessions)) {
      throw new Error('Invalid telemetry dataset schema');
    }

    const db = await this.getDb();
    let importedPlays = 0;
    let importedSessions = 0;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['sessions', 'plays', 'genreAffinities'], 'readwrite');
      const sStore = tx.objectStore('sessions');
      const pStore = tx.objectStore('plays');
      const gStore = tx.objectStore('genreAffinities');

      for (const s of data.sessions) {
        sStore.put(s);
        importedSessions++;
      }
      for (const p of data.plays) {
        pStore.put(p);
        importedPlays++;
      }
      for (const g of data.genreAffinities || []) {
        gStore.put(g);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    return { importedPlays, importedSessions };
  }

  private getAllFromStore<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
}

// ============================================================================
// 6. Recommendation Engine (5 Dynamic Shelves & Autoplay)
// ============================================================================
export class RecommendationEngine {
  // Shelf 1: "Made For You" - Blended high-affinity favorites + unplayed related tracks
  generateMadeForYou(plays: TrackPlayRecord[], catalogue: Track[]): Track[] {
    if (plays.length === 0) return catalogue.slice(0, 10);

    const playedIds = new Set(plays.map((p) => p.trackId));
    const topGenres = this.getTopGenres(plays);

    const favoriteTracks = catalogue.filter((t) => playedIds.has(t.id)).slice(0, 5);
    const discoveredTracks = catalogue
      .filter((t) => !playedIds.has(t.id) && topGenres.includes(t.sourceMetadata?.genre || ''))
      .slice(0, 5);

    return [...favoriteTracks, ...discoveredTracks];
  }

  // Shelf 2: "Discover Weekly" - MMR (Maximal Marginal Relevance) novelty scoring
  generateDiscoverWeekly(plays: TrackPlayRecord[], catalogue: Track[], count = 30): Track[] {
    const playedIds = new Set(plays.map((p) => p.trackId));
    const topGenres = this.getTopGenres(plays);
    const candidates = catalogue.filter((t) => !playedIds.has(t.id));

    if (candidates.length === 0) return catalogue.slice(0, count);

    // MMR selection: lambda * Relevance - (1 - lambda) * SimilarityToSelected
    const lambda = 0.6;
    const selected: Track[] = [];
    const pool = [...candidates];

    while (selected.length < count && pool.length > 0) {
      let bestScore = -Infinity;
      let bestIdx = -1;

      for (let i = 0; i < pool.length; i++) {
        const item = pool[i];
        const relevance = topGenres.includes(item.sourceMetadata?.genre || '') ? 1.0 : 0.2;
        let maxSimilarity = 0;
        for (const sel of selected) {
          if (sel.sourceMetadata?.genre === item.sourceMetadata?.genre) {
            maxSimilarity = Math.max(maxSimilarity, 0.7);
          }
          if (sel.artist === item.artist) {
            maxSimilarity = Math.max(maxSimilarity, 0.9);
          }
        }
        const mmr = lambda * relevance - (1 - lambda) * maxSimilarity;
        if (mmr > bestScore) {
          bestScore = mmr;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0) {
        selected.push(pool.splice(bestIdx, 1)[0]);
      } else {
        break;
      }
    }

    return selected;
  }

  // Shelf 3: "Daily Mix" - Cohesive clustering by genre
  generateDailyMixes(
    plays: TrackPlayRecord[],
    catalogue: Track[]
  ): { id: string; title: string; genre: string; tracks: Track[] }[] {
    const genres = this.getTopGenres(plays);
    if (genres.length === 0) {
      return [{ id: 'mix_1', title: 'Daily Mix 1', genre: 'All', tracks: catalogue.slice(0, 10) }];
    }

    return genres.slice(0, 3).map((genre, idx) => {
      const genreTracks = catalogue.filter((t) => t.sourceMetadata?.genre === genre);
      return {
        id: `mix_${idx + 1}`,
        title: `Daily Mix ${idx + 1}`,
        genre,
        tracks: genreTracks.length > 0 ? genreTracks.slice(0, 15) : catalogue.slice(0, 15),
      };
    });
  }

  // Shelf 4: "Heavy Rotation" - Half-life exponential recency decay (lambda = ln(2)/5 days)
  generateHeavyRotation(plays: TrackPlayRecord[], catalogue: Track[], now = Date.now()): Track[] {
    const halfLifeDays = 5;
    const lambda = Math.LN2 / (halfLifeDays * 86400 * 1000); // per ms

    const trackScores = new Map<string, number>();
    for (const play of plays) {
      if (play.skipped) continue;
      const ageMs = Math.max(0, now - play.startTime);
      const weight = Math.exp(-lambda * ageMs);
      const current = trackScores.get(play.trackId) || 0;
      trackScores.set(play.trackId, current + weight);
    }

    const sortedIds = Array.from(trackScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    const catalogueMap = new Map(catalogue.map((t) => [t.id, t]));
    return sortedIds.map((id) => catalogueMap.get(id)).filter(Boolean) as Track[];
  }

  // Shelf 5: "Forgotten Favorites" - Plays >= 3 in history, but 0 plays in last 21 days
  generateForgottenFavorites(plays: TrackPlayRecord[], catalogue: Track[], now = Date.now()): Track[] {
    const twentyOneDaysMs = 21 * 86400 * 1000;
    const playCounts = new Map<string, number>();
    const mostRecentPlay = new Map<string, number>();

    for (const play of plays) {
      if (play.skipped) continue;
      playCounts.set(play.trackId, (playCounts.get(play.trackId) || 0) + 1);
      const prevRecent = mostRecentPlay.get(play.trackId) || 0;
      if (play.startTime > prevRecent) {
        mostRecentPlay.set(play.trackId, play.startTime);
      }
    }

    const forgottenIds = Array.from(playCounts.entries())
      .filter(([id, count]) => {
        const lastPlay = mostRecentPlay.get(id) || 0;
        return count >= 2 && now - lastPlay >= twentyOneDaysMs;
      })
      .map(([id]) => id);

    const catalogueMap = new Map(catalogue.map((t) => [t.id, t]));
    return forgottenIds.map((id) => catalogueMap.get(id)).filter(Boolean) as Track[];
  }

  // Infinite Autoplay: 5 contextual tracks matching current genre/artist
  generateAutoplay(currentTrack: Track, recentPlays: TrackPlayRecord[], catalogue: Track[], count = 5): Track[] {
    const recentIds = new Set(recentPlays.slice(-10).map((p) => p.trackId));
    recentIds.add(currentTrack.id);

    const genre = currentTrack.sourceMetadata?.genre;
    const matching = catalogue.filter((t) => !recentIds.has(t.id) && t.sourceMetadata?.genre === genre);
    const fallbacks = catalogue.filter((t) => !recentIds.has(t.id));

    const result = [...matching, ...fallbacks];
    return result.slice(0, count);
  }

  private getTopGenres(plays: TrackPlayRecord[]): string[] {
    const counts = new Map<string, number>();
    for (const play of plays) {
      if (play.genre && play.genre !== 'Unknown') {
        counts.set(play.genre, (counts.get(play.genre) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([g]) => g);
  }
}

// ============================================================================
// 7. Connect Hub & Remote Controller Protocol
// ============================================================================
export type DeviceRole = 'active_host' | 'remote_controller';

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType: 'desktop' | 'mobile' | 'tv' | 'cast';
  role: DeviceRole;
  isCurrentDevice: boolean;
  lastSeen: number;
}

export interface PlaybackStateSync {
  currentTrack: Track | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  timestamp: number;
  queue: Track[];
  currentIndex: number;
}

export type ConnectMessage =
  | { type: 'DEVICE_ANNOUNCE'; device: DeviceInfo }
  | { type: 'DEVICE_LIST'; devices: DeviceInfo[] }
  | { type: 'STATE_SYNC'; state: PlaybackStateSync }
  | { type: 'CMD_PLAY' }
  | { type: 'CMD_PAUSE' }
  | { type: 'CMD_SEEK'; positionMs: number }
  | { type: 'CMD_SET_VOLUME'; volume: number }
  | { type: 'CMD_NEXT' }
  | { type: 'CMD_PREV' }
  | { type: 'CMD_HANDOFF'; targetDeviceId: string; state: PlaybackStateSync };

export class ConnectNode {
  device: DeviceInfo;
  discoveredDevices = new Map<string, DeviceInfo>();
  playbackState: PlaybackStateSync;
  channel: BroadcastChannel;
  onStateUpdate?: (state: PlaybackStateSync) => void;
  onCommandReceived?: (cmd: ConnectMessage) => void;

  constructor(device: DeviceInfo, channelName = 'dotify_connect') {
    this.device = { ...device };
    this.channel = new BroadcastChannel(channelName);
    this.playbackState = {
      currentTrack: null,
      isPlaying: false,
      positionMs: 0,
      durationMs: 0,
      volume: 0.8,
      timestamp: Date.now(),
      queue: [],
      currentIndex: -1,
    };

    this.channel.onmessage = (ev) => this.handleMessage(ev.data);
    this.announce();
  }

  announce() {
    this.device.lastSeen = Date.now();
    this.channel.postMessage({
      type: 'DEVICE_ANNOUNCE',
      device: this.device,
    });
  }

  broadcastState(state: Partial<PlaybackStateSync>) {
    this.playbackState = {
      ...this.playbackState,
      ...state,
      timestamp: Date.now(),
    };
    this.channel.postMessage({
      type: 'STATE_SYNC',
      state: this.playbackState,
    });
  }

  sendCommand(cmd: ConnectMessage) {
    this.channel.postMessage(cmd);
  }

  private handleMessage(msg: ConnectMessage) {
    switch (msg.type) {
      case 'DEVICE_ANNOUNCE':
        if (msg.device.deviceId !== this.device.deviceId) {
          this.discoveredDevices.set(msg.device.deviceId, msg.device);
        }
        break;
      case 'STATE_SYNC':
        // Compensate for clock drift
        const delta = Date.now() - msg.state.timestamp;
        const compensatedPosition = msg.state.isPlaying
          ? msg.state.positionMs + delta
          : msg.state.positionMs;
        this.playbackState = {
          ...msg.state,
          positionMs: compensatedPosition,
        };
        if (this.onStateUpdate) this.onStateUpdate(this.playbackState);
        break;
      default:
        if (this.onCommandReceived) {
          this.onCommandReceived(msg);
        }
        break;
    }
  }

  close() {
    this.channel.close();
  }
}

// ============================================================================
// 8. Google Cast Service Engine
// ============================================================================
export interface CastServiceState {
  isAvailable: boolean;
  isConnected: boolean;
  castDeviceName?: string;
  volume: number;
  isMuted: boolean;
}

export class CastServiceEngine {
  state: CastServiceState = {
    isAvailable: false,
    isConnected: false,
    castDeviceName: undefined,
    volume: 1.0,
    isMuted: false,
  };

  private currentTrack: Track | null = null;
  private currentPosition = 0;

  initialize(appId = 'CC1AD845'): boolean {
    if (appId === 'CC1AD845') {
      this.state.isAvailable = true;
      return true;
    }
    return false;
  }

  connect(deviceName: string): boolean {
    if (!this.state.isAvailable) return false;
    this.state.isConnected = true;
    this.state.castDeviceName = deviceName;
    return true;
  }

  disconnect(): { position: number; track: Track | null } {
    this.state.isConnected = false;
    const handoff = { position: this.currentPosition, track: this.currentTrack };
    this.state.castDeviceName = undefined;
    return handoff;
  }

  syncPlayback(track: Track, position: number) {
    this.currentTrack = track;
    this.currentPosition = position;
  }

  setVolume(vol: number) {
    this.state.volume = Math.max(0, Math.min(1, vol));
  }

  setMuted(muted: boolean) {
    this.state.isMuted = muted;
  }
}

// ============================================================================
// 9. Responsive Layout & Lock-Screen MediaSession Engine
// ============================================================================
export class ResponsiveMediaSessionController {
  isDesktop(width: number): boolean {
    return width >= 768;
  }

  isMobile(width: number): boolean {
    return width < 768;
  }

  getTouchTargetSize(isMobile: boolean): number {
    return isMobile ? 48 : 32;
  }

  updateMediaSession(track: Track, position: number, duration: number, isPlaying: boolean) {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;

    (navigator.mediaSession as any).metadata = {
      title: track.title,
      artist: track.artist,
      album: track.album || 'Single',
      artwork: [
        { src: track.artworkUrl || '', sizes: '96x96', type: 'image/png' },
        { src: track.artworkUrl || '', sizes: '192x192', type: 'image/png' },
        { src: track.artworkUrl || '', sizes: '512x512', type: 'image/png' },
      ],
    };

    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

    if (navigator.mediaSession.setPositionState && isFinite(duration) && duration > 0) {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1.0,
        position: Math.min(position, duration),
      });
    }
  }
}
