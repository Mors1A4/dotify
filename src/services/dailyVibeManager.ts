import { safeStorage } from '../utils/storage';
import { DailyVibePlaylist, DailyVibesCache, UserVibeConfig, VibeCategory, VibePlaylistTrack } from '../types/vibes';
import { TrackPlayRecord } from '../types/telemetry';
import { genreProfiler } from './genreProfiler';
import { geminiVibeService, RawVibePlaylist } from './geminiVibeService';
import { telemetryDb } from './telemetryDb';
import { usePlayerStore } from '../store/playerStore';
import { useAuthStore } from '../store/authStore';
import { getApiUrl, isAndroidApp } from './apiConfig';
import { getTrackArtwork, resolveTrackArtwork, isUglyPlaceholder } from './artworkService';

export const DEFAULT_VIBE_PRESETS: UserVibeConfig[] = [
  {
    id: 'gaming',
    label: 'Gaming',
    prompt: 'High focus, fast-paced energy, and flow state for gaming sessions',
    themeColor: 'purple',
    defaultCover: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'working',
    label: 'Working',
    prompt: 'Deep concentration, steady productivity, and minimal distraction',
    themeColor: 'emerald',
    defaultCover: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'partying',
    label: 'Partying',
    prompt: 'High energy, celebration, danceable rhythms, and weekend party momentum',
    themeColor: 'rose',
    defaultCover: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'chilling',
    label: 'Chilling',
    prompt: 'Laid back, sunset relaxation, and mellow evening downtime',
    themeColor: 'blue',
    defaultCover: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'workout',
    label: 'Workout',
    prompt: 'High-intensity motivation, heavy momentum, and physical endurance',
    themeColor: 'amber',
    defaultCover: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'nightdrive',
    label: 'Night Drive',
    prompt: 'Late-night journey, open highway, and atmospheric reflection',
    themeColor: 'purple',
    defaultCover: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'coffee',
    label: 'Morning Coffee',
    prompt: 'Warm morning routine, easy wake-up, and positive start to the day',
    themeColor: 'amber',
    defaultCover: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'coding',
    label: 'Coding Flow',
    prompt: 'Deep technical immersion and uninterrupted problem solving',
    themeColor: 'emerald',
    defaultCover: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'meditation',
    label: 'Meditation',
    prompt: 'Calm mindfulness, peaceful breathing, and restorative stillness',
    themeColor: 'blue',
    defaultCover: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&auto=format&fit=crop&q=80',
  },
  {
    id: 'nostalgia',
    label: 'Nostalgia',
    prompt: 'Timeless favorites, emotional memories, and classic comfort',
    themeColor: 'rose',
    defaultCover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80',
  },
];

