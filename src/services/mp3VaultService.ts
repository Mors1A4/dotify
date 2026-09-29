import { create } from 'zustand';
import { Track } from '../types/track';
import { audioCache } from '../audio/audioCache';
import { isTauriEnvironment, isAndroidApp, getCustomApiUrl } from './apiConfig';
import { safeStorage } from '../utils/storage';

export interface SavedMp3Track extends Track {
  fileName: string;
  sizeBytes: number;
  savedAt: number;
  savedReason: 'auto_complete' | 'manual_download' | 'wifi_sync' | 'disk_import';
  originDeviceName: string;
}

export interface WifiPeerDevice {
  deviceId: string;
  deviceName: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'tv' | 'speaker';
  ip: string;
  port: number;
  mp3Count: number;
  totalSizeBytes: number;
  lastSeen: number;
}

export interface PeerMp3Track extends SavedMp3Track {
  peerIp: string;
  peerPort: number;
  peerDeviceName: string;
  peerDeviceId: string;
}

const STORAGE_AUTO_SAVE_COMPLETE = 'dotify_mp3_auto_save_completed';
const STORAGE_AUTO_WIFI_SYNC = 'dotify_mp3_auto_wifi_sync';
const STORAGE_LOCAL_MP3_FALLBACK = 'dotify_mp3_local_fallback_index';
const STORAGE_DELETED_MP3_IDS = 'dotify_mp3_deleted_ids';

function getLocalDaemonBaseUrl(): string {
  const custom = getCustomApiUrl();
  if (custom) return custom;
  if (isTauriEnvironment()) {
    return 'http://127.0.0.1:3001';
  }
  return '';
}

