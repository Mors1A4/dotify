import { describe, it, expect, beforeEach } from 'vitest';
import { dailyVibeManager, DEFAULT_VIBE_PRESETS } from '../../src/services/dailyVibeManager';
import { geminiVibeService } from '../../src/services/geminiVibeService';
import { UserVibeConfig } from '../../src/types/vibes';

describe('Daily Vibe Customization & Curation Rules', () => {
  beforeEach(() => {
    (dailyVibeManager as any).inMemoryCache.clear();
  });

  it('provides 10 high-fidelity default presets', () => {
    expect(DEFAULT_VIBE_PRESETS).toHaveLength(10);
    const ids = DEFAULT_VIBE_PRESETS.map((p) => p.id);
    expect(ids).toContain('gaming');
    expect(ids).toContain('working');
    expect(ids).toContain('partying');
    expect(ids).toContain('chilling');
    expect(ids).toContain('workout');
    expect(ids).toContain('nightdrive');
    expect(ids).toContain('coffee');
    expect(ids).toContain('coding');
    expect(ids).toContain('meditation');
    expect(ids).toContain('nostalgia');

    // Ensure all presets have meaningful labels and soundscape prompts
    for (const p of DEFAULT_VIBE_PRESETS) {
      expect(p.label.length).toBeGreaterThan(2);
      expect(p.prompt.length).toBeGreaterThan(10);
      expect(p.defaultCover).toBeTruthy();
    }
  });

  it('fresh accounts start unconfigured until user explicitly selects/types their 5 vibes', () => {
    expect(dailyVibeManager.hasUserConfiguredVibes('fresh-client-account')).toBe(false);
    expect(dailyVibeManager.getUserVibes('fresh-client-account')).toEqual([]);
    expect(dailyVibeManager.getDefaultPresetSuggestions()).toHaveLength(10);
  });

  it('does not auto-generate playlists for unconfigured accounts', async () => {
    const unconfigured = await dailyVibeManager.getDailyVibes('unconfigured-client-account');
    expect(unconfigured).toEqual([]);
  });

  it('persists customized vibes with edited labels and soundscape prompts', () => {
    const customized: UserVibeConfig[] = [
      {
        id: 'coding',
        label: 'Flow State',
        prompt: 'Minimal progressive trance and modular synthesizers for deep architecture design',
        themeColor: 'emerald',
      },
      {
        id: 'nightdrive',
        label: 'Nocturnal Cruiser',
        prompt: 'Synth-pop and darkwave for late-night city driving',
        themeColor: 'purple',
      },
      {
        id: 'coffee',
        label: 'Acoustic Sunrise',
        prompt: 'Gentle morning bossa nova and folk fingerpicking',
        themeColor: 'amber',
      },
      {
        id: 'meditation',
        label: 'Mindfulness',
        prompt: 'Deep binaural ambient drones and slow piano chords',
        themeColor: 'blue',
      },
      {
        id: 'custom_client_vibe',
        label: 'Client Showcase',
        prompt: 'High-end modern luxury electronica and sleek lounge beats',
        themeColor: 'rose',
      },
    ];

    dailyVibeManager.saveUserVibes(customized, 'client-vip');
    const loaded = dailyVibeManager.getUserVibes('client-vip');

    expect(loaded).toHaveLength(5);
    expect(loaded[0].label).toBe('Flow State');
    expect(loaded[0].prompt).toBe(
      'Minimal progressive trance and modular synthesizers for deep architecture design'
    );
    expect(loaded[4].id).toBe('custom_client_vibe');
    expect(loaded[4].label).toBe('Client Showcase');
  });

  it('curates playlists honoring dynamic custom vibes in fallback engine', () => {
    const userVibes: UserVibeConfig[] = [
      { id: 'coding', label: 'Deep Code', prompt: 'Coding flow beats' },
      { id: 'coffee', label: 'Morning Brew', prompt: 'Morning coffee acoustics' },
      { id: 'nightdrive', label: 'Night Ride', prompt: 'Neon highway synthwave' },
      { id: 'nostalgia', label: 'Oldies Gold', prompt: '80s and 90s anthems' },
      { id: 'meditation', label: 'Zen Calm', prompt: 'Pure ambient peace' },
    ];

    const result = geminiVibeService.generateAlgorithmicFallback(
      {
        topGenreGroups: [],
        dominantGenre: 'Electronic & Dance',
        topArtists: [],
        topTracks: [],
        totalPlays: 0,
        totalListeningTimeMs: 0,
        isColdStart: false,
        summaryText: 'Test Taste Profile',
      },
      userVibes
    );

    expect(result).toHaveLength(5);
    expect(result.map((r) => r.vibe)).toEqual([
      'coding',
      'coffee',
      'nightdrive',
      'nostalgia',
      'meditation',
    ]);

    // Check titles match custom vibe labels
    expect(result[0].title).toBe('Deep Code Mix');
    expect(result[1].title).toBe('Morning Brew Mix');
    expect(result[2].title).toBe('Night Ride Mix');
    expect(result[3].title).toBe('Oldies Gold Mix');
    expect(result[4].title).toBe('Zen Calm Mix');
  });
});
