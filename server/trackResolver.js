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

async function resolveAudioStreamUrl() {
  // Direct extraction deprecated in favor of client-side hidden YouTube iframe bridge
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

    if (isPreload) return res.json({ cached: false });
    return res.status(404).json({ error: 'Track audio stream not found' });
  } catch (err) {
    console.warn(`[TrackResolver] Audio extraction failed for "${artist} - ${title}":`, err.message);
    if (isPreload) return res.json({ cached: false });
    return res.status(502).json({ error: 'Audio resolution error', message: err.message });
  }
}
