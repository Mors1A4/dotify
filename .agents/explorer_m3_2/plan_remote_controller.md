# Spotify Connect Remote Controller Mode & State Integration Plan
**Milestone 3 Architecture & Technical Specification**
**Author:** explorer_m3_2 (teamwork_preview_explorer)
**Target Date:** 2026-09-19
**Scope:** Remote Controller Mode, Active Receiver State Broadcasts, Transport Interception, Server Clock Drift Compensation, `playerStore.ts` & `audioEngine.ts` Integration.

---

## 1. Executive Summary & Objective

In Spotify Connect, any device running the client (e.g. Android mobile phone, tablet, secondary browser tab) can seamlessly act as a remote control for an active playback device (e.g. Desktop workstation, home stereo, TV).

### Core Requirements
1. **Controller Mode (e.g. Phone controlling Desktop)**:
   - Local `audioEngine` must **NOT** stream or output audio (audio paused, pre-buffering cleared, volume muted).
   - `playerStore` reflects the remote active device's state: `currentTrack`, `currentTrackIndex`, `queue`, `isPlaying`, `progress`, `volume`, `repeatMode`, and `shuffle`.
   - User interactions on transport controls (Play, Pause, Toggle, Scrubber Seek, Next, Previous, Volume Slider, Queue Reorder, Add to Queue, Remove Track) in `PlayerBar`, `MobileMiniPlayer`, and `MobileNowPlayingSheet` send commands via `connectClient` to the remote playback device rather than executing locally on the client's `audioEngine`.
   - Continuous 60 FPS seekbar scrubbing on the controller without audio playback via an **Anchor-Based Progress Interpolator** with **Server Clock Drift & Network Transit Compensation**.
2. **Receiver / Active Playback Mode (e.g. Desktop controlled by Phone)**:
   - Local `audioEngine` actively renders audio and Web Audio DSP (Equalizer, Spectrum Visualizer).
   - Emits timestamped `PLAYBACK_STATE` broadcasts to connected controllers:
     - On discrete state transitions (track change, play/pause toggle, seek, queue mutation, volume adjustment).
     - Periodically every 1000ms–1500ms during continuous playback.
   - Executes incoming `REMOTE_COMMAND` messages directly on local store and `audioEngine`.

---

## 2. Codebase Investigation & Key Observations

### A. `src/store/playerStore.ts`
- **Current State Size**: 722 lines. Single global Zustand store `usePlayerStore`.
- **AudioEngine Coupling**:
  - Store imports `audioEngine` directly (`audioEngine.ts:455`).
  - Wire listeners:
    - Line 195: `audioEngine.onStateChange((isPlaying, isBuffering) => ...)`
    - Line 200: `audioEngine.onTimeUpdate(...)` (used for telemetry listening time accumulation)
    - Line 211: `audioEngine.onApproachingEnd(...)`
    - Line 215: `audioEngine.onTrackEnd(...)`
  - Direct execution:
    - Line 304: `audioEngine.playTrack(track)`
    - Line 330: `audioEngine.togglePlay()`
    - Line 405: `audioEngine.seekTo(seconds)`
    - Line 410: `audioEngine.setVolume(clamped)`
    - Line 549: `audioEngine.pause()`
    - Line 561: `audioEngine.prebufferNextTrack(null)`
- **Telemetry Coupling**:
  - Lines 128–148: `finalizeCurrentPlayRecord()` writes plays to `telemetryDb`.
  - *Observation*: If both Desktop (Active) and Mobile (Controller) record telemetry for the same song, listening metrics are double-counted. In Controller mode, local telemetry recording must be inhibited.
- **Queue Operations**:
  - `playNext`, `addToEnd`, `reorderQueue`, `removeFromQueue`, `clearQueue` mutate local queue and localStorage `queue`.
  - In Controller mode, these mutations must be communicated to the active device.

