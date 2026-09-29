import React, { useEffect, useRef, useState, useCallback } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { useThemeStore } from '../../store/themeStore';
import { audioEngine } from '../../audio/audioEngine';
import { useSmoothSeekbar } from '../../hooks/useSmoothSeekbar';
import {
  NebulaVisualiser,
  NebulaTheme,
  getNebulaThemeHex,
} from './NebulaVisualiser';
import {
  X,
  Maximize2,
  Minimize2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  Radio,
} from 'lucide-react';
import {
  getTrackArtwork,
  resolveTrackArtwork,
  DEFAULT_MUSIC_ARTWORK,
  isUglyPlaceholder,
} from '../../services/artworkService';

const THEME_OPTIONS: { id: NebulaTheme; label: string }[] = [
  { id: 'theme',  label: 'Theme' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'ember',  label: 'Ember' },
  { id: 'neon',   label: 'Neon' },
  { id: 'ice',    label: 'Ice' },
  { id: 'mono',   label: 'Mono' },
];

export const VisualizerModal: React.FC = () => {
  const {
    isVisualizerOpen,
    toggleVisualizer,
    currentTrack,
    isPlaying,
    togglePlay,
    nextTrack,
    previousTrack,
    repeatMode,
    setRepeatMode,
    shuffle,
    toggleShuffle,
    toggleLike,
    isLiked,
    navigateToArtist,
  } = usePlayerStore();

  const themeAccentColor = useThemeStore((s) => s.colors.accent);
  const displayTrack = currentTrack || audioEngine.getCurrentTrack();

  const [theme, setTheme] = useState<NebulaTheme>('theme');
  const [intensity, setIntensity] = useState<number>(0.95);
  const [showHud, setShowHud] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Sync back to 'theme' palette whenever user updates the app's accent color
  useEffect(() => {
    setTheme('theme');
  }, [themeAccentColor]);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement>(null);

  const {
    seekbarRef,
    currentTimeRef,
    totalDurationRef,
    artworkRef,
    trackMetaRef,
    handleSeekInput,
    handleSeekChange,
  } = useSmoothSeekbar({
    track: displayTrack,
    isActive: isVisualizerOpen,
  });

  const cycleRepeat = () => {
    if (repeatMode === 'off') setRepeatMode('all');
    else if (repeatMode === 'all') setRepeatMode('one');
    else setRepeatMode('off');
  };

  // Close on Escape key press
  useEffect(() => {
    if (!isVisualizerOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        toggleVisualizer(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisualizerOpen, toggleVisualizer]);

  // Fullscreen Toggle
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // 2D Studio Telemetry HUD overlay loop (Lissajous Vectorscope, dBFS Meters, Micro-Spectrum)
  useEffect(() => {
    if (!isVisualizerOpen) return;
    const hudCanvas = hudCanvasRef.current;
    if (!hudCanvas) return;
    const ctx = hudCanvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let timeBuffer = new Uint8Array(512);
    let freqBuffer = new Uint8Array(512);
    const peakHolds = [0, 0, 0, 0];

    const updateHudSize = () => {
      const stage = stageRef.current || containerRef.current;
      if (!stage) return;
      const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
      const w = stage.clientWidth || 800;
      const h = stage.clientHeight || 600;
      hudCanvas.width = Math.floor(w * dpr);
      hudCanvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    updateHudSize();
    let ro: ResizeObserver | null = null;
    const observeTarget = stageRef.current || containerRef.current;
    if (typeof ResizeObserver !== 'undefined' && observeTarget) {
      ro = new ResizeObserver(updateHudSize);
      ro.observe(observeTarget);
    }

    const renderHud = () => {
      const stage = stageRef.current || containerRef.current;
      const w = stage?.clientWidth || 800;
      const h = stage?.clientHeight || 600;

      ctx.clearRect(0, 0, w, h);

      if (showHud && w > 480) {
        const analyser = audioEngine.getAnalyser();
        const accentHex = getNebulaThemeHex(theme, themeAccentColor);

        if (analyser) {
          const binCount = analyser.frequencyBinCount;
          if (timeBuffer.length !== binCount) {
            timeBuffer = new Uint8Array(binCount);
            freqBuffer = new Uint8Array(binCount);
          }
          analyser.getByteTimeDomainData(timeBuffer);
          analyser.getByteFrequencyData(freqBuffer);
        }

        ctx.save();

        // 1. Top-Right Lissajous Phase Vectorscope
        const scopeSize = 74;
        const scopeX = w - scopeSize - 80;
        const scopeY = 24;
        const centerX = scopeX + scopeSize / 2;
        const centerY = scopeY + scopeSize / 2;

        // Circular boundary & crosshair
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(centerX, centerY, scopeSize / 2, 0, Math.PI * 2);
        ctx.moveTo(scopeX, centerY);
        ctx.lineTo(scopeX + scopeSize, centerY);
        ctx.moveTo(centerX, scopeY);
        ctx.lineTo(centerX, scopeY + scopeSize);
        ctx.stroke();

        // Phase Vector Curve
        ctx.strokeStyle = accentHex;
        ctx.lineWidth = 1.35;
        ctx.beginPath();
        const quarterOffset = 64;
        for (let i = 0; i < 256; i += 2) {
          const s1 = (timeBuffer[i] - 128) / 128;
          const s2 = (timeBuffer[(i + quarterOffset) % timeBuffer.length] - 128) / 128;
          const px = centerX + (s1 - s2) * (scopeSize * 0.35);
          const py = centerY + (s1 + s2) * (scopeSize * 0.35);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // 2. Left-Side dBFS Band Telemetry & Peak-Hold Meters
        const avg = (start: number, end: number) => {
          let s = 0;
          const c = Math.max(1, end - start);
          for (let i = start; i < end && i < freqBuffer.length; i++) s += freqBuffer[i];
          return Math.min(1, s / (c * 255));
        };

        const subVal = avg(0, 5);
        const lowVal = avg(5, 18);
        const midVal = avg(18, 110);
        const hiVal = avg(110, 320);

        const bands = [
          { label: 'SUB', val: subVal },
          { label: 'LOW', val: lowVal },
          { label: 'MID', val: midVal },
          { label: 'HI ', val: hiVal },
        ];

        const meterStartX = 28;
        const meterStartY = h - 76;
        const barW = 68;
        const barH = 4;

        ctx.font = '600 9px ui-monospace, monospace';
        ctx.textAlign = 'left';
        bands.forEach((b, idx) => {
          const y = meterStartY + idx * 15;
          if (b.val > peakHolds[idx]) peakHolds[idx] = b.val;
          else peakHolds[idx] *= 0.985;

          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.fillText(b.label, meterStartX, y + 4);

          // Bar track
          const bx = meterStartX + 28;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
          ctx.fillRect(bx, y, barW, barH);

          // Active level
          ctx.fillStyle = accentHex;
          ctx.fillRect(bx, y, barW * b.val, barH);

          // Peak tick
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(bx + barW * peakHolds[idx], y - 1, 1.5, barH + 2);
        });

        // 3. Bottom-Right Micro-Spectrum
        const specCount = 38;
        const specWidth = 140;
        const specX = w - specWidth - 28;
        const specY = h - 20;

        for (let i = 0; i < specCount; i++) {
          const binIdx = Math.floor((i / specCount) * Math.min(240, freqBuffer.length));
          const val = freqBuffer[binIdx] / 255;
          const barHgt = Math.max(2, val * 32);
          const x = specX + i * (specWidth / specCount);
          ctx.fillStyle = val > 0.75 ? '#ffffff' : i % 2 === 0 ? accentHex : 'rgba(255,255,255,0.35)';
          ctx.fillRect(x, specY - barHgt, 2, barHgt);
        }

        ctx.restore();
      }

      rafId = requestAnimationFrame(renderHud);
    };

    rafId = requestAnimationFrame(renderHud);

    return () => {
      cancelAnimationFrame(rafId);
      ro?.disconnect();
    };
  }, [isVisualizerOpen, showHud, theme, themeAccentColor]);

  if (!isVisualizerOpen) return null;

  const accentHex = getNebulaThemeHex(theme, themeAccentColor);

  return (
    <div
      ref={containerRef}
      data-testid="visualizer-modal"
      className="fixed inset-0 z-50 bg-[#030308] flex flex-col overflow-hidden select-none animate-in fade-in duration-300"
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif',
      }}
    >
      {/* Main Stage: 2D HUD Canvas + NEBULA Beat-Reactive Shader Engine */}
      <div ref={stageRef} className="w-full flex-1 relative min-h-0 overflow-hidden">
        {/* 2D Studio Telemetry HUD Overlay Canvas (DOM First for context inspection) */}
        <canvas
          ref={hudCanvasRef}
          data-testid="audio-visualizer-canvas"
          className="visualizer absolute inset-0 w-full h-full pointer-events-none"
          style={{
            zIndex: 10,
            display: showHud ? 'block' : 'none',
          }}
        />

        {/* Top-Right Close Button */}
        <button
          onClick={() => toggleVisualizer(false)}
          data-testid="close-visualizer-btn"
          aria-label="Close Visualizer"
          className="absolute top-5 right-5 z-40 p-2.5 rounded-full bg-surface/70 hover:bg-highlight text-secondary hover:text-primary backdrop-blur-xl border border-white/10 transition-all shadow-2xl hover:scale-105 active:scale-95 cursor-pointer"
          title="Close Visualizer (Esc)"
        >
          <X size={20} />
        </button>

        <NebulaVisualiser
          analyser={audioEngine.getAnalyser()}
          theme={theme}
          accentColor={themeAccentColor}
          intensity={intensity}
          onBeat={(e) => {
            if (typeof navigator !== 'undefined' && e > 0.65) {
              navigator.vibrate?.(12);
            }
          }}
          className="w-full h-full"
        />
      </div>

      {/* Solid Bottom Bar (Song Player + Visualizer Controls, matching normal page PlayerBar) */}
      <footer
        data-testid="visualizer-bottom-bar"
        className="w-full min-h-[80px] md:h-20 bg-playerBg border-t border-customBorder px-4 py-2 md:py-0 z-30 select-none shrink-0 flex flex-col md:flex-row items-center justify-between gap-4"
      >
        {/* Left: Track info */}
        <div className="hidden md:flex items-center gap-3 min-w-0 w-52 lg:w-64 shrink-0">
          {displayTrack ? (
            <>
              <img
                ref={artworkRef}
                src={getTrackArtwork(displayTrack)}
                alt={displayTrack.title}
                className="w-14 h-14 rounded-md object-cover shadow-md flex-shrink-0"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (target.src !== DEFAULT_MUSIC_ARTWORK) {
                    target.src = DEFAULT_MUSIC_ARTWORK;
                    resolveTrackArtwork(displayTrack.artist, displayTrack.title).then((url) => {
                      if (url && !isUglyPlaceholder(url)) target.src = url;
                    });
                  }
                }}
              />
              <div ref={trackMetaRef} className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-primary truncate">
                    {displayTrack.title}
                  </span>
                </div>
                <span
                  onClick={() => {
                    toggleVisualizer(false);
                    navigateToArtist(displayTrack.artist);
                  }}
                  className="text-xs text-secondary truncate hover:underline hover:text-primary cursor-pointer transition-colors"
                >
                  {displayTrack.artist}
                </span>
              </div>

              <button
                onClick={() => toggleLike(displayTrack)}
                aria-label="Like"
                className="ml-1 text-secondary hover:text-accent transition-colors p-1 cursor-pointer shrink-0"
                title={isLiked(displayTrack.id) ? 'Unlike' : 'Like'}
              >
                <Heart
                  size={18}
                  className={isLiked(displayTrack.id) ? 'text-accent fill-accent' : ''}
                />
              </button>
            </>
          ) : (
            <div className="flex items-center gap-3 text-muted text-xs">
              <div className="w-14 h-14 rounded-md bg-elevated/40 flex items-center justify-center">
                <Radio size={20} className="opacity-30" />
              </div>
              <span>No track playing</span>
            </div>
          )}
        </div>

        {/* Center: Transport & Zero-Latency Seekbar */}
        <div className="flex flex-col items-center justify-center flex-1 max-w-md w-full min-w-[200px] mx-auto">
          <div className="flex items-center gap-4 mb-1.5">
            <button
              onClick={toggleShuffle}
              aria-label="Shuffle"
              aria-pressed={shuffle}
              className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                shuffle ? 'text-accent' : 'text-secondary hover:text-primary'
              }`}
              title={shuffle ? 'Shuffle On' : 'Shuffle Off'}
            >
              <Shuffle size={16} />
            </button>

            <button
              onClick={previousTrack}
              aria-label="Previous"
              className="text-secondary hover:text-primary transition-colors cursor-pointer"
              title="Previous track"
            >
              <SkipBack size={20} />
            </button>

            <button
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="w-9 h-9 rounded-full bg-accent text-accent-content flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-md cursor-pointer"
            >
              {isPlaying ? (
                <Pause size={18} fill="currentColor" />
              ) : (
                <Play size={18} fill="currentColor" className="ml-0.5" />
              )}
            </button>

            <button
              onClick={nextTrack}
              aria-label="Next"
              className="text-secondary hover:text-primary transition-colors cursor-pointer"
              title="Next track"
            >
              <SkipForward size={20} />
            </button>

            <button
              onClick={cycleRepeat}
              aria-label={`Repeat: ${repeatMode}`}
              className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                repeatMode !== 'off' ? 'text-accent' : 'text-secondary hover:text-primary'
              }`}
              title={`Repeat: ${repeatMode}`}
            >
              {repeatMode === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
            </button>
          </div>

          <div className="flex items-center gap-2 w-full">
            <span
              ref={currentTimeRef}
              className="text-[11px] font-mono text-muted w-10 text-right"
            >
              0:00
            </span>

            <input
              ref={seekbarRef}
              type="range"
              min="0"
              max="500"
              step="any"
              defaultValue="0"
              style={{
                background:
                  'linear-gradient(to right, #ffffff 0%, #ffffff 0%, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0.2) 100%)',
              }}
              onInput={handleSeekInput}
              onChange={handleSeekChange}
              className="seekbar flex-1 h-1 rounded-none appearance-none cursor-pointer hover:h-1.5 transition-all"
            />

            <span
              ref={totalDurationRef}
              className="text-[11px] font-mono text-muted w-10 text-left"
            >
              0:00
            </span>
          </div>
        </div>

        {/* Right: Visualizer Theme, Intensity, HUD & Fullscreen Controls */}
        <div className="flex items-center justify-center md:justify-end gap-2 shrink-0">
          {/* Theme Selectors */}
          <div className="flex items-center gap-0.5 bg-elevated border border-customBorder rounded-lg p-0.5">
            {THEME_OPTIONS.map((item) => {
              const active = theme === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setTheme(item.id)}
                  data-testid="visualizer-mode-toggle"
                  aria-label={`Toggle Visualizer Mode - ${item.label}`}
                  style={
                    active
                      ? {
                          backgroundColor: accentHex,
                          color: '#05050a',
                        }
                      : undefined
                  }
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    active ? 'shadow-sm' : 'text-secondary hover:text-primary'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Intensity Slider */}
          <div
            className="flex items-center gap-1.5 px-1"
            title="Beat Reactivity & Glow Intensity"
          >
            <span className="hidden lg:inline text-[10px] font-mono text-muted">INTENSITY</span>
            <input
              type="range"
              min={0.5}
              max={2.0}
              step={0.05}
              value={intensity}
              onChange={(e) => setIntensity(parseFloat(e.target.value))}
              style={{
                width: '56px',
                accentColor: accentHex,
                cursor: 'pointer',
              }}
            />
          </div>

          {/* HUD Toggle */}
          <button
            onClick={() => setShowHud((prev) => !prev)}
            title="Toggle Studio Telemetry HUD"
            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-mono font-bold border transition-colors cursor-pointer ${
              showHud
                ? 'bg-elevated text-primary border-customBorder'
                : 'bg-transparent text-muted border-customBorder/50 hover:text-primary'
            }`}
          >
            HUD
          </button>

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
            aria-label="Toggle Fullscreen"
            className="p-1.5 rounded-lg bg-elevated hover:bg-highlight text-secondary hover:text-primary border border-customBorder transition-colors cursor-pointer flex items-center justify-center"
          >
            {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </footer>
    </div>
  );
};

export default VisualizerModal;

