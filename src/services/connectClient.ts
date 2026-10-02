import {
  ConnectedDevice,
  ConnectMessage,
  DeviceType,
  PlaybackSnapshot,
  PlaybackStatePayload,
  RemoteCommand,
  RemoteCommandAction,
} from '../types/connect';
import { safeStorage } from '../utils/storage';

function generateId(): string {
  return 'dev_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

function detectDeviceType(): DeviceType {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent.toLowerCase() : '';
  if (!ua) {
    return 'desktop';
  }
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) {
    return 'tablet';
  }
  if (/mobile|iphone|ipod|android/i.test(ua)) {
    return 'mobile';
  }
  return 'desktop';
}

function getDefaultDeviceName(type: DeviceType): string {
  const platform = (typeof navigator !== 'undefined' && navigator.platform) ? navigator.platform : 'Web';
  switch (type) {
    case 'mobile':
      return `Dotify Mobile (${platform})`;
    case 'tablet':
      return `Dotify Tablet (${platform})`;
    case 'tv':
      return `Dotify TV (${platform})`;
    default:
      return `Dotify Desktop (${platform})`;
  }
}

export interface ConnectClientOptions {
  customDevice?: Partial<ConnectedDevice>;
  channelName?: string;
  enableWebSocket?: boolean;
  wsUrl?: string;
}

import { getWsUrl } from './apiConfig';

export class ConnectClient {
  private localDevice: ConnectedDevice;
  private ws: WebSocket | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private channelName: string;
  private enableWebSocket: boolean;
  private customWsUrl?: string;

  private discoveredDevices: Map<string, ConnectedDevice> = new Map();
  private activeDeviceId: string | null = null;
  private reconnectAttempt: number = 0;
  private reconnectTimeout: any = null;
  private isDestroyed: boolean = false;
  private processedMessageIds: Set<string> = new Set();

  // Listeners
  private deviceListListeners: Set<(devices: ConnectedDevice[], activeId: string | null) => void> = new Set();
  private playbackStateListeners: Set<(state: PlaybackStatePayload, fromId?: string) => void> = new Set();
  private remoteCommandListeners: Set<(command: RemoteCommand, fromId?: string) => void> = new Set();
  private handoffTransferListeners: Set<(state: PlaybackSnapshot, fromId: string, timestamp: number) => void> = new Set();
  private handoffAckListeners: Set<(ack: { success: boolean; resumedPositionMs: number; latencyMs?: number; fromId: string; error?: string }) => void> = new Set();

  constructor(options: ConnectClientOptions = {}) {
    this.channelName = options.channelName || 'dotify_connect';
    this.enableWebSocket = options.enableWebSocket !== false;
    this.customWsUrl = options.wsUrl;

    const storedId = safeStorage.getItem<string>('dotify_connect_device_id', '');
    const deviceId = options.customDevice?.deviceId || storedId || generateId();
    if (!storedId && !options.customDevice?.deviceId) {
      safeStorage.setItem('dotify_connect_device_id', deviceId);
    }

    const type = options.customDevice?.deviceType || detectDeviceType();
    const name = options.customDevice?.deviceName || getDefaultDeviceName(type);

    this.localDevice = {
      deviceId,
      deviceName: name,
      deviceType: type,
      role: options.customDevice?.role || 'standalone',
      isCurrentDevice: true,
      isActive: options.customDevice?.isActive ?? true,
      volume: options.customDevice?.volume ?? 0.8,
      lastSeen: Date.now(),
      capabilities: options.customDevice?.capabilities || {
        canPlayAudio: true,
        isController: true,
      },
    };

    this.discoveredDevices.set(this.localDevice.deviceId, { ...this.localDevice });
    if (this.localDevice.isActive) {
      this.activeDeviceId = this.localDevice.deviceId;
    }

    this.initBroadcastChannel();
    if (this.enableWebSocket) {
      this.initWebSocket();
    }
  }

  public getLocalDevice(): ConnectedDevice {
    return { ...this.localDevice };
  }

  public setLocalDevice(partial: Partial<ConnectedDevice>) {
    this.localDevice = { ...this.localDevice, ...partial };
    this.discoveredDevices.set(this.localDevice.deviceId, { ...this.localDevice });
    this.announceDevice();
  }

  public getDiscoveredDevices(): ConnectedDevice[] {
    return Array.from(this.discoveredDevices.values()).map((d) => ({
      ...d,
      isCurrentDevice: d.deviceId === this.localDevice.deviceId,
      isActive: d.deviceId === this.activeDeviceId,
    }));
  }

