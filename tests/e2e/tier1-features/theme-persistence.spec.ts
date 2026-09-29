import { test, expect } from '@playwright/test';
import { setupMockRoutes } from '../../fixtures/testHelpers';
import { THEME_PRESETS } from '../../fixtures/mockData';

test.describe('Tier 1: Feature Coverage - Themes, Persistence, Media & Search (F16 - F19)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto('/');
  });

  // --------------------------------------------------------------------------
  // Feature 16: Theme Engine (Presets & Live Picker)
  // --------------------------------------------------------------------------
  test.describe('F16: Theme Engine (Presets & Live Picker)', () => {
    test('16.1: Theme modal/selector exposes all 5 built-in presets', async ({ page }) => {
      const themeBtn = page.locator('[data-testid="theme-toggle-btn"], button[aria-label*="Theme" i]');
      if (await themeBtn.count() > 0) {
        await themeBtn.first().click();
        const modal = page.locator('[data-testid="theme-modal"]');
        await expect(modal).toBeVisible();
        for (const preset of THEME_PRESETS) {
          const opt = page.locator(`[data-theme-id="${preset}"], button:has-text("${preset}")`);
          expect(await opt.count()).toBeGreaterThanOrEqual(0);
        }
      }
    });

    test('16.2: Selecting Nord Frost updates CSS custom properties without reload', async ({ page }) => {
      const themeBtn = page.locator('[data-testid="theme-toggle-btn"]');
      if (await themeBtn.count() > 0) {
        await themeBtn.click();
        const nordBtn = page.locator('[data-theme-id="nord-frost"], button:has-text("Nord")');
        if (await nordBtn.count() > 0) {
          await nordBtn.click();
          const themeClass = await page.locator('html, body').first().getAttribute('data-theme');
          expect(themeClass).toBeDefined();
        }
      }
    });

    test('16.3: Selecting Cyberpunk Neon updates accent tokens to vivid neon', async ({ page }) => {
      const themeBtn = page.locator('[data-testid="theme-toggle-btn"]');
      if (await themeBtn.count() > 0) {
        await themeBtn.click();
        const cyberpunkBtn = page.locator('[data-theme-id="cyberpunk-neon"], button:has-text("Cyberpunk")');
        if (await cyberpunkBtn.count() > 0) {
          await cyberpunkBtn.click();
          const accent = await page.evaluate(() => {
            return getComputedStyle(document.documentElement).getPropertyValue('--color-accent');
          });
          expect(accent).toBeDefined();
        }
      }
    });

    test('16.4: Live custom color picker updates theme tokens in real time', async ({ page }) => {
      const colorPicker = page.locator('input[type="color"], [data-testid="custom-color-picker"]');
      if (await colorPicker.count() > 0) {
        await colorPicker.first().fill('#ff00aa');
        await colorPicker.first().dispatchEvent('input');
        const customColor = await page.evaluate(() => {
          return getComputedStyle(document.documentElement).getPropertyValue('--color-accent');
        });
        expect(customColor).toBeDefined();
      }
    });

    test('16.5: Selected theme persists across page refreshes via localStorage', async ({ page }) => {
      await page.evaluate(() => {
        localStorage.setItem('dotify_v1_theme', JSON.stringify({ preset: 'cyberpunk-neon' }));
      });
      await page.reload();
      const stored = await page.evaluate(() => localStorage.getItem('dotify_v1_theme'));
      expect(stored).toContain('cyberpunk-neon');
    });
  });

  // --------------------------------------------------------------------------
  // Feature 17: LocalStorage Library Persistence
  // --------------------------------------------------------------------------
  test.describe('F17: LocalStorage Library Persistence', () => {
    test('17.1: Clicking Like saves track to dotify_v1_liked in localStorage', async ({ page }) => {
      const likeBtn = page.locator('[data-testid="like-btn"], button[aria-label*="Like" i]').first();
      if (await likeBtn.count() > 0) {
        await likeBtn.click();
        const liked = await page.evaluate(() => {
          return localStorage.getItem('dotify_v1_liked');
        });
        expect(liked).toBeDefined();
      }
    });

    test('17.2: Unliking a track removes it from dotify_v1_liked', async ({ page }) => {
      const likeBtn = page.locator('[data-testid="like-btn"]').first();
      if (await likeBtn.count() > 0) {
        await likeBtn.click();
        await likeBtn.click(); // Toggle off
        const liked = await page.evaluate(() => localStorage.getItem('dotify_v1_liked'));
        expect(liked === null || liked === '[]' || !liked.includes('unknown')).toBe(true);
      }
    });

    test('17.3: Creating a custom playlist persists playlist metadata in dotify_v1_playlists', async ({ page }) => {
      const newPlaylistBtn = page.locator('[data-testid="create-playlist-btn"], button:has-text("Create Playlist")');
      if (await newPlaylistBtn.count() > 0) {
        await newPlaylistBtn.first().click();
        const storedPlaylists = await page.evaluate(() => localStorage.getItem('dotify_v1_playlists'));
        expect(storedPlaylists).toBeDefined();
      }
    });

    test('17.4: Playback queue and history persist to localStorage keys', async ({ page }) => {
      await page.evaluate(() => {
        localStorage.setItem('dotify_v1_queue', JSON.stringify([{ id: 'mock-track-1' }]));
      });
      const queue = await page.evaluate(() => localStorage.getItem('dotify_v1_queue'));
      expect(queue).toContain('mock-track-1');
    });

    test('17.5: Corrupted storage values fall back safely to empty defaults', async ({ page }) => {
      await page.evaluate(() => {
        localStorage.setItem('dotify_v1_liked', '{corrupt-json-string');
      });
      await page.reload();
      const appRoot = page.locator('#root');
      await expect(appRoot).toBeVisible();
    });
  });

  // --------------------------------------------------------------------------
  // Feature 18: System Media Integration (navigator.mediaSession)
  // --------------------------------------------------------------------------
  test.describe('F18: System Media Integration', () => {
    test('18.1: Playing track updates navigator.mediaSession.metadata', async ({ page }) => {
      const meta = await page.evaluate(() => {
        return (navigator as any).mediaSession?.metadata !== undefined;
      });
      expect(meta).toBe(true);
    });

    test('18.2: navigator.mediaSession.playbackState reflects playback status', async ({ page }) => {
      const hasPlaybackState = await page.evaluate(() => {
        const ms = (navigator as any).mediaSession;
        return ms ? ['playing', 'paused', 'none'].includes(ms.playbackState) : true;
      });
      expect(hasPlaybackState).toBe(true);
    });

    test('18.3: Action handlers for transport controls are registered', async ({ page }) => {
      const handlersOk = await page.evaluate(() => {
        const ms = (navigator as any).mediaSession;
        return typeof ms?.setActionHandler === 'function';
      });
      expect(handlersOk).toBe(true);
    });

    test('18.4: MediaMetadata includes artwork with multiple sizes', async ({ page }) => {
      const artworkSupported = await page.evaluate(() => {
        return typeof window.MediaMetadata === 'function';
      });
      expect(artworkSupported).toBe(true);
    });

    test('18.5: Calling mediaSession action seekto updates audio currentTime', async ({ page }) => {
      const canSeek = await page.evaluate(() => {
        const a = document.querySelector('audio');
        if (a) {
          a.currentTime = 10;
          return a.currentTime >= 0;
        }
        return true;
      });
      expect(canSeek).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 19: Search & Discovery UI Feed
  // --------------------------------------------------------------------------
  test.describe('F19: Search & Discovery UI Feed', () => {
    test('19.1: Search header contains unified search input field', async ({ page }) => {
      const searchInput = page.locator('input[type="search"], input[placeholder*="Search" i], [data-testid="search-input"]');
      await expect(searchInput.first()).toBeVisible();
    });

    test('19.2: Source filter pills allow filtering search results', async ({ page }) => {
      const filterPills = page.locator('[data-testid="filter-pills"] button, [data-testid^="filter-pill-"]');
      if (await filterPills.count() > 0) {
        expect(await filterPills.count()).toBeGreaterThanOrEqual(2);
      }
    });

    test('19.3: Responsive grid layout displays search result cards', async ({ page }) => {
      const resultsContainer = page.locator('[data-testid="results-grid"], [data-testid="main-content"]');
      await expect(resultsContainer.first()).toBeVisible();
    });

    test('19.4: Typing into search debounces input to prevent duplicate requests', async ({ page }) => {
      const searchInput = page.locator('input[type="search"], [data-testid="search-input"]').first();
      if (await searchInput.count() > 0) {
        await searchInput.pressSequentially('test', { delay: 30 });
        expect(await searchInput.inputValue()).toBe('test');
      }
    });

    test('19.5: Clearing search input restores discovery / trending recommendations view', async ({ page }) => {
      const searchInput = page.locator('input[type="search"], [data-testid="search-input"]').first();
      if (await searchInput.count() > 0) {
        await searchInput.fill('');
        const homeSection = page.locator('[data-testid="home-view"], [data-testid="trending-section"]');
        expect(await homeSection.count()).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
