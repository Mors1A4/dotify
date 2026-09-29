import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePlayerStore, deduplicatePlaylists } from '../../src/store/playerStore';
import { dailyVibeManager } from '../../src/services/dailyVibeManager';
import { saveSpotifyPlaylistToStore } from '../../src/services/spotifyImporter';
import { CustomPlaylist, SpotifyImportPreview } from '../../src/types/playlist';
import { Track } from '../../src/types/track';
import { DailyVibePlaylist } from '../../src/types/vibes';

const sampleTrackA: Track = {
  id: 'track_1',
  title: 'Midnight City',
  artist: 'M83',
  album: 'Hurry Up, We\'re Dreaming',
  duration: 243,
  streamUrl: 'https://example.com/audio1.mp3',
  source: 'charts',
  sourceMetadata: { format: 'mp3' },
};

const sampleTrackB: Track = {
  id: 'track_2',
  title: 'Wait',
  artist: 'M83',
  album: 'Hurry Up, We\'re Dreaming',
  duration: 343,
  streamUrl: 'https://example.com/audio2.mp3',
  source: 'charts',
  sourceMetadata: { format: 'mp3' },
};

describe('Playlist Library Management: Duplicate Prevention & Easy Deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState({
      playlists: [],
      selectedPlaylistId: null,
      activeView: 'home',
      currentView: 'home',
    });
  });

  describe('1. Duplicate Prevention ("Cannot add multiple of the same playlist")', () => {
    it('prevents creating duplicate playlists with the same name via createPlaylist', () => {
      const store = usePlayerStore.getState();
      const id1 = store.createPlaylist('Synthwave Dreams', 'Initial description', '', [sampleTrackA]);
      expect(usePlayerStore.getState().playlists).toHaveLength(1);

      // Attempt to create another playlist with the same name (case-insensitive)
      const id2 = store.createPlaylist('synthwave dreams', 'Different desc', '', [sampleTrackB]);

      // Must return the existing ID and NOT create a second playlist
      expect(id2).toBe(id1);
      const playlists = usePlayerStore.getState().playlists;
      expect(playlists).toHaveLength(1);
      expect(playlists[0].tracks).toHaveLength(2);
      expect(playlists[0].tracks.map((t) => t.id)).toEqual(['track_1', 'track_2']);
    });

    it('prevents duplicate imports via importCustomPlaylist matching sourceSpotifyUrl or name', () => {
      const store = usePlayerStore.getState();
      const spotifyUrl = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';

      const id1 = store.importCustomPlaylist({
        name: 'Top Hits',
        description: 'First import',
        coverArt: 'https://example.com/cover1.jpg',
        sourceSpotifyUrl: spotifyUrl,
        tracks: [sampleTrackA],
      });
      expect(usePlayerStore.getState().playlists).toHaveLength(1);

      // Attempt to import the same Spotify playlist again
      const id2 = store.importCustomPlaylist({
        name: 'Top Hits (Renamed Attempt)',
        description: 'Second import attempt',
        coverArt: 'https://example.com/cover2.jpg',
        sourceSpotifyUrl: spotifyUrl,
        tracks: [sampleTrackA, sampleTrackB],
      });

      expect(id2).toBe(id1);
      expect(usePlayerStore.getState().playlists).toHaveLength(1);
    });

    it('prevents duplicate Spotify imports in saveSpotifyPlaylistToStore', () => {
      const preview: SpotifyImportPreview = {
        playlistTitle: 'RapCaviar',
        playlistDescription: 'New music from Drake, Kendrick and more.',
        playlistCoverUrl: 'https://i.scdn.co/image/rapcaviar',
        playlistOwner: 'Spotify',
        entityType: 'playlist',
        sourceUrl: 'https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd',
        totalTracks: 2,
        resolvedTracks: [sampleTrackA, sampleTrackB],
        unresolvedCount: 0,
      };

      const firstId = saveSpotifyPlaylistToStore(preview);
      expect(usePlayerStore.getState().playlists).toHaveLength(1);

      // Attempt to save the exact same preview a second time
      const secondId = saveSpotifyPlaylistToStore(preview);
      expect(secondId).toBe(firstId);
      expect(usePlayerStore.getState().playlists).toHaveLength(1);
    });

    it('prevents saving multiple copies of the same daily vibe playlist to library', () => {
      const mockVibe: DailyVibePlaylist = {
        id: 'daily-vibe-gaming-2026-09-29',
        name: 'Neon Cyberpunk Focus',
        description: 'High energy synth & dark techno for deep gaming sessions.',
        coverArt: 'https://images.unsplash.com/photo-cyber',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        vibe: 'gaming',
        vibeLabel: 'Gaming',
        vibeIcon: '🎮',
        vibeTagline: 'Curated for today',
        themeGradient: 'from-purple-900 to-indigo-950',
        accentColor: '#a855f7',
        generatedDate: '2026-09-29',
        isAIGenerated: true,
        tracks: [sampleTrackA, sampleTrackB],
      };

      const firstId = dailyVibeManager.saveVibeToLibrary(mockVibe);
      expect(usePlayerStore.getState().playlists).toHaveLength(1);

      // Click "Save to Library" again for the same daily vibe
      const secondId = dailyVibeManager.saveVibeToLibrary(mockVibe);
      expect(secondId).toBe(firstId);
      expect(usePlayerStore.getState().playlists).toHaveLength(1);
    });

    it('deduplicatePlaylists helper cleans up duplicate names and Spotify URLs', () => {
      const rawList: CustomPlaylist[] = [
        {
          id: 'pl_1',
          name: 'Workout Beats',
          tracks: [sampleTrackA],
          createdAt: 100,
          updatedAt: 100,
          sourceSpotifyUrl: 'https://open.spotify.com/playlist/workout1',
        },
        {
          id: 'pl_2',
          name: 'workout beats', // duplicate name
          tracks: [sampleTrackB],
          createdAt: 200,
          updatedAt: 200,
        },
        {
          id: 'pl_3',
          name: 'Different Name',
          tracks: [],
          createdAt: 300,
          updatedAt: 300,
          sourceSpotifyUrl: 'https://open.spotify.com/playlist/workout1', // duplicate url
        },
        {
          id: 'pl_4',
          name: 'Unique Playlist',
          tracks: [sampleTrackB],
          createdAt: 400,
          updatedAt: 400,
        },
      ];

      const cleaned = deduplicatePlaylists(rawList);
      expect(cleaned).toHaveLength(2);
      expect(cleaned[0].name).toBe('Workout Beats');
      expect(cleaned[1].name).toBe('Unique Playlist');
    });
  });

  describe('2. Easy Deletion ("Delete playlist from library easily")', () => {
    it('deletes playlist cleanly and removes it from store and storage', () => {
      const store = usePlayerStore.getState();
      const id1 = store.createPlaylist('Chill Lofi');
      const id2 = store.createPlaylist('Deep Work');

      expect(usePlayerStore.getState().playlists).toHaveLength(2);

      store.deletePlaylist(id1);

      const remaining = usePlayerStore.getState().playlists;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(id2);
      expect(remaining[0].name).toBe('Deep Work');
    });

    it('resets selectedPlaylistId and navigates to library when active playlist is deleted', () => {
      const store = usePlayerStore.getState();
      const id = store.createPlaylist('Party Anthem');

      store.navigateToPlaylist(id);
      expect(usePlayerStore.getState().activeView).toBe('playlist');
      expect(usePlayerStore.getState().selectedPlaylistId).toBe(id);

      // Delete the active playlist
      store.deletePlaylist(id);

      expect(usePlayerStore.getState().playlists).toHaveLength(0);
      expect(usePlayerStore.getState().selectedPlaylistId).toBeNull();
      expect(usePlayerStore.getState().activeView).toBe('library');
    });

    it('gracefully handles deleting non-existent playlist ID without error', () => {
      const store = usePlayerStore.getState();
      const id = store.createPlaylist('Indie Roadtrip');

      expect(() => {
        store.deletePlaylist('non_existent_id');
      }).not.toThrow();

      expect(usePlayerStore.getState().playlists).toHaveLength(1);
      expect(usePlayerStore.getState().playlists[0].id).toBe(id);
    });
  });
});