  public getActiveDeviceId(): string | null {
    return this.activeDeviceId;
  }

  public setActiveDeviceId(id: string | null) {
    this.activeDeviceId = id;
    if (this.localDevice.deviceId === id) {
      this.localDevice.isActive = true;
      this.localDevice.role = 'active_host';
    } else if (this.localDevice.role === 'active_host') {
      this.localDevice.isActive = false;
      this.localDevice.role = 'remote_controller';
    }
    this.notifyDeviceList();
  }

  public registerExternalDevice(dev: ConnectedDevice) {
    if (!dev || !dev.deviceId || dev.deviceId === this.localDevice.deviceId) return;
    this.discoveredDevices.set(dev.deviceId, {
      ...dev,
      isCurrentDevice: false,
      lastSeen: Date.now(),
    });
    this.notifyDeviceList();
  }

  public registerExternalDevices(devices: ConnectedDevice[]) {
    if (!Array.isArray(devices)) return;
    for (const dev of devices) {
      if (!dev || !dev.deviceId || dev.deviceId === this.localDevice.deviceId) continue;
      this.discoveredDevices.set(dev.deviceId, {
        ...dev,
        isCurrentDevice: false,
        lastSeen: Date.now(),
      });
    }
    this.notifyDeviceList();
  }

  private initBroadcastChannel() {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel(this.channelName);
        this.broadcastChannel.onmessage = (event) => {
          this.handleIncomingMessage(event.data);
        };
      } catch (err) {
        console.debug('[ConnectClient] BroadcastChannel initialization skipped:', err);
      }
    }
  }

  private initWebSocket() {
    const WS = typeof WebSocket !== 'undefined' ? WebSocket : (globalThis as any).WebSocket;
    if (!WS) return;

    const url = this.customWsUrl || getWsUrl();
    if (!url) return;

    try {
      const socket = new WS(url);
      this.ws = socket;

      socket.onopen = () => {
        this.reconnectAttempt = 0;
        this.announceDevice();
      };

      socket.onmessage = (event: any) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : event.data?.toString?.();
          const data = JSON.parse(raw);
          this.handleIncomingMessage(data);
        } catch (err) {
          console.warn('[ConnectClient] Failed to parse WebSocket message:', err);
        }
      };

      socket.onclose = () => {
        if (!this.isDestroyed) {
          this.scheduleReconnect();
        }
      };

      socket.onerror = () => {
        if (this.ws) {
          try {
            this.ws.close();
          } catch {}
        }
      };
    } catch (err) {
      console.debug('[ConnectClient] WebSocket connection failed:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout || this.isDestroyed) return;
    this.reconnectAttempt++;
    const delay = Math.min(15000, 1000 * Math.pow(1.4, this.reconnectAttempt)) + Math.random() * 500;
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (!this.isDestroyed && this.enableWebSocket) {
        this.initWebSocket();
      }
    }, delay);
  }

  public reconnect() {
    if (this.isDestroyed || !this.enableWebSocket) return;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    const WS = typeof WebSocket !== 'undefined' ? WebSocket : (globalThis as any).WebSocket;
    if (this.ws && WS && (this.ws.readyState === WS.OPEN || this.ws.readyState === WS.CONNECTING)) {
      return;
    }
    this.initWebSocket();
  }

  private handleIncomingMessage(msg: any) {
    if (!msg || typeof msg !== 'object') return;

    // Echo suppression
    if (msg.senderDeviceId && msg.senderDeviceId === this.localDevice.deviceId) {
      return;
    }

    // Deduplication across dual transports
    if (msg.messageId) {
      if (this.processedMessageIds.has(msg.messageId)) return;
      this.processedMessageIds.add(msg.messageId);
      if (this.processedMessageIds.size > 200) {
        const first = this.processedMessageIds.values().next().value;
        if (first) this.processedMessageIds.delete(first);
      }
    }

    const type = msg.type;

    switch (type) {
      case 'HELLO':
      case 'REGISTER':
      case 'DEVICE_ANNOUNCE': {
        const dev: ConnectedDevice = msg.payload || msg.device;
        if (dev && dev.deviceId && dev.deviceId !== this.localDevice.deviceId) {
          const isNewDevice = !this.discoveredDevices.has(dev.deviceId);
          this.discoveredDevices.set(dev.deviceId, {
            ...dev,
            isCurrentDevice: false,
            lastSeen: Date.now(),
          });
          this.notifyDeviceList();
          // Respond with announcement so sender discovers us, unless it was already a reply
          if (isNewDevice && !msg.isReply) {
            this.sendMessage({
              type: 'DEVICE_ANNOUNCE',
              device: this.localDevice,
              payload: this.localDevice,
              isReply: true,
            });
          }
        }
        break;
      }

      case 'DEVICE_LIST': {
        if (Array.isArray(msg.devices)) {
          for (const dev of msg.devices) {
            if (dev.deviceId === this.localDevice.deviceId) continue;
            this.discoveredDevices.set(dev.deviceId, {
              ...dev,
              isCurrentDevice: false,
              lastSeen: Date.now(),
            });
          }
          if (msg.activeDeviceId) {
            this.activeDeviceId = msg.activeDeviceId;
          }
          this.notifyDeviceList();
        }
        break;
      }

      case 'PLAYBACK_STATE':
      case 'STATE_SYNC': {
        const state: PlaybackStatePayload = msg.state || msg.payload;
        if (state) {
          if (msg.activeDeviceId) {
            this.activeDeviceId = msg.activeDeviceId;
          } else if (msg.senderDeviceId) {
            this.activeDeviceId = msg.senderDeviceId;
          }

          // Latency & clock drift compensation
          const now = Date.now();
          const transitDelta = Math.max(0, now - (state.timestamp || now));
          const compensatedPositionMs = state.isPlaying
            ? Math.min(state.durationMs || Infinity, state.positionMs + transitDelta)
            : state.positionMs;

          const compensatedState: PlaybackStatePayload = {
            ...state,
            currentTrack: state.currentTrack || state.activeTrack || null,
            activeTrack: state.currentTrack || state.activeTrack || null,
            currentTrackIndex: state.currentTrackIndex ?? state.currentIndex ?? 0,
            currentIndex: state.currentTrackIndex ?? state.currentIndex ?? 0,
            positionMs: compensatedPositionMs,
          };

          for (const listener of this.playbackStateListeners) {
            listener(compensatedState, msg.senderDeviceId || msg.fromDeviceId);
          }
        }
        break;
      }

      case 'REMOTE_COMMAND': {
        const target = msg.targetDeviceId;
        if (!target || target === this.localDevice.deviceId) {
          const cmd: RemoteCommand = msg.command;
          if (cmd) {
            for (const listener of this.remoteCommandListeners) {
              listener(cmd, msg.fromDeviceId || msg.senderDeviceId);
            }
          }
        }
        break;
      }

      // Legacy direct command types
      case 'CMD_PLAY':
      case 'CMD_PAUSE':
      case 'CMD_SEEK':
      case 'CMD_SET_VOLUME':
      case 'CMD_NEXT':
      case 'CMD_PREV': {
        const target = msg.targetDeviceId;
        if (!target || target === this.localDevice.deviceId) {
          let action: RemoteCommandAction = 'play';
          let data: any = {};
          if (type === 'CMD_PLAY') action = 'play';
          if (type === 'CMD_PAUSE') action = 'pause';
          if (type === 'CMD_SEEK') {
            action = 'seek';
            data = { positionMs: msg.positionMs, seconds: msg.positionMs / 1000 };
          }
          if (type === 'CMD_SET_VOLUME') {
            action = 'set_volume';
            data = { volume: Math.max(0, Math.min(1, msg.volume)) };
          }
          if (type === 'CMD_NEXT') action = 'next';
          if (type === 'CMD_PREV') action = 'previous';

          const cmd: RemoteCommand = { action, ...data };
          for (const listener of this.remoteCommandListeners) {
            listener(cmd, msg.fromDeviceId);
          }
        }
        break;
      }

      case 'HANDOFF':
      case 'HANDOFF_TRANSFER': {
        const target = msg.targetDeviceId || (msg.payload && msg.payload.toDeviceId);
        if (target === this.localDevice.deviceId) {
          const snapshot: PlaybackSnapshot = msg.state || (msg.payload && msg.payload.state);
          const fromId = msg.fromDeviceId || (msg.payload && msg.payload.fromDeviceId) || '';
          const ts = msg.timestamp || (msg.payload && msg.payload.timestamp) || Date.now();
          if (snapshot) {
            for (const listener of this.handoffTransferListeners) {
              listener(snapshot, fromId, ts);
            }
          }
        }
        break;
      }

      case 'HANDOFF_ACK': {
        const target = msg.toDeviceId;
        if (target === this.localDevice.deviceId || !target) {
          for (const listener of this.handoffAckListeners) {
            listener({
              success: msg.success ?? true,
              resumedPositionMs: msg.resumedPositionMs ?? 0,
              latencyMs: msg.latencyMs,
              fromId: msg.fromDeviceId,
              error: msg.error,
            });
          }
        }
        break;
      }

      case 'PAIR': {
        if (msg.targetDeviceId === this.localDevice.deviceId) {
          this.sendMessage({
            type: 'PAIRED',
            targetDevice: this.localDevice,
            role: 'active_host',
            controllerDeviceId: msg.fromDeviceId,
            hostDeviceId: this.localDevice.deviceId,
          });
        }
        break;
      }

      case 'UNPAIR': {
        if (msg.targetDeviceId === this.localDevice.deviceId || !msg.targetDeviceId) {
          this.localDevice.role = 'standalone';
          this.notifyDeviceList();
        }
        break;
      }

      case 'PING': {
        this.send({
          type: 'PONG',
          payload: { timestamp: Date.now() },
          timestamp: Date.now(),
        });
        break;
      }

      case 'PONG': {
        break;
      }

      default:
        break;
    }
  }

  public send(msg: any) {
    this.sendMessage(msg);
  }

  public sendMessage(msg: any) {
    const enriched = {
      ...msg,
      messageId: msg.messageId || generateId(),
      senderDeviceId: this.localDevice.deviceId,
      timestamp: msg.timestamp || Date.now(),
    };

    const str = JSON.stringify(enriched);

    // 1. WebSocket send
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(str);
      } catch (err) {
        console.warn('[ConnectClient] Failed to send over WebSocket:', err);
      }
    }

    // 2. BroadcastChannel send
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(enriched);
      } catch (err) {
        console.warn('[ConnectClient] Failed to send over BroadcastChannel:', err);
      }
    }
  }

  public announceDevice() {
    this.localDevice.lastSeen = Date.now();
    this.discoveredDevices.set(this.localDevice.deviceId, { ...this.localDevice });

    this.sendMessage({
      type: 'DEVICE_ANNOUNCE',
      device: this.localDevice,
      payload: this.localDevice,
    });
  }

  public broadcastPlaybackState(state: PlaybackStatePayload) {
    this.activeDeviceId = this.localDevice.deviceId;
    this.sendMessage({
      type: 'PLAYBACK_STATE',
      state,
      activeDeviceId: this.localDevice.deviceId,
    });
  }

  public sendRemoteCommand(action: RemoteCommandAction, data: any = {}, targetDeviceId?: string) {
    const target = targetDeviceId || this.activeDeviceId || undefined;
    const command: RemoteCommand = {
      action,
      ...data,
    };

    this.sendMessage({
      type: 'REMOTE_COMMAND',
      command,
      targetDeviceId: target,
      fromDeviceId: this.localDevice.deviceId,
    });
  }

  public async transferPlayback(targetDeviceId: string, snapshot: PlaybackSnapshot): Promise<boolean> {
    return new Promise((resolve) => {
      let resolved = false;

      const isCast = targetDeviceId.startsWith('cast:');
      const timeoutMs = isCast ? 15000 : 6000;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.handoffAckListeners.delete(ackHandler);
          resolve(false);
        }
      }, timeoutMs);

      const ackHandler = (ack: { success: boolean; fromId: string; resumedPositionMs: number }) => {
        if (ack.fromId === targetDeviceId) {
          resolved = true;
          clearTimeout(timeout);
          this.handoffAckListeners.delete(ackHandler);
          if (ack.success) {
            this.activeDeviceId = targetDeviceId;
            this.localDevice.isActive = false;
            this.localDevice.role = 'remote_controller';
            this.notifyDeviceList();
          }
          resolve(ack.success);
        }
      };

      this.handoffAckListeners.add(ackHandler);

      this.sendMessage({
        type: 'HANDOFF_TRANSFER',
        targetDeviceId,
        fromDeviceId: this.localDevice.deviceId,
        state: snapshot,
        timestamp: Date.now(),
      });
    });
  }

  public ackHandoff(fromDeviceId: string, success: boolean, resumedPositionMs: number, latencyMs?: number, error?: string) {
    this.activeDeviceId = this.localDevice.deviceId;
    this.localDevice.isActive = true;
    this.localDevice.role = 'active_host';
    this.notifyDeviceList();

    this.sendMessage({
      type: 'HANDOFF_ACK',
      fromDeviceId: this.localDevice.deviceId,
      toDeviceId: fromDeviceId,
      success,
      resumedPositionMs,
      latencyMs,
      error,
      timestamp: Date.now(),
    });
  }

  public pairWith(targetDeviceId: string) {
    this.localDevice.role = 'remote_controller';
    this.localDevice.isActive = false;
    this.activeDeviceId = targetDeviceId;
    this.notifyDeviceList();

    this.sendMessage({
      type: 'PAIR',
      targetDeviceId,
      fromDeviceId: this.localDevice.deviceId,
    });
  }

  public unpair() {
    this.localDevice.role = 'standalone';
    this.localDevice.isActive = true;
    this.activeDeviceId = this.localDevice.deviceId;
    this.notifyDeviceList();

    this.sendMessage({
      type: 'UNPAIR',
      fromDeviceId: this.localDevice.deviceId,
    });
  }

  private notifyDeviceList() {
    const list = this.getDiscoveredDevices();
    for (const listener of this.deviceListListeners) {
      listener(list, this.activeDeviceId);
    }
  }

  // Subscription methods
  public onDeviceListUpdate(cb: (devices: ConnectedDevice[], activeId: string | null) => void): () => void {
    this.deviceListListeners.add(cb);
    cb(this.getDiscoveredDevices(), this.activeDeviceId);
    return () => this.deviceListListeners.delete(cb);
  }

  public onPlaybackState(cb: (state: PlaybackStatePayload, fromId?: string) => void): () => void {
    this.playbackStateListeners.add(cb);
    return () => this.playbackStateListeners.delete(cb);
  }

  public onRemoteCommand(cb: (command: RemoteCommand, fromId?: string) => void): () => void {
    this.remoteCommandListeners.add(cb);
    return () => this.remoteCommandListeners.delete(cb);
  }

  public onHandoffTransfer(cb: (state: PlaybackSnapshot, fromId: string, timestamp: number) => void): () => void {
    this.handoffTransferListeners.add(cb);
    return () => this.handoffTransferListeners.delete(cb);
  }

  public onHandoffAck(cb: (ack: { success: boolean; resumedPositionMs: number; latencyMs?: number; fromId: string; error?: string }) => void): () => void {
    this.handoffAckListeners.add(cb);
    return () => this.handoffAckListeners.delete(cb);
  }

  public destroy() {
    this.isDestroyed = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch {}
      this.broadcastChannel = null;
    }
    this.deviceListListeners.clear();
    this.playbackStateListeners.clear();
    this.remoteCommandListeners.clear();
    this.handoffTransferListeners.clear();
    this.handoffAckListeners.clear();
  }
}

