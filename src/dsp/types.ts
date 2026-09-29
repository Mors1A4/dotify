export interface EqualizerBandConfig {
  frequency: number; // [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
  type: 'peaking';
  Q: number; // 1.4142 (1-octave bandwidth)
  gain: number; // -12dB to +12dB
}

export type EqualizerPreset =
  | 'flat'
  | 'bass-boost'
  | 'vocal'
  | 'rock'
  | 'electronic'
  | 'custom';

export interface EqualizerState {
  enabled: boolean;
  preset: EqualizerPreset;
  preAmp: number; // -12dB to +12dB
  bands: number[]; // 10 gain values in dB
}

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESET_GAINS: Record<EqualizerPreset, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'bass-boost': [6, 5, 4, 2, 0, 0, 0, 0, 1, 2],
  vocal: [-2, -2, -1, 1, 3, 4, 3, 2, 0, -1],
  rock: [4, 3, 2, 0, -1, 0, 2, 3, 4, 4],
  electronic: [5, 4, 2, 0, -1, 1, 2, 3, 4, 5],
  custom: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};
