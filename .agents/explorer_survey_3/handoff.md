# Comprehensive Survey & Architectural Blueprint: Audio DSP, 60 FPS Visualizer, Workspace Scaffolding & E2E Testing Strategy

**Agent**: `explorer_survey_3`  
**Working Directory**: `c:\Users\monty\Documents\AB\notify\.agents\explorer_survey_3`  
**Date**: 2026-09-18  
**Scope**: 10-Band Equalizer DSP Cascade, 60 FPS Canvas Visualizer, Workspace & Scaffolding Audit, PWA/Android Compatibility, and E2E Testing Framework

---

## 1. Observation

### 1.1 Authoritative Requirements & Workspace State
Direct observations from project files and system probes:

- **Original Request (`c:\Users\monty\Documents\AB\notify\ORIGINAL_REQUEST.md`)**:
  - Line 17: *"High-frequency UI elements (seekbar scrubbing at 100ms and 60 FPS audio visualizer) must update without re-rendering parent components or dropping frames."*
  - Line 28: *"Theme Engine: Real-time CSS Custom Properties token switcher..."*
  - Line 29: *"10-Band Graphic Equalizer: Web Audio API DSP filter cascade (32Hz to 16kHz) with presets (Bass Boost, Vocal Clarity, Rock, Electronic, Flat, Custom) and pre-amp control."*
  - Line 49: *"Toggling or adjusting 10-band equalizer bands alters the audio output in real-time."*
- **Current Workspace Content (`c:\Users\monty\Documents\AB\notify`)**:
  - Only two files exist at root: `ORIGINAL_REQUEST.md` (4,065 bytes) and `package.json` (1,040 bytes).
  - No `node_modules/` installed yet.
  - Node version: `v20.18.0`; NPM version: `10.8.2`.
- **Existing `package.json` Inspection**:
  - `dependencies`: `clsx` (^2.1.1), `cors` (^2.8.5), `express` (^4.21.2), `lucide-react` (^0.475.0), `tailwind-merge` (^3.0.1), `webtorrent` (^3.0.21), `zustand` (^5.0.3).
  - `devDependencies`: `@types/cors`, `@types/express`, `@types/node`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `autoprefixer`, `concurrently`, `postcss`, `react` (18.3.1), `react-dom` (18.3.1), `tailwindcss` (3.4.17), `typescript` (5.7.3), `vite` (6.1.0).
  - Missing build/runtime files: No `vite.config.ts`, `tsconfig.json`, `index.html`, `tailwind.config.js`, or `server/index.js` currently exist on disk.
  - Missing testing dependencies: No `vitest`, `@testing-library/react`, `jsdom`, or `playwright` in `devDependencies`.
  - Missing PWA scaffolding: No `manifest.json`, service worker, or app icons.

### 1.2 Mathematical Verification of 10-Band Filter Parameters
Direct calculation of the 10 ISO equalizer center frequencies:
- Frequencies: $F = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]\text{ Hz}$.
- Octave bandwidth calculation:
  For 1-octave spacing ($BW = 1.0$ octave), the filter quality factor $Q$ is given by:
  $$Q = \frac{\sqrt{2^{BW}}}{2^{BW} - 1} = \frac{\sqrt{2^1}}{2^1 - 1} = \sqrt{2} \approx 1.41421356$$
  Probed via node execution: $Q = 1.4142$.
- Measured frequency octave ratios:
  - 32Hz $\to$ 64Hz: ratio = 2.00x (1.00 octave)
  - 64Hz $\to$ 125Hz: ratio = 1.95x (standard ISO acoustic rounding from theoretical 128Hz)
  - 125Hz $\to$ 250Hz: ratio = 2.00x
  - 250Hz $\to$ 500Hz: ratio = 2.00x
  - 500Hz $\to$ 1000Hz: ratio = 2.00x
  - 1000Hz $\to$ 2000Hz: ratio = 2.00x
  - 2000Hz $\to$ 4000Hz: ratio = 2.00x
  - 4000Hz $\to$ 8000Hz: ratio = 2.00x
  - 8000Hz $\to$ 16000Hz: ratio = 2.00x