### B. `src/audio/audioEngine.ts`
- **Current State Size**: 456 lines. Singleton class `AudioEngine` wrapping dual `HTMLAudioElement`s, 10-band biquad filters, and AnalyserNode.
- **Time Updates**:
  - Lines 161–175: `timeupdate` event listener on HTMLAudioElement triggers `timeUpdateCallbacks(current, duration)`.
  - *Critical Observation*: When a device is in Controller mode and local audio is paused/stopped, `timeupdate` events are **never fired** by `HTMLAudioElement`.
  - *Current Component Subscriptions*:
    - `src/components/layout/PlayerBar.tsx:53`: `audioEngine.onTimeUpdate((current, duration) => ...)`
    - `src/components/layout/MobileMiniPlayer.tsx:20`: `audioEngine.onTimeUpdate((current, duration) => ...)`
    - `src/components/player/MobileNowPlayingSheet.tsx:50`: `audioEngine.onTimeUpdate((current, duration) => ...)`
    - If `audioEngine` simply silences without emitting synthetic time updates, seekbars across all three UI components will freeze at `0:00`.
- **Direct UI Method Invocations**:
  - `PlayerBar.tsx:100`: `audioEngine.seekTo(val)` is called directly rather than going through `playerStore.seekTo(val)`.
  - `MobileNowPlayingSheet.tsx:223`: `audioEngine.seekTo(val)` is called directly.
  - *Implication*: `audioEngine` must either be aware of Controller mode to delegate `seekTo`, OR the components/store must route through a unified transport method. Having `audioEngine` support a controller delegate pattern ensures 100% backwards compatibility and prevents broken seeks regardless of caller.

---

## 3. Architecture: Modes, Roles & Lifecycle Transitions

```
                    ┌─────────────────────────┐
                    │    'standalone' Mode    │
                    │ - Local Audio Engine    │
                    │ - Local Store Control   │
                    └───────────┬─────────────┘
                                │
             Pair as Controller │ Pair as Active Host / Receive Handoff
                                ▼
  ┌─────────────────────────────────┐     Handoff     ┌─────────────────────────────────┐
  │   'remote_controller' Mode      │────────────────>│      'active_host' Mode         │
  │ - Local AudioEngine Muted       │<────────────────│ - Local AudioEngine Active      │
  │ - Store Reflects Remote State   │    Switch Back  │ - Periodic State Broadcasts     │
  │ - Transport -> Remote Commands  │                 │ - Executes Incoming Commands    │
  │ - Progress Interpolator Active  │                 │ - Authoritative Telemetry Logger│
  └─────────────────────────────────┘                 └─────────────────────────────────┘
```

### Role State Definitions

```ts
export type ConnectMode = 'standalone' | 'active_host' | 'remote_controller';

export interface RemoteActiveDevice {
  deviceId: string;
  deviceName: string;
  deviceType: 'desktop' | 'mobile' | 'web' | 'tv' | 'cast';
}
```

---

## 4. Remote Controller Mode Detailed Design

### 4.1 Audio Engine Muting & Delegation
When transitioning to `'remote_controller'`:
1. `audioEngine.setControllerMode(true, (action, data) => connectClient.sendRemoteCommand(action, data))` is invoked.
2. `audioEngine.pause()` is executed immediately to stop any running audio.
3. Standby pre-buffering is cleared via `audioEngine.prebufferNextTrack(null)`.
4. Web Audio context can remain suspended to conserve battery on mobile devices.
5. If any component calls `audioEngine.seekTo(seconds)` or `audioEngine.setVolume(vol)` directly, `audioEngine` intercepts and forwards the command to the delegate instead of mutating local audio elements.

### 4.2 Transport Control Interception Matrix in `playerStore.ts`

