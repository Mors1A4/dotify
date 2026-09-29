import { Page } from '@playwright/test';
import { SILENT_WAV_BASE64 } from './mockAudio';
import { MOCK_AUDIUS_TRACK, MOCK_ARCHIVE_TRACK, MOCK_RADIO_TRACK, MOCK_P2P_TRACK } from './mockData';

/**
 * Sets up deterministic network route mocking for Playwright tests.
 * Intercepts external API calls and returns synthetic responses instantly.
 */
export async function setupMockRoutes(page: Page) {
  // Audius API trending and search routes
  await page.route('**/api/audius/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/stream')) {
      await route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        body: Buffer.from(SILENT_WAV_BASE64.split(',')[1], 'base64'),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'mock-track-1',
              title: MOCK_AUDIUS_TRACK.title,
              user: { name: MOCK_AUDIUS_TRACK.artist },
              duration: MOCK_AUDIUS_TRACK.duration,
              genre: 'Electronic',
              artwork: { '150x150': MOCK_AUDIUS_TRACK.artworkUrl },
            },
            {
              id: 'mock-track-2',
              title: 'Synthwave Skyline',
              user: { name: 'Retro Grid' },
              duration: 210,
              genre: 'Electronic',
              artwork: { '150x150': MOCK_AUDIUS_TRACK.artworkUrl },
            },
          ],
        }),
      });
    }
  });

  // Internet Archive API routes
  await page.route('**/api/archive/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        response: {
          docs: [
            {
              identifier: 'mock-concert-1',
              title: MOCK_ARCHIVE_TRACK.title,
              creator: MOCK_ARCHIVE_TRACK.artist,
              year: '1978',
              mediatype: 'audio',
            },
          ],
        },
        files: [
          {
            name: 'track01.mp3',
            title: MOCK_ARCHIVE_TRACK.title,
            length: '420',
            format: 'VBR MP3',
          },
        ],
      }),
    });
  });

  // Radio Browser API routes
  await page.route('**/api/radio/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          stationuuid: 'mock-station-1',
          name: MOCK_RADIO_TRACK.title,
          country: 'Germany',
          tags: 'chillout,ambient,lounge',
          codec: 'MP3',
          bitrate: 192,
          url_resolved: SILENT_WAV_BASE64,
        },
      ]),
    });
  });

  // Backend Stream Proxy routes
  await page.route('**/api/stream/proxy**', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      },
      body: Buffer.from(SILENT_WAV_BASE64.split(',')[1], 'base64'),
    });
  });

  // WebTorrent Engine routes
  await page.route('**/api/torrent/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/stream')) {
      await route.fulfill({
        status: 206,
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Range': 'bytes 0-100/100',
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        },
        body: Buffer.from(SILENT_WAV_BASE64.split(',')[1], 'base64'),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          infoHash: '0123456789abcdef0123456789abcdef01234567',
          name: 'Mock Album Torrent',
          files: [
            {
              index: 0,
              name: 'Open Source Symphonics.flac',
              length: 34567890,
              isAudio: true,
              extension: 'flac',
            },
            {
              index: 1,
              name: 'Cover.jpg',
              length: 120400,
              isAudio: false,
              extension: 'jpg',
            },
          ],
          audioFiles: [
            {
              index: 0,
              name: 'Open Source Symphonics.flac',
              length: 34567890,
              isAudio: true,
              extension: 'flac',
            },
          ],
        }),
      });
    }
  });
}

/**
 * Seeds localStorage with custom state before loading page
 */
export async function seedLocalStorage(page: Page, key: string, value: any) {
  await page.addInitScript(
    ({ k, v }) => {
      window.localStorage.setItem(k, JSON.stringify(v));
    },
    { k: key, v: value }
  );
}
