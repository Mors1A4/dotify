import { WebSocketServer, WebSocket } from 'ws';

/**
 * Real-time Collaborative Jam Server (Spotify Jam alternative)
 * Handles synced queues, shared playback, and peer coordination over WebSockets.
 */

// In-memory room storage
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function setupJamServer(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/ws/jam') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws) => {
    let currentRoomCode = null;
    let clientId = Math.random().toString(36).substring(2, 9);
    let isHost = false;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const { type, payload } = msg;

        switch (type) {
          case 'create_room': {
            const roomCode = generateRoomCode();
            const room = {
              code: roomCode,
              hostId: clientId,
              hostName: payload.name || 'Host',
              currentTrack: payload.currentTrack || null,
              isPlaying: false,
              playbackPosition: 0,
              lastUpdate: Date.now(),
              allowGuestControl: payload.allowGuestControl ?? true,
              queue: payload.queue || [],
              clients: new Map([[clientId, { ws, name: payload.name || 'Host', isHost: true }]]),
            };
            rooms.set(roomCode, room);
            currentRoomCode = roomCode;
            isHost = true;

            ws.send(JSON.stringify({
              type: 'room_created',
              payload: {
                roomCode,
                roomState: getSafeRoomState(room),
              },
            }));
            break;
          }

          case 'join_room': {
            const roomCode = (payload.roomCode || '').toUpperCase().trim();
            const room = rooms.get(roomCode);
            if (!room) {
              return ws.send(JSON.stringify({
                type: 'error',
                payload: { message: `Jam session "${roomCode}" not found.` },
              }));
            }

            currentRoomCode = roomCode;
            isHost = false;
            room.clients.set(clientId, { ws, name: payload.name || 'Guest', isHost: false });

            // Notify joining client of current state
            ws.send(JSON.stringify({
              type: 'room_joined',
              payload: {
                roomCode,
                roomState: getSafeRoomState(room),
              },
            }));

            // Broadcast member update to all
            broadcastToRoom(roomCode, {
              type: 'member_joined',
              payload: {
                name: payload.name || 'Guest',
                members: getRoomMembers(room),
              },
            });
            break;
          }

          case 'sync_playback': {
            const room = rooms.get(currentRoomCode);
            if (!room) return;
            if (!isHost && !room.allowGuestControl) return;

            room.currentTrack = payload.currentTrack ?? room.currentTrack;
            room.isPlaying = payload.isPlaying ?? room.isPlaying;
            room.playbackPosition = payload.playbackPosition ?? room.playbackPosition;
            room.lastUpdate = Date.now();

            broadcastToRoom(currentRoomCode, {
              type: 'playback_synced',
              payload: {
                currentTrack: room.currentTrack,
                isPlaying: room.isPlaying,
                playbackPosition: room.playbackPosition,
                timestamp: room.lastUpdate,
              },
            }, clientId);
            break;
          }

          case 'add_to_queue': {
            const room = rooms.get(currentRoomCode);
            if (!room || !payload.track) return;

            room.queue.push(payload.track);
            broadcastToRoom(currentRoomCode, {
              type: 'queue_updated',
              payload: {
                queue: room.queue,
                addedBy: payload.addedBy || 'Someone',
                track: payload.track,
              },
            });
            break;
          }

          case 'next_track': {
            const room = rooms.get(currentRoomCode);
            if (!room) return;
            if (!isHost && !room.allowGuestControl) return;

            if (room.queue.length > 0) {
              room.currentTrack = room.queue.shift();
              room.playbackPosition = 0;
              room.isPlaying = true;
              room.lastUpdate = Date.now();

              broadcastToRoom(currentRoomCode, {
                type: 'track_changed',
                payload: {
                  currentTrack: room.currentTrack,
                  queue: room.queue,
                },
              });
            }
            break;
          }

          default:
            break;
        }
      } catch (err) {
        console.warn('[JamServer] Message parse error:', err.message);
      }
    });

    ws.on('close', () => {
      if (currentRoomCode) {
        const room = rooms.get(currentRoomCode);
        if (room) {
          room.clients.delete(clientId);
          if (room.clients.size === 0) {
            rooms.delete(currentRoomCode);
          } else {
            broadcastToRoom(currentRoomCode, {
              type: 'member_left',
              payload: { members: getRoomMembers(room) },
            });
          }
        }
      }
    });
  });

  function broadcastToRoom(roomCode, message, excludeClientId = null) {
    const room = rooms.get(roomCode);
    if (!room) return;
    const str = JSON.stringify(message);
    room.clients.forEach((client, id) => {
      if (id !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(str);
      }
    });
  }

  function getRoomMembers(room) {
    return Array.from(room.clients.values()).map((c) => ({
      name: c.name,
      isHost: c.isHost,
    }));
  }

  function getSafeRoomState(room) {
    return {
      code: room.code,
      hostName: room.hostName,
      currentTrack: room.currentTrack,
      isPlaying: room.isPlaying,
      playbackPosition: room.playbackPosition,
      allowGuestControl: room.allowGuestControl,
      queue: room.queue,
      members: getRoomMembers(room),
    };
  }

  return {
    getRoom: (code) => rooms.get(code),
  };
}
