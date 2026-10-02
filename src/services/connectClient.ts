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

let firestoreDb: any = null;
let firestoreApi: any = null;

async function getFirestoreRelay() {
  if (firestoreDb && firestoreApi) return { db: firestoreDb, ...firestoreApi };
  try {
    const fb = await import('./firebase');
    const fs = await import('firebase/firestore');
    if (fb && fb.db) {
      firestoreDb = fb.db;
      firestoreApi = fs;
      return { db: firestoreDb, ...fs };
    }
  } catch {
    // Graceful fallback if in offline or test mode
  }
  return null;
}

export class ConnectClient {
  private localDevice: ConnectedDevice;
  private ws: WebSocket | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private channelName: string;
  private enableWebSocket: boolean;
  private customWsUrl?: string;

  private discoveredDevices: Map<string, ConnectedDevice> = new Map();
  private rememberedVolumes: Map<string, number> = new Map();
  private activeDeviceId: string | null = null;
  private reconnectAttempt: number = 0;
  private reconnectTimeout: any = null;
  private isDestroyed: boolean = false;
  private processedMessageIds: Set<string> = new Set();
  private firestoreUnsubscribers: Array<() => void> = [];
  private isFirestoreInitialized: boolean = false;
  private initTimestamp: number = Date.now();

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

    // Load remembered device volumes
    const savedVols = safeStorage.getItem<Record<string, number>>('dotify_device_volumes', {});
    if (savedVols && typeof savedVols === 'object') {
      for (const [k, v] of Object.entries(savedVols)) {
        if (typeof v === 'number') this.rememberedVolumes.set(k, v);
      }
    }

