/**
 * YouTube Video ID Resolver & Search Bridge
 * Resolves full-length tracks to YouTube video IDs for standalone client playback.
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
 * Searches YouTube for candidate videos.
 * Uses Android native HTTP bridge if on Android (fast, zero CORS, unblocked),
 * or public fallback endpoints.
 */
export async function searchYouTube(query: string): Promise<YouTubeCandidate[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  // 1. Android Native Bridge (OkHttp/HttpURLConnection in MainActivity.kt)
  try {
    const androidNative = (window as any).AndroidNativeYouTube;
    if (androidNative && typeof androidNative.searchYouTubeCandidates === 'function') {
      const jsonStr = androidNative.searchYouTubeCandidates(cleanQuery);
      if (jsonStr && typeof jsonStr === 'string' && jsonStr.startsWith('[')) {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((item: any) => ({
            videoId: String(item.videoId || ''),
            title: String(item.title || ''),
            duration: Number(item.duration) || 0,
          })).filter(c => c.videoId.length === 11);
        }
      }
    }
  } catch (err) {
    console.warn('[YouTubeResolver] Android native search error:', err);
  }

  // 2. Desktop Backend / LAN peer search (if available on :3001)
  try {
    const searchUrl = `/api/search/youtube?q=${encodeURIComponent(cleanQuery)}`;
    const res = await fetch(searchUrl, { signal: AbortSignal.timeout(3500) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.map((item: any) => ({
          videoId: String(item.videoId || item.id || ''),
          title: String(item.title || ''),
          duration: Number(item.duration) || 0,
        })).filter(c => c.videoId.length === 11);
      }
    }
  } catch {
    // Backend search not available
  }

  // 3. Public privacy mirror fallback (Invidious search instances)
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
          return json.slice(0, 10).map((item: any) => ({
            videoId: String(item.videoId || ''),
            title: String(item.title || ''),
            duration: Number(item.lengthSeconds) || 0,
          })).filter(c => c.videoId.length === 11);
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

/**
 * Resolves a track to its best-matching YouTube videoId.
 * Results are persistently cached.
 */
export async function resolveYouTubeVideoId(
  artist: string,
  title: string,
  expectedDuration?: number
): Promise<string | null> {
  const key = normalizeKey(artist, title);
  if (!key) return null;

  // 1. Check in-memory cache
  if (MEMORY_CACHE.has(key)) {
    return MEMORY_CACHE.get(key)!;
  }

  // 2. Check localStorage cache
  try {
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem(CACHE_PREFIX + key);
      if (cached && cached.length === 11) {
        MEMORY_CACHE.set(key, cached);
        return cached;
      }
    }
  } catch {}

  const targetDuration = expectedDuration && isFinite(expectedDuration) ? Math.round(expectedDuration) : 0;

  // 3. Perform search
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

  // Cache resolution
  MEMORY_CACHE.set(key, best.videoId);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CACHE_PREFIX + key, best.videoId);
    }
  } catch {}

  return best.videoId;
}
