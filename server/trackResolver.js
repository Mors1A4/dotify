import ytSearch from 'yt-search';
import youtubedl from 'youtube-dl-exec';
import { handleStreamProxy } from './streamProxy.js';

// In-memory cache for resolved stream URLs (4-hour TTL)
const streamCache = new Map();
const pendingResolutions = new Map();
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

// Restrict format selection to direct HTTP(S) audio/video streams (never HLS .m3u8 or DASH manifests)
const DIRECT_AUDIO_FORMAT =
  '140/251/250/249/139/ba[ext=m4a][protocol^=http][protocol!*=m3u8][protocol!*=dash]/ba[protocol^=http][protocol!*=m3u8][protocol!*=dash]/b[ext=mp4][protocol^=http][protocol!*=m3u8][protocol!*=dash]/b[protocol^=http][protocol!*=m3u8][protocol!*=dash]';

// Priority concurrency limiter for yt-dlp processes so active playback never queues behind preloads
const MAX_CONCURRENT_EXTRACTIONS = 2;
let activeExtractions = 0;
const highPriorityQueue = [];
const lowPriorityQueue = [];

function acquireExtractionSlot(isPreload = false) {
  if (activeExtractions < MAX_CONCURRENT_EXTRACTIONS) {
    activeExtractions++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    if (isPreload) {
      lowPriorityQueue.push(resolve);
    } else {
      highPriorityQueue.push(resolve);
    }
  });
}

function releaseExtractionSlot() {
  const next = highPriorityQueue.shift() || lowPriorityQueue.shift();
  if (next) {
    next();
  } else {
    activeExtractions = Math.max(0, activeExtractions - 1);
  }
}

/**
 * Pick the best matching full-length YouTube video candidates from search results,
 * avoiding <45s/60s Shorts/teasers and prioritizing Topic/Official Audio uploads.
 */
function selectBestCandidates(videos, expectedDurationSec = 0) {
  if (!Array.isArray(videos) || videos.length === 0) return [];

  const minFullTrackSec =
    expectedDurationSec > 60 ? Math.max(45, Math.min(60, expectedDurationSec - 15)) : 45;
  const maxFullTrackSec =
    expectedDurationSec > 0 ? Math.max(expectedDurationSec * 2.5, 600) : 900;

  const validLengthVideos = videos.filter(
    (v) => v?.url && v.seconds >= minFullTrackSec && v.seconds <= maxFullTrackSec
  );
  const fallbackVideos = videos.filter(
    (v) => v?.url && (!v.seconds || v.seconds >= minFullTrackSec)
  );

  const pool = validLengthVideos.length > 0 ? validLengthVideos : fallbackVideos;
  if (pool.length === 0) return [];

  const scored = pool.slice(0, 10).map((v, idx) => {
    let score = 100 - idx * 4;
    const titleLower = String(v.title || '').toLowerCase();
    const authorLower = String(v.author?.name || '').toLowerCase();
    const descLower = String(v.description || '').toLowerCase();

    if (authorLower.endsWith('- topic') || descLower.includes('provided to youtube by')) {
      score += 35;
    }
    if (titleLower.includes('official audio') || titleLower.includes('(audio)')) {
      score += 30;
    } else if (titleLower.includes('lyric') || titleLower.includes('visualizer')) {
      score += 18;
    }
    if (
      titleLower.includes('#shorts') ||
      titleLower.includes('teaser') ||
      titleLower.includes('preview') ||
      titleLower.includes('snippet')
    ) {
      score -= 80;
    }

    if (expectedDurationSec > 0 && v.seconds > 0) {
      const diff = Math.abs(v.seconds - expectedDurationSec);
      if (diff <= 5) score += 40;
      else if (diff <= 15) score += 25;
      else if (diff <= 45) score += 10;
      else if (diff > 90) score -= 25;
    }

    return { video: v, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map((s) => s.video);
}

/**
 * Resolve and cache the direct audio stream URL for a search query,
 * deduplicating concurrent requests for the same track.
 */
async function resolveAudioStreamUrl(
  cacheKey,
  searchWords,
  expectedDurationSec,
  forceRefresh = false,
  isPreload = false
) {
  if (forceRefresh) {
    streamCache.delete(cacheKey);
  } else {
    const cached = streamCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.url;
    }
  }

  if (pendingResolutions.has(cacheKey)) {
    return pendingResolutions.get(cacheKey);
  }

  const resolutionPromise = (async () => {
    await acquireExtractionSlot(isPreload);
    try {
      const query = `${searchWords} official audio`.trim();
      const searchRes = await ytSearch(query);
      const candidates = selectBestCandidates(searchRes?.videos, expectedDurationSec);

      for (const video of candidates) {
        if (!video?.url) continue;
        try {
          const audioUrl = await youtubedl(video.url, {
            getUrl: true,
            format: DIRECT_AUDIO_FORMAT,
            noWarnings: true,
            noPlaylist: true,
          });

          const lines = String(audioUrl || '')
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(
              (l) =>
                l.startsWith('http') &&
                !l.includes('.m3u8') &&
                !l.includes('/manifest/')
            );
          const cleanUrl = lines[0];
          if (cleanUrl) {
            streamCache.set(cacheKey, { url: cleanUrl, timestamp: Date.now() });
            return cleanUrl;
          }
        } catch (candidateErr) {
          console.warn(
            `[TrackResolver] Candidate ${video.url} failed, trying next:`,
            candidateErr.message
          );
        }
      }
      return null;
    } finally {
      releaseExtractionSlot();
      pendingResolutions.delete(cacheKey);
    }
  })();

  pendingResolutions.set(cacheKey, resolutionPromise);
  return resolutionPromise;
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
          if (preview) req.query.fallbackUrl = preview;
          return handleStreamProxy(req, res);
        }
      } catch (reErr) {
        console.warn(`[TrackResolver] Re-resolution failed for "${cacheKey}":`, reErr.message);
      }
      if (preview) {
        res.setHeader('X-Dotify-Preview-Fallback', 'true');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        req.query.url = preview;
        return handleStreamProxy(req, res);
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

    return res.status(404).json({ error: 'Track audio stream not found' });
  } catch (err) {
    console.warn(`[TrackResolver] Audio extraction fallback for "${artist} - ${title}":`, err.message);
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
