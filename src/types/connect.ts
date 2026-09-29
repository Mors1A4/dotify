import { Track } from './track';

export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'tv' | 'speaker' | 'cast' | 'web';
export type ConnectRole = 'active_host' | 'remote_controller' | 'standalone';
export type ConnectMode = 'standalone' | 'active_host' | 'remote_controller';

export interface DeviceCapabilities {
  canPlayAudio: boolean;
  isController: boolean;
}

export interface ConnectedDevice {
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  role: ConnectRole;
  isCurrentDevice: boolean;
  isActive: boolean;
  volume: number; // 0.0 to 1.0
  lastSeen: number;
  capabilities?: DeviceCapabilities;
}

// Backward compatibility alias
export type DeviceInfo = ConnectedDevice;

export interface PlaybackStatePayload {
  currentTrack: Track | null;
  activeTrack?: Track | null; // Compatibility alias
  currentTrackIndex: number;
  currentIndex?: number; // Compatibility alias
  queue: Track[];
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  volume: number; // 0.0 to 1.0
  repeatMode: 'off' | 'all' | 'one';
  shuffle: boolean;
  timestamp: number; // Epoch timestamp (ms) for clock drift calculation
}

// Compatibility aliases
export type PlaybackStateSync = PlaybackStatePayload;
export type RemotePlaybackStatePayload = PlaybackStatePayload;

export interface PlaybackSnapshot {
  track: Track;
  queue: Track[];
  currentTrackIndex: number;
  positionMs: number;
  isPlaying: boolean;
  volume: number;
  repeatMode: 'off' | 'all' | 'one';
  shuffle: boolean;
  capturedAt: number;
}

export interface HandoffPayload {
  fromDeviceId: string;
  toDeviceId: string;
  timestamp: number;
  state: PlaybackSnapshot;
}

export type RemoteCommandAction =
  | 'play'
  | 'pause'
  | 'stop'
  | 'toggle_play'
  | 'togglePlay'
  | 'seek'
  | 'next'
  | 'previous'
  | 'prev'
  | 'set_volume'
  | 'setVolume'
  | 'play_track'
  | 'playTrack'
  | 'play_next'
  | 'playNext'
  | 'add_to_end'
  | 'addToEnd'
  | 'set_queue'
  | 'setQueue'
  | 'reorder_queue'
  | 'reorderQueue'
  | 'remove_from_queue'
  | 'removeFromQueue'
  | 'clear_queue'
  | 'clearQueue'
  | 'set_repeat'
  | 'setRepeat'
  | 'set_shuffle'
  | 'setShuffle';

export interface RemoteCommand {
  action: RemoteCommandAction;
  data?: any;
  positionMs?: number;
  seconds?: number;
  volume?: number;
  track?: Track;
  queue?: Track[];
  fromIndex?: number;
  toIndex?: number;
  index?: number;
  mode?: 'off' | 'all' | 'one';
  shuffle?: boolean;
}

export type ConnectMessage =
  | { type: 'HELLO'; payload: ConnectedDevice; messageId?: string; senderDeviceId?: string }
  | { type: 'REGISTER'; payload: ConnectedDevice; messageId?: string; senderDeviceId?: string }
  | { type: 'DEVICE_ANNOUNCE'; device: ConnectedDevice; messageId?: string; senderDeviceId?: string }
  | { type: 'DEVICE_LIST'; devices: ConnectedDevice[]; activeDeviceId?: string | null; timestamp?: number; messageId?: string }
  | { type: 'DEVICE_LIST_REQUEST'; messageId?: string; senderDeviceId?: string }
  | { type: 'PLAYBACK_STATE'; state: PlaybackStatePayload; activeDeviceId?: string | null; senderDeviceId?: string; timestamp?: number; messageId?: string }
  | { type: 'STATE_SYNC'; state: PlaybackStatePayload; activeDeviceId?: string | null; senderDeviceId?: string; timestamp?: number; messageId?: string }
  | { type: 'REMOTE_COMMAND'; command: RemoteCommand; targetDeviceId?: string; fromDeviceId?: string; timestamp?: number; messageId?: string }
  | { type: 'CMD_PLAY'; targetDeviceId?: string; fromDeviceId?: string; messageId?: string }
  | { type: 'CMD_PAUSE'; targetDeviceId?: string; fromDeviceId?: string; messageId?: string }
  | { type: 'CMD_SEEK'; positionMs: number; targetDeviceId?: string; fromDeviceId?: string; messageId?: string }
  | { type: 'CMD_SET_VOLUME'; volume: number; targetDeviceId?: string; fromDeviceId?: string; messageId?: string }
  | { type: 'CMD_NEXT'; targetDeviceId?: string; fromDeviceId?: string; messageId?: string }
  | { type: 'CMD_PREV'; targetDeviceId?: string; fromDeviceId?: string; messageId?: string }
  | { type: 'HANDOFF'; payload: HandoffPayload; targetDeviceId?: string; fromDeviceId?: string; messageId?: string }
  | { type: 'HANDOFF_TRANSFER'; targetDeviceId: string; fromDeviceId?: string; state: PlaybackSnapshot; timestamp?: number; messageId?: string }
  | { type: 'HANDOFF_ACK'; fromDeviceId: string; toDeviceId: string; success: boolean; resumedPositionMs: number; latencyMs?: number; timestamp: number; error?: string; messageId?: string }
  | { type: 'PAIR'; targetDeviceId: string; fromDeviceId?: string; timestamp?: number; messageId?: string }
  | { type: 'PAIRED'; targetDevice: ConnectedDevice; role: ConnectRole; hostDeviceId?: string; controllerDeviceId?: string; messageId?: string }
  | { type: 'UNPAIR'; targetDeviceId?: string; fromDeviceId?: string; messageId?: string }
  | { type: 'PING'; timestamp?: number; messageId?: string }
  | { type: 'PONG'; timestamp?: number; messageId?: string };
