/**
 * YouTube Video ID Resolver & Search Bridge
 * Resolves full-length tracks to YouTube video IDs for standalone client playback
 * Unified across Windows, Android, and Web with identical candidate ranking and multi-tier caching.
 */

export interface YouTubeCandidate {
  videoId: string;
  title: string;
  duration: number; // in seconds
  score?: number;
}

const CACHE_PREFIX = 'dotify_yt_vid_';
const MEMORY_CACHE = new Map<string, string>();

function normalizeKey(artist: string, title: string): string {
  return `${artist.toLowerCase().trim()}___${title.toLowerCase().trim()}`.replace(/[^a-z0-9_]/g, '');
}

/**
 * Parses YouTube search results HTML containing ytInitialData into candidate items.
 */
export function parseYtInitialData(html: string): YouTubeCandidate[] {
  try {
    const match = html.match(/ytInitialData\s*=\s*(\{.+?\});(?:var|\s*<\/script>)/);
    if (!match) return [];
    const root = JSON.parse(match[1]);
    const contents =
      root?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
    if (!Array.isArray(contents)) return [];

    const candidates: YouTubeCandidate[] = [];
    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const vr = item?.videoRenderer;
        if (vr && vr.videoId && vr.videoId.length === 11) {
          const videoId = String(vr.videoId);
          let title = '';
          if (Array.isArray(vr.title?.runs)) {
            title = vr.title.runs.map((r: any) => r.text || '').join('');
          } else {
            title = vr.title?.simpleText || '';
          }

          let duration = 0;
          const durStr = vr.lengthText?.simpleText || '';
          if (durStr) {
            const parts = durStr
              .split(':')
              .map((p: string) => parseInt(p.trim(), 10))
              .filter((n: number) => !isNaN(n));
            if (parts.length === 2) {
              duration = parts[0] * 60 + parts[1];
            } else if (parts.length === 3) {
              duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
            }
          }

          candidates.push({ videoId, title, duration });
        }
      }
    }
    return candidates;
  } catch {
    return [];
  }
}

/**
 * Searches YouTube for candidate videos.
 * Unified execution order across Android and Windows:
 * 1. Tauri Native Rust command (compiled on both Windows & Android)
 * 2. Android WebView bridge (MainActivity.kt)
 * 3. Local/embedded backend (/api/search/youtube)
 * 4. Public Invidious privacy mirrors
 */
export async function searchYouTube(query: string): Promise<YouTubeCandidate[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  // 1. Cross-platform Tauri native Rust command (invoked identically on Windows and Android)
  try {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      const rawRes = await invoke<string>('search_youtube_candidates', { query: cleanQuery });
      if (rawRes && typeof rawRes === 'string') {
        if (rawRes.startsWith('[')) {
          const parsed = JSON.parse(rawRes);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed
              .map((item: any) => ({
                videoId: String(item.videoId || item.id || ''),
                title: String(item.title || ''),
                duration: Number(item.duration) || 0,
              }))
              .filter((c) => c.videoId.length === 11);
          }
        } else if (rawRes.includes('ytInitialData')) {
          const parsed = parseYtInitialData(rawRes);
          if (parsed.length > 0) return parsed;
        }
      }
    }
  } catch {
    // Tauri invoke not active or command fell through
  }

  // 2. Android Native Bridge (OkHttp/HttpURLConnection in MainActivity.kt)
  try {
    if (typeof window !== 'undefined') {
      const androidNative = (window as any).AndroidNativeYouTube;
      if (androidNative && typeof androidNative.searchYouTubeCandidates === 'function') {
        const jsonStr = androidNative.searchYouTubeCandidates(cleanQuery);
        if (jsonStr && typeof jsonStr === 'string' && jsonStr.startsWith('[')) {
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed
              .map((item: any) => ({
                videoId: String(item.videoId || ''),
                title: String(item.title || ''),
                duration: Number(item.duration) || 0,
              }))
              .filter((c) => c.videoId.length === 11);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[YouTubeResolver] Android native search error:', err);
  }

  // 3. Local/Embedded Backend or LAN peer search (:3001)
  try {
    const searchUrl = `/api/search/youtube?q=${encodeURIComponent(cleanQuery)}`;
    const res = await fetch(searchUrl, { signal: AbortSignal.timeout(3500) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data
          .map((item: any) => ({
            videoId: String(item.videoId || item.id || ''),
            title: String(item.title || ''),
            duration: Number(item.duration) || 0,
          }))
          .filter((c) => c.videoId.length === 11);
      }
    }
  } catch {
    // Backend search not available
  }

  // 4. Public privacy mirror fallback (Invidious search instances)
  const publicInstances = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://yewtu.be',
  ];

  for (const instance of publicInstances) {
    try {
      const url = `${instance}/api/v1/search?q=${encodeURIComponent(cleanQuery)}&type=video`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json) && json.length > 0) {
          return json
            .slice(0, 10)
            .map((item: any) => ({
              videoId: String(item.videoId || ''),
              title: String(item.title || ''),
              duration: Number(item.lengthSeconds) || 0,
            }))
            .filter((c) => c.videoId.length === 11);
        }
      }
    } catch {
      continue;
    }
  }

  return [];
}

/**
 * Ranks candidate videos against target artist, title, and expected duration.
 * Prefers exact durations, official audio/video, and filters out covers/loops/reactions.
 */