/**
 * ConnectNode adapter for test fixture compatibility
 */
export class ConnectNode {
  public client: ConnectClient;
  public discoveredDevices: Map<string, ConnectedDevice> = new Map();
  public playbackState: PlaybackStatePayload | null = null;
  public device: ConnectedDevice;

  constructor(device: ConnectedDevice, channelName = 'dotify_connect') {
    this.device = device;
    this.client = new ConnectClient({
      customDevice: device,
      channelName,
      enableWebSocket: false, // In unit tests, rely on MockBroadcastChannel
    });

    this.client.onDeviceListUpdate((devices) => {
      this.discoveredDevices.clear();
      for (const d of devices) {
        this.discoveredDevices.set(d.deviceId, d);
      }
    });

    this.client.onPlaybackState((state) => {
      this.playbackState = state;
    });
  }

  public announce() {
    this.client.announceDevice();
  }

  public send(msg: ConnectMessage) {
    this.client.sendMessage(msg);
  }

  public sendCommand(cmd: RemoteCommand, targetId?: string) {
    this.client.sendRemoteCommand(cmd.action, cmd, targetId);
  }

  public broadcastState(state: PlaybackStatePayload) {
    this.client.broadcastPlaybackState(state);
  }

  public transfer(targetId: string, snapshot: PlaybackSnapshot) {
    return this.client.transferPlayback(targetId, snapshot);
  }

  public destroy() {
    this.client.destroy();
  }
}

export const connectClient = new ConnectClient();
