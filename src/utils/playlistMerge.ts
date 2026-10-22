import { CustomPlaylist } from '../types/playlist';
import { Track } from '../types/track';
import { safeStorage } from './storage';

export const STORAGE_DELETED_PLAYLIST_IDS = 'dotify_deleted_playlist_ids';

/**
 * Returns a record mapping deleted playlist IDs to the timestamp of deletion.
 */
export function getDeletedPlaylistTombstones(): Record<string, number> {
  const data = safeStorage.getItem<Record<string, number> | string[]>(STORAGE_DELETED_PLAYLIST_IDS, {});
  if (Array.isArray(data)) {
    const map: Record<string, number> = {};
    for (const id of data) {
      if (typeof id === 'string') map[id] = 1;
    }
    return map;
  }
  return data && typeof data === 'object' ? data : {};
}

/**
 * Record a playlist deletion so it does not resurrect from older backups or stale syncs.
 */
export function recordPlaylistDeletion(playlistId: string): void {
  if (!playlistId) return;
  const tombstones = getDeletedPlaylistTombstones();
  tombstones[playlistId] = Date.now();
  safeStorage.setItem(STORAGE_DELETED_PLAYLIST_IDS, tombstones);
}

/**
 * Merge two track lists preserving unique songs by ID or normalized artist-title.
 */
export function mergeTracks(t1: Track[] = [], t2: Track[] = []): Track[] {
  const seen = new Set<string>();
  const result: Track[] = [];

  const add = (t: Track) => {
    if (!t) return;
    const cleanId = String(t.id || '').trim().toLowerCase();
    const cleanKey = cleanId || `${String(t.artist || '').trim().toLowerCase()} - ${String(t.title || '').trim().toLowerCase()}`;
    if (!cleanKey || seen.has(cleanKey)) return;
    seen.add(cleanKey);
    result.push(t);
  };

  if (Array.isArray(t1)) {
    for (const t of t1) add(t);
  }
  if (Array.isArray(t2)) {
    for (const t of t2) add(t);
  }
  return result;
}

/**
 * Non-destructively merge local and incoming playlists:
 * 1. Honors deletion tombstones unless modified after deletion.
 * 2. Unifies playlists by ID or Spotify URL or name.
 * 3. Keeps latest metadata and merges tracklists so no added songs are lost across devices.
 */
export function mergePlaylists(
  local: CustomPlaylist[] = [],
  incoming: CustomPlaylist[] = []
): CustomPlaylist[] {
  if (!Array.isArray(local) && !Array.isArray(incoming)) return [];
  if (!Array.isArray(local) || local.length === 0) {
    const tombstones = getDeletedPlaylistTombstones();
    return (incoming || []).filter((p) => {
      if (!p || !p.id) return false;
      const delAt = tombstones[p.id];
      return !delAt || (p.updatedAt || p.createdAt || 0) > delAt;
    });
  }
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return local;
  }

  const tombstones = getDeletedPlaylistTombstones();
  const playlistMap = new Map<string, CustomPlaylist>();

  const processPlaylist = (pl: CustomPlaylist) => {
    if (!pl || !pl.id || !pl.name) return;
    const deletedAt = tombstones[pl.id];
    const itemTime = pl.updatedAt || pl.createdAt || 0;
    if (deletedAt && itemTime <= deletedAt) {
      return;
    }

    const existing = playlistMap.get(pl.id);
    if (!existing) {
      playlistMap.set(pl.id, pl);
    } else {
      const existingTime = existing.updatedAt || existing.createdAt || 0;
      const isIncomingNewer = itemTime >= existingTime;
      const base = isIncomingNewer ? pl : existing;
      const other = isIncomingNewer ? existing : pl;

      // Merge tracks non-destructively
      const mergedTracks = mergeTracks(base.tracks || [], other.tracks || []);

      playlistMap.set(pl.id, {
        ...base,
        name: base.name || other.name,
        description: base.description || other.description,
        coverArt: base.coverArt || other.coverArt,
        isPinned: base.isPinned ?? other.isPinned,
        sourceSpotifyUrl: base.sourceSpotifyUrl || other.sourceSpotifyUrl,
        tracks: mergedTracks,
        updatedAt: Math.max(itemTime, existingTime, Date.now()),
      });
    }
  };

  for (const pl of local) processPlaylist(pl);
  for (const pl of incoming) processPlaylist(pl);

  return Array.from(playlistMap.values());
}