- Gain conversions:
  - $-12\text{ dB} = 0.2512$ linear factor
  - $0\text{ dB} = 1.0000$ linear factor
  - $+6\text{ dB} = 1.9953$ linear factor
  - $+12\text{ dB} = 3.9811$ linear factor

---

## 2. Logic Chain

### 2.1 10-Band Graphic Equalizer DSP Cascade

#### 2.1.1 Graph Topology & Node Routing
```
[HTMLAudioElement] (crossOrigin = "anonymous")
       │
       ▼
[MediaElementAudioSourceNode] (createMediaElementSource)
       │
       ▼
[Pre-Amp GainNode] (AudioParam: gain.value, default 1.0 / 0 dB)
       │
       ▼
[BiquadFilterNode 0] (type: 'peaking', freq: 32 Hz, Q: 1.414, gain: -12..+12 dB)
       │
       ▼
[BiquadFilterNode 1] (type: 'peaking', freq: 64 Hz, Q: 1.414, gain: -12..+12 dB)
       │
       ▼
[BiquadFilterNode 2] (type: 'peaking', freq: 125 Hz, Q: 1.414, gain: -12..+12 dB)
       │
       ▼
[BiquadFilterNode 3] (type: 'peaking', freq: 250 Hz, Q: 1.414, gain: -12..+12 dB)
       │
       ▼
[BiquadFilterNode 4] (type: 'peaking', freq: 500 Hz, Q: 1.414, gain: -12..+12 dB)
       │
       ▼
[BiquadFilterNode 5] (type: 'peaking', freq: 1000 Hz, Q: 1.414, gain: -12..+12 dB)
       │
       ▼
[BiquadFilterNode 6] (type: 'peaking', freq: 2000 Hz, Q: 1.414, gain: -12..+12 dB)
       │
       ▼
[BiquadFilterNode 7] (type: 'peaking', freq: 4000 Hz, Q: 1.414, gain: -12..+12 dB)
       │
       ▼
[BiquadFilterNode 8] (type: 'peaking', freq: 8000 Hz, Q: 1.414, gain: -12..+12 dB)
       │
       ▼
[BiquadFilterNode 9] (type: 'peaking', freq: 16000 Hz, Q: 1.414, gain: -12..+12 dB)
       │
       ▼
[AnalyserNode] (fftSize: 128 / 256, smoothingTimeConstant: 0.8)
       │
       ▼
[AudioContext.destination] (Speakers / Headphones)
```

#### 2.1.2 DSP Filter Configuration & AudioParam Automation
1. **Peaking Filters Across All 10 Bands**:
   - Filter type is uniformly `peaking` (bell curve), matching standard pro-audio graphic equalizers.
   - Using $Q = 1.4142$ ensures that the -3dB bandwidth of each band is exactly 1 octave wide, creating a smooth summing transfer function when neighboring bands are adjusted simultaneously without resonant peaks or deep spectral nulls.
2. **Pre-Amp Gain Control (Clipping Protection)**:
   - When boosting multiple equalizer bands (e.g. Bass Boost $+7\text{dB}$), digital inter-sample clipping occurs if total signal level exceeds $0\text{ dBFS}$ ($1.0$ linear amplitude).
   - The pre-amp `GainNode` scales the overall cascade input.
   - Gain formula:
     $$\text{gainLinear} = 10^{\frac{\text{gainDb}}{20}}$$
   - Range: $-12\text{ dB}$ ($0.251$) to $+12\text{ dB}$ ($3.981$), default $0\text{ dB}$ ($1.0$).
