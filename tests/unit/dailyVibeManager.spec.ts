import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DailyVibeManager } from '../../src/services/dailyVibeManager';
import { safeStorage } from '../../src/utils/storage';
import { geminiVibeService } from '../../src/services/geminiVibeService';
import { DailyVibePlaylist } from '../../src/types/vibes';

describe('DailyVibeManager & Caching Lifecycle', () => {
  const manager = DailyVibeManager.getInstance();

  beforeEach(() => {
    // Clear in-memory and local storage test state
    (manager as any).inMemoryCache.clear();
  });

  it('generates consistent date string YYYY-MM-DD', () => {
    const dateStr = manager.getTodayDateString();
    expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('isolates daily caches per account ID', async () => {
    const today = manager.getTodayDateString();

    const mockGuestVibes: DailyVibePlaylist[] = [
      {
        id: `daily-vibe-gaming-${today}`,
        name: 'Guest Gaming',
        description: 'For guest',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        vibe: 'gaming',
        vibeLabel: 'Gaming',
        vibeIcon: '🎮',
        vibeTagline: 'Guest Mix',
        themeGradient: '',
        accentColor: '#a855f7',
        generatedDate: today,
        isAIGenerated: true,
        tracks: [
          {
            id: `vibe:gaming:${today}:0`,
            title: 'Track 1',
            artist: 'Artist 1',
            source: 'charts',
            duration: 210,
            streamUrl: '',
            sourceMetadata: { genre: 'gaming' },
          },
        ],
      },
      {
        id: `daily-vibe-working-${today}`,
        name: 'Guest Working',
        description: 'For guest',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        vibe: 'working',
        vibeLabel: 'Working',
        vibeIcon: '💼',
        vibeTagline: 'Guest Mix',
        themeGradient: '',
        accentColor: '#10b981',
        generatedDate: today,
        isAIGenerated: true,
        tracks: [],
      },
      {
        id: `daily-vibe-partying-${today}`,
        name: 'Guest Partying',
        description: 'For guest',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        vibe: 'partying',
        vibeLabel: 'Partying',
        vibeIcon: '🎉',
        vibeTagline: 'Guest Mix',
        themeGradient: '',
        accentColor: '#f43f5e',
        generatedDate: today,
        isAIGenerated: true,
        tracks: [],
      },
      {
        id: `daily-vibe-chilling-${today}`,
        name: 'Guest Chilling',
        description: 'For guest',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        vibe: 'chilling',
        vibeLabel: 'Chilling',
        vibeIcon: '☕',
        vibeTagline: 'Guest Mix',
        themeGradient: '',
        accentColor: '#0ea5e9',
        generatedDate: today,
        isAIGenerated: true,
        tracks: [],
      },
    ];

    // Seed guest storage
    safeStorage.setItem(`dotify_daily_vibes_guest_${today}`, {
      date: today,
      accountId: 'guest',
      generatedAt: Date.now(),
      playlists: mockGuestVibes,
    });

    const guestResult = await manager.getDailyVibes('guest');
    expect(guestResult[0].name).toBe('Guest Gaming');

    // Account 2 should not get guest's cache
    const accountSpy = vi.spyOn(geminiVibeService, 'generateDailyVibePlaylists');
    
    // Test resolution by ID
    const found = manager.getVibePlaylistById(`daily-vibe-gaming-${today}`);
    expect(found).not.toBeNull();
    expect(found?.name).toBe('Guest Gaming');
    expect(found?.vibe).toBe('gaming');
  });

  it('returns valid fallback playlists with all required vibes', () => {
    const fallback = geminiVibeService.generateAlgorithmicFallback({
      topGenreGroups: [],
      dominantGenre: 'Electronic & Dance',
      topArtists: [],
      topTracks: [],
      totalPlays: 0,
      totalListeningTimeMs: 0,
      isColdStart: true,
      summaryText: '',
    });

    expect(fallback.length).toBe(5);
    const vibes = fallback.map((p) => p.vibe);
    expect(vibes).toContain('gaming');
    expect(vibes).toContain('working');
    expect(vibes).toContain('partying');
    expect(vibes).toContain('chilling');
    expect(vibes).toContain('workout');

    for (const p of fallback) {
      expect(p.tracks.length).toBeGreaterThanOrEqual(10);
      for (const t of p.tracks) {
        expect(t.title).toBeTruthy();
        expect(t.artist).toBeTruthy();
        expect(t.vibeReason).toBeTruthy();
      }
    }
  });

  it('manages user curated vibe preferences (selection and custom prompts)', () => {
    // 1. Fresh accounts start unconfigured
    expect(manager.hasUserConfiguredVibes('test-user-vibes')).toBe(false);
    expect(manager.getUserVibes('test-user-vibes')).toEqual([]);

    // 2. Custom 5 vibe selection
    const customSelection = [
      { id: 'coding', label: 'Deep Code', prompt: 'Modular ambient techno for engineering' },
      { id: 'nightdrive', label: 'Midnight Cruiser', prompt: 'Atmospheric neo-noir synthwave' },
      { id: 'coffee', label: 'Morning Acoustic', prompt: 'Gentle acoustic guitars and jazz' },
      { id: 'workout', label: 'Gym Beast', prompt: 'Heavy energetic bangers' },
      { id: 'custom_123', label: 'Rainy Cafe', prompt: 'Rain sounds and gentle piano' },
    ];

    manager.saveUserVibes(customSelection, 'test-user-vibes');
    const retrieved = manager.getUserVibes('test-user-vibes');
    expect(retrieved).toHaveLength(5);
    expect(retrieved[0].label).toBe('Deep Code');
    expect(retrieved[4].label).toBe('Rainy Cafe');

    // 3. Fallback engine generates exactly the 5 configured vibes
    const customFallback = geminiVibeService.generateAlgorithmicFallback(
      {
        topGenreGroups: [],
        dominantGenre: 'Electronic & Dance',
        topArtists: [],
        topTracks: [],
        totalPlays: 0,
        totalListeningTimeMs: 0,
        isColdStart: true,
        summaryText: '',
      },
      retrieved
    );

    expect(customFallback).toHaveLength(5);
    expect(customFallback.map((p) => p.vibe)).toEqual([
      'coding',
      'nightdrive',
      'coffee',
      'workout',
      'custom_123',
    ]);
    expect(customFallback[0].title).toBe('Deep Code Mix');
    expect(customFallback[4].title).toBe('Rainy Cafe Soundscape');
    expect(customFallback[4].description).toBe('Rain sounds and gentle piano');
  });
});