| Action | Controller Mode Behavior | Active Host / Standalone Behavior |
|---|---|---|
| `playTrack(track, queue?, idx?)` | Sends `REMOTE_COMMAND: 'play_track'`, updates `currentTrack` optimistically | Loads track into `audioEngine`, starts playback |
| `togglePlay()` | Sends `REMOTE_COMMAND: 'toggle_play'`, flips `isPlaying` optimistically | Calls `audioEngine.togglePlay()` |
| `nextTrack()` | Sends `REMOTE_COMMAND: 'next'` | Advances queue locally, calls `audioEngine.playTrack()` |
| `previousTrack()` | Sends `REMOTE_COMMAND: 'previous'` | Navigates history/queue, calls `audioEngine.playTrack()` |
| `seekTo(seconds)` | Sends `REMOTE_COMMAND: 'seek'`, updates local interpolator anchor | Calls `audioEngine.seekTo(seconds)` |
| `setVolume(volume)` | Sends `REMOTE_COMMAND: 'set_volume'`, updates local `volume` state | Calls `audioEngine.setVolume(volume)`, stores to localStorage |
| `setRepeatMode(mode)` | Sends `REMOTE_COMMAND: 'set_repeat'`, updates local store | Updates local store |
| `toggleShuffle()` | Sends `REMOTE_COMMAND: 'set_shuffle'`, updates local store | Updates local store |
| `playNext(track)` | Sends `REMOTE_COMMAND: 'play_next'`, optimistically updates queue | Inserts track into local queue, prewarms cache |
| `addToEnd(track)` | Sends `REMOTE_COMMAND: 'add_to_end'`, optimistically updates queue | Appends track to local queue |
| `reorderQueue(from, to)` | Sends `REMOTE_COMMAND: 'reorder_queue'`, updates queue locally | Reorders local queue array |
| `removeFromQueue(idx)` | Sends `REMOTE_COMMAND: 'remove_from_queue'`, updates queue locally | Removes item from local queue |
| `clearQueue()` | Sends `REMOTE_COMMAND: 'clear_queue'`, updates queue locally | Clears upcoming tracks in local queue |

### 4.3 Lock-Screen & System MediaSession in Controller Mode
On mobile devices running in Controller mode, `navigator.mediaSession` remains active:
- Metadata is updated to reflect the remote active track:
  ```ts
  updateMediaSession(remoteState.currentTrack, {
    onPlay: () => get().togglePlay(),
    onPause: () => get().togglePlay(),
    onPrevious: () => get().previousTrack(),
    onNext: () => get().nextTrack(),
    onSeekTo: (time) => get().seekTo(time),
  });
  ```
- Result: User can pause or skip the desktop music directly from their Android lock-screen or smartwatch!

---

## 5. Server Clock Drift Compensation & Progress Interpolation

### 5.1 The Clock Drift & Latency Problem
1. **Network Transit Delay**: A WebSocket broadcast sent at host timestamp $T_{\text{host}}$ arrives at the controller after transit delay $\tau_{\text{transit}} \in [5\text{ms}, 100\text{ms}]$.
2. **Clock Discrepancy**: The controller's system clock (`Date.now()`) may differ from the host's clock by $\Delta t_{\text{clock}} = T_{\text{controller}} - T_{\text{host}}$.
3. **Heartbeat Interval**: State broadcasts only arrive every 1000–1500ms. Without interpolation, seekbar scrubbing freezes between packets.

### 5.2 The Clock Synchronization Algorithm (NTP-Lite)
During regular WebSocket heartbeats / ping-pongs between client and server:
- Let $t_0$ = client send timestamp (`Date.now()`).
- Let $t_{\text{server}}$ = server receive & echo timestamp.
- Let $t_1$ = client receive timestamp (`Date.now()`).
- Round Trip Time:
  $$RTT = t_1 - t_0$$
- Estimated One-Way Transit:
  $$\tau = \frac{RTT}{2}$$
- Estimated Clock Offset:
  $$\Delta t = t_{\text{server}} - (t_0 + \tau)$$
- Exponential Moving Average (EMA) smoothing over $N$ samples:
  $$\text{Offset}_{\text{smooth}} = 0.8 \times \text{Offset}_{\text{prev}} + 0.2 \times \Delta t$$

### 5.3 Anchor-Based Progress Interpolator (`RemoteProgressInterpolator`)
When a `PLAYBACK_STATE` payload arrives:
```ts
interface PlaybackStatePayload {
  currentTrack: Track | null;
  currentTrackIndex: number;
  queue: Track[];
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  repeatMode: 'off' | 'all' | 'one';
  shuffle: boolean;
  timestamp: number; // Host's Date.now() when position was sampled
}
```