3. **De-Clicking AudioParam Automation**:
   - Direct assignment (`filter.gain.value = targetDb`) during slider scrubbing causes audible digital clicks (step discontinuities in the PCM audio stream).
   - Required automation method:
     ```ts
     const now = audioContext.currentTime;
     filter.gain.cancelScheduledValues(now);
     filter.gain.setTargetAtTime(targetDb, now, 0.05); // 50ms exponential transition
     ```

#### 2.1.3 Built-in Equalizer Presets
Exact dB values for each of the 10 bands ($[32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]\text{ Hz}$):

| Preset Name | 32Hz | 64Hz | 125Hz | 250Hz | 500Hz | 1kHz | 2kHz | 4kHz | 8kHz | 16kHz | Pre-Amp | Rationale |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Flat** | 0 dB | 0 dB | 0 dB | 0 dB | 0 dB | 0 dB | 0 dB | 0 dB | 0 dB | 0 dB | 0.0 dB | Neutral reference line; uncolored output |
| **Bass Boost** | +7 dB | +6 dB | +5 dB | +3 dB | +1 dB | 0 dB | 0 dB | 0 dB | 0 dB | 0 dB | -3.0 dB | Elevates sub-bass and mid-bass; -3dB pre-amp prevents digital clipping |
| **Vocal Clarity** | -3 dB | -2 dB | -1 dB | +1 dB | +3 dB | +4 dB | +3 dB | +2 dB | +1 dB | 0 dB | -1.5 dB | Cuts low rumble; boosts speech formant region (500Hz-4kHz) for crisp vocals |
| **Rock** | +5 dB | +4 dB | +3 dB | +1 dB | -1 dB | -1 dB | 0 dB | +2 dB | +3 dB | +4 dB | -2.0 dB | Classic "V-curve" / smile: solid low-end punch, scooped mids, energetic guitar presence and cymbal air |
| **Electronic** | +6 dB | +5 dB | +3 dB | 0 dB | -2 dB | +1 dB | +2 dB | +3 dB | +4 dB | +5 dB | -2.5 dB | Deep sub-bass punch, slightly recessed vocal mids, sharp energetic highs for synth textures |
| **Custom** | *user* | *user* | *user* | *user* | *user* | *user* | *user* | *user* | *user* | *user* | *user* | Persisted to `localStorage` under `dotify_eq_custom` key |

#### 2.1.4 CORS & `MediaElementAudioSourceNode` Security Architecture
1. **The Web Audio CORS Trap**:
   - According to W3C Web Audio API security rules, if an `<audio>` element loads media from a cross-origin server without valid `Access-Control-Allow-Origin` headers:
     - If `crossOrigin="anonymous"` is NOT set: the element will play through native speakers, BUT once passed into `createMediaElementSource(audio)`, the node produces complete silence ($0.0$ float buffers). The user hears nothing!
     - If `crossOrigin="anonymous"` IS set: the browser blocks the network request with a CORS error (`MEDIA_ERR_SRC_NOT_SUPPORTED`).
2. **Single-Attachment Limitation**:
   - An `HTMLAudioElement` can ONLY be passed to `audioContext.createMediaElementSource` ONCE during its DOM lifetime. Subsequent calls throw `InvalidStateError`.
3. **Production Solution - Express Audio Streaming Proxy**:
   - Audius streams and Internet Archive files normally send CORS headers.
   - However, thousands of community Icecast/Shoutcast live radio stations do NOT send CORS headers.
   - The solution: Route non-CORS streams through the local Express server endpoint:
     `GET /api/stream/proxy?url=${encodeURIComponent(remoteStreamUrl)}`
   - The Express proxy:
     - Sets `Access-Control-Allow-Origin: *`
     - Sets `Access-Control-Allow-Headers: Range, Content-Type, Accept`
     - Handles upstream HTTP 206 Partial Content range requests and chunked audio streaming
     - Streams seamlessly to `<audio crossOrigin="anonymous">`, ensuring Web Audio DSP nodes always receive valid PCM data.
