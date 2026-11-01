import { Track } from '../types/track';
import { safeStorage } from '../utils/storage';

export interface LyricWord {
  text: string;
  startTime: number; // in seconds
  endTime?: number;
}

export interface LyricLine {
  id: string;
  time: number; // in seconds
  endTime: number; // in seconds
  text: string;
  words?: LyricWord[];
  isInstrumental?: boolean;
}

export interface LyricsData {
  trackId: string;
  title: string;
  artist: string;
  source: 'lrclib' | 'gemini' | 'algorithmic' | 'plain';
  synced: boolean;
  lines: LyricLine[];
  plainLyrics?: string;
  instrumental?: boolean;
  timestamp: number;
}

const LRCLIB_BASE_URL = 'https://lrclib.net/api';
const CACHE_PREFIX = 'dotify_lyrics_cache_';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/**
 * Clean artist and title of video clutter, suffixes, and noise.
 */
export function cleanTrackMetadata(title: string, artist: string): { cleanTitle: string; cleanArtist: string } {
  let cleanTitle = (title || '')
    .replace(/[\(\[](?:[^\)\]]*(?:official|video|audio|lyric|hd|4k|remaster|visualizer)[^\)\]]*)[\)\]]/gi, '')
    .replace(/\s*ft\.?.*$/i, '')
    .replace(/\s*feat\.?.*$/i, '')
    .replace(/\s*-\s*official\s*video.*$/i, '')
    .replace(/\s*-\s*topic$/i, '')
    .trim();

  let cleanArtist = (artist || '')
    .replace(/\s*-\s*topic$/i, '')
    .replace(/,.*$/, '') // take primary artist if comma-separated
    .replace(/\s+x\s+.*$/i, '')
    .trim();

  return { cleanTitle, cleanArtist };
}

/**
 * Parses standard LRC strings:
 * [mm:ss.xx]Line of lyric
 * Multiple timestamps: [00:12.34][00:45.67]Line
 */
export function parseLrc(lrcText: string, trackDuration?: number): LyricLine[] {
  if (!lrcText || typeof lrcText !== 'string') return [];

  const lines = lrcText.split(/\r?\n/);
  const timeTagRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  const parsedItems: { time: number; text: string }[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Skip metadata headers like [ti:Title], [ar:Artist], etc.
    if (/^\[(ti|ar|al|by|offset|length|re|ve):/i.test(trimmed)) {
      continue;
    }

    // Find all time tags in this line
    const matches = Array.from(trimmed.matchAll(timeTagRegex));
    if (matches.length === 0) continue;

    // Strip all time tags to get the pure lyric text
    const cleanText = trimmed.replace(timeTagRegex, '').trim();

    for (const match of matches) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const fracStr = match[3] || '0';
      const fraction = fracStr.length === 3 ? parseInt(fracStr, 10) / 1000 : parseInt(fracStr, 10) / 100;
      const totalSeconds = minutes * 60 + seconds + fraction;

      parsedItems.push({
        time: Math.round(totalSeconds * 100) / 100,
        text: cleanText,
      });
    }
  }

  // Sort chronologically
  parsedItems.sort((a, b) => a.time - b.time);

  // Group and assign endTimes & detect instrumental gaps
  const result: LyricLine[] = [];
  const total = parsedItems.length;

  for (let i = 0; i < total; i++) {
    const current = parsedItems[i];
    const next = parsedItems[i + 1];

    let endTime: number;
    if (next) {
      endTime = next.time;
    } else if (trackDuration && trackDuration > current.time) {
      endTime = Math.min(current.time + 6, trackDuration);
    } else {
      endTime = current.time + 5;
    }

    const isInstrumental = current.text.length === 0;

    result.push({
      id: `line_${i}_${Math.round(current.time * 100)}`,
      time: current.time,
      endTime,
      text: current.text,
      isInstrumental,
    });
  }

  return result;
}

/**
 * Algorithmic Temporal Alignment Engine:
 * When only plain lyrics exist, distributes lines proportionally according to
 * musical phrasing, syllable length, verse/chorus cadence, and track duration.
 */
export function alignPlainLyrics(plainText: string, trackDuration: number = 210): LyricLine[] {
  if (!plainText || typeof plainText !== 'string') return [];

  const rawLines = plainText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\[.*\]$/.test(l)); // filter section markers like [Chorus]

  if (rawLines.length === 0) return [];

  // Musical heuristics:
  // Typical pop/rock/indie song intro is ~8% to 14% of track duration (capped between 6s and 25s)
  const introDuration = Math.min(Math.max(trackDuration * 0.09, 8), 24);
  // Outro breathing room
  const outroDuration = Math.min(Math.max(trackDuration * 0.06, 6), 18);
  const singingWindow = Math.max(trackDuration - introDuration - outroDuration, 30);

  // Calculate weights based on character/word count
  const weights = rawLines.map((line) => {
    const words = line.split(/\s+/).length;
    return Math.max(words * 0.6 + line.length * 0.05, 1.2);
  });

  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  let currentTime = introDuration;
  const result: LyricLine[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const lineWeight = weights[i];
    const durationShare = (lineWeight / totalWeight) * singingWindow;
    const lineDuration = Math.max(durationShare, 2.2);

    result.push({
      id: `aligned_line_${i}`,
      time: Math.round(currentTime * 100) / 100,
      endTime: Math.round((currentTime + lineDuration) * 100) / 100,
      text: rawLines[i],
      isInstrumental: false,
    });

    currentTime += lineDuration;
  }

  return result;
}

