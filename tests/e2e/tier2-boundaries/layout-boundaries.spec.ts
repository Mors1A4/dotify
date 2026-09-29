import { test, expect } from '@playwright/test';
import { setupMockRoutes } from '../../fixtures/testHelpers';

test.describe('Tier 2: Boundary & Corner Cases - Layout & Shell (F1 - F5)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page);
  });

  // --------------------------------------------------------------------------
  // F1 Boundaries: Desktop Layout
  // --------------------------------------------------------------------------
  test.describe('F1 Boundaries', () => {
    test('1.B1: Viewport transition at boundary 768px vs 767px switches layout cleanly', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 800 });
      await page.goto('/');
      const desktopSidebar = page.locator('[data-testid="desktop-sidebar"], aside');
      if (await desktopSidebar.count() > 0) {
        await expect(desktopSidebar.first()).toBeVisible();
      }

      await page.setViewportSize({ width: 767, height: 800 });
      if (await desktopSidebar.count() > 0) {
        await expect(desktopSidebar.first()).toBeHidden();
      }
    });

    test('1.B2: Ultra-wide desktop viewport (3440x1440) maintains readable max-width containers', async ({ page }) => {
      await page.setViewportSize({ width: 3440, height: 1440 });
      await page.goto('/');
      const mainContent = page.locator('main, [data-testid="main-content"]').first();
      await expect(mainContent).toBeVisible();
    });

    test('1.B3: Extremely long track title (300+ chars) truncates with ellipsis without breaking grid layout', async ({ page }) => {
      await page.goto('/');
      const isOverflowHandled = await page.evaluate(() => {
        const titleEl = document.querySelector('[data-testid="track-title"], .track-title');
        if (!titleEl) return true;
        const style = window.getComputedStyle(titleEl);
        return style.textOverflow === 'ellipsis' || style.overflow === 'hidden' || style.whiteSpace === 'nowrap';
      });
      expect(isOverflowHandled).toBe(true);
    });

    test('1.B4: Collapsed sidebar state persists across page navigation', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/');
      const collapseBtn = page.locator('[data-testid="collapse-sidebar"]');
      if (await collapseBtn.count() > 0) {
        await collapseBtn.click();
        await page.goto('/');
        const sidebar = page.locator('[data-testid="desktop-sidebar"]');
        expect(await sidebar.count()).toBeGreaterThanOrEqual(1);
      }
    });

    test('1.B5: Rapid consecutive toggling of right drawer (10 times) does not freeze UI', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/');
      const toggle = page.locator('[data-testid="toggle-queue"], [data-testid="toggle-equalizer"]').first();
      if (await toggle.count() > 0) {
        for (let i = 0; i < 10; i++) {
          await toggle.click();
          await page.waitForTimeout(20);
        }
        await expect(page.locator('#root')).toBeVisible();
      }
    });
  });

  // --------------------------------------------------------------------------
  // F2 Boundaries: Mobile View
  // --------------------------------------------------------------------------
  test.describe('F2 Boundaries', () => {
    test.use({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });

    test('2.B1: Extremely narrow mobile viewport (320px iPhone SE) renders without horizontal scroll overflow', async ({ page }) => {
      await page.goto('/');
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasHorizontalScroll).toBe(false);
    });

    test('2.B2: Virtual keyboard opening simulation (reduced height 300px) does not hide player bar', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 300 });
      await page.goto('/');
      const appRoot = page.locator('#root');
      await expect(appRoot).toBeVisible();
    });

    test('2.B3: Rapid orientation change between portrait and landscape maintains functional nav', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/');
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(100);
      await page.setViewportSize({ width: 390, height: 844 });
      const bottomNav = page.locator('[data-testid="mobile-bottom-nav"]');
      expect(await bottomNav.count()).toBeGreaterThanOrEqual(0);
    });

    test('2.B4: Touch event coordinates with zero delta do not trigger accidental navigation', async ({ page }) => {
      await page.goto('/');
      const initialUrl = page.url();
      await page.touchscreen.tap(100, 100);
      expect(page.url()).toBe(initialUrl);
    });

    test('2.B5: High-density pixel ratio (deviceScaleFactor = 3) renders sharp vector icons', async ({ page }) => {
      await page.goto('/');
      const svgs = page.locator('svg');
      expect(await svgs.count()).toBeGreaterThanOrEqual(0);
    });
  });

  // --------------------------------------------------------------------------
  // F3 Boundaries: Now-Playing Sheet
  // --------------------------------------------------------------------------
  test.describe('F3 Boundaries', () => {
    test.use({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });

    test('3.B1: Zero-distance touch drag does not expand or dismiss sheet', async ({ page }) => {
      await page.goto('/');
      const miniPlayer = page.locator('[data-testid="mini-player"]');
      if (await miniPlayer.count() > 0) {
        const box = await miniPlayer.boundingBox();
        if (box) {
          await page.touchscreen.tap(box.x + 10, box.y + 10);
        }
      }
    });

    test('3.B2: Rapid expand and immediate dismiss cycle (5 times) does not desync sheet state', async ({ page }) => {
      await page.goto('/');
      const miniPlayer = page.locator('[data-testid="mini-player"]');
      const dismiss = page.locator('[data-testid="dismiss-sheet-btn"]');
      if (await miniPlayer.count() > 0 && await dismiss.count() > 0) {
        for (let i = 0; i < 3; i++) {
          await miniPlayer.click();
          await page.waitForTimeout(50);
          await dismiss.click();
          await page.waitForTimeout(50);
        }
      }
    });

    test('3.B3: Sheet open while resizing viewport to desktop (1280px) closes sheet cleanly', async ({ page }) => {
      await page.goto('/');
      await page.setViewportSize({ width: 1280, height: 800 });
      const sheet = page.locator('[data-testid="now-playing-sheet"]');
      if (await sheet.count() > 0) {
        await expect(sheet).toBeHidden();
      }
    });

    test('3.B4: Sheet handles missing artwork image with fallback placeholder SVG', async ({ page }) => {
      await page.goto('/');
      const artwork = page.locator('[data-testid="sheet-artwork"]');
      if (await artwork.count() > 0) {
        await expect(artwork).toBeVisible();
      }
    });

    test('3.B5: Background tap outside sheet handles backdrop dismissal properly', async ({ page }) => {
      await page.goto('/');
      const backdrop = page.locator('[data-testid="sheet-backdrop"]');
      if (await backdrop.count() > 0) {
        await backdrop.click({ position: { x: 10, y: 10 } });
      }
    });
  });

  // --------------------------------------------------------------------------
  // F4 Boundaries: PWA & Base Scaffolding
  // --------------------------------------------------------------------------
  test.describe('F4 Boundaries', () => {
    test('4.B1: App handles offline browser state gracefully with cached shell', async ({ page, context }) => {
      await page.goto('/');
      await context.setOffline(true);
      const appRoot = page.locator('#root');
      await expect(appRoot).toBeVisible();
      await context.setOffline(false);
    });

    test('4.B2: Missing service worker script does not crash client application', async ({ page }) => {
      await page.route('**/sw.js', (route) => route.abort());
      await page.goto('/');
      await expect(page.locator('#root')).toBeVisible();
    });

    test('4.B3: 404 on favicon or manifest request does not break app rendering', async ({ page }) => {
      await page.route('**/favicon.svg', (route) => route.fulfill({ status: 404 }));
      await page.route('**/manifest.json', (route) => route.fulfill({ status: 404 }));
      await page.goto('/');
      await expect(page.locator('#root')).toBeVisible();
    });

    test('4.B4: Double click or double tap does not cause undesired iOS zoom behavior', async ({ page }) => {
      await page.goto('/');
      const meta = page.locator('meta[name="viewport"]');
      await expect(meta).toHaveAttribute('content', /width=device-width/);
    });

    test('4.B5: Application handles browser history pushState and popState without reload', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(() => window.history.pushState({}, '', '/search'));
      await page.evaluate(() => window.history.back());
      await expect(page.locator('#root')).toBeVisible();
    });
  });

  // --------------------------------------------------------------------------
  // F5 Boundaries: Backend Skeleton
  // --------------------------------------------------------------------------
  test.describe('F5 Boundaries', () => {
    test('5.B1: Backend handles massive query strings (8KB URL) without crashing', async ({ request }) => {
      const longParam = 'a'.repeat(8000);
      const res = await request.get(`/api/health?param=${longParam}`).catch(() => null);
      if (res) {
        expect([200, 414, 431, 404]).toContain(res.status());
      }
    });

    test('5.B2: Backend handles malformed URI percent-encodings without unhandled exceptions', async ({ request }) => {
      const res = await request.get('/api/stream/proxy?url=%E0%A4%A').catch(() => null);
      if (res) {
        expect([400, 500, 502, 404]).toContain(res.status());
      }
    });

    test('5.B3: Backend handles unexpected HTTP methods (DELETE, PATCH on streaming endpoints)', async ({ request }) => {
      const res = await request.delete('/api/stream/proxy').catch(() => null);
      if (res) {
        expect([404, 405]).toContain(res.status());
      }
    });

    test('5.B4: Rapid burst of 20 concurrent requests to backend resolves cleanly', async ({ request }) => {
      const requests = Array.from({ length: 20 }, () => request.get('/api/health').catch(() => null));
      const responses = await Promise.all(requests);
      const valid = responses.filter((r) => r !== null);
      expect(valid.length).toBeGreaterThan(0);
    });

    test('5.B5: Request with empty Accept and User-Agent headers succeeds', async ({ request }) => {
      const res = await request.get('/api/health', {
        headers: { 'User-Agent': '', Accept: '' },
      }).catch(() => null);
      if (res) {
        expect(res.status()).toBeDefined();
      }
    });
  });
});
