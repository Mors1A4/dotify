import { APP_VERSION } from '../version';

export type DiagnosticCategory =
  | 'RESOLVE_FAILED'
  | 'EXOPLAYER_ERROR'
  | 'IFRAME_ERROR'
  | 'AUDIO_ENGINE'
  | 'UNCAUGHT_JS'
  | 'NETWORK_ERROR'
  | 'QUEUE_ERROR';

export type DiagnosticLevel = 'error' | 'warn' | 'info';

export interface MobileDiagnosticEvent {
  level?: DiagnosticLevel;
  category: DiagnosticCategory;
  message: string;
  trackId?: string;
  trackTitle?: string;
  trackArtist?: string;
  videoId?: string;
  resolveError?: string;
  source?: string;
  stack?: string;
  details?: Record<string, any>;
}

const FIREBASE_PROJECT_ID = 'dotify-11e01';
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/mobile_diagnostics`;

class MobileDiagnosticsService {
  private isInstalled = false;
  private recentErrors = new Map<string, number>();

  constructor() {
    this.installGlobalHandlers();
  }

  isAndroid(): boolean {
    if (typeof window === 'undefined') return false;
    return (
      !!(window as any).AndroidNativePlayer ||
      navigator.userAgent.toLowerCase().includes('android')
    );
  }

  getDeviceModel(): string {
    if (typeof navigator === 'undefined') return 'Unknown';
    const ua = navigator.userAgent;
    const match = ua.match(/Android[^;]+;\s*([^;)]+)\)/);
    if (match && match[1]) {
      return match[1].trim();
    }
    return navigator.platform || 'Android Device';
  }

  installGlobalHandlers(): void {
    if (this.isInstalled || typeof window === 'undefined') return;
    this.isInstalled = true;

    // Expose diagnostic bridge for Android Kotlin
    (window as any).__dotifyLogDiagnostic = (payload: any) => {
      try {
        const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
        this.report({
          level: data.level || 'error',
          category: data.category || 'EXOPLAYER_ERROR',
          message: data.message || 'Native error reported',
          trackId: data.trackId || data.id,
          trackTitle: data.trackTitle || data.title,
          trackArtist: data.trackArtist || data.artist,
          videoId: data.videoId,
          resolveError: data.resolveError || data.lastResolveError,
          source: data.source || 'AndroidNative',
          details: data.details || {},
        });
      } catch (err) {
        console.warn('[MobileDiagnostics] Error parsing native diagnostic:', err);
      }
    };

    // Catch uncaught window exceptions on mobile
    window.addEventListener('error', (event) => {
      if (!this.isAndroid()) return;
      const msg = event.message || 'Uncaught error';
      if (msg.includes('ResizeObserver') || msg.includes('Script error.')) return;
      this.report({
        level: 'error',
        category: 'UNCAUGHT_JS',
        message: msg,
        stack: event.error?.stack || `${event.filename}:${event.lineno}:${event.colno}`,
      });
    });

    // Catch unhandled promise rejections on mobile
    window.addEventListener('unhandledrejection', (event) => {
      if (!this.isAndroid()) return;
      const reason = event.reason;
      const msg = reason?.message || String(reason || 'Unhandled Promise rejection');
      this.report({
        level: 'error',
        category: 'UNCAUGHT_JS',
        message: `Unhandled rejection: ${msg}`,
        stack: reason?.stack,
      });
    });

    console.info('[MobileDiagnostics] Remote error telemetry installed (v' + APP_VERSION + ')');
  }

  /**
   * Reports an error or diagnostic event to cloud Firestore.
   */
  async report(event: MobileDiagnosticEvent): Promise<void> {
    try {
      const now = Date.now();
      const dedupKey = `${event.category}:${event.message}:${event.trackTitle || ''}`;

      // Rate limit identical events (max 1 every 8 seconds)
      const last = this.recentErrors.get(dedupKey) || 0;
      if (now - last < 8000) return;
      this.recentErrors.set(dedupKey, now);

      // Clean old dedup keys
      if (this.recentErrors.size > 50) {
        for (const [k, v] of this.recentErrors.entries()) {
          if (now - v > 60000) this.recentErrors.delete(k);
        }
      }

      const fields: Record<string, any> = {
        timestamp: { integerValue: String(now) },
        isoTime: { stringValue: new Date(now).toISOString() },
        level: { stringValue: event.level || 'error' },
        category: { stringValue: event.category },
        message: { stringValue: String(event.message).slice(0, 500) },
        appVersion: { stringValue: APP_VERSION },
        platform: { stringValue: this.isAndroid() ? 'Android' : 'Desktop' },
        deviceModel: { stringValue: this.getDeviceModel() },
        userAgent: { stringValue: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : '' },
      };

      if (event.trackId) fields.trackId = { stringValue: String(event.trackId) };
      if (event.trackTitle) fields.trackTitle = { stringValue: String(event.trackTitle) };
      if (event.trackArtist) fields.trackArtist = { stringValue: String(event.trackArtist) };
      if (event.videoId) fields.videoId = { stringValue: String(event.videoId) };
      if (event.resolveError) fields.resolveError = { stringValue: String(event.resolveError).slice(0, 500) };
      if (event.source) fields.source = { stringValue: String(event.source) };
      if (event.stack) fields.stack = { stringValue: String(event.stack).slice(0, 1000) };

      if (event.details && Object.keys(event.details).length > 0) {
        const cleanDetails: Record<string, any> = {};
        for (const [k, v] of Object.entries(event.details)) {
          if (typeof v === 'string') cleanDetails[k] = { stringValue: v.slice(0, 200) };
          else if (typeof v === 'number') cleanDetails[k] = { integerValue: String(Math.round(v)) };
          else if (typeof v === 'boolean') cleanDetails[k] = { booleanValue: v };
        }
        fields.details = { mapValue: { fields: cleanDetails } };
      }

      // Fire-and-forget POST to Firestore REST
      fetch(FIRESTORE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      }).catch((postErr) => {
        console.warn('[MobileDiagnostics] Failed to ship diagnostic to Firestore:', postErr?.message);
      });
    } catch (err) {
      // Diagnostics must never crash the caller
      console.warn('[MobileDiagnostics] Internal telemetry error:', err);
    }
  }
}

export const mobileDiagnostics = new MobileDiagnosticsService();