export class LyricsService {
  private static instance: LyricsService;
  private memoryCache: Map<string, LyricsData> = new Map();
  private inFlightRequests: Map<string, Promise<LyricsData | null>> = new Map();

  public static getInstance(): LyricsService {
    if (!LyricsService.instance) {
      LyricsService.instance = new LyricsService();
    }
    return LyricsService.instance;
  }

  /**
   * Generates a stable cache key for a track.
   */
  public getCacheKey(track: Track): string {
    const { cleanTitle, cleanArtist } = cleanTrackMetadata(track.title, track.artist);
    return `${cleanArtist.toLowerCase()}:::${cleanTitle.toLowerCase()}`;
  }

  /**
   * Checks in-memory and persistent storage cache.
   */
  public getCachedLyrics(track: Track): LyricsData | null {
    const key = this.getCacheKey(track);
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key)!;
    }

    try {
      const stored = safeStorage.getItem<LyricsData | null>(`${CACHE_PREFIX}${key}`, null);
      if (stored && Date.now() - (stored.timestamp || 0) < CACHE_TTL_MS) {
        this.memoryCache.set(key, stored);
        return stored;
      }
    } catch {
      // Storage error ignored
    }
    return null;
  }

  /**
   * Saves lyrics to cache.
   */
  public setCachedLyrics(track: Track, data: LyricsData): void {
    const key = this.getCacheKey(track);
    this.memoryCache.set(key, data);
    try {
      safeStorage.setItem(`${CACHE_PREFIX}${key}`, data);
    } catch {
      // Storage error ignored
    }
  }

  /**
   * Main entry point: Fetches tracked lyrics with multi-tiered fallback.
   */
  public async getLyrics(track: Track | null): Promise<LyricsData | null> {
    if (!track || !track.title) return null;

    // Check cache first
    const cached = this.getCachedLyrics(track);
    if (cached) {
      return cached;
    }

    const key = this.getCacheKey(track);
    if (this.inFlightRequests.has(key)) {
      return this.inFlightRequests.get(key)!;
    }

    const promise = this.fetchLyricsPipeline(track).finally(() => {
      this.inFlightRequests.delete(key);
    });

    this.inFlightRequests.set(key, promise);
    return promise;
  }

  private async fetchLyricsPipeline(track: Track): Promise<LyricsData | null> {
    const { cleanTitle, cleanArtist } = cleanTrackMetadata(track.title, track.artist);
    const duration = track.duration && isFinite(track.duration) && track.duration > 0 ? track.duration : undefined;

    // ----------------------------------------------------
    // Tier 1: Direct LRCLIB /api/get
    // ----------------------------------------------------
    try {
      const getParams = new URLSearchParams({
        artist_name: cleanArtist,
        track_name: cleanTitle,
      });
      if (duration) {
        getParams.append('duration', String(Math.round(duration)));
      }

      const res = await fetch(`${LRCLIB_BASE_URL}/get?${getParams.toString()}`, {
        headers: { 'User-Agent': 'DotifyMusic/1.0 (https://github.com/Mors1A4/dotify-releases)' },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.instrumental) {
          const instrumentalData: LyricsData = {
            trackId: track.id,
            title: track.title,
            artist: track.artist,
            source: 'lrclib',
            synced: true,
            instrumental: true,
            lines: [],
            plainLyrics: '♪ Instrumental Track ♪',
            timestamp: Date.now(),
          };
          this.setCachedLyrics(track, instrumentalData);
          return instrumentalData;
        }

        if (data.syncedLyrics) {
          const lines = parseLrc(data.syncedLyrics, duration);
          if (lines.length > 0) {
            const lyricsData: LyricsData = {
              trackId: track.id,
              title: track.title,
              artist: track.artist,
              source: 'lrclib',
              synced: true,
              lines,
              plainLyrics: data.plainLyrics || undefined,
              timestamp: Date.now(),
            };
            this.setCachedLyrics(track, lyricsData);
            return lyricsData;
          }
        } else if (data.plainLyrics) {
          // Plain lyrics returned from /get: align using algorithmic engine
          const lines = alignPlainLyrics(data.plainLyrics, duration || 210);
          const lyricsData: LyricsData = {
            trackId: track.id,
            title: track.title,
            artist: track.artist,
            source: 'algorithmic',
            synced: true,
            lines,
            plainLyrics: data.plainLyrics,
            timestamp: Date.now(),
          };
          this.setCachedLyrics(track, lyricsData);
          return lyricsData;
        }
      }
    } catch (e: any) {
      console.warn('[LyricsService] LRCLIB /get failed, attempting search fallback:', e?.message || e);
    }

    // ----------------------------------------------------
    // Tier 1b: LRCLIB /api/search fallback
    // ----------------------------------------------------
    try {
      const query = `${cleanArtist} ${cleanTitle}`.trim();
      const sParams = new URLSearchParams({ q: query });
      const searchRes = await fetch(`${LRCLIB_BASE_URL}/search?${sParams.toString()}`, {
        headers: { 'User-Agent': 'DotifyMusic/1.0 (https://github.com/Mors1A4/dotify-releases)' },
      });

      if (searchRes.ok) {
        const searchList = await searchRes.json();
        if (Array.isArray(searchList) && searchList.length > 0) {
          // Prefer entries with syncedLyrics and closest duration
          const syncedEntries = searchList.filter((item) => Boolean(item.syncedLyrics) && !item.instrumental);
          let best = syncedEntries[0];

          if (duration && syncedEntries.length > 1) {
            syncedEntries.sort((a, b) => {
              const diffA = Math.abs((a.duration || 0) - duration);
              const diffB = Math.abs((b.duration || 0) - duration);
              return diffA - diffB;
            });
            best = syncedEntries[0];
          }

          if (best && best.syncedLyrics) {
            const lines = parseLrc(best.syncedLyrics, duration || best.duration);
            if (lines.length > 0) {
              const lyricsData: LyricsData = {
                trackId: track.id,
                title: track.title,
                artist: track.artist,
                source: 'lrclib',
                synced: true,
                lines,
                plainLyrics: best.plainLyrics || undefined,
                timestamp: Date.now(),
              };
              this.setCachedLyrics(track, lyricsData);
              return lyricsData;
            }
          }

          // Plain lyrics match from search list
          const plainEntry = searchList.find((item) => Boolean(item.plainLyrics) && !item.instrumental);
          if (plainEntry && plainEntry.plainLyrics) {
            const lines = alignPlainLyrics(plainEntry.plainLyrics, duration || plainEntry.duration || 210);
            const lyricsData: LyricsData = {
              trackId: track.id,
              title: track.title,
              artist: track.artist,
              source: 'algorithmic',
              synced: true,
              lines,
              plainLyrics: plainEntry.plainLyrics,
              timestamp: Date.now(),
            };
            this.setCachedLyrics(track, lyricsData);
            return lyricsData;
          }
        }
      }
    } catch (e: any) {
      console.warn('[LyricsService] LRCLIB /search failed:', e?.message || e);
    }

    // ----------------------------------------------------
    // Tier 3: Gemini 3.8 Flash AI Synthesis (when user configured key)
    // ----------------------------------------------------
    try {
      const userGeminiKey =
        safeStorage.getItem<string>('gemini_api_key', '') ||
        safeStorage.getItem<string>('dotify_gemini_api_key', '');

      if (userGeminiKey && userGeminiKey.trim().length > 15) {
        const aiLyrics = await this.synthesizeWithGemini(cleanTitle, cleanArtist, duration || 210, userGeminiKey.trim());
        if (aiLyrics && aiLyrics.lines.length > 0) {
          const lyricsData: LyricsData = {
            trackId: track.id,
            title: track.title,
            artist: track.artist,
            source: 'gemini',
            synced: true,
            lines: aiLyrics.lines,
            plainLyrics: aiLyrics.plain,
            timestamp: Date.now(),
          };
          this.setCachedLyrics(track, lyricsData);
          return lyricsData;
        }
      }
    } catch (e: any) {
      console.warn('[LyricsService] Gemini AI fallback failed:', e?.message || e);
    }

    return null;
  }

  private async synthesizeWithGemini(
    title: string,
    artist: string,
    duration: number,
    apiKey: string
  ): Promise<{ lines: LyricLine[]; plain: string } | null> {
    const prompt = `You are an expert audio lyrics transcriber and timing synchronizer.
Generate synchronized LRC format lyrics for the song "${title}" by "${artist}".
The track length is approximately ${Math.round(duration)} seconds.
Output ONLY valid LRC format lines, for example:
[00:15.50]First line of lyrics
[00:19.20]Second line of lyrics
Do not output markdown code blocks, explanations, or commentary. Only raw LRC text.`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return null;
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('\n') || '';
    const cleanLrc = text.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
    const lines = parseLrc(cleanLrc, duration);
    if (lines.length > 0) {
      return { lines, plain: lines.map((l) => l.text).join('\n') };
    }
    return null;
  }
}

export const lyricsService = LyricsService.getInstance();
