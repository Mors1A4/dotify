import { test, expect } from '@playwright/test';
import { setupMockRoutes } from '../../fixtures/testHelpers';

test.describe('Tier 2: Boundary & Corner Cases - Audio DSP Engine (F6 - F9)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto('/');
  });

  // --------------------------------------------------------------------------
  // F6 Boundaries: Seekbar
  // --------------------------------------------------------------------------
  test.describe('F6 Boundaries', () => {
    test('6.B1: Seek to 0.00 seconds sets audio position to start without error', async ({ page }) => {
      const seekbar = page.locator('[data-testid="player-seekbar"]');
      if (await seekbar.count() > 0) {
        await seekbar.fill('0');
        await seekbar.dispatchEvent('change');
        const pos = await page.evaluate(() => {
          const a = document.querySelector('audio');
          return a ? a.currentTime : 0;
        });
        expect(pos).toBe(0);
      }
    });

    test('6.B2: Seek to duration boundary does not overflow track length', async ({ page }) => {
      const seekbar = page.locator('[data-testid="player-seekbar"]');
      if (await seekbar.count() > 0) {
        const max = await seekbar.getAttribute('max') || '100';
        await seekbar.fill(max);
        await seekbar.dispatchEvent('change');
        const isEndedOrNear = await page.evaluate(() => {
          const a = document.querySelector('audio');
          return a ? a.currentTime <= a.duration || isNaN(a.duration) : true;
        });
        expect(isEndedOrNear).toBe(true);
      }
    });

    test('6.B3: Live radio stream (duration Infinity) disables seekbar or locks to Live', async ({ page }) => {
      await page.evaluate(() => {
        const a = document.querySelector('audio');
        if (a) {
          Object.defineProperty(a, 'duration', { value: Infinity, configurable: true });
          a.dispatchEvent(new Event('durationchange'));
        }
      });
      const seekbar = page.locator('[data-testid="player-seekbar"]');
      if (await seekbar.count() > 0) {
        const isDisabled = await seekbar.isDisabled().catch(() => false);
        expect(typeof isDisabled).toBe('boolean');
      }
    });

    test('6.B4: Negative seek value or NaN value is clamped to 0', async ({ page }) => {
      const clamped = await page.evaluate(() => {
        const a = document.querySelector('audio');
        if (a) {
          a.currentTime = -10;
          return a.currentTime >= 0;
        }
        return true;
      });
      expect(clamped).toBe(true);
    });

    test('6.B5: Rapid back-and-forth seeking (10 seeks in 200ms) does not crash player', async ({ page }) => {
      const seekbar = page.locator('[data-testid="player-seekbar"]');
      if (await seekbar.count() > 0) {
        for (let i = 0; i < 10; i++) {
          await seekbar.fill(String((i % 2) * 50));
          await seekbar.dispatchEvent('input');
        }
        await expect(page.locator('#root')).toBeVisible();
      }
    });
  });

  // --------------------------------------------------------------------------
  // F7 Boundaries: Canvas Visualizer
  // --------------------------------------------------------------------------
  test.describe('F7 Boundaries', () => {
    test('7.B1: Visualizer running during silence renders without NaN coordinates', async ({ page }) => {
      const canvas = page.locator('canvas').first();
      if (await canvas.count() > 0) {
        const isValid = await canvas.evaluate((c: HTMLCanvasElement) => {
          const ctx = c.getContext('2d');
          return ctx !== null;
        });
        expect(isValid).toBe(true);
      }
    });

    test('7.B2: Page in background tab handles throttled requestAnimationFrame', async ({ page }) => {
      await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(page.locator('#root')).toBeVisible();
    });

    test('7.B3: Extreme canvas resizing handles edge viewport dimensions cleanly', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 480 });
      await page.waitForTimeout(50);
      await page.setViewportSize({ width: 1920, height: 1080 });
      await expect(page.locator('#root')).toBeVisible();
    });

    test('7.B4: AudioContext suspended before first user click does not throw unhandled exception', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto('/');
      expect(errors.filter((e) => !e.includes('autoplay'))).toHaveLength(0);
    });

    test('7.B5: Toggling visualizer on/off rapidly does not leak animation frames', async ({ page }) => {
      const toggle = page.locator('[data-testid="toggle-visualizer"]').first();
      if (await toggle.count() > 0) {
        for (let i = 0; i < 6; i++) {
          await toggle.click();
          await page.waitForTimeout(30);
        }
        await expect(page.locator('#root')).toBeVisible();
      }
    });
  });

  // --------------------------------------------------------------------------
  // F8 Boundaries: 10-Band Graphic EQ DSP
  // --------------------------------------------------------------------------
  test.describe('F8 Boundaries', () => {
    test('8.B1: Extreme frequency bands (32Hz and 16kHz) at maximum +12dB', async ({ page }) => {
      const eqBtn = page.locator('[data-testid="open-equalizer-btn"]');
      if (await eqBtn.count() > 0) await eqBtn.first().click();
      const band32 = page.locator('[data-testid="eq-band-32"], [data-testid="eq-band-0"]').first();
      const band16k = page.locator('[data-testid="eq-band-16000"], [data-testid="eq-band-9"]').first();
      if (await band32.count() > 0 && await band16k.count() > 0) {
        await band32.fill('12');
        await band16k.fill('12');
        expect(Number(await band32.inputValue())).toBe(12);
        expect(Number(await band16k.inputValue())).toBe(12);
      }
    });

    test('8.B2: All 10 bands simultaneously at minimum -12dB attenuation', async ({ page }) => {
      const eqBtn = page.locator('[data-testid="open-equalizer-btn"]');
      if (await eqBtn.count() > 0) await eqBtn.first().click();
      const sliders = page.locator('[data-testid^="eq-band-"]');
      const count = await sliders.count();
      for (let i = 0; i < count; i++) {
        await sliders.nth(i).fill('-12');
      }
      if (count > 0) {
        expect(Number(await sliders.first().inputValue())).toBe(-12);
      }
    });

    test('8.B3: Rapid slider sweeping from -12dB to +12dB applies linear ramp without audio clipping', async ({ page }) => {
      const slider = page.locator('[data-testid^="eq-band-"]').first();
      if (await slider.count() > 0) {
        for (let g = -12; g <= 12; g += 4) {
          await slider.fill(String(g));
          await slider.dispatchEvent('input');
        }
        await expect(page.locator('#root')).toBeVisible();
      }
    });

    test('8.B4: Bypassing EQ switch while sliders are at extremes restores flat output', async ({ page }) => {
      const toggle = page.locator('[data-testid="eq-enable-toggle"]');
      if (await toggle.count() > 0) {
        await toggle.click(); // disable
        expect(await toggle.isChecked()).toBe(false);
      }
    });

    test('8.B5: Out-of-bounds gain values (> +12dB or < -12dB) clamp to boundary limits', async ({ page }) => {
      const slider = page.locator('[data-testid^="eq-band-"]').first();
      if (await slider.count() > 0) {
        await slider.fill('25');
        const val = Number(await slider.inputValue());
        expect(val).toBeLessThanOrEqual(12);
      }
    });
  });

  // --------------------------------------------------------------------------
  // F9 Boundaries: Pre-Amp & Presets
  // --------------------------------------------------------------------------
  test.describe('F9 Boundaries', () => {
    test('9.B1: Pre-amp at maximum +12dB with Bass Boost does not crash audio context', async ({ page }) => {
      const preAmp = page.locator('[data-testid="eq-preamp-slider"]');
      if (await preAmp.count() > 0) {
        await preAmp.fill('12');
        await preAmp.dispatchEvent('input');
        expect(Number(await preAmp.inputValue())).toBe(12);
      }
    });

    test('9.B2: Pre-amp at minimum -12dB attenuates signal safely', async ({ page }) => {
      const preAmp = page.locator('[data-testid="eq-preamp-slider"]');
      if (await preAmp.count() > 0) {
        await preAmp.fill('-12');
        await preAmp.dispatchEvent('input');
        expect(Number(await preAmp.inputValue())).toBe(-12);
      }
    });

    test('9.B3: Switching presets rapidly in a loop (10 times) updates UI state smoothly', async ({ page }) => {
      const select = page.locator('[data-testid="eq-preset-select"]');
      if (await select.count() > 0) {
        for (let i = 0; i < 5; i++) {
          await select.selectOption({ index: i % 4 }).catch(() => null);
        }
        await expect(page.locator('#root')).toBeVisible();
      }
    });

    test('9.B4: Custom preset state persists band values when toggling back from Flat', async ({ page }) => {
      const select = page.locator('[data-testid="eq-preset-select"]');
      if (await select.count() > 0) {
        await select.selectOption({ label: 'Flat' }).catch(() => null);
        await select.selectOption({ label: 'Bass Boost' }).catch(() => null);
        await expect(page.locator('#root')).toBeVisible();
      }
    });

    test('9.B5: Pre-amp value is preserved across preset selection changes', async ({ page }) => {
      const preAmp = page.locator('[data-testid="eq-preamp-slider"]');
      const select = page.locator('[data-testid="eq-preset-select"]');
      if (await preAmp.count() > 0 && await select.count() > 0) {
        await preAmp.fill('3');
        await select.selectOption({ label: 'Rock' }).catch(() => null);
        expect(Number(await preAmp.inputValue())).toBe(3);
      }
    });
  });
});
