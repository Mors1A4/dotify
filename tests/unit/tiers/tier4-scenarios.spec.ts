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
  Track,
} from '../../fixtures/mockData';

describe('Tier 4: Real-World Application Scenarios — Dotify Upgrade Ecosystem', () => {
  let cacheEngine: AudioCacheEngine;
  let artistService: ArtistServiceEngine;
  let importer: SpotifyImporterEngine;
  let telemetryDb: TelemetryDatabaseEngine;
  let recEngine: RecommendationEngine;
  let castService: CastServiceEngine;
  let layoutCtrl: ResponsiveMediaSessionController;

  const MOCK_EXTENDED_CATALOGUE: Track[] = [
    MOCK_AUDIUS_TRACK,
    MOCK_ARCHIVE_TRACK,
    MOCK_RADIO_TRACK,
    MOCK_P2P_TRACK,
    { ...MOCK_AUDIUS_TRACK, id: 'cat_1', title: 'Solar Flares', artist: 'Synthetic Pulse', sourceMetadata: { genre: 'Electronic' } },
    { ...MOCK_AUDIUS_TRACK, id: 'cat_2', title: 'Cosmic Rays', artist: 'Synthetic Pulse', sourceMetadata: { genre: 'Electronic' } },
    { ...MOCK_AUDIUS_TRACK, id: 'cat_rel_1', title: 'Grid Runner', artist: 'Cyber Grid', sourceMetadata: { genre: 'Electronic' } },
    { ...MOCK_AUDIUS_TRACK, id: 'cat_rel_2', title: 'Neon Highway', artist: 'Cyber Grid', sourceMetadata: { genre: 'Electronic' } },
    { ...MOCK_ARCHIVE_TRACK, id: 'cat_3', title: 'Truckin (Live 1978)', artist: 'Grateful Dead', sourceMetadata: { genre: 'Rock' } },
    { ...MOCK_ARCHIVE_TRACK, id: 'cat_4', title: 'Sugar Magnolia', artist: 'Grateful Dead', sourceMetadata: { genre: 'Rock' } },
    { ...MOCK_P2P_TRACK, id: 'cat_5', title: 'Deep Ocean Ambient', artist: 'Soundscape Lab', sourceMetadata: { genre: 'Ambient' } },
    { ...MOCK_P2P_TRACK, id: 'cat_6', title: 'Rainforest Echoes', artist: 'Soundscape Lab', sourceMetadata: { genre: 'Ambient' } },
  ];

  beforeEach(async () => {
    cacheEngine = new AudioCacheEngine();
    await cacheEngine.clearCache();
    artistService = new ArtistServiceEngine();
    importer = new SpotifyImporterEngine();
    telemetryDb = new TelemetryDatabaseEngine();
    recEngine = new RecommendationEngine();
    castService = new CastServiceEngine();
    layoutCtrl = new ResponsiveMediaSessionController();
  });

  // ==========================================================================
  // Scenario 1: Daily Commute
  // ==========================================================================
  it('Scenario 1: Daily Commute (Spotify Import -> Pre-warming -> Offline Subway -> Telemetry -> Daily Mix)', async () => {
    // 1. User pastes public Spotify playlist URL into Library
    const spotifyUrl = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
    const parsedUrl = importer.parseSpotifyUrl(spotifyUrl);
    expect(parsedUrl).not.toBeNull();
    expect(parsedUrl?.type).toBe('playlist');

    // 2. Scraper resolves Spotify tracks to playable open streams via fuzzy matching
    const rawSpotifyTracks = [
      { title: 'Neon Odyssey (Remaster)', artist: 'Synthetic Pulse' },
      { title: 'Red Rocks 1978 Live', artist: 'Grateful Dead' },
      { title: 'Open Source Symphonics', artist: 'Open Source Collective' },
    ];
    const resolvedTracks: Track[] = [];
    for (const t of rawSpotifyTracks) {
      const match = importer.resolveTrack(t.title, t.artist, MOCK_EXTENDED_CATALOGUE);
      if (match) resolvedTracks.push(match);
    }
    expect(resolvedTracks.length).toBe(3);

    // 3. User saves to custom playlist "Morning Commute"
    const commutePlaylist = importer.createCustomPlaylist('Morning Commute', 'Saved for commute', resolvedTracks);
    expect(commutePlaylist.tracks.length).toBe(3);

    // 4. Queue starts and predictive pre-warming caches upcoming tracks
    const queue = new EnhancedQueueManager(commutePlaylist.tracks, 0);
    await cacheEngine.prewarmQueue(queue.queue, queue.currentIndex, 2);
    const cacheStats = await cacheEngine.getCacheStats();
    expect(cacheStats.entryCount).toBe(2);

    // 5. Subway entry: Network drops offline -> playback continues smoothly from cache
    const offlineUrl1 = await cacheEngine.getCachedStreamUrl(queue.queue[1].id, 'https://offline-dropped.invalid');
    const offlineUrl2 = await cacheEngine.getCachedStreamUrl(queue.queue[2].id, 'https://offline-dropped.invalid');
    expect(offlineUrl1).toContain('blob:dotify-cache');
    expect(offlineUrl2).toContain('blob:dotify-cache');

    // 6. User listens to tracks: completes 2 tracks, skips 1 track
    const sessionId = 'session_commute_01';
    await telemetryDb.recordPlay(sessionId, queue.queue[0], 180000, 180000, false); // Complete Track 1
    queue.advanceTrack();
    await telemetryDb.recordPlay(sessionId, queue.queue[1], 420000, 420000, false); // Complete Track 2
    queue.advanceTrack();
    await telemetryDb.recordPlay(sessionId, queue.queue[2], 15000, 240000, false); // Skip Track 3 (15s < 30s)

    // 7. Network reconnects upon arrival: recommendations refresh "Daily Mix" and "Heavy Rotation"
    const telemetryData = await telemetryDb.exportDataset();
    expect(telemetryData.plays.length).toBe(3);
    const skippedPlay = telemetryData.plays.find((p) => p.trackId === queue.queue[2].id);
    expect(skippedPlay?.skipped).toBe(true);

    const heavyRotation = recEngine.generateHeavyRotation(telemetryData.plays, MOCK_EXTENDED_CATALOGUE);
    expect(heavyRotation.length).toBeGreaterThan(0);
    // Highest rotation track is one of the completed tracks
    expect([queue.queue[0].id, queue.queue[1].id]).toContain(heavyRotation[0].id);

    const dailyMixes = recEngine.generateDailyMixes(telemetryData.plays, MOCK_EXTENDED_CATALOGUE);
    expect(dailyMixes.length).toBeGreaterThanOrEqual(1);
    expect(dailyMixes[0].tracks.length).toBeGreaterThan(0);
  });

  // ==========================================================================
  // Scenario 2: Remote Party
  // ==========================================================================
  it('Scenario 2: Remote Party (Desktop Host -> Mobile Connect -> Remote Play Next -> Volume Control -> Zero Audio Feedback)', () => {
    // 1. Desktop app acts as active host connected to stereo speakers
    const desktopHost = new ConnectNode(
      { deviceId: 'desktop_stereo', deviceName: 'Living Room Desktop', deviceType: 'desktop', role: 'active_host', isCurrentDevice: true, lastSeen: Date.now() },
      'party_connect_channel'
    );
    const hostQueue = new EnhancedQueueManager([MOCK_AUDIUS_TRACK], 0);

    // 2. Friend opens Dotify on mobile phone -> discovers desktop host over LAN
    const phoneRemote = new ConnectNode(
      { deviceId: 'phone_guest', deviceName: "Sarah's iPhone", deviceType: 'mobile', role: 'remote_controller', isCurrentDevice: false, lastSeen: Date.now() },
      'party_connect_channel'
    );

    desktopHost.announce();
    phoneRemote.announce();

    expect(phoneRemote.discoveredDevices.has('desktop_stereo')).toBe(true);
    expect(desktopHost.discoveredDevices.has('phone_guest')).toBe(true);

    // 3. Desktop broadcasts initial playback state
    desktopHost.broadcastState({
      currentTrack: MOCK_AUDIUS_TRACK,
      isPlaying: true,
      volume: 0.9,
      positionMs: 30000,
    });
    expect(phoneRemote.playbackState.currentTrack?.id).toBe(MOCK_AUDIUS_TRACK.id);
    expect(phoneRemote.playbackState.volume).toBe(0.9);

    // 4. Friend selects a party track ("Rock Concert") and triggers "Play Next"
    desktopHost.onCommandReceived = (cmd) => {
      if (cmd.type === 'CMD_NEXT') {
        hostQueue.playNext(MOCK_ARCHIVE_TRACK);
        desktopHost.broadcastState({ queue: hostQueue.queue });
      }
      if (cmd.type === 'CMD_SET_VOLUME') {
        desktopHost.broadcastState({ volume: cmd.volume });
      }
    };

    phoneRemote.sendCommand({ type: 'CMD_NEXT' });
    expect(hostQueue.queue.length).toBe(2);
    expect(hostQueue.queue[1].id).toBe(MOCK_ARCHIVE_TRACK.id);

    // 5. Friend lowers volume to 0.65 to talk
    phoneRemote.sendCommand({ type: 'CMD_SET_VOLUME', volume: 0.65 });
    expect(desktopHost.playbackState.volume).toBe(0.65);
    expect(phoneRemote.playbackState.volume).toBe(0.65);

    // 6. Audio remains on desktop (active host), mobile phone only sends control RPCs (no local audio echo)
    expect(desktopHost.device.role).toBe('active_host');
    expect(phoneRemote.device.role).toBe('remote_controller');

    desktopHost.close();
    phoneRemote.close();
  });

  // ==========================================================================
  // Scenario 3: Smart Speaker Casting
  // ==========================================================================
  it('Scenario 3: Smart Speaker Casting (Desktop -> Cast Discovery -> Route to Nest Audio -> Controls Sync -> Disconnect Handoff)', () => {
    // 1. User starts streaming high-fidelity album on desktop
    const currentTrack = MOCK_ARCHIVE_TRACK;
    let currentPositionMs = 45000;

    // 2. User clicks Cast button -> Google Cast Web SDK discovers "Kitchen Nest Audio"
    const initSuccess = castService.initialize('CC1AD845');
    expect(initSuccess).toBe(true);
    expect(castService.state.isAvailable).toBe(true);

    // 3. User connects to speaker -> routes audio to receiver
    const connected = castService.connect('Kitchen Nest Audio');
    expect(connected).toBe(true);
    expect(castService.state.isConnected).toBe(true);

    // 4. Dotify synchronizes track and position with speaker
    castService.syncPlayback(currentTrack, currentPositionMs);

    // 5. User adjusts volume to 70% and seeks to 1:45 (105000ms) on Dotify UI
    castService.setVolume(0.7);
    currentPositionMs = 105000;
    castService.syncPlayback(currentTrack, currentPositionMs);
    expect(castService.state.volume).toBe(0.7);

    // 6. User disconnects Cast session -> audio immediately handoffs back to desktop local player at 1:45
    const localHandoff = castService.disconnect();
    expect(castService.state.isConnected).toBe(false);
    expect(localHandoff.track?.id).toBe(MOCK_ARCHIVE_TRACK.id);
    expect(localHandoff.position).toBe(105000); // Millisecond accurate resumption
  });

  // ==========================================================================
  // Scenario 4: Artist Deep-Dive
  // ==========================================================================
  it('Scenario 4: Artist Deep-Dive (Search -> Dedicated Artist Profile -> Discography -> 25-Track Radio with Dispersion)', () => {
    // 1. User navigates to dedicated profile for "Synthetic Pulse"
    const profile = artistService.createSyntheticProfile('Synthetic Pulse', MOCK_EXTENDED_CATALOGUE);
    expect(profile.name).toBe('Synthetic Pulse');
    expect(profile.topTracks.length).toBeGreaterThanOrEqual(2);
    expect(profile.albums.length).toBeGreaterThanOrEqual(1);

    // 2. Discography inspection: tracks grouped by album
    const firstAlbum = profile.albums[0];
    expect(firstAlbum.title).toBeDefined();
    expect(firstAlbum.trackCount).toBeGreaterThanOrEqual(1);

    // 3. User launches instant "Artist Radio"
    const anchorTracks = profile.discography;
    const relatedTracks = MOCK_EXTENDED_CATALOGUE.filter((t) => t.sourceMetadata?.genre === 'Electronic' && t.artist !== 'Synthetic Pulse');
    const discoveryTracks = MOCK_EXTENDED_CATALOGUE.filter((t) => t.sourceMetadata?.genre !== 'Electronic');

    const radioMix = artistService.generateArtistRadio(
      { artistId: profile.id, artistName: profile.name, length: 25 },
      anchorTracks,
      relatedTracks,
      discoveryTracks
    );

    // 4. Verifies radio mix length (25) and target ratios (40% anchor, 35% related, 25% discovery)
    expect(radioMix.length).toBe(25);
    const anchorCount = radioMix.filter((t) => t.artist === 'Synthetic Pulse').length;
    expect(anchorCount).toBe(10); // Exactly 40% of 25 = 10 tracks

    // 5. Golden-ratio dispersion check: Anchor tracks are interleaved so user does not hear consecutive repeats
    for (let i = 0; i < radioMix.length - 1; i++) {
      if (radioMix[i].artist === 'Synthetic Pulse') {
        expect(radioMix[i + 1].artist).not.toBe('Synthetic Pulse');
      }
    }
  });

  // ==========================================================================
  // Scenario 5: Queue Runout to Infinite Autoplay
  // ==========================================================================
  it('Scenario 5: Queue Runout to Infinite Autoplay (3-Track Queue -> Tail Exhaustion -> 5 Contextual Tracks Appended)', async () => {
    // 1. User starts 3-track queue with Autoplay enabled
    const shortQueue = [
      MOCK_AUDIUS_TRACK, // Track 0 (Electronic)
      { ...MOCK_AUDIUS_TRACK, id: 'q_track_1', title: 'Cyber Highway' }, // Track 1
      { ...MOCK_AUDIUS_TRACK, id: 'q_track_2', title: 'Neon Sunset' }, // Track 2 (Final track)
    ];
    const queueMgr = new EnhancedQueueManager(shortQueue, 0);
    expect(queueMgr.queue.length).toBe(3);
    expect(queueMgr.autoplayEnabled).toBe(true);

    let autoplayActivated = false;
    queueMgr.setAutoplayCallback(() => {
      autoplayActivated = true;
      // Calculate 5 contextual recommendations based on current track genre ('Electronic')
      const contextualTracks = recEngine.generateAutoplay(
        queueMgr.queue[queueMgr.currentIndex],
        [],
        MOCK_EXTENDED_CATALOGUE,
        5
      );
      contextualTracks.forEach((t) => queueMgr.addToEnd(t));
    });

    // 2. Play Track 0 -> completes -> advance to Track 1
    queueMgr.advanceTrack();
    expect(queueMgr.currentIndex).toBe(1);
    expect(autoplayActivated).toBe(false);

    // 3. Play Track 1 -> completes -> advance to Track 2 (Tail of initial queue)
    queueMgr.advanceTrack();
    expect(queueMgr.currentIndex).toBe(2);
    expect(autoplayActivated).toBe(false);

    // 4. Play Track 2 -> finishes -> Queue exhaustion triggers Autoplay
    queueMgr.advanceTrack();
    expect(autoplayActivated).toBe(true);

    // 5. 5 new contextual tracks are appended seamlessly with zero playback gap
    expect(queueMgr.queue.length).toBe(8); // 3 original + 5 autoplay tracks
    expect(queueMgr.queue[3].sourceMetadata?.genre).toBe('Electronic');
  });
});
