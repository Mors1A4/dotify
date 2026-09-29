import dgram from 'dgram';
import http from 'http';
import os from 'os';
import { Client, DefaultMediaReceiver } from 'castv2-client';

/**
 * Google Cast / Google Home / Nest Audio Discovery and Playback Controller.
 * Discovers smart speakers via mDNS and HTTP Eureka probe, connects via Cast V2
 * on port 8009, and coordinates media playback with Dotify Connect Hub.
 */

// In-memory cache of discovered Cast devices: deviceId -> CastDeviceInfo
const discoveredSpeakers = new Map();

// Active cast media session
let activeCastClient = null;
let activeCastPlayer = null;
let activeCastDeviceId = null;
let activeCastSessionTrack = null;
let activeCastPlaybackState = null;

// Callbacks wired to ConnectHub
let onDevicesUpdatedCallback = null;
let onPlaybackStateCallback = null;
let onTrackFinishedCallback = null;

// Throttled volume state for Cast speakers to avoid TLS socket flooding
let pendingCastVolume = null;
let castVolumeTimer = null;
let isSettingCastVolume = false;

/**
 * Detect the primary LAN IPv4 address of this machine (e.g. 192.168.0.157)
 */
export function getLocalLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('172.') && !net.address.startsWith('169.254.')) {
        return net.address;
      }
    }
  }
  // Fallback to any non-internal IPv4
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Convert local / relative stream URLs to LAN-accessible URLs for Google Home
 */
export function makeLanStreamUrl(url, port = 3001) {
  if (!url) return '';
  const lanIp = getLocalLanIp();
  if (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:')) {
    return url.replace(/http:\/\/(localhost|127\.0\.0\.1):\d+/, `http://${lanIp}:${port}`);
  }
  if (url.startsWith('/api/')) {
    return `http://${lanIp}:${port}${url}`;
  }
  return url;
}

/**
 * Query Eureka info on HTTP port 8008 for a given IP address
 */
export async function probeEurekaDevice(ip) {
  return new Promise((resolve) => {
    const req = http.get(
      `http://${ip}:8008/setup/eureka_info?params=name,device_info`,
      { timeout: 2000 },
      (res) => {
        if (res.statusCode !== 200) {
          return resolve(null);
        }
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data && data.name) {
              const deviceId = `cast:${ip}:8009`;
              const dev = {
                deviceId,
                deviceName: data.name || 'Google Home Speaker',
                deviceType: 'speaker',
                role: 'active_host',
                isCurrentDevice: false,
                isActive: deviceId === activeCastDeviceId,
                volume: 0.7,
                lastSeen: Date.now(),
                capabilities: {
                  canPlayAudio: true,
                  isController: false,
                },
                castDetails: {
                  ip,
                  port: 8009,
                  model: data.device_info?.model_name || 'Google Cast Speaker',
                  udn: data.ssdp_udn || '',
                },
              };
              registerDiscoveredSpeaker(dev);
              return resolve(dev);
            }
          } catch {}
          resolve(null);
        });
      }
    );

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function registerDiscoveredSpeaker(dev) {
  const isNew = !discoveredSpeakers.has(dev.deviceId);
  discoveredSpeakers.set(dev.deviceId, {
    ...dev,
    lastSeen: Date.now(),
  });

  if (isNew) {
    console.log(`[CastHub] Discovered Google Home speaker: "${dev.deviceName}" (${dev.castDetails?.ip})`);
  }

  if (onDevicesUpdatedCallback) {
    onDevicesUpdatedCallback(getDiscoveredCastDevices());
  }
}

/**
 * Perform an mDNS multicast query for _googlecast._tcp.local
 */
export function sendMdnsCastQuery() {
  try {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('message', (msg, rinfo) => {
      const str = msg.toString('latin1');
      if (
        str.includes('_googlecast') ||
        str.includes('Google-Home') ||
        str.includes('Chromecast') ||
        str.includes('Nest')
      ) {
        probeEurekaDevice(rinfo.address);
      }
    });

    socket.on('error', (err) => {
      console.debug('[CastHub] mDNS socket error:', err.message);
      try { socket.close(); } catch {}
    });

    socket.bind(0, () => {
      try {
        socket.addMembership('224.0.0.251');
      } catch {}

      // PTR query for _googlecast._tcp.local
      const query = Buffer.from([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        11, 0x5f, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x63, 0x61, 0x73, 0x74,
        4, 0x5f, 0x74, 0x63, 0x70,
        5, 0x6c, 0x6f, 0x63, 0x61, 0x6c,
        0x00, 0x00, 0x0c, 0x00, 0x01,
      ]);

      socket.send(query, 5353, '224.0.0.251', () => {
        setTimeout(() => {
          try { socket.close(); } catch {}
        }, 4000);
      });
    });
  } catch (err) {
    console.debug('[CastHub] Failed to start mDNS query:', err.message);
  }
}

/**
 * Scan local subnet range around primary LAN IP for Eureka port 8008
 */
