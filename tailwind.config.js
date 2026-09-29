const withVarAlpha = (cssVar) => ({ opacityValue }) => {
  const num = Number(opacityValue);
  if (opacityValue === undefined || Number.isNaN(num) || num >= 1) {
    return `var(${cssVar})`;
  }
  const pct = Math.round(num * 100);
  return `color-mix(in srgb, var(${cssVar}) ${pct}%, transparent)`;
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: withVarAlpha('--bg-surface'),
        elevated: withVarAlpha('--bg-elevated'),
        highlight: withVarAlpha('--bg-highlight'),
        primary: withVarAlpha('--text-primary'),
        secondary: withVarAlpha('--text-secondary'),
        muted: withVarAlpha('--text-muted'),
        accent: withVarAlpha('--accent'),
        'accent-hover': withVarAlpha('--accent-hover'),
        'accent-content': withVarAlpha('--accent-content'),
        customBorder: withVarAlpha('--border'),
        playerBg: withVarAlpha('--player-bg'),
        spotify: '#1DB954',
        'spotify-hover': '#1ed760',
      },
      backgroundColor: {
        base: withVarAlpha('--bg-base'),
      },
      borderColor: {
        base: withVarAlpha('--bg-base'),
      },
      gradientColorStops: {
        base: withVarAlpha('--bg-base'),
      },
      fontFamily: {
        sans: [
          'CircularSp',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
