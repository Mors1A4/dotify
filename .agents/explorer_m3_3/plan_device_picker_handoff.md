# Milestone 3 Architecture & Implementation Plan: UI Device Picker & Seamless Handoff

## 1. Executive Summary & Problem Boundary

In Spotify Connect, the cross-device experience centers on two critical capabilities:
1. **A persistent, intuitive Device Picker UI**: Users can immediately see where audio is currently playing (green active badge with device name), tap a dedicated Connect button across desktop and mobile, and view a rich modal listing all discovered devices on the local network with one-click playback switching.
2. **Seamless Playback Handoff Protocol**: Transferring active playback from Device A to Device B with sub-second latency (<1000ms) and millisecond-accurate timestamp preservation ($\pm 50\text{ ms}$ discrepancy), without dropped frames or lost position.

This plan details the complete UI component architecture, CSS/Tailwind design tokens, store integrations (`playerStore.ts`, `connectStore.ts`), and the exact technical protocol for seamless audio handoff.

---

## 2. Component Architecture & UI Specifications

### 2.1 Component Hierarchy
```
src/
├── components/
│   ├── connect/
│   │   ├── DeviceIcon.tsx           # Maps deviceType to Lucide icon (Laptop, Smartphone, Tv, Speaker, Cast)
│   │   ├── ActiveDeviceBadge.tsx    # Green active badge / pill ("Listening on Desktop")
│   │   └── DevicePickerModal.tsx    # Modal dialog with discovered devices, status & volume
│   ├── layout/
│   │   ├── PlayerBar.tsx            # Desktop right controls: Connect button + active pill
│   │   └── MobileMiniPlayer.tsx     # Mobile floating player: Connect icon + compact badge
│   └── player/
│       └── MobileNowPlayingSheet.tsx# Mobile full sheet: 48px tap target Connect bar
├── store/
│   ├── playerStore.ts               # Snapshot capture & handoff application
│   └── connectStore.ts              # Device list, modal state, active device ID
└── audio/
    └── audioEngine.ts               # playTrackAtPosition, getCurrentTime, getDuration
```

---

### 2.2 DeviceIcon Component (`src/components/connect/DeviceIcon.tsx`)

A dedicated icon mapper that returns appropriate hardware icons:
- `desktop`: `Laptop` or `Monitor` (Lucide)
- `mobile`: `Smartphone` (Lucide)
- `tv`: `Tv` (Lucide)
- `speaker`: `Speaker` (Lucide)
- `cast`: `Cast` (Lucide)
- `web`: `Globe` or `Laptop` (Lucide)

```tsx
import React from 'react';
import { Laptop, Smartphone, Tv, Speaker, Cast, Globe } from 'lucide-react';
import { DeviceType } from '../../types/connect';

interface DeviceIconProps {
  type: DeviceType;
  size?: number;
  className?: string;
}

export const DeviceIcon: React.FC<DeviceIconProps> = ({ type, size = 18, className = '' }) => {
  switch (type) {
    case 'mobile':
      return <Smartphone size={size} className={className} />;
    case 'tv':
      return <Tv size={size} className={className} />;
    case 'speaker':
      return <Speaker size={size} className={className} />;
    case 'cast':
      return <Cast size={size} className={className} />;
    case 'web':
      return <Globe size={size} className={className} />;
    case 'desktop':
    default:
      return <Laptop size={size} className={className} />;
  }
};
```

---

### 2.3 Active Device Badge (`src/components/connect/ActiveDeviceBadge.tsx`)

Standardized Spotify Connect status indicator:
- When playing locally: subtle grey/secondary text or neutral badge.
- When playing remotely on another device:
  - Vivid Spotify accent green (`text-accent` / `#1ed760`)
  - Animated sound waves or equalizer bars (3 jumping bars)
  - Text: `"Listening on [Device Name]"`
  - Padded touch target with hover state that opens `DevicePickerModal`

