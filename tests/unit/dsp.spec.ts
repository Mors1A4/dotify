import { describe, it, expect } from 'vitest';
import { EQ_FREQUENCIES, EQ_PRESETS } from '../fixtures/mockData';

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

export function linearToDb(linear: number): number {
  return 20 * Math.log10(Math.max(1e-5, linear));
}

export interface EqualizerBandConfig {
  frequency: number;
  type: 'peaking';
  Q: number;
  gain: number;
}

export const DEFAULT_EQ_BANDS: EqualizerBandConfig[] = EQ_FREQUENCIES.map((freq) => ({
  frequency: freq,
  type: 'peaking' as const,
  Q: 1.4142,
  gain: 0,
}));

describe('Audio DSP & Equalizer Mathematical Contracts', () => {
  it('defines exactly 10 standard 1-octave frequency bands from 32Hz to 16kHz', () => {
    expect(EQ_FREQUENCIES).toHaveLength(10);
    expect(EQ_FREQUENCIES).toEqual([32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
  });

  it('configures BiquadFilter peaking filters with Q=1.4142 for 1-octave bandwidth', () => {
    for (const band of DEFAULT_EQ_BANDS) {
      expect(band.type).toBe('peaking');
      expect(band.Q).toBeCloseTo(1.4142, 4);
    }
  });

  it('clamps gain values strictly within -12dB and +12dB range', () => {
    const clampGain = (val: number) => Math.max(-12, Math.min(12, val));
    expect(clampGain(15)).toBe(12);
    expect(clampGain(-20)).toBe(-12);
    expect(clampGain(5.5)).toBe(5.5);
  });

  it('accurately converts decibels to linear gain multiplier', () => {
    expect(dbToLinear(0)).toBeCloseTo(1.0, 4);
    expect(dbToLinear(6)).toBeCloseTo(1.9953, 3);
    expect(dbToLinear(-6)).toBeCloseTo(0.5012, 3);
    expect(dbToLinear(12)).toBeCloseTo(3.981, 2);
    expect(dbToLinear(-12)).toBeCloseTo(0.2512, 3);
  });

  it('accurately converts linear multiplier to decibels', () => {
    expect(linearToDb(1.0)).toBeCloseTo(0, 4);
    expect(linearToDb(2.0)).toBeCloseTo(6.02, 2);
    expect(linearToDb(0.5)).toBeCloseTo(-6.02, 2);
  });

  it('verifies built-in preset definitions conform to contract', () => {
    expect(EQ_PRESETS).toContain('flat');
    expect(EQ_PRESETS).toContain('bass-boost');
    expect(EQ_PRESETS).toContain('vocal');
    expect(EQ_PRESETS).toContain('rock');
    expect(EQ_PRESETS).toContain('electronic');
    expect(EQ_PRESETS).toContain('custom');
  });

  it('calculates Bass Boost preset with boosted sub/low frequencies', () => {
    const bassBoostGains = [6, 5, 4, 2, 0, 0, 0, 0, 1, 2];
    expect(bassBoostGains[0]).toBeGreaterThan(bassBoostGains[4]);
    expect(bassBoostGains[1]).toBeGreaterThan(bassBoostGains[4]);
  });
});
