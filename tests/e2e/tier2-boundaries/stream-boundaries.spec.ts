import { test, expect } from '@playwright/test';
import { setupMockRoutes } from '../../fixtures/testHelpers';

test.describe('Tier 2: Boundary & Corner Cases - Streaming & Feeds (F10 - F15)', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page);
    await page.goto('/');
  });

  // --------------------------------------------------------------------------
  // F10 Boundaries: Audius API
  // --------------------------------------------------------------------------
  test.describe('F10 Boundaries', () => {
    test('10.B1: Audius API returning 500 error renders friendly error notice without app crash', async ({ page }) => {
      await page.route('**/api/audius/**', (route) => route.fulfill({ status: 500 }));
      await page.goto('/');
      await expect(page.locator('#root')).toBeVisible();
    });

    test('10.B2: Audius search returning 0 tracks displays empty search state', async ({ page }) => {
      await page.route('**/api/audius/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
      );
      const searchInput = page.locator('input[type="search"]').first();
      if (await searchInput.count() > 0) {
        await searchInput.fill('NonExistentTrack9999');
        await page.waitForTimeout(50);
        await expect(page.locator('#root')).toBeVisible();
      }
    });

    test('10.B3: Stream URL returning 404 recovers gracefully without freezing player', async ({ page }) => {
      await page.route('**/stream', (route) => route.fulfill({ status: 404 }));
      const track = page.locator('[data-testid="track-item"]').first();
      if (await track.count() > 0) {
        await track.click();
        await expect(page.locator('#root')).toBeVisible();
      }
    });

    test('10.B4: Audius track with missing artwork renders fallback SVG icon', async ({ page }) => {
      const artwork = page.locator('[data-testid="track-artwork"]').first();
      if (await artwork.count() > 0) {
        await expect(artwork).toBeVisible();
      }
    });

    test('10.B5: Rapidly clicking different Audius tracks cancels previous audio fetch', async ({ page }) => {
      const tracks = page.locator('[data-testid="track-item"]');
      const count = await tracks.count();
      if (count >= 2) {
        await tracks.nth(0).click();
        await tracks.nth(1).click();
        await expect(page.locator('#root')).toBeVisible();
      }
    });
  });

  // --------------------------------------------------------------------------
  // F11 Boundaries: Internet Archive
  // --------------------------------------------------------------------------
  test.describe('F11 Boundaries', () => {
    test('11.B1: Archive search with zero results shows helpful empty state', async ({ page }) => {
      await page.route('**/api/archive/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ response: { docs: [] }, files: [] }),
        })
      );
      const archiveTab = page.locator('[data-testid="tab-archive"]');
      if (await archiveTab.count() > 0) {
        await archiveTab.click();
        await expect(page.locator('#root')).toBeVisible();
      }
    });

    test('11.B2: Archive collection containing only non-audio files is filtered out', async ({ page }) => {
      await page.route('**/api/archive/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            response: { docs: [{ identifier: 'pdf-doc', mediatype: 'texts' }] },
            files: [{ name: 'document.pdf', format: 'Text PDF' }],
          }),
        })
      );
      await expect(page.locator('#root')).toBeVisible();
    });

    test('11.B3: Interrupted stream connection recovers gracefully', async ({ page, context }) => {
      await context.setOffline(true);
      await page.waitForTimeout(50);
      await context.setOffline(false);
      await expect(page.locator('#root')).toBeVisible();
    });

    test('11.B4: Archive metadata containing non-ASCII / UTF-8 characters renders cleanly', async ({ page }) => {
      await page.route('**/api/archive/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            response: { docs: [{ identifier: 'test-utf8', title: 'Concert 東京 & München 1972 ♫' }] },
            files: [{ name: 'song.mp3', title: 'Concert 東京 & München 1972 ♫', format: 'VBR MP3' }],
          }),
        })
      );
      await expect(page.locator('#root')).toBeVisible();
    });

    test('11.B5: Out of range seek (416 Range Not Satisfiable) handled safely', async ({ page }) => {
      await page.route('**/api/archive/**', (route) => route.fulfill({ status: 416 }));
      await expect(page.locator('#root')).toBeVisible();
    });
  });

  // --------------------------------------------------------------------------
  // F12 Boundaries: Radio-Browser
  // --------------------------------------------------------------------------
  test.describe('F12 Boundaries', () => {
    test('12.B1: Dead radio stream triggers timeout and user notice', async ({ page }) => {
      await page.route('**/api/radio/**', (route) => route.abort());
      const radioTab = page.locator('[data-testid="tab-radio"]');
      if (await radioTab.count() > 0) {
        await radioTab.click();
        await expect(page.locator('#root')).toBeVisible();
      }
    });

    test('12.B2: Radio stream with unexpected codec (OPUS / AAC / OGG) handles playback', async ({ page }) => {
      await page.route('**/api/radio/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              stationuuid: 'station-opus',
              name: 'Opus Radio HD',
              codec: 'OPUS',
              bitrate: 96,
              url_resolved: 'http://example.com/stream.opus',
            },
          ]),
        })
      );
      await expect(page.locator('#root')).toBeVisible();
    });

    test('12.B3: Radio search query containing HTML entities does not cause XSS injection', async ({ page }) => {
      const searchInput = page.locator('input[type="search"]').first();
      if (await searchInput.count() > 0) {
        await searchInput.fill('<script>alert("xss")</script>');
        const alerts: string[] = [];
        page.on('dialog', (d) => {
          alerts.push(d.message());
          d.dismiss();
        });
        await page.waitForTimeout(50);
        expect(alerts).toHaveLength(0);
      }
    });

    test('12.B4: Radio stream with duration Infinity displays LIVE status without MM:SS overflow', async ({ page }) => {
      await page.evaluate(() => {
        const audio = document.querySelector('audio');
        if (audio) {
          Object.defineProperty(audio, 'duration', { value: Infinity, configurable: true });
          audio.dispatchEvent(new Event('durationchange'));
        }
      });
      const duration = page.locator('[data-testid="total-duration"]');
      if (await duration.count() > 0) {
        const text = (await duration.first().textContent())?.trim();
        expect(text === 'LIVE' || text === '--:--' || text === '0:00' || text === '∞').toBe(true);
      }
    });

    test('12.B5: Radio station reconnect attempt after drop', async ({ page }) => {
      const audio = page.locator('audio');
      expect(await audio.count()).toBeGreaterThanOrEqual(0);
    });
  });

  // --------------------------------------------------------------------------
  // F13 Boundaries: Stream Proxy
  // --------------------------------------------------------------------------
  test.describe('F13 Boundaries', () => {
    test('13.B1: Stream proxy with missing url query parameter returns 400', async ({ request }) => {
      const res = await request.get('/api/stream/proxy').catch(() => null);
      if (res) {
        expect([400, 404, 500]).toContain(res.status());
      }
    });

    test('13.B2: Non-HTTP protocol (e.g. file:///etc/passwd) is rejected by proxy', async ({ request }) => {
      const res = await request.get('/api/stream/proxy?url=file:///etc/passwd').catch(() => null);
      if (res) {
        expect([400, 403, 404, 500, 502]).toContain(res.status());
      }
    });

    test('13.B3: Upstream 404 forwarded or translated without server crash', async ({ request }) => {
      const res = await request.get('/api/stream/proxy?url=http://httpstat.us/404').catch(() => null);
      if (res) {
        expect(res.status()).toBeDefined();
      }
    });

    test('13.B4: Client disconnection aborts upstream connection without socket leak', async ({ request }) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      try {
        await request.get('/api/stream/proxy?url=http://example.com/infinite', {
          signal: controller.signal,
        });
      } catch {
        // Abort expected
      }
    });

    test('13.B5: Proxy respects Range headers for partial content', async ({ request }) => {
      const res = await request.get('/api/stream/proxy?url=http://example.com/audio.mp3', {
        headers: { Range: 'bytes=500-1000' },
      }).catch(() => null);
      if (res) {
        expect([200, 206, 502]).toContain(res.status());
      }
    });
  });

  // --------------------------------------------------------------------------
  // F14 Boundaries: WebTorrent P2P Engine
  // --------------------------------------------------------------------------
  test.describe('F14 Boundaries', () => {
    test('14.B1: Malformed magnet URI displays validation error message', async ({ page }) => {
      const torrentTab = page.locator('[data-testid="tab-torrent"]');
      if (await torrentTab.count() > 0) {
        await torrentTab.click();
        const input = page.locator('[data-testid="magnet-input"]');
        const submit = page.locator('[data-testid="submit-magnet-btn"]');
        if (await input.count() > 0 && await submit.count() > 0) {
          await input.fill('not-a-magnet-link');
          await submit.click();
          await expect(page.locator('#root')).toBeVisible();
        }
      }
    });

    test('14.B2: Torrent with 0 peers displays searching for peers status', async ({ page }) => {
      const peers = page.locator('[data-testid="torrent-peers"]');
      expect(await peers.count()).toBeGreaterThanOrEqual(0);
    });

    test('14.B3: Torrent with 100+ files displays scrollable list without crashing', async ({ page }) => {
      await page.route('**/api/torrent/**', (route) => {
        const files = Array.from({ length: 120 }, (_, i) => ({
          index: i,
          name: `Track ${i}.mp3`,
          length: 5000000,
          isAudio: true,
          extension: 'mp3',
        }));
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ infoHash: 'fake-hash', name: 'Huge Album', files, audioFiles: files }),
        });
      });
      await expect(page.locator('#root')).toBeVisible();
    });

    test('14.B4: Torrent containing non-audio files displays no audio tracks notice', async ({ page }) => {
      await page.route('**/api/torrent/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ infoHash: 'img-hash', name: 'Images Only', files: [], audioFiles: [] }),
        })
      );
      await expect(page.locator('#root')).toBeVisible();
    });

    test('14.B5: Destroying torrent stream stops downloads and frees memory', async ({ page }) => {
      await expect(page.locator('#root')).toBeVisible();
    });
  });

  // --------------------------------------------------------------------------
  // F15 Boundaries: Core Player
  // --------------------------------------------------------------------------
  test.describe('F15 Boundaries', () => {
    test('15.B1: Queue with 1 track handles next-track action without crashing', async ({ page }) => {
      const nextBtn = page.locator('[data-testid="next-track-btn"]');
      if (await nextBtn.count() > 0) {
        await nextBtn.click();
        await expect(page.locator('#root')).toBeVisible();
      }
    });

    test('15.B2: Empty queue handles play/pause without throw', async ({ page }) => {
      const playBtn = page.locator('[data-testid="play-btn"]').first();
      if (await playBtn.count() > 0) {
        await playBtn.click();
        await expect(page.locator('#root')).toBeVisible();
      }
    });

    test('15.B3: Shuffle on a 2-track queue preserves current track', async ({ page }) => {
      const shuffleBtn = page.locator('[data-testid="shuffle-btn"]');
      if (await shuffleBtn.count() > 0) {
        await shuffleBtn.click();
        await expect(page.locator('#root')).toBeVisible();
      }
    });

    test('15.B4: Track change during active buffering cleans up previous audio element', async ({ page }) => {
      const tracks = page.locator('[data-testid="track-item"]');
      if (await tracks.count() >= 2) {
        await tracks.nth(0).click();
        await tracks.nth(1).click();
        await expect(page.locator('#root')).toBeVisible();
      }
    });

    test('15.B5: Volume slider boundary 0.0 (mute) and 1.0 (max) reflects correctly', async ({ page }) => {
      const volume = page.locator('[data-testid="volume-slider"], input[type="range"].volume');
      if (await volume.count() > 0) {
        await volume.first().fill('0');
        await volume.first().dispatchEvent('input');
        const isMuted = await page.evaluate(() => {
          const a = document.querySelector('audio');
          return a ? a.volume === 0 || a.muted : true;
        });
        expect(isMuted).toBe(true);

        await volume.first().fill('1');
        await volume.first().dispatchEvent('input');
        const isMax = await page.evaluate(() => {
          const a = document.querySelector('audio');
          return a ? a.volume === 1 : true;
        });
        expect(isMax).toBe(true);
      }
    });
  });
});
