/**
 * Bad Source Service
 * Tracks and persists blacklisted audio sources (e.g. YouTube video IDs with
 * audio watermarks, promo voice tags, leaker drops, or bad rips).
 */

export interface BadSourceEntry {
  videoId: string;
  artist: string;
  title: string;
  videoTitle?: string;
  reason?: string; // 'audio_watermark' | 'poor_quality' | 'wrong_song' | 'other'
  timestamp: number;
}

const STORAGE_KEY = 'dotify_bad_sources';

class BadSourceService {
  private badSources: Map<string, BadSourceEntry> = new Map();
  private isLoaded = false;

  constructor() {
    this.ensureLoaded();
  }

  private ensureLoaded(): void {
    if (this.isLoaded) return;
    if (typeof localStorage === 'undefined') {
      this.isLoaded = true;
      return;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: BadSourceEntry[] = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.videoId && item.videoId.length === 11) {
              this.badSources.set(item.videoId, item);
            }
          }
        }
      }
    } catch {
      // Storage unavailable or corrupt JSON
    }
    this.isLoaded = true;
  }

  private save(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const arr = Array.from(this.badSources.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch {
      // Storage quota or restriction
    }
  }

  public isBad(videoId?: string | null): boolean {
    if (!videoId) return false;
    this.ensureLoaded();
    return this.badSources.has(videoId);
  }

  public getBadEntry(videoId?: string | null): BadSourceEntry | undefined {
    if (!videoId) return undefined;
    this.ensureLoaded();
    return this.badSources.get(videoId);
  }

  public markBad(entry: {
    videoId: string;
    artist: string;
    title: string;
    videoTitle?: string;
    reason?: string;
  }): void {
    if (!entry.videoId || entry.videoId.length !== 11) return;
    this.ensureLoaded();

    this.badSources.set(entry.videoId, {
      videoId: entry.videoId,
      artist: entry.artist || '',
      title: entry.title || '',
      videoTitle: entry.videoTitle,
      reason: entry.reason || 'audio_watermark',
      timestamp: Date.now(),
    });

    this.save();
  }

  public unmarkBad(videoId: string): void {
    if (!videoId) return;
    this.ensureLoaded();
    if (this.badSources.delete(videoId)) {
      this.save();
    }
  }

  public getBadSources(): BadSourceEntry[] {
    this.ensureLoaded();
    return Array.from(this.badSources.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  public clearAll(): void {
    this.ensureLoaded();
    this.badSources.clear();
    this.save();
  }
}

export const badSourceService = new BadSourceService();
