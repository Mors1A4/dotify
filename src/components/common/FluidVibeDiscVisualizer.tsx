import React, { useEffect, useRef, useState, useId } from 'react';
import { audioEngine } from '../../audio/audioEngine';
import { usePlayerStore } from '../../store/playerStore';
import { useThemeStore } from '../../store/themeStore';

export interface FluidVibeDiscVisualizerProps {
  size?: number;
  className?: string;
  themeColor?: string;
  accentColor?: string;
  interactive?: boolean;
  onClick?: () => void;
  title?: string;
}

const NUM_POINTS = 32; // 32 radial points for ultra-smooth organic liquid perimeter
const BASE_OUTER_RADIUS = 36.5; // Base radius for outer theme layer
const MAX_FLUID_DISPLACEMENT = 11.0; // Max fluid expansion (outer perimeter reaches up to 47.5, safe inside 100x100)

/**
 * Three-Tone Fluid Disc Visualizer:
 * 1. Outer: User's app theme colour (e.g. blue), whose 32 radial points fluidly expand with the music as a mini visualizer.
 * 2. Middle: Solid grey disc ring (completely static, centered at 50,50).
 * 3. Inner: Pitch black center dot (completely static, centered at 50,50).
 *
 * INVARIANT: Tone 2 and Tone 3 are 100% static at (50, 50). The center NEVER moves or rotates.
 */
