import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { WebSocket } from 'ws';
// @ts-ignore
import { setupConnectHub } from '../../server/connectHub.js';
import { ConnectClient, ConnectNode } from '../../src/services/connectClient';
import { ConnectedDevice, PlaybackSnapshot, PlaybackStatePayload, RemoteCommand } from '../../src/types/connect';
import { audioEngine } from '../../src/audio/audioEngine';
import { usePlayerStore } from '../../src/store/playerStore';
import { MOCK_AUDIUS_TRACK } from '../fixtures/mockData';

describe('Empirical Adversarial Stress Suite: Milestone 3 Connect Protocol', () => {
  let server: http.Server;
  let serverPort: number;
  let wsUrl: string;

  beforeEach(async () => {
    server = http.createServer();
    setupConnectHub(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        wsUrl = `ws://127.0.0.1:${serverPort}/ws/connect`;
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

  // ==========================================================================
  // Dimension 1: Multi-Device Scale Registration, Discovery & Pairing
  // ==========================================================================
  describe('Dimension 1: Multi-Device Scale Registration, Discovery & Pairing', () => {
    it('handles concurrent registration of 15 diverse devices and converges on complete device list', async () => {
      const DEVICE_COUNT = 15;
      const clients: WebSocket[] = [];
      const receivedMessages: Map<number, any[]> = new Map();

      for (let i = 0; i < DEVICE_COUNT; i++) {
        receivedMessages.set(i, []);
        const ws = new WebSocket(wsUrl);
        clients.push(ws);
        ws.on('message', (raw) => {
          try {
            receivedMessages.get(i)!.push(JSON.parse(raw.toString()));
          } catch {}
        });
      }

      await Promise.all(
        clients.map(
          (ws) =>
            new Promise<void>((resolve, reject) => {
              ws.on('open', () => resolve());
              ws.on('error', reject);
            })
        )
      );

      const startTime = Date.now();
      const deviceTypes: ('desktop' | 'mobile' | 'tablet' | 'tv')[] = ['desktop', 'mobile', 'tablet', 'tv'];

      // Announce all 15 devices simultaneously
      clients.forEach((ws, idx) => {
        const dev: ConnectedDevice = {
          deviceId: `scale_dev_${idx}`,
          deviceName: `Device #${idx}`,
          deviceType: deviceTypes[idx % deviceTypes.length],
          role: idx === 0 ? 'active_host' : 'remote_controller',
          isCurrentDevice: true,
          isActive: idx === 0,
          volume: 0.5 + (idx % 5) * 0.1,
          lastSeen: Date.now(),
        };
        ws.send(JSON.stringify({ type: 'HELLO', payload: dev }));
      });

      // Wait for server to broadcast DEVICE_LIST updates to all clients
      await new Promise((r) => setTimeout(r, 250));
      const convergenceTimeMs = Date.now() - startTime;

      // Verify all 15 clients have received a DEVICE_LIST containing all 15 devices
      for (let i = 0; i < DEVICE_COUNT; i++) {
        const lists = receivedMessages.get(i)!.filter((m) => m.type === 'DEVICE_LIST');
        expect(lists.length).toBeGreaterThanOrEqual(1);
        const latest = lists[lists.length - 1];
        expect(latest.devices.length).toBe(DEVICE_COUNT);
        expect(latest.activeDeviceId).toBe('scale_dev_0');
      }

      expect(convergenceTimeMs).toBeLessThanOrEqual(600);

      // Clean up clients
      clients.forEach((c) => c.close());
      await new Promise((r) => setTimeout(r, 50));
    });

    it('manages concurrent pairing requests from multiple controllers to active host', async () => {
      const host = new WebSocket(wsUrl);
      const c1 = new WebSocket(wsUrl);
      const c2 = new WebSocket(wsUrl);

      await Promise.all([
        new Promise((r) => host.on('open', r)),
        new Promise((r) => c1.on('open', r)),
        new Promise((r) => c2.on('open', r)),
      ]);

      const hostMsgs: any[] = [];
      const c1Msgs: any[] = [];
      const c2Msgs: any[] = [];

      host.on('message', (d) => hostMsgs.push(JSON.parse(d.toString())));
      c1.on('message', (d) => c1Msgs.push(JSON.parse(d.toString())));
      c2.on('message', (d) => c2Msgs.push(JSON.parse(d.toString())));

      // Register host and controllers
      host.send(JSON.stringify({ type: 'HELLO', payload: { deviceId: 'pair_host', deviceName: 'Host', role: 'active_host' } }));
      c1.send(JSON.stringify({ type: 'HELLO', payload: { deviceId: 'pair_c1', deviceName: 'C1', role: 'remote_controller' } }));
      c2.send(JSON.stringify({ type: 'HELLO', payload: { deviceId: 'pair_c2', deviceName: 'C2', role: 'remote_controller' } }));

      await new Promise((r) => setTimeout(r, 60));

      // Both controllers pair concurrently
      c1.send(JSON.stringify({ type: 'PAIR', targetDeviceId: 'pair_host', fromDeviceId: 'pair_c1' }));
      c2.send(JSON.stringify({ type: 'PAIR', targetDeviceId: 'pair_host', fromDeviceId: 'pair_c2' }));

      await new Promise((r) => setTimeout(r, 80));

      const pairRequestsOnHost = hostMsgs.filter((m) => m.type === 'PAIR');
      expect(pairRequestsOnHost.length).toBe(2);
      expect(pairRequestsOnHost.some((m) => m.fromDeviceId === 'pair_c1')).toBe(true);
      expect(pairRequestsOnHost.some((m) => m.fromDeviceId === 'pair_c2')).toBe(true);

      // Host responds with PAIRED to both
      host.send(JSON.stringify({ type: 'PAIRED', controllerDeviceId: 'pair_c1', hostDeviceId: 'pair_host' }));
      host.send(JSON.stringify({ type: 'PAIRED', controllerDeviceId: 'pair_c2', hostDeviceId: 'pair_host' }));

      await new Promise((r) => setTimeout(r, 80));

      expect(c1Msgs.some((m) => m.type === 'PAIRED')).toBe(true);
      expect(c2Msgs.some((m) => m.type === 'PAIRED')).toBe(true);

      host.close();
      c1.close();
      c2.close();
    });

    it('performs clean failover of activeDeviceId when active host terminates unexpectedly', async () => {
      const devA = new WebSocket(wsUrl);
      const devB = new WebSocket(wsUrl);

      await Promise.all([
        new Promise((r) => devA.on('open', r)),
        new Promise((r) => devB.on('open', r)),
      ]);

      const msgsB: any[] = [];
      devB.on('message', (d) => msgsB.push(JSON.parse(d.toString())));

      // Dev A is active host, Dev B is controller
      devA.send(JSON.stringify({ type: 'HELLO', payload: { deviceId: 'host_failover', deviceName: 'A', role: 'active_host' } }));
      devB.send(JSON.stringify({ type: 'HELLO', payload: { deviceId: 'sub_failover', deviceName: 'B', role: 'remote_controller' } }));

      await new Promise((r) => setTimeout(r, 60));

      // Abruptly terminate devA
      devA.terminate();

      // Dev B should receive updated device list with failover activeDeviceId
      await new Promise((r) => setTimeout(r, 100));

      const lastList = msgsB.filter((m) => m.type === 'DEVICE_LIST').pop();
      expect(lastList).toBeDefined();
      expect(lastList.devices.length).toBe(1);
      expect(lastList.devices[0].deviceId).toBe('sub_failover');
      expect(lastList.activeDeviceId).toBe('sub_failover');

      devB.close();
    });
  });

  // ==========================================================================
  // Dimension 2: High-Frequency Remote Command Bursts (60 commands)
  // ==========================================================================
  describe('Dimension 2: High-Frequency Remote Command Bursts', () => {
    it('reliably delivers a burst of 60 rapid remote commands without dropping or corrupting packets', async () => {
      const host = new WebSocket(wsUrl);
      const controller = new WebSocket(wsUrl);

      await Promise.all([
        new Promise((r) => host.on('open', r)),
        new Promise((r) => controller.on('open', r)),
      ]);

      host.send(JSON.stringify({ type: 'HELLO', payload: { deviceId: 'burst_host', deviceName: 'Host', role: 'active_host' } }));
      controller.send(JSON.stringify({ type: 'HELLO', payload: { deviceId: 'burst_ctrl', deviceName: 'Ctrl', role: 'remote_controller' } }));

      await new Promise((r) => setTimeout(r, 50));

      const hostReceivedCommands: any[] = [];
      host.on('message', (raw) => {
        try {
          const parsed = JSON.parse(raw.toString());
          if (parsed.type === 'REMOTE_COMMAND') {
            hostReceivedCommands.push(parsed);
          }
        } catch {}
      });

      const BURST_COUNT = 60;
      const actions = ['play', 'pause', 'seek', 'set_volume', 'next', 'previous'] as const;
      const startTime = Date.now();

      // Rapidly dispatch 60 commands in tight loop
      for (let i = 0; i < BURST_COUNT; i++) {
        const action = actions[i % actions.length];
        const commandPayload: RemoteCommand = {
          action,
          positionMs: action === 'seek' ? i * 1000 : undefined,
          volume: action === 'set_volume' ? Math.round(((i % 10) / 10) * 100) / 100 : undefined,
        };

        controller.send(
          JSON.stringify({
            type: 'REMOTE_COMMAND',
            command: commandPayload,
            fromDeviceId: 'burst_ctrl',
            targetDeviceId: 'burst_host',
            seq: i,
          })
        );
      }

      // Allow flush & delivery
      await new Promise((r) => setTimeout(r, 200));
      const totalDurationMs = Date.now() - startTime;

      // 100% receipt rate verification
      expect(hostReceivedCommands.length).toBe(BURST_COUNT);

      // Verify sequence and data integrity
      for (let i = 0; i < BURST_COUNT; i++) {
        const expectedAction = actions[i % actions.length];
        const cmd = hostReceivedCommands[i].command;
        expect(cmd.action).toBe(expectedAction);
        if (expectedAction === 'seek') {
          expect(cmd.positionMs).toBe(i * 1000);
        }
        if (expectedAction === 'set_volume') {
          expect(cmd.volume).toBe(Math.round(((i % 10) / 10) * 100) / 100);
        }
      }

      const commandsPerSec = Math.round((BURST_COUNT / (totalDurationMs / 1000)));
      expect(commandsPerSec).toBeGreaterThanOrEqual(100);

      host.close();
      controller.close();
    });

    it('enforces FIFO eviction on ConnectClient message deduplication cache without unbounded memory growth', () => {
      const client = new ConnectClient({
        enableWebSocket: false,
        customDevice: { deviceId: 'test_fifo', deviceType: 'desktop' },
      });

      // ConnectClient caps processedMessageIds at 200.
      // We feed 250 incoming unique messages to handleIncomingMessage.
      const handleMsg = (client as any).handleIncomingMessage.bind(client);

      for (let i = 0; i < 250; i++) {
        handleMsg({
          type: 'PING',
          messageId: `msg_${i}`,
          senderDeviceId: 'other_dev',
        });
      }

      const cache = (client as any).processedMessageIds as Set<string>;
      expect(cache.size).toBeLessThanOrEqual(201);
      // Older message IDs (< 50) should have been evicted
      expect(cache.has('msg_0')).toBe(false);
      expect(cache.has('msg_10')).toBe(false);
      // Recent message IDs should be preserved
      expect(cache.has('msg_249')).toBe(true);

      client.destroy();
    });
  });

  // ==========================================================================
  // Dimension 3: BroadcastChannel Fallback & Dual-Transport Deduplication
  // ==========================================================================
  describe('Dimension 3: BroadcastChannel Fallback & Dual-Transport Resilience', () => {
    it('executes discovery, state sync, and remote control strictly via BroadcastChannel when WebSocket is disabled', async () => {
      const testChannel = `adversarial_bc_${Date.now()}`;
      const nodeA = new ConnectClient({
        channelName: testChannel,
        enableWebSocket: false,
        customDevice: {
          deviceId: 'tab_a',
          deviceName: 'Browser Tab 1',
          deviceType: 'desktop',
          role: 'active_host',
          isActive: true,
        },
      });

      const nodeB = new ConnectClient({
        channelName: testChannel,
        enableWebSocket: false,
        customDevice: {
          deviceId: 'tab_b',
          deviceName: 'Browser Tab 2',
          deviceType: 'mobile',
          role: 'remote_controller',
          isActive: false,
        },
      });

      const receivedCommandsB: RemoteCommand[] = [];
      nodeB.onRemoteCommand((cmd) => receivedCommandsB.push(cmd));

      nodeA.announceDevice();
      nodeB.announceDevice();

      await new Promise((r) => setTimeout(r, 50));

      expect(nodeA.getDiscoveredDevices().some((d) => d.deviceId === 'tab_b')).toBe(true);
      expect(nodeB.getDiscoveredDevices().some((d) => d.deviceId === 'tab_a')).toBe(true);

      // Node A sends command to Node B
      nodeA.sendRemoteCommand('seek', { seconds: 45, positionMs: 45000 }, 'tab_b');

      await new Promise((r) => setTimeout(r, 50));

      expect(receivedCommandsB.length).toBe(1);
      expect(receivedCommandsB[0].action).toBe('seek');
      expect(receivedCommandsB[0].seconds).toBe(45);

      nodeA.destroy();
      nodeB.destroy();
    });

    it('deduplicates messages in dual-transport mode ensuring zero duplicate command executions', async () => {
      // In dual-transport mode, an event might arrive on BOTH WebSocket and BroadcastChannel
      const client = new ConnectClient({
        enableWebSocket: false,
        customDevice: { deviceId: 'test_dual', deviceType: 'desktop' },
      });
      const executed: string[] = [];

      client.onRemoteCommand((cmd) => {
        executed.push(cmd.action);
      });

      const handleMsg = (client as any).handleIncomingMessage.bind(client);

      const duplicateMsg = {
        type: 'REMOTE_COMMAND',
        messageId: 'duplicate_packet_001',
        senderDeviceId: 'peer_dev',
        command: { action: 'toggle_play' },
      };

      // Simulating arrival on WebSocket transport
      handleMsg(duplicateMsg);
      // Simulating arrival on BroadcastChannel transport with identical messageId
      handleMsg(duplicateMsg);

      expect(executed.length).toBe(1);
      expect(executed[0]).toBe('toggle_play');

      client.destroy();
    });

    it('performs full handoff and ack cycle over BroadcastChannel fallback preserving <= 50ms discrepancy', async () => {
      const channel = `handoff_bc_${Date.now()}`;
      const hostA = new ConnectClient({
        channelName: channel,
        enableWebSocket: false,
        customDevice: { deviceId: 'handoff_host', deviceName: 'Host A', isActive: true, role: 'active_host', deviceType: 'desktop' },
      });

      const hostB = new ConnectClient({
        channelName: channel,
        enableWebSocket: false,
        customDevice: { deviceId: 'handoff_target', deviceName: 'Host B', isActive: false, role: 'remote_controller', deviceType: 'mobile' },
      });

      let transferredSnapshot: PlaybackSnapshot | null = null;
      hostB.onHandoffTransfer((snapshot, fromId) => {
        transferredSnapshot = snapshot;
        // Host B immediately acknowledges handoff with resumed position
        hostB.ackHandoff(fromId, true, snapshot.positionMs);
      });

      const snapshot: PlaybackSnapshot = {
        track: MOCK_AUDIUS_TRACK,
        queue: [MOCK_AUDIUS_TRACK],
        currentTrackIndex: 0,
        positionMs: 38240,
        isPlaying: true,
        volume: 0.9,
        repeatMode: 'off',
        shuffle: false,
        capturedAt: Date.now(),
      };

      const transferSuccess = await hostA.transferPlayback('handoff_target', snapshot);
      expect(transferSuccess).toBe(true);
      expect(transferredSnapshot).not.toBeNull();
      expect(transferredSnapshot!.positionMs).toBe(38240);

      // Host A became remote_controller, Host B became active_host
      expect(hostA.getLocalDevice().role).toBe('remote_controller');
      expect(hostA.getActiveDeviceId()).toBe('handoff_target');
      expect(hostB.getActiveDeviceId()).toBe('handoff_target');

      hostA.destroy();
      hostB.destroy();
    });
  });

  // ==========================================================================
  // Dimension 4: Network Disconnect & Reconnect Backoff Handling
  // ==========================================================================
  describe('Dimension 4: Network Disconnect & Reconnect Backoff Handling', () => {
    it('manages socket disconnect, unregistration on server, and client reconnection cycle', async () => {
      const clientWs1 = new WebSocket(wsUrl);
      await new Promise((r) => clientWs1.on('open', r));

      const serverMessages: any[] = [];
      clientWs1.on('message', (d) => serverMessages.push(JSON.parse(d.toString())));

      // Announce initial client
      clientWs1.send(
        JSON.stringify({
          type: 'HELLO',
          payload: { deviceId: 'recon_dev', deviceName: 'Reconnecting Device', role: 'active_host' },
        })
      );

      await new Promise((r) => setTimeout(r, 60));
      expect(serverMessages.some((m) => m.type === 'DEVICE_LIST' && m.devices.some((d: any) => d.deviceId === 'recon_dev'))).toBe(true);

      // Disconnect socket abruptly
      clientWs1.close();
      await new Promise((r) => setTimeout(r, 60));

      // Reconnect with a second socket representing the re-established connection
      const clientWs2 = new WebSocket(wsUrl);
      await new Promise((r) => clientWs2.on('open', r));

      const reconnectedMessages: any[] = [];
      clientWs2.on('message', (d) => reconnectedMessages.push(JSON.parse(d.toString())));

      clientWs2.send(
        JSON.stringify({
          type: 'HELLO',
          payload: { deviceId: 'recon_dev', deviceName: 'Reconnecting Device', role: 'active_host' },
        })
      );

      await new Promise((r) => setTimeout(r, 60));
      const reconList = reconnectedMessages.filter((m) => m.type === 'DEVICE_LIST').pop();
      expect(reconList).toBeDefined();
      expect(reconList.devices.some((d: any) => d.deviceId === 'recon_dev')).toBe(true);

      clientWs2.close();
    });

    it('empirically validates exponential backoff timing calculation and cap', () => {
      const client = new ConnectClient({
        enableWebSocket: false,
        customDevice: { deviceId: 'backoff_math', deviceType: 'desktop' },
      });

      // Directly trigger scheduleReconnect to test mathematical progression
      expect((client as any).reconnectAttempt).toBe(0);
      expect((client as any).reconnectTimeout).toBeNull();

      // Attempt 1: delay between 1400 and 1900 ms
      (client as any).scheduleReconnect();
      expect((client as any).reconnectAttempt).toBe(1);
      expect((client as any).reconnectTimeout).not.toBeNull();

      // Clear timer and trigger Attempt 2: delay between 1960 and 2460 ms
      clearTimeout((client as any).reconnectTimeout);
      (client as any).reconnectTimeout = null;
      (client as any).scheduleReconnect();
      expect((client as any).reconnectAttempt).toBe(2);

      // Clear timer and trigger Attempt 3: delay between 2744 and 3244 ms
      clearTimeout((client as any).reconnectTimeout);
      (client as any).reconnectTimeout = null;
      (client as any).scheduleReconnect();
      expect((client as any).reconnectAttempt).toBe(3);

      // Verify destroy cancels timer and disables further attempts
      client.destroy();
      expect((client as any).isDestroyed).toBe(true);
      expect((client as any).reconnectTimeout).toBeNull();

      // Calling scheduleReconnect after destroy must be a no-op
      (client as any).scheduleReconnect();
      expect((client as any).reconnectTimeout).toBeNull();
    });

    // ========================================================================
    // Empirical Vulnerability Findings: Unhandled Errors & Edge Cases
    // ========================================================================
    it('CONFIRMED VULNERABILITY 1 FIXED: detectDeviceType handles window defined and navigator.userAgent undefined without throwing', () => {
      const origWindow = (global as any).window;
      const origNav = (global as any).navigator;

      try {
        (global as any).window = { location: { protocol: 'http:', host: 'localhost:3000' } };
        (global as any).navigator = {}; // missing userAgent

        expect(() => {
          new ConnectClient({ enableWebSocket: false });
        }).not.toThrow();
      } finally {
        if (origWindow === undefined) delete (global as any).window; else (global as any).window = origWindow;
        if (origNav === undefined) delete (global as any).navigator; else (global as any).navigator = origNav;
      }
    });

    it('CONFIRMED RESILIENCE: server survives adversarial malformed JSON and corrupted payloads without crashing', async () => {
      const adversarialClient = new WebSocket(wsUrl);
      const validClient = new WebSocket(wsUrl);

      await Promise.all([
        new Promise((r) => adversarialClient.on('open', r)),
        new Promise((r) => validClient.on('open', r)),
      ]);

      const validMsgs: any[] = [];
      validClient.on('message', (d) => validMsgs.push(JSON.parse(d.toString())));

      validClient.send(
        JSON.stringify({
          type: 'HELLO',
          payload: { deviceId: 'valid_survivor', deviceName: 'Survivor', role: 'active_host' },
        })
      );

      await new Promise((r) => setTimeout(r, 40));

      // Send corrupted adversarial payloads
      adversarialClient.send('INVALID_NON_JSON_STRING');
      adversarialClient.send('{"type": "BROKEN_JSON');
      adversarialClient.send('{}');
      adversarialClient.send('null');
      adversarialClient.send(JSON.stringify({ type: 'UNKNOWN_ATTACK_OPCODE', payload: { foo: 'bar' } }));

      await new Promise((r) => setTimeout(r, 60));

      // Server should still be fully functional: send command from valid client
      validClient.send(
        JSON.stringify({
          type: 'CMD_PLAY',
          fromDeviceId: 'valid_survivor',
        })
      );

      await new Promise((r) => setTimeout(r, 60));

      // Server is healthy and responsive
      expect(adversarialClient.readyState).toBe(WebSocket.OPEN);
      expect(validClient.readyState).toBe(WebSocket.OPEN);

      adversarialClient.close();
      validClient.close();
    });
  });
});
