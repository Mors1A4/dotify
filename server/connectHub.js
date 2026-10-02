import { WebSocketServer, WebSocket } from 'ws';
import {
  setupCastHub,
  isCastDeviceId,
  playOnCastDevice,
  sendCastCommand,
  closeActiveCastSession,
  getDiscoveredCastDevices,
} from './castHub.js';

/**
 * Spotify Connect-style LAN Discovery & Remote Control Hub
 * Handles bidirectional device discovery, remote commands, playback state sync,
 * Google Cast smart speaker streaming, and seamless audio handoff over WebSockets.
 */

// Registry of connected devices: deviceId -> { ws, device, isAlive, lastSeen }
const clients = new Map();
const wsToDeviceId = new WeakMap();

// Cached active playback state to immediately sync newly connected devices
let activePlaybackState = null;
let activeDeviceId = null;
let isCastEnabled = false;

function broadcastDeviceList() {
  const castDevices = isCastEnabled ? getDiscoveredCastDevices() : [];
  const deviceList = [
    ...Array.from(clients.values()).map((c) => ({
      ...c.device,
      isActive: c.device.deviceId === activeDeviceId,
      lastSeen: c.lastSeen,
    })),
    ...castDevices.map((d) => ({
      ...d,
      isActive: d.deviceId === activeDeviceId,
    })),
  ];

  const msg = JSON.stringify({
    type: 'DEVICE_LIST',
    devices: deviceList,
    activeDeviceId,
    timestamp: Date.now(),
  });

  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(msg);
      } catch (err) {
        console.warn('[ConnectHub] Failed to send device list to client:', err.message);
      }
    }
  }
}

function broadcastToOthers(senderDeviceId, messageString) {
  for (const [id, client] of clients.entries()) {
    if (id !== senderDeviceId && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(messageString);
      } catch (err) {
        console.warn(`[ConnectHub] Broadcast error to ${id}:`, err.message);
      }
    }
  }
}

function sendToDevice(targetDeviceId, messageString) {
  const client = clients.get(targetDeviceId);
  if (client && client.ws.readyState === WebSocket.OPEN) {
    try {
      client.ws.send(messageString);
      return true;
    } catch (err) {
      console.warn(`[ConnectHub] Send error to ${targetDeviceId}:`, err.message);
    }
  }
  return false;
}

