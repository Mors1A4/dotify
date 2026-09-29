import React from 'react';
import { useAudioActive } from '../../hooks/useAudioActive';

interface VisualizerIconProps {
  size?: number;
  className?: string;
  animate?: boolean;
  accentHighlight?: boolean;
}

/**
 * Custom SVG icon for the Audio Spectrum & Nebula Visualizer.
 * Uses a 5-bar vertically-centered symmetric soundwave with a 4-point visual sparkle accent.
 *
 * AUDIO SILENCE INVARIANT:
 * This icon NEVER animates when the music is silent (such as during playback start,
 * intro silence, buffering, seeking, or pause). The animation ONLY activates when
 * actual audible sound waves are produced by the audio engine.
 */
export const VisualizerIcon: React.FC<VisualizerIconProps> = ({
  size = 18,
  className = '',
  animate = true,
  accentHighlight = true,
}) => {
  const isAudioActive = useAudioActive(5, 50);

  // Only animate if enabled AND audio energy is detected
  const shouldAnimate = animate && isAudioActive;
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
            0%, 100% { transform: scaleY(0.48); }
            50% { transform: scaleY(1.18); }
          }
          @keyframes dotify-vis-sparkle {
            0%, 100% { transform: scale(0.9) rotate(0deg); opacity: 0.85; }
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

          .vis-sparkle {
            transform-origin: 19.5px 4.2px;
            animation: dotify-vis-sparkle 2.2s ease-in-out infinite;
          }
        `}
      </style>

      {/* 5 Centered Symmetric Audio Waveform Bars (Resting statically when silent) */}
      <rect
        x="1.8"
        y="9.5"
        width="2.3"
        height="7"
        rx="1.15"
        fill="currentColor"
        className={`vis-bar ${shouldAnimate ? 'vis-bar-active-1' : ''}`}
      />
      <rect
        x="6.0"
        y="5.5"
        width="2.3"
        height="15"
        rx="1.15"
        fill="currentColor"
        className={`vis-bar ${shouldAnimate ? 'vis-bar-active-2' : ''}`}
      />
      <rect
        x="10.2"
        y="3"
        width="2.4"
        height="20"
        rx="1.2"
        fill={highlightFill}
        className={`vis-bar ${shouldAnimate ? 'vis-bar-active-3' : ''}`}
      />
      <rect
        x="14.5"
        y="7.5"
        width="2.3"
        height="11"
        rx="1.15"
        fill="currentColor"
        className={`vis-bar ${shouldAnimate ? 'vis-bar-active-4' : ''}`}
      />
      <rect
        x="18.7"
        y="10.5"
        width="2.3"
        height="6"
        rx="1.15"
        fill="currentColor"
        className={`vis-bar ${shouldAnimate ? 'vis-bar-active-5' : ''}`}
      />

      {/* Top-Right 4-Point Visual Sparkle (✦) */}
      <path
        d="M19.5 1.0C19.68 3.0 20.5 3.82 22.5 4.0C20.5 4.18 19.68 5.0 19.5 7.0C19.32 5.0 18.5 4.18 16.5 4.0C18.5 3.82 19.32 3.0 19.5 1.0Z"
        fill={highlightFill}
        className={shouldAnimate ? 'vis-sparkle' : ''}
      />
    </svg>
  );
};