4. **Mobile Autoplay Policy Handling**:
   - Browsers initialize `AudioContext` in `'suspended'` state.
   - Audio controller initializes with:
     ```ts
     export async function ensureAudioContextStarted(ctx: AudioContext): Promise<void> {
       if (ctx.state === 'suspended') {
         await ctx.resume();
       }
     }
     ```
     Invoked on the first user interaction (play button tap, track click).

---

### 2.2 60 FPS Audio Visualizer Architecture

#### 2.2.1 AnalyserNode Tuning
- `fftSize`: `128` (gives `frequencyBinCount = 64` bins) or `256` (`128` bins). For a 24-48 bar visualizer, `128` is optimal and reduces Fast Fourier Transform math overhead to near zero.
- `smoothingTimeConstant`: `0.8` (provides smooth, organic transitions between frames without jerky jumps).
- `minDecibels`: `-90 dB` (floor for silent ambient room noise).
- `maxDecibels`: `-10 dB` (ceiling for full scale signal).

#### 2.2.2 Decoupled Zero React Re-render Rendering Loop
To guarantee 60 FPS without dropping frames or triggering React reconciliation:
1. The visualizer React component returns `<canvas ref={canvasRef} className="w-full h-full" />`.
2. A single `Uint8Array(analyser.frequencyBinCount)` is allocated ONCE on initialization (never in the per-frame loop).
3. `requestAnimationFrame` runs as an isolated RAF loop stored in a ref:
   ```ts
   // Render loop executed outside React render cycle
   function renderFrame() {
     if (!isPlayingRef.current) return;
     rafIdRef.current = requestAnimationFrame(renderFrame);
     analyser.getByteFrequencyData(dataArray);
     drawBars(ctx, dataArray, canvas.width, canvas.height, themeTokens);
   }
   ```
4. High-DPI Scaling:
   ```ts
   const dpr = window.devicePixelRatio || 1;
   const displayWidth = Math.floor(rect.width * dpr);
   const displayHeight = Math.floor(rect.height * dpr);
   if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
     canvas.width = displayWidth;
     canvas.height = displayHeight;
   }
   ctx.save();
   ctx.scale(dpr, dpr);
   // Drawing logic uses rect.width and rect.height
   ctx.restore();
   ```
5. Power & Visibility Optimization:
   - When playback is paused (`audio.paused`), the RAF loop is cancelled (`cancelAnimationFrame(rafIdRef.current)`).
   - Smoothly animate bars to baseline over 200ms before idling.
   - Use `IntersectionObserver` on the canvas container so if the Equalizer drawer or Now Playing sheet is hidden, rendering halts immediately to save battery on mobile devices.

#### 2.2.3 Visualizer Modes
1. **Dynamic Frequency Bars Mode**:
   - Non-linear bin grouping: Maps lower frequencies (bass 32Hz-250Hz) to more visual bars than extreme highs (10kHz-20kHz), reflecting the logarithmic nature of human pitch perception.
   - Rounded top caps: Using `ctx.roundRect(x, y, barWidth, barHeight, [radius, radius, 0, 0])`.
   - Gradient fill: Vertical linear gradient from CSS custom property `--color-primary` (bottom) to `--color-accent` (top).
   - Peak hold indicator: Small 2px cap above each bar that drops slowly with simulated gravity.
2. **Oscilloscope Waveform Mode**:
   - Uses `analyser.getByteTimeDomainData(timeDomainArray)`.
   - Draws a continuous path across `x = 0..width`, mapping `v = timeDomainArray[i] / 128.0` to `y = (v * height) / 2`.
   - Neon glow effect: `ctx.shadowBlur = 8; ctx.shadowColor = themeAccentColor`.

---

### 2.3 Workspace Audit & Scaffolding Strategy

