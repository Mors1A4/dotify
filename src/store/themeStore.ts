import { create } from 'zustand';
import { THEME_PRESETS, ThemeColors, ThemePresetId } from '../types/theme';
import { safeStorage } from '../utils/storage';

interface ThemeStoreState {
  activePreset: ThemePresetId;
  colors: ThemeColors;
  isThemeModalOpen: boolean;
  setPreset: (presetId: ThemePresetId) => void;
  setCustomColor: (key: keyof ThemeColors, value: string) => void;
  setAccentColor: (color: string, hoverColor?: string) => void;
  toggleThemeModal: (open?: boolean) => void;
}

const STORAGE_KEY_PRESET = 'theme'; // results in dotify_v1_theme
const STORAGE_KEY_COLORS = 'theme_colors';

const initialThemeData = safeStorage.getItem<{ preset: ThemePresetId }>(
  STORAGE_KEY_PRESET,
  { preset: 'spotify-oled' }
);
const initialPreset: ThemePresetId = initialThemeData.preset || 'spotify-oled';

const rawInitialColors: ThemeColors = safeStorage.getItem<ThemeColors>(
  STORAGE_KEY_COLORS,
  THEME_PRESETS[initialPreset]?.colors || THEME_PRESETS['spotify-oled'].colors
);
const initialColors: ThemeColors = {
  ...rawInitialColors,
  accentContent: '#000000',
};

export function updateNativeWindowIcon(accentColor: string) {
  if (typeof window === 'undefined') return;

  const size = 128;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}"><circle cx="256" cy="256" r="238" fill="${accentColor}"/><circle cx="256" cy="256" r="88" fill="#000000"/></svg>`;

  const img = new Image();
  img.onload = async () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, size, size);
      const imgData = ctx.getImageData(0, 0, size, size);
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_app_icon_rgba', {
        rgba: Array.from(imgData.data),
        width: size,
        height: size,
      });
    } catch {
      // In web browser or mobile environments, gracefully ignore
    }
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function updateFaviconBadge(accentColor: string) {
  if (typeof document === 'undefined') return;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="238" fill="${accentColor}"/><circle cx="256" cy="256" r="88" fill="#000000"/></svg>`;
  const encoded = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = encoded;
}

export function applyThemeToDOM(presetId: ThemePresetId, colors: ThemeColors) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  root.setAttribute('data-theme', presetId);
  root.style.setProperty('--bg-base', colors.bgBase);
  root.style.setProperty('--bg-surface', colors.bgSurface);
  root.style.setProperty('--bg-elevated', colors.bgElevated);
  root.style.setProperty('--bg-highlight', colors.bgHighlight);
  root.style.setProperty('--text-primary', colors.textPrimary);
  root.style.setProperty('--text-secondary', colors.textSecondary);
  root.style.setProperty('--text-muted', colors.textMuted);

  // Set both --accent and --color-accent
  root.style.setProperty('--accent', colors.accent);
  root.style.setProperty('--color-accent', colors.accent);

  root.style.setProperty('--accent-hover', colors.accentHover);
  root.style.setProperty('--accent-content', '#000000');
  root.style.setProperty('--border', colors.border);
  root.style.setProperty('--player-bg', colors.playerBg);
  root.style.setProperty('--seekbar-bg', colors.seekbarBg);
  root.style.setProperty('--seekbar-buffered', colors.seekbarBuffered);
  root.style.setProperty('--seekbar-fill', colors.seekbarFill);

  updateFaviconBadge(colors.accent);
  updateNativeWindowIcon(colors.accent);
}

// Apply on startup
if (typeof document !== 'undefined') {
  applyThemeToDOM(initialPreset, initialColors);
  setTimeout(() => updateNativeWindowIcon(initialColors.accent), 350);
}

export const useThemeStore = create<ThemeStoreState>((set, get) => ({
  activePreset: initialPreset,
  colors: initialColors,
  isThemeModalOpen: false,

  setPreset: (presetId: ThemePresetId) => {
    const newColors = THEME_PRESETS[presetId]?.colors || THEME_PRESETS['spotify-oled'].colors;
    applyThemeToDOM(presetId, newColors);
    safeStorage.setItem(STORAGE_KEY_PRESET, { preset: presetId });
    safeStorage.setItem(STORAGE_KEY_COLORS, newColors);
    set({ activePreset: presetId, colors: newColors });
  },

  setCustomColor: (key: keyof ThemeColors, value: string) => {
    const updated = { ...get().colors, [key]: value };
    applyThemeToDOM('custom', updated);
    safeStorage.setItem(STORAGE_KEY_PRESET, { preset: 'custom' });
    safeStorage.setItem(STORAGE_KEY_COLORS, updated);
    set({ activePreset: 'custom', colors: updated });
  },

  setAccentColor: (color: string, hoverColor?: string) => {
    const hover = hoverColor || color;
    const currentColors = get().colors;
    const updated: ThemeColors = {
      ...currentColors,
      accent: color,
      accentHover: hover,
      seekbarFill: color,
    };
    applyThemeToDOM('custom', updated);
    safeStorage.setItem(STORAGE_KEY_PRESET, { preset: 'custom' });
    safeStorage.setItem(STORAGE_KEY_COLORS, updated);
    set({ activePreset: 'custom', colors: updated });
  },

  toggleThemeModal: (open?: boolean) => {
    set((state) => ({
      isThemeModalOpen: open !== undefined ? open : !state.isThemeModalOpen,
    }));
  },
}));
