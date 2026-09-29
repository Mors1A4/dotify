import { Track } from '../types/track';
import { safeStorage } from '../utils/storage';
import { upgradeArtworkUrl } from '../utils/artwork';
import { getApiUrl } from './apiConfig';

export { upgradeArtworkUrl };

/**
 * Sleek studio-grade dark album cover placeholder SVG (glossy vinyl disc with specular sheen
 * and a centered beamed eighth-note emblem).
 */
export const DEFAULT_MUSIC_ARTWORK =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#141e19" />
          <stop offset="50%" stop-color="#101318" />
          <stop offset="100%" stop-color="#080a0d" />
        </linearGradient>
        <radialGradient id="ambient" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stop-color="#1db954" stop-opacity="0.22" />
          <stop offset="55%" stop-color="#0d9488" stop-opacity="0.08" />
          <stop offset="100%" stop-color="#000000" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="disc" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#22262c" />
          <stop offset="70%" stop-color="#14171a" />
          <stop offset="100%" stop-color="#0c0e10" />
        </radialGradient>
        <linearGradient id="sheen" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0" />
          <stop offset="44%" stop-color="#ffffff" stop-opacity="0.02" />
          <stop offset="50%" stop-color="#ffffff" stop-opacity="0.09" />
          <stop offset="56%" stop-color="#ffffff" stop-opacity="0.02" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#22c55e" />
          <stop offset="100%" stop-color="#10b981" />
        </linearGradient>
      </defs>
      <rect width="400" height="400" fill="url(#bg)" />
      <rect width="400" height="400" fill="url(#ambient)" />
      <!-- Outer Vinyl Disc -->
      <circle cx="200" cy="200" r="146" fill="url(#disc)" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1.5" />
      <circle cx="200" cy="200" r="146" fill="url(#sheen)" />
      <!-- Precision Vinyl Grooves -->
      <circle cx="200" cy="200" r="128" fill="none" stroke="#ffffff" stroke-opacity="0.05" stroke-width="1.2" />
      <circle cx="200" cy="200" r="110" fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="1.2" />
      <circle cx="200" cy="200" r="92" fill="none" stroke="#ffffff" stroke-opacity="0.05" stroke-width="1.2" />
      <circle cx="200" cy="200" r="74" fill="none" stroke="#1db954" stroke-opacity="0.14" stroke-width="1.2" />
      <!-- Center Studio Badge -->
      <circle cx="200" cy="200" r="52" fill="url(#accentGrad)" fill-opacity="0.15" stroke="url(#accentGrad)" stroke-opacity="0.55" stroke-width="2" />
      <circle cx="200" cy="200" r="44" fill="#0d1115" />
      <!-- Centered Beamed Eighth Notes -->
      <ellipse cx="185" cy="213" rx="8.5" ry="6.5" transform="rotate(-18 185 213)" fill="url(#accentGrad)" />
      <ellipse cx="213" cy="207" rx="8.5" ry="6.5" transform="rotate(-18 213 207)" fill="url(#accentGrad)" />
      <rect x="190" y="179" width="3.8" height="33" rx="1.5" fill="url(#accentGrad)" />
      <rect x="218" y="173" width="3.8" height="33" rx="1.5" fill="url(#accentGrad)" />
      <path d="M190 179 L221.8 173 L221.8 181.5 L190 187.5 Z" fill="url(#accentGrad)" />
    </svg>`
  );

/**
 * Checks whether an artwork URL is missing, invalid, pointing to a fallback SVG placeholder,
 * or pointing to a broken/empty upstream image hash.
 */
export function isUglyPlaceholder(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return true;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length < 12) return true;
  if (trimmed === DEFAULT_MUSIC_ARTWORK) return true;

  const lower = trimmed.toLowerCase();
  if (
    lower.includes('1511671782779-c97d3d27a1d4') ||
    lower.includes('placehold') ||
    lower.includes('images/cover//') ||
    lower.includes('images/artist//') ||
    lower.includes('default_cover') ||
    lower.includes('default_artist')
  ) {
    return true;
  }

  // Treat any fallback SVG data URI as a placeholder (except intentional custom playlist studio presets)
  if (lower.startsWith('data:image/svg+xml')) {
    let decoded = lower;
    try {
      decoded = decodeURIComponent(lower);
    } catch {}
    const isPlaylistPreset =
      decoded.includes('dotify mix') ||
      decoded.includes('synthwave') ||
      decoded.includes('golden hour') ||
      decoded.includes('night drive') ||
      decoded.includes('velvet vibes') ||
      decoded.includes('lo-fi study') ||
      decoded.includes('anthems');
    return !isPlaylistPreset;
  }

  return false;
}

const memoryArtworkCache = new Map<string, string>();
const pendingArtworkPromises = new Map<string, Promise<string>>();

function cleanSearchToken(s: string): string {
  return (s || '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/\b(?:ft\.?|feat\.?|featuring|official\s+video|official\s+audio|remastered|live|explicit)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getPrimaryArtist(artist: string): string {
  if (!artist) return '';
  const parts = artist.split(/\s+(?:feat\.?|ft\.?|featuring|vs\.?|with|&)\s+|,|\//i);
  return (parts[0] || artist).trim();
}

export function getCacheKey(artist: string, title: string): string {
  const clean = (s: string) =>
    cleanSearchToken(s)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  return `art_${clean(artist)}_${clean(title)}`;
}

/**
 * Updates any mounted <img> elements in the document and stored track records
 * once a track's real album artwork is resolved.
 */
function propagateResolvedArtwork(artist: string, title: string, key: string, coverUrl: string): void {
  // 1. Update any mounted <img> elements currently showing the placeholder for this title
  if (typeof document !== 'undefined') {
    try {
      const imgs = document.querySelectorAll('img');
      const lowerTitle = (title || '').trim().toLowerCase();
      imgs.forEach((img) => {
        const imgKey = img.getAttribute('data-artwork-key');
        const imgAlt = (img.getAttribute('alt') || '').trim().toLowerCase();
        const currentSrc = img.getAttribute('src') || '';
        if (
          (imgKey === key || (lowerTitle && imgAlt === lowerTitle)) &&
          isUglyPlaceholder(currentSrc)
        ) {
          img.src = coverUrl;
        }
      });
    } catch {}
  }

  // 2. Heal persisted localStorage lists (history, liked, queue) so future loads have the real URL
  try {
    for (const storageKey of ['history', 'liked', 'queue']) {
      const list = safeStorage.getItem<Track[]>(storageKey, []);
      if (Array.isArray(list) && list.length > 0) {
        let changed = false;
        for (const item of list) {
          if (
            item &&
            getCacheKey(item.artist || '', item.title || '') === key &&
            isUglyPlaceholder(item.artworkUrl)
          ) {
            item.artworkUrl = coverUrl;
            changed = true;
          }
        }
        if (changed) {
          safeStorage.setItem(storageKey, list);
        }
      }
    }
  } catch {}

  // 3. Heal telemetryDb play records asynchronously
  import('./telemetryDb')
    .then(async ({ telemetryDb }) => {
      try {
        const db = await telemetryDb.getDb();
        const stores = ['track_plays', 'plays'].filter((n) => db.objectStoreNames.contains(n));
        if (stores.length === 0) return;
        const tx = db.transaction(stores, 'readwrite');
        for (const storeName of stores) {
          const store = tx.objectStore(storeName);
          const req = store.getAll();
          req.onsuccess = () => {
            const records = req.result || [];
            for (const rec of records) {
              if (
                rec &&
                getCacheKey(rec.artist || '', rec.title || '') === key &&
                isUglyPlaceholder(rec.artworkUrl)
              ) {
                rec.artworkUrl = coverUrl;
                store.put(rec);
              }
            }
          };
        }
      } catch {}
    })
    .catch(() => {});
}

/**
 * Returns a valid artwork URL for a track, replacing legacy/ugly placeholders with cached
 * high-resolution album art or DEFAULT_MUSIC_ARTWORK (while kicking off background resolution).
 */
export function getTrackArtwork(track?: Partial<Track> | null): string {
  if (!track) return DEFAULT_MUSIC_ARTWORK;
  const key = getCacheKey(track.artist || '', track.title || '');

  if (track.artworkUrl && !isUglyPlaceholder(track.artworkUrl)) {
    const upgraded = upgradeArtworkUrl(track.artworkUrl);
    if (track.artist && track.title && !memoryArtworkCache.has(key)) {
      memoryArtworkCache.set(key, upgraded);
    }
    return upgraded;
  }

  if (memoryArtworkCache.has(key)) {
    const cached = memoryArtworkCache.get(key)!;
    if (!isUglyPlaceholder(cached)) {
      track.artworkUrl = cached;
      return cached;
    }
  }

  const persisted = safeStorage.getItem<string>(key, '');
  if (persisted && !isUglyPlaceholder(persisted)) {
    const upgraded = upgradeArtworkUrl(persisted);
    memoryArtworkCache.set(key, upgraded);
    track.artworkUrl = upgraded;
    return upgraded;
  }

  // Automatically trigger background resolution so any track missing art heals itself
  if (track.artist?.trim() || track.title?.trim()) {
    resolveTrackArtwork(track.artist || '', track.title || '').then((resolved) => {
      if (resolved && !isUglyPlaceholder(resolved)) {
        track.artworkUrl = resolved;
      }
    }).catch(() => {});
  }

  return DEFAULT_MUSIC_ARTWORK;
}

/**
 * Dynamically resolves actual high-resolution album artwork for a song or album
 * by querying iTunes Search API and Deezer Charts proxy with smart artist/title matching.
 */
export async function resolveTrackArtwork(artist: string, title: string): Promise<string> {
  if (!artist?.trim() && !title?.trim()) {
    return DEFAULT_MUSIC_ARTWORK;
  }

  const key = getCacheKey(artist, title);

  if (memoryArtworkCache.has(key)) {
    const cached = memoryArtworkCache.get(key)!;
    if (!isUglyPlaceholder(cached)) return cached;
  }

  const persisted = safeStorage.getItem<string>(key, '');
  if (persisted && !isUglyPlaceholder(persisted)) {
    const upgraded = upgradeArtworkUrl(persisted);
    memoryArtworkCache.set(key, upgraded);
    return upgraded;
  }

  if (pendingArtworkPromises.has(key)) {
    return pendingArtworkPromises.get(key)!;
  }

  const promise = (async () => {
    const primaryArtist = getPrimaryArtist(artist);
    const cleanTitle = cleanSearchToken(title);
    const cleanArtist = cleanSearchToken(primaryArtist || artist);
    const query = `${cleanArtist} ${cleanTitle}`.trim();
    const normArtist = cleanArtist.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normTitle = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');

    const saveAndReturn = (rawCover: string): string => {
      const highRes = upgradeArtworkUrl(rawCover);
      memoryArtworkCache.set(key, highRes);
      safeStorage.setItem(key, highRes);
      propagateResolvedArtwork(artist, title, key, highRes);
      return highRes;
    };

    // 1. Try iTunes Search API (fast, CORS-enabled globally, 600x600 HD covers)
    try {
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(
        query
      )}&entity=song&limit=5`;
      const res = await fetch(itunesUrl, { signal: AbortSignal.timeout(3500) });
      if (res.ok) {
        const json = await res.json();
        const results: any[] = Array.isArray(json.results) ? json.results : [];
        if (results.length > 0) {
          const matched =
            results.find((r) => {
              const rArtist = (r.artistName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              return normArtist && (rArtist.includes(normArtist) || normArtist.includes(rArtist));
            }) || results[0];

          const rawArt = matched?.artworkUrl100 || matched?.artworkUrl60;
          if (rawArt && !isUglyPlaceholder(rawArt)) {
            return saveAndReturn(rawArt.replace('100x100bb', '600x600bb'));
          }
        }
      }
    } catch {
      // iTunes song search failed or timed out, proceed to Deezer
    }

    // 2. Try Deezer Search Proxy via backend
    try {
      const res = await fetch(
        getApiUrl(`/api/charts/search?q=${encodeURIComponent(query)}&limit=5`),
        { signal: AbortSignal.timeout(3500) }
      );
      if (res.ok) {
        const json = await res.json();
        const items: any[] = Array.isArray(json.data) ? json.data : [];
        if (items.length > 0) {
          const matched =
            items.find((item) => {
              const iArtist = (item.artist?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              const iTitle = (item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              return (
                (normArtist && (iArtist.includes(normArtist) || normArtist.includes(iArtist))) ||
                (normTitle && iTitle.includes(normTitle))
              );
            }) || items[0];

          const cover =
            matched?.album?.cover_big ||
            matched?.album?.cover_medium ||
            matched?.artist?.picture_big ||
            matched?.artist?.picture_medium;
          if (cover && !isUglyPlaceholder(cover)) {
            return saveAndReturn(cover);
          }
        }
      }
    } catch {
      // Deezer proxy failed
    }

    // 3. Fallback: Search iTunes by album or artist if song search returned nothing
    if (cleanArtist) {
      try {
        const albumUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(
          query
        )}&entity=album&limit=3`;
        const res = await fetch(albumUrl, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const json = await res.json();
          const first = json.results?.[0];
          if (first?.artworkUrl100 && !isUglyPlaceholder(first.artworkUrl100)) {
            return saveAndReturn(first.artworkUrl100.replace('100x100bb', '600x600bb'));
          }
        }
      } catch {}
    }

    return DEFAULT_MUSIC_ARTWORK;
  })();

  pendingArtworkPromises.set(key, promise);
  try {
    return await promise;
  } finally {
    pendingArtworkPromises.delete(key);
  }
}

