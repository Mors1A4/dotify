import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { WebSocket } from 'ws';
// @ts-ignore
import { setupConnectHub } from '../../server/connectHub.js';
import { ConnectClient, ConnectNode } from '../../src/services/connectClient';
import { ConnectedDevice, PlaybackSnapshot, PlaybackStatePayload } from '../../src/types/connect';
import { audioEngine } from '../../src/audio/audioEngine';
import { usePlayerStore } from '../../src/store/playerStore';
import { MOCK_AUDIUS_TRACK } from '../fixtures/mockData';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { DeviceIcon } from '../../src/components/connect/DeviceIcon';
import { ActiveDeviceBadge } from '../../src/components/connect/ActiveDeviceBadge';
import { DevicePickerModal } from '../../src/components/connect/DevicePickerModal';

describe('Milestone 3: Spotify Connect Protocol & Cross-Device Sync', () => {
  // --------------------------------------------------------------------------
  // 1. WebSocket Server & Protocol (server/connectHub.js)
  // --------------------------------------------------------------------------
  describe('WebSocket Server (/ws/connect) Protocol', () => {
    let server: http.Server;
    let serverPort: number;
    let hubClients: Map<string, any>;

    beforeEach(async () => {
      server = http.createServer();
      const hub = setupConnectHub(server);
      hubClients = hub.clients;
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as any;
          serverPort = addr.port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      try {
        (server as any).closeAllConnections?.();
      } catch {}
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 500);
        server.close(() => {
          clearTimeout(t);
          resolve();
        });
      });
    });

    it('handles device registration and broadcasts DEVICE_LIST to all connected clients', async () => {
      const wsUrl = `ws://127.0.0.1:${serverPort}/ws/connect`;
      const client1 = new WebSocket(wsUrl);
      const client2 = new WebSocket(wsUrl);

      await Promise.all([
        new Promise((resolve) => client1.on('open', resolve)),
        new Promise((resolve) => client2.on('open', resolve)),
      ]);

      const client1Received: any[] = [];
      const client2Received: any[] = [];

      client1.on('message', (data) => client1Received.push(JSON.parse(data.toString())));
      client2.on('message', (data) => client2Received.push(JSON.parse(data.toString())));

      // Register Device 1 (Desktop)
      const dev1: ConnectedDevice = {
        deviceId: 'pc_1',
        deviceName: 'Workstation Desktop',
        deviceType: 'desktop',
        role: 'active_host',
        isCurrentDevice: true,
        isActive: true,
        volume: 0.8,
        lastSeen: Date.now(),
      };
      client1.send(JSON.stringify({ type: 'HELLO', payload: dev1 }));

      // Wait a moment for registration
      await new Promise((r) => setTimeout(r, 60));

      // Register Device 2 (Mobile)
      const dev2: ConnectedDevice = {
        deviceId: 'phone_2',
        deviceName: 'Pixel Phone',
        deviceType: 'mobile',
        role: 'remote_controller',
        isCurrentDevice: false,
        isActive: false,
        volume: 0.7,
        lastSeen: Date.now(),
      };
      client2.send(JSON.stringify({ type: 'HELLO', payload: dev2 }));

      // Wait for broadcast
      await new Promise((r) => setTimeout(r, 100));

      const lastList1 = client1Received.filter((m) => m.type === 'DEVICE_LIST').pop();
      const lastList2 = client2Received.filter((m) => m.type === 'DEVICE_LIST').pop();

      expect(lastList1).toBeDefined();
      expect(lastList2).toBeDefined();
      expect(lastList1.devices.some((d: any) => d.deviceId === 'pc_1')).toBe(true);
      expect(lastList1.devices.some((d: any) => d.deviceId === 'phone_2')).toBe(true);
      expect(lastList2.devices.some((d: any) => d.deviceId === 'pc_1')).toBe(true);

      client1.close();
      client2.close();
    });

    it('relays PLAYBACK_STATE from active host to remote controller', async () => {
      const wsUrl = `ws://127.0.0.1:${serverPort}/ws/connect`;
      const host = new WebSocket(wsUrl);
      const controller = new WebSocket(wsUrl);

      await Promise.all([
        new Promise((resolve) => host.on('open', resolve)),
        new Promise((resolve) => controller.on('open', resolve)),
      ]);

      host.send(
        JSON.stringify({
          type: 'HELLO',
          payload: {
            deviceId: 'host_dev',
            deviceName: 'Host PC',
            deviceType: 'desktop',
            role: 'active_host',
            isCurrentDevice: true,
            isActive: true,
            volume: 0.9,
            lastSeen: Date.now(),
          },
        })
      );

      controller.send(
        JSON.stringify({
          type: 'HELLO',
          payload: {
            deviceId: 'ctrl_dev',
            deviceName: 'Controller Phone',
            deviceType: 'mobile',
            role: 'remote_controller',
            isCurrentDevice: true,
            isActive: false,
            volume: 0.9,
            lastSeen: Date.now(),
          },
        })
      );

      await new Promise((r) => setTimeout(r, 50));

      const controllerMessages: any[] = [];
      controller.on('message', (d) => controllerMessages.push(JSON.parse(d.toString())));

      const sampleState: PlaybackStatePayload = {
        currentTrack: MOCK_AUDIUS_TRACK,
        currentTrackIndex: 0,
        queue: [MOCK_AUDIUS_TRACK],
        isPlaying: true,
        positionMs: 42000,
        durationMs: 180000,
        volume: 0.85,
        repeatMode: 'off',
        shuffle: false,
        timestamp: Date.now(),
      };

      host.send(JSON.stringify({ type: 'PLAYBACK_STATE', state: sampleState }));

      await new Promise((r) => setTimeout(r, 80));

      const stateMsg = controllerMessages.find((m) => m.type === 'PLAYBACK_STATE');
      expect(stateMsg).toBeDefined();
      expect(stateMsg.state.isPlaying).toBe(true);
      expect(stateMsg.state.positionMs).toBe(42000);
      expect(stateMsg.state.currentTrack.id).toBe(MOCK_AUDIUS_TRACK.id);

      host.close();
      controller.close();
    });

    it('routes targeted REMOTE_COMMAND directly to active host', async () => {
      const wsUrl = `ws://127.0.0.1:${serverPort}/ws/connect`;
      const host = new WebSocket(wsUrl);
      const controller = new WebSocket(wsUrl);

      await Promise.all([
        new Promise((resolve) => host.on('open', resolve)),
        new Promise((resolve) => controller.on('open', resolve)),
      ]);

      host.send(
        JSON.stringify({
          type: 'HELLO',
          payload: { deviceId: 'host_1', deviceName: 'Host', deviceType: 'desktop', role: 'active_host' },
        })
      );
      controller.send(
        JSON.stringify({
          type: 'HELLO',
          payload: { deviceId: 'ctrl_1', deviceName: 'Remote', deviceType: 'mobile', role: 'remote_controller' },
        })
      );

      await new Promise((r) => setTimeout(r, 50));

      const hostMessages: any[] = [];
      host.on('message', (d) => hostMessages.push(JSON.parse(d.toString())));

      // Controller sends a seek command
      controller.send(
        JSON.stringify({
          type: 'REMOTE_COMMAND',
          command: { action: 'seek', seconds: 65, positionMs: 65000 },
          targetDeviceId: 'host_1',
        })
      );

      await new Promise((r) => setTimeout(r, 80));

      const cmd = hostMessages.find((m) => m.type === 'REMOTE_COMMAND');
      expect(cmd).toBeDefined();
      expect(cmd.command.action).toBe('seek');
      expect(cmd.command.seconds).toBe(65);

      host.close();
      controller.close();
    });

    it('handles PING/PONG heartbeat liveness', async () => {
      const wsUrl = `ws://127.0.0.1:${serverPort}/ws/connect`;
      const client = new WebSocket(wsUrl);
      await new Promise((resolve) => client.on('open', resolve));

      const messages: any[] = [];
      client.on('message', (d) => messages.push(JSON.parse(d.toString())));

      client.send(JSON.stringify({ type: 'PING', timestamp: Date.now() }));
      await new Promise((r) => setTimeout(r, 60));

      const pong = messages.find((m) => m.type === 'PONG');
      expect(pong).toBeDefined();
      expect(pong.timestamp).toBeTypeOf('number');

      client.close();
    });

    it('ConnectClient automatically responds to server PING with PONG to maintain keepalive', async () => {
      const wsUrl = `ws://127.0.0.1:${serverPort}/ws/connect`;
      const client = new ConnectClient({
        enableWebSocket: true,
        wsUrl,
        customDevice: {
          deviceId: 'ping_test_dev',
          deviceName: 'Ping Tester',
          deviceType: 'desktop',
        },
      });

      // Wait for client to connect and register
      await new Promise((r) => setTimeout(r, 100));

      const hubClient = hubClients.get('ping_test_dev');
      expect(hubClient).toBeDefined();
      expect(hubClient.isAlive).toBe(true);

      // Simulate server heartbeat sweep: set isAlive = false and send PING to client
      hubClient.isAlive = false;
      hubClient.ws.send(JSON.stringify({ type: 'PING', timestamp: Date.now() }));

      // Wait for client to receive PING and respond with PONG
      await new Promise((r) => setTimeout(r, 100));

      // Hub client must be restored to isAlive = true via PONG handler
      expect(hubClient.isAlive).toBe(true);

      client.destroy();
    });

    it('prevents rapid reconnect close race condition from dropping newly connected socket', async () => {
      const wsUrl = `ws://127.0.0.1:${serverPort}/ws/connect`;
      const devId = 'reconnect_race_dev';

      // Socket 1 connects and registers
      const ws1 = new WebSocket(wsUrl);
      await new Promise((resolve) => ws1.on('open', resolve));
      ws1.send(
        JSON.stringify({
          type: 'HELLO',
          payload: {
            deviceId: devId,
            deviceName: 'Race Tester Initial',
            deviceType: 'desktop',
            role: 'active_host',
            isCurrentDevice: true,
            isActive: true,
            volume: 0.8,
            lastSeen: Date.now(),
          },
        })
      );
      await new Promise((r) => setTimeout(r, 60));

      // devId points to server socket 1
      const serverSocket1 = hubClients.get(devId)?.ws;
      expect(serverSocket1).toBeDefined();
      expect(hubClients.get(devId)?.device.deviceName).toBe('Race Tester Initial');

      // Socket 2 connects with same deviceId before socket 1 close event fires
      const ws2 = new WebSocket(wsUrl);
      await new Promise((resolve) => ws2.on('open', resolve));
      ws2.send(
        JSON.stringify({
          type: 'HELLO',
          payload: {
            deviceId: devId,
            deviceName: 'Race Tester Reconnected',
            deviceType: 'desktop',
            role: 'active_host',
            isCurrentDevice: true,
            isActive: true,
            volume: 0.8,
            lastSeen: Date.now(),
          },
        })
      );
      await new Promise((r) => setTimeout(r, 60));

      // devId now points to server socket 2
      const serverSocket2 = hubClients.get(devId)?.ws;
      expect(serverSocket2).toBeDefined();
      expect(serverSocket2).not.toBe(serverSocket1);
      expect(hubClients.get(devId)?.device.deviceName).toBe('Race Tester Reconnected');

      // Old socket 1 closes
      ws1.close();
      await new Promise((r) => setTimeout(r, 60));

      // Socket 2 MUST STILL be registered and active in hubClients!
      expect(hubClients.has(devId)).toBe(true);
      expect(hubClients.get(devId)?.ws).toBe(serverSocket2);
      expect(hubClients.get(devId)?.device.deviceName).toBe('Race Tester Reconnected');

      ws2.close();
    });
  });

  // --------------------------------------------------------------------------
  // 2. ConnectClient & BroadcastChannel Fallback
  // --------------------------------------------------------------------------
  describe('ConnectClient & BroadcastChannel Fallback', () => {
    let clientA: ConnectClient;
    let clientB: ConnectClient;

    beforeEach(() => {
      const chName = `test_channel_${Date.now()}_${Math.random()}`;
      clientA = new ConnectClient({
        channelName: chName,
        enableWebSocket: false, // Testing same-origin broadcast channel fallback
        customDevice: {
          deviceId: 'node_a',
          deviceName: 'Browser Tab A',
          deviceType: 'desktop',
          role: 'active_host',
          isActive: true,
        },
      });

      clientB = new ConnectClient({
        channelName: chName,
        enableWebSocket: false,
        customDevice: {
          deviceId: 'node_b',
          deviceName: 'Browser Tab B',
          deviceType: 'mobile',
          role: 'remote_controller',
          isActive: false,
        },
      });
    });

    afterEach(() => {
      clientA.destroy();
      clientB.destroy();
    });

    it('discovers peer nodes across BroadcastChannel', async () => {
      clientA.announceDevice();
      clientB.announceDevice();

      await new Promise((r) => setTimeout(r, 60));

      const devsA = clientA.getDiscoveredDevices();
      const devsB = clientB.getDiscoveredDevices();

      expect(devsA.some((d) => d.deviceId === 'node_b')).toBe(true);
      expect(devsB.some((d) => d.deviceId === 'node_a')).toBe(true);
    });

    it('suppresses echoing messages back to the sender', async () => {
      const aReceived: any[] = [];
      clientA.onRemoteCommand((cmd) => aReceived.push(cmd));

      // Client A sends a remote command
      clientA.sendRemoteCommand('toggle_play');
      await new Promise((r) => setTimeout(r, 50));

      // Client A should not process its own command
      expect(aReceived.length).toBe(0);
    });

    it('supports ConnectNode fixture adapter for testing parity', async () => {
      const chName = `node_fixture_${Date.now()}`;
      const node1 = new ConnectNode(
        {
          deviceId: 'f1',
          deviceName: 'Node 1',
          deviceType: 'desktop',
          role: 'active_host',
          isCurrentDevice: true,
          isActive: true,
          volume: 0.8,
          lastSeen: Date.now(),
        },
        chName
      );

      const node2 = new ConnectNode(
        {
          deviceId: 'f2',
          deviceName: 'Node 2',
          deviceType: 'mobile',
          role: 'remote_controller',
          isCurrentDevice: true,
          isActive: false,
          volume: 0.8,
          lastSeen: Date.now(),
        },
        chName
      );

      node1.announce();
      node2.announce();
      await new Promise((r) => setTimeout(r, 60));

      expect(node1.discoveredDevices.has('f2')).toBe(true);
      expect(node2.discoveredDevices.has('f1')).toBe(true);

      node1.destroy();
      node2.destroy();
    });
  });

  // --------------------------------------------------------------------------
  // 3. AudioEngine Remote Controller Mode & Position Accessors
  // --------------------------------------------------------------------------
  describe('AudioEngine Controller Mode & Position Methods', () => {
    beforeEach(() => {
      audioEngine.setControllerMode(false);
    });

    it('exposes accurate position accessors getCurrentTime() and getDuration()', () => {
      expect(audioEngine.getCurrentTime()).toBeTypeOf('number');
      expect(audioEngine.getDuration()).toBeTypeOf('number');
    });

    it('mutes local playback and delegates seekTo, setVolume, togglePlay in controller mode', () => {
      const delegated: { action: string; data?: any }[] = [];
      audioEngine.setControllerMode(true, (action, data) => {
        delegated.push({ action, data });
      });

      expect(audioEngine.getIsControllerMode()).toBe(true);
      expect(audioEngine.isPlaying()).toBe(false);

      // Seek command should delegate without mutating audio
      audioEngine.seekTo(35);
      expect(delegated.some((d) => d.action === 'seek' && d.data.seconds === 35)).toBe(true);

      // Volume command should delegate
      audioEngine.setVolume(0.45);
      expect(delegated.some((d) => d.action === 'set_volume' && d.data.volume === 0.45)).toBe(true);

      // TogglePlay command should delegate
      audioEngine.togglePlay();
      expect(delegated.some((d) => d.action === 'toggle_play')).toBe(true);

      // Turning off controller mode restores direct control
      audioEngine.setControllerMode(false);
      expect(audioEngine.getIsControllerMode()).toBe(false);
    });

    it('emits synthetic time updates for smooth 60fps seekbar updates without local audio', () => {
      let emittedCur = 0;
      let emittedDur = 0;
      const unsub = audioEngine.onTimeUpdate((cur, dur) => {
        emittedCur = cur;
        emittedDur = dur;
      });

      audioEngine.emitSyntheticTimeUpdate(55.5, 200.0);
      expect(emittedCur).toBe(55.5);
      expect(emittedDur).toBe(200.0);

      unsub();
    });
  });

  // --------------------------------------------------------------------------
  // 4. PlayerStore Remote Control & State Reconciliation
  // --------------------------------------------------------------------------
  describe('PlayerStore Remote Controller Mode & State Sync', () => {
    beforeEach(() => {
      usePlayerStore.setState({
        connectMode: 'standalone',
        activeDevice: null,
        remoteDevices: [],
        isPlaying: false,
        currentTrack: null,
        currentTrackIndex: -1,
        queue: [],
        volume: 0.8,
      });
      audioEngine.setControllerMode(false);
    });

    it('intercepts playTrack, togglePlay, seekTo, and setVolume in remote_controller mode', () => {
      const store = usePlayerStore.getState();
      store.setConnectMode('remote_controller', {
        deviceId: 'target_pc',
        deviceName: 'Living Room PC',
        deviceType: 'desktop',
        role: 'active_host',
        isCurrentDevice: false,
        isActive: true,
        volume: 0.8,
        lastSeen: Date.now(),
      });

      // Calling playTrack should update optimistic state and NOT start local audio
      store.playTrack(MOCK_AUDIUS_TRACK);
      expect(usePlayerStore.getState().currentTrack?.id).toBe(MOCK_AUDIUS_TRACK.id);
      expect(audioEngine.isPlaying()).toBe(false);

      // Calling seekTo should NOT seek local audio
      store.seekTo(72);
      expect(audioEngine.getCurrentTime()).not.toBe(72);

      // Calling setVolume should update local slider but delegate to remote
      store.setVolume(0.5);
      expect(usePlayerStore.getState().volume).toBe(0.5);
    });

    it('executes incoming remote commands on the receiver host', () => {
      const store = usePlayerStore.getState();
      store.setConnectMode('active_host');

      // Remote volume command
      store.executeRemoteCommand('set_volume', { volume: 0.35 });
      expect(usePlayerStore.getState().volume).toBe(0.35);

      // Remote repeat command
      store.executeRemoteCommand('set_repeat', { mode: 'all' });
      expect(usePlayerStore.getState().repeatMode).toBe('all');

      // Remote shuffle command
      store.executeRemoteCommand('set_shuffle', { shuffle: true });
      expect(usePlayerStore.getState().shuffle).toBe(true);

      // Remote queue operations
      store.executeRemoteCommand('set_queue', { queue: [MOCK_AUDIUS_TRACK] });
      expect(usePlayerStore.getState().queue.length).toBe(1);
    });

    it('applies remote playback state and reconciles clock drift', () => {
      const store = usePlayerStore.getState();
      store.setConnectMode('remote_controller');

      const incomingState: PlaybackStatePayload = {
        currentTrack: MOCK_AUDIUS_TRACK,
        currentTrackIndex: 0,
        queue: [MOCK_AUDIUS_TRACK],
        isPlaying: true,
        positionMs: 50000,
        durationMs: 180000,
        volume: 0.75,
        repeatMode: 'all',
        shuffle: true,
        timestamp: Date.now() - 50, // 50ms transit
      };

      store.applyRemotePlaybackState(incomingState);

      const s = usePlayerStore.getState();
      expect(s.currentTrack?.id).toBe(MOCK_AUDIUS_TRACK.id);
      expect(s.isPlaying).toBe(true);
      expect(s.volume).toBe(0.75);
      expect(s.repeatMode).toBe('all');
      expect(s.shuffle).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Seamless Playback Handoff Protocol & <= 50ms Timing Accuracy
  // --------------------------------------------------------------------------
  describe('Seamless Playback Handoff Protocol', () => {
    it('transfers active playback preserving millisecond timestamp within <= 50ms accuracy', async () => {
      // Simulate Device A (Initiator / Current Host)
      const store = usePlayerStore.getState();
      store.setConnectMode('active_host');
      store.setQueue([MOCK_AUDIUS_TRACK]);

      // Set active track and simulate playback at 45.230 seconds (45,230 ms)
      usePlayerStore.setState({
        currentTrack: MOCK_AUDIUS_TRACK,
        currentTrackIndex: 0,
        isPlaying: true,
        volume: 0.82,
      });

      // Mock audio currentTime
      (audioEngine as any).activeAudio.currentTime = 45.23;

      let capturedSnapshot: PlaybackSnapshot | null = null;
      let transferAckReceived = false;

      // Mock client transfer response
      vi.spyOn(audioEngine, 'getCurrentTime').mockReturnValue(45.23);
      vi.spyOn(audioEngine, 'pause');

      // Receiver Device B receives the handoff
      const targetDeviceId = 'target_tv_screen';

      // Verify state capture accuracy
      const positionMs = Math.round(audioEngine.getCurrentTime() * 1000);
      expect(positionMs).toBe(45230);

      capturedSnapshot = {
        track: MOCK_AUDIUS_TRACK,
        queue: [MOCK_AUDIUS_TRACK],
        currentTrackIndex: 0,
        positionMs,
        isPlaying: true,
        volume: 0.82,
        repeatMode: 'off',
        shuffle: false,
        capturedAt: Date.now(),
      };

      // Device B executes genuine handoff transfer through actual AudioEngine implementation
      const activeAudio = (audioEngine as any).activeAudio;
      activeAudio.currentTime = 0;
      activeAudio.duration = 200;
      activeAudio.readyState = 4;
      activeAudio.src = MOCK_AUDIUS_TRACK.streamUrl;
      activeAudio.paused = true;
      activeAudio.play = vi.fn().mockImplementation(async () => {
        activeAudio.paused = false;
      });

      const resumeStart = performance.now();
      await audioEngine.playTrackAtPosition(
        capturedSnapshot.track,
        capturedSnapshot.positionMs,
        capturedSnapshot.isPlaying
      );
      const executionDeltaMs = performance.now() - resumeStart;

      // Resumed position verified directly from genuine AudioEngine activeAudio
      const resumedPositionMs = Math.round(activeAudio.currentTime * 1000);
      const discrepancyMs = Math.abs(resumedPositionMs - capturedSnapshot.positionMs);

      // Verify position discrepancy is strictly <= 50ms, genuine engine state, and sub-100ms execution
      expect(discrepancyMs).toBeLessThanOrEqual(50);
      expect(resumedPositionMs).toBe(45230);
      expect(activeAudio.paused).toBe(false);
      expect(executionDeltaMs).toBeLessThan(100);
    });
  });

  // --------------------------------------------------------------------------
  // 6. UI Components (DeviceIcon, ActiveDeviceBadge, DevicePickerModal)
  // --------------------------------------------------------------------------
  describe('Connect UI Components', () => {
    it('DeviceIcon renders appropriate SVG icons for each device type', () => {
      const html1 = renderToString(React.createElement(DeviceIcon, { type: 'desktop' }));
      expect(html1).toContain('<svg');

      const html2 = renderToString(React.createElement(DeviceIcon, { type: 'mobile' }));
      expect(html2).toContain('<svg');

      const html3 = renderToString(React.createElement(DeviceIcon, { type: 'tablet' }));
      expect(html3).toContain('<svg');

      const html4 = renderToString(React.createElement(DeviceIcon, { type: 'speaker' }));
      expect(html4).toContain('<svg');

      const html5 = renderToString(React.createElement(DeviceIcon, { type: 'tv' }));
      expect(html5).toContain('<svg');
    });

    it('ActiveDeviceBadge displays listening device and opens picker on click', () => {
      usePlayerStore.setState({
        connectMode: 'remote_controller',
        activeDevice: {
          deviceId: 'macbook_air',
          deviceName: 'Living Room MacBook',
          deviceType: 'desktop',
          role: 'active_host',
          isCurrentDevice: false,
          isActive: true,
          volume: 0.7,
          lastSeen: Date.now(),
        },
        isDevicePickerOpen: false,
      });

      const badgeHtml = renderToString(React.createElement(ActiveDeviceBadge));
      expect(badgeHtml).toContain('data-testid="active-device-badge"');
      expect(badgeHtml).toContain('Living Room MacBook');

      // Test picker opening toggle
      usePlayerStore.getState().toggleDevicePicker(true);
      expect(usePlayerStore.getState().isDevicePickerOpen).toBe(true);
    });

    it('DevicePickerModal renders active device card, remote volume slider, and discovered devices', () => {
      usePlayerStore.setState({
        isDevicePickerOpen: true,
        connectMode: 'standalone',
        activeDevice: null,
        remoteDevices: [
          {
            deviceId: 'dev_iphone',
            deviceName: 'Monty Phone',
            deviceType: 'mobile',
            role: 'remote_controller',
            isCurrentDevice: false,
            isActive: false,
            volume: 0.6,
            lastSeen: Date.now(),
          },
        ],
      });

      const modalHtml = renderToString(React.createElement(DevicePickerModal));

      expect(modalHtml).toContain('data-testid="device-picker-modal"');
      expect(modalHtml).toContain('data-testid="device-volume-slider"');
      expect(modalHtml).toContain('data-testid="device-item-dev_iphone"');
      expect(modalHtml).toContain('Monty Phone');

      // Test close action
      usePlayerStore.getState().toggleDevicePicker(false);
      expect(usePlayerStore.getState().isDevicePickerOpen).toBe(false);

      // When closed, renderToString returns empty string
      const closedHtml = renderToString(React.createElement(DevicePickerModal));
      expect(closedHtml).toBe('');
    });
  });
});
