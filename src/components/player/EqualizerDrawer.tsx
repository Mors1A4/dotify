import React, { useState } from 'react';
import { audioEngine } from '../../audio/audioEngine';
import { EQ_FREQUENCIES, EqualizerPreset } from '../../dsp/types';
import { Sliders, Power, RotateCcw } from 'lucide-react';

export const EqualizerDrawer: React.FC = () => {
  const [eqState, setEqState] = useState(() => audioEngine.getEqualizerState());
  const [isFastStart, setIsFastStart] = useState(() => audioEngine.isFastStartBurst());

  const handleToggle = () => {
    audioEngine.toggleEqualizer();
    setEqState(audioEngine.getEqualizerState());
  };

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const preset = e.target.value as EqualizerPreset;
    audioEngine.setEqualizerPreset(preset);
    setEqState(audioEngine.getEqualizerState());
  };

  const handleBandChange = (index: number, val: number) => {
    audioEngine.setBandGain(index, val);
    setEqState(audioEngine.getEqualizerState());
  };

  const handlePreAmpChange = (val: number) => {
    audioEngine.setPreAmp(val);
    setEqState(audioEngine.getEqualizerState());
  };

  const handleReset = () => {
    audioEngine.setEqualizerPreset('flat');
    audioEngine.setPreAmp(0);
    setEqState(audioEngine.getEqualizerState());
  };

  const formatFreq = (freq: number) => {
    return freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
  };

  return (
    <div className="p-3.5 bg-surface text-primary flex flex-col gap-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between border-b border-customBorder pb-3">
        <div className="flex items-center gap-2">
          <Sliders className="text-accent" size={16} />
          <h3 className="font-bold text-sm text-primary">10-Band Equalizer</h3>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            data-testid="eq-reset-btn"
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-elevated hover:bg-highlight text-xs text-secondary hover:text-primary transition-colors"
            title="Reset to Flat (0dB)"
          >
            <RotateCcw size={12} />
            <span>Reset</span>
          </button>

          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              id="eq-toggle"
              data-testid="eq-enable-toggle"
              checked={eqState.enabled}
              onChange={handleToggle}
              className="accent-accent cursor-pointer"
            />
            <span className="text-xs font-semibold">{eqState.enabled ? 'On' : 'Bypass'}</span>
          </label>
        </div>
      </div>

      {/* Preset Selector */}
      <div className="flex items-center justify-between bg-elevated p-2.5 rounded-lg border border-customBorder">
        <span className="text-xs text-secondary font-medium">EQ Preset</span>
        <select
          id="eq-preset"
          value={eqState.preset}
          onChange={handlePresetChange}
          data-testid="eq-preset-select"
          disabled={!eqState.enabled}
          className="bg-highlight text-primary text-xs rounded px-2.5 py-1.5 outline-none border border-customBorder cursor-pointer"
        >
          <option value="flat">Flat</option>
          <option value="bass-boost">Bass Boost</option>
          <option value="vocal">Vocal Clarity</option>
          <option value="rock">Rock</option>
          <option value="electronic">Electronic</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      {/* Pre-Amp Slider */}
      <div className="flex flex-col gap-1.5 bg-elevated/50 p-2.5 rounded-lg border border-customBorder">
        <div className="flex justify-between text-xs">
          <span className="text-secondary">Pre-Amp</span>
          <span className="font-mono text-accent">
            {eqState.preAmp > 0 ? `+${eqState.preAmp}` : eqState.preAmp} dB
          </span>
        </div>
        <input
          type="range"
          min="-12"
          max="12"
          step="0.5"
          value={eqState.preAmp}
          data-testid="eq-preamp-slider"
          disabled={!eqState.enabled}
          onChange={(e) => handlePreAmpChange(parseFloat(e.target.value))}
          className="w-full cursor-pointer h-1.5 rounded-lg bg-highlight appearance-none"
        />
      </div>

      {/* 10 Vertical Sliders */}
      <div className="flex justify-between items-end gap-1.5 pt-2 pb-2 h-44 px-1 bg-elevated/30 rounded-xl border border-customBorder">
        {EQ_FREQUENCIES.map((freq, idx) => {
          const gain = eqState.bands[idx] || 0;
          return (
            <div key={freq} className="flex-1 flex flex-col items-center h-full justify-between">
              <span className="text-[10px] font-mono text-secondary">
                {gain > 0 ? `+${gain}` : gain}
              </span>

              <div className="relative flex-1 flex items-center justify-center my-1 w-full">
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="0.5"
                  value={gain}
                  data-frequency={freq}
                  disabled={!eqState.enabled}
                  onChange={(e) => handleBandChange(idx, parseFloat(e.target.value))}
                  data-testid={`eq-band-${freq}`}
                  className="vertical-eq-slider h-28 w-2 appearance-none bg-highlight rounded-lg outline-none cursor-pointer accent-accent"
                  style={{
                    writingMode: 'vertical-lr',
                    direction: 'rtl',
                  }}
                />
              </div>

              <span className="text-[10px] text-muted font-medium mt-1">
                {formatFreq(freq)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Audio Performance: Instant Fast-Start Burst */}
      <div className="mt-auto pt-3 border-t border-customBorder/60 flex flex-col gap-2">
        <div className="flex items-center justify-between bg-elevated/60 p-2.5 rounded-lg border border-customBorder/60">
          <div className="flex flex-col pr-2">
            <span className="text-xs font-semibold text-primary">Instant Fast-Start Burst</span>
            <span className="text-[10px] text-muted">Plays initial audio burst in &lt;100ms with smooth crossfade into full stream</span>
          </div>
          <input
            type="checkbox"
            checked={isFastStart}
            onChange={(e) => {
              const val = e.target.checked;
              setIsFastStart(val);
              audioEngine.setFastStartBurstEnabled(val);
            }}
            className="accent-accent cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
};
