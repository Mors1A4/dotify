import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelemetryDatabase, telemetryDb } from '../../src/services/telemetryDb';
import { usePlayerStore } from '../../src/store/playerStore';
import { audioEngine } from '../../src/audio/audioEngine';
import { Track } from '../../src/types/track';
import {
  MOCK_AUDIUS_TRACK,
  MOCK_ARCHIVE_TRACK,
  MOCK_RADIO_TRACK,
  MOCK_P2P_TRACK,
} from '../fixtures/mockData';
import {
  ListeningSessionRecord,
  TrackPlayRecord,
  GenreAffinityRecord,
  ArtistAffinityRecord,
  ExportableTelemetryDataset,
} from '../../src/types/telemetry';

function createMockTrack(id: string, artist: string, title: string, duration = 180, genre = 'Electronic'): Track {
  return {
    id,
    source: 'charts',
    title,
    artist,
    album: 'Adversarial Test Album',
    duration,
    streamUrl: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=',
    artworkUrl: 'http://localhost:3001/art/mock.jpg',
    sourceMetadata: {
      format: 'mp3',
      genre,
    },
  };
}

describe('Adversarial Challenge Suite: Milestone 2 Telemetry & Dataset Robustness', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await telemetryDb.clearTelemetry();
    usePlayerStore.setState({
      queue: [],
      currentTrack: null,
      history: [],
      isPlaying: false,
      isBuffering: false,
      repeatMode: 'off',
      shuffle: false,
    });
  });

  afterEach(async () => {
    await telemetryDb.clearTelemetry();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SUITE 1: CORRUPTED, MALFORMED, OR MISSING JSON PAYLOADS TO importDataset
  // =========================================================================
  describe('1. Corrupted, Malformed, or Missing JSON Payloads (importDataset)', () => {
    it('rejects null, undefined, numbers, booleans, and empty arrays with strict error', async () => {
      await expect(telemetryDb.importDataset(null as any)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset(undefined as any)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset(42 as any)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset(true as any)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset([] as any)).rejects.toThrow('Invalid telemetry dataset schema');
    });

    it('rejects empty strings and whitespace-only strings', async () => {
      await expect(telemetryDb.importDataset('')).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset('   \t\n  ')).rejects.toThrow('Invalid telemetry dataset schema');
    });

    it('rejects malformed and unparseable JSON strings', async () => {
      await expect(telemetryDb.importDataset('{ malformed json')).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset('{"version": 1, "plays": [')).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset('{"version": 1, "plays": [{},]}')).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset('<!DOCTYPE html><html><body>Error</body></html>')).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset('undefined')).rejects.toThrow('Invalid telemetry dataset schema');
    });

    it('rejects payloads with missing or non-matching version/schemaVersion', async () => {
      // Missing version
      await expect(telemetryDb.importDataset({ plays: [], sessions: [] } as any)).rejects.toThrow('Invalid telemetry dataset schema');
      // Incompatible versions
      await expect(telemetryDb.importDataset({ version: 2, plays: [], sessions: [] } as any)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset({ version: 0, plays: [], sessions: [] } as any)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset({ version: -1, plays: [], sessions: [] } as any)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset({ version: 99, plays: [], sessions: [] } as any)).rejects.toThrow('Invalid telemetry dataset schema');
      // String version instead of number 1
      await expect(telemetryDb.importDataset({ version: '1', plays: [], sessions: [] } as any)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset({ schemaVersion: 'v1.0', plays: [], sessions: [] } as any)).rejects.toThrow('Invalid telemetry dataset schema');
    });

    it('rejects payloads with missing or invalid plays field', async () => {
      await expect(telemetryDb.importDataset({ version: 1, sessions: [] } as any)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset({ version: 1, sessions: [], plays: null } as any)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset({ version: 1, sessions: [], plays: {} } as any)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset({ version: 1, sessions: [], plays: 'all_plays' } as any)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset({ version: 1, sessions: [], plays: 123 } as any)).rejects.toThrow('Invalid telemetry dataset schema');
    });

    it('rejects payloads with missing or invalid sessions field', async () => {
      await expect(telemetryDb.importDataset({ version: 1, plays: [] } as any)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset({ version: 1, plays: [], sessions: null } as any)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset({ version: 1, plays: [], sessions: {} } as any)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset({ version: 1, plays: [], sessions: 'desktop' } as any)).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importDataset({ version: 1, plays: [], sessions: 456 } as any)).rejects.toThrow('Invalid telemetry dataset schema');
    });

    it('preserves database state intact (no data corruption) when bad payloads are rejected', async () => {
      // 1. Seed existing baseline data
      const session = await telemetryDb.startSession('desktop');
      const p1 = await telemetryDb.recordPlay(session.sessionId, MOCK_AUDIUS_TRACK, 120000, 180000);
      const p2 = await telemetryDb.recordPlay(session.sessionId, MOCK_ARCHIVE_TRACK, 90000, 240000);

      const playsBefore = await telemetryDb.getAllPlays();
      const sessionsBefore = await telemetryDb.getAllSessions();
      expect(playsBefore.length).toBe(2);
      expect(sessionsBefore.length).toBe(1);

      // 2. Fire barrage of corrupted payloads
      const adversarialPayloads = [
        '{ corrupted json string',
        null,
        undefined,
        '',
        { version: 2, plays: [], sessions: [] },
        { version: 1, plays: 'not array', sessions: [] },
        { version: 1, plays: [], sessions: null },
        { schemaVersion: 99, plays: [], sessions: [] },
      ];

      for (const payload of adversarialPayloads) {
        await expect(telemetryDb.importDataset(payload as any)).rejects.toThrow('Invalid telemetry dataset schema');
      }

      // 3. Verify database state after attacks is completely untouched
      const playsAfter = await telemetryDb.getAllPlays();
      const sessionsAfter = await telemetryDb.getAllSessions();

      expect(playsAfter.length).toBe(2);
      expect(sessionsAfter.length).toBe(1);
      expect(playsAfter.map((p) => p.playId).sort()).toEqual([p1.playId, p2.playId].sort());
      expect(sessionsAfter[0].sessionId).toBe(session.sessionId);
    });

    it('importTelemetryDataset alias behaves identically and throws for malformed inputs', async () => {
      await expect(telemetryDb.importTelemetryDataset('{ broken')).rejects.toThrow('Invalid telemetry dataset schema');
      await expect(telemetryDb.importTelemetryDataset({ version: 3, plays: [], sessions: [] } as any)).rejects.toThrow('Invalid telemetry dataset schema');
    });

    it('handles non-array optional fields (genreAffinities, artistAffinities) gracefully without crashing', async () => {
      const payload: any = {
        version: 1,
        sessions: [
          { sessionId: 's_safe_1', startTime: Date.now() - 10000, deviceType: 'desktop', totalDurationMs: 10000 },
        ],
        plays: [
          {
            playId: 'p_safe_1',
            sessionId: 's_safe_1',
            trackId: 'track_safe_1',
            title: 'Safe',
            artist: 'Safe Artist',
            source: 'audius',
            startTime: Date.now() - 5000,
            durationPlayedMs: 5000,
            totalDurationMs: 180000,
            completionRate: 0.027,
            skipped: true,
            completed: false,
            replayed: false,
          },
        ],
        genreAffinities: 'corrupted_string_instead_of_array',
        artistAffinities: 12345,
      };

      // importDataset checks Array.isArray on optional affinity fields before iterating
      const result = await telemetryDb.importDataset(payload);
      expect(result.importedPlays).toBe(1);
      expect(result.importedSessions).toBe(1);

      const plays = await telemetryDb.getAllPlays();
      expect(plays.length).toBe(1);
      expect(plays[0].playId).toBe('p_safe_1');
    });
  });

  // =========================================================================
  // SUITE 2: TELEMETRY RECORDING DURING RAPID SEEKBAR SCRUBBING
  // =========================================================================
  describe('2. Telemetry Recording During Rapid Seekbar Scrubbing', () => {
    it('rapid scrubbing during playback does NOT inflate durationPlayedMs beyond elapsed wall-clock time', async () => {
      let mockClock = 1000000;
      vi.spyOn(Date, 'now').mockImplementation(() => mockClock);

      const track = createMockTrack('t_scrub_1', 'Scrub Artist', 'Scrub Anthem', 300); // 300 seconds track
      const store = usePlayerStore.getState();

      store.playTrack(track);
      usePlayerStore.setState({ isPlaying: true });

      // Simulate 50 rapid seekbar scrub operations across 1000ms wall-clock time
      // The user rapidly scrubs between position 5s and 290s (e.g. 5,000ms to 290,000ms audio time)
      const seekTargets = [5, 50, 120, 200, 280, 10, 90, 250, 290, 15];
      for (let i = 0; i < 50; i++) {
        mockClock += 20; // 20ms delta per scrub -> 50 * 20 = 1000ms total wall-clock time
        const targetSec = seekTargets[i % seekTargets.length];
        store.seekTo(targetSec);
        // Audio element timeupdate event is dispatched
        (audioEngine as any).activeAudio?.dispatchEvent('timeupdate');
      }

      // Switch to next track to finalize play record
      const nextTrack = createMockTrack('t_scrub_2', 'Next Artist', 'Next Song', 180);
      store.playTrack(nextTrack);

      // Verify what was recorded in telemetryDb for t_scrub_1
      const plays = await telemetryDb.getAllPlays();
      const scrubPlay = plays.find((p) => p.trackId === 't_scrub_1');
      expect(scrubPlay).toBeDefined();

      // Crucial verification: durationPlayedMs MUST reflect the 1000ms wall-clock duration,
      // NOT the 290,000ms audio seek target or a sum of seek positions!
      expect(scrubPlay!.durationPlayedMs).toBeGreaterThanOrEqual(900);
      expect(scrubPlay!.durationPlayedMs).toBeLessThanOrEqual(1100);
      expect(scrubPlay!.durationPlayedMs).not.toBe(290000);
      expect(scrubPlay!.durationPlayedMs).toBeLessThan(30000); // Less than 30s

      // Since wall-clock listened duration was ~1s on a 300s track, completionRate is ~0.0033
      expect(scrubPlay!.completionRate).toBeLessThan(0.02);
      expect(scrubPlay!.completed).toBe(false);
      expect(scrubPlay!.skipped).toBe(true);
    });

    it('rapid scrubbing while paused accumulates exactly 0ms durationPlayedMs', async () => {
      let mockClock = 2000000;
      vi.spyOn(Date, 'now').mockImplementation(() => mockClock);

      const track = createMockTrack('t_scrub_paused', 'Paused Artist', 'Paused Track', 200);
      const store = usePlayerStore.getState();

      store.playTrack(track);
      // Ensure player is paused
      usePlayerStore.setState({ isPlaying: false });

      // Rapidly scrub 50 times across positions while paused over 2000ms wall-clock time
      for (let i = 0; i < 50; i++) {
        mockClock += 40;
        store.seekTo((i * 4) % 200);
        (audioEngine as any).activeAudio?.dispatchEvent('timeupdate');
      }

      // Finalize playback
      store.playTrack(createMockTrack('t_other', 'Other', 'Other', 180));

      const plays = await telemetryDb.getAllPlays();
      const pausedPlay = plays.find((p) => p.trackId === 't_scrub_paused');
      expect(pausedPlay).toBeDefined();
      expect(pausedPlay!.durationPlayedMs).toBe(0);
      expect(pausedPlay!.completionRate).toBe(0);
      expect(pausedPlay!.completed).toBe(false);
      expect(pausedPlay!.skipped).toBe(true);
    });

    it('scrubbing to track end and triggering trackEnd correctly records a skip instead of completed play', async () => {
      let mockClock = 3000000;
      vi.spyOn(Date, 'now').mockImplementation(() => mockClock);

      const track = createMockTrack('t_scrub_end', 'End Artist', 'End Track', 300);
      const store = usePlayerStore.getState();

      store.playTrack(track);
      usePlayerStore.setState({ isPlaying: true });

      // User listens for 500ms
      mockClock += 500;
      (audioEngine as any).activeAudio?.dispatchEvent('timeupdate');

      // User immediately scrubs to second 299 of the 300s track
      store.seekTo(299);
      mockClock += 100;
      (audioEngine as any).activeAudio?.dispatchEvent('timeupdate');

      // Track naturally triggers ended event on audio element
      (audioEngine as any).activeAudio?.dispatchEvent('ended');

      // Wait a tick for async onTrackEnd / finalizeCurrentPlayRecord
      await new Promise((r) => setTimeout(r, 20));

      const plays = await telemetryDb.getAllPlays();
      const endPlay = plays.find((p) => p.trackId === 't_scrub_end');
      expect(endPlay).toBeDefined();

      // Total wall-clock listening was 600ms. Must be classified as skipped, NOT completed!
      expect(endPlay!.durationPlayedMs).toBe(600);
      expect(endPlay!.completed).toBe(false);
      expect(endPlay!.skipped).toBe(true);
      expect(endPlay!.completionRate).toBeLessThan(0.01);
    });

    it('stress harness: 200 high-frequency seek calls in tight loop does not throw or destabilize store', () => {
      const track = createMockTrack('t_hf', 'HF Artist', 'High Frequency Track', 180);
      usePlayerStore.getState().playTrack(track);

      expect(() => {
        for (let i = 0; i < 200; i++) {
          usePlayerStore.getState().seekTo(i % 180);
        }
      }).not.toThrow();

      expect(usePlayerStore.getState().currentTrack?.id).toBe('t_hf');
    });
  });

  // =========================================================================
  // SUITE 3: LIVE RADIO STREAMS WITH INFINITE / ZERO DURATION
  // =========================================================================
  describe('3. Live Radio Streams with Infinite / Zero / Negative Duration', () => {
    it('live radio stream with duration Infinity produces finite non-NaN completionRate', async () => {
      const session = await telemetryDb.startSession('desktop');
      const radioTrack: Track = {
        ...MOCK_RADIO_TRACK,
        id: 'radio_inf_1',
        duration: Infinity,
      };

      // User plays live radio for 45 seconds (45,000ms) with totalDurationMs = Infinity
      const play = await telemetryDb.recordPlay(session.sessionId, radioTrack, 45000, Infinity);

      expect(Number.isNaN(play.completionRate)).toBe(false);
      expect(Number.isFinite(play.completionRate)).toBe(true);
      expect(play.completionRate).toBeGreaterThanOrEqual(0);
      expect(play.completionRate).toBeLessThanOrEqual(1);

      // In telemetryDb, when totalDurationMs is infinite, effectiveTotal falls back to durationPlayedMs
      expect(Number.isNaN(play.totalDurationMs)).toBe(false);
      expect(Number.isFinite(play.totalDurationMs)).toBe(true);
      expect(play.totalDurationMs).toBe(45000);
      expect(play.completionRate).toBe(1.0);
      expect(play.completed).toBe(true);
      expect(play.skipped).toBe(false);
    });

    it('live radio stream with duration 0 produces finite non-NaN completionRate', async () => {
      const session = await telemetryDb.startSession('desktop');
      const radioTrack: Track = {
        ...MOCK_RADIO_TRACK,
        id: 'radio_zero_1',
        duration: 0,
      };

      const play = await telemetryDb.recordPlay(session.sessionId, radioTrack, 35000, 0);

      expect(Number.isNaN(play.completionRate)).toBe(false);
      expect(Number.isFinite(play.completionRate)).toBe(true);
      expect(play.completionRate).toBe(1.0);
      expect(play.totalDurationMs).toBe(35000);
      expect(play.completed).toBe(true);
      expect(play.skipped).toBe(false);
    });

    it('live radio stream immediate skip (0ms durationPlayedMs, Infinity totalDurationMs) produces 0 completionRate, not NaN', async () => {
      const session = await telemetryDb.startSession('desktop');
      const radioTrack: Track = {
        ...MOCK_RADIO_TRACK,
        id: 'radio_skip_1',
        duration: Infinity,
      };

      const play = await telemetryDb.recordPlay(session.sessionId, radioTrack, 0, Infinity);

      expect(Number.isNaN(play.completionRate)).toBe(false);
      expect(play.completionRate).toBe(0);
      expect(Number.isNaN(play.totalDurationMs)).toBe(false);
      expect(play.totalDurationMs).toBe(1); // Clamped minimum 1 to prevent 0/0 division
      expect(play.skipped).toBe(true);
      expect(play.completed).toBe(false);
    });

    it('handles negative or NaN totalDurationMs gracefully without propagating NaN', async () => {
      const session = await telemetryDb.startSession('desktop');
      const track = createMockTrack('t_nan_dur', 'NaN Artist', 'NaN Track', 0);

      const playNegative = await telemetryDb.recordPlay(session.sessionId, track, 20000, -5000);
      expect(Number.isNaN(playNegative.completionRate)).toBe(false);
      expect(playNegative.completionRate).toBe(1.0);

      const playNaN = await telemetryDb.recordPlay(session.sessionId, track, 20000, NaN);
      expect(Number.isNaN(playNaN.completionRate)).toBe(false);
      expect(playNaN.completionRate).toBe(1.0);
    });

    it('extended live radio session (2 hours / 7,200,000ms) clamps completionRate to <= 1.0', async () => {
      const session = await telemetryDb.startSession('desktop');
      const radioTrack: Track = {
        ...MOCK_RADIO_TRACK,
        id: 'radio_long_1',
        duration: Infinity,
      };

      const twoHoursMs = 2 * 60 * 60 * 1000;
      const play = await telemetryDb.recordPlay(session.sessionId, radioTrack, twoHoursMs, Infinity);

      expect(Number.isNaN(play.completionRate)).toBe(false);
      expect(play.completionRate).toBe(1.0);
      expect(play.durationPlayedMs).toBe(twoHoursMs);
      expect(play.completed).toBe(true);
      expect(play.skipped).toBe(false);
    });

    it('updates genre and artist affinities for radio streams without NaN scoring errors', async () => {
      const session = await telemetryDb.startSession('desktop');
      const radioTrack: Track = {
        ...MOCK_RADIO_TRACK,
        id: 'radio_genre_1',
        duration: Infinity,
        sourceMetadata: { genre: 'Jazz' },
      };

      await telemetryDb.recordPlay(session.sessionId, radioTrack, 120000, Infinity);

      const genreAffinities = await telemetryDb.getGenreAffinities();
      const jazzAffinity = genreAffinities.find((g) => g.genre === 'Jazz');

      expect(jazzAffinity).toBeDefined();
      expect(Number.isNaN(jazzAffinity!.affinityScore)).toBe(false);
      expect(jazzAffinity!.affinityScore).toBeGreaterThanOrEqual(1);
      expect(jazzAffinity!.affinityScore).toBeLessThanOrEqual(100);
      expect(jazzAffinity!.playCount).toBe(1);
      expect(jazzAffinity!.totalTimePlayedMs).toBe(120000);
    });
  });

  // =========================================================================
  // SUITE 4: CONCURRENT PLAY RECORDS AND RAPID SESSION UPDATES
  // =========================================================================
  describe('4. Concurrent Play Records and Rapid Session Updates', () => {
    it('50 concurrent recordPlay calls via Promise.all resolve successfully and store 50 records', async () => {
      await telemetryDb.clearTelemetry();
      const session = await telemetryDb.startSession('desktop');
      const tracks = [
        createMockTrack('c_track_1', 'Artist A', 'Song A', 180, 'Electronic'),
        createMockTrack('c_track_2', 'Artist B', 'Song B', 200, 'Rock'),
        createMockTrack('c_track_3', 'Artist C', 'Song C', 240, 'Ambient'),
        createMockTrack('c_track_4', 'Artist D', 'Song D', 160, 'Pop'),
        createMockTrack('c_track_5', 'Artist E', 'Song E', 210, 'Hip Hop'),
      ];

      // Execute 50 concurrent recordPlay operations
      const promises = Array.from({ length: 50 }, (_, i) => {
        const track = tracks[i % tracks.length];
        const durationPlayed = 40000 + i * 1000;
        return telemetryDb.recordPlay(session.sessionId, track, durationPlayed, track.duration! * 1000);
      });

      const results = await Promise.all(promises);
      expect(results.length).toBe(50);

      const allPlays = await telemetryDb.getAllPlays();
      expect(allPlays.length).toBe(50);

      // Verify all playIds are unique
      const playIds = new Set(allPlays.map((p) => p.playId));
      expect(playIds.size).toBe(50);
    });

    it('50 concurrent updateSession calls on the same sessionId resolve without race condition crashes', async () => {
      const session = await telemetryDb.startSession('desktop');

      // 50 concurrent updates adding 5,000ms each
      const updatePromises = Array.from({ length: 50 }, () =>
        telemetryDb.updateSession(session.sessionId, 5000)
      );

      await expect(Promise.all(updatePromises)).resolves.not.toThrow();

      const allSessions = await telemetryDb.getAllSessions();
      const updated = allSessions.find((s) => s.sessionId === session.sessionId);
      expect(updated).toBeDefined();
      expect(updated!.totalDurationMs).toBeGreaterThan(0);
      expect(updated!.tracksPlayed).toBeGreaterThan(0);
    });

    it('interleaved high-concurrency stress harness: multiple sessions started, updated, and ended in parallel', async () => {
      const operations: Promise<any>[] = [];

      // 1. Concurrently start 5 sessions
      for (let sIdx = 0; sIdx < 5; sIdx++) {
        operations.push(
          (async () => {
            const session = await telemetryDb.startSession(sIdx % 2 === 0 ? 'desktop' : 'mobile');
            // Immediately fire 5 concurrent plays in this session
            const playPromises = Array.from({ length: 5 }, (_, pIdx) => {
              const track = createMockTrack(`inter_t_${sIdx}_${pIdx}`, `Artist_${sIdx}`, `Song_${pIdx}`, 180);
              return telemetryDb.recordPlay(session.sessionId, track, 60000, 180000);
            });
            await Promise.all(playPromises);
            // End session
            await telemetryDb.endSession(session.sessionId);
          })()
        );
      }

      await expect(Promise.all(operations)).resolves.not.toThrow();

      const sessions = await telemetryDb.getAllSessions();
      const plays = await telemetryDb.getAllPlays();

      expect(sessions.length).toBe(5);
      expect(plays.length).toBe(25);

      // Verify all sessions were ended cleanly
      for (const s of sessions) {
        expect(s.endTime).toBeDefined();
        expect(s.totalDurationMs).toBeGreaterThan(0);
      }
    });

    it('rapid session lifecycle: start, 20 sequential updates, and end maintains chronological integrity', async () => {
      const session = await telemetryDb.startSession('mobile');
      expect(session.deviceType).toBe('mobile');

      for (let i = 0; i < 20; i++) {
        await telemetryDb.updateSession(session.sessionId, 1000);
      }

      await telemetryDb.endSession(session.sessionId);

      const allSessions = await telemetryDb.getAllSessions();
      const ended = allSessions.find((s) => s.sessionId === session.sessionId);

      expect(ended).toBeDefined();
      expect(ended!.tracksPlayed).toBe(20);
      expect(ended!.totalDurationMs).toBe(20000);
      expect(ended!.endTime).toBeGreaterThanOrEqual(ended!.startTime);
    });
  });

  // =========================================================================
  // SUITE 5: EXPORT DATASET IDEMPOTENCY & ROUND-TRIP FIDELITY
  // =========================================================================
  describe('5. Export Dataset Idempotency & Round-Trip Fidelity', () => {
    beforeEach(async () => {
      await telemetryDb.clearTelemetry();
    });

    it('round-trip fidelity: export -> clear -> import -> re-export produces matching dataset', async () => {
      // 1. Seed comprehensive realistic dataset across multiple providers
      const s1 = await telemetryDb.startSession('desktop');
      const s2 = await telemetryDb.startSession('mobile');

      await telemetryDb.recordPlay(s1.sessionId, MOCK_AUDIUS_TRACK, 180000, 180000, false); // Completed
      await telemetryDb.recordPlay(s1.sessionId, MOCK_ARCHIVE_TRACK, 30000, 240000, false);  // Skipped
      await telemetryDb.recordPlay(s2.sessionId, MOCK_RADIO_TRACK, 60000, Infinity, false);   // Radio
      await telemetryDb.recordPlay(s2.sessionId, MOCK_P2P_TRACK, 240000, 240000, true);      // Replayed

      await telemetryDb.endSession(s1.sessionId);
      await telemetryDb.endSession(s2.sessionId);

      // 2. Export first snapshot D1
      const d1: ExportableTelemetryDataset = await telemetryDb.exportDataset();
      expect(d1.version).toBe(1);
      expect(d1.sessions.length).toBe(2);
      expect(d1.plays.length).toBe(4);
      expect(d1.genreAffinities.length).toBeGreaterThan(0);

      // 3. Clear database completely
      await telemetryDb.clearTelemetry();
      expect((await telemetryDb.getAllPlays()).length).toBe(0);
      expect((await telemetryDb.getAllSessions()).length).toBe(0);
      expect((await telemetryDb.getGenreAffinities()).length).toBe(0);

      // 4. Import snapshot D1
      const importResult = await telemetryDb.importDataset(d1);
      expect(importResult.importedPlays).toBe(4);
      expect(importResult.importedSessions).toBe(2);

      // 5. Re-export snapshot D2
      const d2: ExportableTelemetryDataset = await telemetryDb.exportDataset();

      // 6. Assert structural and value equivalence between D1 and D2
      expect(d2.version).toBe(d1.version);
      expect(d2.schemaVersion).toBe(d1.schemaVersion);

      // Sessions equivalence
      const sortSessions = (arr: ListeningSessionRecord[]) => [...arr].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
      const s1Sorted = sortSessions(d1.sessions);
      const s2Sorted = sortSessions(d2.sessions);
      expect(s2Sorted.length).toBe(s1Sorted.length);
      for (let i = 0; i < s1Sorted.length; i++) {
        expect(s2Sorted[i].sessionId).toBe(s1Sorted[i].sessionId);
        expect(s2Sorted[i].deviceType).toBe(s1Sorted[i].deviceType);
        expect(s2Sorted[i].totalDurationMs).toBe(s1Sorted[i].totalDurationMs);
      }

      // Plays equivalence
      const sortPlays = (arr: TrackPlayRecord[]) => [...arr].sort((a, b) => a.playId.localeCompare(b.playId));
      const p1Sorted = sortPlays(d1.plays);
      const p2Sorted = sortPlays(d2.plays);
      expect(p2Sorted.length).toBe(p1Sorted.length);
      for (let i = 0; i < p1Sorted.length; i++) {
        expect(p2Sorted[i].playId).toBe(p1Sorted[i].playId);
        expect(p2Sorted[i].trackId).toBe(p1Sorted[i].trackId);
        expect(p2Sorted[i].durationPlayedMs).toBe(p1Sorted[i].durationPlayedMs);
        expect(p2Sorted[i].totalDurationMs).toBe(p1Sorted[i].totalDurationMs);
        expect(p2Sorted[i].completionRate).toBe(p1Sorted[i].completionRate);
        expect(p2Sorted[i].completed).toBe(p1Sorted[i].completed);
        expect(p2Sorted[i].skipped).toBe(p1Sorted[i].skipped);
        expect(p2Sorted[i].replayed).toBe(p1Sorted[i].replayed);
      }

      // Genre affinities equivalence
      const sortGenres = (arr: GenreAffinityRecord[]) => [...arr].sort((a, b) => a.genre.localeCompare(b.genre));
      const g1Sorted = sortGenres(d1.genreAffinities);
      const g2Sorted = sortGenres(d2.genreAffinities);
      expect(g2Sorted.length).toBe(g1Sorted.length);
      for (let i = 0; i < g1Sorted.length; i++) {
        expect(g2Sorted[i].genre).toBe(g1Sorted[i].genre);
        expect(g2Sorted[i].affinityScore).toBe(g1Sorted[i].affinityScore);
        expect(g2Sorted[i].playCount).toBe(g1Sorted[i].playCount);
      }
    });

    it('double-import idempotency: importing the exact same dataset twice does not duplicate records in IndexedDB', async () => {
      await telemetryDb.clearTelemetry();
      const session = await telemetryDb.startSession('desktop');
      await telemetryDb.recordPlay(session.sessionId, MOCK_AUDIUS_TRACK, 180000, 180000);
      await telemetryDb.recordPlay(session.sessionId, MOCK_ARCHIVE_TRACK, 120000, 240000);

      const dataset = await telemetryDb.exportDataset();
      expect(dataset.plays.length).toBe(2);
      expect(dataset.sessions.length).toBe(1);

      // First import on existing DB
      await telemetryDb.importDataset(dataset);
      expect((await telemetryDb.getAllPlays()).length).toBe(2);
      expect((await telemetryDb.getAllSessions()).length).toBe(1);

      // Second import on existing DB (idempotency check)
      await telemetryDb.importDataset(dataset);
      expect((await telemetryDb.getAllPlays()).length).toBe(2);
      expect((await telemetryDb.getAllSessions()).length).toBe(1);
    });

    it('JSON string export/import round-trip preserves valid JSON structure and data types', async () => {
      const session = await telemetryDb.startSession('desktop');
      await telemetryDb.recordPlay(session.sessionId, MOCK_P2P_TRACK, 100000, 240000);

      // Export as formatted JSON string
      const jsonString = await telemetryDb.exportTelemetryDataset();
      expect(typeof jsonString).toBe('string');

      // Clear and re-import from JSON string
      await telemetryDb.clearTelemetry();
      const res = await telemetryDb.importDataset(jsonString);
      expect(res.importedPlays).toBe(1);
      expect(res.importedSessions).toBe(1);

      const reExportedString = await telemetryDb.exportTelemetryDataset();
      const parsed1 = JSON.parse(jsonString);
      const parsed2 = JSON.parse(reExportedString);

      expect(parsed2.version).toBe(parsed1.version);
      expect(parsed2.plays[0].playId).toBe(parsed1.plays[0].playId);
      expect(parsed2.plays[0].trackId).toBe(parsed1.plays[0].trackId);
      expect(parsed2.sessions[0].sessionId).toBe(parsed1.sessions[0].sessionId);
    });

    it('imports partial datasets containing only sessions and plays without requiring affinities', async () => {
      const minimalDataset = {
        version: 1,
        sessions: [
          { sessionId: 's_min_1', startTime: Date.now() - 5000, deviceType: 'web' as const, totalDurationMs: 5000 },
        ],
        plays: [
          {
            playId: 'p_min_1',
            sessionId: 's_min_1',
            trackId: 't_min_1',
            title: 'Minimal',
            artist: 'Minimal Artist',
            source: 'audius' as const,
            startTime: Date.now() - 5000,
            durationPlayedMs: 5000,
            totalDurationMs: 180000,
            completionRate: 0.027,
            skipped: true,
            completed: false,
            replayed: false,
          },
        ],
      };

      await telemetryDb.clearTelemetry();
      const res = await telemetryDb.importDataset(minimalDataset);
      expect(res.importedPlays).toBe(1);
      expect(res.importedSessions).toBe(1);

      const plays = await telemetryDb.getAllPlays();
      expect(plays.length).toBe(1);
      expect(plays[0].title).toBe('Minimal');
    });
  });
});