export async function scanSubnetForEureka() {
  const lanIp = getLocalLanIp();
  if (!lanIp || lanIp === '127.0.0.1') return;

  const parts = lanIp.split('.');
  if (parts.length !== 4) return;
  const prefix = `${parts[0]}.${parts[1]}.${parts[2]}.`;
  const currentHost = parseInt(parts[3], 10);

  // Scan host IPs in parallel batches of 25
  const targets = [];
  for (let i = 1; i <= 254; i++) {
    if (i !== currentHost) {
      targets.push(`${prefix}${i}`);
    }
  }

  const batchSize = 30;
  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);
    await Promise.allSettled(batch.map((ip) => probeEurekaDevice(ip)));
  }
}

/**
 * Trigger a full active scan for Cast devices across mDNS and subnet
 */
export async function scanForCastDevices() {
  sendMdnsCastQuery();
  // Probe common IPs and cached devices first
  for (const dev of discoveredSpeakers.values()) {
    if (dev.castDetails?.ip) {
      probeEurekaDevice(dev.castDetails.ip);
    }
  }
  // Also scan subnet
  await scanSubnetForEureka();
  return getDiscoveredCastDevices();
}

/**
 * Get array of all currently known Cast devices
 */
export function getDiscoveredCastDevices() {
  return Array.from(discoveredSpeakers.values()).map((d) => ({
    ...d,
    isActive: d.deviceId === activeCastDeviceId,
  }));
}

/**
 * Connect to a Google Cast device and cast media
 */
export async function playOnCastDevice(deviceId, track, options = {}) {
  const speaker = discoveredSpeakers.get(deviceId);
  if (!speaker || !speaker.castDetails) {
    throw new Error(`Cast device ${deviceId} not found`);
  }

  const { ip } = speaker.castDetails;
  const rawStreamUrl = track.streamUrl || '';
  const streamUrl = makeLanStreamUrl(rawStreamUrl);
  const positionSeconds = Math.max(0, (options.positionMs || 0) / 1000);
  const targetVolume = options.volume ?? speaker.volume ?? 0.7;

  // If already connected to this device, stop existing player
  if (activeCastClient && activeCastDeviceId === deviceId) {
    if (activeCastPlayer) {
      try {
        await new Promise((res) => activeCastPlayer.stop(res));
      } catch {}
    }
  } else {
    // Close any previous connection
    closeActiveCastSession();
  }

  return new Promise((resolve, reject) => {
    const client = new Client();

    // Guard against unhandled client errors immediately
    client.on('error', (err) => {
      console.warn(`[CastHub] Cast client error for ${ip}:`, err.message);
      closeActiveCastSession();
    });

    const timeout = setTimeout(() => {
      try { client.close(); } catch {}
      reject(new Error(`Timeout connecting to Google Cast speaker at ${ip}`));
    }, 10000);

    client.connect(ip, () => {
      clearTimeout(timeout);
      activeCastClient = client;
      activeCastDeviceId = deviceId;
      activeCastSessionTrack = track;

      // Update speaker volume safely
      setCastVolumeThrottled(targetVolume);

      client.launch(DefaultMediaReceiver, (err, player) => {
        if (err) {
          closeActiveCastSession();
          return reject(err);
        }

        activeCastPlayer = player;

        // Guard against player errors
        player.on('error', (playerErr) => {
          console.warn('[CastHub] Cast player error:', playerErr.message);
        });

        const media = {
          contentId: streamUrl,
          contentType: 'audio/mp3',
          streamType: 'BUFFERED',
          metadata: {
            type: 0,
            metadataType: 0,
            title: track.title || 'Unknown Track',
            artist: track.artist || 'Unknown Artist',
            albumName: track.album || 'Dotify Music',
            images: track.coverUrl ? [{ url: makeLanStreamUrl(track.coverUrl) }] : [],
          },
        };

        player.load(media, { autoplay: true, currentTime: positionSeconds }, (loadErr, status) => {
          if (loadErr) {
            console.warn('[CastHub] Error loading media on speaker:', loadErr.message);
            return reject(loadErr);
          }

          console.log(`[CastHub] Now casting "${track.title}" to ${speaker.deviceName}`);

          // Set initial active state
          activeCastPlaybackState = {
            currentTrack: track,
            isPlaying: true,
            positionMs: Math.round(positionSeconds * 1000),
            durationMs: (track.duration || 0) * 1000,
            volume: targetVolume,
            timestamp: Date.now(),
          };

          if (onPlaybackStateCallback) {
            onPlaybackStateCallback(activeCastPlaybackState, activeCastDeviceId);
          }

          resolve({ success: true, status });
        });

        // Listen for playback status changes
        player.on('status', (status) => {
          if (!status) return;

          const isPlaying = status.playerState === 'PLAYING';
          const isPaused = status.playerState === 'PAUSED';
          const currentTime = status.currentTime || 0;
          const duration = status.media?.duration || track.duration || 0;

          if (activeCastPlaybackState) {
            activeCastPlaybackState = {
              ...activeCastPlaybackState,
              isPlaying,
              positionMs: Math.round(currentTime * 1000),
              durationMs: Math.round(duration * 1000),
              timestamp: Date.now(),
            };

            if (onPlaybackStateCallback) {
              onPlaybackStateCallback(activeCastPlaybackState, activeCastDeviceId);
            }
          }

          // Automatic next track detection
          if (status.playerState === 'IDLE' && status.idleReason === 'FINISHED') {
            console.log('[CastHub] Track finished on Cast speaker, advancing queue.');
            if (onTrackFinishedCallback) {
              onTrackFinishedCallback(activeCastDeviceId);
            }
          }
        });
      });
    });
  });
}