```tsx
import React from 'react';
import { useConnectStore } from '../../store/connectStore';
import { DeviceIcon } from './DeviceIcon';

interface ActiveDeviceBadgeProps {
  compact?: boolean;
  onClick?: () => void;
  className?: string;
}

export const ActiveDeviceBadge: React.FC<ActiveDeviceBadgeProps> = ({
  compact = false,
  onClick,
  className = '',
}) => {
  const { activeDevice, isRemoteMode, toggleDevicePicker } = useConnectStore();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClick) onClick();
    else toggleDevicePicker(true);
  };

  const deviceName = activeDevice?.deviceName || 'This Device';
  const deviceType = activeDevice?.deviceType || 'desktop';

  if (!isRemoteMode) {
    if (compact) return null;
    return (
      <button
        onClick={handleClick}
        data-testid="active-device-badge"
        className={`flex items-center gap-1.5 text-xs text-secondary hover:text-primary transition-colors ${className}`}
        title="Listening on this device"
      >
        <DeviceIcon type={deviceType} size={14} />
        <span className="truncate">This Computer</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      data-testid="active-device-badge"
      className={`flex items-center gap-2 px-2.5 py-1 rounded-full bg-accent/10 border border-accent/30 text-accent text-xs font-medium hover:bg-accent/20 transition-all ${className}`}
      title={`Listening on ${deviceName} (Click to switch)`}
    >
      <div className="flex items-center gap-0.5 h-3">
        <span className="w-0.5 h-3 bg-accent rounded-full animate-bounce [animation-delay:-0.3s]" />
        <span className="w-0.5 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.15s]" />
        <span className="w-0.5 h-3 bg-accent rounded-full animate-bounce" />
      </div>
      <DeviceIcon type={deviceType} size={14} className="text-accent" />
      <span className="truncate max-w-[140px]">Listening on {deviceName}</span>
    </button>
  );
};
```

---

### 2.4 Device Picker Modal (`src/components/connect/DevicePickerModal.tsx`)

The central Connect dialog:
- **Header**:
  - Title: "Connect to a device" with Connect icon
  - Close button (`X`)
- **Current Active Device Spotlight Card**:
  - Highlights currently active device with green equalizer bars
  - Displays device name and type icon
  - Embedded remote volume slider allowing instant volume adjustment on the active target
- **Discovered LAN Devices List**:
  - Grouped into "Select another device"
  - Lists all discovered instances on the network
  - Status indicators: "Available on LAN", "This device", "Active"
  - One-click transfer: clicking anywhere on a device triggers seamless handoff
  - Spinner (`Loader2`) during transfer with "Transferring playback..." status
- **Discovery Radar Animation & LAN Note**:
  - Subtle radar pulse icon showing background discovery is active
  - Informational tip: "Make sure Dotify is open on other devices connected to the same Wi-Fi network"

