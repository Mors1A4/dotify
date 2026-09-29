/**
 * Upgrades low-resolution music artwork URLs (Spotify Mosaic 60px/300px,
 * Spotify CDN 64px/300px, iTunes 100px, Deezer 56px/250px) to high-definition
 * 600px–640px studio quality.
 */
export function upgradeArtworkUrl(url?: string | null): string {
  if (!url || typeof url !== 'string') return '';
  let clean = url.trim();
  if (!clean) return '';

  // 1. Spotify 2x2 playlist mosaic covers:
  // https://mosaic.scdn.co/60/... or https://mosaic.scdn.co/300/... -> https://mosaic.scdn.co/640/...
  if (clean.includes('mosaic.scdn.co/')) {
    clean = clean.replace(/mosaic\.scdn\.co\/(?:60|300)\//i, 'mosaic.scdn.co/640/');
  }

  // 2. Spotify CDN album/track artwork hashes:
  // ab67616d00004851 (64x64) or ab67616d00001e02 (300x300) -> ab67616d0000b273 (640x640 HD)
  if (clean.includes('scdn.co/') || clean.includes('spotifycdn.com/')) {
    clean = clean.replace(/ab67616d0000(?:4851|1e02)/gi, 'ab67616d0000b273');
  }

  // 3. Apple Music / iTunes artwork:
  // .../100x100bb.jpg or .../60x60bb.jpg or .../300x300bb.jpg -> .../600x600bb.jpg
  if (clean.includes('mzstatic.com/')) {
    clean = clean.replace(/\/\d+x\d+(bb|bf|sr|cc)\./i, '/600x600$1.');
  }

  // 4. Deezer CDN artwork:
  // .../56x56-000000-80-0-0.jpg or .../250x250-... -> .../500x500-...
  if (clean.includes('dzcdn.net/images/')) {
    clean = clean.replace(/\/(?:56x56|120x120|250x250)-/i, '/500x500-');
  }

  return clean;
}

/**
 * If a URL is a Spotify 2x2 mosaic URL (`https://mosaic.scdn.co/{size}/{160-hex-chars}`),
 * extracts the 4 individual 40-char Spotify image hashes and returns their full
 * 640x640 HD `https://i.scdn.co/image/ab67616d0000b273...` URLs (producing an
 * effective 1280x1280 2x2 grid instead of a low-res pre-stitched thumbnail).
 */
export function extractMosaicQuadrants(url?: string | null): string[] | null {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/mosaic\.scdn\.co\/\d+\/([a-f0-9]{160})/i);
  if (!match || !match[1]) return null;

  const hex = match[1];
  const hashes = [
    hex.slice(0, 40),
    hex.slice(40, 80),
    hex.slice(80, 120),
    hex.slice(120, 160),
  ];

  return hashes.map((h) =>
    upgradeArtworkUrl(`https://i.scdn.co/image/${h}`)
  );
}
