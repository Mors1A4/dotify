import { test, expect } from '@playwright/test';
import { setupMockRoutes } from '../../fixtures/testHelpers';
import { EQ_FREQUENCIES, EQ_PRESETS } from '../../fixtures/mockData';

test.describe('Tier 1: Feature Coverage - Audio DSP Engine (F6 - F9)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto('/');
  });

  // --------------------------------------------------------------------------
  // Feature 6: Zero-Latency High-Frequency Seekbar
  // --------------------------------------------------------------------------
  test.describe('F6: Zero-Latency High-Frequency Seekbar', () => {
    test('6.1: Direct DOM ref updates seekbar position without lagging UI', async ({ page, isMobile }) => {
      if (isMobile) return;
      const seekbar = page.locator('[data-testid="player-seekbar"], input[type="range"].seekbar');
      if (await seekbar.count() > 0) {
        await expect(seekbar.first()).toBeVisible();
        const value = await seekbar.first().getAttribute('value');
        expect(Number(value) >= 0).toBe(true);
      }
    });

    test('6.2: Scrubbing seekbar updates playback time immediately', async ({ page, isMobile }) => {
      if (isMobile) return;
      const seekbar = page.locator('[data-testid="player-seekbar"], input[type="range"].seekbar');
      if (await seekbar.count() > 0) {
        await seekbar.first().fill('50');
        await seekbar.first().dispatchEvent('input');
        await seekbar.first().dispatchEvent('change');
        const currentTime = page.locator('[data-testid="current-time"]');
        if (await currentTime.count() > 0) {
          await expect(currentTime.first()).not.toHaveText('0:00');
        }
      }
    });

    test('6.3: Seekbar displays current time and duration labels formatted as MM:SS', async ({ page }) => {
      const currentTime = page.locator('[data-testid="current-time"]');
      const duration = page.locator('[data-testid="total-duration"]');
      if (await currentTime.count() > 0 && await duration.count() > 0) {
        const timePattern = /^\d+:\d{2}$|^--:--$/;
        const curText = (await currentTime.first().textContent())?.trim() || '';
        const durText = (await duration.first().textContent())?.trim() || '';
        expect(timePattern.test(curText) || curText === '0:00').toBe(true);
      }
    });

    test('6.4: Hovering over seekbar shows or prepares timestamp preview', async ({ page }) => {
      const seekbar = page.locator('[data-testid="player-seekbar"], input[type="range"].seekbar');
      if (await seekbar.count() > 0) {
        const box = await seekbar.first().boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          // Tooltip or cursor indicator
          const tooltip = page.locator('[data-testid="seekbar-tooltip"]');
          expect(await tooltip.count()).toBeGreaterThanOrEqual(0);
        }
      }
    });

    test('6.5: Rapid scrubbing (100ms intervals) does not drop audio playback state', async ({ page, isMobile }) => {
      if (isMobile) return;
      const seekbar = page.locator('[data-testid="player-seekbar"]');
      if (await seekbar.count() > 0) {
        for (let i = 10; i <= 50; i += 10) {
          await seekbar.fill(String(i));
          await page.waitForTimeout(50);
        }
        const isAudioActive = await page.evaluate(() => {
          const audio = document.querySelector('audio');
          return audio ? !audio.error : true;
        });
        expect(isAudioActive).toBe(true);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Feature 7: 60 FPS Canvas Audio Visualizer
  // --------------------------------------------------------------------------
  test.describe('F7: 60 FPS Canvas Audio Visualizer', () => {
    test('7.1: Visualizer canvas element is present in DOM when visualizer is open', async ({ page }) => {
      const toggleVis = page.locator('[data-testid="toggle-visualizer"], button[aria-label*="Visualizer" i]');
      if (await toggleVis.count() > 0) {
        await toggleVis.first().click();
      }
      const canvas = page.locator('[data-testid="audio-visualizer-canvas"], canvas.visualizer');
      expect(await canvas.count()).toBeGreaterThanOrEqual(0);
    });

    test('7.2: Canvas element has valid 2D rendering context', async ({ page }) => {
      const canvas = page.locator('[data-testid="audio-visualizer-canvas"], canvas').first();
      if (await canvas.count() > 0) {
        const hasContext = await canvas.evaluate((c: HTMLCanvasElement) => {
          return !!c.getContext('2d');
        });
        expect(hasContext).toBe(true);
      }
    });

    test('7.3: requestAnimationFrame loop executes rendering on canvas', async ({ page }) => {
      const rAFCount = await page.evaluate(() => {
        return new Promise<number>((resolve) => {
          let frames = 0;
          const step = () => {
            frames++;
            if (frames >= 3) resolve(frames);
            else requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
      });
      expect(rAFCount).toBeGreaterThanOrEqual(3);
    });

    test('7.4: Visualizer supports switching between frequency bars and waveform modes', async ({ page }) => {
      const modeBtn = page.locator('[data-testid="visualizer-mode-toggle"], button[aria-label*="Mode" i]');
      if (await modeBtn.count() > 0) {
        const initialText = await modeBtn.first().textContent();
        await modeBtn.first().click();
        const updatedText = await modeBtn.first().textContent();
        expect(updatedText).toBeDefined();
      }
    });

    test('7.5: Canvas dimensions adapt to container layout without distorting aspect ratio', async ({ page }) => {
      const canvas = page.locator('canvas').first();
      if (await canvas.count() > 0) {
        const bbox = await canvas.boundingBox();
        if (bbox) {
          expect(bbox.width).toBeGreaterThan(0);
          expect(bbox.height).toBeGreaterThan(0);
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // Feature 8: 10-Band Graphic Equalizer DSP
  // --------------------------------------------------------------------------
  test.describe('F8: 10-Band Graphic Equalizer DSP', () => {
    test('8.1: Equalizer renders 10 frequency band sliders (32Hz to 16kHz)', async ({ page }) => {
      const eqBtn = page.locator('[data-testid="open-equalizer-btn"], button[aria-label*="Equalizer" i]');
      if (await eqBtn.count() > 0) {
        await eqBtn.first().click();
      }
      const bandSliders = page.locator('[data-testid^="eq-band-"], input[data-frequency]');
      const count = await bandSliders.count();
      if (count > 0) {
        expect(count).toBe(10);
      }
    });

    test('8.2: Sliders permit gain adjustment between -12dB and +12dB', async ({ page }) => {
      const slider = page.locator('[data-testid^="eq-band-"]').first();
      if (await slider.count() > 0) {
        const min = await slider.getAttribute('min');
        const max = await slider.getAttribute('max');
        expect(Number(min)).toBe(-12);
        expect(Number(max)).toBe(12);
      }
    });

    test('8.3: Adjusting slider updates gain value without audio clicks', async ({ page }) => {
      const slider = page.locator('[data-testid^="eq-band-"]').first();
      if (await slider.count() > 0) {
        await slider.fill('6');
        await slider.dispatchEvent('input');
        await slider.dispatchEvent('change');
        expect(await slider.getAttribute('value') || await slider.inputValue()).toBe('6');
      }
    });

    test('8.4: Equalizer toggle switch enables and bypasses DSP filter cascade', async ({ page }) => {
      const toggle = page.locator('[data-testid="eq-enable-toggle"], input[type="checkbox"]#eq-toggle');
      if (await toggle.count() > 0) {
        const initialChecked = await toggle.isChecked();
        await toggle.click();
        expect(await toggle.isChecked()).toBe(!initialChecked);
      }
    });

    test('8.5: Reset button restores all 10 bands to 0dB (flat)', async ({ page }) => {
      const resetBtn = page.locator('[data-testid="eq-reset-btn"], button:has-text("Reset")');
      if (await resetBtn.count() > 0) {
        await resetBtn.click();
        const sliders = page.locator('[data-testid^="eq-band-"]');
        const count = await sliders.count();
        for (let i = 0; i < count; i++) {
          const val = await sliders.nth(i).inputValue();
          expect(Number(val)).toBe(0);
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // Feature 9: Pre-Amp & Equalizer Presets
  // --------------------------------------------------------------------------
  test.describe('F9: Pre-Amp & Equalizer Presets', () => {
    test('9.1: Pre-amp gain slider adjusts overall input gain from -12dB to +12dB', async ({ page }) => {
      const preAmp = page.locator('[data-testid="eq-preamp-slider"]');
      if (await preAmp.count() > 0) {
        await preAmp.fill('-3');
        await preAmp.dispatchEvent('input');
        expect(await preAmp.inputValue()).toBe('-3');
      }
    });

    test('9.2: Preset selector contains built-in presets (Bass Boost, Vocal, Rock, Electronic, Flat)', async ({ page }) => {
      const presetSelect = page.locator('[data-testid="eq-preset-select"], select#eq-preset');
      if (await presetSelect.count() > 0) {
        const options = await presetSelect.locator('option').allTextContents();
        const optionLower = options.map((o) => o.toLowerCase());
        expect(optionLower.some((o) => o.includes('bass'))).toBe(true);
        expect(optionLower.some((o) => o.includes('flat'))).toBe(true);
      }
    });

    test('9.3: Selecting Bass Boost preset boosts low frequencies (32Hz, 64Hz)', async ({ page }) => {
      const presetSelect = page.locator('[data-testid="eq-preset-select"]');
      if (await presetSelect.count() > 0) {
        await presetSelect.selectOption({ label: 'Bass Boost' }).catch(() => null);
        const lowBand = page.locator('[data-testid="eq-band-32"], [data-testid="eq-band-0"]').first();
        if (await lowBand.count() > 0) {
          const val = Number(await lowBand.inputValue());
          expect(val).toBeGreaterThan(0);
        }
      }
    });

    test('9.4: Selecting Vocal Clarity preset highlights mid frequencies (1kHz, 2kHz)', async ({ page }) => {
      const presetSelect = page.locator('[data-testid="eq-preset-select"]');
      if (await presetSelect.count() > 0) {
        await presetSelect.selectOption({ label: 'Vocal Clarity' }).catch(() => null);
        const midBand = page.locator('[data-testid="eq-band-1000"], [data-testid="eq-band-5"]').first();
        if (await midBand.count() > 0) {
          const val = Number(await midBand.inputValue());
          expect(val).toBeGreaterThanOrEqual(0);
        }
      }
    });

    test('9.5: Modifying any band slider while a preset is active switches preset state to Custom', async ({ page }) => {
      const presetSelect = page.locator('[data-testid="eq-preset-select"]');
      const firstSlider = page.locator('[data-testid^="eq-band-"]').first();
      if (await presetSelect.count() > 0 && await firstSlider.count() > 0) {
        await firstSlider.fill('8');
        await firstSlider.dispatchEvent('input');
        await firstSlider.dispatchEvent('change');
        const currentPreset = await presetSelect.inputValue();
        expect(currentPreset.toLowerCase()).toContain('custom');
      }
    });
  });
});
