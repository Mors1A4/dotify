import { describe, it, expect, beforeEach } from 'vitest';
import { usePlayerStore } from '../../src/store/playerStore';
import { saveSpotifyPlaylistToStore } from '../../src/services/spotifyImporter';
import { PLAYLIST_COVER_PRESETS } from '../../src/components/modals/CreatePlaylistModal';
import { SpotifyImportPreview } from '../../src/types/playlist';
import { Track } from '../../src/types/track';
import { upgradeArtworkUrl, extractMosaicQuadrants } from '../../src/utils/artwork';

const mockTrackA: Track = {
  id: 'spotify:track:111',
  title: 'Blinding Lights',
  artist: 'The Weeknd',
  album: 'After Hours',
  duration: 200,
  artworkUrl: 'https://i.scdn.co/image/ab67616d00001e02afterhours',
  streamUrl: '/api/stream/track?title=Blinding+Lights&artist=The+Weeknd&duration=200',
  source: 'audius',
  sourceMetadata: { format: 'mp3' },
};

const mockTrackB: Track = {
  id: 'spotify:track:222',
  title: 'Starboy',
  artist: 'The Weeknd',
  album: 'Starboy',
  duration: 230,
  artworkUrl: 'https://i.scdn.co/image/ab67616d00001e02starboy',
  streamUrl: '/api/stream/track?title=Starboy&artist=The+Weeknd&duration=230',
  source: 'audius',
  sourceMetadata: { format: 'mp3' },
};

