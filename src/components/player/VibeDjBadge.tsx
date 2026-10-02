import React from 'react';
import { useVibeDjStore } from '../../store/vibeDjStore';
import { usePlayerStore } from '../../store/playerStore';
import { Sparkles, Disc3, RefreshCw } from 'lucide-react';

export const VibeDjBadge: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isActive, vibeLabel, themeColor, isShaking, shakeUpVibe } = useVibeDjStore();
  const { navigateToVibeDj, activeView } = usePlayerStore();

  if (!isActive) return null;

  const colorStyles: Record<string, { bg: string; text: string; border: string; glow: string }> = {
    purple: {
      bg: 'bg-purple-500/15',
      text: 'text-purple-400',
      border: 'border-purple-500/40',
      glow: 'shadow-[0_0_12px_rgba(168,85,247,0.35)]',
    },
    emerald: {
      bg: 'bg-emerald-500/15',
      text: 'text-emerald-400',
      border: 'border-emerald-500/40',
      glow: 'shadow-[0_0_12px_rgba(16,185,129,0.35)]',
    },
    rose: {
      bg: 'bg-rose-500/15',
      text: 'text-rose-400',
      border: 'border-rose-500/40',
      glow: 'shadow-[0_0_12px_rgba(244,63,94,0.35)]',
    },
    blue: {
      bg: 'bg-blue-500/15',
      text: 'text-blue-400',
      border: 'border-blue-500/40',
      glow: 'shadow-[0_0_12px_rgba(14,165,233,0.35)]',
    },
    amber: {
      bg: 'bg-amber-500/15',
      text: 'text-amber-400',
      border: 'border-amber-500/40',
      glow: 'shadow-[0_0_12px_rgba(245,158,11,0.35)]',
    },
  };

  const style = colorStyles[themeColor] || colorStyles.purple;

  return (
    <div
      onClick={navigateToVibeDj}
      role="button"
      tabIndex={0}
      title="Vibe DJ is live in the mix! Click to open DJ console"
      className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-full border cursor-pointer select-none transition-all duration-200 hover:scale-105 active:scale-95 ${
        style.bg
      } ${style.border} ${style.glow} ${activeView === 'vibe-dj' ? 'ring-1 ring-white/30' : ''}`}
    >
      <div className="relative flex items-center justify-center">
        <Disc3
          size={14}
          className={`${style.text} ${isShaking ? 'animate-spin' : 'animate-[spin_4s_linear_infinite]'}`}
        />
        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
      </div>

      <div className="flex items-center gap-1">
        <span className={`text-[11px] font-bold tracking-wider uppercase ${style.text}`}>
          Vibe DJ
        </span>
        {!compact && (
          <span className="text-[10px] text-secondary/70 truncate max-w-[100px] hidden lg:inline">
            • {vibeLabel}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          shakeUpVibe();
        }}
        title="Shake Up the Vibe!"
        className="ml-0.5 p-0.5 rounded-full text-secondary hover:text-white transition-colors"
      >
        <Sparkles size={11} className={isShaking ? 'animate-spin text-amber-300' : ''} />
      </button>
    </div>
  );
};
