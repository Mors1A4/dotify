import http from 'http';
import https from 'https';
import { URL } from 'url';

/**
 * Proxy audio streams to bypass CORS and provide byte-range streaming for Icecast and remote audio feeds.
 */
export function handleStreamProxy(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Range, Accept-Ranges, Content-Length, X-Dotify-Preview-Fallback'
    );
    return res.status(204).end();
  }

  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing target url parameter' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  const client = parsedUrl.protocol === 'https:' ? https : http;

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    Accept: '*/*',
  };

  if (req.headers && req.headers.range) {
    headers.Range = req.headers.range;
  }

  const proxyReq = client.get(
    targetUrl,
    {
      headers,
      timeout: 15000,
    },
    (proxyRes) => {
      // Handle redirects (including relative URLs)
      if (
        proxyRes.statusCode &&
        [301, 302, 303, 307, 308].includes(proxyRes.statusCode) &&
        proxyRes.headers.location
      ) {
        const redirectUrl = new URL(proxyRes.headers.location, targetUrl).href;
        req.query.url = redirectUrl;
        return handleStreamProxy(req, res);
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
      res.setHeader(
        'Access-Control-Expose-Headers',
        'Content-Range, Accept-Ranges, Content-Length, X-Dotify-Preview-Fallback'
      );
      res.setHeader('Accept-Ranges', 'bytes');

      const isPreviewFallback =
        res.getHeader('X-Dotify-Preview-Fallback') === 'true' ||
        targetUrl.includes('dzcdn.net');
      if (isPreviewFallback) {
        res.setHeader('X-Dotify-Preview-Fallback', 'true');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=14400');
      }

      if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
        proxyRes.resume();
        if (typeof req.onUpstreamError === 'function') {
          const handler = req.onUpstreamError;
          req.onUpstreamError = null;
          return handler(proxyRes.statusCode);
        }
        const fallback = req.query.fallbackUrl || req.query.preview;
        if (fallback && fallback !== targetUrl) {
          res.setHeader('X-Dotify-Preview-Fallback', 'true');
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          req.query.url = fallback;
          delete req.query.fallbackUrl;
          delete req.query.preview;
          return handleStreamProxy(req, res);
        }
        return res.status(502).json({ error: 'Upstream stream error', upstreamStatus: proxyRes.statusCode });
      }

      if (proxyRes.headers['content-type']) {
        res.setHeader('Content-Type', proxyRes.headers['content-type']);
      }
      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length']);
      }
      if (proxyRes.headers['content-range']) {
        res.setHeader('Content-Range', proxyRes.headers['content-range']);
      }

      res.status(proxyRes.statusCode || 200);

      if (req.method === 'HEAD') {
        proxyRes.destroy();
        return res.end();
      }

      res.socket?.setNoDelay(true);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      if (typeof req.onUpstreamError === 'function') {
        const handler = req.onUpstreamError;
        req.onUpstreamError = null;
        return handler(502);
      }
      res.status(502).json({ error: 'Proxy fetch failed', message: err.message });
    }
  });

  req.on('close', () => {
    proxyReq.destroy();
  });
}