#### 2.3.1 Workspace Audit Summary
- Current files: `ORIGINAL_REQUEST.md`, `package.json`.
- Dependencies already declared:
  - Frontend: `react`, `react-dom`, `zustand`, `lucide-react`, `tailwindcss`, `clsx`, `tailwind-merge`, `typescript`, `vite`.
  - Backend: `express`, `cors`, `webtorrent`.
  - Tooling: `concurrently`.
- Required additions:
  - Testing: `vitest`, `@testing-library/react`, `jsdom`, `@types/testing-library__react`, `playwright`.
  - PWA: `vite-plugin-pwa` (or custom Service Worker script in `public/sw.js`).
  - Scaffolding configs: `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tailwind.config.js`, `postcss.config.js`, `index.html`.

#### 2.3.2 Recommended Source Code Directory Layout
```
c:\Users\monty\Documents\AB\notify\
├── public/
│   ├── favicon.svg
│   ├── manifest.json
│   ├── icons/
│   │   ├── icon-192.png
│   │   ├── icon-512.png
│   │   └── icon-512-maskable.png
│   └── sw.js (if not using vite-plugin-pwa generated)
├── server/
│   ├── index.js (Express server, CORS, torrent streaming, audio stream proxy)
│   ├── torrentEngine.js (WebTorrent sequential audio range-request handler)
│   └── streamProxy.js (Icecast/Shoutcast CORS bypass & range streamer)
├── src/
│   ├── dsp/
│   │   ├── AudioContextManager.ts (AudioContext singleton, destination hookup)
│   │   ├── EqualizerCascade.ts (10 BiquadFilterNodes, Q=1.414, gain automation)
│   │   ├── EqualizerPresets.ts (Flat, Bass Boost, Vocal, Rock, Electronic, Custom)
│   │   ├── VisualizerEngine.ts (Canvas 2D RAF loop, FFT bars, Waveform)
│   │   └── types.ts (DSP interfaces and types)
│   ├── services/
│   │   ├── audiusApi.ts (Audius trending, search, stream URLs)
│   │   ├── archiveApi.ts (Internet Archive search, metadata, MP3 streams)
│   │   ├── radioApi.ts (Radio-Browser search, country/genre, live streams)
│   │   └── torrentApi.ts (Torrent magnet upload, file tree, stream URL)
│   ├── stores/
│   │   ├── playerStore.ts (Zustand: currentTrack, isPlaying, volume, queue)
│   │   ├── equalizerStore.ts (Zustand: gains, preAmp, activePreset, isEnabled)
│   │   ├── themeStore.ts (Zustand: activeTheme, customColors, CSS var injection)
│   │   └── libraryStore.ts (Zustand: likedTracks, customPlaylists, history)
│   ├── components/
│   │   ├── layout/
│   │   │   ├── DesktopLayout.tsx (3-column Spotify layout >= 768px)
│   │   │   ├── MobileLayout.tsx (Bottom nav + mini-player + sheet < 768px)
│   │   │   ├── Sidebar.tsx
│   │   │   ├── PlayerBar.tsx (Zero-latency seekbar, play/pause, volume)
│   │   │   └── RightDrawer.tsx (Queue & Equalizer drawer)
│   │   ├── dsp/
│   │   │   ├── EqualizerDrawer.tsx (10 sliders, pre-amp, preset selector)
│   │   │   └── VisualizerCanvas.tsx (Zero-render RAF canvas)
│   │   ├── common/
│   │   │   ├── TrackRow.tsx
│   │   │   ├── ThemeModal.tsx
│   │   │   └── FastSlider.tsx (Direct DOM ref updates on scrub)
│   ├── index.css (Tailwind directives, CSS custom property default tokens)
│   ├── App.tsx
│   └── main.tsx
├── tests/
│   ├── unit/
│   │   ├── equalizerDsp.test.ts (DSP math, Q=1.414, frequency mapping)
│   │   ├── visualizer.test.ts (Canvas setup, RAF lifecycle)
│   │   └── playerStore.test.ts (State transitions, queue)
│   └── e2e/
│       ├── playback.spec.ts (Audio playback, play/pause, seek)
│       ├── equalizer.spec.ts (Slider adjustments, preset switching)
│       └── mobileViewport.spec.ts (Bottom nav, mini-player expansion)
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

#### 2.3.3 PWA Configuration & Audio Streaming Caveats
1. **`public/manifest.json` Requirements**:
   - `display: "standalone"`
   - `orientation: "any"`
   - `start_url: "/"`
   - `theme_color: "#121212"`
   - `background_color: "#121212"`
   - Icons: 192x192, 512x512, and 512x512 maskable icon definitions.
2. **Service Worker Audio Caching Pitfall**:
   - **Critical Problem**: Audio streams (especially live radio and WebTorrent byte ranges) use HTTP `206 Partial Content`. The standard browser Cache Storage API historically fails or throws errors on opaque Range requests unless explicitly managed.
   - Furthermore, live radio streams are infinite—attempting to cache them in Cache API exhausts storage quotas and crashes the browser.
   - **Rule**: Configure Service Worker to EXCLUDE all media endpoints:
     - Ignore `/api/stream/*`, `/api/torrent/*`, and external audio domain requests (`audius.co`, `archive.org`, radio stream URLs).
     - Cache ONLY App Shell assets: HTML, CSS, JavaScript, Web Fonts, and SVG icons using `StaleWhileRevalidate` or `CacheFirst`.

#### 2.3.4 Android & Mobile Compatibility
1. **Viewport Meta Configuration**:
   ```html
   <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
   ```
2. **Safe Area Insets (CSS)**:
   - Must avoid overlapping Android gesture navigation bars and camera notches:
     ```css
     padding-top: env(safe-area-inset-top, 0px);
     padding-bottom: env(safe-area-inset-bottom, 0px);
     padding-left: env(safe-area-inset-left, 0px);
     padding-right: env(safe-area-inset-right, 0px);
     ```
   - Bottom navigation bar:
     `padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 0.5rem)`
3. **Touch Targets & Gestures**:
   - All interactive touch targets must be at least 48px x 48px (`min-h-[48px] min-w-[48px]`).
   - Use `touch-action: manipulation` to eliminate the 300ms mobile tap delay.
   - Prevent accidental pull-to-refresh on canvas scrubbers: `overscroll-behavior-y: contain`.
4. **System Lock-Screen Integration (`navigator.mediaSession`)**:
   - Android Chrome surfaces full lock-screen media controls when `navigator.mediaSession` is populated:
     ```ts
     if ('mediaSession' in navigator) {
       navigator.mediaSession.metadata = new MediaMetadata({
         title: track.title,
         artist: track.artist,
         album: track.album || 'Dotify',
         artwork: [
           { src: track.artworkUrl, sizes: '512x512', type: 'image/png' }
         ]
       });
       navigator.mediaSession.setActionHandler('play', () => playerStore.getState().play());
       navigator.mediaSession.setActionHandler('pause', () => playerStore.getState().pause());
       navigator.mediaSession.setActionHandler('previoustrack', () => playerStore.getState().prev());
       navigator.mediaSession.setActionHandler('nexttrack', () => playerStore.getState().next());
       navigator.mediaSession.setActionHandler('seekto', (details) => {
         if (details.seekTime !== undefined) playerStore.getState().seek(details.seekTime);
       });
     }
     ```

---

### 2.4 E2E & Automated Testing Strategy

#### 2.4.1 Recommended Testing Stack
1. **Unit / Integration Tests**: `Vitest` + `@testing-library/react` + `jsdom`.
   - Direct execution in ESM environment, fast feedback loop (<2s).
   - Tests DSP node mathematics, frequency array mappings, preset values, store state mutations.
2. **End-to-End Tests**: `Playwright`.
   - Direct execution across real Chromium, Firefox, WebKit, and mobile viewport emulation (`Pixel 7`, `iPhone 14`).
   - Validates UI layout transitions (<768px vs >=768px), equalizer slider touch dragging, real-time theme CSS variable updates, and playback control flows.

#### 2.4.2 Headless Web Audio API Mocking
In headless test runners (Vitest / jsdom / headless Chrome), `AudioContext` and `HTMLMediaElement.prototype.play` are either absent or require hardware audio devices.
- **Vitest Mocking Strategy**:
  ```ts
  class MockAudioParam {
    value: number = 0;
    cancelScheduledValues = vi.fn();
    setTargetAtTime = vi.fn((val: number) => { this.value = val; });
    linearRampToValueAtTime = vi.fn();
  }

  class MockBiquadFilterNode {
    type: BiquadFilterType = 'peaking';
    frequency = new MockAudioParam();
    Q = new MockAudioParam();
    gain = new MockAudioParam();
    connect = vi.fn((target: any) => target);
    disconnect = vi.fn();
  }

  class MockGainNode {
    gain = new MockAudioParam();
    connect = vi.fn((target: any) => target);
    disconnect = vi.fn();
  }

  class MockAnalyserNode {
    fftSize = 128;
    frequencyBinCount = 64;
    smoothingTimeConstant = 0.8;
    getByteFrequencyData = vi.fn((arr: Uint8Array) => arr.fill(128));
    getByteTimeDomainData = vi.fn((arr: Uint8Array) => arr.fill(128));
    connect = vi.fn((target: any) => target);
  }

  class MockAudioContext {
    state: AudioContextState = 'suspended';
    currentTime = 0;
    destination = {};
    createGain = vi.fn(() => new MockGainNode());
    createBiquadFilter = vi.fn(() => new MockBiquadFilterNode());
    createAnalyser = vi.fn(() => new MockAnalyserNode());
    createMediaElementSource = vi.fn(() => ({
      connect: vi.fn((target: any) => target),
      disconnect: vi.fn(),
    }));
    resume = vi.fn().mockImplementation(async () => { this.state = 'running'; });
  }

  vi.stubGlobal('AudioContext', MockAudioContext);
  ```

#### 2.4.3 Deterministic Audio & Network Testing
1. **Synthetic Silent Audio Data URI**:
   Instead of loading remote 10MB audio files over the internet in CI, tests inject a 1-second base64 silent WAV URI:
   `const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';`
   This immediately fires native `<audio>` `loadedmetadata`, `canplay`, and `timeupdate` events without network timeouts.
2. **Playwright Network Routing**:
   ```ts
   await page.route('**/api/audius/**', async route => {
     await route.fulfill({
       status: 200,
       contentType: 'application/json',
       body: JSON.stringify({ data: [{ id: '1', title: 'Test Track', streamUrl: SILENT_WAV }] })
     });
   });
   ```
3. **Headless Browser Flags for Playwright (`playwright.config.ts`)**:
   ```ts
   use: {
     launchOptions: {
       args: [
         '--autoplay-policy=no-user-gesture-required',
         '--use-fake-ui-for-media-stream',
         '--mute-audio',
       ],
     },
   }
   ```

---

## 3. Caveats

1. **`createMediaElementSource` Lifetime Constraint**:
   An `HTMLAudioElement` cannot be connected to `createMediaElementSource` more than once. If an implementation tries to instantiate a new `AudioContext` on track change and re-connect the same `<audio>` element, the browser throws an unrecoverable `InvalidStateError`. The `AudioContext` and its source node must be maintained as persistent singletons across track changes, with only `audio.src` updating.
2. **Audio Range Requests (HTTP 206) in Service Workers**:
   Browser service workers have historically had issues handling HTTP 206 partial content range requests. Streaming audio or large torrent files must bypass standard service worker caching; service worker should strictly target application shell files (`index.html`, bundles, CSS, icons).
3. **Headless Audio Limitations**:
   In headless CI environments without audio hardware, `AudioContext` will not produce physical sound. Automated verification must rely on Web Audio node parameter assertions, AudioParam automation calls, and audio element playback lifecycle events (`play`, `pause`, `timeupdate`, `ended`).
4. **Icecast Radio CORS Restrictions**:
   Many third-party live radio streams do not serve `Access-Control-Allow-Origin: *`. Loading them directly in `<audio crossOrigin="anonymous">` will trigger a CORS block. The backend stream proxy (`server/index.js`) is an essential requirement for reliable radio playback through the equalizer DSP cascade.

---

## 4. Conclusion

1. **DSP Architecture**:
   - The 10-band equalizer must cascade in series: `MediaElementAudioSourceNode` $\to$ Pre-amp `GainNode` $\to$ 10 `BiquadFilterNode`s (32Hz to 16kHz, peaking, $Q = 1.4142$) $\to$ `AnalyserNode` $\to$ `AudioContext.destination`.
   - AudioParam adjustments must use `setTargetAtTime(targetDb, currentTime, 0.05)` to eliminate slider clicks and pops.
   - Six distinct presets (Flat, Bass Boost, Vocal Clarity, Rock, Electronic, Custom) provide instant professional sound tuning.
2. **Visualizer Architecture**:
   - Zero React re-render design is achieved by rendering `<canvas>` with a detached `requestAnimationFrame` loop using pre-allocated `Uint8Array` buffers and `devicePixelRatio` canvas backing.
   - Supports both frequency spectrum bars (with peak hold) and oscilloscope waveforms, automatically pausing when audio is paused or offscreen.
3. **Scaffolding & Compatibility**:
   - Current workspace has `package.json` with React 18, Zustand, Tailwind, Vite, Express, and WebTorrent.
   - Implementing agents must provide `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, and `index.html`.
   - Express server in `server/index.js` must handle CORS stream proxying for radio stations and sequential byte-range streaming for torrents.
   - PWA manifest and Android viewport/safe-area insets must be configured to deliver an authentic native-feeling mobile experience.
4. **Testing Framework**:
   - Combine `Vitest` for ultra-fast DSP mathematics and node connection testing with `Playwright` for cross-browser, mobile-responsive (<768px vs >=768px), and synthetic audio playback E2E verification.

---

## 5. Verification Method

### 5.1 DSP Cascade & Math Verification
1. **Mathematical Invariant**:
   Check that for each band $i$ from 0 to 9, $f_i \in [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]\text{ Hz}$, $Q = \sqrt{2} \approx 1.4142$, and filter type is `'peaking'`.
2. **Node Connection Invariant**:
   In `tests/unit/equalizerDsp.test.ts`, verify:
   - `preAmp.connect(filters[0])`
   - `filters[i].connect(filters[i+1])` for $i = 0..8$
   - `filters[9].connect(analyser)`
   - `analyser.connect(destination)`
3. **Preset Value Verification**:
   Verify that selecting 'Bass Boost' applies $[+7, +6, +5, +3, +1, 0, 0, 0, 0, 0]\text{ dB}$ with $-3.0\text{ dB}$ pre-amp.

### 5.2 Visualizer Zero-Latency Verification
1. **Zero React Re-render Invariant**:
   In the visualizer component, confirm that `requestAnimationFrame` does not call any React `setState` hook. State mutations must never exceed 0 React reconciliations during active playback frames.
2. **Lifecycle Invariant**:
   Assert that `cancelAnimationFrame` is called when audio is paused, preventing idle CPU drain.

### 5.3 Automated Test Commands (to be executed after scaffolding)
- Unit tests: `npx vitest run`
- TypeScript check: `npx tsc --noEmit`
- E2E tests: `npx playwright test`
- Mobile viewport test: `npx playwright test --project="Mobile Chrome"`