1. **Calculate True Position on Arrival**:
   $$\text{hostTimeNow} \approx \text{Date.now()} + \text{Offset}_{\text{smooth}}$$
   $$\text{transitLatencyMs} = \max(0, \text{hostTimeNow} - \text{payload.timestamp})$$
   $$\text{trueCurrentPositionSec} = \frac{\text{payload.positionMs} + (\text{payload.isPlaying} ? \text{transitLatencyMs} : 0)}{1000}$$

2. **Discontinuity Detection & Reconciliation**:
   - Compare $\text{trueCurrentPositionSec}$ with current interpolated position $P_{\text{interpolated}}$.
   - Deviation $\delta = |\text{trueCurrentPositionSec} - P_{\text{interpolated}}|$.
   - If $\delta > 1.0\text{s}$ (user sought on host, track skipped, or playback started):
     - **Hard Snap**: Instantly reset anchor to $\text{trueCurrentPositionSec}$.
   - If $\delta \le 1.0\text{s}$ (normal clock jitter / network micro-burst):
     - **Soft Slew**: Gently nudge the anchor by $\delta \times 0.25$ over subsequent frames, eliminating visual stutter or jump backward.

3. **High-Frequency 20–60 FPS Ticker**:
   - Ticker runs at a 50ms interval (20 FPS) or `requestAnimationFrame` when tab is visible:
     $$\text{currentSec} = \text{anchorPositionSec} + (\text{isPlaying} ? \frac{\text{performance.now()} - \text{anchorPerfTime}}{1000} : 0)$$
   - Dispatches via:
     `audioEngine.emitSyntheticTimeUpdate(currentSec, durationSec)`
   - *Result*: Seekbars in `PlayerBar.tsx`, `MobileMiniPlayer.tsx`, and `MobileNowPlayingSheet.tsx` continue to update smoothly at 60 FPS without modifying their existing `audioEngine.onTimeUpdate` subscriptions!

---

## 6. Receiver (Active Playback) Mode Detailed Design

### 6.1 State Broadcast Architecture
When running in `'active_host'` mode (or standalone when connected controllers are paired):
1. **Event-Driven Broadcasts**:
   - Dispatched immediately whenever a discrete state change occurs:
     - `playTrack()`
     - `audioEngine.onStateChange` (play / pause / buffer)
     - `seekTo()`
     - `setVolume()`
     - `setQueue()` / `reorderQueue()` / `removeFromQueue()`
     - `setRepeatMode()` / `toggleShuffle()`
2. **Periodic Broadcasts**:
   - A timer runs every 1000ms while `isPlaying === true`:
     ```ts
     const broadcastPlaybackState = () => {
       const state = get();
       connectClient.broadcastPlaybackState({
         currentTrack: state.currentTrack,
         currentTrackIndex: state.currentTrackIndex,
         queue: state.queue,
         isPlaying: state.isPlaying,
         positionMs: Math.round(audioEngine.getCurrentTime() * 1000),
         durationMs: Math.round(audioEngine.getDuration() * 1000),
         volume: state.volume,
         repeatMode: state.repeatMode,
         shuffle: state.shuffle,
         timestamp: Date.now(),
       });
     };
     ```