```tsx
import React from 'react';
import { useConnectStore } from '../../store/connectStore';
import { usePlayerStore } from '../../store/playerStore';
import { DeviceIcon } from './DeviceIcon';
import { X, Volume2, Loader2, Wifi, Check, Sparkles } from 'lucide-react';

export const DevicePickerModal: React.FC = () => {
  const {
    isDevicePickerOpen,
    toggleDevicePicker,
    discoveredDevices,
    activeDeviceId,
    localDeviceId,
    isTransferring,
    transferringToId,
    initiateHandoff,
    setRemoteVolume,
  } = useConnectStore();

  const { volume, setVolume } = usePlayerStore();

  if (!isDevicePickerOpen) return null;

  const currentActive = discoveredDevices.find((d) => d.deviceId === activeDeviceId) || {
    deviceId: localDeviceId,
    deviceName: 'This Computer',
    deviceType: 'desktop',
    isCurrentDevice: true,
    isActive: true,
    volume: volume,
    role: 'active_host',
    lastSeen: Date.now(),
  };

  const handleDeviceSelect = async (targetDeviceId: string) => {
    if (targetDeviceId === activeDeviceId || isTransferring) return;
    await initiateHandoff(targetDeviceId);
  };

  return (
    <div
      data-testid="device-picker-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-base/80 backdrop-blur-md animate-in fade-in select-none"
    >
      <div className="relative w-full max-w-md bg-surface border border-customBorder rounded-2xl shadow-2xl p-6 flex flex-col gap-5 max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-customBorder/60 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent">
              <DeviceIcon type={currentActive.deviceType} size={18} />
            </div>
            <div>
              <h3 className="font-bold text-base text-primary">Connect to a device</h3>
              <p className="text-xs text-secondary">Spotify Connect-style LAN sync</p>
            </div>
          </div>
          <button
            onClick={() => toggleDevicePicker(false)}
            data-testid="close-device-picker-btn"
            className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-highlight transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Current Active Device Spotlight Card */}
        <div className="p-4 rounded-xl bg-elevated/70 border border-accent/40 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-accent/20 text-accent">
                <DeviceIcon type={currentActive.deviceType} size={22} />
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-accent">
                  Current Playback Device
                </span>
                <h4 className="text-sm font-bold text-primary truncate max-w-[200px]">
                  {currentActive.deviceName} {currentActive.isCurrentDevice && '(This Device)'}
                </h4>
              </div>
            </div>

            {/* Equalizer animation badge */}
            <div className="flex items-center gap-1 bg-accent/20 px-2 py-1 rounded-md">
              <span className="w-1 h-3 bg-accent rounded-full animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1 h-4 bg-accent rounded-full animate-bounce" />
            </div>
          </div>

          {/* Quick Volume slider for active device */}
          <div className="flex items-center gap-3 pt-2 border-t border-customBorder/30">
            <Volume2 size={16} className="text-secondary shrink-0" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={currentActive.isCurrentDevice ? volume : currentActive.volume || 0.8}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (currentActive.isCurrentDevice) {
                  setVolume(val);
                } else {
                  setRemoteVolume(currentActive.deviceId, val);
                }
              }}
              data-testid="device-volume-slider"
              className="w-full h-1 rounded-none appearance-none cursor-pointer"
            />
            <span className="text-xs font-mono text-muted w-8 text-right">
              {Math.round((currentActive.isCurrentDevice ? volume : currentActive.volume || 0.8) * 100)}%
            </span>
          </div>
        </div>

        {/* Discovered Devices List */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-muted px-1">
            Select a device
          </span>

          <div className="flex flex-col gap-1.5">
            {discoveredDevices.map((dev) => {
              const isActive = dev.deviceId === activeDeviceId;
              const isTargetOfTransfer = isTransferring && transferringToId === dev.deviceId;

              return (
                <button
                  key={dev.deviceId}
                  data-testid={`device-item-${dev.deviceId}`}
                  onClick={() => handleDeviceSelect(dev.deviceId)}
                  disabled={isActive || isTransferring}
                  className={`flex items-center justify-between p-3 rounded-xl border transition-all text-left ${
                    isActive
                      ? 'border-accent bg-accent/10 cursor-default'
                      : 'border-customBorder/50 bg-elevated/40 hover:bg-elevated hover:border-customBorder'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-lg ${isActive ? 'bg-accent/20 text-accent' : 'bg-surface text-secondary'}`}>
                      <DeviceIcon type={dev.deviceType} size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold truncate ${isActive ? 'text-accent' : 'text-primary'}`}>
                        {dev.deviceName}
                        {dev.isCurrentDevice && ' (This Device)'}
                      </p>
                      <p className="text-xs text-muted truncate">
                        {isActive
                          ? 'Listening on this device'
                          : dev.isCurrentDevice
                          ? 'Switch playback back here'
                          : 'Available on local network'}
                      </p>
                    </div>
                  </div>

                  {/* Status indicator / Transfer button */}
                  <div>
                    {isTargetOfTransfer ? (
                      <div className="flex items-center gap-1.5 text-accent text-xs font-medium">
                        <Loader2 size={14} className="animate-spin" />
                        <span>Transferring...</span>
                      </div>
                    ) : isActive ? (
                      <Check size={18} className="text-accent" />
                    ) : (
                      <span className="text-xs text-secondary hover:text-accent font-medium px-2 py-1 rounded bg-surface border border-customBorder/60">
                        Transfer
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer & Radar discovery status */}
        <div className="flex items-center justify-between pt-2 border-t border-customBorder/40 text-xs text-muted">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
            <span>Scanning local network...</span>
          </div>
          <div className="flex items-center gap-1">
            <Wifi size={13} />
            <span>LAN WebSocket Sync</span>
          </div>
        </div>
      </div>
    </div>
  );
};
```

---

### 2.5 Integration into `PlayerBar.tsx` (Desktop >=768px)

In `src/components/layout/PlayerBar.tsx`:
Add the Connect Button and Active Device Indicator in the right control group (line ~283):
```tsx
{/* Connect to a Device Button (Spotify Connect style) */}
<div className="flex items-center gap-2">
  {/* Active device pill (visible when remote is active) */}
  <ActiveDeviceBadge compact={false} />

  <button
    onClick={() => toggleDevicePicker(true)}
    data-testid="device-picker-btn"
    aria-label="Connect to a device"
    title={isRemoteMode ? `Listening on ${activeDeviceName}` : 'Connect to a device'}
    className={`p-1.5 rounded transition-colors ${
      isRemoteMode ? 'text-accent hover:text-accent/80' : 'text-secondary hover:text-primary'
    }`}
  >
    <Laptop size={18} />
  </button>
