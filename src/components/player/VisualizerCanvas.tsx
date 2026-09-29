import React from 'react';
import { audioEngine } from '../../audio/audioEngine';
import { useThemeStore } from '../../store/themeStore';
import { NebulaVisualiser, NebulaTheme } from './NebulaVisualiser';

export interface VisualizerCanvasProps {
  className?: string;
  theme?: NebulaTheme;
  intensity?: number;
}

export const VisualizerCanvas: React.FC<VisualizerCanvasProps> = ({
  className = '',
  theme = 'theme',
  intensity = 0.95,
}) => {
  const accentColor = useThemeStore((s) => s.colors.accent);

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
    </div>
  );
};

export default VisualizerCanvas;