### 6.2 Remote Command Dispatcher
When a controller sends `REMOTE_COMMAND`, the active receiver routes it through `executeRemoteCommand(action, data)`:
```ts
executeRemoteCommand: (action: RemoteCommandAction, data?: any) => {
  switch (action) {
    case 'play':
      if (!get().isPlaying) audioEngine.resume();
      break;
    case 'pause':
      if (get().isPlaying) audioEngine.pause();
      break;
    case 'toggle_play':
      audioEngine.togglePlay();
      break;
    case 'seek':
      if (typeof data?.seconds === 'number') {
        audioEngine.seekTo(data.seconds);
      } else if (typeof data?.positionMs === 'number') {
        audioEngine.seekTo(data.positionMs / 1000);
      }
      break;
    case 'next':
      get().nextTrack();
      break;
    case 'previous':
      get().previousTrack();
      break;
    case 'set_volume':
      if (typeof data?.volume === 'number') {
        get().setVolume(data.volume);
      }
      break;
    case 'play_track':
      if (data?.track) {
        get().playTrack(data.track, data.newQueue, data.trackIndex);
      }
      break;
    case 'play_next':
      if (data?.track) get().playNext(data.track);
      break;
    case 'add_to_end':
      if (data?.track) get().addToEnd(data.track);
      break;
    case 'set_queue':
      if (Array.isArray(data?.queue)) get().setQueue(data.queue);
      break;
    case 'reorder_queue':
      if (typeof data?.fromIndex === 'number' && typeof data?.toIndex === 'number') {
        get().reorderQueue(data.fromIndex, data.toIndex);
      }
      break;
    case 'remove_from_queue':
      if (typeof data?.index === 'number') {
        get().removeFromQueue(data.index);
      }
      break;
    case 'clear_queue':
      get().clearQueue();
      break;
    case 'set_repeat':
      if (data?.mode) get().setRepeatMode(data.mode);
      break;
    case 'set_shuffle':
      if (typeof data?.shuffle === 'boolean') {
        set({ shuffle: data.shuffle });
      }
      break;
  }
}
```

---

## 7. Concrete Code Modifications Specification

### 7.1 Modifications to `src/audio/audioEngine.ts`

Additions to `AudioEngine`:
```ts
// --- Add to AudioEngine class properties ---
private isControllerMode: boolean = false;
private remoteCommandDelegate: ((action: string, data?: any) => void) | null = null;

// --- Add to AudioEngine public methods ---

public setControllerMode(
  enabled: boolean,
  commandDelegate?: (action: string, data?: any) => void
): void {
  this.isControllerMode = enabled;
  this.remoteCommandDelegate = commandDelegate || null;

  if (enabled) {
    this.pause();
    this.prebufferNextTrack(null);
  }
}

public getIsControllerMode(): boolean {
  return this.isControllerMode;
}

public getCurrentTime(): number {
  return this.activeAudio.currentTime || 0;
}

public getDuration(): number {
  return this.activeAudio.duration || 0;
}

public emitSyntheticTimeUpdate(currentTime: number, duration: number): void {
  for (const cb of this.timeUpdateCallbacks) {
    cb(currentTime, duration);
  }
}
```

Modifications to existing methods in `AudioEngine`:
- `seekTo(seconds: number)`:
  ```ts
  public seekTo(seconds: number): void {
    if (this.isControllerMode) {
      this.remoteCommandDelegate?.('seek', { seconds, positionMs: seconds * 1000 });
      return;
    }
    const audio = this.activeAudio;
    if (isFinite(seconds) && audio.duration) {
      audio.currentTime = Math.max(0, Math.min(seconds, audio.duration));
    }
  }
  ```
- `setVolume(volume: number)`:
  ```ts
  public setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.currentVolume = clamped;
    if (this.isControllerMode) {
      this.remoteCommandDelegate?.('set_volume', { volume: clamped });
      return;
    }
    // Existing Web Audio DSP gain adjustment...
  }
  ```
- `togglePlay()`:
  ```ts
  public togglePlay(): void {
    if (this.isControllerMode) {
      this.remoteCommandDelegate?.('toggle_play');
      return;
    }
    // Existing play/pause toggle...
  }
  ```

---

### 7.2 Modifications to `src/store/playerStore.ts`

#### A. New Interfaces & State
```ts
export type ConnectMode = 'standalone' | 'active_host' | 'remote_controller';

export interface RemoteActiveDevice {
  deviceId: string;
  deviceName: string;
  deviceType: 'desktop' | 'mobile' | 'web' | 'tv' | 'cast';
}

export interface RemotePlaybackStatePayload {
  currentTrack: Track | null;
  currentTrackIndex: number;
  queue: Track[];
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  repeatMode: 'off' | 'all' | 'one';
  shuffle: boolean;
  timestamp: number;
}
```

