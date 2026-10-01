import http from 'http';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleStreamProxy } from './streamProxy.js';
import { handleTrackStream } from './trackResolver.js';
import { setupConnectHub } from './connectHub.js';
import { resolveSpotifyUrl, isSpotifyUrl } from './spotifyResolver.js';
import { getDiscoveredCastDevices, scanForCastDevices, probeEurekaDevice } from './castHub.js';
import { setupMp3SyncHub } from './mp3SyncHub.js';
import { startUpgradeWorker } from './upgradeWorker.js';
import ytSearch from 'yt-search';

// Prevent unhandled network socket/TLS/stream errors from terminating backend
process.on('uncaughtException', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.warn('[dotify server] Port already in use. HTTP listener skipped, background worker remains active.');
    return;
  }
  console.error('[dotify server] Uncaught exception safely intercepted:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[dotify server] Unhandled rejection safely intercepted:', reason);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const authHtmlPath = path.resolve(__dirname, '../src-tauri/src/auth.html');
let cachedAuthHtml = '';
try {
  if (fs.existsSync(authHtmlPath)) {
    cachedAuthHtml = fs.readFileSync(authHtmlPath, 'utf8');
  }
} catch {
  // Ignored
}

let latestAuthPayload = null;
let latestAuthTime = 0;

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
setupMp3SyncHub(app);
startUpgradeWorker(app);

// External browser Google Auth portal & callback
app.get('/login', (req, res) => {
  try {
    if (fs.existsSync(authHtmlPath)) {
      const html = fs.readFileSync(authHtmlPath, 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
  } catch {}
  if (cachedAuthHtml) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(cachedAuthHtml);
  }
  res.status(404).send('Auth page not found');
});

app.post('/callback', (req, res) => {
  latestAuthPayload = req.body;
  latestAuthTime = Date.now();
  res.json({ ok: true });
});

app.get('/api/auth/latest', (req, res) => {
  const maxAge = 120000;
  if (latestAuthPayload && Date.now() - latestAuthTime < maxAge) {
    const payload = latestAuthPayload;
    latestAuthPayload = null;
    return res.json({ ok: true, payload });
  }
  res.json({ ok: false });
});

// User Library & History Synchronization across devices
const userLibraryDir = path.resolve(__dirname, 'data/users');
try {
  if (!fs.existsSync(userLibraryDir)) {
    fs.mkdirSync(userLibraryDir, { recursive: true });
  }
} catch {}

app.get('/api/user/:userId/library', (req, res) => {
  const { userId } = req.params;
  const filePath = path.join(userLibraryDir, `${encodeURIComponent(userId)}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return res.json({ ok: true, library: data });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'Read error' });
    }
  }
  res.json({ ok: false, message: 'No remote library found' });
});

app.post('/api/user/:userId/library', (req, res) => {
  const { userId } = req.params;
  const filePath = path.join(userLibraryDir, `${encodeURIComponent(userId)}.json`);
  try {
    const payload = {
      likedTracks: req.body.likedTracks || [],
      playlists: req.body.playlists || [],
      history: req.body.history || [],
      followedArtists: req.body.followedArtists || [],
      lastUpdated: req.body.lastUpdated || Date.now(),
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    res.json({ ok: true, lastUpdated: payload.lastUpdated });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', name: 'dotify-backend', time: new Date().toISOString() });
});

// Google Cast & Smart Speaker discovery endpoints
app.get('/api/cast/devices', (req, res) => {
  res.json({ devices: getDiscoveredCastDevices() });
});

app.post('/api/cast/scan', async (req, res) => {
  try {
    const devices = await scanForCastDevices();
    res.json({ ok: true, devices });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.all('/api/cast/probe', async (req, res) => {
  try {
    const ip = req.query.ip || req.body?.ip;
    if (!ip) return res.status(400).json({ ok: false, error: 'IP required' });
    const dev = await probeEurekaDevice(String(ip).trim());
    res.json({ ok: true, device: dev, devices: getDiscoveredCastDevices() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Audio stream proxy (bypasses CORS for Icecast radio & external streams)
app.get('/api/stream/proxy', handleStreamProxy);

// Universal audio track stream resolver & proxy (YouTube audio extraction + preview fallback)
app.get('/api/stream/track', handleTrackStream);

// YouTube search candidates for unified desktop/web resolution
app.get('/api/search/youtube', async (req, res) => {
  try {
    const q = String(req.query.q || req.query.query || '').trim();
    if (!q) return res.json([]);
    const searchRes = await ytSearch(q);
    const videos = (searchRes?.videos || []).slice(0, 10).map((v) => ({
      videoId: v.videoId,
      title: v.title,
      duration: v.seconds || 0,
    }));
    res.json(videos);
  } catch (err) {
    res.status(502).json({ error: err.message, data: [] });
  }
});

// Top Charts & Mainstream Artists API (Deezer charts & search)
app.get('/api/charts/tracks', async (req, res) => {
  try {
    const limit = req.query.limit || 50;
    const upstream = await fetch(`https://api.deezer.com/chart/0/tracks?limit=${limit}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
    });
    if (!upstream.ok) return res.status(upstream.status).json({ data: [] });
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ data: [], error: err.message });
  }
});