function getDaemonEndpoint(path: string): string {
  const base = getLocalDaemonBaseUrl();
  const clean = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${clean}` : clean;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to encode blob as base64'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

export interface Mp3VaultState {
  savedTracks: SavedMp3Track[];
  peerTracks: PeerMp3Track[];
  peers: WifiPeerDevice[];
  localDevice: {
    deviceId: string;
    deviceName: string;
    deviceType: string;
    ip: string;
    port: number;
    mp3Dir: string;
    totalSizeBytes: number;
  } | null;
  deletedIds: Record<string, number>;
  savingTrackIds: string[];
  autoSaveCompleted: boolean;
  autoWifiSync: boolean;
  isScanningWifi: boolean;
  isSyncingPeers: boolean;
  statusMessage: string | null;

  // Actions
  setAutoSaveCompleted: (enabled: boolean) => void;
  toggleAutoSaveCompleted: () => void;
  setAutoWifiSync: (enabled: boolean) => void;
  toggleAutoWifiSync: () => void;
  isTrackSaved: (trackId: string) => boolean;
  isTrackSaving: (trackId: string) => boolean;
  getSavedTrackPlayUrl: (trackId: string) => string | null;
  refreshVault: () => Promise<void>;
  scanWifiPeers: () => Promise<WifiPeerDevice[]>;
  addPeerByIp: (ip: string) => Promise<{ ok: boolean; message: string }>;
  saveTrackAsMp3: (
    track: Track,
    reason?: 'auto_complete' | 'manual_download' | 'wifi_sync',
    sourcePeerUrl?: string,
    originDeviceName?: string
  ) => Promise<SavedMp3Track | null>;
  deleteSavedMp3: (trackId: string, propagateAcrossWifi?: boolean) => Promise<void>;
  cleanupSavedMp3s: (
    mode: 'unliked' | 'all',
    likedTrackIds: string[],
    propagateAcrossWifi?: boolean
  ) => Promise<number>;
  syncWithWifiPeers: (targetPeerIp?: string, forceTrackId?: string) => Promise<number>;
  exportMp3File: (track: Track | SavedMp3Track) => Promise<void>;
  openMp3Folder: () => Promise<string | null>;
  setStatusMessage: (msg: string | null) => void;
}

export const useMp3VaultStore = create<Mp3VaultState>((set, get) => {
  const initialAutoSave = safeStorage.getItem<boolean>(STORAGE_AUTO_SAVE_COMPLETE, true);
  const initialAutoWifi = safeStorage.getItem<boolean>(STORAGE_AUTO_WIFI_SYNC, true);
  const initialFallbackTracks = safeStorage.getItem<SavedMp3Track[]>(STORAGE_LOCAL_MP3_FALLBACK, []);
  const initialDeleted = safeStorage.getItem<Record<string, number>>(STORAGE_DELETED_MP3_IDS, {});

  let statusTimer: any = null;
  const flashStatus = (msg: string | null, durationMs = 3500) => {
    if (statusTimer) clearTimeout(statusTimer);
    set({ statusMessage: msg });
    if (msg && durationMs > 0) {
      statusTimer = setTimeout(() => {
        set({ statusMessage: null });
      }, durationMs);
    }
  };

  return {
    savedTracks: initialFallbackTracks,
    peerTracks: [],
    peers: [],
    localDevice: null,
    deletedIds: initialDeleted,
    savingTrackIds: [],
    autoSaveCompleted: initialAutoSave,
    autoWifiSync: initialAutoWifi,
    isScanningWifi: false,
    isSyncingPeers: false,
    statusMessage: null,

    setStatusMessage: (msg) => flashStatus(msg),

    setAutoSaveCompleted: (enabled: boolean) => {
      safeStorage.setItem(STORAGE_AUTO_SAVE_COMPLETE, enabled);
      set({ autoSaveCompleted: enabled });
      flashStatus(
        enabled
          ? 'Auto-Save ON: Any track played completely will be saved as MP3.'
          : 'Auto-Save OFF: Use the Download button on tracks to save MP3s manually.'
      );
    },

    toggleAutoSaveCompleted: () => {
      get().setAutoSaveCompleted(!get().autoSaveCompleted);
    },

    setAutoWifiSync: (enabled: boolean) => {
      safeStorage.setItem(STORAGE_AUTO_WIFI_SYNC, enabled);
      set({ autoWifiSync: enabled });
      flashStatus(
        enabled
          ? 'WiFi Auto-Sync ON: Saved MP3s will sync across your phone & computers on this WiFi.'
          : 'WiFi Auto-Sync paused: You can still manually pull or push tracks from WiFi peers.'
      );
      if (enabled) {
        get().syncWithWifiPeers().catch(() => {});
      }
    },

    toggleAutoWifiSync: () => {
      get().setAutoWifiSync(!get().autoWifiSync);
    },

    isTrackSaved: (trackId: string) => {
      if (!trackId) return false;
      return get().savedTracks.some((t) => t.id === trackId);
    },

    isTrackSaving: (trackId: string) => {
      if (!trackId) return false;
      return get().savingTrackIds.includes(trackId);
    },

    getSavedTrackPlayUrl: (trackId: string) => {
      const found = get().savedTracks.find((t) => t.id === trackId);
      if (!found) return null;
      return getDaemonEndpoint(`/api/mp3s/file/${encodeURIComponent(trackId)}`);
    },

    refreshVault: async () => {
      try {
        const res = await fetch(getDaemonEndpoint('/api/mp3s/list'), {
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.ok) {
            const tracks: SavedMp3Track[] = Array.isArray(data.tracks) ? data.tracks : [];
            const peers: WifiPeerDevice[] = Array.isArray(data.peers) ? data.peers : [];
            const deletedIds: Record<string, number> = {
              ...get().deletedIds,
              ...(data.deletedIds || {}),
            };

            safeStorage.setItem(STORAGE_LOCAL_MP3_FALLBACK, tracks);
            safeStorage.setItem(STORAGE_DELETED_MP3_IDS, deletedIds);

            set({
              savedTracks: tracks,
              peers,
              deletedIds,
              localDevice: {
                deviceId: data.deviceId || 'local',
                deviceName: data.deviceName || 'This Device',
                deviceType: data.deviceType || (isAndroidApp() ? 'mobile' : 'desktop'),
                ip: data.ip || '127.0.0.1',
                port: data.port || 3001,
                mp3Dir: data.mp3Dir || '',
                totalSizeBytes: Number(data.totalSizeBytes || 0),
              },
            });

            // Fetch track lists from discovered WiFi peers so we can display remote tracks & auto-sync
            if (peers.length > 0) {
              const allPeerTracks: PeerMp3Track[] = [];
              await Promise.allSettled(
                peers.map(async (peer) => {
                  try {
                    const pRes = await fetch(`http://${peer.ip}:${peer.port || 3001}/api/mp3s/list`, {
                      signal: AbortSignal.timeout(2800),
                    });
                    if (!pRes.ok) return;
                    const pData = await pRes.json();
                    if (Array.isArray(pData.tracks)) {
                      for (const pt of pData.tracks) {
                        allPeerTracks.push({
                          ...pt,
                          peerIp: peer.ip,
                          peerPort: peer.port || 3001,
                          peerDeviceName: pData.deviceName || peer.deviceName,
                          peerDeviceId: pData.deviceId || peer.deviceId,
                        });
                      }
                    }
                  } catch {}
                })
              );
              set({ peerTracks: allPeerTracks });
            } else {
              set({ peerTracks: [] });
            }
          }
        }
      } catch {
        // Fallback to local storage when daemon is unreachable
      }
    },

    scanWifiPeers: async () => {
      if (get().isScanningWifi) return get().peers;
      set({ isScanningWifi: true });
      try {
        const res = await fetch(getDaemonEndpoint('/api/mp3s/scan'), {
          method: 'POST',
          signal: AbortSignal.timeout(12000),
        });
        if (res.ok) {
          const data = await res.json();
          const peers: WifiPeerDevice[] = Array.isArray(data.peers) ? data.peers : [];
          set({ peers });
          await get().refreshVault();
          if (peers.length > 0 && get().autoWifiSync) {
            await get().syncWithWifiPeers();
          }
          flashStatus(
            peers.length > 0
              ? `Found ${peers.length} Dotify device${peers.length === 1 ? '' : 's'} on WiFi!`
              : 'Scan complete. Make sure Dotify is open on your other WiFi devices.'
          );
          return peers;
        }
      } catch (err: any) {
        flashStatus(`WiFi scan note: ${err?.message || 'Check network connection'}`);
      } finally {
        set({ isScanningWifi: false });
      }
      return get().peers;
    },

    addPeerByIp: async (ip: string) => {
      const cleanIp = (ip || '').trim();
      if (!cleanIp) return { ok: false, message: 'Please enter a device IP address' };
      try {
        const res = await fetch(getDaemonEndpoint('/api/mp3s/peers/add'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip: cleanIp }),
          signal: AbortSignal.timeout(4500),
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          await get().refreshVault();
          if (get().autoWifiSync) {
            await get().syncWithWifiPeers(data.peer?.ip);
          }
          const msg = `Connected to ${data.peer?.deviceName || cleanIp}!`;
          flashStatus(msg);
          return { ok: true, message: msg };
        }
        const errMsg = data?.error || `Could not reach Dotify at ${cleanIp}`;
        flashStatus(errMsg);
        return { ok: false, message: errMsg };
      } catch (err: any) {
        const errMsg = err?.message || `Connection to ${cleanIp} failed`;
        flashStatus(errMsg);
        return { ok: false, message: errMsg };
      }
    },

    saveTrackAsMp3: async (
      track: Track,
      reason: 'auto_complete' | 'manual_download' | 'wifi_sync' = 'manual_download',
      sourcePeerUrl?: string,
      originDeviceName?: string
    ) => {
      if (!track || !track.id || track.source === 'radio') return null;

      // Respect deletion tombstones for automatic background actions so deleted songs don't reappear uninvited
      if (reason !== 'manual_download' && get().deletedIds[track.id]) {
        return null;
      }

      if (reason !== 'manual_download' && get().isTrackSaved(track.id)) {
        return get().savedTracks.find((t) => t.id === track.id) || null;
      }

      if (get().isTrackSaving(track.id)) {
        return null;
      }

      set((state) => ({
        savingTrackIds: [...state.savingTrackIds, track.id],
      }));

      try {
        // 1. Check if audioCache already has a verified full-track Blob in L1/L2
        let fullBlob = await audioCache.getCachedFullBlob(track.id);

        // 2. If we have a sourcePeerUrl (pulling from a WiFi peer) or if on Android, try fetching blob directly
        if (!fullBlob && sourcePeerUrl) {
          try {
            const peerRes = await fetch(sourcePeerUrl, { signal: AbortSignal.timeout(15000) });
            if (peerRes.ok) {
              const b = await peerRes.blob();
              if (b.size > 1024) fullBlob = b;
            }
          } catch {}
        }

        // 3. On Android (where yt-dlp.exe is not local), check if a desktop PC peer is on WiFi to resolve full stream
        let effectiveSourceUrl = sourcePeerUrl;
        if (!fullBlob && !effectiveSourceUrl && isAndroidApp()) {
          const desktopPeer = get().peers.find((p) => p.deviceType === 'desktop');
          if (desktopPeer && track.artist && track.title) {
            const preview =
              track.sourceMetadata?.previewUrl ||
              track.sourceMetadata?.fallbackUrl ||
              '';
            const dur = track.duration && isFinite(track.duration) ? track.duration : 210;
            effectiveSourceUrl = `http://${desktopPeer.ip}:${desktopPeer.port || 3001}/api/stream/track?artist=${encodeURIComponent(
              track.artist
            )}&title=${encodeURIComponent(track.title)}&preview=${encodeURIComponent(
              preview
            )}&duration=${dur}`;
          }
        }

        let audioBase64: string | undefined;
        if (fullBlob && fullBlob.size > 1024) {
          try {
            audioBase64 = await blobToBase64(fullBlob);
          } catch {}
        }

        // 4. Send to local MP3 Vault daemon (/api/mp3s/save)
        const res = await fetch(getDaemonEndpoint('/api/mp3s/save'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            track,
            reason,
            audioBase64,
            sourceUrl: effectiveSourceUrl,
            originDeviceName,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data && data.ok && data.entry) {
            const savedEntry: SavedMp3Track = data.entry;

            // Also ensure audioCache has the full blob for instant <5ms offline playback
            if (fullBlob) {
              await audioCache.storeFullBlob(track.id, fullBlob);
            } else {
              fetch(getDaemonEndpoint(`/api/mp3s/file/${encodeURIComponent(track.id)}`))
                .then((r) => (r.ok ? r.blob() : null))
                .then((b) => {
                  if (b && b.size > 1024) audioCache.storeFullBlob(track.id, b);
                })
                .catch(() => {});
            }

            const nextDeleted = { ...get().deletedIds };
            delete nextDeleted[track.id];
            safeStorage.setItem(STORAGE_DELETED_MP3_IDS, nextDeleted);

            set((state) => {
              const updated = [savedEntry, ...state.savedTracks.filter((t) => t.id !== track.id)];
              safeStorage.setItem(STORAGE_LOCAL_MP3_FALLBACK, updated);
              return {
                savedTracks: updated,
                deletedIds: nextDeleted,
              };
            });

            if (reason === 'manual_download') {
              flashStatus(`Saved "${track.title}" as MP3`);
            } else if (reason === 'auto_complete') {
              flashStatus(`Auto-saved "${track.title}" as MP3 (played completely)`);
            }
            return savedEntry;
          }
        }

        // 5. Fallback if local daemon could not resolve: cache via audioCache & store fallback entry
        await audioCache.cacheFullTrack(track);
        const cachedBlob = await audioCache.getCachedFullBlob(track.id);
        if (cachedBlob && cachedBlob.size > 1024) {
          const fallbackEntry: SavedMp3Track = {
            ...track,
            fileName: `${track.artist} - ${track.title}.mp3`,
            sizeBytes: cachedBlob.size,
            savedAt: Date.now(),
            savedReason: reason,
            originDeviceName: get().localDevice?.deviceName || 'This Device',
          };
          set((state) => {
            const updated = [fallbackEntry, ...state.savedTracks.filter((t) => t.id !== track.id)];
            safeStorage.setItem(STORAGE_LOCAL_MP3_FALLBACK, updated);
            return { savedTracks: updated };
          });
          if (reason === 'manual_download') {
            flashStatus(`Saved "${track.title}" for offline MP3 playback`);
          }
          return fallbackEntry;
        }
      } catch (err: any) {
        if (reason === 'manual_download') {
          flashStatus(`Could not save MP3: ${err?.message || 'Download error'}`);
        }
      } finally {
        set((state) => ({
          savingTrackIds: state.savingTrackIds.filter((id) => id !== track.id),
        }));
      }
      return null;
    },

    deleteSavedMp3: async (trackId: string, propagateAcrossWifi = false) => {
      if (!trackId) return;
      const target = get().savedTracks.find((t) => t.id === trackId);
      const now = Date.now();
      const nextDeleted = { ...get().deletedIds, [trackId]: now };
      safeStorage.setItem(STORAGE_DELETED_MP3_IDS, nextDeleted);

      set((state) => {
        const updated = state.savedTracks.filter((t) => t.id !== trackId);
        safeStorage.setItem(STORAGE_LOCAL_MP3_FALLBACK, updated);
        return {
          savedTracks: updated,
          deletedIds: nextDeleted,
          peerTracks: propagateAcrossWifi
            ? state.peerTracks.filter((pt) => pt.id !== trackId)
            : state.peerTracks,
        };
      });

      await audioCache.deleteCachedTrack(trackId);

      try {
        await fetch(getDaemonEndpoint('/api/mp3s/delete'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: trackId,
            propagate: propagateAcrossWifi,
          }),
        });
      } catch {}

      flashStatus(
        propagateAcrossWifi
          ? `Deleted "${target?.title || 'track'}" from this device & all WiFi peers`
          : `Deleted "${target?.title || 'track'}" MP3 from this device`
      );
    },

    cleanupSavedMp3s: async (
      mode: 'unliked' | 'all',
      likedTrackIds: string[],
      propagateAcrossWifi = false
    ) => {
      const keepSet = new Set(likedTrackIds || []);
      const toRemove = get().savedTracks.filter((t) =>
        mode === 'all' ? true : !keepSet.has(t.id)
      );

      if (toRemove.length === 0) {
        flashStatus(
          mode === 'unliked'
            ? 'No unliked MP3s to clean up — all saved tracks are in your Liked Songs!'
            : 'No saved MP3s to delete.'
        );
        return 0;
      }

      const now = Date.now();
      const nextDeleted = { ...get().deletedIds };
      for (const t of toRemove) {
        nextDeleted[t.id] = now;
        audioCache.deleteCachedTrack(t.id).catch(() => {});
      }
      safeStorage.setItem(STORAGE_DELETED_MP3_IDS, nextDeleted);

      const remaining = get().savedTracks.filter((t) =>
        mode === 'all' ? false : keepSet.has(t.id)
      );
      safeStorage.setItem(STORAGE_LOCAL_MP3_FALLBACK, remaining);
      set({
        savedTracks: remaining,
        deletedIds: nextDeleted,
      });

      try {
        await fetch(getDaemonEndpoint('/api/mp3s/delete'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            keepIds: likedTrackIds,
            propagate: propagateAcrossWifi,
          }),
        });
      } catch {}

      flashStatus(
        `Cleaned up ${toRemove.length} MP3 file${toRemove.length === 1 ? '' : 's'}${
          propagateAcrossWifi ? ' across all WiFi devices' : ''
        }!`
      );
      return toRemove.length;
    },

    syncWithWifiPeers: async (targetPeerIp?: string, forceTrackId?: string) => {
      if (get().isSyncingPeers && !forceTrackId) return 0;
      set({ isSyncingPeers: true });
      try {
        const res = await fetch(getDaemonEndpoint('/api/mp3s/sync-from-peers'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetPeerIp,
            forceTrackId,
          }),
          signal: AbortSignal.timeout(30000),
        });
        if (res.ok) {
          const data = await res.json();
          const pulledCount = Number(data.pulledCount || 0);
          await get().refreshVault();
          if (pulledCount > 0) {
            flashStatus(
              `Synced ${pulledCount} MP3${pulledCount === 1 ? '' : 's'} over WiFi!`
            );
          } else if (forceTrackId) {
            flashStatus('Track synced from WiFi peer!');
          }
          return pulledCount;
        }
      } catch {} finally {
        set({ isSyncingPeers: false });
      }
      return 0;
    },

    exportMp3File: async (track: Track | SavedMp3Track) => {
      if (!track || !track.id) return;
      const safeName = `${track.artist || 'Artist'} - ${track.title || 'Track'}`
        .replace(/[<>:"/\\|?*]/g, ' ')
        .trim();
      const fileName = `${safeName}.mp3`;

      // Ensure it's saved first if not yet saved
      if (!get().isTrackSaved(track.id)) {
        await get().saveTrackAsMp3(track, 'manual_download');
      }

      try {
        let blob = await audioCache.getCachedFullBlob(track.id);
        if (!blob) {
          const res = await fetch(
            getDaemonEndpoint(`/api/mp3s/file/${encodeURIComponent(track.id)}`)
          );
          if (res.ok) {
            blob = await res.blob();
          }
        }
        if (blob && blob.size > 1024) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          flashStatus(`Downloaded "${fileName}"`);
          return;
        }
      } catch (err: any) {
        flashStatus(`Export failed: ${err?.message || 'Error'}`);
      }
    },

    openMp3Folder: async () => {
      try {
        if (isTauriEnvironment() && !isAndroidApp()) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const folderPath = await invoke<string>('open_mp3_folder');
            if (folderPath) {
              flashStatus(`Opened MP3 folder: ${folderPath}`);
              return folderPath;
            }
          } catch {}
        }
        const res = await fetch(getDaemonEndpoint('/api/mp3s/open-folder'), {
          method: 'POST',
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.path) {
            flashStatus(`MP3 folder: ${data.path}`);
            return data.path;
          }
        }
      } catch {}
      return null;
    },
  };
});

// Start background WiFi sync & vault refresh loop
if (typeof window !== 'undefined') {
  setTimeout(() => {
    const store = useMp3VaultStore.getState();
    store.refreshVault().then(() => {
      if (store.autoWifiSync && store.peers.length > 0) {
        store.syncWithWifiPeers().catch(() => {});
      }
    });
  }, 1200);

  setInterval(() => {
    const store = useMp3VaultStore.getState();
    store.refreshVault().then(() => {
      if (store.autoWifiSync && store.peers.length > 0) {
        // Check if any peer has a track that isn't saved locally and isn't deleted
        const localIds = new Set(store.savedTracks.map((t) => t.id));
        const hasUnsyncedPeerTrack = store.peerTracks.some(
          (pt) => !localIds.has(pt.id) && !store.deletedIds[pt.id]
        );
        if (hasUnsyncedPeerTrack) {
          store.syncWithWifiPeers().catch(() => {});
        }
      }
    });
  }, 10000);
}