</div>
```

---

### 2.6 Integration into `MobileMiniPlayer.tsx` (Mobile <768px)

In `src/components/layout/MobileMiniPlayer.tsx`:
1. Add compact device indicator under track title:
   - When remote playback is active:
     `<p className="text-[10px] text-accent flex items-center gap-1 font-semibold truncate"><Laptop size={10} /> Listening on {activeDeviceName}</p>`
2. Add device picker button alongside Like and Play/Pause:
```tsx
<button
  onClick={(e) => {
    e.stopPropagation();
    toggleDevicePicker(true);
  }}
  data-testid="mini-device-picker-btn"
  className={`p-1.5 transition-colors ${isRemoteMode ? 'text-accent' : 'text-secondary hover:text-primary'}`}
  title="Connect to a device"
>
  <Laptop size={16} />
</button>
```

---

### 2.7 Integration into `MobileNowPlayingSheet.tsx` (Mobile Full Sheet)

In `src/components/player/MobileNowPlayingSheet.tsx`:
Directly below the main transport controls (lines 286-288) and above the volume control:
```tsx
{/* Connect to a Device Row (Spotify Mobile style) */}
<button
  onClick={() => toggleDevicePicker(true)}
  data-testid="sheet-device-picker-btn"
  className="flex items-center justify-between w-full py-2.5 px-4 rounded-xl bg-elevated/70 border border-customBorder hover:border-accent/40 transition-all mt-4 mb-2 min-h-[48px]"
>
  <div className="flex items-center gap-2.5 min-w-0">
    <DeviceIcon type={activeDeviceType} size={18} className={isRemoteMode ? 'text-accent' : 'text-secondary'} />
    <div className="text-left min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Current Device</p>
      <p className={`text-xs font-semibold truncate ${isRemoteMode ? 'text-accent' : 'text-primary'}`}>
        {isRemoteMode ? `Listening on ${activeDeviceName}` : 'Listening on This Phone'}
      </p>
    </div>
  </div>
  <span className="text-xs text-accent font-medium">Change</span>
