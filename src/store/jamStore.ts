import { create } from 'zustand';
import { Track } from '../types/track';
import { usePlayerStore } from './playerStore';

export interface JamMember {
  name: string;
  isHost: boolean;
}

export interface JamState {
  isConnected: boolean;
  isHost: boolean;
  roomCode: string | null;
  hostName: string | null;
  members: JamMember[];
  allowGuestControl: boolean;
  syncWithHost: boolean;
  statusMessage: string | null;

  // Actions
  createRoom: (name?: string) => void;
  joinRoom: (roomCode: string, name?: string) => void;
  leaveRoom: () => void;
  setSyncWithHost: (sync: boolean) => void;
  broadcastPlayback: (currentTrack: Track | null, isPlaying: boolean, playbackPosition: number) => void;
  addTrackToJamQueue: (track: Track) => void;
  nextJamTrack: () => void;
}

let socket: WebSocket | null = null;

export const useJamStore = create<JamState>((set, get) => ({
  isConnected: false,
  isHost: false,
  roomCode: null,
  hostName: null,
  members: [],
  allowGuestControl: true,
  syncWithHost: true,
  statusMessage: null,

  createRoom: (name = 'DJ Host') => {
    get().leaveRoom();
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/jam`;

    try {
      socket = new WebSocket(wsUrl);
      socket.onopen = () => {
        const currentTrack = usePlayerStore.getState().currentTrack;
        const queue = usePlayerStore.getState().queue;
        socket?.send(JSON.stringify({
          type: 'create_room',
          payload: { name, currentTrack, queue },
        }));
      };

      setupSocketListeners(socket, set, get);
    } catch (err) {
      set({ statusMessage: 'Failed to establish Jam session' });
    }
  },

  joinRoom: (roomCode: string, name = 'Guest') => {
    get().leaveRoom();
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/jam`;

    try {
      socket = new WebSocket(wsUrl);
      socket.onopen = () => {
        socket?.send(JSON.stringify({
          type: 'join_room',
          payload: { roomCode: roomCode.trim().toUpperCase(), name },
        }));
      };

      setupSocketListeners(socket, set, get);
    } catch (err) {
      set({ statusMessage: 'Failed to connect to Jam room' });
    }
  },

  leaveRoom: () => {
    if (socket) {
      socket.close();
      socket = null;
    }
    set({
      isConnected: false,
      isHost: false,
      roomCode: null,
      hostName: null,
      members: [],
      statusMessage: null,
    });
  },

  setSyncWithHost: (sync: boolean) => set({ syncWithHost: sync }),

  broadcastPlayback: (currentTrack, isPlaying, playbackPosition) => {
    if (socket && socket.readyState === WebSocket.OPEN && get().isConnected) {
      socket.send(JSON.stringify({
        type: 'sync_playback',
        payload: { currentTrack, isPlaying, playbackPosition },
      }));
    }
  },

  addTrackToJamQueue: (track: Track) => {
    if (socket && socket.readyState === WebSocket.OPEN && get().isConnected) {
      socket.send(JSON.stringify({
        type: 'add_to_queue',
        payload: { track, addedBy: get().isHost ? 'Host' : 'Guest' },
      }));
    }
  },

  nextJamTrack: () => {
    if (socket && socket.readyState === WebSocket.OPEN && get().isConnected) {
      socket.send(JSON.stringify({ type: 'next_track', payload: {} }));
    }
  },
}));

function setupSocketListeners(
  ws: WebSocket,
  set: (partial: Partial<JamState> | ((state: JamState) => Partial<JamState>)) => void,
  get: () => JamState
) {
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const { type, payload } = data;

      switch (type) {
        case 'room_created': {
          set({
            isConnected: true,
            isHost: true,
            roomCode: payload.roomCode,
            hostName: payload.roomState.hostName,
            members: payload.roomState.members,
            allowGuestControl: payload.roomState.allowGuestControl,
            statusMessage: `Jam room ${payload.roomCode} live!`,
          });
          break;
        }

        case 'room_joined': {
          set({
            isConnected: true,
            isHost: false,
            roomCode: payload.roomCode,
            hostName: payload.roomState.hostName,
            members: payload.roomState.members,
            allowGuestControl: payload.roomState.allowGuestControl,
            statusMessage: `Joined ${payload.roomState.hostName}'s Jam!`,
          });

          // Sync initial track if host is playing
          if (payload.roomState.currentTrack && get().syncWithHost) {
            const player = usePlayerStore.getState();
            player.playTrack(payload.roomState.currentTrack, payload.roomState.queue);
            if (payload.roomState.playbackPosition > 0) {
              player.seekTo(payload.roomState.playbackPosition);
            }
          }
          break;
        }

        case 'member_joined':
        case 'member_left': {
          set({ members: payload.members });
          break;
        }

        case 'playback_synced': {
          if (!get().isHost && get().syncWithHost && payload.currentTrack) {
            const player = usePlayerStore.getState();
            // If track changed, switch track
            if (player.currentTrack?.id !== payload.currentTrack.id) {
              player.playTrack(payload.currentTrack);
            }
            // Sync play/pause state
            if (payload.isPlaying && !player.isPlaying) {
              player.togglePlay();
            } else if (!payload.isPlaying && player.isPlaying) {
              player.togglePlay();
            }
          }
          break;
        }

        case 'queue_updated': {
          if (payload.track) {
            usePlayerStore.getState().addToQueue(payload.track);
          }
          break;
        }

        case 'track_changed': {
          if (!get().isHost && get().syncWithHost && payload.currentTrack) {
            usePlayerStore.getState().playTrack(payload.currentTrack, payload.queue);
          }
          break;
        }

        case 'error': {
          set({ statusMessage: payload.message });
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.warn('[JamStore] Failed to parse message:', err);
    }
  };

  ws.onclose = () => {
    set({ isConnected: false, roomCode: null, members: [] });
  };
}
