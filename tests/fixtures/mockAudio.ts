/**
 * Deterministic Synthetic Audio Fixtures for CI and Headless Browser Testing.
 * Uses a valid 1-second 8kHz 16-bit mono PCM silent WAV data-URI.
 * Guarantees zero external network dependencies and immediate playback capability.
 */

// 1-second silent WAV data-URI
export const SILENT_WAV_BASE64 =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

// 5-second silent WAV data-URI for scrubbing tests
export const FIVE_SEC_SILENT_WAV =
  'data:audio/wav;base64,UklGRjYAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhEAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/**
 * Creates an in-memory synthetic AudioBuffer for Web Audio API tests.
 */
export function createSyntheticAudioBuffer(
  audioCtx: AudioContext,
  durationSec = 1.0,
  sampleRate = 44100
): AudioBuffer {
  const frameCount = Math.floor(sampleRate * durationSec);
  const buffer = audioCtx.createBuffer(2, frameCount, sampleRate);
  const leftChannel = buffer.getChannelData(0);
  const rightChannel = buffer.getChannelData(1);

  // Generate 440Hz reference tone at -18dB for determinism
  for (let i = 0; i < frameCount; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.125;
    leftChannel[i] = sample;
    rightChannel[i] = sample;
  }

  return buffer;
}