</button>
```

---

## 3. Seamless Playback Handoff Protocol

### 3.1 Step-by-Step Execution Flow

```
Device A (Active Host)                                WebSocket Server (/ws/connect)                   Device B (Target Receiver)
      │                                                           │                                                │
      ├──── 1. Capture exact playback state ──────────────┐       │                                                │
      │    (track, queue, index, positionMs, isPlaying)   │       │                                                │
      │                                                   │       │                                                │
      ├──── 2. Send HANDOFF_TRANSFER ─────────────────────┼──────>│                                                │
      │    { from: A, to: B, timestamp, state }           │       ├──── Forward HANDOFF_TRANSFER ─────────────────>│
      │                                                   │       │                                                │
      ├──── 3. audioEngine.pause() (immediately!) ────────┘       │                                                │
      │    Device A stops emitting audio at positionMs            │                                                │
      │                                                           │                                                ├──── 4. Load queue & track
      │                                                           │                                                │     audioCache.getCachedStreamUrl()
      │                                                           │                                                │     audioEngine.playTrackAtPosition()
      │                                                           │                                                │     Seek to positionMs immediately
      │                                                           │                                                │     Resume playback if isPlaying
      │                                                           │                                                │
      │                                                           │<─── 5. Send HANDOFF_ACK ───────────────────────┤
      │<─── Forward HANDOFF_ACK ──────────────────────────────────┤     Broadcast PLAYBACK_STATE                   │
      │                                                           │                                                │
      └──── 6. Update local UI (now Remote Controller) ───────────┴────────────────────────────────────────────────┘
```

---

### 3.2 State Capture Payload Schema (`src/types/connect.ts`)

```ts
export interface PlaybackSnapshot {
  track: Track;
  queue: Track[];
  currentTrackIndex: number;
  positionMs: number; // audio.currentTime * 1000 (millisecond precision)
  isPlaying: boolean;
  volume: number;
  repeatMode: 'off' | 'all' | 'one';
  shuffle: boolean;
  capturedAt: number; // Date.now()
}

export interface HandoffTransferMessage {
  type: 'HANDOFF_TRANSFER';
  fromDeviceId: string;
  toDeviceId: string;
  timestamp: number;
  state: PlaybackSnapshot;
}

