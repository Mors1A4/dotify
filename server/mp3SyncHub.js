import fs from 'fs';
import path from 'path';
import os from 'os';
import dgram from 'dgram';
import crypto from 'crypto';
import youtubedl from 'youtube-dl-exec';
import ytSearch from 'yt-search';

const UDP_DISCOVERY_PORT = 42889;
const HTTP_PORT = Number(process.env.PORT || 3001);
const DIRECT_AUDIO_FORMAT =
  '140/251/250/249/139/ba[ext=m4a][protocol^=http][protocol!*=m3u8][protocol!*=dash]/ba[protocol^=http][protocol!*=m3u8][protocol!*=dash]/b[ext=mp4][protocol^=http][protocol!*=m3u8][protocol!*=dash]/b[protocol^=http][protocol!*=m3u8][protocol!*=dash]';

export function getMp3StorageDir() {
  const home = os.homedir();
  if (home) {
    const musicDir = path.join(home, 'Music', 'Dotify');
    try {
      fs.mkdirSync(musicDir, { recursive: true });
      return musicDir;
    } catch {
      // Fallback below
    }
  }
  const localAppData = process.env.LOCALAPPDATA || home || '.';
  const fallbackDir = path.join(localAppData, 'dotify', 'mp3s');
  try {
    fs.mkdirSync(fallbackDir, { recursive: true });
  } catch {}
  return fallbackDir;
}

export function getLocalLanIp() {
  const interfaces = os.networkInterfaces();
  let fallbackIp = '127.0.0.1';
  for (const name of Object.keys(interfaces)) {
    const lower = name.toLowerCase();
    if (
      lower.includes('vethernet') ||
      lower.includes('wsl') ||
      lower.includes('docker') ||
      lower.includes('virtual') ||
      lower.includes('vmware') ||
      lower.includes('loopback')
    ) {
      continue;
    }
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (
          iface.address.startsWith('192.168.') ||
          iface.address.startsWith('10.') ||
          /^172\.(1[6-9]|2\d|3[0-1])\./.test(iface.address)
        ) {
          return iface.address;
        }
        fallbackIp = iface.address;
      }
    }
  }
  return fallbackIp;
}

