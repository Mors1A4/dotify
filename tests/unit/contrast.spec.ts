import { describe, it, expect } from 'vitest';

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length !== 6 && cleanHex.length !== 3) return null;

  let r: number, g: number, b: number;
  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16);
    g = parseInt(cleanHex[1] + cleanHex[1], 16);
    b = parseInt(cleanHex[2] + cleanHex[2], 16);
  } else {
    r = parseInt(cleanHex.substring(0, 2), 16);
    g = parseInt(cleanHex.substring(2, 4), 16);
    b = parseInt(cleanHex.substring(4, 6), 16);
  }

  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return { r, g, b };
}

export function getRelativeLuminance(r: number, g: number, b: number): number {
  const sRGB = [r, g, b].map((val) => {
    const channel = val / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
}

export function getContrastRatio(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return 1.0;

  const l1 = getRelativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = getRelativeLuminance(rgb2.r, rgb2.g, rgb2.b);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

describe('Theme Contrast & WCAG Luminance Calculations', () => {
  it('parses valid 6-character and 3-character hex codes', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#1db954')).toEqual({ r: 29, g: 185, b: 84 });
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('rejects malformed hex codes cleanly', () => {
    expect(hexToRgb('not-a-hex')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
    expect(hexToRgb('#gggggg')).toBeNull();
  });

  it('computes 21:1 maximum contrast ratio between pure white and pure black', () => {
    const ratio = getContrastRatio('#ffffff', '#000000');
    expect(ratio).toBeCloseTo(21.0, 1);
  });

  it('computes 1:1 contrast ratio between identical colors', () => {
    const ratio = getContrastRatio('#121212', '#121212');
    expect(ratio).toBeCloseTo(1.0, 2);
  });

  it('verifies Spotify green (#1DB954) on dark base (#121212) meets accessibility contrast', () => {
    const ratio = getContrastRatio('#1db954', '#121212');
    expect(ratio).toBeGreaterThan(3.0); // Sufficient for large text / UI elements
  });
});