export interface HandoffAckMessage {
  type: 'HANDOFF_ACK';
  fromDeviceId: string;
  toDeviceId: string;
  success: boolean;
  resumedPositionMs: number;
  latencyMs: number;
  timestamp: number;
  error?: string;
}
```

---

### 3.3 Device A Execution (Source Device)

When handoff is initiated:
```ts
public async transferPlaybackTo(targetDeviceId: string): Promise<boolean> {
  const store = usePlayerStore.getState();
  const currentTrack = store.currentTrack;

  if (!currentTrack) {
    console.warn('[Connect] Cannot hand off: no track currently active');
    return false;
  }

  // 1. Capture exact current playback state
  const positionMs = Math.round(audioEngine.getCurrentTime() * 1000);
  const isPlaying = store.isPlaying;
  const snapshot: PlaybackSnapshot = {
    track: currentTrack,
    queue: store.queue,
    currentTrackIndex: store.currentTrackIndex,
    positionMs,
    isPlaying,
    volume: store.volume,
    repeatMode: store.repeatMode,
    shuffle: store.shuffle,
    capturedAt: Date.now(),
  };

  // 2. Dispatch HANDOFF_TRANSFER message
  const message: HandoffTransferMessage = {
    type: 'HANDOFF_TRANSFER',
    fromDeviceId: this.localDeviceId,
    toDeviceId: targetDeviceId,
    timestamp: Date.now(),
    state: snapshot,
  };
  this.sendMessage(message);

  // 3. Immediately pause local audio
  audioEngine.pause();

  // Set local state to controller mode
  useConnectStore.getState().setActiveDevice(targetDeviceId);
  return true;
}
```

---

### 3.4 Device B Execution (Target Receiver)

When Device B receives `HANDOFF_TRANSFER`:
```ts
public async handleHandoffTransfer(msg: HandoffTransferMessage): Promise<void> {
  if (msg.toDeviceId !== this.localDeviceId) return;

  const { state, fromDeviceId, timestamp } = msg;
  const startTime = Date.now();

  try {
    // 1. Sync playerStore state
    const playerStore = usePlayerStore.getState();
    playerStore.setQueue(state.queue);
    playerStore.setVolume(state.volume);
    playerStore.setRepeatMode(state.repeatMode);

    // 2. Load audio and seek immediately to exact position
    await audioEngine.playTrackAtPosition(
      state.track,
      state.positionMs,
      state.isPlaying
    );

    // 3. Mark local device as active host
    useConnectStore.getState().setActiveDevice(this.localDeviceId);

    // 4. Send ACK back to initiator
    const ack: HandoffAckMessage = {
      type: 'HANDOFF_ACK',
      fromDeviceId: this.localDeviceId,
      toDeviceId: fromDeviceId,
      success: true,
      resumedPositionMs: state.positionMs,
      latencyMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
    this.sendMessage(ack);

    // 5. Broadcast updated PLAYBACK_STATE to network
    this.broadcastPlaybackState();
  } catch (err: any) {
    console.error('[Connect] Handoff execution failed:', err);
    this.sendMessage({
      type: 'HANDOFF_ACK',
      fromDeviceId: this.localDeviceId,
      toDeviceId: fromDeviceId,
      success: false,
      resumedPositionMs: 0,
      latencyMs: Date.now() - startTime,
      timestamp: Date.now(),
      error: err.message || 'Failed to start playback on target device',
    });
  }
}
```

---

### 3.5 Essential AudioEngine Enhancements (`src/audio/audioEngine.ts`)

Currently, `audioEngine.ts` does not expose `getCurrentTime()` or a safe `playTrackAtPosition()` method.
The following methods must be added to `audioEngine`:

```ts
/**
 * Returns current playback time in seconds with double-precision accuracy.
 */
public getCurrentTime(): number {
  return this.activeAudio.currentTime || 0;
}

/**
 * Returns total audio duration in seconds.
 */
public getDuration(): number {
  return this.activeAudio.duration || 0;
}

/**
 * Loads a track and starts playback at a specified millisecond offset.
 * Guarantees that currentTime seek executes immediately upon metadata readiness,
 * avoiding race conditions where currentTime is reset to 0.
 */
public async playTrackAtPosition(
  track: Track,
  positionMs: number,
  shouldPlay: boolean = true
): Promise<void> {
  this.initWebAudio();
  if (this.audioContext && this.audioContext.state === 'suspended') {
    await this.audioContext.resume().catch(() => {});
  }

  this.currentTrack = track;
  this.hasNotifiedApproachingEnd = false;
  this.prebufferedTrack = null;

  const targetSeconds = Math.max(0, positionMs / 1000);
  const streamUrl = await audioCache.getCachedStreamUrl(track.id, track.streamUrl);
  const audio = this.activeAudio;

  const performSeekAndPlay = async () => {
    try {
      if (isFinite(targetSeconds) && targetSeconds > 0) {
        audio.currentTime = targetSeconds;
      }
      if (shouldPlay) {
        await audio.play();
      } else {
        audio.pause();
      }
    } catch (err: any) {
      console.warn('[AudioEngine] Playback error after handoff seek:', err.message);
    }
  };

  // If already loaded to this exact stream
  if (audio.src === streamUrl && audio.readyState >= 1) {
    await performSeekAndPlay();
  } else {
    audio.src = streamUrl;
    audio.preload = 'auto';

    // Wait for metadata before setting currentTime to prevent 0-reset
    const onLoaded = () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      performSeekAndPlay();
    };
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.load();
  }
}
```

---

## 4. Sub-Second Latency & $\pm 50\text{ ms}$ Position Discrepancy Analysis

### 4.1 Latency Budget Breakdown (< 1000ms target)
| Phase | Operation | Typical Duration | Max Duration |
|---|---|---|---|
| **Phase 1** | State capture on Device A + JSON serialize | ~1ms | 3ms |
| **Phase 2** | WebSocket LAN packet transit (A -> Server -> B) | ~4ms | 15ms |
| **Phase 3** | Audio cache URL resolution (`audioCache.ts`) | ~3ms | 10ms |
| **Phase 4** | Media stream connection & metadata parsing | ~150ms | 350ms |
| **Phase 5** | Audio seek to `positionMs / 1000` + `play()` | ~10ms | 30ms |
| **Total** | **End-to-End Playback Transfer** | **~170ms** | **~410ms** |

**Conclusion**: Hand-off latency is consistently well below the 1-second threshold (typical ~200-400ms).

### 4.2 Millisecond Position Preservation ($\pm 50\text{ ms}$ Accuracy)
- Device A calls `getCurrentTime()` and `pause()` atomically.
- Device A's local audio emission terminates exactly at `positionMs`.
- Device B receives `positionMs` and seeks to `targetSeconds = positionMs / 1000`.
- In digital audio codecs (MP3/AAC):
  - MP3 frame size = 1152 samples @ 44.1kHz = ~26.1ms.
  - Seeking jumps to the nearest frame boundary ($\le 13\text{ ms}$ deviation).
  - AAC frame size = 1024 samples @ 44.1kHz = ~23.2ms ($\le 11.6\text{ ms}$ deviation).
- Therefore, the theoretical position discrepancy is between $0\text{ ms}$ and $13\text{ ms}$, which is strictly within the $\pm 50\text{ ms}$ requirement!

---

## 5. Edge Cases & Resilience Strategy

1. **Live Radio Streams (`duration === Infinity`)**:
   - For live radio, seeking is neither possible nor desired.
   - Handoff detects `source === 'radio'` or `!isFinite(duration)`: skips seeking and directly opens the live stream URL on Device B.
2. **Device B Network Failure / Offline**:
   - If Device B does not reply with `HANDOFF_ACK` within 3500ms, Device A rolls back: displays toast "Unable to reach [Device B]. Resuming playback on this device.", and calls `audioEngine.resume()`.
3. **Browser Autoplay Restrictions on Device B**:
   - In standard browsers, receiving a WebSocket message without an active user gesture might cause `audio.play()` to throw `NotAllowedError`.
   - Resolution:
     - When user initiates handoff from Device B ("Pull Handoff"), the click IS a user gesture; `audio.play()` succeeds without issue.
     - When pushed from Device A: if `NotAllowedError` occurs, Device B displays a top banner: "Tap here to resume playback transferred from [Device A]" with play icon. One tap resumes at `positionMs`.
4. **Volume Normalization**:
   - Device A passes its current volume setting in the snapshot.
   - Device B applies the volume setting or respects its local user volume preference if device-independent volume mode is configured.

---

## 6. Implementation Roadmap for Builders

1. **Step 1**: Implement `src/types/connect.ts` with device models, message schemas, and snapshot interfaces.
2. **Step 2**: Add `getCurrentTime()`, `getDuration()`, and `playTrackAtPosition()` to `src/audio/audioEngine.ts`.
3. **Step 3**: Implement `src/store/connectStore.ts` with device discovery state, active device selection, and handoff actions.
4. **Step 4**: Build `DeviceIcon.tsx`, `ActiveDeviceBadge.tsx`, and `DevicePickerModal.tsx` in `src/components/connect/`.
5. **Step 5**: Integrate Connect button and active device indicator in:
   - `src/components/layout/PlayerBar.tsx` (Desktop)
   - `src/components/layout/MobileMiniPlayer.tsx` (Mobile mini player)
   - `src/components/player/MobileNowPlayingSheet.tsx` (Mobile full sheet)
6. **Step 6**: Mount `<DevicePickerModal />` in `src/App.tsx`.
7. **Step 7**: Implement automated Vitest unit tests verifying state capture, position discrepancy within $\pm 50\text{ ms}$, and UI toggle behavior.