export function setupConnectHub(server, options = {}) {
  isCastEnabled = options.enableCast ?? (process.env.NODE_ENV !== 'test' && !process.env.VITEST);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (url.pathname === '/ws/connect') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    } catch (err) {
      console.warn('[ConnectHub] Upgrade error:', err.message);
    }
  });

  wss.on('connection', (ws) => {
    let clientDeviceId = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const type = msg.type;

        switch (type) {
          case 'HELLO':
          case 'REGISTER':
          case 'DEVICE_ANNOUNCE': {
            const dev = msg.payload || msg.device;
            if (!dev || !dev.deviceId) return;

            clientDeviceId = dev.deviceId;
            wsToDeviceId.set(ws, clientDeviceId);

            const isFirstDevice = clients.size === 0 && !activeDeviceId;
            if (isFirstDevice || dev.role === 'active_host') {
              activeDeviceId = dev.deviceId;
            }

            clients.set(clientDeviceId, {
              ws,
              device: {
                ...dev,
                isActive: clientDeviceId === activeDeviceId,
                role: dev.role || (clientDeviceId === activeDeviceId ? 'active_host' : 'remote_controller'),
              },
              isAlive: true,
              lastSeen: Date.now(),
            });

            // Send current active state if available
            if (activePlaybackState) {
              ws.send(
                JSON.stringify({
                  type: 'PLAYBACK_STATE',
                  state: activePlaybackState,
                  activeDeviceId,
                  timestamp: Date.now(),
                })
              );
            }

            broadcastDeviceList();
            break;
          }

          case 'DEVICE_LIST_REQUEST': {
            const deviceList = Array.from(clients.values()).map((c) => ({
              ...c.device,
              isActive: c.device.deviceId === activeDeviceId,
            }));
            ws.send(
              JSON.stringify({
                type: 'DEVICE_LIST',
                devices: deviceList,
                activeDeviceId,
                timestamp: Date.now(),
              })
            );
            break;
          }

          case 'PLAYBACK_STATE':
          case 'STATE_SYNC': {
            const state = msg.state || msg.payload;
            if (state) {
              const senderId = clientDeviceId || msg.senderDeviceId;
              const hasTrack = Boolean(state.currentTrack || state.activeTrack || state.track);
              const activeHasPlayingTrack = Boolean(
                activePlaybackState &&
                (activePlaybackState.currentTrack || activePlaybackState.activeTrack || activePlaybackState.track) &&
                activePlaybackState.isPlaying
              );

              // If an active host is currently playing audio, ignore empty states from secondary clients
              if (!hasTrack && !state.isPlaying && activeHasPlayingTrack && senderId !== activeDeviceId) {
                break;
              }

              const senderClient = senderId ? clients.get(senderId) : null;
              // If sender is marked as remote_controller, ignore passive background updates unless actively playing
              if (senderClient?.device?.role === 'remote_controller' && !state.isPlaying) {
                break;
              }
              // If active host is currently a Cast speaker, allow active playback from a client to preempt it
              if (activeDeviceId && isCastDeviceId(activeDeviceId) && senderId !== activeDeviceId) {
                if (state.isPlaying) {
                  closeActiveCastSession();
                  activeDeviceId = senderId;
                } else {
                  break;
                }
              }

              activePlaybackState = state;
              if (senderId) {
                const prevActiveId = activeDeviceId;
                if (prevActiveId && prevActiveId !== senderId && state.isPlaying) {
                  if (isCastDeviceId(prevActiveId)) {
                    sendCastCommand('pause');
                  } else {
                    sendToDevice(
                      prevActiveId,
                      JSON.stringify({
                        type: 'REMOTE_COMMAND',
                        command: { action: 'pause' },
                        fromDeviceId: senderId,
                        targetDeviceId: prevActiveId,
                        timestamp: Date.now(),
                      })
                    );
                  }
                }

                activeDeviceId = senderId;
                const client = clients.get(senderId);
                if (client) {
                  client.device.isActive = true;
                  client.device.role = 'active_host';
                }
                if (prevActiveId && prevActiveId !== senderId) {
                  const prevClient = clients.get(prevActiveId);
                  if (prevClient) {
                    prevClient.device.isActive = false;
                    prevClient.device.role = 'remote_controller';
                  }
                }
              }
              // Broadcast state to all other connected devices
              broadcastToOthers(senderId, JSON.stringify({
                type: 'PLAYBACK_STATE',
                state: activePlaybackState,
                activeDeviceId,
                senderDeviceId: senderId,
                timestamp: Date.now(),
              }));
            }
            break;
          }

          case 'REMOTE_COMMAND': {
            const targetId = msg.targetDeviceId || activeDeviceId;
            if (targetId && isCastDeviceId(targetId)) {
              const action = msg.command?.action || msg.action;
              const data = msg.command?.data || msg.command || msg;
              sendCastCommand(action, data, targetId);
              break;
            }

            const payloadStr = JSON.stringify({
              type: 'REMOTE_COMMAND',
              command: msg.command,
              fromDeviceId: clientDeviceId || msg.fromDeviceId,
              targetDeviceId: targetId,
              timestamp: Date.now(),
            });

            if (targetId && targetId !== clientDeviceId) {
              const delivered = sendToDevice(targetId, payloadStr);
              if (!delivered) {
                // If targeted device not found, broadcast to others
                broadcastToOthers(clientDeviceId, payloadStr);
              }
            } else {
              broadcastToOthers(clientDeviceId, payloadStr);
            }
            break;
          }

          // Direct compatibility command forwarding (CMD_PLAY, CMD_PAUSE, etc.)
          case 'CMD_PLAY':
          case 'CMD_PAUSE':
          case 'CMD_SEEK':
          case 'CMD_SET_VOLUME':
          case 'CMD_NEXT':
          case 'CMD_PREV': {
            const targetId = msg.targetDeviceId || activeDeviceId;
            if (targetId && isCastDeviceId(targetId)) {
              sendCastCommand(type, msg);
              break;
            }

            const payloadStr = JSON.stringify({
              ...msg,
              fromDeviceId: clientDeviceId,
              timestamp: Date.now(),
            });
            if (targetId && targetId !== clientDeviceId) {
              sendToDevice(targetId, payloadStr);
            } else {
              broadcastToOthers(clientDeviceId, payloadStr);
            }
            break;
          }

          case 'HANDOFF':
          case 'HANDOFF_TRANSFER': {
            const targetId = msg.targetDeviceId || (msg.payload && msg.payload.toDeviceId);
            const fromId = clientDeviceId || msg.fromDeviceId || (msg.payload && msg.payload.fromDeviceId);

            if (targetId) {
              const previousActiveId = activeDeviceId;
              if (previousActiveId && isCastDeviceId(previousActiveId) && previousActiveId !== targetId) {
                closeActiveCastSession();
              }
              if (previousActiveId && !isCastDeviceId(previousActiveId) && previousActiveId !== targetId && previousActiveId !== fromId) {
                sendToDevice(
                  previousActiveId,
                  JSON.stringify({
                    type: 'REMOTE_COMMAND',
                    command: { action: 'pause' },
                    fromDeviceId: fromId,
                    targetDeviceId: previousActiveId,
                    timestamp: Date.now(),
                  })
                );
              }

              if (isCastDeviceId(targetId)) {
                activeDeviceId = targetId;
                const snapshot = msg.state || (msg.payload && msg.payload.state);
                for (const [id, c] of clients.entries()) {
                  c.device.isActive = false;
                  c.device.role = 'remote_controller';
                }
                broadcastDeviceList();

                if (snapshot && snapshot.track) {
                  activePlaybackState = {
                    currentTrack: snapshot.track,
                    activeTrack: snapshot.track,
                    queue: snapshot.queue || [snapshot.track],
                    currentTrackIndex: snapshot.currentTrackIndex ?? 0,
                    isPlaying: true,
                    positionMs: snapshot.positionMs || 0,
                    durationMs: (snapshot.track.duration || 0) * 1000,
                    volume: snapshot.volume ?? 0.8,
                    timestamp: Date.now(),
                  };

                  playOnCastDevice(targetId, snapshot.track, {
                    positionMs: snapshot.positionMs,
                    volume: snapshot.volume,
                  })
                    .then(() => {
                      sendToDevice(
                        fromId,
                        JSON.stringify({
                          type: 'HANDOFF_ACK',
                          fromDeviceId: targetId,
                          toDeviceId: fromId,
                          success: true,
                          resumedPositionMs: snapshot.positionMs,
                          timestamp: Date.now(),
                        })
                      );
                    })
                    .catch((err) => {
                      console.warn('[ConnectHub] Cast handoff error:', err.message);
                      sendToDevice(
                        fromId,
                        JSON.stringify({
                          type: 'HANDOFF_ACK',
                          fromDeviceId: targetId,
                          toDeviceId: fromId,
                          success: false,
                          error: err.message,
                          timestamp: Date.now(),
                        })
                      );
                    });
                }
                break;
              }

              activeDeviceId = targetId;
              const payloadStr = JSON.stringify({
                type: 'HANDOFF_TRANSFER',
                targetDeviceId: targetId,
                fromDeviceId: fromId,
                state: msg.state || (msg.payload && msg.payload.state),
                timestamp: Date.now(),
              });

              sendToDevice(targetId, payloadStr);

              // Update roles
              for (const [id, c] of clients.entries()) {
                if (id === targetId) {
                  c.device.isActive = true;
                  c.device.role = 'active_host';
                } else {
                  c.device.isActive = false;
                  c.device.role = 'remote_controller';
                }
              }

              broadcastDeviceList();
            }
            break;
          }

          case 'HANDOFF_ACK': {
            const targetId = msg.toDeviceId;
            const payloadStr = JSON.stringify({
              type: 'HANDOFF_ACK',
              fromDeviceId: clientDeviceId || msg.fromDeviceId,
              toDeviceId: targetId,
              success: msg.success ?? true,
              resumedPositionMs: msg.resumedPositionMs,
              latencyMs: msg.latencyMs,
              timestamp: Date.now(),
            });

            if (targetId) {
              sendToDevice(targetId, payloadStr);
            } else {
              broadcastToOthers(clientDeviceId, payloadStr);
            }
            broadcastDeviceList();
            break;
          }

          case 'PAIR': {
            const targetId = msg.targetDeviceId;
            const fromId = clientDeviceId || msg.fromDeviceId;
            if (targetId) {
              sendToDevice(
                targetId,
                JSON.stringify({
                  type: 'PAIR',
                  fromDeviceId: fromId,
                  targetDeviceId: targetId,
                  timestamp: Date.now(),
                })
              );
            }
            break;
          }

          case 'PAIRED': {
            const targetId = msg.controllerDeviceId || msg.fromDeviceId;
            if (targetId) {
              sendToDevice(targetId, JSON.stringify(msg));
            } else {
              broadcastToOthers(clientDeviceId, JSON.stringify(msg));
            }
            break;
          }

          case 'UNPAIR':
          case 'DISCONNECT_REMOTE': {
            const previousActiveId = activeDeviceId;
            if (previousActiveId && isCastDeviceId(previousActiveId)) {
              closeActiveCastSession();
            }
            if (clientDeviceId) {
              activeDeviceId = clientDeviceId;
              const client = clients.get(clientDeviceId);
              if (client) {
                client.device.isActive = true;
                client.device.role = 'active_host';
              }
            } else {
              activeDeviceId = null;
            }
            broadcastDeviceList();
            broadcastToOthers(clientDeviceId, JSON.stringify({
              type: 'DISCONNECT_REMOTE',
              fromDeviceId: clientDeviceId,
              timestamp: Date.now(),
            }));
            break;
          }

          case 'PING': {
            const client = clients.get(clientDeviceId);
            if (client) {
              client.isAlive = true;
              client.lastSeen = Date.now();
            }
            ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
            break;
          }

          case 'PONG': {
            const client = clients.get(clientDeviceId);
            if (client) {
              client.isAlive = true;
              client.lastSeen = Date.now();
            }
            break;
          }

          default:
            // Pass-through other message types to others
            broadcastToOthers(clientDeviceId, raw.toString());
            break;
        }
      } catch (err) {
        console.warn('[ConnectHub] Error processing message:', err.message);
      }
    });

    ws.on('close', () => {
      const devId = wsToDeviceId.get(ws) || clientDeviceId;
      if (devId) {
        const existing = clients.get(devId);
        if (existing && existing.ws === ws) {
          clients.delete(devId);
          if (activeDeviceId === devId) {
            // If active host disconnected, pick first available device or reset
            const remaining = Array.from(clients.keys());
            activeDeviceId = remaining.length > 0 ? remaining[0] : null;
            if (activeDeviceId) {
              const nextClient = clients.get(activeDeviceId);
              if (nextClient) {
                nextClient.device.isActive = true;
                nextClient.device.role = 'active_host';
              }
            }
          }
          broadcastDeviceList();
        }
      }
    });

    ws.on('error', (err) => {
      console.warn('[ConnectHub] WebSocket error:', err.message);
    });
  });

  // 25s ping-pong liveness heartbeat
  const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, client] of clients.entries()) {
      if (!client.isAlive) {
        console.log(`[ConnectHub] Device ${id} timed out, removing.`);
        client.ws.terminate();
        const currentClient = clients.get(id);
        if (currentClient && currentClient.ws === client.ws) {
          clients.delete(id);
          if (activeDeviceId === id) {
            const remaining = Array.from(clients.keys());
            activeDeviceId = remaining.length > 0 ? remaining[0] : null;
          }
          broadcastDeviceList();
        }
        continue;
      }
      client.isAlive = false;
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: 'PING', timestamp: now }));
      }
    }
  }, 25000);

  if (heartbeatInterval.unref) {
    heartbeatInterval.unref();
  }

  if (isCastEnabled) {
    setupCastHub({
      onDevicesUpdated: () => broadcastDeviceList(),
      onPlaybackState: (state, castId) => {
        const isSessionEnding = !state.isPlaying && !state.currentTrack;
        if (isSessionEnding) {
          if (activeDeviceId === castId) {
            activeDeviceId = null;
          }
          activePlaybackState = null;
          broadcastDeviceList();
          for (const client of clients.values()) {
            if (client.ws.readyState === WebSocket.OPEN) {
              try {
                client.ws.send(
                  JSON.stringify({
                    type: 'PLAYBACK_STATE',
                    state: { isPlaying: false, positionMs: 0, currentTrack: null, timestamp: Date.now() },
                    activeDeviceId: null,
                    senderDeviceId: castId,
                    fromDeviceId: castId,
                    timestamp: Date.now(),
                  })
                );
              } catch {}
            }
          }
          return;
        }

        activePlaybackState = {
          ...(activePlaybackState || {}),
          ...state,
          queue: state.queue && state.queue.length > 0 ? state.queue : activePlaybackState?.queue || [],
          currentTrackIndex: state.currentTrackIndex ?? activePlaybackState?.currentTrackIndex ?? 0,
          currentTrack: state.currentTrack || activePlaybackState?.currentTrack || null,
        };
        activeDeviceId = castId;
        for (const client of clients.values()) {
          if (client.ws.readyState === WebSocket.OPEN) {
            try {
              client.ws.send(
                JSON.stringify({
                  type: 'PLAYBACK_STATE',
                  state: activePlaybackState,
                  activeDeviceId: castId,
                  senderDeviceId: castId,
                  fromDeviceId: castId,
                  timestamp: Date.now(),
                })
              );
            } catch {}
          }
        }
      },
      onTrackFinished: (castId) => {
        // Elect exactly one authoritative controller to advance the queue
        const controllers = Array.from(clients.values()).filter(
          (c) => c.device.role === 'remote_controller' && c.ws.readyState === WebSocket.OPEN
        );
        if (controllers.length > 0) {
          const primary = controllers[0];
          try {
            primary.ws.send(
              JSON.stringify({
                type: 'REMOTE_COMMAND',
                command: { action: 'next' },
                fromDeviceId: castId,
                targetDeviceId: primary.device.deviceId,
                timestamp: Date.now(),
              })
            );
          } catch {}
        }
      },
    });
  }

  return { wss, clients };
}

export const setupConnectServer = setupConnectHub;
