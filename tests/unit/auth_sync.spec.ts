import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authService } from '../../src/services/authService';
import { usePlayerStore } from '../../src/store/playerStore';
import { safeStorage } from '../../src/utils/storage';
import { Track } from '../../src/types/track';
import { CustomPlaylist } from '../../src/types/playlist';
import { recommendationEngine } from '../../src/services/recommendationEngine';

const mockTrack1: Track = {
  id: 'track-1',
  title: 'Californication',
  artist: 'Red Hot Chili Peppers',
  album: 'Californication',
  duration: 329,
  artworkUrl: 'https://example.com/cover1.jpg',
  streamUrl: 'https://example.com/stream1.mp3',
  source: 'audius',
  sourceMetadata: {},
};

const mockTrack2: Track = {
  id: 'track-2',
  title: 'Otherside',
  artist: 'Red Hot Chili Peppers',
  album: 'Californication',
  duration: 255,
  artworkUrl: 'https://example.com/cover2.jpg',
  streamUrl: 'https://example.com/stream2.mp3',
  source: 'audius',
  sourceMetadata: {},
};

describe('Cross-Device Account Management & Cloud Library Sync', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('supports 1-click passwordless fast profile authentication with persistent UID', async () => {
    const user1 = await authService.signInWithFastProfile('monty@gmail.com');
    expect(user1).toBeDefined();
    expect(user1.email).toBe('monty@gmail.com');
    expect(user1.displayName).toBe('monty');
    expect(user1.uid).toMatch(/^usr_\d+$/);

    // Logging in on another device with same email gets identical UID
    const user2 = await authService.signInWithFastProfile('monty@gmail.com');
    expect(user2.uid).toBe(user1.uid);

    // Friend logging in with their email gets different UID
    const friend = await authService.signInWithFastProfile('friend@gmail.com');
    expect(friend.uid).not.toBe(user1.uid);
  });

  it('transfers liked songs, playlists, and history across simulated PC and phone sessions', async () => {
    // 1. User signs in on PC
    const pcUser = await authService.signInWithFastProfile('musiclover@dotify.com');
    const playerStore = usePlayerStore.getState();

    const testPlaylist: CustomPlaylist = {
      id: 'pl-pc-1',
      name: 'Roadtrip Rock',
      description: 'Chili Peppers & Classics',
      coverArt: '',
      tracks: [mockTrack1],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // User modifies library on PC
    playerStore.setUserLibrary([mockTrack1, mockTrack2], [testPlaylist], [mockTrack1], pcUser.uid);

    // Save to user storage / cloud representation
    await authService.saveUserLibrary(
      pcUser.uid,
      [mockTrack1, mockTrack2],
      [testPlaylist],
      [mockTrack1]
    );

    // 2. User signs into phone with the same account
    const phoneLibrary = await authService.loadUserLibrary(pcUser.uid);
    expect(phoneLibrary).toBeDefined();
    expect(phoneLibrary!.likedTracks.length).toBe(2);
    expect(phoneLibrary!.likedTracks[0].title).toBe('Californication');
    expect(phoneLibrary!.playlists.length).toBe(1);
    expect(phoneLibrary!.playlists[0].name).toBe('Roadtrip Rock');
    expect(phoneLibrary!.history.length).toBe(1);
    expect(phoneLibrary!.history[0].id).toBe('track-1');
  });

  it('persists and synchronizes followed artists across devices with recommendation affinity boost', async () => {
    const pcUser = await authService.signInWithFastProfile('artistfan@dotify.com');
    const playerStore = usePlayerStore.getState();

    // 1. Follow an artist via playerStore
    playerStore.toggleFollowArtist({
      id: 'artist_rhcp',
      name: 'Red Hot Chili Peppers',
      genres: ['Rock', 'Funk Rock'],
    });

    expect(playerStore.isFollowingArtist('Red Hot Chili Peppers')).toBe(true);
    expect(playerStore.isFollowingArtist('artist_rhcp')).toBe(true);
    expect(playerStore.isFollowingArtist('Coldplay')).toBe(false);

    const followed = usePlayerStore.getState().followedArtists;
    expect(followed.length).toBe(1);
    expect(followed[0].name).toBe('Red Hot Chili Peppers');

    // 2. Save library including followed artists to cloud
    await authService.saveUserLibrary(
      pcUser.uid,
      [mockTrack1],
      [],
      [],
      followed
    );

    // 3. Simulate another device loading user library
    const cloudLib = await authService.loadUserLibrary(pcUser.uid);
    expect(cloudLib).toBeDefined();
    expect(cloudLib?.followedArtists).toBeDefined();
    expect(cloudLib?.followedArtists?.length).toBe(1);
    expect(cloudLib?.followedArtists?.[0].name).toBe('Red Hot Chili Peppers');

    // 4. Verify recommendation engine prioritizes followed artist tracks
    const otherTrack: Track = {
      id: 'track-other',
      title: 'Unrelated Electronic Track',
      artist: 'Unknown Synth Project',
      duration: 200,
      artworkUrl: '',
      streamUrl: '',
      source: 'audius',
      sourceMetadata: { genre: 'Electronic' },
    };

    const catalogue = [otherTrack, mockTrack2];
    const recs = recommendationEngine.generateMadeForYou([], catalogue, [], cloudLib?.followedArtists || []);
    expect(recs.length).toBeGreaterThan(0);
    // The first track should be the followed artist track due to the affinity boost
    expect(recs[0].artist).toBe('Red Hot Chili Peppers');
  });

  it('handles deep link auth URI parsing smoothly for Android browser redirects', async () => {
    const uri = 'dotify://auth?uid=test_uid_123&email=mobile%40google.com&displayName=MobileUser';
    const user = await authService.handleDeepLinkAuth(uri);
    expect(user).toBeDefined();
    expect(user?.email).toBe('mobile@google.com');
    expect(user?.displayName).toBe('MobileUser');
    expect(user?.uid).toBe('test_uid_123');
  });
});
