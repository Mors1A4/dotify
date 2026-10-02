import React from 'react';
import { useVibeDjStore } from '../../store/vibeDjStore';
import { usePlayerStore } from '../../store/playerStore';
import { useThemeStore } from '../../store/themeStore';
import { FluidVibeDiscVisualizer } from '../common/FluidVibeDiscVisualizer';

export interface VibeDjIconProps {
  size?: number;
  className?: string;
  themeColor?: string;
  accentColor?: string;
  isPlaying?: boolean;
  isShaking?: boolean;
}

/**
 * Three-Tone Fluid Disc Icon:
 * - Outer: User's app theme colour (e.g. blue), fluidly morphing with the music as a mini visualizer
 * - Middle: Solid grey disc ring (completely static)
 * - Inner: Pitch black center dot (completely static)
 */
export const VibeDjIcon: React.FC<VibeDjIconProps> = ({
  size = 22,
  className = '',
  themeColor,
  accentColor,
}) => {
  const { colors } = useThemeStore();
  const effectiveAccent = accentColor || themeColor || colors.accent || '#38bdf8';

  return (
    <FluidVibeDiscVisualizer
      size={size}
      className={className}
      accentColor={effectiveAccent}
    />
  );
};

export interface VibeDjBadgeProps {
  compact?: boolean;
  size?: number;
  className?: string;
  isActive?: boolean;
  vibeLabel?: string;
  themeColor?: string;
  accentColor?: string;
}

/**
 * Modern Vibe DJ control button for PlayerBar.
 * Features the three-tone fluid disc visualizer (theme outer, grey, black inner)
 * that morphs in real-time with the music. Center is 100% static.
 */
export const VibeDjBadge: React.FC<VibeDjBadgeProps> = ({
  size = 22,
  className = '',
  isActive: propIsActive,
  vibeLabel: propVibeLabel,
  themeColor: propThemeColor,
  accentColor: propAccentColor,
}) => {
  const store = useVibeDjStore();
  const { colors } = useThemeStore();
  const { navigateToVibeDj, activeView } = usePlayerStore();

  const isActive = propIsActive ?? store.isActive;
  const vibeLabel = propVibeLabel ?? store.vibeLabel;
  const shakeUpVibe = store.shakeUpVibe;
  // Always prioritize the user's active app theme (e.g. blue)
  const effectiveAccent = propAccentColor || propThemeColor || colors.accent || '#38bdf8';

  if (!isActive) return null;

  return (
    <button
      type="button"
      onClick={navigateToVibeDj}
      onContextMenu={(e) => {
        e.preventDefault();
        shakeUpVibe();
      }}
      data-testid="vibe-dj-badge"
      aria-label={`Vibe DJ: ${vibeLabel}`}
      title={`Vibe DJ: ${vibeLabel} • Click to open console, right-click to shake`}
      className={`group relative p-1.5 rounded-full text-secondary hover:text-white transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center shrink-0 ${
        activeView === 'vibe-dj'
          ? 'text-white bg-white/10 ring-1 ring-white/20'
          : 'hover:bg-white/5'
      } ${className}`}
    >
      <VibeDjIcon
        size={size}
        accentColor={effectiveAccent}
      />
    </button>
  );
};

export default VibeDjBadge;