    this.initBroadcastChannel();
    if (this.enableWebSocket) {
      this.initWebSocket();
    }
    if (typeof window !== 'undefined' && options.enableWebSocket !== false) {
      this.initFirestoreRelay().catch(() => {});
    }
  }

  public getLocalDevice(): ConnectedDevice {
    return { ...this.localDevice };
  }

  public setLocalDevice(partial: Partial<ConnectedDevice>) {
    if (typeof partial.volume === 'number') {
      this.rememberedVolumes.set(this.localDevice.deviceId, partial.volume);
    }
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

  public updateDeviceVolume(deviceId: string, volume: number) {
    if (!deviceId) return;
    const clamped = Math.max(0, Math.min(1, volume));
    this.rememberedVolumes.set(deviceId, clamped);
    try {
      const obj: Record<string, number> = {};
      for (const [k, v] of this.rememberedVolumes.entries()) {
        obj[k] = v;
      }
      safeStorage.setItem('dotify_device_volumes', obj);
    } catch {}

    const dev = this.discoveredDevices.get(deviceId);
    if (dev) {
      this.discoveredDevices.set(deviceId, {
        ...dev,
        volume: clamped,
      });
      this.notifyDeviceList();
    }
  }

  public getRememberedVolume(deviceId: string): number | undefined {
    return this.rememberedVolumes.get(deviceId);
  }

  public registerExternalDevice(dev: ConnectedDevice) {
    if (!dev || !dev.deviceId || dev.deviceId === this.localDevice.deviceId) return;
    const existing = this.discoveredDevices.get(dev.deviceId);
    const rememberedVol = this.rememberedVolumes.get(dev.deviceId);
    const resolvedVolume = typeof dev.volume === 'number' && dev.volume !== 0.7
      ? dev.volume
      : (rememberedVol ?? existing?.volume ?? dev.volume ?? 0.8);

    this.discoveredDevices.set(dev.deviceId, {
      ...dev,
      volume: resolvedVolume,
      isCurrentDevice: false,
      lastSeen: Date.now(),
    });
    this.notifyDeviceList();
  }

  public registerExternalDevices(devices: ConnectedDevice[]) {
    if (!Array.isArray(devices)) return;
    for (const dev of devices) {
      if (!dev || !dev.deviceId || dev.deviceId === this.localDevice.deviceId) continue;
      const existing = this.discoveredDevices.get(dev.deviceId);
      const rememberedVol = this.rememberedVolumes.get(dev.deviceId);
      const resolvedVolume = typeof dev.volume === 'number' && dev.volume !== 0.7
        ? dev.volume
        : (rememberedVol ?? existing?.volume ?? dev.volume ?? 0.8);

      this.discoveredDevices.set(dev.deviceId, {
        ...dev,
        volume: resolvedVolume,
        isCurrentDevice: false,
        lastSeen: Date.now(),
      });
    }
    this.notifyDeviceList();
  }

  private getSessionId(): string {
    try {
      if (typeof localStorage !== 'undefined') {
        const uid = localStorage.getItem('dotify_user_id') || localStorage.getItem('dotify_connect_session_id');
        if (uid && uid.trim()) {
          return `sess_${uid.trim().replace(/[^a-zA-Z0-9_-]/g, '')}`;
        }
      }
    } catch {}
    return 'sess_default_network';
  }

  private async initFirestoreRelay() {
    if (this.isFirestoreInitialized || this.isDestroyed) return;
    if (typeof window === 'undefined') return;

    const fs = await getFirestoreRelay();
    if (!fs || !fs.db) return;
    this.isFirestoreInitialized = true;

    const sessionId = this.getSessionId();

    try {
      // 1. Announce this device presence in Firestore
      const devDoc = fs.doc(fs.db, 'connect_sessions', sessionId, 'devices', this.localDevice.deviceId);
      await fs.setDoc(devDoc, JSON.parse(JSON.stringify({
        ...this.localDevice,
        lastSeen: Date.now(),
      })), { merge: true });

      // 2. Listen to device presence changes
      const devCol = fs.collection(fs.db, 'connect_sessions', sessionId, 'devices');
      const unsubDevs = fs.onSnapshot(devCol, (snap: any) => {
        const remoteDevs: ConnectedDevice[] = [];
        const now = Date.now();
        snap.forEach((docSnap: any) => {
          const data = docSnap.data();
          if (data && data.deviceId && data.deviceId !== this.localDevice.deviceId) {
            if (now - (data.lastSeen || 0) < 180000) {
              remoteDevs.push(data as ConnectedDevice);
            }
          }
        });
        if (remoteDevs.length > 0) {
          this.registerExternalDevices(remoteDevs);
        }
      });
      this.firestoreUnsubscribers.push(unsubDevs);

      // 3. Listen to shared playback state
      const stateDoc = fs.doc(fs.db, 'connect_sessions', sessionId, 'state', 'current');
      const unsubState = fs.onSnapshot(stateDoc, (snap: any) => {
        if (!snap.exists()) return;
        const data = snap.data();
        if (data && data.senderDeviceId !== this.localDevice.deviceId) {
          if (data.state && Date.now() - (data.timestamp || 0) < 60000) {
            this.handleIncomingMessage({
              type: 'PLAYBACK_STATE',
              state: data.state,
              activeDeviceId: data.activeDeviceId,
              senderDeviceId: data.senderDeviceId,
              fromDeviceId: data.senderDeviceId,
              timestamp: data.timestamp || Date.now(),
            });
          }
        }
      });
      this.firestoreUnsubscribers.push(unsubState);

      // 4. Listen to remote commands directed to this device or active host
      const cmdCol = fs.collection(fs.db, 'connect_sessions', sessionId, 'commands');
      const unsubCmds = fs.onSnapshot(cmdCol, (snap: any) => {
        snap.docChanges().forEach(async (change: any) => {
          if (change.type === 'added') {
            const data = change.doc.data();
            if (data && data.fromDeviceId !== this.localDevice.deviceId) {
              const isTargeted =
                data.targetDeviceId === this.localDevice.deviceId ||
                (!data.targetDeviceId && this.localDevice.isActive);

              if (Date.now() - (data.timestamp || 0) >= 15000) {
                try {
                  await fs.deleteDoc(change.doc.ref);
                } catch {}
              } else if (isTargeted && data.command) {
                this.handleIncomingMessage({
                  type: 'REMOTE_COMMAND',
                  command: data.command,
                  fromDeviceId: data.fromDeviceId,
                  targetDeviceId: data.targetDeviceId,
                  timestamp: data.timestamp,
                });
                try {
                  await fs.deleteDoc(change.doc.ref);
                } catch {}
              }
            }
          }
        });
      });
      this.firestoreUnsubscribers.push(unsubCmds);
    } catch (err) {
      console.debug('[ConnectClient] Firestore relay setup deferred:', err);
    }
  }

  private async syncMessageToFirestore(msg: any) {
    if (typeof window === 'undefined') return;
    const fs = await getFirestoreRelay();
    if (!fs || !fs.db) return;

    const sessionId = this.getSessionId();

    try {
      if (msg.type === 'PLAYBACK_STATE') {
        const stateDoc = fs.doc(fs.db, 'connect_sessions', sessionId, 'state', 'current');
        await fs.setDoc(stateDoc, JSON.parse(JSON.stringify({
          state: msg.state,
          activeDeviceId: msg.activeDeviceId || this.activeDeviceId || this.localDevice.deviceId,
          senderDeviceId: this.localDevice.deviceId,
          timestamp: Date.now(),
        })));
      } else if (msg.type === 'REMOTE_COMMAND') {
        const cmdDoc = fs.doc(fs.collection(fs.db, 'connect_sessions', sessionId, 'commands'));
        await fs.setDoc(cmdDoc, JSON.parse(JSON.stringify({
          command: msg.command,
          targetDeviceId: msg.targetDeviceId || this.activeDeviceId || '',
          fromDeviceId: this.localDevice.deviceId,
          timestamp: Date.now(),
        })));
      } else if (msg.type === 'DEVICE_ANNOUNCE') {
        const devDoc = fs.doc(fs.db, 'connect_sessions', sessionId, 'devices', this.localDevice.deviceId);
        await fs.setDoc(devDoc, JSON.parse(JSON.stringify({
          ...this.localDevice,
          lastSeen: Date.now(),
        })), { merge: true });
      }
    } catch (err) {
      console.debug('[ConnectClient] Failed to push to Firestore relay:', err);
    }
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
          const prevActiveId = this.activeDeviceId;
          if (msg.activeDeviceId) {
            this.activeDeviceId = msg.activeDeviceId;
          } else if (msg.senderDeviceId) {
            this.activeDeviceId = msg.senderDeviceId;
          } else if (msg.fromDeviceId) {
            this.activeDeviceId = msg.fromDeviceId;
          }

          if (this.activeDeviceId && this.activeDeviceId !== prevActiveId) {
            this.notifyDeviceList();
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

          const fromId = msg.senderDeviceId || msg.fromDeviceId || msg.activeDeviceId || this.activeDeviceId || '';
          for (const listener of this.playbackStateListeners) {
            listener(compensatedState, fromId);
          }
        }
        break;
      }

      case 'REMOTE_COMMAND': {
        const target = msg.targetDeviceId;
        if (!target || target === this.localDevice.deviceId || (this.localDevice.isActive && !target)) {
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

    // 3. Firestore Relay send (for serverless standalone sync)
    this.syncMessageToFirestore(enriched).catch(() => {});
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
    for (const unsub of this.firestoreUnsubscribers) {
      try { unsub(); } catch {}
    }
    this.firestoreUnsubscribers = [];
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