#### B. State Fields in `PlayerStoreState`
```ts
// Remote Connect State
connectMode: ConnectMode;
activeRemoteDevice: RemoteActiveDevice | null;

// Connect Actions
setConnectMode: (mode: ConnectMode, remoteDevice?: RemoteActiveDevice | null) => void;
applyRemotePlaybackState: (state: RemotePlaybackStatePayload) => void;
executeRemoteCommand: (action: RemoteCommandAction, data?: any) => void;
```

#### C. Action Wrappers (Controller Interception Pattern)
In `usePlayerStore`:
```ts
setConnectMode: (mode, remoteDevice = null) => {
  const prevMode = get().connectMode;
  set({ connectMode: mode, activeRemoteDevice: remoteDevice });

  if (mode === 'remote_controller') {
    // Mute and delegate local audioEngine
    audioEngine.setControllerMode(true, (action, data) => {
      connectClient.sendRemoteCommand(action as any, data);
    });
    // Start progress interpolator
    remoteProgressInterpolator.start();
  } else {
    // Return to active or standalone
    audioEngine.setControllerMode(false);
    remoteProgressInterpolator.stop();
  }
},

applyRemotePlaybackState: (remoteState) => {
  if (get().connectMode !== 'remote_controller') return;

  set({
    currentTrack: remoteState.currentTrack,
    currentTrackIndex: remoteState.currentTrackIndex,
    queue: remoteState.queue,
    isPlaying: remoteState.isPlaying,
    volume: remoteState.volume,
    repeatMode: remoteState.repeatMode,
    shuffle: remoteState.shuffle,
  });

  // Feed clock drift compensator & progress interpolator
  remoteProgressInterpolator.sync({
    positionMs: remoteState.positionMs,
    durationMs: remoteState.durationMs,
    isPlaying: remoteState.isPlaying,
    remoteTimestamp: remoteState.timestamp,
  });

  // Update mobile media session
  if (remoteState.currentTrack) {
    updateMediaSession(remoteState.currentTrack, {
      onPlay: () => get().togglePlay(),
      onPause: () => get().togglePlay(),
      onPrevious: () => get().previousTrack(),
      onNext: () => get().nextTrack(),
      onSeekTo: (time) => get().seekTo(time),
    });
  }
},
```

#### D. Telemetry Guard
In `finalizeCurrentPlayRecord`:
```ts
const finalizeCurrentPlayRecord = async () => {
  // Suppress telemetry logging if in remote controller mode to prevent duplicate records
  if (get().connectMode === 'remote_controller') {
    activePlayRecord = null;
    return;
  }
  // Existing telemetryDb.recordPlay logic...
};
```

---

### 7.3 Progress Interpolator Module (`src/services/remoteProgress.ts`)

