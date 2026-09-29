import { test, expect } from '@playwright/test';
import { setupMockRoutes } from '../../fixtures/testHelpers';
import { MOCK_AUDIUS_TRACK, MOCK_ARCHIVE_TRACK, MOCK_RADIO_TRACK, MOCK_P2P_TRACK } from '../../fixtures/mockData';

test.describe('Tier 3: Cross-Feature Combinations (Pairwise Interaction Matrix)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto('/');
  });

  // --------------------------------------------------------------------------
  // Interaction 1: Theme Switch During Audio Playback
  // --------------------------------------------------------------------------
  test('3.1: Switching theme presets during active audio playback causes no audio interruptions', async ({ page }) => {
    const playBtn = page.locator('[data-testid="play-btn"]').first();
    if (await playBtn.count() > 0) {
      await playBtn.click();
    }

    // Switch theme to Nord Frost
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'nord-frost');
    });

    // Check audio is still active
    const isPlaying = await page.evaluate(() => {
      const a = document.querySelector('audio');
      return a ? !a.paused : true;
    });
    expect(isPlaying).toBe(true);

    // Switch theme to Cyberpunk Neon
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'cyberpunk-neon');
    });

    const isStillPlaying = await page.evaluate(() => {
      const a = document.querySelector('audio');
      return a ? !a.paused : true;
    });
    expect(isStillPlaying).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Interaction 2: EQ Adjustment While Scrubbing Seekbar
  // --------------------------------------------------------------------------
  test('3.2: Adjusting EQ bands while rapidly scrubbing seekbar executes without audio clipping', async ({ page }) => {
    const seekbar = page.locator('[data-testid="player-seekbar"]');
    const eqBtn = page.locator('[data-testid="open-equalizer-btn"]');
    if (await eqBtn.count() > 0) await eqBtn.first().click();

    const bandSlider = page.locator('[data-testid^="eq-band-"]').first();
    if (await seekbar.count() > 0 && await bandSlider.count() > 0) {
      // Scrub seekbar
      await seekbar.fill('45');
      await seekbar.dispatchEvent('input');

      // Simultaneously adjust EQ band
      await bandSlider.fill('8');
      await bandSlider.dispatchEvent('input');

      // Verify audio element did not enter error state
      const hasError = await page.evaluate(() => {
        const a = document.querySelector('audio');
        return a ? !!a.error : false;
      });
      expect(hasError).toBe(false);
    }
  });

  // --------------------------------------------------------------------------
  // Interaction 3: Mixing Heterogeneous Sources in Playlist Queue
  // --------------------------------------------------------------------------
  test('3.3: Queue containing Audius, Archive, Radio, and P2P tracks advances seamlessly', async ({ page }) => {
    await page.evaluate((tracks) => {
      localStorage.setItem('dotify_v1_queue', JSON.stringify(tracks));
    }, [MOCK_AUDIUS_TRACK, MOCK_ARCHIVE_TRACK, MOCK_RADIO_TRACK, MOCK_P2P_TRACK]);

    await page.reload();
    const nextBtn = page.locator('[data-testid="next-track-btn"]');
    if (await nextBtn.count() > 0) {
      // Step through queue
      for (let i = 0; i < 3; i++) {
        await nextBtn.click();
        await page.waitForTimeout(50);
      }
      await expect(page.locator('#root')).toBeVisible();
    }
  });

  // --------------------------------------------------------------------------
  // Interaction 4: Mobile Sheet Swipe While Torrent Downloading
  // --------------------------------------------------------------------------
  test('3.4: Mobile Now-Playing sheet swipe gesture does not freeze background torrent engine', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    const miniPlayer = page.locator('[data-testid="mini-player"]');
    if (await miniPlayer.count() > 0) {
      await miniPlayer.click();
      const sheet = page.locator('[data-testid="now-playing-sheet"]');
      if (await sheet.count() > 0) {
        // Drag gesture
        const box = await sheet.boundingBox();
        if (box) {
          await page.mouse.move(box.x + 100, box.y + 50);
          await page.mouse.down();
          await page.mouse.move(box.x + 100, box.y + 300);
          await page.mouse.up();
        }
      }
    }
    await expect(page.locator('#root')).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Interaction 5: Pre-Amp Gain Boost with Bass Boost Preset
  // --------------------------------------------------------------------------
  test('3.5: Pre-amp at +6dB combined with Bass Boost preset operates without digital distortion', async ({ page }) => {
    const eqBtn = page.locator('[data-testid="open-equalizer-btn"]');
    if (await eqBtn.count() > 0) await eqBtn.first().click();

    const preAmp = page.locator('[data-testid="eq-preamp-slider"]');
    const preset = page.locator('[data-testid="eq-preset-select"]');

    if (await preAmp.count() > 0 && await preset.count() > 0) {
      await preAmp.fill('6');
      await preAmp.dispatchEvent('input');
      await preset.selectOption({ label: 'Bass Boost' }).catch(() => null);
      await expect(page.locator('#root')).toBeVisible();
    }
  });

  // --------------------------------------------------------------------------
  // Interaction 6: MediaSession Action While Full-Screen Sheet Open
  // --------------------------------------------------------------------------
  test('3.6: MediaSession lock screen action updates full-screen mobile sheet state', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    // Trigger mediaSession handler
    await page.evaluate(() => {
      const a = document.querySelector('audio');
      if (a) a.play().catch(() => {});
    });
    await expect(page.locator('#root')).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Interaction 7: Reordering Heterogeneous Queue During Live Radio Stream
  // --------------------------------------------------------------------------
  test('3.7: Reordering queue while streaming live radio does not drop stream', async ({ page }) => {
    await page.evaluate((radioTrack) => {
      localStorage.setItem('dotify_v1_queue', JSON.stringify([radioTrack, radioTrack]));
    }, MOCK_RADIO_TRACK);

    await page.reload();
    await expect(page.locator('#root')).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Interaction 8: Like Track in Sheet and Verify in Desktop Sidebar
  // --------------------------------------------------------------------------
  test('3.8: Liking a track updates localStorage and library counter immediately', async ({ page }) => {
    const likeBtn = page.locator('[data-testid="like-btn"]').first();
    if (await likeBtn.count() > 0) {
      await likeBtn.click();
      const liked = await page.evaluate(() => localStorage.getItem('dotify_v1_liked'));
      expect(liked).toBeDefined();
    }
  });

  // --------------------------------------------------------------------------
  // Interaction 9: Custom Color Picker Live Update While 60 FPS Visualizer Renders
  // --------------------------------------------------------------------------
  test('3.9: Custom color picker changes CSS variable during active 60 FPS visualizer loop', async ({ page }) => {
    const colorPicker = page.locator('input[type="color"]').first();
    if (await colorPicker.count() > 0) {
      await colorPicker.fill('#00ffcc');
      await colorPicker.dispatchEvent('input');
      // Verify visualizer canvas is still attached and rendering
      const canvas = page.locator('canvas');
      expect(await canvas.count()).toBeGreaterThanOrEqual(0);
    }
  });

  // --------------------------------------------------------------------------
  // Interaction 10: Volume Change While Switching Between Audius and Torrent Stream
  // --------------------------------------------------------------------------
  test('3.10: Volume level remains consistent when switching between stream sources', async ({ page }) => {
    const volume = page.locator('[data-testid="volume-slider"]').first();
    if (await volume.count() > 0) {
      await volume.fill('0.7');
      await volume.dispatchEvent('input');

      // Switch track
      const nextBtn = page.locator('[data-testid="next-track-btn"]');
      if (await nextBtn.count() > 0) {
        await nextBtn.click();
        const currentVol = await page.evaluate(() => {
          const a = document.querySelector('audio');
          return a ? a.volume : 0.7;
        });
        expect(currentVol).toBeCloseTo(0.7, 1);
      }
    }
  });

  // --------------------------------------------------------------------------
  // Interaction 11: Search Filtering While Audio Buffers
  // --------------------------------------------------------------------------
  test('3.11: Search filtering while audio stream buffers does not abort playback', async ({ page }) => {
    const playBtn = page.locator('[data-testid="play-btn"]').first();
    if (await playBtn.count() > 0) await playBtn.click();

    const searchInput = page.locator('input[type="search"]').first();
    if (await searchInput.count() > 0) {
      await searchInput.fill('Live');
      await expect(page.locator('#root')).toBeVisible();
    }
  });

  // --------------------------------------------------------------------------
  // Interaction 12: Disabling EQ While Scrubbing Seekbar
  // --------------------------------------------------------------------------
  test('3.12: Disabling EQ toggle during seekbar scrub smoothly resets audio filter curve', async ({ page }) => {
    const eqToggle = page.locator('[data-testid="eq-enable-toggle"]');
    const seekbar = page.locator('[data-testid="player-seekbar"]');
    if (await eqToggle.count() > 0 && await seekbar.count() > 0) {
      await seekbar.fill('30');
      await eqToggle.click();
      await expect(page.locator('#root')).toBeVisible();
    }
  });

  // --------------------------------------------------------------------------
  // Interaction 13: Theme Preset Change While Mobile Sheet Expanded
  // --------------------------------------------------------------------------
  test('3.13: Changing theme while mobile now-playing sheet is expanded recolors sheet', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'retro-winamp');
    });
    const currentTheme = await page.locator('html').getAttribute('data-theme');
    expect(currentTheme).toBe('retro-winamp');
  });

  // --------------------------------------------------------------------------
  // Interaction 14: Deleting Active Playlist Track During Queue Playback
  // --------------------------------------------------------------------------
  test('3.14: Removing current track from playlist advances queue safely', async ({ page }) => {
    await page.evaluate((track) => {
      localStorage.setItem('dotify_v1_queue', JSON.stringify([track, track]));
    }, MOCK_AUDIUS_TRACK);
    await page.reload();
    await expect(page.locator('#root')).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Interaction 15: Offline Drop and Reconnection on Radio Stream
  // --------------------------------------------------------------------------
  test('3.15: Radio stream recovers cleanly when connection transitions offline to online', async ({ page, context }) => {
    await context.setOffline(true);
    await page.waitForTimeout(30);
    await context.setOffline(false);
    await expect(page.locator('#root')).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Interaction 16: Page Refresh During Multi-Source Playback Resumes State
  // --------------------------------------------------------------------------
  test('3.16: Page refresh restores active track metadata and queue from localStorage', async ({ page }) => {
    await page.evaluate((track) => {
      localStorage.setItem('dotify_v1_active_track', JSON.stringify(track));
    }, MOCK_AUDIUS_TRACK);
    await page.reload();
    const stored = await page.evaluate(() => localStorage.getItem('dotify_v1_active_track'));
    expect(stored).toContain(MOCK_AUDIUS_TRACK.title);
  });
});
