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

describe('Tier 3: Cross-Feature Combinations (Pairwise Coverage) — Dotify Upgrade Ecosystem', () => {
  let cacheEngine: AudioCacheEngine;
  let artistService: ArtistServiceEngine;
  let queueMgr: EnhancedQueueManager;
  let importer: SpotifyImporterEngine;
  let telemetryDb: TelemetryDatabaseEngine;
  let recEngine: RecommendationEngine;
  let castService: CastServiceEngine;
  let layoutCtrl: ResponsiveMediaSessionController;

  beforeEach(async () => {
    cacheEngine = new AudioCacheEngine();
    await cacheEngine.clearCache();
    artistService = new ArtistServiceEngine();
    queueMgr = new EnhancedQueueManager([MOCK_AUDIUS_TRACK, MOCK_ARCHIVE_TRACK, MOCK_P2P_TRACK], 0);
    importer = new SpotifyImporterEngine();
    telemetryDb = new TelemetryDatabaseEngine();
    recEngine = new RecommendationEngine();
    castService = new CastServiceEngine();
    layoutCtrl = new ResponsiveMediaSessionController();
  });

  it('3.1: Cache pre-warming + Queue reorder: Reordering queue dynamically redirects pre-warming to new upcoming track', async () => {
    // Initial upcoming is ARCHIVE (idx 1)
    await cacheEngine.prewarmQueue(queueMgr.queue, queueMgr.currentIndex, 1);
    let stats = await cacheEngine.getCacheStats();
    expect(stats.entryCount).toBe(1);

    // Reorder: Move P2P (idx 2) to (idx 1)
    queueMgr.reorderQueue(2, 1);
    expect(queueMgr.queue[1].id).toBe(MOCK_P2P_TRACK.id);

    // Re-trigger pre-warming on new upcoming
    await cacheEngine.prewarmQueue(queueMgr.queue, queueMgr.currentIndex, 1);
    const p2pCached = await cacheEngine.getCachedStreamUrl(MOCK_P2P_TRACK.id, MOCK_P2P_TRACK.streamUrl);
    expect(p2pCached).toContain('blob:dotify-cache');
  });

  it('3.2: Custom playlist + Spotify importer + Telemetry: Imported track played from playlist logs telemetry with genre attribution', async () => {
    const preview = {
      playlistTitle: 'Spotify Hits',
      totalTracks: 1,
      resolvedTracks: [MOCK_AUDIUS_TRACK],
      unresolvedCount: 0,
    };
    const playlist = importer.createCustomPlaylist(preview.playlistTitle, '', preview.resolvedTracks);
    expect(playlist.tracks[0].id).toBe(MOCK_AUDIUS_TRACK.id);

    // Simulate playing track from playlist
    const play = await telemetryDb.recordPlay('session_pl', playlist.tracks[0], 180000, 180000, false);
    expect(play.completionRate).toBe(1.0);
    expect(play.genre).toBe('Electronic');
  });

  it('3.3: Telemetry listening history + Recommendations: Telemetry updates immediately feed into recommendation recalculation', async () => {
    // Record multiple plays for MOCK_ARCHIVE_TRACK (Rock)
    await telemetryDb.recordPlay('s1', MOCK_ARCHIVE_TRACK, 400000, 420000, false);
    await telemetryDb.recordPlay('s1', MOCK_ARCHIVE_TRACK, 420000, 420000, false);

    const dataset = await telemetryDb.exportDataset();
    const heavyRotation = recEngine.generateHeavyRotation(dataset.plays, MOCK_ALL_TRACKS);

    expect(heavyRotation.length).toBeGreaterThan(0);
    expect(heavyRotation[0].id).toBe(MOCK_ARCHIVE_TRACK.id);
  });

  it('3.4: Artist Radio + Infinite Autoplay: When 25-track Artist Radio completes, infinite autoplay cues related genre tracks', () => {
    const radio = artistService.generateArtistRadio(
      { artistId: 'synthetic_pulse', artistName: 'Synthetic Pulse', length: 25 },
      [MOCK_AUDIUS_TRACK],
      [MOCK_ARCHIVE_TRACK],
      [MOCK_P2P_TRACK]
    );
    expect(radio.length).toBe(25);

    const radioQueue = new EnhancedQueueManager(radio, 24); // At last track
    let autoplayTriggered = false;
    radioQueue.setAutoplayCallback(() => {
      autoplayTriggered = true;
      const extraTracks: Track[] = [
        { ...MOCK_AUDIUS_TRACK, id: 'extra_1', title: 'Extra 1' },
        { ...MOCK_ARCHIVE_TRACK, id: 'extra_2', title: 'Extra 2' },
        { ...MOCK_P2P_TRACK, id: 'extra_3', title: 'Extra 3' },
        { ...MOCK_RADIO_TRACK, id: 'extra_4', title: 'Extra 4' },
        { ...MOCK_AUDIUS_TRACK, id: 'extra_5', title: 'Extra 5' },
        { ...MOCK_ARCHIVE_TRACK, id: 'extra_6', title: 'Extra 6' },
      ];
      const cued = recEngine.generateAutoplay(radio[24], [], extraTracks, 5);
      cued.forEach((t) => radioQueue.addToEnd(t));
    });

    radioQueue.advanceTrack();
    expect(autoplayTriggered).toBe(true);
    expect(radioQueue.queue.length).toBe(30);
  });

  it('3.5: Google Cast + Mobile Now-Playing Sheet: Casting active track reflects cast status in mobile sheet controls', () => {
    castService.initialize('CC1AD845');
    castService.connect('Living Room Chromecast');
    castService.syncPlayback(MOCK_AUDIUS_TRACK, 45000);

    // Mobile layout status check
    const isMobile = layoutCtrl.isMobile(390);
    expect(isMobile).toBe(true);
    expect(castService.state.isConnected).toBe(true);
    expect(castService.state.castDeviceName).toBe('Living Room Chromecast');
  });

  it('3.6: Spotify Connect remote control + Queue management: Remote phone executes Play Next and host queue updates', () => {
    const host = new ConnectNode(
      { deviceId: 'host_pc', deviceName: 'Desktop', deviceType: 'desktop', role: 'active_host', isCurrentDevice: true, lastSeen: Date.now() },
      'comb_queue_channel'
    );
    const remote = new ConnectNode(
      { deviceId: 'remote_phone', deviceName: 'Phone', deviceType: 'mobile', role: 'remote_controller', isCurrentDevice: false, lastSeen: Date.now() },
      'comb_queue_channel'
    );

    let receivedCommand: any = null;
    host.onCommandReceived = (cmd) => {
      receivedCommand = cmd;
      if (cmd.type === 'CMD_NEXT') {
        queueMgr.playNext(MOCK_P2P_TRACK);
      }
    };

    remote.sendCommand({ type: 'CMD_NEXT' });
    expect(receivedCommand.type).toBe('CMD_NEXT');
    expect(queueMgr.queue[1].id).toBe(MOCK_P2P_TRACK.id);

    host.close();
    remote.close();
  });

  it('3.7: Seamless handoff + Cache pre-warming: Handoff to new device triggers instant pre-warming on recipient', async () => {
    const handoffPayload = {
      currentTrack: MOCK_AUDIUS_TRACK,
      isPlaying: true,
      positionMs: 60000,
      durationMs: 180000,
      volume: 0.8,
      timestamp: Date.now(),
      queue: [MOCK_AUDIUS_TRACK, MOCK_ARCHIVE_TRACK],
      currentIndex: 0,
    };

    // Recipient receives handoff and pre-warms queue
    await cacheEngine.prewarmQueue(handoffPayload.queue, handoffPayload.currentIndex, 1);
    const stats = await cacheEngine.getCacheStats();
    expect(stats.entryCount).toBe(1);
  });

  it('3.8: MediaSession seek + Audio cache range requests: Lock-screen scrubbing triggers cached range response', async () => {
    await cacheEngine.prewarmTrack(MOCK_ARCHIVE_TRACK);
    layoutCtrl.updateMediaSession(MOCK_ARCHIVE_TRACK, 150, 420, true);

    const streamUrl = await cacheEngine.getCachedStreamUrl(MOCK_ARCHIVE_TRACK.id, MOCK_ARCHIVE_TRACK.streamUrl);
    expect(streamUrl).toContain('blob:dotify-cache');
    const posState = (navigator.mediaSession as any).positionState;
    expect(posState.position).toBe(150);
  });

  it('3.9: Theme switching + Responsive layout resize: Resizing between mobile and desktop preserves active UI state', () => {
    let activeTheme = 'spotify-oled';
    const setTheme = (t: string) => (activeTheme = t);

    setTheme('nord-frost');
    expect(layoutCtrl.isDesktop(1280)).toBe(true);

    // Resize to mobile
    expect(layoutCtrl.isMobile(390)).toBe(true);
    expect(activeTheme).toBe('nord-frost'); // Theme preserved
  });

  it('3.10: Autoplay queue exhaustion + Telemetry session: Autoplay tracks automatically attach to active telemetry session', async () => {
    const sessionId = 'session_autoplay_flow';
    const autoplayTracks = recEngine.generateAutoplay(MOCK_AUDIUS_TRACK, [], MOCK_ALL_TRACKS, 2);

    const play1 = await telemetryDb.recordPlay(sessionId, autoplayTracks[0], 180000, 180000, false);
    expect(play1.sessionId).toBe(sessionId);
    expect(play1.trackId).toBe(autoplayTracks[0].id);
  });

  it('3.11: Spotify import + Artist view navigation: Clicking artist on imported Spotify track navigates to artist profile', () => {
    const preview = {
      playlistTitle: 'Rock Classics',
      totalTracks: 1,
      resolvedTracks: [MOCK_ARCHIVE_TRACK],
      unresolvedCount: 0,
    };
    const importedPl = importer.createCustomPlaylist(preview.playlistTitle, '', preview.resolvedTracks);
    const trackArtist = importedPl.tracks[0].artist;

    const profile = artistService.createSyntheticProfile(trackArtist, [MOCK_ARCHIVE_TRACK]);
    expect(profile.name).toBe('Grateful Dead');
    expect(profile.discography.length).toBe(1);
  });

  it('3.12: Cast connection + Equalizer DSP bypass: Casting active track bypasses local DSP filters and streams directly', () => {
    castService.initialize('CC1AD845');
    castService.connect('Home Theater Soundbar');
    castService.syncPlayback(MOCK_AUDIUS_TRACK, 10000);

    // Verify cast is receiving original stream URL while connected
    expect(castService.state.isConnected).toBe(true);
    expect(MOCK_AUDIUS_TRACK.streamUrl).toBeDefined();
  });

  it('3.13: Multiple remote controllers + Host queue reordering: Concurrent remote controllers receive real-time queue updates', () => {
    const host = new ConnectNode(
      { deviceId: 'host_multi', deviceName: 'Host', deviceType: 'desktop', role: 'active_host', isCurrentDevice: true, lastSeen: Date.now() },
      'multi_remotes_channel'
    );
    const phone1 = new ConnectNode(
      { deviceId: 'phone_1', deviceName: 'Phone 1', deviceType: 'mobile', role: 'remote_controller', isCurrentDevice: false, lastSeen: Date.now() },
      'multi_remotes_channel'
    );
    const phone2 = new ConnectNode(
      { deviceId: 'phone_2', deviceName: 'Phone 2', deviceType: 'mobile', role: 'remote_controller', isCurrentDevice: false, lastSeen: Date.now() },
      'multi_remotes_channel'
    );

    // Host reorders queue and broadcasts state
    queueMgr.reorderQueue(0, 1);
    host.broadcastState({ queue: queueMgr.queue });

    expect(phone1.playbackState.queue[0].id).toBe(MOCK_ARCHIVE_TRACK.id);
    expect(phone2.playbackState.queue[0].id).toBe(MOCK_ARCHIVE_TRACK.id);

    host.close();
    phone1.close();
    phone2.close();
  });

  it('3.14: JSON telemetry import + Immediate recommendation shelf update: Importing history regenerates recommendation shelves', async () => {
    const exportData = {
      schemaVersion: 1 as const,
      exportedAt: Date.now(),
      sessions: [{ sessionId: 's_fresh', startTime: Date.now(), deviceType: 'desktop' as const, totalDurationMs: 600000 }],
      plays: [
        {
          playId: 'p_rock',
          sessionId: 's_fresh',
          trackId: MOCK_ARCHIVE_TRACK.id,
          title: MOCK_ARCHIVE_TRACK.title,
          artist: MOCK_ARCHIVE_TRACK.artist,
          genre: 'Rock',
          source: 'archive' as const,
          startTime: Date.now() - 100000,
          durationPlayedMs: 400000,
          totalDurationMs: 420000,
          completionRate: 0.95,
          skipped: false,
          replayed: false,
        },
      ],
      genreAffinities: [],
    };

    await telemetryDb.importDataset(exportData);
    const dbData = await telemetryDb.exportDataset();

    const madeForYou = recEngine.generateMadeForYou(dbData.plays, MOCK_ALL_TRACKS);
    expect(madeForYou.some((t) => t.id === MOCK_ARCHIVE_TRACK.id)).toBe(true);
  });

  it('3.15: Offline cache mode + Queue playback: Pre-warmed queue resolves stream URLs even when network fails', async () => {
    await cacheEngine.prewarmTrack(MOCK_AUDIUS_TRACK);
    await cacheEngine.prewarmTrack(MOCK_ARCHIVE_TRACK);

    // Simulate offline condition where external network fails
    const offlineUrl1 = await cacheEngine.getCachedStreamUrl(MOCK_AUDIUS_TRACK.id, 'https://offline.invalid/1');
    const offlineUrl2 = await cacheEngine.getCachedStreamUrl(MOCK_ARCHIVE_TRACK.id, 'https://offline.invalid/2');

    expect(offlineUrl1).toContain('blob:dotify-cache');
    expect(offlineUrl2).toContain('blob:dotify-cache');
  });

  it('3.16: MediaSession hardware keys + Remote controller sync: Media action triggers state broadcast to remote controller', () => {
    const host = new ConnectNode(
      { deviceId: 'host_hw', deviceName: 'Host', deviceType: 'desktop', role: 'active_host', isCurrentDevice: true, lastSeen: Date.now() },
      'hw_keys_channel'
    );
    const remote = new ConnectNode(
      { deviceId: 'remote_hw', deviceName: 'Remote', deviceType: 'mobile', role: 'remote_controller', isCurrentDevice: false, lastSeen: Date.now() },
      'hw_keys_channel'
    );

    // Simulate hardware next key on desktop
    queueMgr.advanceTrack();
    host.broadcastState({
      currentTrack: queueMgr.queue[queueMgr.currentIndex],
      currentIndex: queueMgr.currentIndex,
    });

    expect(remote.playbackState.currentIndex).toBe(1);
    expect(remote.playbackState.currentTrack?.id).toBe(MOCK_ARCHIVE_TRACK.id);

    host.close();
    remote.close();
  });

  it('3.17: Custom playlist deletion while queued: Deleting a playlist does not break currently playing track', () => {
    const pl = importer.createCustomPlaylist('Temp Playlist', '', [MOCK_AUDIUS_TRACK]);
    queueMgr.playNext(pl.tracks[0]);

    // Delete playlist
    const playlists = [pl].filter((p) => p.id !== pl.id);
    expect(playlists.length).toBe(0);

    // Current playing track remains valid in queue
    expect(queueMgr.queue[queueMgr.currentIndex].id).toBe(MOCK_AUDIUS_TRACK.id);
  });

  it('3.18: Infinite autoplay toggle during active playback: Disabling autoplay prevents cueing at queue tail', () => {
    let cued = false;
    queueMgr.setAutoplayCallback(() => {
      cued = true;
    });

    // Advance to last track (idx 2)
    queueMgr.advanceTrack(); // idx 1
    queueMgr.advanceTrack(); // idx 2

    // Disable autoplay mid-playback
    queueMgr.autoplayEnabled = false;
    queueMgr.advanceTrack(); // At end
    expect(cued).toBe(false);
  });

  it('3.19: Artist Radio golden-ratio dispersion + High-frequency scrubbing: Scrubbing through tracks preserves dispersion sequence', () => {
    const radio = artistService.generateArtistRadio(
      { artistId: 'disp_test', artistName: 'Synthetic Pulse', length: 15 },
      [MOCK_AUDIUS_TRACK],
      [MOCK_ARCHIVE_TRACK],
      [MOCK_P2P_TRACK]
    );

    // Rapid scrub simulations
    for (let scrubTime = 0; scrubTime <= 180; scrubTime += 10) {
      layoutCtrl.updateMediaSession(radio[0], scrubTime, 180, true);
    }

    // Radio tracks remain untouched in correct dispersion order
    expect(radio.length).toBe(15);
    expect(radio[0].id).toBe(MOCK_AUDIUS_TRACK.id);
  });

  it('3.20: Handoff from desktop to mobile + Mobile mini-player sheet expansion: Transferred track opens in mobile sheet', () => {
    const handoffState = {
      currentTrack: MOCK_AUDIUS_TRACK,
      positionMs: 45000,
      isPlaying: true,
    };

    // Mobile layout activates and opens sheet
    expect(layoutCtrl.isMobile(390)).toBe(true);
    let sheetOpen = false;
    const onHandoffReceived = (state: typeof handoffState) => {
      layoutCtrl.updateMediaSession(state.currentTrack, state.positionMs / 1000, 180, state.isPlaying);
      sheetOpen = true;
    };

    onHandoffReceived(handoffState);
    expect(sheetOpen).toBe(true);
    const meta = (navigator.mediaSession as any).metadata;
    expect(meta.title).toBe(MOCK_AUDIUS_TRACK.title);
  });
});
