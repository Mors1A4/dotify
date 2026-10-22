import { describe, it, expect, beforeEach } from 'vitest';
import {
  mergePlaylists,
  mergeTracks,
  recordPlaylistDeletion,
  getDeletedPlaylistTombstones,
  STORAGE_DELETED_PLAYLIST_IDS,
} from '../../src/utils/playlistMerge';
import { safeStorage } from '../../src/utils/storage';
import { CustomPlaylist } from '../../src/types/playlist';
import { Track } from '../../src/types/track';

describe('Playlist & Track Non-Destructive Merge and Sync', () => {
  beforeEach(() => {
    safeStorage.removeItem(STORAGE_DELETED_PLAYLIST_IDS);
  });

  it('merges playlists from PC and Phone without wiping either', () => {
    const pcPlaylists: CustomPlaylist[] = [
      {
        id: 'pl_pc_1',
        name: 'Work Vibes',
        createdAt: 1000,
        updatedAt: 1000,
        tracks: [{ id: 'track_1', title: 'Focus Song', artist: 'Artist A' } as Track],
      },
    ];

    const phonePlaylists: CustomPlaylist[] = [
      {
        id: 'pl_phone_1',
        name: 'Gym Jams',
        createdAt: 2000,
        updatedAt: 2000,
        tracks: [{ id: 'track_2', title: 'Pump Up', artist: 'Artist B' } as Track],
      },
    ];

    const merged = mergePlaylists(pcPlaylists, phonePlaylists);
    expect(merged.length).toBe(2);
    expect(merged.map((p) => p.name)).toContain('Work Vibes');
    expect(merged.map((p) => p.name)).toContain('Gym Jams');
  });

  it('merges track additions inside the same playlist across devices', () => {
    const pcVersion: CustomPlaylist[] = [
      {
        id: 'pl_shared',
        name: 'Favorites',
        createdAt: 1000,
        updatedAt: 1000,
        tracks: [
          { id: 't1', title: 'Song 1', artist: 'Artist 1' } as Track,
        ],
      },
    ];

    const phoneVersion: CustomPlaylist[] = [
      {
        id: 'pl_shared',
        name: 'Favorites',
        createdAt: 1000,
        updatedAt: 1500,
        tracks: [
          { id: 't2', title: 'Song 2', artist: 'Artist 2' } as Track,
        ],
      },
    ];

    const merged = mergePlaylists(pcVersion, phoneVersion);
    expect(merged.length).toBe(1);
    expect(merged[0].tracks.length).toBe(2);
    expect(merged[0].tracks.map((t) => t.id)).toEqual(['t2', 't1']);
  });

  it('honors playlist deletion tombstones so deleted playlists do not resurrect', () => {
    recordPlaylistDeletion('pl_to_delete');
    const tombstones = getDeletedPlaylistTombstones();
    expect(tombstones['pl_to_delete']).toBeGreaterThan(0);

    const incomingStalePlaylists: CustomPlaylist[] = [
      {
        id: 'pl_to_delete',
        name: 'Old Playlist',
        createdAt: 500,
        updatedAt: 600,
        tracks: [],
      },
      {
        id: 'pl_keep',
        name: 'Keep Me',
        createdAt: 1000,
        updatedAt: 1000,
        tracks: [],
      },
    ];

    const merged = mergePlaylists([], incomingStalePlaylists);
    expect(merged.length).toBe(1);
    expect(merged[0].id).toBe('pl_keep');
  });

  it('merges track arrays without duplicate entries', () => {
    const listA: Track[] = [
      { id: 'song_1', title: 'Track 1', artist: 'Artist 1' } as Track,
      { id: 'song_2', title: 'Track 2', artist: 'Artist 2' } as Track,
    ];
    const listB: Track[] = [
      { id: 'song_2', title: 'Track 2', artist: 'Artist 2' } as Track,
      { id: 'song_3', title: 'Track 3', artist: 'Artist 3' } as Track,
    ];

    const merged = mergeTracks(listA, listB);
    expect(merged.length).toBe(3);
    expect(merged.map((t) => t.id)).toEqual(['song_1', 'song_2', 'song_3']);
  });
});
