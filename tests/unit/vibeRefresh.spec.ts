import { describe, it, expect, beforeEach, vi } from 'vitest';
import { dailyVibeManager, DEFAULT_VIBE_PRESETS } from '../../src/services/dailyVibeManager';
import { geminiVibeService } from '../../src/services/geminiVibeService';
import { safeStorage } from '../../src/utils/storage';
import { usePlayerStore } from '../../src/store/playerStore';

describe('On-Demand Vibe Refresh Engine', () => {
  const accountId = 'refresh-test-user';

  beforeEach(() => {
    (dailyVibeManager as any).inMemoryCache.clear();
    usePlayerStore.setState({ playlists: [] });
    // Configure default 5 vibes for test user so account is active
    dailyVibeManager.saveUserVibes(DEFAULT_VIBE_PRESETS.slice(0, 5), accountId);

    // Mock Gemini API in unit tests to use deterministic rotational fallback engine
    vi.spyOn(geminiVibeService, 'generateDailyVibePlaylists').mockImplementation(
      async (tasteProfile, _date, vibes) => ({
        playlists: geminiVibeService.generateAlgorithmicFallback(tasteProfile, vibes),
        modelUsed: 'Multi-Domain Algorithmic Engine',
        fromFallback: true,
      })
    );
  });

  it('generates fresh vibe playlists and stores them in active and daily cache', async () => {
    const initialVibes = await dailyVibeManager.getDailyVibes(accountId);
    expect(initialVibes).toBeDefined();
    expect(initialVibes.length).toBe(5);

    const activeKey = dailyVibeManager.getActiveVibesKey(accountId);
    const activeCache = safeStorage.getItem<any>(activeKey, null);
    expect(activeCache).not.toBeNull();
    expect(activeCache.playlists.length).toBe(5);
  });

  it('rotates and refreshes tracks when forceRegenerate is true or refreshVibes() is called', async () => {
    const setA = await dailyVibeManager.getDailyVibes(accountId, true);
    expect(setA.length).toBe(5);

    const gamingA = setA.find((p) => p.vibe === 'gaming');
    expect(gamingA).toBeDefined();
    const trackTitlesA = gamingA!.tracks.map((t) => t.title);

    // Refresh again
    const setB = await dailyVibeManager.refreshVibes(accountId);
    expect(setB.length).toBe(5);

    const gamingB = setB.find((p) => p.vibe === 'gaming');
    expect(gamingB).toBeDefined();
    const trackTitlesB = gamingB!.tracks.map((t) => t.title);

    // Verify track ordering or selection rotated
    expect(trackTitlesA.length).toBeGreaterThan(0);
    expect(trackTitlesB.length).toBeGreaterThan(0);
    // At least one position is different due to rotational shuffle
    const isDifferent = trackTitlesA.some((title, idx) => title !== trackTitlesB[idx]);
    expect(isDifferent).toBe(true);
  });

  it('automatically synchronizes saved library playlists when vibes are refreshed', async () => {
    // 1. Initial curation
    const initialVibes = await dailyVibeManager.getDailyVibes(accountId);
    const workoutVibe = initialVibes.find((p) => p.vibe === 'workout')!;
    expect(workoutVibe).toBeDefined();

    // 2. User saves it to their permanent library
    dailyVibeManager.saveVibeToLibrary(workoutVibe);
    const savedPlaylistsBefore = usePlayerStore.getState().playlists;
    expect(savedPlaylistsBefore.length).toBe(1);
    const savedWorkoutBefore = savedPlaylistsBefore[0];
    expect(savedWorkoutBefore.tracks.length).toBeGreaterThan(0);

    // 3. User refreshes their vibes on demand
    const refreshedVibes = await dailyVibeManager.refreshVibes(accountId);
    const refreshedWorkout = refreshedVibes.find((p) => p.vibe === 'workout')!;

    // 4. Check library playlists - should have automatically updated tracks!
    const savedPlaylistsAfter = usePlayerStore.getState().playlists;
    expect(savedPlaylistsAfter.length).toBe(1);
    const savedWorkoutAfter = savedPlaylistsAfter[0];
    expect(savedWorkoutAfter.tracks.map((t) => t.id)).toEqual(refreshedWorkout.tracks.map((t) => t.id));
  });

  it('resolves vibe playlists across IDs even if date prefix changed', async () => {
    const vibes = await dailyVibeManager.getDailyVibes(accountId);
    const chill = vibes.find((p) => p.vibe === 'chilling')!;

    // Exact ID lookup
    const resolvedDirect = dailyVibeManager.getVibePlaylistById(chill.id);
    expect(resolvedDirect).not.toBeNull();
    expect(resolvedDirect?.name).toBe(chill.name);

    // Old date or generic ID lookup
    const resolvedLegacy = dailyVibeManager.getVibePlaylistById('daily-vibe-chilling-2025-01-01');
    expect(resolvedLegacy).not.toBeNull();
    expect(resolvedLegacy?.vibe).toBe('chilling');
  });
});
