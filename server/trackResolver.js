import ytSearch from 'yt-search';
import { handleStreamProxy } from './streamProxy.js';
import { findLocalTrack } from './mp3SyncHub.js';

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
    const queries = [];
    const full = `${artist || ''} ${title || ''}`.trim();
    if (full) queries.push(full);
    if (title && title.trim() && title.trim() !== full) queries.push(title.trim());

    for (const qStr of queries) {
      const res = await fetch(
        `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(qStr)}&app_name=dotify`,
        {
          headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
          signal: AbortSignal.timeout(3500),
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const tracks = data.data || [];
      if (tracks.length === 0) continue;

      let bestTrack = tracks[0];
      if (expectedDurationSec > 0) {
        const match = tracks.find((t) => t.duration && Math.abs(t.duration - expectedDurationSec) < 35);
        if (match) bestTrack = match;
      }

      if (bestTrack && bestTrack.id) {
        return `https://discoveryprovider.audius.co/v1/tracks/${bestTrack.id}/stream?app_name=dotify`;
      }
    }
  } catch (err) {
    console.debug('[TrackResolver] Audius stream lookup deferred:', err.message);
  }
  return null;
}

async function resolveAudioStreamUrl(cacheKey, artist, title, id, expectedDurationSec, forceRefresh = false) {
  if (forceRefresh) {
    streamCache.delete(cacheKey);
  } else {
    const cached = streamCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.url;
    }
  }

  // 1. Check local MP3 Vault for full verified file
  const localMatch = findLocalTrack({ artist, title, id });
  if (localMatch) {
    const localUrl = `/api/mp3s/file/${encodeURIComponent(localMatch.id)}`;
    streamCache.set(cacheKey, { url: localUrl, timestamp: Date.now() });
    return localUrl;
  }

  // 2. Attempt resolution from Audius full-length stream catalogue
  const audiusUrl = await resolveAudiusStream(artist, title, expectedDurationSec);
  if (audiusUrl) {
    streamCache.set(cacheKey, { url: audiusUrl, timestamp: Date.now() });
    return audiusUrl;
  }

  return null;
}

/**
 * Handle audio resolution and streaming for any artist or track.
 * Supports MP3 vault retrieval and full-length Audius stream proxying.
 * Never silently truncates playback to 29-second preview clips.
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
    allowPreview = 'false',
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

  const attachUpstreamRecovery = () => {
    req.onUpstreamError = async (statusCode) => {
      console.warn(
        `[TrackResolver] Upstream returned ${statusCode} for "${cacheKey}", re-resolving fresh stream...`
      );
      streamCache.delete(cacheKey);
      try {
        const freshUrl = await resolveAudioStreamUrl(
          cacheKey,
          artist,
          title,
          id,
          expectedDurationSec,
          true
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
      artist,
      title,
      id,
      expectedDurationSec,
      _retry === '1'
    );

    if (cleanUrl) {
      if (isPreload) {
        return res.json({ cached: true, key: cacheKey });
      }
      req.query.url = cleanUrl;
      attachUpstreamRecovery();
      return handleStreamProxy(req, res);
    }

    // Only stream preview if explicitly requested via allowPreview=true
    if (preview && allowPreview === 'true') {
      if (isPreload) return res.json({ cached: false, fallback: true });
      res.setHeader('X-Dotify-Preview-Fallback', 'true');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      req.query.url = preview;
      return handleStreamProxy(req, res);
    }

    if (isPreload) return res.json({ cached: false });
    return res.status(404).json({ error: 'Full-length track audio stream not found' });
  } catch (err) {
    console.warn(`[TrackResolver] Audio resolution failed for "${artist} - ${title}":`, err.message);
    if (preview && allowPreview === 'true') {
      if (isPreload) return res.json({ cached: false, fallback: true });
      res.setHeader('X-Dotify-Preview-Fallback', 'true');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      req.query.url = preview;
      return handleStreamProxy(req, res);
    }
    return res.status(502).json({ error: 'Audio resolution error', message: err.message });
  }
}