describe('Studio Playlist Creator & 1:1 Spotify Cloner', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      playlists: [],
      activeView: 'home',
      selectedPlaylistId: null,
      isCreatePlaylistModalOpen: false,
      createPlaylistModalTab: 'custom',
      createPlaylistInitialTracks: [],
    });
  });

  it('opens and closes CreatePlaylistModal in custom or spotify mode with optional starter tracks', () => {
    const store = usePlayerStore.getState();
    expect(store.isCreatePlaylistModalOpen).toBe(false);

    store.openCreatePlaylistModal('spotify');
    expect(usePlayerStore.getState().isCreatePlaylistModalOpen).toBe(true);
    expect(usePlayerStore.getState().createPlaylistModalTab).toBe('spotify');

    store.openCreatePlaylistModal('custom', [mockTrackA]);
    expect(usePlayerStore.getState().createPlaylistModalTab).toBe('custom');
    expect(usePlayerStore.getState().createPlaylistInitialTracks).toHaveLength(1);

    store.closeCreatePlaylistModal();
    expect(usePlayerStore.getState().isCreatePlaylistModalOpen).toBe(false);
    expect(usePlayerStore.getState().createPlaylistInitialTracks).toHaveLength(0);
  });

  it('creates a studio playlist with custom cover preset, description, and starter tracks', () => {
    const presetCover = PLAYLIST_COVER_PRESETS[1].url;
    const id = usePlayerStore
      .getState()
      .createPlaylist('Late Night Synth', 'Retro synthwave vibes', presetCover, [
        mockTrackA,
        mockTrackB,
      ]);

    const created = usePlayerStore.getState().playlists.find((p) => p.id === id);
    expect(created).toBeDefined();
    expect(created?.name).toBe('Late Night Synth');
    expect(created?.description).toBe('Retro synthwave vibes');
    expect(created?.coverArt).toBe(presetCover);
    expect(created?.tracks).toHaveLength(2);
    expect(created?.tracks[0].title).toBe('Blinding Lights');
  });

  it('updates playlist details (name, description, coverArt) and batch-adds tracks without duplicates', () => {
    const id = usePlayerStore.getState().createPlaylist('Draft Mix');
    const newCover = PLAYLIST_COVER_PRESETS[2].url;

    usePlayerStore.getState().updatePlaylistDetails(id, {
      name: 'Golden Hour Mix',
      description: 'Updated description',
      coverArt: newCover,
    });

    usePlayerStore.getState().addTracksToPlaylist(id, [mockTrackA, mockTrackB, mockTrackA]);

    const updated = usePlayerStore.getState().playlists.find((p) => p.id === id);
    expect(updated?.name).toBe('Golden Hour Mix');
    expect(updated?.description).toBe('Updated description');
    expect(updated?.coverArt).toBe(newCover);
    expect(updated?.tracks).toHaveLength(2);
  });

  it('clones a Spotify playlist 1:1 preserving cover art, description, sourceSpotifyUrl, and per-track metadata', () => {
    const preview: SpotifyImportPreview = {
      playlistTitle: "Today's Top Hits",
      playlistDescription: 'The hottest 50. Cover: ADÉLA',
      playlistCoverUrl: 'https://i.scdn.co/image/ab67706f00000002top50cover',
      playlistOwner: 'Spotify',
      entityType: 'playlist',
      sourceUrl: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
      totalTracks: 2,
      resolvedTracks: [mockTrackA, mockTrackB],
      unresolvedCount: 0,
    };

    const playlistId = saveSpotifyPlaylistToStore(preview);
    const cloned = usePlayerStore.getState().playlists.find((p) => p.id === playlistId);

    expect(cloned).toBeDefined();
    expect(cloned?.name).toBe("Today's Top Hits");
    expect(cloned?.description).toBe('The hottest 50. Cover: ADÉLA');
    expect(cloned?.coverArt).toBe('https://i.scdn.co/image/ab67706f00000002top50cover');
    expect(cloned?.sourceSpotifyUrl).toBe(
      'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'
    );
    expect(cloned?.tracks).toHaveLength(2);
    expect(cloned?.tracks[0].album).toBe('After Hours');
    expect(cloned?.tracks[0].artworkUrl).toBe(
      'https://i.scdn.co/image/ab67616d0000b273afterhours'
    );
    expect(cloned?.tracks[1].album).toBe('Starboy');
    expect(cloned?.tracks[1].artworkUrl).toBe(
      'https://i.scdn.co/image/ab67616d0000b273starboy'
    );
  });

  it('upgrades low-res Spotify mosaic and CDN hashes to 640px HD quality', () => {
    // 60px mosaic to 640px
    const mosaic60 = 'https://mosaic.scdn.co/60/ab67616d0000b273111111111111111111111111ab67616d0000b273222222222222222222222222ab67616d0000b273333333333333333333333333ab67616d0000b273444444444444444444444444';
    expect(upgradeArtworkUrl(mosaic60)).toContain('mosaic.scdn.co/640/');

    // 64px (4851) and 300px (1e02) hashes to 640px HD (b273)
    const trackLow = 'https://i.scdn.co/image/ab67616d00004851abcd1234ef012345';
    expect(upgradeArtworkUrl(trackLow)).toBe('https://i.scdn.co/image/ab67616d0000b273abcd1234ef012345');

    const trackMed = 'https://i.scdn.co/image/ab67616d00001e02abcd1234ef012345';
    expect(upgradeArtworkUrl(trackMed)).toBe('https://i.scdn.co/image/ab67616d0000b273abcd1234ef012345');

    // iTunes upgrade
    const itunes = 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/100x100bb.jpg';
    expect(upgradeArtworkUrl(itunes)).toBe('https://is1-ssl.mzstatic.com/image/thumb/Music/v4/600x600bb.jpg');
  });

  it('slices Spotify 160-char mosaic into 4 individual 640x640 quadrant URLs', () => {
    const mosaicUrl =
      'https://mosaic.scdn.co/640/ab67616d0000b273aaaaaaaaaaaaaaaaaaaaaaaaab67616d0000b273bbbbbbbbbbbbbbbbbbbbbbbbab67616d0000b273ccccccccccccccccccccccccab67616d0000b273dddddddddddddddddddddddd';
    const quadrants = extractMosaicQuadrants(mosaicUrl);
    expect(quadrants).toHaveLength(4);
    expect(quadrants?.[0]).toBe('https://i.scdn.co/image/ab67616d0000b273aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(quadrants?.[1]).toBe('https://i.scdn.co/image/ab67616d0000b273bbbbbbbbbbbbbbbbbbbbbbbb');
    expect(quadrants?.[2]).toBe('https://i.scdn.co/image/ab67616d0000b273cccccccccccccccccccccccc');
    expect(quadrants?.[3]).toBe('https://i.scdn.co/image/ab67616d0000b273dddddddddddddddddddddddd');
  });
});
