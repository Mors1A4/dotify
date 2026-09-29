/**
 * Spotify URL & Embed Resolver
 * Resolves Spotify tracks, albums, and playlists via open initialState, oEmbed & embed endpoints without API keys.
 * Extracts 1:1 playlist metadata (title, description, cover art, owner) and per-track album & cover art.
 */

export function isSpotifyUrl(input) {
  if (!input || typeof input !== 'string') return false;
  return input.includes('spotify.com') || input.startsWith('spotify:');
}

export function parseSpotifyId(input) {
  if (!input || typeof input !== 'string') return null;
  const clean = input.trim();
  // https://open.spotify.com/track/7qiZfU4dY1lWllzX7mPBI3?si=...
  // spotify:track:7qiZfU4dY1lWllzX7mPBI3
  const trackMatch = clean.match(/(?:track\/|track:)([a-zA-Z0-9]+)/);
  if (trackMatch) return { type: 'track', id: trackMatch[1] };

  const playlistMatch = clean.match(/(?:playlist\/|playlist:)([a-zA-Z0-9]+)/);
  if (playlistMatch) return { type: 'playlist', id: playlistMatch[1] };

  const albumMatch = clean.match(/(?:album\/|album:)([a-zA-Z0-9]+)/);
  if (albumMatch) return { type: 'album', id: albumMatch[1] };

  return null;
}

/**
 * Decodes HTML entities and strips HTML tags from Spotify descriptions/titles.
 */
function cleanHtmlText(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\u00a0/g, ' ')
    .trim();
}

/**
 * Extracts Spotify track ID from a spotify:track:XYZ URI or URL.
 */
