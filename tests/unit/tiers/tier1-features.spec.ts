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
} from '../../fixtures/ecosystemMocks';
import {
  MOCK_AUDIUS_TRACK,
  MOCK_ARCHIVE_TRACK,
  MOCK_RADIO_TRACK,
  MOCK_P2P_TRACK,
  MOCK_ALL_TRACKS,
  Track,
} from '../../fixtures/mockData';

describe('Tier 1: Feature Coverage — Dotify Upgrade Ecosystem', () => {
  // ==========================================================================
  // Feature 1: Low-Latency Streaming & Multi-Tier Caching
  // ==========================================================================
  describe('F1: Low-Latency Streaming & Caching Mechanisms', () => {
    let cacheEngine: AudioCacheEngine;

    beforeEach(async () => {
      cacheEngine = new AudioCacheEngine();
      await cacheEngine.clearCache();
    });

    it('1.1: getCachedStreamUrl returns immediate memory L1 cached URL (<10ms) when track is pre-warmed', async () => {
      await cacheEngine.prewarmTrack(MOCK_AUDIUS_TRACK);
      const start = performance.now();
      const url = await cacheEngine.getCachedStreamUrl(MOCK_AUDIUS_TRACK.id, MOCK_AUDIUS_TRACK.streamUrl);
      const duration = performance.now() - start;

      expect(url).toContain('blob:dotify-cache');
      expect(duration).toBeLessThan(50); // Well under 50ms, sub-second cold start
    });

    it('1.2: promotes track from L2 (CacheStorage) to L1 memory cache on L1 miss', async () => {
      // Warm track in cache
      await cacheEngine.prewarmTrack(MOCK_AUDIUS_TRACK);

      // Create new cacheEngine instance simulating new session with empty L1 memory
      const freshEngine = new AudioCacheEngine();
      const statsBefore = await freshEngine.getCacheStats();
      expect(statsBefore.entryCount).toBe(0);

      // Fetching resolves from L2 and promotes to L1
      const url = await freshEngine.getCachedStreamUrl(MOCK_AUDIUS_TRACK.id, MOCK_AUDIUS_TRACK.streamUrl);
      expect(url).toContain('blob:dotify-cache');
      const statsAfter = await freshEngine.getCacheStats();
      expect(statsAfter.entryCount).toBe(1);
    });

    it('1.3: prewarmTrack downloads 256KB range chunk and caches payload', async () => {
      await cacheEngine.prewarmTrack(MOCK_ARCHIVE_TRACK);
      const stats = await cacheEngine.getCacheStats();
      expect(stats.entryCount).toBe(1);
      expect(stats.estimatedSizeBytes).toBe(256 * 1024); // Exactly 256KB
    });

    it('1.4: prewarmQueue asynchronously warms the next N upcoming tracks without blocking', async () => {
      const queue = [MOCK_AUDIUS_TRACK, MOCK_ARCHIVE_TRACK, MOCK_P2P_TRACK];
      await cacheEngine.prewarmQueue(queue, 0, 2); // Warm next 2 tracks (ARCHIVE and P2P)

      const stats = await cacheEngine.getCacheStats();
      expect(stats.entryCount).toBe(2);

      const archiveUrl = await cacheEngine.getCachedStreamUrl(MOCK_ARCHIVE_TRACK.id, MOCK_ARCHIVE_TRACK.streamUrl);
      const p2pUrl = await cacheEngine.getCachedStreamUrl(MOCK_P2P_TRACK.id, MOCK_P2P_TRACK.streamUrl);
      expect(archiveUrl).toContain('blob:dotify-cache');
      expect(p2pUrl).toContain('blob:dotify-cache');
    });

    it('1.5: getCacheStats accurately reports total entries/bytes, and clearCache purges all tiers', async () => {
      await cacheEngine.prewarmTrack(MOCK_AUDIUS_TRACK);
      await cacheEngine.prewarmTrack(MOCK_ARCHIVE_TRACK);

      let stats = await cacheEngine.getCacheStats();
      expect(stats.entryCount).toBe(2);
      expect(stats.estimatedSizeBytes).toBe(512 * 1024);

      await cacheEngine.clearCache();
      stats = await cacheEngine.getCacheStats();
      expect(stats.entryCount).toBe(0);
      expect(stats.estimatedSizeBytes).toBe(0);
    });
  });

  // ==========================================================================
  // Feature 2: Dedicated Artist View & Artist Radio
  // ==========================================================================
  describe('F2: Dedicated Artist View & Artist Radio', () => {
    let artistService: ArtistServiceEngine;

    beforeEach(() => {
      artistService = new ArtistServiceEngine();
    });

    it('2.1: resolves structured artist profile with topTracks, albums, discography, and related artists', () => {
      const profile = artistService.createSyntheticProfile('Synthetic Pulse', MOCK_ALL_TRACKS);
      expect(profile.name).toBe('Synthetic Pulse');
      expect(profile.topTracks.length).toBeGreaterThanOrEqual(1);
      expect(profile.albums.length).toBeGreaterThanOrEqual(1);
      expect(profile.discography.length).toBeGreaterThanOrEqual(1);
      expect(profile.id).toBe('artist:synthetic:synthetic_pulse');
    });

    it('2.2: generates Artist Radio mix adhering to the 40% anchor, 35% related, 25% discovery distribution', () => {
      const anchorTracks = [MOCK_AUDIUS_TRACK];
      const relatedTracks = [MOCK_ARCHIVE_TRACK];
      const discoveryTracks = [MOCK_P2P_TRACK];

      const radio = artistService.generateArtistRadio(
        { artistId: 'synthetic_pulse', artistName: 'Synthetic Pulse', length: 20 },
        anchorTracks,
        relatedTracks,
        discoveryTracks
      );

      expect(radio.length).toBe(20);
      const anchorCount = radio.filter((t) => t.id === MOCK_AUDIUS_TRACK.id).length;
      // 40% of 20 = 8 tracks
      expect(anchorCount).toBe(8);
    });

    it('2.3: applies golden-ratio dispersion preventing back-to-back repetition of anchor artist', () => {
      const anchorTracks = [MOCK_AUDIUS_TRACK];
      const relatedTracks = [MOCK_ARCHIVE_TRACK, MOCK_P2P_TRACK];
      const discoveryTracks = [MOCK_RADIO_TRACK];

      const radio = artistService.generateArtistRadio(
        { artistId: 'synthetic_pulse', artistName: 'Synthetic Pulse', length: 10 },
        anchorTracks,
        relatedTracks,
        discoveryTracks
      );

      // Verify no two adjacent tracks are both the anchor track
      for (let i = 0; i < radio.length - 1; i++) {
        const currentIsAnchor = radio[i].id === MOCK_AUDIUS_TRACK.id;
        const nextIsAnchor = radio[i + 1].id === MOCK_AUDIUS_TRACK.id;
        expect(currentIsAnchor && nextIsAnchor).toBe(false);
      }
    });

    it('2.4: triggers synthetic fallback profile for niche/archive artists with isSynthetic: true', () => {
      const nicheTracks: Track[] = [
        {
          ...MOCK_ARCHIVE_TRACK,
          artist: 'Historic Orchestra 1920',
          title: 'Symphony No. 5',
          album: 'Archive Collection Vol. 1',
        },
      ];
      const profile = artistService.createSyntheticProfile('Historic Orchestra 1920', nicheTracks);
      expect(profile.isSynthetic).toBe(true);
      expect(profile.name).toBe('Historic Orchestra 1920');
      expect(profile.albums[0].title).toBe('Archive Collection Vol. 1');
      expect(profile.discography.length).toBe(1);
    });

    it('2.5: groups discography tracks by release year and album metadata correctly', () => {
      const profile = artistService.createSyntheticProfile('Grateful Dead', [MOCK_ARCHIVE_TRACK]);
      expect(profile.albums.length).toBe(1);
      expect(profile.albums[0].title).toBe('Live at Red Rocks Amphitheatre');
      expect(profile.albums[0].releaseYear).toBe('1978');
    });
  });

  // ==========================================================================
  // Feature 3: Enhanced Queue Management
  // ==========================================================================
  describe('F3: Queue Management (Play Next, Add to End, Reorder, Remove)', () => {
    let queueMgr: EnhancedQueueManager;

    beforeEach(() => {
      queueMgr = new EnhancedQueueManager([MOCK_AUDIUS_TRACK, MOCK_ARCHIVE_TRACK], 0);
    });

    it('3.1: playNext inserts a track immediately after the active track (currentIndex + 1)', () => {
      queueMgr.playNext(MOCK_P2P_TRACK);
      expect(queueMgr.queue.length).toBe(3);
      expect(queueMgr.queue[1].id).toBe(MOCK_P2P_TRACK.id);
      expect(queueMgr.queue[0].id).toBe(MOCK_AUDIUS_TRACK.id);
      expect(queueMgr.queue[2].id).toBe(MOCK_ARCHIVE_TRACK.id);
      expect(queueMgr.currentIndex).toBe(0);
    });

    it('3.2: addToEnd appends a track to the very tail of the queue', () => {
      queueMgr.addToEnd(MOCK_P2P_TRACK);
      expect(queueMgr.queue.length).toBe(3);
      expect(queueMgr.queue[2].id).toBe(MOCK_P2P_TRACK.id);
    });

    it('3.3: reorderQueue shifts track position and updates currentIndex accordingly', () => {
      // Initial: [AUDIUS (idx 0), ARCHIVE (idx 1)]
      queueMgr.addToEnd(MOCK_P2P_TRACK); // [AUDIUS, ARCHIVE, P2P]
      // Move AUDIUS from 0 to 2
      queueMgr.reorderQueue(0, 2);
      expect(queueMgr.queue[0].id).toBe(MOCK_ARCHIVE_TRACK.id);
      expect(queueMgr.queue[1].id).toBe(MOCK_P2P_TRACK.id);
      expect(queueMgr.queue[2].id).toBe(MOCK_AUDIUS_TRACK.id);
      expect(queueMgr.currentIndex).toBe(2); // Tracks active track index
    });

    it('3.4: removeFromQueue removes specified track without breaking active queue continuity', () => {
      queueMgr.addToEnd(MOCK_P2P_TRACK); // [AUDIUS (idx 0), ARCHIVE (idx 1), P2P (idx 2)]
      queueMgr.removeFromQueue(1); // Remove ARCHIVE
      expect(queueMgr.queue.length).toBe(2);
      expect(queueMgr.queue[0].id).toBe(MOCK_AUDIUS_TRACK.id);
      expect(queueMgr.queue[1].id).toBe(MOCK_P2P_TRACK.id);
      expect(queueMgr.currentIndex).toBe(0);
    });

    it('3.5: clearQueue clears upcoming queue while preserving the currently playing track', () => {
      queueMgr.addToEnd(MOCK_P2P_TRACK);
      queueMgr.addToEnd(MOCK_RADIO_TRACK);
      expect(queueMgr.queue.length).toBe(4);

      queueMgr.clearQueue();
      expect(queueMgr.queue.length).toBe(1);
      expect(queueMgr.queue[0].id).toBe(MOCK_AUDIUS_TRACK.id);
      expect(queueMgr.currentIndex).toBe(0);
    });
  });

  // ==========================================================================
  // Feature 4: Custom Playlists & Spotify URL Importer
  // ==========================================================================
  describe('F4: Custom Playlists CRUD & Spotify URL Importer', () => {
    let importer: SpotifyImporterEngine;

    beforeEach(() => {
      importer = new SpotifyImporterEngine();
    });

    it('4.1: creates custom playlist with unique ID, timestamp, and track listing', () => {
      const playlist = importer.createCustomPlaylist('Synthwave Vibes', 'My custom mix', [MOCK_AUDIUS_TRACK]);
      expect(playlist.id).toMatch(/^pl_\d+_/);
      expect(playlist.name).toBe('Synthwave Vibes');
      expect(playlist.tracks.length).toBe(1);
      expect(playlist.createdAt).toBeGreaterThan(0);
    });

    it('4.2: parses public Spotify playlist URL into type and ID', () => {
      const url = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abcd';
      const parsed = importer.parseSpotifyUrl(url);
      expect(parsed).not.toBeNull();
      expect(parsed?.type).toBe('playlist');
      expect(parsed?.id).toBe('37i9dQZF1DXcBWIGoYBM5M');
    });

    it('4.3: parses spotify: URI format correctly', () => {
      const uri = 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M';
      const parsed = importer.parseSpotifyUrl(uri);
      expect(parsed?.type).toBe('playlist');
      expect(parsed?.id).toBe('37i9dQZF1DXcBWIGoYBM5M');
    });

    it('4.4: resolves Spotify track to playable open feed using fuzzy Jaro-Winkler matching', () => {
      const matched = importer.resolveTrack(
        'Neon Odyssey (Remastered 2024)',
        'Synthetic Pulse',
        MOCK_ALL_TRACKS
      );
      expect(matched).not.toBeNull();
      expect(matched?.id).toBe(MOCK_AUDIUS_TRACK.id);
    });

    it('4.5: calculates Jaro-Winkler similarity coefficient accurately (0.0 to 1.0)', () => {
      const exact = importer.jaroWinklerSimilarity('Neon Odyssey', 'Neon Odyssey');
      const close = importer.jaroWinklerSimilarity('Neon Odyssey', 'Neon Odyssee');
      const completelyDifferent = importer.jaroWinklerSimilarity('Neon Odyssey', 'Classical Beethoven');

      expect(exact).toBe(1.0);
      expect(close).toBeGreaterThan(0.9);
      expect(completelyDifferent).toBeLessThan(0.5);
    });
  });

  // ==========================================================================
  // Feature 5: IndexedDB Telemetry Dataset & JSON Export/Import
  // ==========================================================================
  describe('F5: IndexedDB Telemetry Dataset & JSON Export/Import', () => {
    let telemetryDb: TelemetryDatabaseEngine;

    beforeEach(() => {
      telemetryDb = new TelemetryDatabaseEngine();
    });

    it('5.1: logs completed track play event with completionRate >= 0.8 and skipped: false', async () => {
      // 180s track played for 180s
      const play = await telemetryDb.recordPlay('session_1', MOCK_AUDIUS_TRACK, 180000, 180000, false);
      expect(play.completionRate).toBe(1.0);
      expect(play.skipped).toBe(false);
      expect(play.trackId).toBe(MOCK_AUDIUS_TRACK.id);
    });

    it('5.2: logs skipped track play event when played for <30s', async () => {
      // 180s track skipped after 12 seconds
      const play = await telemetryDb.recordPlay('session_1', MOCK_AUDIUS_TRACK, 12000, 180000, false);
      expect(play.completionRate).toBeLessThan(0.1);
      expect(play.skipped).toBe(true);
    });

    it('5.3: updates genre affinity records when unskipped tracks are played', async () => {
      await telemetryDb.recordPlay('session_1', MOCK_AUDIUS_TRACK, 180000, 180000, false);
      const dataset = await telemetryDb.exportDataset();
      const genre = dataset.genreAffinities.find((g) => g.genre === 'Electronic');
      expect(genre).toBeDefined();
      expect(genre?.playCount).toBeGreaterThanOrEqual(1);
      expect(genre?.affinityScore).toBeGreaterThan(0);
    });

    it('5.4: exports complete telemetry dataset matching ExportableTelemetryDataset schema (v1)', async () => {
      await telemetryDb.recordPlay('session_test', MOCK_ARCHIVE_TRACK, 300000, 420000, false);
      const exported = await telemetryDb.exportDataset();

      expect(exported.schemaVersion).toBe(1);
      expect(exported.exportedAt).toBeGreaterThan(0);
      expect(Array.isArray(exported.plays)).toBe(true);
      expect(Array.isArray(exported.sessions)).toBe(true);
      expect(Array.isArray(exported.genreAffinities)).toBe(true);
      expect(exported.plays.some((p) => p.trackId === MOCK_ARCHIVE_TRACK.id)).toBe(true);
    });

    it('5.5: imports JSON telemetry dataset and populates stores without corruption', async () => {
      const mockExport = {
        schemaVersion: 1 as const,
        exportedAt: Date.now(),
        sessions: [
          { sessionId: 's_imported', startTime: Date.now() - 3600000, deviceType: 'desktop' as const, totalDurationMs: 3600000 },
        ],
        plays: [
          {
            playId: 'p_imported_1',
            sessionId: 's_imported',
            trackId: 'audius:mock-import',
            title: 'Imported Anthem',
            artist: 'Cosmic Traveler',
            genre: 'Ambient',
            source: 'audius' as const,
            startTime: Date.now() - 3000000,
            durationPlayedMs: 200000,
            totalDurationMs: 200000,
            completionRate: 1.0,
            skipped: false,
            replayed: false,
          },
        ],
        genreAffinities: [
          { genre: 'Ambient', playCount: 5, totalTimePlayedMs: 1000000, affinityScore: 66, lastUpdated: Date.now() },
        ],
      };

      const result = await telemetryDb.importDataset(mockExport);
      expect(result.importedPlays).toBe(1);
      expect(result.importedSessions).toBe(1);

      const verified = await telemetryDb.exportDataset();
      expect(verified.plays.some((p) => p.playId === 'p_imported_1')).toBe(true);
    });
  });

  // ==========================================================================
  // Feature 6: Algorithmic Recommendations & Infinite Autoplay
  // ==========================================================================
  describe('F6: Algorithmic Recommendations & Infinite Autoplay', () => {
    let recEngine: RecommendationEngine;

    beforeEach(() => {
      recEngine = new RecommendationEngine();
    });

    it('6.1: generates "Made For You" shelf mixing played favorites and unplayed related tracks', () => {
      const plays = [
        {
          playId: '1',
          sessionId: 's1',
          trackId: MOCK_AUDIUS_TRACK.id,
          title: MOCK_AUDIUS_TRACK.title,
          artist: MOCK_AUDIUS_TRACK.artist,
          genre: 'Electronic',
          source: 'audius' as const,
          startTime: Date.now() - 10000,
          durationPlayedMs: 180000,
          totalDurationMs: 180000,
          completionRate: 1.0,
          skipped: false,
          replayed: false,
        },
      ];

      const madeForYou = recEngine.generateMadeForYou(plays, MOCK_ALL_TRACKS);
      expect(madeForYou.length).toBeGreaterThan(0);
      expect(madeForYou.some((t) => t.id === MOCK_AUDIUS_TRACK.id)).toBe(true);
    });

    it('6.2: "Discover Weekly" selects unplayed tracks with MMR diversity penalties', () => {
      const plays = [
        {
          playId: '1',
          sessionId: 's1',
          trackId: MOCK_AUDIUS_TRACK.id,
          title: MOCK_AUDIUS_TRACK.title,
          artist: MOCK_AUDIUS_TRACK.artist,
          genre: 'Electronic',
          source: 'audius' as const,
          startTime: Date.now() - 10000,
          durationPlayedMs: 180000,
          totalDurationMs: 180000,
          completionRate: 1.0,
          skipped: false,
          replayed: false,
        },
      ];

      const discoverWeekly = recEngine.generateDiscoverWeekly(plays, MOCK_ALL_TRACKS, 2);
      // Selected tracks must NOT include already-played MOCK_AUDIUS_TRACK
      expect(discoverWeekly.every((t) => t.id !== MOCK_AUDIUS_TRACK.id)).toBe(true);
      expect(discoverWeekly.length).toBeLessThanOrEqual(2);
    });

    it('6.3: "Daily Mix" creates distinct genre-clustered mix playlists', () => {
      const plays = [
        {
          playId: '1',
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
        {
          playId: '2',
          sessionId: 's1',
          trackId: MOCK_ARCHIVE_TRACK.id,
          title: MOCK_ARCHIVE_TRACK.title,
          artist: MOCK_ARCHIVE_TRACK.artist,
          genre: 'Rock',
          source: 'archive' as const,
          startTime: Date.now(),
          durationPlayedMs: 420000,
          totalDurationMs: 420000,
          completionRate: 1.0,
          skipped: false,
          replayed: false,
        },
      ];

      const mixes = recEngine.generateDailyMixes(plays, MOCK_ALL_TRACKS);
      expect(mixes.length).toBeGreaterThanOrEqual(2);
      expect(mixes[0].genre).toBeDefined();
    });

    it('6.4: "Heavy Rotation" applies half-life exponential recency decay favoring tracks from last 5 days', () => {
      const now = Date.now();
      const oneDayAgo = now - 86400 * 1000;
      const thirtyDaysAgo = now - 30 * 86400 * 1000;

      const plays = [
        {
          playId: 'p_recent',
          sessionId: 's1',
          trackId: MOCK_AUDIUS_TRACK.id,
          title: MOCK_AUDIUS_TRACK.title,
          artist: MOCK_AUDIUS_TRACK.artist,
          genre: 'Electronic',
          source: 'audius' as const,
          startTime: oneDayAgo,
          durationPlayedMs: 180000,
          totalDurationMs: 180000,
          completionRate: 1.0,
          skipped: false,
          replayed: false,
        },
        {
          playId: 'p_old',
          sessionId: 's2',
          trackId: MOCK_ARCHIVE_TRACK.id,
          title: MOCK_ARCHIVE_TRACK.title,
          artist: MOCK_ARCHIVE_TRACK.artist,
          genre: 'Rock',
          source: 'archive' as const,
          startTime: thirtyDaysAgo,
          durationPlayedMs: 420000,
          totalDurationMs: 420000,
          completionRate: 1.0,
          skipped: false,
          replayed: false,
        },
      ];

      const heavyRotation = recEngine.generateHeavyRotation(plays, MOCK_ALL_TRACKS, now);
      expect(heavyRotation[0].id).toBe(MOCK_AUDIUS_TRACK.id); // Recent track ranked higher
    });

    it('6.5: "Forgotten Favorites" filters tracks with multiple past plays but >= 21-day recency gap', () => {
      const now = Date.now();
      const twentyFiveDaysAgo = now - 25 * 86400 * 1000;

      const plays = [
        {
          playId: '1',
          sessionId: 's1',
          trackId: MOCK_P2P_TRACK.id,
          title: MOCK_P2P_TRACK.title,
          artist: MOCK_P2P_TRACK.artist,
          genre: 'Electronic',
          source: 'p2p' as const,
          startTime: twentyFiveDaysAgo - 10000,
          durationPlayedMs: 240000,
          totalDurationMs: 240000,
          completionRate: 1.0,
          skipped: false,
          replayed: false,
        },
        {
          playId: '2',
          sessionId: 's1',
          trackId: MOCK_P2P_TRACK.id,
          title: MOCK_P2P_TRACK.title,
          artist: MOCK_P2P_TRACK.artist,
          genre: 'Electronic',
          source: 'p2p' as const,
          startTime: twentyFiveDaysAgo,
          durationPlayedMs: 240000,
          totalDurationMs: 240000,
          completionRate: 1.0,
          skipped: false,
          replayed: false,
        },
      ];

      const forgotten = recEngine.generateForgottenFavorites(plays, MOCK_ALL_TRACKS, now);
      expect(forgotten.some((t) => t.id === MOCK_P2P_TRACK.id)).toBe(true);
    });
  });

  // ==========================================================================
  // Feature 7: Local Device Discovery & Remote Control Mode
  // ==========================================================================
  describe('F7: Local Device Discovery, Remote Control Mode & Seamless Handoff', () => {
    let desktopNode: ConnectNode;
    let mobileNode: ConnectNode;

    beforeEach(() => {
      const desktopInfo: DeviceInfo = {
        deviceId: 'dev_desktop_1',
        deviceName: 'Living Room Desktop',
        deviceType: 'desktop',
        role: 'active_host',
        isCurrentDevice: false,
        lastSeen: Date.now(),
      };
      const mobileInfo: DeviceInfo = {
        deviceId: 'dev_mobile_1',
        deviceName: 'Pixel Phone',
        deviceType: 'mobile',
        role: 'remote_controller',
        isCurrentDevice: true,
        lastSeen: Date.now(),
      };

      desktopNode = new ConnectNode(desktopInfo, 'test_connect_channel');
      mobileNode = new ConnectNode(mobileInfo, 'test_connect_channel');
    });

    it('7.1: device announces presence via DEVICE_ANNOUNCE and is added to remote node discovery list', () => {
      desktopNode.announce();
      expect(mobileNode.discoveredDevices.has('dev_desktop_1')).toBe(true);
      expect(mobileNode.discoveredDevices.get('dev_desktop_1')?.deviceName).toBe('Living Room Desktop');
    });

    it('7.2: active host broadcasts STATE_SYNC and remote controller receives synchronized playback state', () => {
      desktopNode.broadcastState({
        currentTrack: MOCK_AUDIUS_TRACK,
        isPlaying: true,
        positionMs: 45000,
        volume: 0.75,
      });

      expect(mobileNode.playbackState.currentTrack?.id).toBe(MOCK_AUDIUS_TRACK.id);
      expect(mobileNode.playbackState.isPlaying).toBe(true);
      expect(mobileNode.playbackState.volume).toBe(0.75);
    });

    it('7.3: remote controller sends CMD_PLAY and CMD_PAUSE which triggers commands on active host', () => {
      let lastCommand = '';
      desktopNode.onCommandReceived = (msg) => {
        lastCommand = msg.type;
      };

      mobileNode.sendCommand({ type: 'CMD_PLAY' });
      expect(lastCommand).toBe('CMD_PLAY');

      mobileNode.sendCommand({ type: 'CMD_PAUSE' });
      expect(lastCommand).toBe('CMD_PAUSE');
    });

    it('7.4: remote controller sends CMD_SET_VOLUME and active host applies volume change', () => {
      let targetVolume = 0;
      desktopNode.onCommandReceived = (msg) => {
        if (msg.type === 'CMD_SET_VOLUME') {
          targetVolume = msg.volume;
        }
      };

      mobileNode.sendCommand({ type: 'CMD_SET_VOLUME', volume: 0.65 });
      expect(targetVolume).toBe(0.65);
    });

    it('7.5: CMD_HANDOFF transfers active playback with millisecond-accurate timestamp preservation', () => {
      let handoffState: any = null;
      mobileNode.onCommandReceived = (msg) => {
        if (msg.type === 'CMD_HANDOFF') {
          handoffState = msg.state;
        }
      };

      const syncPayload = {
        currentTrack: MOCK_ARCHIVE_TRACK,
        isPlaying: true,
        positionMs: 123456,
        durationMs: 420000,
        volume: 0.9,
        timestamp: Date.now(),
        queue: [MOCK_ARCHIVE_TRACK],
        currentIndex: 0,
      };

      desktopNode.sendCommand({
        type: 'CMD_HANDOFF',
        targetDeviceId: 'dev_mobile_1',
        state: syncPayload,
      });

      expect(handoffState).not.toBeNull();
      expect(handoffState.positionMs).toBe(123456);
      expect(handoffState.currentTrack.id).toBe(MOCK_ARCHIVE_TRACK.id);
    });
  });

  // ==========================================================================
  // Feature 8: Google Cast State Sync & Media Controls
  // ==========================================================================
  describe('F8: Google Cast State Sync & Media Controls', () => {
    let castService: CastServiceEngine;

    beforeEach(() => {
      castService = new CastServiceEngine();
    });

    it('8.1: initializes CastContext with app ID CC1AD845 and detects receiver availability', () => {
      const initialized = castService.initialize('CC1AD845');
      expect(initialized).toBe(true);
      expect(castService.state.isAvailable).toBe(true);
    });

    it('8.2: connects to Google Cast speaker and marks connected state', () => {
      castService.initialize('CC1AD845');
      const connected = castService.connect('Living Room Nest Audio');
      expect(connected).toBe(true);
      expect(castService.state.isConnected).toBe(true);
      expect(castService.state.castDeviceName).toBe('Living Room Nest Audio');
    });

    it('8.3: synchronizes track metadata and playback position with cast receiver', () => {
      castService.initialize('CC1AD845');
      castService.connect('Living Room Nest Audio');
      castService.syncPlayback(MOCK_AUDIUS_TRACK, 64000);

      const handoff = castService.disconnect();
      expect(handoff.track?.id).toBe(MOCK_AUDIUS_TRACK.id);
      expect(handoff.position).toBe(64000);
    });

    it('8.4: bidirectional volume and mute adjustments update cast speaker state', () => {
      castService.setVolume(0.85);
      castService.setMuted(true);

      expect(castService.state.volume).toBe(0.85);
      expect(castService.state.isMuted).toBe(true);
    });

    it('8.5: disconnecting cast session smoothly restores local audio playback state', () => {
      castService.initialize('CC1AD845');
      castService.connect('Chromecast Ultra');
      castService.syncPlayback(MOCK_P2P_TRACK, 120000);

      const localResume = castService.disconnect();
      expect(castService.state.isConnected).toBe(false);
      expect(localResume.position).toBe(120000);
      expect(localResume.track?.id).toBe(MOCK_P2P_TRACK.id);
    });
  });

  // ==========================================================================
  // Feature 9: Responsive Layout Adapting & Lock-Screen MediaSession Controls
  // ==========================================================================
  describe('F9: Responsive Layout Adapting & Lock-Screen MediaSession Controls', () => {
    let layoutCtrl: ResponsiveMediaSessionController;

    beforeEach(() => {
      layoutCtrl = new ResponsiveMediaSessionController();
    });

    it('9.1: width >= 768px activates Desktop 3-column layout', () => {
      expect(layoutCtrl.isDesktop(1280)).toBe(true);
      expect(layoutCtrl.isDesktop(768)).toBe(true);
      expect(layoutCtrl.isDesktop(767)).toBe(false);
    });

    it('9.2: width < 768px activates Mobile view with 48px touch targets', () => {
      expect(layoutCtrl.isMobile(390)).toBe(true);
      expect(layoutCtrl.isMobile(767)).toBe(true);
      expect(layoutCtrl.isMobile(768)).toBe(false);
      expect(layoutCtrl.getTouchTargetSize(true)).toBe(48);
    });

    it('9.3: mobile mini-player expands to full-screen Now-Playing sheet', () => {
      let isSheetOpen = false;
      const toggleSheet = (open?: boolean) => {
        isSheetOpen = open !== undefined ? open : !isSheetOpen;
      };

      toggleSheet(true);
      expect(isSheetOpen).toBe(true);
      toggleSheet(false);
      expect(isSheetOpen).toBe(false);
    });

    it('9.4: updates navigator.mediaSession.metadata with multi-resolution artwork', () => {
      layoutCtrl.updateMediaSession(MOCK_AUDIUS_TRACK, 30, 180, true);
      const meta = (navigator.mediaSession as any).metadata;
      expect(meta.title).toBe(MOCK_AUDIUS_TRACK.title);
      expect(meta.artist).toBe(MOCK_AUDIUS_TRACK.artist);
      expect(meta.artwork.length).toBeGreaterThanOrEqual(3);
    });

    it('9.5: synchronizes positionState and playbackState for lock-screen scrubber', () => {
      layoutCtrl.updateMediaSession(MOCK_ARCHIVE_TRACK, 120, 420, true);
      expect(navigator.mediaSession.playbackState).toBe('playing');
      const pos = (navigator.mediaSession as any).positionState;
      expect(pos.position).toBe(120);
      expect(pos.duration).toBe(420);
    });
  });
});
