import { vi } from 'vitest';
import './testIndexedDB';

/**
 * Setup web mocks for Node / jsdom environment in Vitest.
 */

// Mock AudioParam
class MockAudioParam {
  value: number;
  defaultValue: number;
  minValue: number;
  maxValue: number;
  constructor(defaultValue = 0) {
    this.value = defaultValue;
    this.defaultValue = defaultValue;
    this.minValue = -100;
    this.maxValue = 100;
  }
  setValueAtTime(val: number) {
    this.value = val;
  }
  linearRampToValueAtTime(val: number) {
    this.value = val;
  }
  exponentialRampToValueAtTime(val: number) {
    this.value = val;
  }
  setTargetAtTime(val: number) {
    this.value = val;
  }
}

// Mock AudioNode base
class MockAudioNode {
  connect(dest: any) {
    return dest;
  }
  disconnect() {}
}

// Mock BiquadFilterNode
class MockBiquadFilterNode extends MockAudioNode {
  frequency: MockAudioParam;
  gain: MockAudioParam;
  Q: MockAudioParam;
  type: string;
  constructor() {
    super();
    this.frequency = new MockAudioParam(1000);
    this.gain = new MockAudioParam(0);
    this.Q = new MockAudioParam(1.4142);
    this.type = 'peaking';
  }
}

// Mock GainNode
class MockGainNode extends MockAudioNode {
  gain: MockAudioParam;
  constructor() {
    super();
    this.gain = new MockAudioParam(1);
  }
}

// Mock AnalyserNode
class MockAnalyserNode extends MockAudioNode {
  fftSize = 2048;
  frequencyBinCount = 1024;
  minDecibels = -100;
  maxDecibels = -30;
  smoothingTimeConstant = 0.8;
  getByteFrequencyData(arr: Uint8Array) {
    arr.fill(128);
  }
  getByteTimeDomainData(arr: Uint8Array) {
    arr.fill(128);
  }
}

// Mock AudioContext
class MockAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  sampleRate = 44100;
  currentTime = 0;
  destination = new MockAudioNode();
  createBiquadFilter() {
    return new MockBiquadFilterNode();
  }
  createGain() {
    return new MockGainNode();
  }
  createAnalyser() {
    return new MockAnalyserNode();
  }
  createMediaElementSource(_el: HTMLMediaElement) {
    return new MockAudioNode();
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }
  resume = vi.fn().mockResolvedValue(undefined);
  suspend = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
}

// Attach to global window
(global as any).AudioContext = MockAudioContext;
(global as any).webkitAudioContext = MockAudioContext;

// Mock MediaSession
class MockMediaSession {
  metadata: any = null;
  playbackState: 'none' | 'paused' | 'playing' = 'none';
  actionHandlers = new Map<string, Function>();
  positionState: any = null;

  setActionHandler(action: string, handler: Function | null) {
    if (handler) {
      this.actionHandlers.set(action, handler);
    } else {
      this.actionHandlers.delete(action);
    }
  }

  setPositionState(state?: any) {
    this.positionState = state || null;
  }
}

if (typeof navigator !== 'undefined') {
  (navigator as any).mediaSession = new MockMediaSession();
} else {
  (global as any).navigator = {
    mediaSession: new MockMediaSession(),
  };
}

// Mock CacheStorage
class MockCache {
  private store = new Map<string, Response>();

  async match(request: string | Request): Promise<Response | undefined> {
    const key = typeof request === 'string' ? request : request.url;
    return this.store.get(key);
  }

  async put(request: string | Request, response: Response): Promise<void> {
    const key = typeof request === 'string' ? request : request.url;
    this.store.set(key, response);
  }

  async delete(request: string | Request): Promise<boolean> {
    const key = typeof request === 'string' ? request : request.url;
    return this.store.delete(key);
  }

  async keys(): Promise<Request[]> {
    return Array.from(this.store.keys()).map((k) => new Request(k));
  }
}

class MockCacheStorage {
  private caches = new Map<string, MockCache>();

  async open(cacheName: string): Promise<MockCache> {
    if (!this.caches.has(cacheName)) {
      this.caches.set(cacheName, new MockCache());
    }
    return this.caches.get(cacheName)!;
  }

  async has(cacheName: string): Promise<boolean> {
    return this.caches.has(cacheName);
  }

  async delete(cacheName: string): Promise<boolean> {
    return this.caches.delete(cacheName);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.caches.keys());
  }
}

(global as any).caches = new MockCacheStorage();

// Mock BroadcastChannel
class MockBroadcastChannel {
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  private static channels = new Map<string, Set<MockBroadcastChannel>>();

  constructor(name: string) {
    this.name = name;
    if (!MockBroadcastChannel.channels.has(name)) {
      MockBroadcastChannel.channels.set(name, new Set());
    }
    MockBroadcastChannel.channels.get(name)!.add(this);
  }

  postMessage(message: any) {
    const set = MockBroadcastChannel.channels.get(this.name);
    if (!set) return;
    for (const channel of set) {
      if (channel !== this && channel.onmessage) {
        channel.onmessage({ data: message } as MessageEvent);
      }
    }
  }

  close() {
    const set = MockBroadcastChannel.channels.get(this.name);
    if (set) {
      set.delete(this);
    }
  }
}

(global as any).BroadcastChannel = MockBroadcastChannel;

// Mock matchMedia
(global as any).matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

// Mock localStorage
if (typeof localStorage === 'undefined' || !(global as any).localStorage) {
  let store: Record<string, string> = {};
  (global as any).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  };
}

// Mock Audio
class MockAudioElement {
  src = '';
  crossOrigin = '';
  preload = '';
  currentTime = 0;
  duration = 180;
  paused = true;
  ended = false;
  volume = 1;
  error: any = null;
  private listeners = new Map<string, Set<Function>>();

  addEventListener(event: string, handler: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  removeEventListener(event: string, handler: Function) {
    this.listeners.get(event)?.delete(handler);
  }

  dispatchEvent(event: string) {
    this.listeners.get(event)?.forEach((fn) => fn());
  }

  load() {}
  async play() {
    this.paused = false;
    this.dispatchEvent('play');
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent('pause');
  }
}

(global as any).Audio = MockAudioElement;
if (typeof window !== 'undefined') {
  (window as any).Audio = MockAudioElement;
}

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { WebSocket: WsWebSocket } = require('ws');
  if (typeof (global as any).WebSocket === 'undefined') {
    (global as any).WebSocket = WsWebSocket;
  }
} catch {}

