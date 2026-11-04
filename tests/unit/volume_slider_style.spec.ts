import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

describe('Volume Slider Style & White Fill Invariants', () => {
  it('ensures LyricsModal volume slider includes inline linear-gradient white fill style', () => {
    const filePath = path.resolve(__dirname, '../../src/components/lyrics/LyricsModal.tsx');
    const content = fs.readFileSync(filePath, 'utf8');

    // 1. Verify range input exists
    expect(content).toContain('type="range"');

    // 2. Verify inline linear-gradient white fill style is present
    expect(content).toMatch(
      /style=\{\{\s*background:\s*`linear-gradient\(to right,\s*#ffffff 0%,\s*#ffffff \$\{\(isMuted \? 0 : volume\) \* 100\}%,\s*rgba\(255, 255, 255, 0\.2\) \$\{\(isMuted \? 0 : volume\) \* 100\}%,\s*rgba\(255, 255, 255, 0\.2\) 100%\)`,\s*\}\}/
    );

    // 3. Verify volume hover transition styling
    expect(content).toContain('hover:h-1.5 transition-all');
  });

  it('ensures PlayerBar volume slider maintains linear-gradient white fill style', () => {
    const filePath = path.resolve(__dirname, '../../src/components/layout/PlayerBar.tsx');
    const content = fs.readFileSync(filePath, 'utf8');

    expect(content).toMatch(
      /style=\{\{\s*background:\s*`linear-gradient\(to right,\s*#ffffff 0%,\s*#ffffff \$\{\(isMuted \? 0 : volume\) \* 100\}%,\s*rgba\(255, 255, 255, 0\.2\) \$\{\(isMuted \? 0 : volume\) \* 100\}%,\s*rgba\(255, 255, 255, 0\.2\) 100%\)`,\s*\}\}/
    );
  });

  it('ensures DevicePickerModal volume slider includes linear-gradient white fill style', () => {
    const filePath = path.resolve(__dirname, '../../src/components/connect/DevicePickerModal.tsx');
    const content = fs.readFileSync(filePath, 'utf8');

    expect(content).toMatch(
      /style=\{\{\s*background:\s*`linear-gradient\(to right,\s*#ffffff 0%,\s*#ffffff \$\{displayVolume \* 100\}%,\s*rgba\(255, 255, 255, 0\.2\) \$\{displayVolume \* 100\}%,\s*rgba\(255, 255, 255, 0\.2\) 100%\)`,\s*\}\}/
    );
  });

  it('computes correct fill percentage stops across volume spectrum', () => {
    const computeGradient = (vol: number, isMuted: boolean) => {
      const pct = (isMuted ? 0 : vol) * 100;
      return `linear-gradient(to right, #ffffff 0%, #ffffff ${pct}%, rgba(255, 255, 255, 0.2) ${pct}%, rgba(255, 255, 255, 0.2) 100%)`;
    };

    expect(computeGradient(0.8, false)).toBe(
      'linear-gradient(to right, #ffffff 0%, #ffffff 80%, rgba(255, 255, 255, 0.2) 80%, rgba(255, 255, 255, 0.2) 100%)'
    );
    expect(computeGradient(0.8, true)).toBe(
      'linear-gradient(to right, #ffffff 0%, #ffffff 0%, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0.2) 100%)'
    );
    expect(computeGradient(0, false)).toBe(
      'linear-gradient(to right, #ffffff 0%, #ffffff 0%, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0.2) 100%)'
    );
    expect(computeGradient(1.0, false)).toBe(
      'linear-gradient(to right, #ffffff 0%, #ffffff 100%, rgba(255, 255, 255, 0.2) 100%, rgba(255, 255, 255, 0.2) 100%)'
    );
  });
});