```ts
import { audioEngine } from '../audio/audioEngine';

export class RemoteProgressInterpolator {
  private anchorPositionSec: number = 0;
  private durationSec: number = 0;
  private anchorLocalPerfTime: number = 0;
  private isPlaying: boolean = false;
  private intervalId: any = null;
  private clockOffsetMs: number = 0;

  public setClockOffset(offsetMs: number) {
    this.clockOffsetMs = offsetMs;
  }

  public sync(params: {
    positionMs: number;
    durationMs: number;
    isPlaying: boolean;
    remoteTimestamp: number;
  }) {
    const nowLocal = Date.now();
    const estimatedRemoteNow = nowLocal + this.clockOffsetMs;
    const transitMs = Math.max(0, estimatedRemoteNow - params.remoteTimestamp);

    const adjustedPositionMs = params.isPlaying
      ? params.positionMs + transitMs
      : params.positionMs;

    const newPositionSec = adjustedPositionMs / 1000;
    const newDurationSec = params.durationMs > 0 ? params.durationMs / 1000 : 0;

    const currentEst = this.getCurrentPosition();
    const diff = Math.abs(newPositionSec - currentEst);

    this.isPlaying = params.isPlaying;
    this.durationSec = newDurationSec;

    if (diff > 1.0 || !this.isPlaying) {
      // Hard snap for seek or track skip
      this.anchorPositionSec = Math.max(0, newPositionSec);
      this.anchorLocalPerfTime = performance.now();
    } else {
      // Gentle slew for smooth clock drift compensation
      this.anchorPositionSec = currentEst + (newPositionSec - currentEst) * 0.3;
      this.anchorLocalPerfTime = performance.now();
    }

    this.tick();
    this.ensureLoop();
  }

  public seek(seconds: number) {
    this.anchorPositionSec = Math.max(0, seconds);
    this.anchorLocalPerfTime = performance.now();
    this.tick();
  }

  public getCurrentPosition(): number {
    if (!this.isPlaying) return this.anchorPositionSec;
    const elapsedSec = (performance.now() - this.anchorLocalPerfTime) / 1000;
    const pos = this.anchorPositionSec + elapsedSec;
    if (this.durationSec > 0) {
      return Math.min(pos, this.durationSec);
    }
    return pos;
  }

  private tick() {
    const cur = this.getCurrentPosition();
    audioEngine.emitSyntheticTimeUpdate(cur, this.durationSec);
  }

  public start() {
    this.ensureLoop();
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isPlaying = false;
  }

  private ensureLoop() {
    if (this.intervalId || !this.isPlaying) return;
    this.intervalId = setInterval(() => {
      this.tick();
    }, 50); // 20 FPS seekbar refresh
  }
}

export const remoteProgressInterpolator = new RemoteProgressInterpolator();
```

---

## 8. Verification Strategy & Test Plan

### Test Scenarios

1. **Controller Mode Audio Silence**:
   - Set `connectMode = 'remote_controller'`.
   - Call `playTrack(track)`.
   - Verify `audioEngine.isPlaying()` remains `false`.
   - Verify `connectClient.sendRemoteCommand` was invoked with `'play_track'` and track payload.

2. **Transport Control Forwarding**:
   - In Controller mode:
     - `togglePlay()` -> sends `'toggle_play'` command.
     - `seekTo(35)` -> sends `'seek'` command with `{ seconds: 35, positionMs: 35000 }`.
     - `nextTrack()` -> sends `'next'` command.
     - `previousTrack()` -> sends `'previous'` command.
     - `setVolume(0.5)` -> sends `'set_volume'` command with `{ volume: 0.5 }`.
     - `reorderQueue(0, 2)` -> sends `'reorder_queue'` command.

3. **Active Receiver Command Execution**:
   - In Active Host mode:
     - Receive `'toggle_play'` -> calls `audioEngine.togglePlay()`.
     - Receive `'seek'` with `seconds: 40` -> calls `audioEngine.seekTo(40)`.
     - Receive `'set_volume'` with `volume: 0.3` -> calls `playerStore.setVolume(0.3)`.

4. **Progress Interpolator & Clock Drift Smoothing**:
   - Simulate a `PLAYBACK_STATE` with `positionMs: 10000`, `timestamp: Date.now() - 50`.
   - Advance virtual timers by 200ms.
   - Verify synthetic time update emits $\approx 10.25\text{s}$.
   - Simulate a sudden seek to `positionMs: 50000`.
   - Verify synthetic time update snaps immediately to $50.0\text{s}$ without lag.

5. **Telemetry De-duplication**:
   - In Controller mode, trigger track transitions.
   - Verify `telemetryDb.recordPlay` is **not** called on the controller device.

---

## 9. Conclusion

This architecture cleanly separates concerns:
- `audioEngine` retains its role as the low-level audio rendering engine while exposing a lightweight controller delegation hook and synthetic time update emitter.
- `playerStore` serves as the single source of truth for UI state, seamlessly proxying actions over `connectClient` when in Controller mode.
- `remoteProgressInterpolator` handles the physics of network latency and clock drift, giving the user a buttery-smooth 60 FPS scrubber experience on their remote device.
