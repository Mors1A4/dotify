import { safeStorage } from '../utils/storage';
import { DailyVibePlaylist, DailyVibesCache, VibeCategory, VibePlaylistTrack } from '../types/vibes';
import { TrackPlayRecord } from '../types/telemetry';
import { genreProfiler } from './genreProfiler';
import { geminiVibeService, RawVibePlaylist } from './geminiVibeService';
import { telemetryDb } from './telemetryDb';
import { usePlayerStore } from '../store/playerStore';
import { getApiUrl, isAndroidApp } from './apiConfig';
import { getTrackArtwork, resolveTrackArtwork, isUglyPlaceholder } from './artworkService';

const VIBE_META: Record<
  VibeCategory,
  {
    label: string;
    icon: string;
    themeGradient: string;
    accentColor: string;
    defaultCover: string;
  }
> = {
  gaming: {
    label: 'Gaming',
    icon: '🎮',
    themeGradient: 'from-purple-900/80 via-slate-900 to-indigo-950 border-purple-700/50',
    accentColor: '#a855f7',
    defaultCover: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&auto=format&fit=crop&q=80',
  },
  working: {
    label: 'Working',
    icon: '💼',
    themeGradient: 'from-emerald-950/80 via-slate-900 to-teal-950 border-emerald-700/50',
    accentColor: '#10b981',
    defaultCover: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&auto=format&fit=crop&q=80',
  },
  partying: {
    label: 'Partying',
    icon: '🎉',
    themeGradient: 'from-rose-950/80 via-slate-900 to-pink-950 border-rose-700/50',
    accentColor: '#f43f5e',
    defaultCover: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&auto=format&fit=crop&q=80',
  },
  chilling: {
    label: 'Chilling',
    icon: '☕',
    themeGradient: 'from-blue-950/80 via-slate-900 to-cyan-950 border-blue-700/50',
    accentColor: '#0ea5e9',
    defaultCover: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=800&auto=format&fit=crop&q=80',
  },
  workout: {
    label: 'Workout',
    icon: '⚡',
    themeGradient: 'from-amber-950/80 via-slate-900 to-orange-950 border-amber-700/50',
    accentColor: '#f59e0b',
    defaultCover: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&auto=format&fit=crop&q=80',
  },
};

export class DailyVibeManager {
  private static instance: DailyVibeManager;
  private inMemoryCache = new Map<string, DailyVibePlaylist[]>();
  private activeGenerationPromise: Promise<DailyVibePlaylist[]> | null = null;

  public static getInstance(): DailyVibeManager {
    if (!DailyVibeManager.instance) {
      DailyVibeManager.instance = new DailyVibeManager();
    }
    return DailyVibeManager.instance;
  }

  public getTodayDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getStorageKey(accountId: string, dateString: string): string {
    const cleanId = (accountId || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `dotify_daily_vibes_${cleanId}_${dateString}`;
  }

  /**
   * Retrieves today's vibe playlists for the given account.
   * If already generated for today, loads immediately from cache.
   * If not generated yet today, calls Gemini with search tool, saves them, and returns.
   */
  public async getDailyVibes(
    accountId: string = 'guest',
    forceRegenerate: boolean = false
  ): Promise<DailyVibePlaylist[]> {
    const today = this.getTodayDateString();
    const storageKey = this.getStorageKey(accountId, today);

    // 1. Check memory cache
    const mem = this.inMemoryCache.get(storageKey);
    if (!forceRegenerate && mem && mem.length > 0) {
      return mem;
    }

    const lockKey = `${storageKey}_lock`;
    const lockExpiryMs = 90000;

    // 2. Check persistent safeStorage
    if (!forceRegenerate) {
      const cached = safeStorage.getItem<DailyVibesCache | null>(storageKey, null);
      if (cached && Array.isArray(cached.playlists) && cached.playlists.length >= 4) {
        this.inMemoryCache.set(storageKey, cached.playlists);
        return cached.playlists;
      }

      // Check cross-instance persistent lock (e.g., user opening multiple windows simultaneously)
      const activeLock = safeStorage.getItem<number | null>(lockKey, null);
      if (activeLock && Date.now() - activeLock < lockExpiryMs) {
        console.log(`[DailyVibeManager] Another instance is currently curating daily vibes. Awaiting cache...`);
        for (let i = 0; i < 30; i++) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const freshlyCached = safeStorage.getItem<DailyVibesCache | null>(storageKey, null);
          if (freshlyCached && Array.isArray(freshlyCached.playlists) && freshlyCached.playlists.length >= 4) {
            this.inMemoryCache.set(storageKey, freshlyCached.playlists);
            return freshlyCached.playlists;
          }
        }
      }
    }

    // 3. Prevent duplicate concurrent generations in the current process
    if (this.activeGenerationPromise) {
      return this.activeGenerationPromise;
    }

    this.activeGenerationPromise = this.generateAndSaveDailyVibes(accountId, today, storageKey);
    try {
      const result = await this.activeGenerationPromise;
      return result;
    } finally {
      this.activeGenerationPromise = null;
    }
  }

