import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveAndroidIconThemeKey, updateAndroidAppIcon } from '../../src/store/themeStore';
import { ACCENT_PRESETS } from '../../src/types/theme';

describe('Android Dynamic Theme Icon Resolution', () => {
  beforeEach(() => {
    (globalThis as any).window = globalThis;
  });

  afterEach(() => {
    delete (globalThis as any).AndroidNativeTheme;
  });

  it('maps all 8 ACCENT_PRESETS colors and IDs accurately to Android icon keys', () => {
    const expectedMapping: Record<string, string> = {
      'spotify-green': 'green',
      'electric-cyan': 'cyan',
      'neon-purple': 'purple',
      'hot-pink': 'pink',
      'sunset-orange': 'orange',
      'amber-gold': 'amber',
      'crimson-red': 'red',
      'sky-blue': 'blue',
    };

    for (const preset of ACCENT_PRESETS) {
      const byId = resolveAndroidIconThemeKey(preset.id);
      const byColor = resolveAndroidIconThemeKey(preset.color);
      const expected = expectedMapping[preset.id];

      expect(byId).toBe(expected);
      expect(byColor).toBe(expected);
    }
  });

  it('maps preset theme IDs to the appropriate color icon', () => {
    expect(resolveAndroidIconThemeKey('spotify-oled')).toBe('green');
    expect(resolveAndroidIconThemeKey('nord-frost')).toBe('blue');
    expect(resolveAndroidIconThemeKey('cyberpunk-neon')).toBe('pink');
    expect(resolveAndroidIconThemeKey('retro-winamp')).toBe('green');
    expect(resolveAndroidIconThemeKey('rose-pine')).toBe('pink');
  });

  it('maps custom arbitrary hex codes to the nearest chromatic preset', () => {
    // A shade of purple (#9900ee)
    expect(resolveAndroidIconThemeKey('#9900ee')).toBe('purple');
    // A shade of bright red (#e61919)
    expect(resolveAndroidIconThemeKey('#e61919')).toBe('red');
    // A shade of neon green (#00ff44)
    expect(resolveAndroidIconThemeKey('#00ff44')).toBe('green');
    // A shade of cyan/teal (#00dddd)
    expect(resolveAndroidIconThemeKey('#00dddd')).toBe('cyan');
  });

  it('gracefully handles empty or invalid strings with default green', () => {
    expect(resolveAndroidIconThemeKey('')).toBe('green');
    expect(resolveAndroidIconThemeKey('invalid-color-value')).toBe('green');
  });

  it('invokes AndroidNativeTheme.setAppIcon bridge when available on window', () => {
    const mockSetAppIcon = vi.fn().mockReturnValue(true);
    (globalThis as any).AndroidNativeTheme = {
      setAppIcon: mockSetAppIcon,
    };

    updateAndroidAppIcon('#00f0ff'); // cyan

    expect(mockSetAppIcon).toHaveBeenCalledWith('cyan');
  });
});
