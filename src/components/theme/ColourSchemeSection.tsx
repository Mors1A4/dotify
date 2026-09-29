import React from 'react';
import { useThemeStore } from '../../store/themeStore';
import { ACCENT_PRESETS } from '../../types/theme';
import { Palette, Check } from 'lucide-react';

export const ColourSchemeSection: React.FC = () => {
  const { colors, setAccentColor } = useThemeStore();

  return (
    <div className="px-2 py-1.5 flex flex-col gap-1 border-b border-customBorder/50">
      <div className="flex items-center gap-1.5 px-1 py-1 text-[11px] font-semibold text-muted">
        <Palette size={13} className="text-accent" />
        <span>Accent Colour Scheme</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 p-1 bg-elevated/50 rounded-xl">
        {ACCENT_PRESETS.map((preset) => {
          const isSelected = colors.accent.toLowerCase() === preset.color.toLowerCase();
          return (
            <button
              key={preset.id}
              type="button"
              title={preset.name}
              onClick={() => setAccentColor(preset.color, preset.hoverColor)}
              className={`relative flex items-center justify-center p-2 rounded-lg transition-all cursor-pointer ${
                isSelected
                  ? 'bg-surface shadow-sm ring-1 ring-accent'
                  : 'hover:bg-elevated/70'
              }`}
            >
              <span
                className="w-4 h-4 rounded-full shadow-sm"
                style={{ backgroundColor: preset.color }}
              />
              {isSelected && (
                <Check
                  size={12}
                  className="absolute text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