function extractTrackIdFromUri(uri) {
  if (!uri || typeof uri !== 'string') return null;
  const m = uri.match(/(?:track\/|track:)([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

/**
 * Upgrades Spotify mosaic (60px/300px -> 640px) and Spotify CDN album/track
 * image hashes (64px 4851 / 300px 1e02 -> 640px b273) to full 640x640 HD quality.
 */
export function upgradeSpotifyImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let clean = url.trim();
  if (!clean) return '';

  if (clean.includes('mosaic.scdn.co/')) {
    clean = clean.replace(/mosaic\.scdn\.co\/(?:60|300)\//i, 'mosaic.scdn.co/640/');
  }

  if (clean.includes('scdn.co/') || clean.includes('spotifycdn.com/')) {
    clean = clean.replace(/ab67616d0000(?:4851|1e02)/gi, 'ab67616d0000b273');
  }

  return clean;
}

/**
 * Picks the highest-resolution image URL from a Spotify `sources` array
 * (sorts by width/maxWidth descending so 640px is always chosen over 60px/64px/300px)
 * and upgrades the resulting URL to 640x640 HD.
 */
function pickBestCoverSource(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return '';
  const valid = sources.filter((s) => s && typeof s.url === 'string' && s.url.trim());
  if (valid.length === 0) return '';

  const sorted = [...valid].sort((a, b) => {
    const wA = a.width || a.maxWidth || a.height || a.maxHeight || 0;
    const wB = b.width || b.maxWidth || b.height || b.maxHeight || 0;
    return wB - wA;
  });

  return upgradeSpotifyImageUrl(sorted[0].url);
}

/**
 * Fetches track thumbnail via Spotify oEmbed with a short timeout.
 */
async function fetchTrackThumbnailOembed(trackId, timeoutMs = 2200) {
  if (!trackId) return '';
  try {
    const res = await fetch(
      `https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
    if (res.ok) {
      const data = await res.json();
      return upgradeSpotifyImageUrl(data.thumbnail_url || '');
    }
  } catch {
    // Ignore individual oEmbed timeouts
  }
  return '';
}

/**
 * Parses the base64-encoded <script id="initialState"> from open.spotify.com/{type}/{id}
 * to extract rich per-track album names, 640px HD cover artworks, artist lists, and playlist description.
 */
async function fetchRichInitialState(type, id) {
  try {
    const pageUrl = `https://open.spotify.com/${type}/${id}`;
    const res = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const html = await res.text();

    let ogDescription = '';
    const descMatch =
      html.match(/<meta property="og:description" content="([^"]*)"/i) ||
      html.match(/<meta name="description" content="([^"]*)"/i);
    if (descMatch && descMatch[1]) {
      ogDescription = cleanHtmlText(descMatch[1]);
    }

    let ogImage = '';
    const imgMatch = html.match(/<meta property="og:image" content="([^"]*)"/i);
    if (imgMatch && imgMatch[1]) {
      ogImage = upgradeSpotifyImageUrl(cleanHtmlText(imgMatch[1]));
    }

    const stateMatch = html.match(/<script id="initialState" type="text\/plain">([^<]+)<\/script>/);
    if (!stateMatch || !stateMatch[1]) {
      return { ogDescription, ogImage, entity: null, trackMap: new Map(), orderedTracks: [] };
    }

    const decoded = Buffer.from(stateMatch[1], 'base64').toString('utf8');
    const json = JSON.parse(decoded);
    const items = json.entities?.items || {};
    const entityKey = `spotify:${type}:${id}`;
    const entity = items[entityKey] || Object.values(items)[0] || null;

    const trackMap = new Map();
    const orderedTracks = [];

    if (entity) {
      const rawItems = entity.content?.items || entity.tracksV2?.items || [];
      for (const entry of rawItems) {
        const trackData = entry?.itemV2?.data || entry?.track || entry;
        if (!trackData || (!trackData.name && !trackData.title)) continue;

        const uri = trackData.uri || '';
        const trackId = extractTrackIdFromUri(uri);
        const title = cleanHtmlText(trackData.name || trackData.title || 'Untitled Track');

        const artistsList =
          trackData.artists?.items
            ?.map((a) => a?.profile?.name || a?.name)
            .filter(Boolean)
            .join(', ') || '';

        const albumName = cleanHtmlText(
          trackData.albumOfTrack?.name || entity.name || 'Spotify Single'
        );

        const coverSources =
          trackData.albumOfTrack?.coverArt?.sources ||
          entity.coverArt?.sources ||
          entity.images?.items?.[0]?.sources ||
          [];
        const bestCover = pickBestCoverSource(coverSources);

        const durationMs =
          trackData.duration?.totalMilliseconds ||
          trackData.duration_ms ||
          trackData.duration ||
          180000;
        const durationSec = Math.max(1, Math.round(durationMs / 1000));

        const previewUrl =
          trackData.previews?.audioPreviews?.items?.[0]?.url ||
          trackData.audioPreview?.url ||
          '';

        const richTrack = {
          trackId,
          uri,
          title,
          artist: cleanHtmlText(artistsList) || 'Unknown Artist',
          album: albumName,
          artworkUrl: bestCover,
          duration: durationSec,
          previewUrl,
        };

        if (trackId) {
          trackMap.set(trackId, richTrack);
        }
        orderedTracks.push(richTrack);
      }
    }

    return {
      ogDescription,
      ogImage,
      entity,
      trackMap,
      orderedTracks,
    };
  } catch (err) {
    console.warn('[SpotifyResolver] InitialState extraction skipped:', err.message);
    return null;
  }
}

export async function resolveSpotifyUrl(input) {
  const parsed = parseSpotifyId(input);
  if (!parsed) {
    throw new Error('Invalid or unsupported Spotify link');
  }

  const { type, id } = parsed;

  if (type === 'track') {
    // 1. Try Spotify oEmbed + embed in parallel
    try {
      const [oembedRes, embedRes] = await Promise.allSettled([
        fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${id}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
        }),
        fetch(`https://open.spotify.com/embed/track/${id}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
        }),
      ]);

      let title = 'Unknown Track';
      let artist = 'Various Artists';
      let album = 'Spotify Single';
      let duration = 200;
      let artworkUrl = '';
      let previewUrl = '';

      if (oembedRes.status === 'fulfilled' && oembedRes.value.ok) {
        const data = await oembedRes.value.json();
        title = cleanHtmlText(data.title || title);
        artworkUrl = upgradeSpotifyImageUrl(data.thumbnail_url || '');
      }

      if (embedRes.status === 'fulfilled' && embedRes.value.ok) {
        const html = await embedRes.value.text();
        const tag = 'id="__NEXT_DATA__"';
        const idx = html.indexOf(tag);
        if (idx !== -1) {
          const start = html.indexOf('>', idx) + 1;
          const end = html.indexOf('</script>', start);
          const nextData = JSON.parse(html.substring(start, end));
          const entity = nextData.props?.pageProps?.state?.data?.entity;
          if (entity) {
            title = cleanHtmlText(entity.name || entity.title || title);
            artist = cleanHtmlText(
              entity.artists?.map((a) => a.name).join(', ') || entity.subtitle || artist
            );
            if (entity.duration) {
              duration = Math.max(1, Math.round(entity.duration / 1000));
            }
            previewUrl = entity.audioPreview?.url || '';
            const embedBestCover = pickBestCoverSource(
              entity.coverArt?.sources || entity.visualIdentity?.image || []
            );
            if (embedBestCover) {
              artworkUrl = embedBestCover;
            }
          }
        }
      }

      const streamUrl = `/api/stream/track?artist=${encodeURIComponent(
        artist
      )}&title=${encodeURIComponent(title)}&duration=${duration}${
        previewUrl ? `&preview=${encodeURIComponent(previewUrl)}` : ''
      }`;

      return {
        type: 'track',
        track: {
          id: `spotify_${id}`,
          title,
          artist,
          album,
          duration,
          artworkUrl: upgradeSpotifyImageUrl(artworkUrl),
          source: 'charts',
          sourceId: `spotify_${id}`,
          streamUrl,
          sourceMetadata: {
            format: 'mp3',
            license: 'Spotify Resolved Stream',
            previewUrl,
            fallbackUrl: previewUrl,
          },
        },
      };
    } catch (err) {
      console.warn('[SpotifyResolver] Track resolution failed:', err.message);
      throw new Error('Failed to resolve Spotify track');
    }
  }

  // Handle Playlists and Albums via parallel embed JSON + rich initialState
  if (type === 'playlist' || type === 'album') {
    const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;

    const [embedResult, richStateResult] = await Promise.allSettled([
      fetch(embedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
        signal: AbortSignal.timeout(6000),
      }),
      fetchRichInitialState(type, id),
    ]);

    const richState =
      richStateResult.status === 'fulfilled' ? richStateResult.value : null;
    const richEntity = richState?.entity || null;
    const richTrackMap = richState?.trackMap || new Map();

    let embedEntity = null;
    let embedNextData = null;

    if (embedResult.status === 'fulfilled' && embedResult.value.ok) {
      try {
        const html = await embedResult.value.text();
        const tag = 'id="__NEXT_DATA__"';
        const idx = html.indexOf(tag);
        if (idx !== -1) {
          const start = html.indexOf('>', idx) + 1;
          const end = html.indexOf('</script>', start);
          embedNextData = JSON.parse(html.substring(start, end));
          embedEntity = embedNextData.props?.pageProps?.state?.data?.entity;
        }
      } catch (e) {
        console.warn('[SpotifyResolver] Embed parse error:', e.message);
      }
    }

    if (!embedEntity && !richEntity) {
      throw new Error(`Failed to fetch Spotify ${type}. Ensure the link is a public ${type}.`);
    }

    const collectionTitle = cleanHtmlText(
      richEntity?.name ||
        embedEntity?.title ||
        embedEntity?.name ||
        'Spotify Collection'
    );

    const rawDescription = cleanHtmlText(
      richEntity?.description || richState?.ogDescription || ''
    );

    const ownerName = cleanHtmlText(
      richEntity?.ownerV2?.data?.name ||
        embedEntity?.subtitle ||
        (type === 'album' ? richEntity?.artists?.items?.[0]?.profile?.name : '') ||
        'Spotify'
    );

    const followers =
      typeof richEntity?.followers === 'number' ? richEntity.followers : undefined;

    const allCoverSources = [
      ...(richEntity?.images?.items?.flatMap((item) => item?.sources || []) || []),
      ...(richEntity?.coverArt?.sources || []),
      ...(embedEntity?.coverArt?.sources || []),
      ...(embedEntity?.visualIdentity?.image || []),
      ...(embedNextData?.props?.pageProps?.state?.data?.coverArt?.sources || []),
    ];

    const coverUrl =
      pickBestCoverSource(allCoverSources) ||
      upgradeSpotifyImageUrl(richState?.ogImage || '') ||
      '';

    const rawEmbedTracks = embedEntity?.trackList || [];
    let mergedTracks = [];

    if (rawEmbedTracks.length > 0) {
      mergedTracks = rawEmbedTracks.map((t, index) => {
        const trackId = extractTrackIdFromUri(t.uri);
        const rich = trackId ? richTrackMap.get(trackId) : null;

        const title = cleanHtmlText(rich?.title || t.title || 'Untitled Track');
        const artist = cleanHtmlText(
          rich?.artist || t.subtitle || embedEntity?.subtitle || 'Unknown Artist'
        );
        const album = cleanHtmlText(
          rich?.album || (type === 'album' ? collectionTitle : collectionTitle)
        );
        const duration =
          rich?.duration || Math.max(1, Math.round((t.duration || 180000) / 1000));
        const previewUrl = rich?.previewUrl || t.audioPreview?.url || '';
        const artworkUrl = rich?.artworkUrl || '';

        return {
          index,
          trackId,
          title,
          artist,
          album,
          duration,
          previewUrl,
          artworkUrl,
        };
      });
    } else if (richState?.orderedTracks?.length > 0) {
      mergedTracks = richState.orderedTracks.map((rt, index) => ({
        index,
        trackId: rt.trackId,
        title: rt.title,
        artist: rt.artist,
        album: rt.album || collectionTitle,
        duration: rt.duration,
        previewUrl: rt.previewUrl,
        artworkUrl: rt.artworkUrl || coverUrl,
      }));
    }

    // For any tracks missing individual artwork (e.g. tracks 31-100 in playlist),
    // batch-fetch oEmbed thumbnails in parallel (up to 35 tracks with a fast timeout)
    const missingArtworkItems = mergedTracks.filter(
      (item) => !item.artworkUrl && item.trackId
    );

    if (missingArtworkItems.length > 0 && type === 'playlist') {
      const batch = missingArtworkItems.slice(0, 40);
      await Promise.allSettled(
        batch.map(async (item) => {
          const thumb = await fetchTrackThumbnailOembed(item.trackId, 2000);
          if (thumb) {
            item.artworkUrl = thumb;
          }
        })
      );
    }

    const tracks = mergedTracks.map((item) => {
      const finalArtwork = item.artworkUrl || coverUrl;
      const streamUrl = `/api/stream/track?artist=${encodeURIComponent(
        item.artist
      )}&title=${encodeURIComponent(item.title)}&duration=${item.duration}${
        item.previewUrl ? `&preview=${encodeURIComponent(item.previewUrl)}` : ''
      }`;

      return {
        id: `spotify_${id}_${item.index}`,
        title: item.title,
        artist: item.artist,
        album: item.album || collectionTitle,
        duration: item.duration,
        artworkUrl: finalArtwork,
        source: 'charts',
        sourceId: item.trackId ? `spotify_${item.trackId}` : `spotify_${id}_${item.index}`,
        streamUrl,
        sourceMetadata: {
          format: 'mp3',
          license: 'Spotify Resolved Stream',
          previewUrl: item.previewUrl || undefined,
          fallbackUrl: item.previewUrl || undefined,
        },
      };
    });

    const totalCount =
      richEntity?.content?.totalCount ||
      richEntity?.tracksV2?.totalCount ||
      tracks.length;

    const description =
      rawDescription ||
      (ownerName
        ? `Spotify ${type} by ${ownerName} • ${tracks.length} songs`
        : `Imported from Spotify`);

    return {
      type,
      title: collectionTitle,
      description,
      owner: ownerName,
      followers,
      artworkUrl: coverUrl,
      trackCount: tracks.length,
      totalCount,
      tracks,
    };
  }

  throw new Error('Unsupported Spotify content type');
}