function sanitizeFileName(str) {
  return String(str || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

function makeShortTrackHash(trackId) {
  return crypto.createHash('md5').update(String(trackId || '')).digest('hex').slice(0, 6);
}

export function buildMp3FileName(track) {
  const artist = sanitizeFileName(track.artist || 'Unknown Artist');
  const title = sanitizeFileName(track.title || 'Unknown Track');
  const hash = makeShortTrackHash(track.id || `${artist}-${title}`);
  return `${artist} - ${title} [${hash}].mp3`;
}

const mp3Dir = getMp3StorageDir();
const indexFilePath = path.join(mp3Dir, 'mp3-index.json');

// Persistent local device metadata + saved MP3 index
let indexState = {
  deviceId: `dev_${os.hostname().replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}_${makeShortTrackHash(os.hostname())}`,
  deviceName: `Dotify Desktop (${os.hostname()})`,
  deviceType: 'desktop',
  tracks: [],
  deletedIds: {},
};

// Discovered WiFi peers: ip -> PeerInfo
const discoveredPeers = new Map();

function loadIndexFromDisk() {
  try {
    if (fs.existsSync(indexFilePath)) {
      const parsed = JSON.parse(fs.readFileSync(indexFilePath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        indexState = {
          deviceId: parsed.deviceId || indexState.deviceId,
          deviceName: parsed.deviceName || indexState.deviceName,
          deviceType: parsed.deviceType || 'desktop',
          tracks: Array.isArray(parsed.tracks) ? parsed.tracks : [],
          deletedIds: parsed.deletedIds && typeof parsed.deletedIds === 'object' ? parsed.deletedIds : {},
        };
      }
    }
  } catch (err) {
    console.warn('[Mp3SyncHub] Failed to read mp3-index.json:', err.message);
  }
  reconcileDiskFiles();
}

function saveIndexToDisk() {
  try {
    fs.mkdirSync(mp3Dir, { recursive: true });
    fs.writeFileSync(indexFilePath, JSON.stringify(indexState, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Mp3SyncHub] Failed to write mp3-index.json:', err.message);
  }
}

export function reconcileDiskFiles() {
  try {
    fs.mkdirSync(mp3Dir, { recursive: true });
    const existingFiles = new Set(fs.readdirSync(mp3Dir));

    // 1. Keep only index entries whose .mp3 file actually exists on disk
    const validTracks = [];
    const indexedFiles = new Set();
    for (const t of indexState.tracks) {
      if (t && t.fileName && existingFiles.has(t.fileName)) {
        try {
          const stat = fs.statSync(path.join(mp3Dir, t.fileName));
          if (stat.size > 1024) {
            t.sizeBytes = stat.size;
            validTracks.push(t);
            indexedFiles.add(t.fileName);
          }
        } catch {}
      }
    }

    // 2. Discover any .mp3 files dropped directly into the folder
    for (const fname of existingFiles) {
      if (!fname.toLowerCase().endsWith('.mp3') || indexedFiles.has(fname)) continue;
      try {
        const fullPath = path.join(mp3Dir, fname);
        const stat = fs.statSync(fullPath);
        if (!stat.isFile() || stat.size <= 1024) continue;

        const base = fname.replace(/\.mp3$/i, '').replace(/\s*\[[a-f0-9]{6}\]$/i, '');
        const parts = base.split(' - ');
        const artist = parts.length > 1 ? parts[0].trim() : 'Local MP3';
        const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : base.trim();
        const syntheticId = `mp3:${makeShortTrackHash(fname)}`;

        if (indexState.deletedIds[syntheticId]) continue;

        validTracks.push({
          id: syntheticId,
          title,
          artist,
          album: 'Saved MP3s',
          duration: Math.max(30, Math.round(stat.size / 16000)),
          artworkUrl: '',
          source: 'charts',
          streamUrl: `/api/mp3s/file/${encodeURIComponent(syntheticId)}`,
          fileName: fname,
          sizeBytes: stat.size,
          savedAt: stat.mtimeMs || Date.now(),
          savedReason: 'disk_import',
          originDeviceName: indexState.deviceName,
        });
      } catch {}
    }

    validTracks.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    indexState.tracks = validTracks;
    saveIndexToDisk();
  } catch (err) {
    console.warn('[Mp3SyncHub] Reconcile error:', err.message);
  }
}

function getSummaryStats() {
  let totalSizeBytes = 0;
  for (const t of indexState.tracks) {
    totalSizeBytes += Number(t.sizeBytes || 0);
  }
  return {
    mp3Count: indexState.tracks.length,
    totalSizeBytes,
  };
}

function getPingPayload() {
  const ip = getLocalLanIp();
  const { mp3Count, totalSizeBytes } = getSummaryStats();
  return {
    ok: true,
    app: 'dotify-lan-sync',
    deviceId: indexState.deviceId,
    deviceName: indexState.deviceName,
    deviceType: indexState.deviceType,
    ip,
    port: HTTP_PORT,
    mp3Count,
    totalSizeBytes,
    updatedAt: Date.now(),
  };
}

function recordPeer(peer) {
  if (!peer || peer.app !== 'dotify-lan-sync') return;
  if (!peer.ip || peer.ip === '127.0.0.1' || peer.deviceId === indexState.deviceId) return;
  const localIp = getLocalLanIp();
  if (peer.ip === localIp && peer.port === HTTP_PORT) return;

  discoveredPeers.set(peer.ip, {
    deviceId: peer.deviceId || `peer_${peer.ip}`,
    deviceName: peer.deviceName || `Dotify (${peer.ip})`,
    deviceType: peer.deviceType || 'desktop',
    ip: peer.ip,
    port: Number(peer.port || 3001),
    mp3Count: Number(peer.mp3Count || 0),
    totalSizeBytes: Number(peer.totalSizeBytes || 0),
    lastSeen: Date.now(),
  });
}

async function probePeerIp(ip, port = 3001, timeoutMs = 450) {
  const localIp = getLocalLanIp();
  if (!ip || ip === '127.0.0.1' || ip === 'localhost' || (ip === localIp && port === HTTP_PORT)) {
    return null;
  }
  try {
    const res = await fetch(`http://${ip}:${port}/api/mp3s/ping`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.app === 'dotify-lan-sync' && data.deviceId !== indexState.deviceId) {
      const peerObj = {
        ...data,
        ip,
        port,
      };
      recordPeer(peerObj);
      return discoveredPeers.get(ip) || peerObj;
    }
  } catch {}
  return null;
}

let isScanningSubnet = false;
export async function scanLanSubnetForPeers() {
  if (isScanningSubnet) {
    return Array.from(discoveredPeers.values());
  }
  isScanningSubnet = true;
  try {
    const localIp = getLocalLanIp();
    const parts = localIp.split('.');
    if (parts.length === 4 && localIp !== '127.0.0.1') {
      const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
      const myHost = Number(parts[3]);
      const ips = [];
      for (let i = 1; i <= 254; i++) {
        if (i !== myHost) ips.push(`${prefix}.${i}`);
      }

      // Scan in batches of 32 concurrent probes (400ms timeout -> ~2.5s max, usually <400ms for active peers)
      const batchSize = 32;
      for (let i = 0; i < ips.length; i += batchSize) {
        const slice = ips.slice(i, i + batchSize);
        await Promise.allSettled(slice.map((ip) => probePeerIp(ip, 3001, 380)));
      }
    }
  } finally {
    isScanningSubnet = false;
  }
  return Array.from(discoveredPeers.values());
}

async function resolveStreamUrlViaYtdlp(track) {
  const query = `${track.artist || ''} ${track.title || ''} official audio`.trim();
  if (!query) return null;
  try {
    const searchRes = await ytSearch(query);
    const videos = (searchRes?.videos || []).filter(
      (v) => v?.url && (!v.seconds || (v.seconds >= 40 && v.seconds <= 900))
    );
    for (const v of videos.slice(0, 3)) {
      try {
        const out = await youtubedl(v.url, {
          getUrl: true,
          format: DIRECT_AUDIO_FORMAT,
          noWarnings: true,
          noPlaylist: true,
        });
        const cleanUrl = String(out || '')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l.startsWith('http') && !l.includes('.m3u8') && !l.includes('/manifest/'));
        if (cleanUrl) return cleanUrl;
      } catch {}
    }
  } catch (err) {
    console.warn('[Mp3SyncHub] yt-dlp resolution failed:', err.message);
  }
  return null;
}

const activeDownloads = new Map();

async function saveTrackToDisk(track, options = {}) {
  if (!track || !track.id) {
    throw new Error('Invalid track metadata');
  }
  if (track.source === 'radio') {
    throw new Error('Live radio streams cannot be saved as static MP3 files');
  }

  reconcileDiskFiles();
  const existing = indexState.tracks.find((t) => t.id === track.id);
  if (existing && fs.existsSync(path.join(mp3Dir, existing.fileName))) {
    // Un-tombstone if manually saved
    if (options.reason === 'manual_download' && indexState.deletedIds[track.id]) {
      delete indexState.deletedIds[track.id];
      saveIndexToDisk();
    }
    return existing;
  }

  if (activeDownloads.has(track.id)) {
    return activeDownloads.get(track.id);
  }

  const task = (async () => {
    const fileName = buildMp3FileName(track);
    const destPath = path.join(mp3Dir, fileName);
    const tmpPath = `${destPath}.tmp`;

    try {
      fs.mkdirSync(mp3Dir, { recursive: true });

      if (options.audioBuffer && Buffer.isBuffer(options.audioBuffer) && options.audioBuffer.length > 1024) {
        fs.writeFileSync(tmpPath, options.audioBuffer);
      } else if (options.sourceUrl) {
        const res = await fetch(options.sourceUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
          },
        });
        if (!res.ok) {
          throw new Error(`Upstream HTTP ${res.status}`);
        }
        const arrBuf = await res.arrayBuffer();
        const buf = Buffer.from(arrBuf);
        if (buf.length <= 1024) {
          throw new Error('Downloaded audio buffer is empty');
        }
        fs.writeFileSync(tmpPath, buf);
      } else {
        // Resolve full stream URL via yt-dlp or direct streamUrl
        let targetUrl = null;
        const rawUrl = String(track.streamUrl || '');
        if (
          rawUrl.startsWith('http') &&
          !rawUrl.includes('dzcdn.net') &&
          !rawUrl.includes('/api/stream/track')
        ) {
          targetUrl = rawUrl;
        } else {
          targetUrl = await resolveStreamUrlViaYtdlp(track);
        }

        if (!targetUrl) {
          throw new Error('Could not resolve full-length audio stream for MP3 download');
        }

        const res = await fetch(targetUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
          },
        });
        if (!res.ok) {
          throw new Error(`Audio download failed with HTTP ${res.status}`);
        }
        const arrBuf = await res.arrayBuffer();
        const buf = Buffer.from(arrBuf);
        const isSuspectedPreview =
          (!track.duration || track.duration > 60) && buf.length >= 100_000 && buf.length <= 520_000;
        if (isSuspectedPreview) {
          throw new Error('Rejected 30-second preview clip; full track required');
        }
        fs.writeFileSync(tmpPath, buf);
      }

      const stat = fs.statSync(tmpPath);
      if (stat.size <= 1024) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {}
        throw new Error('Saved MP3 file too small');
      }

      try {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      } catch {}
      fs.renameSync(tmpPath, destPath);

      // Clear any previous deletion tombstone
      delete indexState.deletedIds[track.id];

      const entry = {
        id: track.id,
        title: track.title || 'Unknown Track',
        artist: track.artist || 'Unknown Artist',
        album: track.album || '',
        duration: Number(track.duration) || Math.round(stat.size / 16000),
        artworkUrl: track.artworkUrl || '',
        source: track.source || 'charts',
        streamUrl: `/api/mp3s/file/${encodeURIComponent(track.id)}`,
        fileName,
        sizeBytes: stat.size,
        savedAt: Date.now(),
        savedReason: options.reason || 'manual_download',
        originDeviceName: options.originDeviceName || indexState.deviceName,
      };

      indexState.tracks = [entry, ...indexState.tracks.filter((t) => t.id !== track.id)];
      saveIndexToDisk();
      return entry;
    } finally {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {}
      activeDownloads.delete(track.id);
    }
  })();

  activeDownloads.set(track.id, task);
  return task;
}

