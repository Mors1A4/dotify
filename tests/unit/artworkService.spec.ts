import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_MUSIC_ARTWORK,
  isUglyPlaceholder,
  upgradeArtworkUrl,
  getTrackArtwork,
  resolveTrackArtwork,
} from '../../src/services/artworkService';
import { PLAYLIST_COVER_PRESETS } from '../../src/components/modals/CreatePlaylistModal';

describe('artworkService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('provides a sleek studio vinyl DEFAULT_MUSIC_ARTWORK without overlapping black spindle hole', () => {
    expect(DEFAULT_MUSIC_ARTWORK.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    const decoded = decodeURIComponent(
      DEFAULT_MUSIC_ARTWORK.replace('data:image/svg+xml;utf8,', '')
    );
    expect(decoded).toContain('<svg');
    expect(decoded).toContain('viewBox="0 0 400 400"');
    // Must not punch a black circle at (200,200) over the music note
    expect(decoded).not.toContain('<circle cx="200" cy="200" r="6" fill="#000000"');
  });

  it('correctly identifies ugly or fallback placeholders while preserving custom playlist presets', () => {
    expect(isUglyPlaceholder(undefined)).toBe(true);
    expect(isUglyPlaceholder(null)).toBe(true);
    expect(isUglyPlaceholder('')).toBe(true);
    expect(isUglyPlaceholder(DEFAULT_MUSIC_ARTWORK)).toBe(true);
    expect(isUglyPlaceholder('https://e-cdns-images.dzcdn.net/images/cover//500x500.jpg')).toBe(true);
    expect(isUglyPlaceholder('https://placehold.co/300x300')).toBe(true);

    // Valid real artwork should NOT be marked as placeholder
    expect(
      isUglyPlaceholder(
        'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/6a/f5/6b/6af56b1d-1cc8-68e8-a428-5caccf20e69a/093624880639.jpg/600x600bb.jpg'
      )
    ).toBe(false);

    // Custom playlist studio presets must NOT be marked as ugly placeholders
    for (const preset of PLAYLIST_COVER_PRESETS.filter((p) => p.url)) {
      expect(isUglyPlaceholder(preset.url)).toBe(false);
    }
  });

  it('upgrades iTunes and Deezer low-res artwork URLs to high-res', () => {
    expect(
      upgradeArtworkUrl(
        'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/6a/f5/6b/cover/100x100bb.jpg'
      )
    ).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/6a/f5/6b/cover/600x600bb.jpg'
    );
    expect(
      upgradeArtworkUrl(
        'https://e-cdns-images.dzcdn.net/images/cover/abc123/250x250-000000-80-0-0.jpg'
      )
    ).toBe('https://e-cdns-images.dzcdn.net/images/cover/abc123/500x500-000000-80-0-0.jpg');
  });

  it('resolves missing track artwork via iTunes Search API and caches it for getTrackArtwork', async () => {
    const mockCover100 =
      'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/6a/f5/6b/6af56b1d-1cc8-68e8-a428-5caccf20e69a/093624880639.jpg/100x100bb.jpg';
    const expectedCover600 =
      'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/6a/f5/6b/6af56b1d-1cc8-68e8-a428-5caccf20e69a/093624880639.jpg/600x600bb.jpg';

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        resultCount: 1,
        results: [
          {
            artistName: 'Red Hot Chili Peppers',
            trackName: 'Black Summer',
            artworkUrl100: mockCover100,
          },
        ],
      }),
    } as any);

    const resolved = await resolveTrackArtwork('Red Hot Chili Peppers', 'Black Summer');
    expect(resolved).toBe(expectedCover600);

    // Subsequent synchronous getTrackArtwork call should return the resolved 600x600 cover even if track has DEFAULT_MUSIC_ARTWORK
    const syncArt = getTrackArtwork({
      artist: 'Red Hot Chili Peppers',
      title: 'Black Summer',
      artworkUrl: DEFAULT_MUSIC_ARTWORK,
    });
    expect(syncArt).toBe(expectedCover600);
  });
});
