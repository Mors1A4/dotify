import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import os from 'os';

/**
 * Playwright E2E configuration for dotify.
 * Configured for both Desktop and Mobile viewports with synthetic audio mocking.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30 * 1000,
  expect: {
    timeout: 8 * 1000,
  },
  outputDir: path.join(os.tmpdir(), `pw-artifacts-${Date.now()}`),
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    bypassCSP: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'Mobile Pixel',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 393, height: 851 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30 * 1000,
  },
});