export const FluidVibeDiscVisualizer: React.FC<FluidVibeDiscVisualizerProps> = ({
  size = 24,
  className = '',
  themeColor,
  accentColor,
  interactive = false,
  onClick,
  title,
}) => {
  const rawId = useId();
  const cleanId = rawId.replace(/[^a-zA-Z0-9]/g, '');

  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const appAccent = useThemeStore((s) => s.colors.accent);

  // Theme color resolution: Always prioritize the active app theme color (e.g. blue)
  const themeHexMap: Record<string, string> = {
    purple: '#a855f7',
    rose: '#f43f5e',
    emerald: '#10b981',
    blue: '#38bdf8',
    amber: '#f59e0b',
  };

  const effectiveThemeColor =
    accentColor ||
    themeHexMap[themeColor || ''] ||
    themeColor ||
    appAccent ||
    '#38bdf8';

  const [outerPath, setOuterPath] = useState<string>('');

  const animFrameId = useRef<number | null>(null);
  const currentRadii = useRef<number[]>(new Array(NUM_POINTS).fill(BASE_OUTER_RADIUS));
  const targetRadii = useRef<number[]>(new Array(NUM_POINTS).fill(BASE_OUTER_RADIUS));
  const smoothedEnergy = useRef<number>(0);
  const lastTimeRef = useRef<number>(performance.now());
  const freqBuffer = useRef<Uint8Array>(new Uint8Array(64));
  const waveBuffer = useRef<Uint8Array>(new Uint8Array(64));

  useEffect(() => {
    let mounted = true;

    const tick = (now: number) => {
      if (!mounted) return;

      const deltaMs = Math.min(40, now - lastTimeRef.current);
      lastTimeRef.current = now;

      // Active music state: true if player is playing a track and not buffering
      // Works across local playback, YouTube iframe bridge, and remote Google Cast / kitchen speakers!
      const isMusicPlaying = isPlaying && !isBuffering && Boolean(currentTrack);

      // Check for live Web Audio analyser energy
      const rawAudioEnergy = audioEngine.getAudioEnergy();
      const hasRealAudio = rawAudioEnergy > 0;

      // Normalize energy: if real audio is available, use it; otherwise synthesize tempo-synced dynamic energy
      let normalizedEnergy = 0;
      if (isMusicPlaying) {
        if (hasRealAudio) {
          normalizedEnergy = Math.min(1.0, rawAudioEnergy / 120);
        } else {
          // Synthetic music pulse for remote cast / kitchen speaker / bridge modes
          const t = now * 0.001;
          const beatPhase = (t % (60 / 124)) / (60 / 124);
          const kickEnvelope = Math.exp(-beatPhase * 4.5);
          normalizedEnergy = 0.40 + kickEnvelope * 0.60;
        }
      }

      // Viscous liquid smoothing momentum
      smoothedEnergy.current = smoothedEnergy.current * 0.70 + normalizedEnergy * 0.30;
      const energy = smoothedEnergy.current;

      // Sample real audio frequency spectrum if available
      const analyser = audioEngine.getAnalyser();
      let hasFreqs = false;

      if (hasRealAudio) {
        if (audioEngine.isBridgePlayback()) {
          hasFreqs = audioEngine.fillBridgeVisualizerData(freqBuffer.current, waveBuffer.current);
        } else if (analyser) {
          try {
            analyser.getByteFrequencyData(freqBuffer.current as any);
            hasFreqs = true;
          } catch {}
        }
      }

      // Compute fluid displacement for each of the 32 radial points
      for (let i = 0; i < NUM_POINTS; i++) {
        let displacement = 0;

        if (isMusicPlaying && energy > 0.01) {
          const angle = (i / NUM_POINTS) * Math.PI * 2;

          // Multi-layer wave harmonic synthesis
          const bass = Math.sin(now * 0.004 + angle * 2) * 0.38;
          const mid = Math.cos(now * 0.0055 - angle * 4) * 0.28 + Math.sin(now * 0.007 + angle * 5) * 0.20;
          const high = Math.cos(now * 0.011 + angle * 7) * 0.14;
          const harmonicFactor = Math.max(0, Math.min(1.0, (bass + mid + high + 1.0) * 0.5));

          if (hasFreqs) {
            // Real audio: Map frequency bins around the circle with harmonic blending
            const binIdx = Math.floor(
              Math.abs(Math.sin((i / NUM_POINTS) * Math.PI)) * 24 + (i % 4) * 2
            );
            const freqVal = (freqBuffer.current[binIdx] || 0) / 255;
            displacement = (freqVal * 0.60 + energy * 0.25 + harmonicFactor * 0.25) * MAX_FLUID_DISPLACEMENT;
          } else {
            // Fluid wave dynamics: layered organic liquid surface tension
            displacement = energy * MAX_FLUID_DISPLACEMENT * (0.20 + 0.80 * harmonicFactor);
          }
        }

        targetRadii.current[i] = BASE_OUTER_RADIUS + Math.max(0, Math.min(MAX_FLUID_DISPLACEMENT, displacement));
        // Viscous spring physics interpolation for liquid behavior
        currentRadii.current[i] =
          currentRadii.current[i] * 0.70 + targetRadii.current[i] * 0.30;
      }

      // Build smooth closed Bezier loop for the fluid outer perimeter
      const points: { x: number; y: number }[] = [];
      const centerX = 50;
      const centerY = 50;

      for (let i = 0; i < NUM_POINTS; i++) {
        const theta = (i / NUM_POINTS) * (Math.PI * 2) - Math.PI / 2;
        const r = currentRadii.current[i];
        points.push({
          x: centerX + Math.cos(theta) * r,
          y: centerY + Math.sin(theta) * r,
        });
      }

      if (points.length >= 3) {
        const midPoints: { x: number; y: number }[] = [];
        for (let i = 0; i < points.length; i++) {
          const p1 = points[i];
          const p2 = points[(i + 1) % points.length];
          midPoints.push({
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2,
          });
        }

        let d = `M ${midPoints[0].x.toFixed(2)} ${midPoints[0].y.toFixed(2)}`;
        for (let i = 0; i < points.length; i++) {
          const next = (i + 1) % points.length;
          d += ` Q ${points[next].x.toFixed(2)} ${points[next].y.toFixed(2)}, ${midPoints[next].x.toFixed(2)} ${midPoints[next].y.toFixed(2)}`;
        }
        d += ' Z';
        setOuterPath(d);
      }

      animFrameId.current = requestAnimationFrame(tick);
    };

    animFrameId.current = requestAnimationFrame(tick);

    return () => {
      mounted = false;
      if (animFrameId.current) {
        cancelAnimationFrame(animFrameId.current);
      }
    };
  }, [isPlaying, isBuffering, currentTrack]);

  const glowFilterId = `fluid-disc-glow-${cleanId}`;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={`overflow-visible select-none shrink-0 ${
        interactive ? 'cursor-pointer hover:scale-105 active:scale-95 transition-transform' : ''
      } ${className}`}
      style={{ width: size, height: size }}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        {/* Subtle glow filter for the morphing outer theme layer */}
        <filter id={glowFilterId} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.0" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* ============================================================== */}
      {/* TONE 1 (OUTER): Fluid Theme Color Layer (Mini Visualizer)     */}
      {/* ============================================================== */}
      {outerPath ? (
        <path
          d={outerPath}
          fill={effectiveThemeColor}
          filter={`url(#${glowFilterId})`}
          className="transition-colors duration-300"
        />
      ) : (
        <circle
          cx="50"
          cy="50"
          r={BASE_OUTER_RADIUS}
          fill={effectiveThemeColor}
          filter={`url(#${glowFilterId})`}
          className="transition-colors duration-300"
        />
      )}

      {/* ============================================================== */}
      {/* TONE 2 (MIDDLE): Solid Grey Disc Ring - 100% STATIC (NO MOVE)  */}
      {/* ============================================================== */}
      <circle
        cx="50"
        cy="50"
        r="24.5"
        fill="#2c2d36"
        stroke="#1c1d24"
        strokeWidth="1.2"
      />

      {/* ============================================================== */}
      {/* TONE 3 (INNER): Black Center Dot - 100% STATIC (NO MOVE)       */}
      {/* ============================================================== */}
      <circle
        cx="50"
        cy="50"
        r="9.5"
        fill="#000000"
        stroke="#121318"
        strokeWidth="0.8"
      />
    </svg>
  );
};

export default FluidVibeDiscVisualizer;