const VIBE_META: Record<
  string,
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
    icon: '',
    themeGradient: 'from-purple-900/80 via-slate-900 to-indigo-950 border-purple-700/50',
    accentColor: '#a855f7',
    defaultCover: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&auto=format&fit=crop&q=80',
  },
  working: {
    label: 'Working',
    icon: '',
    themeGradient: 'from-emerald-950/80 via-slate-900 to-teal-950 border-emerald-700/50',
    accentColor: '#10b981',
    defaultCover: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=800&auto=format&fit=crop&q=80',
  },
  partying: {
    label: 'Partying',
    icon: '',
    themeGradient: 'from-rose-950/80 via-slate-900 to-pink-950 border-rose-700/50',
    accentColor: '#f43f5e',
    defaultCover: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&auto=format&fit=crop&q=80',
  },
  chilling: {
    label: 'Chilling',
    icon: '',
    themeGradient: 'from-blue-950/80 via-slate-900 to-cyan-950 border-blue-700/50',
    accentColor: '#0ea5e9',
    defaultCover: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=800&auto=format&fit=crop&q=80',
  },
  workout: {
    label: 'Workout',
    icon: '',
    themeGradient: 'from-amber-950/80 via-slate-900 to-orange-950 border-amber-700/50',
    accentColor: '#f59e0b',
    defaultCover: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&auto=format&fit=crop&q=80',
  },
  nightdrive: {
    label: 'Night Drive',
    icon: '',
    themeGradient: 'from-indigo-950/80 via-slate-900 to-purple-950 border-indigo-700/50',
    accentColor: '#818cf8',
    defaultCover: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800&auto=format&fit=crop&q=80',
  },
  coffee: {
    label: 'Morning Coffee',
    icon: '',
    themeGradient: 'from-amber-950/80 via-slate-900 to-yellow-950 border-amber-700/50',
    accentColor: '#f59e0b',
    defaultCover: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&auto=format&fit=crop&q=80',
  },
  coding: {
    label: 'Coding Flow',
    icon: '',
    themeGradient: 'from-emerald-950/80 via-slate-900 to-cyan-950 border-teal-700/50',
    accentColor: '#14b8a6',
    defaultCover: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&auto=format&fit=crop&q=80',
  },
  meditation: {
    label: 'Meditation',
    icon: '',
    themeGradient: 'from-blue-950/80 via-slate-900 to-indigo-950 border-blue-700/50',
    accentColor: '#38bdf8',
    defaultCover: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&auto=format&fit=crop&q=80',
  },
  nostalgia: {
    label: 'Nostalgia',
    icon: '',
    themeGradient: 'from-pink-950/80 via-slate-900 to-rose-950 border-pink-700/50',
    accentColor: '#f43f5e',
    defaultCover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80',
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

  public getActiveVibesKey(accountId: string = 'guest'): string {
    const cleanId = (accountId || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `dotify_active_vibes_${cleanId}`;
  }

  /**
   * Refreshes vibe playlists on user demand.
   * Bypasses existing daily caches and generates a fresh, newly rotated tracklist.
   */
  public async refreshVibes(accountId: string = 'guest'): Promise<DailyVibePlaylist[]> {
    return this.getDailyVibes(accountId, true);
  }

  /**
   * Retrieves vibe playlists for the given account.
   * If already generated, loads immediately from cache.
   * When forceRegenerate is true (e.g. user pressed Refresh), generates fresh tracks on demand.
   */
  public async getDailyVibes(
    accountId: string = 'guest',
    forceRegenerate: boolean = false
  ): Promise<DailyVibePlaylist[]> {
    const today = this.getTodayDateString();
    const storageKey = this.getStorageKey(accountId, today);
    const activeKey = this.getActiveVibesKey(accountId);

    if (forceRegenerate) {
      this.inMemoryCache.delete(storageKey);
      this.inMemoryCache.delete(activeKey);
    }

    // 1. Check memory cache
    const mem = this.inMemoryCache.get(storageKey) || this.inMemoryCache.get(activeKey);
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
        this.inMemoryCache.set(activeKey, cached.playlists);
        return cached.playlists;
      }

      // Check persistent active cache (so existing playlists remain playable without waiting)
      const activeCached = safeStorage.getItem<DailyVibesCache | null>(activeKey, null);
      if (activeCached && Array.isArray(activeCached.playlists) && activeCached.playlists.length >= 4) {
        this.inMemoryCache.set(storageKey, activeCached.playlists);
        this.inMemoryCache.set(activeKey, activeCached.playlists);
        return activeCached.playlists;
      }

      // Check cross-instance persistent lock (e.g., user opening multiple windows simultaneously)
      const activeLock = safeStorage.getItem<number | null>(lockKey, null);
      if (activeLock && Date.now() - activeLock < lockExpiryMs) {
        console.log(`[DailyVibeManager] Another instance is currently curating daily vibes. Awaiting cache...`);
        for (let i = 0; i < 30; i++) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const freshlyCached =
            safeStorage.getItem<DailyVibesCache | null>(storageKey, null) ||
            safeStorage.getItem<DailyVibesCache | null>(activeKey, null);
          if (freshlyCached && Array.isArray(freshlyCached.playlists) && freshlyCached.playlists.length >= 4) {
            this.inMemoryCache.set(storageKey, freshlyCached.playlists);
            this.inMemoryCache.set(activeKey, freshlyCached.playlists);
            return freshlyCached.playlists;
          }
        }
      }
    }

    // 3. If user has not onboarded and configured their 5 vibes, do NOT auto-curate behind their back
    if (!this.hasUserConfiguredVibes(accountId) && !forceRegenerate) {
      return [];
    }

    // 4. Prevent duplicate concurrent generations in the current process
    if (this.activeGenerationPromise) {
      return this.activeGenerationPromise;
    }

    this.activeGenerationPromise = this.generateAndSaveDailyVibes(accountId, today, storageKey, activeKey);
    try {
      const result = await this.activeGenerationPromise;
      return result;
    } finally {
      this.activeGenerationPromise = null;
    }
  }

  /**
   * Checks whether the user has explicitly selected/typed and saved their 5 daily vibes.
   */
  public hasUserConfiguredVibes(accountId: string = 'guest'): boolean {
    const cleanId = (accountId || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
    const storageKey = `dotify_user_vibes_${cleanId}`;
    const saved = safeStorage.getItem<UserVibeConfig[] | null>(storageKey, null);
    return Boolean(
      saved &&
        Array.isArray(saved) &&
        saved.length === 5 &&
        saved.every((v) => typeof v?.label === 'string' && v.label.trim().length > 0)
    );
  }

  /**
   * Returns the user's saved 5 custom vibes. If unconfigured, returns an empty array.
   */
  public getUserVibes(accountId: string = 'guest'): UserVibeConfig[] {
    const cleanId = (accountId || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
    const storageKey = `dotify_user_vibes_${cleanId}`;
    const saved = safeStorage.getItem<UserVibeConfig[] | null>(storageKey, null);
    if (
      saved &&
      Array.isArray(saved) &&
      saved.length === 5 &&
      saved.every((v) => typeof v?.label === 'string' && v.label.trim().length > 0)
    ) {
      return saved;
    }
    return [];
  }

  /**
   * Returns suggested inspiration presets for the user to pick from if desired.
   */
  public getDefaultPresetSuggestions(): UserVibeConfig[] {
    return DEFAULT_VIBE_PRESETS;
  }

  public saveUserVibes(vibes: UserVibeConfig[], accountId: string = 'guest'): void {
    const cleanId = (accountId || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
    const storageKey = `dotify_user_vibes_${cleanId}`;
    const sanitized: UserVibeConfig[] = vibes.slice(0, 5).map((v, idx) => {
      const cleanLabel = (v.label || `Vibe ${idx + 1}`).trim();
      const cleanId = v.id || `custom_${cleanLabel.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${idx}`;
      return {
        id: cleanId,
        label: cleanLabel,
        prompt: v.prompt && v.prompt.trim().length > 0
          ? v.prompt.trim()
          : `Music soundscape for ${cleanLabel} matching your personal taste.`,
        themeColor: v.themeColor || (['purple', 'emerald', 'rose', 'blue', 'amber'][idx % 5] as any),
        defaultCover: v.defaultCover || DEFAULT_VIBE_PRESETS[idx % DEFAULT_VIBE_PRESETS.length].defaultCover,
        isAmended: Boolean(v.isAmended),
      };
    });
    safeStorage.setItem(storageKey, sanitized);
  }

  private async generateAndSaveDailyVibes(
    accountId: string,
    today: string,
    storageKey: string,
    activeKey?: string
  ): Promise<DailyVibePlaylist[]> {
    const lockKey = `${storageKey}_lock`;
    safeStorage.setItem(lockKey, Date.now());

    try {
      console.log(`[DailyVibeManager] Generating vibe playlists for account "${accountId}" on ${today}...`);

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

      // C. Retrieve user selected/customized vibes (5 vibes)
      const userVibes = this.getUserVibes(accountId);
      const effectiveVibes = userVibes.length === 5 ? userVibes : DEFAULT_VIBE_PRESETS.slice(0, 5);

      // D. Call Gemini or Dynamic Multi-Domain Rotating Engine
      const geminiResult = await geminiVibeService.generateDailyVibePlaylists(tasteProfile, today, effectiveVibes);

      // E. Hydrate raw tracks into full Dotify playable tracks
      const hydratedPlaylists = this.hydratePlaylists(
        geminiResult.playlists,
        today,
        geminiResult.modelUsed,
        effectiveVibes
      );

      // F. Save to safeStorage
      const cacheRecord: DailyVibesCache = {
        date: today,
        accountId,
        generatedAt: Date.now(),
        playlists: hydratedPlaylists,
        tasteProfileSummary: tasteProfile.summaryText,
      };

      safeStorage.setItem(storageKey, cacheRecord);
      if (activeKey) {
        safeStorage.setItem(activeKey, cacheRecord);
      }
      this.inMemoryCache.set(storageKey, hydratedPlaylists);
      if (activeKey) {
        this.inMemoryCache.set(activeKey, hydratedPlaylists);
      }

      // Automatically sync playlists saved to the user's permanent library
      this.syncSavedVibePlaylists(hydratedPlaylists);

      console.log(
        `[DailyVibeManager] Saved ${hydratedPlaylists.length} vibe playlists to storage key "${storageKey}".`
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
    modelUsed: string,
    userVibes?: UserVibeConfig[]
  ): DailyVibePlaylist[] {
    return rawPlaylists.map((raw, pIdx) => {
      const cleanRawVibe = raw.vibe.toLowerCase().replace(/[^a-z0-9]/g, '');

      // Robust matching against user configured vibes
      let matchingVibe = userVibes?.find(
        (v) =>
          v.id.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanRawVibe ||
          v.label.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanRawVibe
      );

      if (!matchingVibe && userVibes && pIdx < userVibes.length) {
        matchingVibe = userVibes[pIdx];
      }

      if (!matchingVibe) {
        matchingVibe = DEFAULT_VIBE_PRESETS.find(
          (v) => v.id.toLowerCase() === raw.vibe.toLowerCase()
        );
      }

      const meta = VIBE_META[raw.vibe] || VIBE_META.gaming;
      const playlistId = `daily-vibe-${raw.vibe}-${dateString}`;
      const label = matchingVibe?.label || meta?.label || (raw.vibe.charAt(0).toUpperCase() + raw.vibe.slice(1));
      const labelLower = label.toLowerCase();

      // Dynamic artwork & gradient for custom / sci-fi / singularity / cyberpunk aesthetics
      let coverArt = matchingVibe?.defaultCover || meta?.defaultCover || DEFAULT_VIBE_PRESETS[0].defaultCover;
      let themeGradient = meta?.themeGradient || 'from-purple-900/80 via-slate-900 to-indigo-950 border-purple-700/50';
      let accentColor = meta?.accentColor || '#a855f7';

      if (
        labelLower.includes('singularity') ||
        labelLower.includes('cyber') ||
        labelLower.includes('ai') ||
        labelLower.includes('future') ||
        labelLower.includes('robot') ||
        labelLower.includes('dystop')
      ) {
        coverArt = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80';
        themeGradient = 'from-fuchsia-950/80 via-slate-900 to-cyan-950 border-cyan-500/50';
        accentColor = '#06b6d4';
      } else if (labelLower.includes('space') || labelLower.includes('cosmic') || labelLower.includes('night')) {
        coverArt = 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=800&auto=format&fit=crop&q=80';
        themeGradient = 'from-indigo-950/80 via-slate-900 to-purple-950 border-purple-500/50';
        accentColor = '#818cf8';
      }

      const tracks: VibePlaylistTrack[] = raw.tracks.map((t, idx) => {
        const trackId = `vibe:${raw.vibe}:${dateString}:${idx}`;
        const streamUrl = getApiUrl(
          `/api/stream/track?artist=${encodeURIComponent(t.artist)}&title=${encodeURIComponent(
            t.title
          )}&duration=210&id=${encodeURIComponent(trackId)}`
        );

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
          vibeReason: t.vibeReason || `Curated for ${label} vibe`,
          isWebDiscovery: true,
          sourceMetadata: {
            genre: t.genre || label,
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
        coverArt,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        vibe: raw.vibe,
        vibeLabel: label,
        vibeIcon: '', // Strictly no emojis
        vibeTagline: raw.tagline,
        themeGradient,
        accentColor,
        generatedDate: dateString,
        isAIGenerated: true,
        modelUsed,
        domainReasoning: raw.domainReasoning,
        isExtraLong: raw.isExtraLong ?? (raw.tracks.length >= 30 || Boolean(matchingVibe?.isAmended)),
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

    // 1. Check memory cache
    for (const list of this.inMemoryCache.values()) {
      const found = list.find((p) => p.id === playlistId);
      if (found) return found;
    }

    // 2. Check safeStorage for today
    const today = this.getTodayDateString();
    const guestKey = this.getStorageKey('guest', today);
    const guestCached = safeStorage.getItem<DailyVibesCache | null>(guestKey, null);
    if (guestCached && Array.isArray(guestCached.playlists)) {
      const found = guestCached.playlists.find((p) => p.id === playlistId);
      if (found) return found;
    }

    // 3. Check safeStorage for active key
    const authUser = useAuthStore.getState().user;
    const currentUid = authUser?.uid || 'guest';
    const activeKey = this.getActiveVibesKey(currentUid);
    const activeCached = safeStorage.getItem<DailyVibesCache | null>(activeKey, null);
    if (activeCached && Array.isArray(activeCached.playlists)) {
      const found = activeCached.playlists.find((p) => p.id === playlistId);
      if (found) return found;
    }

    // 4. Fallback: match across all caches by stripping date suffix or matching vibe category
    const strippedVibe = playlistId.replace(/^daily-vibe-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '');
    const allKnownPlaylists: DailyVibePlaylist[] = [
      ...Array.from(this.inMemoryCache.values()).flat(),
      ...(activeCached?.playlists || []),
      ...(guestCached?.playlists || []),
    ];
    const found = allKnownPlaylists.find(
      (p) =>
        p.id === playlistId ||
        p.vibe === strippedVibe ||
        p.id.replace(/^daily-vibe-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '') === strippedVibe
    );
    if (found) return found;

    return null;
  }

  /**
   * Synchronizes any playlists in the user's permanent library that originated from
   * a daily vibe playlist so that pressing Refresh updates them automatically.
   */
  public syncSavedVibePlaylists(refreshedPlaylists: DailyVibePlaylist[]): void {
    try {
      const store = usePlayerStore.getState();
      const libraryPlaylists = store.playlists || [];
      if (libraryPlaylists.length === 0) return;

      let changed = false;
      const updated = libraryPlaylists.map((pl) => {
        const matchingVibe = refreshedPlaylists.find(
          (v) =>
            v.id === pl.id ||
            v.name.trim().toLowerCase() === pl.name.trim().toLowerCase() ||
            (pl.id.startsWith('daily-vibe-') && pl.id.includes(`-${v.vibe}-`))
        );

        if (matchingVibe && matchingVibe.tracks && matchingVibe.tracks.length > 0) {
          changed = true;
          return {
            ...pl,
            tracks: matchingVibe.tracks,
            updatedAt: Date.now(),
          };
        }
        return pl;
      });

      if (changed) {
        safeStorage.setItem('playlists', updated);
        usePlayerStore.setState({ playlists: updated });
      }
    } catch (err) {
      console.warn('[DailyVibeManager] Failed to sync saved vibe playlists:', err);
    }
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
