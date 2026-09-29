import React from 'react';
import { usePlayerStore } from '../../store/playerStore';

interface VisualizerIconProps {
  size?: number;
  className?: string;
  animate?: boolean;
  accentHighlight?: boolean;
}

/**
 * Custom SVG icon for the Audio Spectrum & Nebula Visualizer.
 * Uses a 5-bar vertically-centered symmetric soundwave with a 4-point visual
 * sparkle accent and smooth wave animation so it is unmistakably an audio
 * visualizer rather than a static analytics bar chart or EQ slider.
 */
export const VisualizerIcon: React.FC<VisualizerIconProps> = ({
  size = 18,
  className = '',
  animate = true,
  accentHighlight = true,
}) => {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isVisualizerOpen = usePlayerStore((s) => s.isVisualizerOpen);

  const shouldPulse = animate && (isPlaying || isVisualizerOpen);
  const highlightFill = accentHighlight ? 'var(--color-accent, currentColor)' : 'currentColor';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`select-none shrink-0 overflow-visible ${className}`}
      aria-hidden="true"
    >
      <style>
        {`
          @keyframes dotify-vis-wave {
            0%, 100% { transform: scaleY(0.52); }
            50% { transform: scaleY(1.14); }
          }
          @keyframes dotify-vis-idle {
            0%, 100% { transform: scaleY(0.86); }
            50% { transform: scaleY(1.08); }
          }
          @keyframes dotify-vis-sparkle {
            0%, 100% { transform: scale(0.9) rotate(0deg); opacity: 0.88; }
            50% { transform: scale(1.18) rotate(12deg); opacity: 1; }
          }
          .vis-bar {
            transform-origin: center 13px;
            transition: transform 0.25s ease;
          }
          .vis-bar-active-1 { animation: dotify-vis-wave 0.85s ease-in-out infinite 0.0s; }
          .vis-bar-active-2 { animation: dotify-vis-wave 0.70s ease-in-out infinite 0.15s; }
          .vis-bar-active-3 { animation: dotify-vis-wave 0.62s ease-in-out infinite 0.05s; }
          .vis-bar-active-4 { animation: dotify-vis-wave 0.78s ease-in-out infinite 0.22s; }
          .vis-bar-active-5 { animation: dotify-vis-wave 0.90s ease-in-out infinite 0.12s; }

          .vis-bar-idle-1 { animation: dotify-vis-idle 2.4s ease-in-out infinite 0.0s; }
          .vis-bar-idle-2 { animation: dotify-vis-idle 2.1s ease-in-out infinite 0.3s; }
          .vis-bar-idle-3 { animation: dotify-vis-idle 1.9s ease-in-out infinite 0.15s; }
          .vis-bar-idle-4 { animation: dotify-vis-idle 2.2s ease-in-out infinite 0.45s; }
          .vis-bar-idle-5 { animation: dotify-vis-idle 2.5s ease-in-out infinite 0.25s; }

          .vis-sparkle {
            transform-origin: 19.5px 4.2px;
            animation: dotify-vis-sparkle 2.2s ease-in-out infinite;
          }
        `}
      </style>

      {/* 5 Centered Symmetric Audio Waveform Bars */}
      <rect
        x="1.8"
        y="9.5"
        width="2.3"
        height="7"
        rx="1.15"
        fill="currentColor"
        className={`vis-bar ${shouldPulse ? 'vis-bar-active-1' : animate ? 'vis-bar-idle-1' : ''}`}
      />
      <rect
        x="6.0"
        y="5.5"
        width="2.3"
        height="15"
        rx="1.15"
        fill="currentColor"
        className={`vis-bar ${shouldPulse ? 'vis-bar-active-2' : animate ? 'vis-bar-idle-2' : ''}`}
      />
      <rect
        x="10.2"
        y="3"
        width="2.4"
        height="20"
        rx="1.2"
        fill={highlightFill}
        className={`vis-bar ${shouldPulse ? 'vis-bar-active-3' : animate ? 'vis-bar-idle-3' : ''}`}
      />
      <rect
        x="14.5"
        y="7.5"
        width="2.3"
        height="11"
        rx="1.15"
        fill="currentColor"
        className={`vis-bar ${shouldPulse ? 'vis-bar-active-4' : animate ? 'vis-bar-idle-4' : ''}`}
      />
      <rect
        x="18.7"
        y="10.5"
        width="2.3"
        height="6"
        rx="1.15"
        fill="currentColor"
        className={`vis-bar ${shouldPulse ? 'vis-bar-active-5' : animate ? 'vis-bar-idle-5' : ''}`}
      />

      {/* Top-Right 4-Point Visual Sparkle (✦) denoting Visual Shader + Audio */}
      <path
        d="M19.5 1.0C19.68 3.0 20.5 3.82 22.5 4.0C20.5 4.18 19.68 5.0 19.5 7.0C19.32 5.0 18.5 4.18 16.5 4.0C18.5 3.82 19.32 3.0 19.5 1.0Z"
        fill={highlightFill}
        className={animate ? 'vis-sparkle' : ''}
      />
    </svg>
  );
};
