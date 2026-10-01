import React from 'react';
import { audioEngine } from '../../audio/audioEngine';
import { useThemeStore } from '../../store/themeStore';
import { usePlayerStore } from '../../store/playerStore';
import { NebulaVisualiser, NebulaTheme } from './NebulaVisualiser';
import { Maximize2 } from 'lucide-react';

export interface VisualizerCanvasProps {
  className?: string;
  theme?: NebulaTheme;
  intensity?: number;
  showExpandButton?: boolean;
}

export const VisualizerCanvas: React.FC<VisualizerCanvasProps> = ({
  className = '',
  theme = 'theme',
  intensity = 0.95,
  showExpandButton = true,
}) => {
  const accentColor = useThemeStore((s) => s.colors.accent);
  const toggleVisualizer = usePlayerStore((s) => s.toggleVisualizer);

  return (
    <div
      className={`relative w-full h-full min-h-[200px] rounded-xl overflow-hidden border border-customBorder bg-base/80 ${className}`}
    >
      <NebulaVisualiser
        analyser={audioEngine.getAnalyser()}
        theme={theme}
        accentColor={accentColor}
        intensity={intensity}
        className="w-full h-full"
      />

      {showExpandButton && (
        <button
          type="button"
          onClick={() => toggleVisualizer(true)}
          aria-label="Open Fullscreen Visualizer"
          title="Open Fullscreen Visualizer"
          className="absolute top-2.5 right-2.5 z-20 p-2 rounded-full bg-surface/70 hover:bg-highlight text-secondary hover:text-primary backdrop-blur-md border border-white/10 transition-all shadow-md active:scale-95 cursor-pointer"
        >
          <Maximize2 size={15} />
        </button>
      )}
    </div>
  );
};

export default VisualizerCanvas;
