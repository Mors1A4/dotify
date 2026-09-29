import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
  optimizeDeps: {
    include: ['qrcode', 'lucide-react', 'clsx', 'tailwind-merge', 'zustand', 'react', 'react-dom'],
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
});
