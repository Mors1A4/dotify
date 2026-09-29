import { describe, it, expect, beforeEach } from 'vitest';
import {
  AudioCacheEngine,
  ArtistServiceEngine,
  EnhancedQueueManager,
  SpotifyImporterEngine,
  TelemetryDatabaseEngine,
  RecommendationEngine,
  ConnectNode,
  DeviceInfo,
  CastServiceEngine,
  ResponsiveMediaSessionController,
  ExportableTelemetryDataset,
} from '../../fixtures/ecosystemMocks';
import {
  MOCK_AUDIUS_TRACK,
  MOCK_ARCHIVE_TRACK,
  MOCK_RADIO_TRACK,
  MOCK_P2P_TRACK,
  MOCK_ALL_TRACKS,
  Track,
} from '../../fixtures/mockData';

describe('Tier 2: Boundary & Corner Cases — Dotify Upgrade Ecosystem', () => {
  // ==========================================================================
  // Feature 1: Low-Latency Streaming Boundaries
  // ==========================================================================
  describe('F1 Boundaries: Low-Latency Streaming & Caching', () => {
    let cacheEngine: AudioCacheEngine;

    beforeEach(async () => {
      // Create cache with small memory budget (512KB) to test LRU eviction
      cacheEngine = new AudioCacheEngine(512 * 1024);
      await cacheEngine.clearCache();
    });

    it('2.1: pre-warming a small track (< 256KB) does not underflow buffer or crash', async () => {
      const smallTrack: Track = {
        ...MOCK_AUDIUS_TRACK,
        id: 'audius:short-jingle',
        duration: 5,
        sourceMetadata: { fileSize: 32 * 1024 },
      };
      await expect(cacheEngine.prewarmTrack(smallTrack)).resolves.not.toThrow();
      const url = await cacheEngine.getCachedStreamUrl(smallTrack.id, smallTrack.streamUrl);
      expect(url).toContain('blob:dotify-cache');
    });

    it('2.2: simulated network failure / 504 during prewarmTrack does not throw unhandled rejection', async () => {
      const failingTrack: Track = {
        ...MOCK_ARCHIVE_TRACK,
        id: 'archive:failing-stream',
        streamUrl: 'https://archive.org/corrupted.mp3',
      };

      // prewarmTrack must complete cleanly
      await expect(cacheEngine.prewarmTrack(failingTrack)).resolves.not.toThrow();
      const fallbackUrl = await cacheEngine.getCachedStreamUrl('unknown_id', failingTrack.streamUrl);
      expect(fallbackUrl).toBe(failingTrack.streamUrl);
    });

    it('2.3: memory pressure triggers LRU eviction of oldest cached items when limit is exceeded', async () => {
      // 512KB budget: warm track 1 (256KB) and track 2 (256KB)
      await cacheEngine.prewarmTrack(MOCK_AUDIUS_TRACK);
      await cacheEngine.prewarmTrack(MOCK_ARCHIVE_TRACK);

      let stats = await cacheEngine.getCacheStats();
      expect(stats.entryCount).toBe(2);

      // Warm track 3 (256KB) -> exceeds 512KB budget, must evict track 1 (AUDIUS)
      await cacheEngine.prewarmTrack(MOCK_P2P_TRACK);

      stats = await cacheEngine.getCacheStats();
      expect(stats.entryCount).toBeLessThanOrEqual(2);
      expect(stats.estimatedSizeBytes).toBeLessThanOrEqual(512 * 1024);
    });

    it('2.4: prewarmQueue when currentIndex is at the queue end (index === queue.length - 1) handles 0 subsequent tracks', async () => {
      const queue = [MOCK_AUDIUS_TRACK, MOCK_ARCHIVE_TRACK];
      await expect(cacheEngine.prewarmQueue(queue, 1, 2)).resolves.not.toThrow();
      const stats = await cacheEngine.getCacheStats();
      expect(stats.entryCount).toBe(0);
    });

    it('2.5: concurrent duplicate pre-warm requests coalesce into a single in-flight operation', async () => {
      const p1 = cacheEngine.prewarmTrack(MOCK_AUDIUS_TRACK);
      const p2 = cacheEngine.prewarmTrack(MOCK_AUDIUS_TRACK);
      await Promise.all([p1, p2]);

      const stats = await cacheEngine.getCacheStats();
      expect(stats.entryCount).toBe(1);
    });
  });

  // ==========================================================================
  // Feature 2: Dedicated Artist View & Radio Boundaries
  // ==========================================================================
  describe('F2 Boundaries: Dedicated Artist View & Artist Radio', () => {
    let artistService: ArtistServiceEngine;

    beforeEach(() => {
      artistService = new ArtistServiceEngine();
    });

    it('2.6: artist with 0 related artists re-allocates related ratio (35%) proportionally across anchor and discovery', () => {
      const anchor = [MOCK_AUDIUS_TRACK];
      const related: Track[] = [];
      const discovery = [MOCK_P2P_TRACK];

      const radio = artistService.generateArtistRadio(
        { artistId: 'solo_artist', artistName: 'Solo Artist', length: 20 },
        anchor,
        related,
        discovery
      );

      expect(radio.length).toBe(20);
      const anchorCount = radio.filter((t) => t.id === MOCK_AUDIUS_TRACK.id).length;
      expect(anchorCount).toBeGreaterThanOrEqual(10); // Re-allocated from 40% to ~60%
    });

    it('2.7: artist with a single-track discography generates full 25-track radio mix without starvation or infinite loops', () => {
      const anchor = [MOCK_AUDIUS_TRACK];
      const related = [MOCK_ARCHIVE_TRACK];
      const discovery = [MOCK_RADIO_TRACK];

      const radio = artistService.generateArtistRadio(
        { artistId: 'one_hit_wonder', artistName: 'One Hit Wonder', length: 25 },
        anchor,
        related,
        discovery
      );

      expect(radio.length).toBe(25);
    });

    it('2.8: matches artist names with diacritics and symbols ("Sigur Rós", "Mötley Crüe", "AC/DC") case-insensitively', () => {
      const icelandicTrack: Track = {
        ...MOCK_AUDIUS_TRACK,
        artist: 'Sigur Rós',
        title: 'Hoppípolla',
      };
      const profile = artistService.createSyntheticProfile('sigur rós', [icelandicTrack]);
      expect(profile.discography.length).toBe(1);
      expect(profile.discography[0].title).toBe('Hoppípolla');
    });

    it('2.9: artist missing bio and artwork provides neutral defaults without null pointer exceptions', () => {
      const plainTrack: Track = {
        ...MOCK_AUDIUS_TRACK,
        artworkUrl: undefined,
        artist: 'Anonymous Performer',
      };
      const profile = artistService.createSyntheticProfile('Anonymous Performer', [plainTrack]);
      expect(profile.imageUrl).toBeDefined();
      expect(profile.bio).toContain('Anonymous Performer');
    });

    it('2.10: extreme radio length request (length: 100) maintains target proportions within +/- 2 tracks', () => {
      const anchor = [MOCK_AUDIUS_TRACK];
      const related = [MOCK_ARCHIVE_TRACK];
      const discovery = [MOCK_P2P_TRACK];

      const radio = artistService.generateArtistRadio(
        { artistId: 'synthetic_pulse', artistName: 'Synthetic Pulse', length: 100 },
        anchor,
        related,
        discovery
      );

      expect(radio.length).toBe(100);
      const anchorCount = radio.filter((t) => t.id === MOCK_AUDIUS_TRACK.id).length;
      expect(anchorCount).toBeGreaterThanOrEqual(38);
      expect(anchorCount).toBeLessThanOrEqual(42);
    });
  });

  // ==========================================================================
  // Feature 3: Enhanced Queue Management Boundaries
  // ==========================================================================
  describe('F3 Boundaries: Queue Management', () => {
    let queueMgr: EnhancedQueueManager;

    beforeEach(() => {
      queueMgr = new EnhancedQueueManager();
    });

    it('2.11: playNext on an empty queue sets track as active track at index 0', () => {
      expect(queueMgr.queue.length).toBe(0);
      expect(queueMgr.currentIndex).toBe(-1);

      queueMgr.playNext(MOCK_AUDIUS_TRACK);
      expect(queueMgr.queue.length).toBe(1);
      expect(queueMgr.currentIndex).toBe(0);
      expect(queueMgr.queue[0].id).toBe(MOCK_AUDIUS_TRACK.id);
    });

    it('2.12: reorderQueue with out-of-bounds indices (-1, 999) is a no-op', () => {
      queueMgr.addToEnd(MOCK_AUDIUS_TRACK);
      queueMgr.addToEnd(MOCK_ARCHIVE_TRACK);

      queueMgr.reorderQueue(-1, 0);
      expect(queueMgr.queue[0].id).toBe(MOCK_AUDIUS_TRACK.id);

      queueMgr.reorderQueue(0, 999);
      expect(queueMgr.queue[0].id).toBe(MOCK_AUDIUS_TRACK.id);
    });

    it('2.13: removeFromQueue targeting the currently playing track shifts currentIndex cleanly', () => {
      queueMgr.addToEnd(MOCK_AUDIUS_TRACK); // idx 0 (active)
      queueMgr.addToEnd(MOCK_ARCHIVE_TRACK); // idx 1

      queueMgr.removeFromQueue(0);
      expect(queueMgr.queue.length).toBe(1);
      expect(queueMgr.queue[0].id).toBe(MOCK_ARCHIVE_TRACK.id);
      expect(queueMgr.currentIndex).toBe(0);
    });

    it('2.14: removing the only track in queue resets queue to empty and currentIndex to -1', () => {
      queueMgr.addToEnd(MOCK_AUDIUS_TRACK);
      expect(queueMgr.queue.length).toBe(1);

      queueMgr.removeFromQueue(0);
      expect(queueMgr.queue.length).toBe(0);
      expect(queueMgr.currentIndex).toBe(-1);
    });

    it('2.15: reordering with identical fromIndex and toIndex does not mutate queue', () => {
      queueMgr.addToEnd(MOCK_AUDIUS_TRACK);
      queueMgr.addToEnd(MOCK_ARCHIVE_TRACK);

      queueMgr.reorderQueue(1, 1);
      expect(queueMgr.queue[0].id).toBe(MOCK_AUDIUS_TRACK.id);
      expect(queueMgr.queue[1].id).toBe(MOCK_ARCHIVE_TRACK.id);
    });
  });

  // ==========================================================================
  // Feature 4: Custom Playlists & Spotify Importer Boundaries
  // ==========================================================================
  describe('F4 Boundaries: Custom Playlists & Spotify Importer', () => {
    let importer: SpotifyImporterEngine;

    beforeEach(() => {
      importer = new SpotifyImporterEngine();
    });

    it('2.16: invalid or malformed Spotify URLs return null without throwing', () => {
      expect(importer.parseSpotifyUrl('not-a-url')).toBeNull();
      expect(importer.parseSpotifyUrl('https://google.com')).toBeNull();
      expect(importer.parseSpotifyUrl('https://open.spotify.com/unknown/12345')).toBeNull();
    });

    it('2.17: creating a playlist with empty name defaults safely to "Untitled Playlist"', () => {
      const pl = importer.createCustomPlaylist('   ');
      expect(pl.name).toBe('Untitled Playlist');
    });

    it('2.18: fuzzy Jaro-Winkler matches noisy remaster/anniversary track titles', () => {
      const noisyTitle = 'Neon Odyssey - 2024 Remaster / Deluxe Edition';
      const resolved = importer.resolveTrack(noisyTitle, 'Synthetic Pulse', MOCK_ALL_TRACKS);
      expect(resolved).not.toBeNull();
      expect(resolved?.id).toBe(MOCK_AUDIUS_TRACK.id);
    });

    it('2.19: permits duplicate playlist names by assigning distinct unique IDs and timestamps', () => {
      const pl1 = importer.createCustomPlaylist('Workout Mix');
      const pl2 = importer.createCustomPlaylist('Workout Mix');
      expect(pl1.name).toBe(pl2.name);
      expect(pl1.id).not.toBe(pl2.id);
    });

    it('2.20: safely handles playlist names with special characters, emojis, and 500+ character strings', () => {
      const longTitle = '🎶 Techno Rave '.repeat(40);
      const pl = importer.createCustomPlaylist(longTitle);
      expect(pl.name.length).toBeGreaterThan(500);
      expect(pl.name).toContain('🎶');
    });
  });

  // ==========================================================================
  // Feature 5: IndexedDB Telemetry Dataset Boundaries
  // ==========================================================================
  describe('F5 Boundaries: Telemetry Dataset & JSON Export/Import', () => {
    let telemetryDb: TelemetryDatabaseEngine;

    beforeEach(() => {
      telemetryDb = new TelemetryDatabaseEngine();
    });

    it('2.21: rapid skip after 2.5s logs completionRate < 0.05 and skipped: true without negative values', async () => {
      const play = await telemetryDb.recordPlay('session_boundary', MOCK_AUDIUS_TRACK, 2500, 180000);
      expect(play.skipped).toBe(true);
      expect(play.completionRate).toBeGreaterThanOrEqual(0);
      expect(play.completionRate).toBeLessThan(0.05);
    });

    it('2.22: repeat playback (playing same track consecutively) records replayed: true', async () => {
      const play1 = await telemetryDb.recordPlay('session_rep', MOCK_AUDIUS_TRACK, 180000, 180000, false);
      const play2 = await telemetryDb.recordPlay('session_rep', MOCK_AUDIUS_TRACK, 180000, 180000, true);
      expect(play1.replayed).toBe(false);
      expect(play2.replayed).toBe(true);
    });

    it('2.23: importing malformed dataset (wrong schemaVersion or missing arrays) rejects with Error', async () => {
      const invalidData: any = {
        schemaVersion: 99,
        plays: 'not-an-array',
      };
      await expect(telemetryDb.importDataset(invalidData)).rejects.toThrow('Invalid telemetry dataset schema');
    });

    it('2.24: live radio track with infinite duration (duration: Infinity) logs safely without NaN', async () => {
      const play = await telemetryDb.recordPlay('session_radio', MOCK_RADIO_TRACK, 150000, Infinity);
      expect(isNaN(play.completionRate)).toBe(false);
      expect(isFinite(play.completionRate)).toBe(true);
      expect(play.totalDurationMs).toBe(150000);
    });

    it('2.25: importing duplicate records with identical playIds updates existing records without expanding count', async () => {
      const exportData: ExportableTelemetryDataset = {
        schemaVersion: 1,
        exportedAt: Date.now(),
        sessions: [{ sessionId: 's_dup', startTime: Date.now(), deviceType: 'desktop', totalDurationMs: 60000 }],
        plays: [
          {
            playId: 'dup_play_1',
            sessionId: 's_dup',
            trackId: MOCK_AUDIUS_TRACK.id,
            title: MOCK_AUDIUS_TRACK.title,
            artist: MOCK_AUDIUS_TRACK.artist,
            genre: 'Electronic',
            source: 'audius',
            startTime: Date.now(),
            durationPlayedMs: 60000,
            totalDurationMs: 180000,
            completionRate: 0.33,
            skipped: false,
            replayed: false,
          },
        ],
        genreAffinities: [],
      };

      await telemetryDb.importDataset(exportData);
      await telemetryDb.importDataset(exportData); // Import same data again

      const dataset = await telemetryDb.exportDataset();
      const matching = dataset.plays.filter((p) => p.playId === 'dup_play_1');
      expect(matching.length).toBe(1); // Exactly 1, no duplicate keys
    });
  });

  // ==========================================================================
  // Feature 6: Recommendations & Autoplay Boundaries
  // ==========================================================================
  describe('F6 Boundaries: Algorithmic Recommendations & Autoplay', () => {
    let recEngine: RecommendationEngine;

    beforeEach(() => {
      recEngine = new RecommendationEngine();
    });

    it('2.26: cold start for user with 0 listening history returns valid starter recommendations', () => {
      const madeForYou = recEngine.generateMadeForYou([], MOCK_ALL_TRACKS);
      expect(madeForYou.length).toBeGreaterThan(0);
      expect(madeForYou.length).toBeLessThanOrEqual(MOCK_ALL_TRACKS.length);
    });

    it('2.27: user with single-genre history still produces non-empty Daily Mixes', () => {
      const singleGenrePlays = [
        {
          playId: 'p1',
          sessionId: 's1',
          trackId: MOCK_AUDIUS_TRACK.id,
          title: MOCK_AUDIUS_TRACK.title,
          artist: MOCK_AUDIUS_TRACK.artist,
          genre: 'Electronic',
          source: 'audius' as const,
          startTime: Date.now(),
          durationPlayedMs: 180000,
          totalDurationMs: 180000,
          completionRate: 1.0,
          skipped: false,
          replayed: false,
        },
      ];

      const mixes = recEngine.generateDailyMixes(singleGenrePlays, MOCK_ALL_TRACKS);
      expect(mixes.length).toBeGreaterThanOrEqual(1);
      expect(mixes[0].tracks.length).toBeGreaterThan(0);
    });

    it('2.28: Autoplay excludes recently played tracks to prevent repetitive loops', () => {
      const recentPlays = [
        {
          playId: 'p1',
          sessionId: 's1',
          trackId: MOCK_AUDIUS_TRACK.id,
          title: MOCK_AUDIUS_TRACK.title,
          artist: MOCK_AUDIUS_TRACK.artist,
          genre: 'Electronic',
          source: 'audius' as const,
          startTime: Date.now(),
          durationPlayedMs: 180000,
          totalDurationMs: 180000,
          completionRate: 1.0,
          skipped: false,
          replayed: false,
        },
      ];

      const autoplay = recEngine.generateAutoplay(MOCK_AUDIUS_TRACK, recentPlays, MOCK_ALL_TRACKS, 2);
      expect(autoplay.every((t) => t.id !== MOCK_AUDIUS_TRACK.id)).toBe(true);
    });

    it('2.29: Autoplay generates target number of tracks (count: 5) even when matching genre pool is small', () => {
      const autoplay = recEngine.generateAutoplay(MOCK_RADIO_TRACK, [], MOCK_ALL_TRACKS, 3);
      expect(autoplay.length).toBe(3);
    });

    it('2.30: queue advance with autoplay disabled does not trigger callback at queue exhaustion', () => {
      let autoplayFired = false;
      const queueMgr = new EnhancedQueueManager([MOCK_AUDIUS_TRACK], 0);
      queueMgr.autoplayEnabled = false;
      queueMgr.setAutoplayCallback(() => {
        autoplayFired = true;
      });

      queueMgr.advanceTrack();
      expect(autoplayFired).toBe(false);
    });
  });

  // ==========================================================================
  // Feature 7: Local Device Discovery & Remote Control Boundaries
  // ==========================================================================
  describe('F7 Boundaries: Device Discovery & Remote Control', () => {
    it('2.31: compensates for clock drift using wall-clock delta between sender and receiver', () => {
      const host = new ConnectNode(
        { deviceId: 'host_1', deviceName: 'Host', deviceType: 'desktop', role: 'active_host', isCurrentDevice: true, lastSeen: Date.now() },
        'boundary_sync_channel'
      );
      const remote = new ConnectNode(
        { deviceId: 'remote_1', deviceName: 'Remote', deviceType: 'mobile', role: 'remote_controller', isCurrentDevice: false, lastSeen: Date.now() },
        'boundary_sync_channel'
      );

      // Simulate state sent 250ms ago with position 10000ms from host to remote
      const sentTime = Date.now() - 250;
      host.channel.postMessage({
        type: 'STATE_SYNC',
        state: {
          currentTrack: MOCK_AUDIUS_TRACK,
          isPlaying: true,
          positionMs: 10000,
          durationMs: 180000,
          volume: 1.0,
          timestamp: sentTime,
          queue: [],
          currentIndex: 0,
        },
      });

      // Receiver compensator should advance position by roughly 250ms
      expect(remote.playbackState.positionMs).toBeGreaterThanOrEqual(10200);
      host.close();
      remote.close();
    });

    it('2.32: ignores announcements from itself', () => {
      const node = new ConnectNode(
        { deviceId: 'self_node', deviceName: 'Self', deviceType: 'desktop', role: 'active_host', isCurrentDevice: true, lastSeen: Date.now() },
        'self_channel'
      );
      node.announce();
      expect(node.discoveredDevices.has('self_node')).toBe(false);
      node.close();
    });

    it('2.33: reconnecting after disconnect preserves discovered devices', () => {
      const nodeA = new ConnectNode(
        { deviceId: 'node_a', deviceName: 'Node A', deviceType: 'desktop', role: 'active_host', isCurrentDevice: true, lastSeen: Date.now() },
        'recon_channel'
      );
      const nodeB = new ConnectNode(
        { deviceId: 'node_b', deviceName: 'Node B', deviceType: 'mobile', role: 'remote_controller', isCurrentDevice: false, lastSeen: Date.now() },
        'recon_channel'
      );

      nodeB.announce();
      expect(nodeA.discoveredDevices.has('node_b')).toBe(true);

      // Simulated reconnect
      nodeB.announce();
      expect(nodeA.discoveredDevices.size).toBe(1);
      nodeA.close();
      nodeB.close();
    });

    it('2.34: volume commands are clamped to the 0.0 - 1.0 range on receiving end', () => {
      const cast = new CastServiceEngine();
      cast.setVolume(-0.5);
      expect(cast.state.volume).toBe(0.0);

      cast.setVolume(1.8);
      expect(cast.state.volume).toBe(1.0);
    });

    it('2.35: handles consecutive state sync updates in rapid succession without buffer tearing', () => {
      const sender = new ConnectNode(
        { deviceId: 'host_rapid', deviceName: 'Host', deviceType: 'desktop', role: 'active_host', isCurrentDevice: false, lastSeen: Date.now() },
        'rapid_channel'
      );
      const remote = new ConnectNode(
        { deviceId: 'remote_rapid', deviceName: 'Remote', deviceType: 'mobile', role: 'remote_controller', isCurrentDevice: true, lastSeen: Date.now() },
        'rapid_channel'
      );

      for (let i = 0; i < 10; i++) {
        sender.channel.postMessage({
          type: 'STATE_SYNC',
          state: {
            currentTrack: MOCK_AUDIUS_TRACK,
            isPlaying: true,
            positionMs: (i + 1) * 1000,
            durationMs: 180000,
            volume: 0.8,
            timestamp: Date.now(),
            queue: [],
            currentIndex: 0,
          },
        });
      }

      expect(remote.playbackState.positionMs).toBeGreaterThanOrEqual(10000);
      sender.close();
      remote.close();
    });
  });

  // ==========================================================================
  // Feature 8: Google Cast State Sync Boundaries
  // ==========================================================================
  describe('F8 Boundaries: Google Cast State Sync', () => {
    let cast: CastServiceEngine;

    beforeEach(() => {
      cast = new CastServiceEngine();
    });

    it('2.36: initializing Cast with invalid app ID fails safely without throwing', () => {
      const success = cast.initialize('INVALID_APP_ID');
      expect(success).toBe(false);
      expect(cast.state.isAvailable).toBe(false);
    });

    it('2.37: connecting without initialization returns false', () => {
      const connected = cast.connect('Living Room Speaker');
      expect(connected).toBe(false);
      expect(cast.state.isConnected).toBe(false);
    });

    it('2.38: disconnecting when not connected returns clean null state', () => {
      const handoff = cast.disconnect();
      expect(handoff.track).toBeNull();
      expect(handoff.position).toBe(0);
      expect(cast.state.isConnected).toBe(false);
    });

    it('2.39: syncPlayback handles 0 position and null track gracefully', () => {
      cast.syncPlayback(MOCK_AUDIUS_TRACK, 0);
      const handoff = cast.disconnect();
      expect(handoff.position).toBe(0);
    });

    it('2.40: rapid mute toggling preserves clean boolean state', () => {
      cast.setMuted(true);
      expect(cast.state.isMuted).toBe(true);
      cast.setMuted(false);
      expect(cast.state.isMuted).toBe(false);
    });
  });

  // ==========================================================================
  // Feature 9: Responsive Layout & MediaSession Boundaries
  // ==========================================================================
  describe('F9 Boundaries: Responsive Layout & MediaSession', () => {
    let layoutCtrl: ResponsiveMediaSessionController;

    beforeEach(() => {
      layoutCtrl = new ResponsiveMediaSessionController();
    });

    it('2.41: exact boundary at 768px transitions from mobile to desktop layout', () => {
      expect(layoutCtrl.isDesktop(767.9)).toBe(false);
      expect(layoutCtrl.isDesktop(768.0)).toBe(true);
      expect(layoutCtrl.isMobile(767.9)).toBe(true);
      expect(layoutCtrl.isMobile(768.0)).toBe(false);
    });

    it('2.42: setting MediaSession position on live radio (duration: Infinity) handles safely without throwing', () => {
      expect(() => {
        layoutCtrl.updateMediaSession(MOCK_RADIO_TRACK, 100, Infinity, true);
      }).not.toThrow();
    });

    it('2.43: track with missing artwork sets fallback artwork in MediaMetadata', () => {
      const noArtTrack: Track = {
        ...MOCK_AUDIUS_TRACK,
        artworkUrl: undefined,
      };
      layoutCtrl.updateMediaSession(noArtTrack, 0, 180, false);
      const meta = (navigator.mediaSession as any).metadata;
      expect(meta.artwork).toBeDefined();
      expect(meta.artwork.length).toBeGreaterThan(0);
    });

    it('2.44: updateMediaSession with position greater than duration clamps position safely', () => {
      layoutCtrl.updateMediaSession(MOCK_AUDIUS_TRACK, 250, 180, true);
      const posState = (navigator.mediaSession as any).positionState;
      expect(posState.position).toBeLessThanOrEqual(180);
    });

    it('2.45: extreme viewport widths (320px ultra-small to 3840px 4K) categorize correctly', () => {
      expect(layoutCtrl.isMobile(320)).toBe(true);
      expect(layoutCtrl.isDesktop(320)).toBe(false);

      expect(layoutCtrl.isMobile(3840)).toBe(false);
      expect(layoutCtrl.isDesktop(3840)).toBe(true);
    });
  });
});