app.get('/api/charts/artists', async (req, res) => {
  try {
    const limit = req.query.limit || 25;
    const upstream = await fetch(`https://api.deezer.com/chart/0/artists?limit=${limit}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
    });
    if (!upstream.ok) return res.status(upstream.status).json({ data: [] });
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ data: [], error: err.message });
  }
});

app.get('/api/charts/artist/:id', async (req, res) => {
  try {
    const upstream = await fetch(`https://api.deezer.com/artist/${encodeURIComponent(req.params.id)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'Artist not found' });
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/charts/artist/:id/top', async (req, res) => {
  try {
    const limit = req.query.limit || 30;
    const upstream = await fetch(`https://api.deezer.com/artist/${encodeURIComponent(req.params.id)}/top?limit=${limit}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
    });
    if (!upstream.ok) return res.status(upstream.status).json({ data: [] });
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ data: [], error: err.message });
  }
});

app.get('/api/charts/artist/:id/albums', async (req, res) => {
  try {
    const limit = req.query.limit || 25;
    const upstream = await fetch(`https://api.deezer.com/artist/${encodeURIComponent(req.params.id)}/albums?limit=${limit}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
    });
    if (!upstream.ok) return res.status(upstream.status).json({ data: [] });
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ data: [], error: err.message });
  }
});

app.get('/api/charts/album/:id/tracks', async (req, res) => {
  try {
    const upstream = await fetch(`https://api.deezer.com/album/${encodeURIComponent(req.params.id)}/tracks?limit=50`, {
      headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
    });
    if (!upstream.ok) return res.status(upstream.status).json({ data: [] });
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ data: [], error: err.message });
  }
});

app.get('/api/charts/artist/:id/related', async (req, res) => {
  try {
    const limit = req.query.limit || 15;
    const upstream = await fetch(`https://api.deezer.com/artist/${encodeURIComponent(req.params.id)}/related?limit=${limit}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
    });
    if (!upstream.ok) return res.status(upstream.status).json({ data: [] });
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ data: [], error: err.message });
  }
});

app.get('/api/charts/search/artist', async (req, res) => {
  try {
    const q = req.query.q || '';
    const limit = req.query.limit || 10;
    if (!q.trim()) return res.json({ data: [] });
    const upstream = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&limit=${limit}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
    });
    if (!upstream.ok) return res.status(upstream.status).json({ data: [] });
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ data: [], error: err.message });
  }
});

app.get('/api/charts/search/album', async (req, res) => {
  try {
    const q = req.query.q || '';
    const limit = req.query.limit || 10;
    if (!q.trim()) return res.json({ data: [] });
    const upstream = await fetch(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=${limit}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
    });
    if (!upstream.ok) return res.status(upstream.status).json({ data: [] });
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ data: [], error: err.message });
  }
});

app.get('/api/charts/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const limit = req.query.limit || 30;
    if (!q.trim()) return res.json({ data: [] });
    const upstream = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${limit}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
    });
    if (!upstream.ok) return res.status(upstream.status).json({ data: [] });
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ data: [], error: err.message });
  }
});

// Open Spotify track, playlist, and album resolver (no API keys required)
app.get('/api/spotify/resolve', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing Spotify url parameter' });
  }
  try {
    const data = await resolveSpotifyUrl(targetUrl);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unknown API routes return structured 404 JSON
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// Serve frontend dist for production/preview
const distPath = path.resolve(__dirname, '../dist');

app.use(express.static(distPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) res.status(200).send('dotify server active');
  });
});

const server = http.createServer(app);
setupConnectHub(server);

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.warn(`[dotify server] Port ${PORT} already bound by another process. Background services and UpgradeWorker remain fully active.`);
    return;
  }
  console.error('[dotify server] Server error:', err.message);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[dotify] Streaming, Connect & WiFi MP3 Sync backend active at http://0.0.0.0:${PORT}`);
});
