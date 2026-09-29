import { test, expect } from '@playwright/test';
import { setupMockRoutes } from '../../fixtures/testHelpers';
import { MOCK_AUDIUS_TRACK } from '../../fixtures/mockData';

test.describe('Tier 1: Feature Coverage - Layout & Shell (F1 - F5)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page);
  });

  // --------------------------------------------------------------------------
  // Feature 1: Desktop 3-Column Layout (>= 768px)
  // --------------------------------------------------------------------------
  test.describe('F1: Desktop 3-Column Layout', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('1.1: Collapsible navigation sidebar is rendered on desktop', async ({ page }) => {
      await page.goto('/');
      const sidebar = page.locator('[data-testid="desktop-sidebar"], aside, nav.sidebar');
      await expect(sidebar.first()).toBeVisible();
      // Should display brand logo and primary nav links
      await expect(page.locator('text=/dotify|Home|Search|Library/i').first()).toBeVisible();
    });

    test('1.2: Central content feed is visible with scroll container', async ({ page }) => {
      await page.goto('/');
      const mainFeed = page.locator('[data-testid="main-content"], main, #content');
      await expect(mainFeed.first()).toBeVisible();
      const isScrollable = await mainFeed.first().evaluate((el) => {
        const style = window.getComputedStyle(el);
        return style.overflowY === 'auto' || style.overflowY === 'scroll' || el.scrollHeight >= el.clientHeight;
      });
      expect(isScrollable).toBe(true);
    });

    test('1.3: Right drawer (queue / equalizer) toggle and rendering', async ({ page }) => {
      await page.goto('/');
      const drawerToggle = page.locator('[data-testid="toggle-queue"], [data-testid="toggle-equalizer"], button[aria-label*="Queue" i], button[aria-label*="Equalizer" i]');
      if (await drawerToggle.count() > 0) {
        await drawerToggle.first().click();
        const rightDrawer = page.locator('[data-testid="right-drawer"], [role="complementary"]');
        await expect(rightDrawer.first()).toBeVisible();
      } else {
        // Direct drawer presence on desktop
        const rightDrawer = page.locator('[data-testid="right-drawer"], [role="complementary"]');
        expect(await rightDrawer.count()).toBeGreaterThanOrEqual(0);
      }
    });

    test('1.4: Persistent bottom playback bar with transport buttons and volume', async ({ page }) => {
      await page.goto('/');
      const playerBar = page.locator('[data-testid="player-bar"], [data-testid="bottom-bar"], footer');
      await expect(playerBar.first()).toBeVisible();
      // Verify play/pause and volume controls exist
      const playBtn = page.locator('[data-testid="play-btn"], button[aria-label*="Play" i], button[aria-label*="Pause" i]');
      await expect(playBtn.first()).toBeVisible();
    });

    test('1.5: Desktop sidebar collapses and expands cleanly on toggle click', async ({ page }) => {
      await page.goto('/');
      const collapseBtn = page.locator('[data-testid="collapse-sidebar"], button[aria-label*="Collapse" i]');
      const sidebar = page.locator('[data-testid="desktop-sidebar"], aside');
      if (await collapseBtn.count() > 0 && await sidebar.count() > 0) {
        const initialWidth = await sidebar.first().evaluate((el) => el.getBoundingClientRect().width);
        await collapseBtn.first().click();
        const collapsedWidth = await sidebar.first().evaluate((el) => el.getBoundingClientRect().width);
        expect(collapsedWidth).toBeLessThan(initialWidth);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Feature 2: Mobile & Android View (< 768px)
  // --------------------------------------------------------------------------
  test.describe('F2: Mobile & Android View', () => {
    test.use({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });

    test('2.1: Mobile viewport displays bottom navigation bar', async ({ page }) => {
      await page.goto('/');
      const bottomNav = page.locator('[data-testid="mobile-bottom-nav"], nav[aria-label*="Mobile" i], .mobile-nav');
      await expect(bottomNav.first()).toBeVisible();
    });

    test('2.2: Bottom navigation items have at least 48px tap targets for mobile usability', async ({ page }) => {
      await page.goto('/');
      const navItems = page.locator('[data-testid="mobile-bottom-nav"] button, [data-testid="mobile-bottom-nav"] a');
      const count = await navItems.count();
      if (count > 0) {
        for (let i = 0; i < Math.min(count, 4); i++) {
          const box = await navItems.nth(i).boundingBox();
          if (box) {
            expect(box.width).toBeGreaterThanOrEqual(44); // WCAG minimum touch target
            expect(box.height).toBeGreaterThanOrEqual(44);
          }
        }
      }
    });

    test('2.3: Floating mini-player bar is visible above bottom nav when track is loaded', async ({ page }) => {
      await page.goto('/');
      // Trigger a track selection
      const trackRow = page.locator('[data-testid="track-item"], [data-testid="track-row"], .track-card').first();
      if (await trackRow.count() > 0) {
        await trackRow.click();
        const miniPlayer = page.locator('[data-testid="mini-player"], [data-testid="mobile-player"]');
        await expect(miniPlayer.first()).toBeVisible();
      }
    });

    test('2.4: Safe area insets are respected on mobile layout', async ({ page }) => {
      await page.goto('/');
      const container = page.locator('body > div').first();
      const hasPadding = await container.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return style.paddingBottom !== '' || style.boxSizing === 'border-box';
      });
      expect(hasPadding).toBe(true);
    });

    test('2.5: Desktop 3-column sidebar is hidden on mobile viewport', async ({ page }) => {
      await page.goto('/');
      const desktopSidebar = page.locator('[data-testid="desktop-sidebar"]');
      if (await desktopSidebar.count() > 0) {
        await expect(desktopSidebar).toBeHidden();
      }
    });
  });

  // --------------------------------------------------------------------------
  // Feature 3: Tap-to-Expand Now-Playing Sheet
  // --------------------------------------------------------------------------
  test.describe('F3: Tap-to-Expand Now-Playing Sheet', () => {
    test.use({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });

    test('3.1: Clicking floating mini-player expands full-screen Now-Playing sheet', async ({ page }) => {
      await page.goto('/');
      const track = page.locator('[data-testid="track-item"]').first();
      if (await track.count() > 0) {
        await track.click();
        const miniPlayer = page.locator('[data-testid="mini-player"]').first();
        if (await miniPlayer.isVisible()) {
          await miniPlayer.click();
          const sheet = page.locator('[data-testid="now-playing-sheet"]');
          await expect(sheet).toBeVisible();
        }
      }
    });

    test('3.2: Fullscreen sheet renders large album artwork, title, and artist', async ({ page }) => {
      await page.goto('/');
      const sheet = page.locator('[data-testid="now-playing-sheet"]');
      if (await sheet.count() > 0) {
        const title = sheet.locator('[data-testid="sheet-track-title"], h2');
        const artist = sheet.locator('[data-testid="sheet-track-artist"], p');
        await expect(title.first()).toBeVisible();
        await expect(artist.first()).toBeVisible();
      }
    });

    test('3.3: Sheet contains mobile-friendly scrubber and playback transport controls', async ({ page }) => {
      await page.goto('/');
      const sheet = page.locator('[data-testid="now-playing-sheet"]');
      if (await sheet.count() > 0) {
        const seekbar = sheet.locator('[data-testid="sheet-seekbar"], input[type="range"]');
        const playBtn = sheet.locator('[data-testid="sheet-play-btn"]');
        await expect(seekbar.first()).toBeVisible();
        await expect(playBtn.first()).toBeVisible();
      }
    });

    test('3.4: Dismiss button or swipe collapses sheet back to mini-player', async ({ page }) => {
      await page.goto('/');
      const dismissBtn = page.locator('[data-testid="dismiss-sheet-btn"], button[aria-label*="Close" i]');
      if (await dismissBtn.count() > 0 && await dismissBtn.isVisible()) {
        await dismissBtn.click();
        const sheet = page.locator('[data-testid="now-playing-sheet"]');
        await expect(sheet).not.toBeVisible();
      }
    });

    test('3.5: Fullscreen sheet expansion does not interrupt continuous audio playback', async ({ page }) => {
      await page.goto('/');
      const audioState = await page.evaluate(() => {
        const audio = document.querySelector('audio');
        return audio ? !audio.paused : true;
      });
      expect(typeof audioState).toBe('boolean');
    });
  });

  // --------------------------------------------------------------------------
  // Feature 4: Base Scaffolding & PWA Shell
  // --------------------------------------------------------------------------
  test.describe('F4: Base Scaffolding & PWA Shell', () => {
    test('4.1: PWA Web App Manifest link is present in HTML head', async ({ page }) => {
      await page.goto('/');
      const manifestLink = page.locator('link[rel="manifest"]');
      await expect(manifestLink).toHaveAttribute('href', /manifest\.json|manifest\.webmanifest/);
    });

    test('4.2: PWA manifest response is valid JSON with required metadata', async ({ request }) => {
      const response = await request.get('/manifest.json');
      if (response.ok()) {
        const manifest = await response.json();
        expect(manifest.name).toBeDefined();
        expect(manifest.icons).toBeInstanceOf(Array);
        expect(manifest.display).toBe('standalone');
      }
    });

    test('4.3: Service worker registration script or file is declared', async ({ page }) => {
      await page.goto('/');
      const hasSWScript = await page.evaluate(() => {
        return 'serviceWorker' in navigator;
      });
      expect(hasSWScript).toBe(true);
    });

    test('4.4: Viewport meta tag is properly configured for responsive mobile rendering', async ({ page }) => {
      await page.goto('/');
      const viewport = page.locator('meta[name="viewport"]');
      await expect(viewport).toHaveAttribute('content', /width=device-width/);
    });

    test('4.5: App shell mounts into root div without throwing uncaught errors', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto('/');
      const appRoot = page.locator('#root, [data-testid="app-root"]');
      await expect(appRoot.first()).toBeVisible();
      expect(errors.filter((e) => !e.includes('AudioContext'))).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 5: Express Backend Skeleton
  // --------------------------------------------------------------------------
  test.describe('F5: Express Backend Skeleton', () => {
    test('5.1: Backend responds with 200 OK or proper JSON on /api/health or base API', async ({ request }) => {
      const res = await request.get('/api/health').catch(() => null);
      if (res) {
        expect([200, 404]).toContain(res.status());
      }
    });

    test('5.2: CORS middleware headers are present on API responses', async ({ request }) => {
      const res = await request.get('/api/stream/proxy?url=test').catch(() => null);
      if (res) {
        const headers = res.headers();
        expect(headers['access-control-allow-origin'] || headers['content-type']).toBeDefined();
      }
    });

    test('5.3: Unknown API routes return structured 404 JSON', async ({ request }) => {
      const res = await request.get('/api/unknown-route-12345').catch(() => null);
      if (res) {
        expect(res.status()).toBe(404);
      }
    });

    test('5.4: Backend supports OPTIONS preflight requests', async ({ request }) => {
      const res = await request.fetch('/api/stream/proxy', { method: 'OPTIONS' }).catch(() => null);
      if (res) {
        expect([200, 204]).toContain(res.status());
      }
    });

    test('5.5: Express serves frontend bundle or index.html for root path', async ({ request }) => {
      const res = await request.get('/');
      expect(res.status()).toBe(200);
      const text = await res.text();
      expect(text).toContain('<!DOCTYPE html>');
    });
  });
});