export function rankCandidates(
  candidates: YouTubeCandidate[],
  artist: string,
  title: string,
  expectedDur = 0
): YouTubeCandidate[] {
  const normTitle = title.toLowerCase();
  const normArtist = artist.toLowerCase();

  return candidates
    .map((c) => {
      let score = 0;
      const cTitle = (c.title || '').toLowerCase();

      // 1. Duration match (within ±20s of target track)
      if (expectedDur > 0 && c.duration > 0) {
        const diff = Math.abs(c.duration - expectedDur);
        if (diff <= 5) score += 60;
        else if (diff <= 15) score += 45;
        else if (diff <= 30) score += 20;
        else if (diff > 120) score -= 50; // loop or preview teaser
      }

      // 2. Keyword bonuses
      if (cTitle.includes('official audio')) score += 35;
      else if (cTitle.includes('official music video') || cTitle.includes('official video')) score += 30;
      else if (cTitle.includes('audio')) score += 15;

      // 3. Artist & title presence
      if (cTitle.includes(normArtist)) score += 25;
      if (cTitle.includes(normTitle)) score += 25;

      // 4. Penalties for non-originals unless explicitly part of the title
      if (!normTitle.includes('live') && cTitle.includes('live')) score -= 30;
      if (!normTitle.includes('cover') && cTitle.includes('cover')) score -= 40;
      if (!normTitle.includes('remix') && cTitle.includes('remix')) score -= 25;
      if (!normTitle.includes('slowed') && (cTitle.includes('slowed') || cTitle.includes('reverb'))) score -= 40;
      if (cTitle.includes('1 hour') || cTitle.includes('10 hours') || cTitle.includes('loop')) score -= 60;

      return { ...c, score };
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

const IN_FLIGHT_RESOLUTIONS = new Map<string, Promise<string | null>>();
const PREWARM_QUEUE: Array<{ artist: string; title: string; duration?: number }> = [];
let isPrewarming = false;

/**
 * Checks synchronously whether a track candidate is already resolved in cache.
 */
export function isCandidateCached(artist: string, title: string): boolean {
  const key = normalizeKey(artist, title);
  if (!key) return false;
  if (MEMORY_CACHE.has(key)) return true;
  try {
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem(CACHE_PREFIX + key);
      return Boolean(cached && cached.length === 11);
    }
  } catch {}
  return false;
}

/**
 * Speculatively resolves and caches YouTube candidates in the background with 250ms spacing
 * to avoid saturating network bandwidth or rate limits.
 */
export function prewarmCandidate(artist: string, title: string, duration?: number): void {
  const key = normalizeKey(artist, title);
  if (!key || isCandidateCached(artist, title)) return;

  if (PREWARM_QUEUE.some((item) => normalizeKey(item.artist, item.title) === key)) {
    return;
  }

  PREWARM_QUEUE.push({ artist, title, duration });
  processPrewarmQueue();
}

async function processPrewarmQueue(): Promise<void> {
  if (isPrewarming || PREWARM_QUEUE.length === 0) return;
  isPrewarming = true;

  while (PREWARM_QUEUE.length > 0) {
    const next = PREWARM_QUEUE.shift();
    if (next) {
      try {
        await resolveYouTubeVideoId(next.artist, next.title, next.duration);
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  isPrewarming = false;
}

/**
 * Resolves a track to its best-matching YouTube videoId.
 * Deduplicates in-flight searches and caches results persistently.
 */
export async function resolveYouTubeVideoId(
  artist: string,
  title: string,
  expectedDuration?: number
): Promise<string | null> {
  const key = normalizeKey(artist, title);
  if (!key) return null;

  // 1. Check in-memory cache (<1ms)
  if (MEMORY_CACHE.has(key)) {
    return MEMORY_CACHE.get(key)!;
  }

  // 2. Check localStorage cache (<2ms)
  try {
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem(CACHE_PREFIX + key);
      if (cached && cached.length === 11) {
        MEMORY_CACHE.set(key, cached);
        return cached;
      }
    }
  } catch {}

  // 3. Deduplicate in-flight network searches
  if (IN_FLIGHT_RESOLUTIONS.has(key)) {
    return IN_FLIGHT_RESOLUTIONS.get(key)!;
  }

  const targetDuration = expectedDuration && isFinite(expectedDuration) ? Math.round(expectedDuration) : 0;

  const resolutionPromise = (async (): Promise<string | null> => {
    try {
      let candidates = await searchYouTube(`${artist} - ${title} official audio`);
      if (candidates.length === 0) {
        candidates = await searchYouTube(`${artist} - ${title}`);
      }

      if (candidates.length === 0) {
        return null;
      }

      const ranked = rankCandidates(candidates, artist, title, targetDuration);
      const best = ranked[0];
      if (!best || !best.videoId) {
        return null;
      }

      // Cache resolution in both Memory and LocalStorage
      MEMORY_CACHE.set(key, best.videoId);
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(CACHE_PREFIX + key, best.videoId);
        }
      } catch {}

      return best.videoId;
    } finally {
      IN_FLIGHT_RESOLUTIONS.delete(key);
    }
  })();

  IN_FLIGHT_RESOLUTIONS.set(key, resolutionPromise);
  return resolutionPromise;
}