/**
 * Throttled Cast volume update function to prevent TLS socket buffer flooding
 */
export function setCastVolumeThrottled(level) {
  const clamped = Math.max(0, Math.min(1, level));
  pendingCastVolume = clamped;
  if (activeCastPlaybackState) activeCastPlaybackState.volume = clamped;
  const speaker = discoveredSpeakers.get(activeCastDeviceId);
  if (speaker) speaker.volume = clamped;

  if (castVolumeTimer || isSettingCastVolume) {
    return;
  }

  castVolumeTimer = setTimeout(flushCastVolume, 100);
}

function flushCastVolume() {
  castVolumeTimer = null;
  if (pendingCastVolume === null || !activeCastClient) return;

  const target = pendingCastVolume;
  pendingCastVolume = null;
  isSettingCastVolume = true;

  try {
    activeCastClient.setVolume({ level: target }, (err) => {
      isSettingCastVolume = false;
      if (err) {
        console.warn('[CastHub] Warning setting Cast volume:', err.message);
      }
      if (pendingCastVolume !== null) {
        castVolumeTimer = setTimeout(flushCastVolume, 100);
      }
    });
  } catch (err) {
    isSettingCastVolume = false;
    console.warn('[CastHub] Exception setting Cast volume:', err.message);
  }
}

/**
 * Send a remote command (play, pause, seek, set_volume) to active Cast speaker safely
 */
export async function sendCastCommand(action, data = {}) {
  if (!activeCastClient || !activeCastDeviceId) {
    return false;
  }

  const player = activeCastPlayer;
  const client = activeCastClient;

  try {
    switch (action) {
      case 'play':
      case 'CMD_PLAY':
        if (player) {
          player.play(() => {});
          if (activeCastPlaybackState) activeCastPlaybackState.isPlaying = true;
          return true;
        }
        break;

      case 'pause':
      case 'CMD_PAUSE':
        if (player) {
          player.pause(() => {});
          if (activeCastPlaybackState) activeCastPlaybackState.isPlaying = false;
          return true;
        }
        break;

      case 'seek':
      case 'CMD_SEEK':
        if (player) {
          const seconds = data.seconds ?? (data.positionMs ? data.positionMs / 1000 : 0);
          player.seek(seconds, () => {});
          if (activeCastPlaybackState) activeCastPlaybackState.positionMs = Math.round(seconds * 1000);
          return true;
        }
        break;

      case 'set_volume':
      case 'CMD_SET_VOLUME':
        if (client && typeof data.volume === 'number') {
          setCastVolumeThrottled(data.volume);
          return true;
        }
        break;

      case 'stop':
        closeActiveCastSession();
        return true;
    }
  } catch (err) {
    console.warn('[CastHub] Error executing cast command:', action, err.message);
  }

  return false;
}

/**
 * Close active Cast session
 */
export function closeActiveCastSession() {
  if (castVolumeTimer) {
    clearTimeout(castVolumeTimer);
    castVolumeTimer = null;
  }
  pendingCastVolume = null;
  isSettingCastVolume = false;

  if (activeCastPlayer) {
    try {
      activeCastPlayer.stop(() => {});
    } catch {}
    activeCastPlayer = null;
  }
  if (activeCastClient) {
    try {
      activeCastClient.close();
    } catch {}
    activeCastClient = null;
  }
  activeCastDeviceId = null;
  activeCastSessionTrack = null;
  activeCastPlaybackState = null;
}

/**
 * Check if a given deviceId is a Cast device
 */
export function isCastDeviceId(deviceId) {
  return typeof deviceId === 'string' && deviceId.startsWith('cast:');
}

/**
 * Wire ConnectHub callbacks and start background discovery
 */
export function setupCastHub({
  onDevicesUpdated,
  onPlaybackState,
  onTrackFinished,
} = {}) {
  onDevicesUpdatedCallback = onDevicesUpdated;
  onPlaybackStateCallback = onPlaybackState;
  onTrackFinishedCallback = onTrackFinished;

  // Immediate initial scan
  scanForCastDevices();

  // Periodic discovery scan every 45 seconds
  const scanInterval = setInterval(() => {
    sendMdnsCastQuery();
  }, 45000);

  if (scanInterval.unref) {
    scanInterval.unref();
  }

  return {
    getDiscoveredCastDevices,
    scanForCastDevices,
    playOnCastDevice,
    sendCastCommand,
    closeActiveCastSession,
    isCastDeviceId,
  };
}
