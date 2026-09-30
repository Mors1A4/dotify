import { Track } from '../types/track';
import { getApiUrl, getCustomApiUrl, isAndroidApp, isTauriEnvironment } from './apiConfig';
import { DEFAULT_MUSIC_ARTWORK, getTrackArtwork } from './artworkService';

export interface TopArtist {
  id: number;
  name: string;
  picture: string;
  tracklist?: string;
  nb_fan?: number;
}

/**
 * Direct open-web fallback executor for Deezer API.
 * Uses native fetch in Node/test environments and JSONP in browser/Android WebView
 * to completely eliminate CORS blocks when the backend server is offline or not deployed.
 */
export function fetchDeezerDirect<T = any>(endpoint: string, timeoutMs = 6000): Promise<T> {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return fetch(`https://api.deezer.com${cleanEndpoint}`, {
      headers: { 'User-Agent': 'dotify/1.0.0' },
      signal: AbortSignal.timeout(timeoutMs),
    }).then((r) => {
      if (!r.ok) throw new Error(`Deezer fetch failed (${r.status})`);
      return r.json();
    });
  }

  return new Promise((resolve, reject) => {
    const callbackName = `__deezer_cb_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    const script = document.createElement('script');
    const separator = cleanEndpoint.includes('?') ? '&' : '?';
    const targetUrl = `https://api.deezer.com${cleanEndpoint}${separator}output=jsonp&callback=${callbackName}`;

    let isDone = false;
    const timer = setTimeout(() => {
      if (!isDone) {
        isDone = true;
        cleanup();
        reject(new Error(`Deezer direct request timed out: ${cleanEndpoint}`));
      }
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      try {
        delete (window as any)[callbackName];
      } catch {}
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    (window as any)[callbackName] = (data: T) => {
      if (!isDone) {
        isDone = true;
        cleanup();
        resolve(data);
      }
    };

    script.onerror = () => {
      if (!isDone) {
        isDone = true;
        cleanup();
        reject(new Error(`Deezer direct script error: ${cleanEndpoint}`));
      }
    };

    script.src = targetUrl;
    script.async = true;
    document.body.appendChild(script);
  });
}

export async function fetchTopCharts(limit = 40): Promise<Track[]> {
  // 1. Try backend proxy
  try {
    const res = await fetch(getApiUrl(`/api/charts/tracks?limit=${limit}`), {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data && Array.isArray(json.data) && json.data.length > 0) {
        return json.data.map(formatChartTrack);
      }
    }
  } catch (err) {
    console.debug('[ChartsApi] Proxy fetch failed, trying direct Deezer:', err);
  }

  // 2. Direct Deezer fallback
  try {
    const data = await fetchDeezerDirect(`/chart/0/tracks?limit=${limit}`);
    if (data && Array.isArray(data.data)) {
      return data.data.map(formatChartTrack);
    }
  } catch (err) {
    console.warn('[ChartsApi] Failed to fetch top charts:', err);
  }

  return [];
}

export async function fetchTopArtists(limit = 20): Promise<TopArtist[]> {
  // 1. Try backend proxy
  try {
    const res = await fetch(getApiUrl(`/api/charts/artists?limit=${limit}`), {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data && Array.isArray(json.data) && json.data.length > 0) {
        return json.data.map((item: any) => ({
          id: item.id,
          name: item.name,
          picture: item.picture_medium || item.picture_big || item.picture,
          tracklist: item.tracklist,
          nb_fan: item.nb_fan,
        }));
      }
    }
  } catch (err) {
    console.debug('[ChartsApi] Proxy top artists failed, trying direct Deezer:', err);
  }

  // 2. Direct Deezer fallback
  try {
    const data = await fetchDeezerDirect(`/chart/0/artists?limit=${limit}`);
    if (data && Array.isArray(data.data)) {
      return data.data.map((item: any) => ({
        id: item.id,
        name: item.name,
        picture: item.picture_medium || item.picture_big || item.picture,
        tracklist: item.tracklist,
        nb_fan: item.nb_fan,
      }));
    }
  } catch (err) {
    console.warn('[ChartsApi] Failed to fetch top artists:', err);
  }

  return [];
}

export function rankArtists(artists: any[], query: string): any[] {
  if (!query.trim() || !artists.length) return artists;
  const cleanQ = query.trim().toLowerCase();
  const alphaQ = cleanQ.replace(/[^a-z0-9]/g, '');
  const qWords = cleanQ.split(/\s+/).filter((w) => w.length > 1);

  return [...artists].sort((a, b) => {
    const scoreArtist = (item: any) => {
      let score = 0;
      const name = (item.name || '').toLowerCase().trim();
      const cleanName = name.replace(/[^a-z0-9]/g, '');
      const fans = typeof item.nb_fan === 'number' ? item.nb_fan : 0;

      // 1. Popularity component: logarithmic scale
      // 10M fans = ~245 pts, 7.7M fans = ~241 pts, 1M fans = ~210 pts, 10k fans = ~140 pts, 9 fans = ~33 pts
      score += Math.log10(Math.max(1, fans)) * 35;

      // 2. Exact match bonus
      if (name === cleanQ || (alphaQ.length > 2 && cleanName === alphaQ)) {
        score += 200;
      } else if (name.startsWith(cleanQ) || (alphaQ.length > 2 && cleanName.startsWith(alphaQ))) {
        score += 120;
      } else if (name.includes(cleanQ) || (alphaQ.length > 2 && cleanName.includes(alphaQ))) {
        score += 60;
      }

      // 3. Keyword/word-level matches
      for (const w of qWords) {
        if (name.includes(w)) score += 20;
      }

      return score;
    };

    return scoreArtist(b) - scoreArtist(a);
  });
}

export async function searchArtists(query: string, limit = 5): Promise<any[]> {
  if (!query.trim()) return [];

  const fetchLimit = Math.max(limit, 10);
  let artists: any[] = [];

  // 1. Try backend proxy
  try {
    const res = await fetch(
      getApiUrl(`/api/charts/search/artist?q=${encodeURIComponent(query)}&limit=${fetchLimit}`),
      { signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      const json = await res.json();
      if (json.data && Array.isArray(json.data) && json.data.length > 0) {
        artists = json.data;
      }
    }
  } catch (err) {
    console.debug('[ChartsApi] Proxy artist search failed, trying direct Deezer:', err);
  }

  // 2. Direct Deezer fallback
  if (artists.length === 0) {
    try {
      const data = await fetchDeezerDirect(
        `/search/artist?q=${encodeURIComponent(query)}&limit=${fetchLimit}`
      );
      if (data && Array.isArray(data.data)) {
        artists = data.data;
      }
    } catch (err) {
      console.warn('[ChartsApi] Direct artist search failed:', err);
    }
  }

  if (artists.length > 0) {
    return rankArtists(artists, query).slice(0, limit);
  }

  return [];
}

export async function fetchArtistDetails(artistId: number): Promise<any> {
  // 1. Try backend proxy
  try {
    const res = await fetch(getApiUrl(`/api/charts/artist/${artistId}`), {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.debug(`[ChartsApi] Proxy artist ${artistId} details failed, trying direct:`, err);
  }

  // 2. Direct Deezer fallback
  try {
    return await fetchDeezerDirect(`/artist/${artistId}`);
  } catch (err) {
    console.warn(`[ChartsApi] Failed to fetch artist ${artistId} details:`, err);
    return null;
  }
}

export async function fetchArtistTopTracks(artistId: number, limit = 30): Promise<Track[]> {
  // 1. Try backend proxy
  try {
    const res = await fetch(getApiUrl(`/api/charts/artist/${artistId}/top?limit=${limit}`), {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data && Array.isArray(json.data) && json.data.length > 0) {
        return json.data.map(formatChartTrack);
      }
    }
  } catch (err) {
    console.debug(`[ChartsApi] Proxy artist ${artistId} top tracks failed, trying direct:`, err);
  }

  // 2. Direct Deezer fallback
  try {
    const data = await fetchDeezerDirect(`/artist/${artistId}/top?limit=${limit}`);
    if (data && Array.isArray(data.data)) {
      return data.data.map(formatChartTrack);
    }
  } catch (err) {
    console.warn(`[ChartsApi] Failed to fetch artist ${artistId} top tracks:`, err);
  }

  return [];
}

export async function fetchArtistAlbums(artistId: number, limit = 25): Promise<any[]> {
  // 1. Try backend proxy
  try {
    const res = await fetch(getApiUrl(`/api/charts/artist/${artistId}/albums?limit=${limit}`), {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data && Array.isArray(json.data) && json.data.length > 0) {
        return json.data;
      }
    }
  } catch (err) {
    console.debug(`[ChartsApi] Proxy artist ${artistId} albums failed, trying direct:`, err);
  }

  // 2. Direct Deezer fallback
  try {
    const data = await fetchDeezerDirect(`/artist/${artistId}/albums?limit=${limit}`);
    if (data && Array.isArray(data.data)) {
      return data.data;
    }
  } catch (err) {
    console.warn(`[ChartsApi] Failed to fetch artist ${artistId} albums:`, err);
  }

  return [];
}

export async function fetchArtistRelated(artistId: number, limit = 15): Promise<any[]> {
  // 1. Try backend proxy
  try {
    const res = await fetch(getApiUrl(`/api/charts/artist/${artistId}/related?limit=${limit}`), {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data && Array.isArray(json.data) && json.data.length > 0) {
        return json.data;
      }
    }
  } catch (err) {
    console.debug(`[ChartsApi] Proxy artist ${artistId} related failed, trying direct:`, err);
  }

  // 2. Direct Deezer fallback
  try {
    const data = await fetchDeezerDirect(`/artist/${artistId}/related?limit=${limit}`);
    if (data && Array.isArray(data.data)) {
      return data.data;
    }
  } catch (err) {
    console.warn(`[ChartsApi] Failed to fetch artist ${artistId} related artists:`, err);
  }

  return [];
}

export async function fetchAlbumTracks(
  albumId: number,
  albumTitle = 'Album',
  coverUrl = ''
): Promise<Track[]> {
  let rawTracks: any[] = [];

  // 1. Try backend proxy
  try {
    const res = await fetch(getApiUrl(`/api/charts/album/${albumId}/tracks`), {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.data && Array.isArray(json.data)) {
        rawTracks = json.data;
      }
    }
  } catch (err) {
    console.debug(`[ChartsApi] Proxy album ${albumId} tracks failed, trying direct:`, err);
  }

  // 2. Direct Deezer fallback
  if (rawTracks.length === 0) {
    try {
      const data = await fetchDeezerDirect(`/album/${albumId}/tracks?limit=50`);
      if (data && Array.isArray(data.data)) {
        rawTracks = data.data;
      }
    } catch (err) {
      console.warn(`[ChartsApi] Failed to fetch album ${albumId} tracks:`, err);
    }
  }

  return rawTracks.map((item) => {
    const artistName = item.artist?.name || 'Unknown Artist';
    const trackTitle = item.title || 'Untitled Track';
    const preview = item.preview || '';

    const expectedDuration = item.duration || 210;
    const streamUrl = getApiUrl(
      `/api/stream/track?artist=${encodeURIComponent(artistName)}&title=${encodeURIComponent(
        trackTitle
      )}&id=${item.id}&duration=${expectedDuration}`
    );

    return {
      id: `charts:${item.id}`,
      source: 'charts',
      title: trackTitle,
      artist: artistName,
      album: albumTitle,
      duration: item.duration || 210,
      streamUrl,
      artworkUrl: getTrackArtwork({
        artist: artistName,
        title: trackTitle,
        artworkUrl:
          coverUrl ||
          item.album?.cover_big ||
          item.album?.cover_medium ||
          DEFAULT_MUSIC_ARTWORK,
      }),
      sourceMetadata: {
        format: 'mp3',
        license: 'Commercial Streaming / YouTube Audio Stream',
        previewUrl: preview || undefined,
      },
    };
  });
}

export async function searchCharts(query: string, limit = 30): Promise<Track[]> {
  if (!query.trim()) return [];

  // 1. Try backend proxy
  try {
    const res = await fetch(
      getApiUrl(`/api/charts/search?q=${encodeURIComponent(query)}&limit=${limit}`),
      { signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      const json = await res.json();
      if (json.data && Array.isArray(json.data) && json.data.length > 0) {
        return json.data.map(formatChartTrack);
      }
    }
  } catch (err) {
    console.debug('[ChartsApi] Proxy search failed, trying direct Deezer:', err);
  }

  // 2. Direct Deezer fallback
  try {
    const data = await fetchDeezerDirect(
      `/search?q=${encodeURIComponent(query)}&limit=${limit}`
    );
    if (data && Array.isArray(data.data)) {
      return data.data.map(formatChartTrack);
    }
  } catch (err) {
    console.warn('[ChartsApi] Direct search failed:', err);
  }

  return [];
}

export interface SearchAlbum {
  id: number;
  title: string;
  cover: string;
  artist: string;
  recordType?: string;
  nb_tracks?: number;
}

export async function searchAlbums(query: string, limit = 12): Promise<SearchAlbum[]> {
  if (!query.trim()) return [];

  // 1. Try backend proxy
  try {
    const res = await fetch(
      getApiUrl(`/api/charts/search/album?q=${encodeURIComponent(query)}&limit=${limit}`),
      { signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      const json = await res.json();
      if (json.data && Array.isArray(json.data) && json.data.length > 0) {
        return json.data.map((item: any) => ({
          id: item.id,
          title: item.title,
          cover: item.cover_big || item.cover_medium || item.cover,
          artist: item.artist?.name || 'Unknown Artist',
          recordType: item.record_type || 'album',
          nb_tracks: item.nb_tracks,
        }));
      }
    }
  } catch (err) {
    console.debug('[ChartsApi] Proxy album search failed, trying direct Deezer:', err);
  }

  // 2. Direct Deezer fallback
  try {
    const data = await fetchDeezerDirect(`/search/album?q=${encodeURIComponent(query)}&limit=${limit}`);
    if (data && Array.isArray(data.data)) {
      return data.data.map((item: any) => ({
        id: item.id,
        title: item.title,
        cover: item.cover_big || item.cover_medium || item.cover,
        artist: item.artist?.name || 'Unknown Artist',
        recordType: item.record_type || 'album',
        nb_tracks: item.nb_tracks,
      }));
    }
  } catch (err) {
    console.warn('[ChartsApi] Direct album search failed:', err);
  }

  return [];
}

export function formatChartTrack(item: any): Track {
  const artistName = item.artist?.name || 'Unknown Artist';
  const trackTitle = item.title || 'Untitled Track';
  const expectedDuration = item.duration || 210;
  const streamUrl = getApiUrl(
    `/api/stream/track?artist=${encodeURIComponent(artistName)}&title=${encodeURIComponent(
      trackTitle
    )}&id=${item.id}&duration=${expectedDuration}`
  );

  const rawArtwork =
    item.album?.cover_big ||
    item.album?.cover_medium ||
    item.artist?.picture_medium ||
    DEFAULT_MUSIC_ARTWORK;

  const artwork = getTrackArtwork({
    artist: artistName,
    title: trackTitle,
    artworkUrl: rawArtwork,
  });

  return {
    id: `charts:${item.id}`,
    source: 'charts',
    title: trackTitle,
    artist: artistName,
    album: item.album?.title || 'Single',
    duration: item.duration || 210,
    streamUrl,
    artworkUrl: artwork,
    sourceMetadata: {
      format: 'mp3',
      license: 'Commercial Streaming / YouTube Audio Stream',
      previewUrl: item.preview || undefined,
    },
  };
}
