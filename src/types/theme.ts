export type ThemePresetId =
  | 'spotify-oled'
  | 'nord-frost'
  | 'cyberpunk-neon'
  | 'retro-winamp'
  | 'rose-pine'
  | 'custom';

export interface ThemeColors {
  bgBase: string;
  bgSurface: string;
  bgElevated: string;
  bgHighlight: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  accentContent: string;
  border: string;
  playerBg: string;
  seekbarBg: string;
  seekbarBuffered: string;
  seekbarFill: string;
}

export interface AccentPreset {
  id: string;
  name: string;
  color: string;
  hoverColor: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'spotify-green', name: 'Spotify Green', color: '#1ed760', hoverColor: '#1db954' },
  { id: 'electric-cyan', name: 'Electric Cyan', color: '#00f0ff', hoverColor: '#22d3ee' },
  { id: 'neon-purple', name: 'Neon Purple', color: '#a855f7', hoverColor: '#9333ea' },
  { id: 'hot-pink', name: 'Hot Pink', color: '#ff2a85', hoverColor: '#f43f5e' },
  { id: 'sunset-orange', name: 'Sunset Orange', color: '#ff6b35', hoverColor: '#f97316' },
  { id: 'amber-gold', name: 'Amber Gold', color: '#fbbf24', hoverColor: '#f59e0b' },
  { id: 'crimson-red', name: 'Crimson Red', color: '#ef4444', hoverColor: '#dc2626' },
  { id: 'sky-blue', name: 'Sky Blue', color: '#38bdf8', hoverColor: '#0284c7' },
];

export interface ThemeDefinition {
  id: ThemePresetId;
  name: string;
  colors: ThemeColors;
}

export const THEME_PRESETS: Record<ThemePresetId, ThemeDefinition> = {
  'spotify-oled': {
    id: 'spotify-oled',
    name: 'Spotify OLED',
    colors: {
      bgBase: '#000000',
      bgSurface: '#121212',
      bgElevated: '#1e1e1e',
      bgHighlight: '#2a2a2a',
      textPrimary: '#ffffff',
      textSecondary: '#b3b3b3',
      textMuted: '#6b6b6b',
      accent: '#1db954',
      accentHover: '#1ed760',
      accentContent: '#ffffff',
      border: '#282828',
      playerBg: '#0f0f0f',
      seekbarBg: '#4d4d4d',
      seekbarBuffered: '#666666',
      seekbarFill: '#1db954',
    },
  },
  'nord-frost': {
    id: 'nord-frost',
    name: 'Nord Frost',
    colors: {
      bgBase: '#242933',
      bgSurface: '#2e3440',
      bgElevated: '#3b4252',
      bgHighlight: '#434c5e',
      textPrimary: '#eceff4',
      textSecondary: '#d8dee9',
      textMuted: '#9aa5b8',
      accent: '#88c0d0',
      accentHover: '#81a1c1',
      accentContent: '#ffffff',
      border: '#4c566a',
      playerBg: '#1f232a',
      seekbarBg: '#4c566a',
      seekbarBuffered: '#5e81ac',
      seekbarFill: '#88c0d0',
    },
  },
  'cyberpunk-neon': {
    id: 'cyberpunk-neon',
    name: 'Cyberpunk Neon',
    colors: {
      bgBase: '#0a0518',
      bgSurface: '#130924',
      bgElevated: '#200e3b',
      bgHighlight: '#32155d',
      textPrimary: '#00ffff',
      textSecondary: '#ff007f',
      textMuted: '#a277ff',
      accent: '#ff007f',
      accentHover: '#ff3399',
      accentContent: '#ffffff',
      border: '#ff007f33',
      playerBg: '#090414',
      seekbarBg: '#32155d',
      seekbarBuffered: '#6622aa',
      seekbarFill: '#00ffff',
    },
  },
  'retro-winamp': {
    id: 'retro-winamp',
    name: 'Retro Winamp',
    colors: {
      bgBase: '#1a1a1a',
      bgSurface: '#232323',
      bgElevated: '#2d2d2d',
      bgHighlight: '#3d3d3d',
      textPrimary: '#00ff00',
      textSecondary: '#ffff00',
      textMuted: '#888888',
      accent: '#00ff00',
      accentHover: '#33ff33',
      accentContent: '#ffffff',
      border: '#444444',
      playerBg: '#141414',
      seekbarBg: '#333333',
      seekbarBuffered: '#555555',
      seekbarFill: '#00ff00',
    },
  },
  'rose-pine': {
    id: 'rose-pine',
    name: 'Rosé Pine',
    colors: {
      bgBase: '#191724',
      bgSurface: '#1f1d2e',
      bgElevated: '#26233a',
      bgHighlight: '#403d52',
      textPrimary: '#e0def4',
      textSecondary: '#908caa',
      textMuted: '#6e6a86',
      accent: '#eb6f92',
      accentHover: '#f6c177',
      accentContent: '#ffffff',
      border: '#403d52',
      playerBg: '#161420',
      seekbarBg: '#403d52',
      seekbarBuffered: '#524f67',
      seekbarFill: '#eb6f92',
    },
  },
  custom: {
    id: 'custom',
    name: 'Custom Theme',
    colors: {
      bgBase: '#121212',
      bgSurface: '#181818',
      bgElevated: '#242424',
      bgHighlight: '#2f2f2f',
      textPrimary: '#ffffff',
      textSecondary: '#b3b3b3',
      textMuted: '#7a7a7a',
      accent: '#1db954',
      accentHover: '#1ed760',
      accentContent: '#ffffff',
      border: '#282828',
      playerBg: '#111111',
      seekbarBg: '#4d4d4d',
      seekbarBuffered: '#666666',
      seekbarFill: '#1db954',
    },
  },
};
