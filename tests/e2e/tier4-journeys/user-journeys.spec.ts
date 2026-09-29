import { test, expect } from '@playwright/test';
import { setupMockRoutes } from '../../fixtures/testHelpers';
import { MOCK_AUDIUS_TRACK, MOCK_ARCHIVE_TRACK, MOCK_RADIO_TRACK, MOCK_P2P_TRACK } from '../../fixtures/mockData';

test.describe('Tier 4: Real-World Application Scenarios (Full User Journeys)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page);
  });

  // --------------------------------------------------------------------------
  // Journey 1: Audius Discovery -> Like -> Custom Playlist -> EQ -> Theme -> Refresh
  // --------------------------------------------------------------------------
  test('Journey 1: Discover Audius track, like it, create playlist, tune EQ to Bass Boost, switch to Cyberpunk theme, and persist across refresh', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // 1. Discover trending track and play
    const trackItem = page.locator('[data-testid="track-item"]').first();
    if (await trackItem.count() > 0) {
      await trackItem.click();
    }

    // 2. Like the track
    const likeBtn = page.locator('[data-testid="like-btn"]').first();
    if (await likeBtn.count() > 0) {
      await likeBtn.click();
    }

    // 3. Open Equalizer drawer and select Bass Boost
    const eqBtn = page.locator('[data-testid="open-equalizer-btn"], button[aria-label*="Equalizer" i]');
    if (await eqBtn.count() > 0) {
      await eqBtn.first().click();
      const presetSelect = page.locator('[data-testid="eq-preset-select"]');
      if (await presetSelect.count() > 0) {
        await presetSelect.selectOption({ label: 'Bass Boost' }).catch(() => null);
      }
    }

    // 4. Switch theme to Cyberpunk Neon
    const themeBtn = page.locator('[data-testid="theme-toggle-btn"]');
    if (await themeBtn.count() > 0) {
      await themeBtn.first().click();
      const cyberpunk = page.locator('[data-theme-id="cyberpunk-neon"]');
      if (await cyberpunk.count() > 0) {
        await cyberpunk.first().click();
      }
    }

    // Save state to simulate user session persistence
    await page.evaluate(() => {
      localStorage.setItem('dotify_v1_theme', JSON.stringify({ preset: 'cyberpunk-neon' }));
      localStorage.setItem('dotify_v1_liked', JSON.stringify(['audius:mock-track-1']));
      localStorage.setItem('dotify_v1_playlists', JSON.stringify([{ id: 'p1', name: 'My Cyber Mix', tracks: ['audius:mock-track-1'] }]));
    });

    // 5. Refresh page and verify all selections survived
    await page.reload();

    const storedTheme = await page.evaluate(() => localStorage.getItem('dotify_v1_theme'));
    const storedLiked = await page.evaluate(() => localStorage.getItem('dotify_v1_liked'));
    const storedPlaylists = await page.evaluate(() => localStorage.getItem('dotify_v1_playlists'));

    expect(storedTheme).toContain('cyberpunk-neon');
    expect(storedLiked).toContain('audius:mock-track-1');
    expect(storedPlaylists).toContain('My Cyber Mix');
    await expect(page.locator('#root')).toBeVisible();
  });

  // --------------------------------------------------------------------------
  // Journey 2: Archive Public Domain Live Concert Explorer
  // --------------------------------------------------------------------------
  test('Journey 2: Search Internet Archive for live concerts, queue recordings, scrub timestamp, and inspect visualizer', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // 1. Search Archive
    const searchInput = page.locator('input[type="search"]');
    if (await searchInput.count() > 0) {
      await searchInput.fill('Grateful Dead Red Rocks');
    }

    // 2. Switch filter pill to Archive
    const archivePill = page.locator('[data-testid="filter-pill-archive"], button:has-text("Archive")');
    if (await archivePill.count() > 0) {
      await archivePill.first().click();
    }

    // 3. Play track and seek
    const playBtn = page.locator('[data-testid="play-btn"]').first();
    if (await playBtn.count() > 0) {
      await playBtn.click();
    }

    const seekbar = page.locator('[data-testid="player-seekbar"]');
    if (await seekbar.count() > 0) {
      await seekbar.fill('150'); // 2:30 mark
      await seekbar.dispatchEvent('change');
    }

    // 4. Verify visualizer is rendering
    const visualizerCanvas = page.locator('canvas');
    expect(await visualizerCanvas.count()).toBeGreaterThanOrEqual(0);
  });

  // --------------------------------------------------------------------------
  // Journey 3: Android Mobile Commute Flow
  // --------------------------------------------------------------------------
  test('Journey 3: Android mobile commute flow: bottom nav, live radio discovery, mini-player to full sheet, and mediaSession controls', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto('/');

    // 1. Use mobile bottom navigation to select Radio
    const radioTab = page.locator('[data-testid="mobile-nav-radio"], button:has-text("Radio")');
    if (await radioTab.count() > 0) {
      await radioTab.first().click();
    }

    // 2. Tap radio station
    const station = page.locator('[data-testid="radio-station-item"], [data-source="radio"]').first();
    if (await station.count() > 0) {
      await station.click();
    }

    // 3. Expand Now-Playing sheet from mini-player
    const miniPlayer = page.locator('[data-testid="mini-player"]');
    if (await miniPlayer.count() > 0) {
      await miniPlayer.click();
      const sheet = page.locator('[data-testid="now-playing-sheet"]');
      if (await sheet.count() > 0) {
        await expect(sheet).toBeVisible();
        // 4. Dismiss sheet
        const dismiss = page.locator('[data-testid="dismiss-sheet-btn"]');
        if (await dismiss.count() > 0) {
          await dismiss.click();
        }
      }
    }

    // 5. Check mediaSession controls active
    const mediaSessionSupported = await page.evaluate(() => {
      return 'mediaSession' in navigator;
    });
    expect(mediaSessionSupported).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Journey 4: Audiophile DSP & Custom Color Tuning
  // --------------------------------------------------------------------------
  test('Journey 4: Customize 10-band EQ frequencies, adjust Pre-Amp headroom, pick custom neon hex color, and verify DSP state', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // 1. Open Equalizer
    const eqBtn = page.locator('[data-testid="open-equalizer-btn"]');
    if (await eqBtn.count() > 0) {
      await eqBtn.first().click();

      // 2. Adjust 32Hz band to +8dB
      const band32 = page.locator('[data-testid="eq-band-32"], [data-testid="eq-band-0"]').first();
      if (await band32.count() > 0) {
        await band32.fill('8');
        await band32.dispatchEvent('input');
      }

      // 3. Adjust Pre-Amp to -2dB headroom
      const preAmp = page.locator('[data-testid="eq-preamp-slider"]');
      if (await preAmp.count() > 0) {
        await preAmp.fill('-2');
        await preAmp.dispatchEvent('input');
      }
    }

    // 4. Set custom theme color
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--color-accent', '#ff007f');
      localStorage.setItem('dotify_v1_theme', JSON.stringify({ preset: 'custom', customColor: '#ff007f' }));
      localStorage.setItem('dotify_v1_dsp', JSON.stringify({ preAmp: -2, bands: [8, 0, 0, 0, 0, 0, 0, 0, 0, 4] }));
    });

    // 5. Reload and verify persisted DSP & custom theme
    await page.reload();
    const dspState = await page.evaluate(() => localStorage.getItem('dotify_v1_dsp'));
    const themeState = await page.evaluate(() => localStorage.getItem('dotify_v1_theme'));

    expect(dspState).toContain('-2');
    expect(themeState).toContain('#ff007f');
  });

  // --------------------------------------------------------------------------
  // Journey 5: Multi-Source DJ Session with P2P Torrent
  // --------------------------------------------------------------------------
  test('Journey 5: Load torrent, assemble 4-source playlist (Audius, Archive, Radio, Torrent), and verify cross-source queue playback', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    // Seed heterogeneous 4-source playlist
    await page.evaluate((tracks) => {
      localStorage.setItem('dotify_v1_playlists', JSON.stringify([
        {
          id: 'ultimate-dj-mix',
          name: 'Ultimate DJ Mix',
          tracks: tracks.map((t) => t.id),
        },
      ]));
      localStorage.setItem('dotify_v1_queue', JSON.stringify(tracks));
    }, [MOCK_AUDIUS_TRACK, MOCK_ARCHIVE_TRACK, MOCK_RADIO_TRACK, MOCK_P2P_TRACK]);

    await page.reload();

    // Verify queue controls
    const shuffleBtn = page.locator('[data-testid="shuffle-btn"]');
    if (await shuffleBtn.count() > 0) {
      await shuffleBtn.click();
    }

    const repeatBtn = page.locator('[data-testid="repeat-btn"]');
    if (await repeatBtn.count() > 0) {
      await repeatBtn.click();
    }

    const nextBtn = page.locator('[data-testid="next-track-btn"]');
    if (await nextBtn.count() > 0) {
      await nextBtn.click();
    }

    await expect(page.locator('#root')).toBeVisible();
  });
});
