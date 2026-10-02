import ytSearch from 'yt-search';
import { handleStreamProxy } from './streamProxy.js';

// In-memory cache for resolved stream URLs (4-hour TTL)
const streamCache = new Map();
const pendingResolutions = new Map();
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * YouTube candidate helper
 */
export async function searchYouTubeVideos(query) {
  try {
    const res = await ytSearch(query);
    return res?.videos || [];
  } catch {
    return [];
  }
}

export async function resolveAudiusStream(artist, title, expectedDurationSec = 0) {
  try {
    const qStr = `${artist || ''} ${title || ''}`.trim();
    if (!qStr) return null;
    const res = await fetch(
      `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(qStr)}&app_name=dotify`,
      {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
        signal: AbortSignal.timeout(3500),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const tracks = data.data || [];
    if (tracks.length === 0) return null;

    let bestTrack = tracks[0];
    if (expectedDurationSec > 0) {
      const match = tracks.find((t) => t.duration && Math.abs(t.duration - expectedDurationSec) < 35);
      if (match) bestTrack = match;
    }

    if (bestTrack && bestTrack.id) {
      return `https://discoveryprovider.audius.co/v1/tracks/${bestTrack.id}/stream?app_name=dotify`;
    }
  } catch (err) {
    console.debug('[TrackResolver] Audius stream lookup deferred:', err.message);
  }
  return null;
}

async function resolveAudioStreamUrl(cacheKey, searchWords, expectedDurationSec, forceRefresh = false) {
  if (forceRefresh) {
    streamCache.delete(cacheKey);
  } else {
    const cached = streamCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.url;
    }
  }

  // Attempt resolution from Audius full-length stream catalogue
  const words = searchWords || '';
  const audiusUrl = await resolveAudiusStream(words, '', expectedDurationSec);
  if (audiusUrl) {
    streamCache.set(cacheKey, { url: audiusUrl, timestamp: Date.now() });
    return audiusUrl;
  }

  return null;
}

/**
 * Handle audio resolution and streaming for any artist or track.
 * Supports on-demand YouTube audio stream extraction with range request streaming
 * and automatic re-resolution if a cached upstream URL expires.
 */
export async function handleTrackStream(req, res) {
  let {
    artist = '',
    title = '',
    preview = '',
    id = '',
    q = '',
    query: rawQuery = '',
    duration = '',
    _retry = '',
  } = req.query;

  if (!artist && !title && !preview && !q && !rawQuery) {
    return res.status(400).json({ error: 'Missing track parameters' });
  }

  const { preload = '' } = req.query;
  const isPreload = preload === 'true';
  const searchWords = (rawQuery || q || `${artist} ${title}`).trim();
  const cacheKey = searchWords.toLowerCase() || `id_${id}`;
  const expectedDurationSec = Number(duration) || 0;

  if (_retry === '1') {
    streamCache.delete(cacheKey);
  }

  if (!preview && (artist || title || rawQuery || q)) {
    try {
      const qStr = (searchWords || `${artist} ${title}`).trim();
      const dRes = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(qStr)}&limit=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
        signal: AbortSignal.timeout(2500),
      });
      if (dRes.ok) {
        const dData = await dRes.json();
        if (dData?.data?.[0]?.preview) {
          preview = dData.data[0].preview;
        }
      }
    } catch {}
  }

  const attachUpstreamRecovery = () => {
    req.onUpstreamError = async (statusCode) => {
      console.warn(
        `[TrackResolver] Upstream returned ${statusCode} for "${cacheKey}", re-resolving fresh stream...`
      );
      streamCache.delete(cacheKey);
      try {
        const freshUrl = await resolveAudioStreamUrl(
          cacheKey,
          searchWords,
          expectedDurationSec,
          true,
          false
        );
        if (freshUrl) {
          req.query.url = freshUrl;
          return handleStreamProxy(req, res);
        }
      } catch (reErr) {
        console.warn(`[TrackResolver] Re-resolution failed for "${cacheKey}":`, reErr.message);
      }
      if (!res.headersSent) {
        return res.status(502).json({ error: 'Upstream stream error', upstreamStatus: statusCode });
      }
    };
  };

  const cached = streamCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    if (isPreload) {
      return res.json({ cached: true, key: cacheKey });
    }
    req.query.url = cached.url;
    attachUpstreamRecovery();
    return handleStreamProxy(req, res);
  }

  try {
    const cleanUrl = await resolveAudioStreamUrl(
      cacheKey,
      searchWords,
      expectedDurationSec,
      _retry === '1',
      isPreload
    );

    if (cleanUrl) {
      if (isPreload) {
        return res.json({ cached: true, key: cacheKey });
      }
      req.query.url = cleanUrl;
      attachUpstreamRecovery();
      return handleStreamProxy(req, res);
    }

    if (preview) {
      if (isPreload) return res.json({ cached: false, fallback: true });
      res.setHeader('X-Dotify-Preview-Fallback', 'true');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      req.query.url = preview;
      return handleStreamProxy(req, res);
    }

    if (isPreload) return res.json({ cached: false });
    return res.status(404).json({ error: 'Track audio stream not found' });
  } catch (err) {
    console.warn(`[TrackResolver] Audio extraction failed for "${artist} - ${title}":`, err.message);
    if (preview) {
      if (isPreload) return res.json({ cached: false, fallback: true });
      res.setHeader('X-Dotify-Preview-Fallback', 'true');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      req.query.url = preview;
      return handleStreamProxy(req, res);
    }
    return res.status(502).json({ error: 'Audio resolution error', message: err.message });
  }
}