  private async generateAndSaveDailyVibes(
    accountId: string,
    today: string,
    storageKey: string
  ): Promise<DailyVibePlaylist[]> {
    const lockKey = `${storageKey}_lock`;
    safeStorage.setItem(lockKey, Date.now());

    try {
      console.log(`[DailyVibeManager] Generating daily vibe playlists for account "${accountId}" on ${today}...`);

      // A. Gather listening history & library
      let plays: TrackPlayRecord[] = [];
      try {
        plays = await telemetryDb.getAllPlays();
      } catch (e) {
        console.warn('[DailyVibeManager] Failed to read telemetry DB, continuing with empty plays:', e);
      }

      const { likedTracks, followedArtists } = usePlayerStore.getState();

      // B. Profile user genres
      const tasteProfile = genreProfiler.profileUserGenres(plays, likedTracks, followedArtists);

      // C. Call Gemini 3.8 Flash with Search Grounding
      const geminiResult = await geminiVibeService.generateDailyVibePlaylists(tasteProfile, today);

      // D. Hydrate raw tracks into full Dotify playable tracks
      const hydratedPlaylists = this.hydratePlaylists(
        geminiResult.playlists,
        today,
        geminiResult.modelUsed
      );

      // E. Save to safeStorage
      const cacheRecord: DailyVibesCache = {
        date: today,
        accountId,
        generatedAt: Date.now(),
        playlists: hydratedPlaylists,
        tasteProfileSummary: tasteProfile.summaryText,
      };

      safeStorage.setItem(storageKey, cacheRecord);
      this.inMemoryCache.set(storageKey, hydratedPlaylists);

      console.log(
        `[DailyVibeManager] Saved ${hydratedPlaylists.length} daily vibe playlists to storage key "${storageKey}".`
      );

      return hydratedPlaylists;
    } finally {
      safeStorage.removeItem(lockKey);
    }
  }

  /**
   * Transforms raw LLM playlist output into full CustomPlaylist / DailyVibePlaylist objects
   * with playable audio URLs and artwork.
   */
  private hydratePlaylists(
    rawPlaylists: RawVibePlaylist[],
    dateString: string,
    modelUsed: string
  ): DailyVibePlaylist[] {
    return rawPlaylists.map((raw) => {
      const meta = VIBE_META[raw.vibe] || VIBE_META.gaming;
      const playlistId = `daily-vibe-${raw.vibe}-${dateString}`;

      const tracks: VibePlaylistTrack[] = raw.tracks.map((t, idx) => {
        const trackId = `vibe:${raw.vibe}:${dateString}:${idx}`;
        const hasBackend = !isAndroidApp();
        const backendStreamUrl = getApiUrl(
          `/api/stream/track?artist=${encodeURIComponent(t.artist)}&title=${encodeURIComponent(
            t.title
          )}&duration=210&id=${encodeURIComponent(trackId)}`
        );
        const streamUrl = hasBackend ? backendStreamUrl : backendStreamUrl;

        const defaultArt = getTrackArtwork({ artist: t.artist, title: t.title });

        const track: VibePlaylistTrack = {
          id: trackId,
          source: 'charts',
          title: t.title,
          artist: t.artist,
          album: raw.title,
          duration: 210, // ~3.5 min standard estimated duration
          streamUrl,
          artworkUrl: defaultArt,
          vibeReason: t.vibeReason || `Curated for ${meta.label} vibe`,
          isWebDiscovery: true,
          sourceMetadata: {
            genre: t.genre || meta.label,
            format: 'mp3',
            vibe: raw.vibe,
            license: 'Dotify Multi-Source Stream',
          },
        };

        // Asynchronously resolve real album artwork in background if placeholder
        if (isUglyPlaceholder(defaultArt)) {
          resolveTrackArtwork(t.artist, t.title)
            .then((resolved) => {
              if (resolved && !isUglyPlaceholder(resolved)) {
                track.artworkUrl = resolved;
              }
            })
            .catch(() => {});
        }

        return track;
      });

      return {
        id: playlistId,
        name: raw.title,
        description: raw.description,
        coverArt: meta.defaultCover,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        vibe: raw.vibe,
        vibeLabel: meta.label,
        vibeIcon: meta.icon,
        vibeTagline: raw.tagline,
        themeGradient: meta.themeGradient,
        accentColor: meta.accentColor,
        generatedDate: dateString,
        isAIGenerated: true,
        modelUsed,
        tracks,
      };
    });
  }

  /**
   * Resolves a daily vibe playlist by ID across all cached sets
   * (e.g. for PlaylistView navigation).
   */
  public getVibePlaylistById(playlistId: string): DailyVibePlaylist | null {
    if (!playlistId || !playlistId.startsWith('daily-vibe-')) return null;

    // Check memory cache
    for (const list of this.inMemoryCache.values()) {
      const found = list.find((p) => p.id === playlistId);
      if (found) return found;
    }

    // Check safeStorage for today
    const today = this.getTodayDateString();
    const guestKey = this.getStorageKey('guest', today);
    const guestCached = safeStorage.getItem<DailyVibesCache | null>(guestKey, null);
    if (guestCached && Array.isArray(guestCached.playlists)) {
      const found = guestCached.playlists.find((p) => p.id === playlistId);
      if (found) return found;
    }

    return null;
  }

  /**
   * Clones and permanently saves a daily vibe playlist into the user's permanent library.
   */
  public saveVibeToLibrary(playlist: DailyVibePlaylist): string {
    const store = usePlayerStore.getState();
    const cleanName = playlist.name.trim().toLowerCase();
    const existing = (store.playlists || []).find(
      (p) => p.id === playlist.id || p.name.trim().toLowerCase() === cleanName
    );
    if (existing) {
      return existing.id;
    }

    const newId = store.importCustomPlaylist({
      name: playlist.name,
      description: `${playlist.description} (Curated by Dotify AI)`,
      coverArt: playlist.coverArt,
      tracks: playlist.tracks,
    });
    return newId;
  }
}

export const dailyVibeManager = DailyVibeManager.getInstance();
