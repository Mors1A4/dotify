import React, { useEffect, useRef, useState, useId } from 'react';
import { audioEngine } from '../../audio/audioEngine';
import { usePlayerStore } from '../../store/playerStore';
import { useThemeStore } from '../../store/themeStore';
import { useVibeDjStore } from '../../store/vibeDjStore';

export interface FluidVibeDiscVisualizerProps {
  size?: number;
  className?: string;
  themeColor?: string;
  accentColor?: string;
  interactive?: boolean;
  onClick?: () => void;
  title?: string;
}

const NUM_POINTS = 20; // 20 radial points for organic, fluid liquid perimeter
const BASE_OUTER_RADIUS = 39; // Base radius for outer theme layer
const MAX_FLUID_DISPLACEMENT = 9; // Max fluid expansion (outer perimeter reaches up to 48, safe inside 100x100)

/**
 * Three-Tone Fluid Disc Visualizer:
 * 1. Outer: Theme color layer whose outer perimeter fluidly morphs with the music as a mini visualizer.
 * 2. Middle: Clean grey disc ring.
 * 3. Inner: Pitch black center dot (fused with the Dotify icon design).
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
  const defaultAccent = useThemeStore((s) => s.colors.accent);
  const djAccent = useVibeDjStore((s) => s.accentColor);
  const djThemeColor = useVibeDjStore((s) => s.themeColor);

  // Theme color resolution
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
    djAccent ||
    themeHexMap[djThemeColor] ||
    defaultAccent ||
    '#f43f5e';

  const [outerPath, setOuterPath] = useState<string>('');
  const [rotationAngle, setRotationAngle] = useState<number>(0);

  const animFrameId = useRef<number | null>(null);
  const currentRadii = useRef<number[]>(new Array(NUM_POINTS).fill(BASE_OUTER_RADIUS));
  const targetRadii = useRef<number[]>(new Array(NUM_POINTS).fill(BASE_OUTER_RADIUS));
  const smoothedEnergy = useRef<number>(0);
  const rotationRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(performance.now());
  const freqBuffer = useRef<Uint8Array>(new Uint8Array(32));
  const waveBuffer = useRef<Uint8Array>(new Uint8Array(32));

  useEffect(() => {
    let mounted = true;

    const tick = (now: number) => {
      if (!mounted) return;

      const deltaMs = Math.min(40, now - lastTimeRef.current);
      lastTimeRef.current = now;

      // Silence-aware audio detection
      const isAudible =
        isPlaying && !isBuffering && Boolean(currentTrack) && audioEngine.isAudioActive(3);

      const raw = isAudible ? audioEngine.getAudioEnergy() : 0;
      const normalizedEnergy = Math.min(1.0, raw / 200);

      // Liquid smoothing momentum (exponential moving average)
      smoothedEnergy.current = smoothedEnergy.current * 0.70 + normalizedEnergy * 0.30;
      const energy = smoothedEnergy.current;

      // Gentle disc rotation when playing
      if (isPlaying && !isBuffering) {
        const spinSpeed = 0.045 + energy * 0.035;
        rotationRef.current = (rotationRef.current + spinSpeed * deltaMs) % 360;
      }

      // Sample real audio frequency spectrum
      const analyser = audioEngine.getAnalyser();
      let hasFreqs = false;

      if (isAudible) {
        if (audioEngine.isBridgePlayback()) {
          hasFreqs = audioEngine.fillBridgeVisualizerData(freqBuffer.current, waveBuffer.current);
        } else if (analyser) {
          try {
            analyser.getByteFrequencyData(freqBuffer.current as any);
            hasFreqs = true;
          } catch {}
        }
      }

      // Compute fluid displacements for outer perimeter
      for (let i = 0; i < NUM_POINTS; i++) {
        let displacement = 0;

        if (isAudible) {
          if (hasFreqs) {
            // Symmetrical frequency mapping across the circumference
            const binIdx = Math.floor(
              Math.abs(Math.sin((i / NUM_POINTS) * Math.PI)) * 14 + (i % 2) * 2
            );
            const freqValue = (freqBuffer.current[binIdx] || 0) / 255;
            displacement = (freqValue * 0.75 + energy * 0.25) * MAX_FLUID_DISPLACEMENT;
          } else {
            // Organic harmonic wave formula
            const angle = (i / NUM_POINTS) * Math.PI * 2;
            const wave = Math.sin(now * 0.007 + angle * 2) * 0.5 + Math.cos(now * 0.004 - angle) * 0.5;
            displacement = energy * MAX_FLUID_DISPLACEMENT * (0.65 + 0.35 * wave);
          }
        }

        targetRadii.current[i] = BASE_OUTER_RADIUS + displacement;
        // Spring physics interpolation for liquid behavior
        currentRadii.current[i] =
          currentRadii.current[i] * 0.65 + targetRadii.current[i] * 0.35;
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

      setRotationAngle(rotationRef.current);
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
            <feGaussianBlur stdDeviation="2.2" result="blur" />
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

        {/* Rotating inner layers to maintain disc orientation */}
        <g
          transform={`rotate(${rotationAngle} 50 50)`}
          style={{ transformOrigin: '50px 50px' }}
          className="will-change-transform"
        >
          {/* ============================================================== */}
          {/* TONE 2 (MIDDLE): Grey Disc Ring                                */}
          {/* ============================================================== */}
          <circle
            cx="50"
            cy="50"
            r="26.5"
            fill="#2c2d36"
            stroke="#1c1d24"
            strokeWidth="1.2"
          />

          {/* ============================================================== */}
          {/* TONE 3 (INNER): Black Center Dot (Dotify Icon Core)            */}
          {/* ============================================================== */}
          <circle
            cx="50"
            cy="50"
            r="11"
            fill="#000000"
            stroke="#121318"
            strokeWidth="0.8"
          />
        </g>
      </svg>
  );
};

export default FluidVibeDiscVisualizer;