export function setupMp3SyncHub(app) {
  loadIndexFromDisk();

  // Start UDP LAN Discovery Socket on port 42889
  try {
    const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    udp.on('error', (err) => {
      console.debug('[Mp3SyncHub] UDP discovery socket warning:', err.message);
    });
    udp.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString('utf8'));
        if (data && data.app === 'dotify-lan-sync') {
          recordPeer({
            ...data,
            ip: rinfo.address || data.ip,
          });
        }
      } catch {}
    });
    udp.bind(UDP_DISCOVERY_PORT, '0.0.0.0', () => {
      try {
        udp.setBroadcast(true);
      } catch {}
      const sendBeacon = () => {
        try {
          const payload = Buffer.from(JSON.stringify(getPingPayload()), 'utf8');
          udp.send(payload, 0, payload.length, UDP_DISCOVERY_PORT, '255.255.255.255');
          const ip = getLocalLanIp();
          const parts = ip.split('.');
          if (parts.length === 4 && ip !== '127.0.0.1') {
            const subnetBroadcast = `${parts[0]}.${parts[1]}.${parts[2]}.255`;
            udp.send(payload, 0, payload.length, UDP_DISCOVERY_PORT, subnetBroadcast);
          }
        } catch {}
      };
      sendBeacon();
      setInterval(sendBeacon, 4000);
    });
  } catch (err) {
    console.debug('[Mp3SyncHub] UDP setup skipped:', err.message);
  }

  // Trigger an initial background subnet scan shortly after startup
  setTimeout(() => {
    scanLanSubnetForPeers().catch(() => {});
  }, 1500);

  // 1. Ping endpoint for fast LAN peer discovery
  app.get('/api/mp3s/ping', (req, res) => {
    res.json(getPingPayload());
  });

  // 2. List all saved MP3s + discovered peers + deletion tombstones
  app.get('/api/mp3s/list', (req, res) => {
    reconcileDiskFiles();
    const { mp3Count, totalSizeBytes } = getSummaryStats();
    res.json({
      ok: true,
      deviceId: indexState.deviceId,
      deviceName: indexState.deviceName,
      deviceType: indexState.deviceType,
      ip: getLocalLanIp(),
      port: HTTP_PORT,
      mp3Dir,
      mp3Count,
      totalSizeBytes,
      tracks: indexState.tracks,
      deletedIds: indexState.deletedIds,
      peers: Array.from(discoveredPeers.values()),
    });
  });

  // 3. Stream or download a saved MP3 file by trackId
  app.get('/api/mp3s/file/:trackId', (req, res) => {
    const trackId = decodeURIComponent(req.params.trackId || '');
    const entry = indexState.tracks.find((t) => t.id === trackId);
    if (!entry || !entry.fileName) {
      return res.status(404).json({ ok: false, error: 'Saved MP3 not found' });
    }
    const fullPath = path.join(mp3Dir, entry.fileName);
    if (!fs.existsSync(fullPath)) {
      reconcileDiskFiles();
      return res.status(404).json({ ok: false, error: 'MP3 file missing on disk' });
    }

    const stat = fs.statSync(fullPath);
    const total = stat.size;
    const safeDownloadName = entry.fileName.replace(/[^\x20-\x7E]/g, '_');

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `inline; filename="${safeDownloadName}"`);

    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d+)-(\d*)/.exec(range);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? Math.min(total - 1, parseInt(match[2], 10)) : total - 1;
        if (start < total && start <= end) {
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
          res.setHeader('Content-Length', String(end - start + 1));
          return fs.createReadStream(fullPath, { start, end }).pipe(res);
        }
      }
    }

    res.status(200);
    res.setHeader('Content-Length', String(total));
    fs.createReadStream(fullPath).pipe(res);
  });

  // 4. Save / Download a track as MP3 (accepts audioBase64, sourceUrl, or resolves via yt-dlp)
  app.post('/api/mp3s/save', expressJsonLarge(), async (req, res) => {
    try {
      const { track, reason = 'manual_download', audioBase64, sourceUrl, originDeviceName } = req.body || {};
      if (!track || !track.id) {
        return res.status(400).json({ ok: false, error: 'Missing track object' });
      }
      let audioBuffer = null;
      if (audioBase64 && typeof audioBase64 === 'string') {
        const cleanB64 = audioBase64.replace(/^data:[^;]+;base64,/, '');
        audioBuffer = Buffer.from(cleanB64, 'base64');
      }
      const entry = await saveTrackToDisk(track, {
        reason,
        audioBuffer,
        sourceUrl,
        originDeviceName,
      });
      res.json({ ok: true, entry });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || 'Failed to save MP3' });
    }
  });

  // 5. Delete & Clean up tracks (single track, multiple, unliked cleanup, or delete all)
  app.post('/api/mp3s/delete', async (req, res) => {
    try {
      const { id, ids, mode, keepIds = [], propagate = false } = req.body || {};
      reconcileDiskFiles();

      const keepSet = new Set(Array.isArray(keepIds) ? keepIds : []);
      const targetIds = new Set();

      if (mode === 'all') {
        for (const t of indexState.tracks) targetIds.add(t.id);
      } else if (mode === 'unliked') {
        for (const t of indexState.tracks) {
          if (!keepSet.has(t.id)) targetIds.add(t.id);
        }
      } else {
        if (id) targetIds.add(String(id));
        if (Array.isArray(ids)) {
          for (const item of ids) targetIds.add(String(item));
        }
      }

      const now = Date.now();
      let deletedCount = 0;

      for (const t of indexState.tracks) {
        if (targetIds.has(t.id)) {
          const fullPath = path.join(mp3Dir, t.fileName);
          try {
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          } catch {}
          indexState.deletedIds[t.id] = now;
          deletedCount++;
        }
      }

      // Also record tombstones even if the track wasn't currently on disk
      for (const tid of targetIds) {
        indexState.deletedIds[tid] = now;
      }

      indexState.tracks = indexState.tracks.filter((t) => !targetIds.has(t.id));
      saveIndexToDisk();

      // Propagate deletion across discovered WiFi peers if requested
      if (propagate && targetIds.size > 0) {
        const peers = Array.from(discoveredPeers.values());
        await Promise.allSettled(
          peers.map((p) =>
            fetch(`http://${p.ip}:${p.port || 3001}/api/mp3s/delete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ids: Array.from(targetIds),
                propagate: false,
              }),
              signal: AbortSignal.timeout(2500),
            })
          )
        );
      }

      res.json({
        ok: true,
        deletedCount,
        tracks: indexState.tracks,
        deletedIds: indexState.deletedIds,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 6. Peers list, manual IP registration & LAN scan
  app.get('/api/mp3s/peers', (req, res) => {
    res.json({
      ok: true,
      localDevice: getPingPayload(),
      peers: Array.from(discoveredPeers.values()),
    });
  });

  app.post('/api/mp3s/scan', async (req, res) => {
    const peers = await scanLanSubnetForPeers();
    res.json({
      ok: true,
      localDevice: getPingPayload(),
      peers,
    });
  });

  app.post('/api/mp3s/peers/add', async (req, res) => {
    const rawIp = String(req.body?.ip || '').trim();
    if (!rawIp) {
      return res.status(400).json({ ok: false, error: 'Missing IP address' });
    }
    const cleanHost = rawIp.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    const [ipPart, portPart] = cleanHost.split(':');
    const port = Number(portPart || 3001);
    const peer = await probePeerIp(ipPart, port, 2500);
    if (!peer) {
      return res.status(404).json({
        ok: false,
        error: `No Dotify device responded at ${ipPart}:${port}`,
      });
    }
    res.json({
      ok: true,
      peer,
      peers: Array.from(discoveredPeers.values()),
    });
  });

  // 7. Pull missing MP3s from all discovered WiFi peers (or a specific peer)
  app.post('/api/mp3s/sync-from-peers', async (req, res) => {
    try {
      const { targetPeerIp, forceTrackId } = req.body || {};
      const peers = targetPeerIp
        ? [discoveredPeers.get(targetPeerIp) || { ip: targetPeerIp, port: 3001 }]
        : Array.from(discoveredPeers.values());

      const pulled = [];
      for (const peer of peers) {
        if (!peer || !peer.ip) continue;
        try {
          const listRes = await fetch(`http://${peer.ip}:${peer.port || 3001}/api/mp3s/list`, {
            signal: AbortSignal.timeout(3000),
          });
          if (!listRes.ok) continue;
          const peerData = await listRes.json();
          recordPeer({
            ...peerData,
            app: 'dotify-lan-sync',
            ip: peer.ip,
            port: peer.port || 3001,
          });

          const peerTracks = Array.isArray(peerData.tracks) ? peerData.tracks : [];
          for (const pt of peerTracks) {
            if (!pt || !pt.id) continue;
            if (forceTrackId && pt.id !== forceTrackId) continue;
            if (!forceTrackId && indexState.deletedIds[pt.id]) continue;
            const alreadyLocal = indexState.tracks.some((t) => t.id === pt.id);
            if (alreadyLocal && !forceTrackId) continue;

            const fileUrl = `http://${peer.ip}:${peer.port || 3001}/api/mp3s/file/${encodeURIComponent(pt.id)}`;
            try {
              const saved = await saveTrackToDisk(pt, {
                reason: 'wifi_sync',
                sourceUrl: fileUrl,
                originDeviceName: peerData.deviceName || peer.deviceName || peer.ip,
              });
              if (saved) pulled.push(saved);
            } catch (pullErr) {
              console.warn(`[Mp3SyncHub] Failed pulling ${pt.title} from ${peer.ip}:`, pullErr.message);
            }
          }
        } catch {}
      }

      res.json({
        ok: true,
        pulledCount: pulled.length,
        pulled,
        tracks: indexState.tracks,
        peers: Array.from(discoveredPeers.values()),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 8. Open MP3 folder in OS file explorer (Windows/macOS/Linux)
  app.post('/api/mp3s/open-folder', async (req, res) => {
    try {
      fs.mkdirSync(mp3Dir, { recursive: true });
      const { exec } = await import('child_process');
      if (process.platform === 'win32') {
        exec(`explorer.exe "${mp3Dir}"`);
      } else if (process.platform === 'darwin') {
        exec(`open "${mp3Dir}"`);
      } else {
        exec(`xdg-open "${mp3Dir}"`);
      }
      res.json({ ok: true, path: mp3Dir });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}

function expressJsonLarge() {
  return (req, res, next) => next();
}
