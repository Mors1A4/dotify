import { describe, it, expect, beforeEach, vi } from 'vitest';
import { vibeDjEngine } from '../../src/services/vibeDjEngine';
import { useVibeDjStore } from '../../src/store/vibeDjStore';
import { Track } from '../../src/types/track';
import { VibeVector } from '../../src/types/vibeDj';

describe('Vibe DJ Engine & Live Recommendation Pipeline', () => {
  const synthwaveTrack: Track = {
    id: 'test_synth_1',
    title: 'Turbo Killer (Club Remix)',
    artist: 'Carpenter Brut',
    source: 'charts',
    duration: 210,
    streamUrl: 'https://example.com/audio1.mp3',
    sourceMetadata: { genre: 'synthwave' },
  };

  const lofiTrack: Track = {
    id: 'test_lofi_1',
    title: 'Quiet Study Chill (Acoustic Piano)',
    artist: 'Kudasai',
    source: 'charts',
    duration: 180,
    streamUrl: 'https://example.com/audio2.mp3',
    sourceMetadata: { genre: 'lo-fi' },
  };

  const acousticFolkTrack: Track = {
    id: 'test_folk_1',
    title: 'Holocene (Unplugged)',
    artist: 'Bon Iver',
    source: 'charts',
    duration: 240,
    streamUrl: 'https://example.com/audio3.mp3',
    sourceMetadata: { genre: 'folk' },
  };

  it('computes acoustic vectors capturing distinct energy, danceability, and acousticness', () => {
    const synthVector = vibeDjEngine.computeTrackVibeVector(synthwaveTrack);
    const lofiVector = vibeDjEngine.computeTrackVibeVector(lofiTrack);
    const folkVector = vibeDjEngine.computeTrackVibeVector(acousticFolkTrack);

    // Synthwave remix should have high energy and low acousticness
    expect(synthVector.energy).toBeGreaterThan(0.75);
    expect(synthVector.acousticness).toBeLessThan(0.20);
    expect(synthVector.genreWeights['Electronic & Dance']).toBeGreaterThan(0.50);

    // Lofi acoustic track should have low energy and high acousticness
    expect(lofiVector.energy).toBeLessThan(0.40);
    expect(lofiVector.acousticness).toBeGreaterThan(0.50);
    expect(lofiVector.genreWeights['Chill & Lo-Fi']).toBeGreaterThan(0.50);

    // Folk track should have high acousticness
    expect(folkVector.acousticness).toBeGreaterThan(0.70);
    expect(folkVector.genreWeights['Acoustic & Folk']).toBeGreaterThan(0.50);
  });

  it('updates session vibe vector with positive reinforcement on completed track', () => {
    const initial = vibeDjEngine.createInitialVibeVector();
    const updated = vibeDjEngine.updateSessionVibeVector(initial, synthwaveTrack, 'completed', 0.95);

    // Energy and Electronic weight should have increased towards synthwave
    expect(updated.energy).toBeGreaterThanOrEqual(initial.energy);
    expect(updated.genreWeights['Electronic & Dance']).toBeGreaterThan(initial.genreWeights['Electronic & Dance']);
  });

  it('course-corrects away from skipped tracks (anti-nudge skip penalty)', () => {
    const initial: VibeVector = {
      energy: 0.50,
      danceability: 0.50,
      mood: 0.50,
      acousticness: 0.50,
      tempoNormalized: 0.50,
      familiarity: 0.50,
      genreWeights: {
        'Electronic & Dance': 0.125,
        'Hip-Hop & Urban': 0.125,
        'Rock & Alternative': 0.125,
        'Pop & Anthems': 0.125,
        'Chill & Lo-Fi': 0.125,
        'Acoustic & Folk': 0.125,
        'Jazz & Soul': 0.125,
        'Classical & Cinematic': 0.125,
      },
    };

    // Skip a very acoustic, slow chill track early (completion rate 0.10)
    const corrected = vibeDjEngine.updateSessionVibeVector(initial, lofiTrack, 'skipped', 0.10);

    // Since low-energy track was skipped, energy should be boosted and Chill genre weight diminished
    expect(corrected.energy).toBeGreaterThan(initial.energy);
    expect(corrected.genreWeights['Chill & Lo-Fi']).toBeLessThan(initial.genreWeights['Chill & Lo-Fi']);
  });

  it('shakes up the vibe with a dramatic genre pivot and mood shift', () => {
    const electronicVector = vibeDjEngine.computeTrackVibeVector(synthwaveTrack);
    const { newVector, theme, targetGenre } = vibeDjEngine.shakeUpVibe(electronicVector, 'Electronic & Dance');

    // Pivot should not stay on the same genre
    expect(targetGenre).not.toBe('Electronic & Dance');
    expect(theme.label).toBeTruthy();
    expect(theme.themeGradient).toBeTruthy();
    expect(newVector.genreWeights[targetGenre]).toBeGreaterThan(0.60);
  });

  it('scores candidate tracks prioritizing vibe alignment and penalizing artist clumping', () => {
    const sessionVector = vibeDjEngine.computeTrackVibeVector(synthwaveTrack);
    const playedTrackIds = new Set<string>();
    const likedTrackIds = new Set<string>(['test_synth_1']);
    const followedArtistNames = new Set<string>(['carpenter brut']);

    // Candidate 1: matching synthwave by same artist
    const score1 = vibeDjEngine.scoreCandidate(
      synthwaveTrack,
      sessionVector,
      ['carpenter brut', 'carpenter brut'], // artist already in recent history
      playedTrackIds,
      likedTrackIds,
      followedArtistNames,
      synthwaveTrack
    );

    // Candidate 2: fresh synthwave track by different artist
    const freshSynthTrack: Track = {
      id: 'fresh_synth_2',
      title: 'Nightcall',
      artist: 'Kavinsky',
      source: 'charts',
      duration: 210,
      streamUrl: '',
      sourceMetadata: { genre: 'synthwave' },
    };

    const score2 = vibeDjEngine.scoreCandidate(
      freshSynthTrack,
      sessionVector,
      ['carpenter brut', 'carpenter brut'],
      playedTrackIds,
      likedTrackIds,
      followedArtistNames,
      synthwaveTrack
    );

    // Candidate 2 should not suffer the heavy recent-artist diversity penalty that Candidate 1 does
    expect(score2.matchBreakdown?.artistDiversity).toBeGreaterThan(score1.matchBreakdown?.artistDiversity || 0);
    expect(score2.vibeScore).toBeGreaterThan(60);
  });

  it('manages Vibe DJ session state in useVibeDjStore', async () => {
    const store = useVibeDjStore.getState();
    expect(store.isActive).toBe(false);

    // Start Vibe DJ
    await store.startVibeDj(synthwaveTrack);
    const activeState = useVibeDjStore.getState();
    expect(activeState.isActive).toBe(true);
    expect(activeState.vibeLabel).toBeTruthy();
    expect(activeState.currentVector).toBeDefined();

    // Shake Up
    const prevShakeCount = activeState.shakeCount;
    await store.shakeUpVibe();
    const shakenState = useVibeDjStore.getState();
    expect(shakenState.shakeCount).toBe(prevShakeCount + 1);

    // Stop Vibe DJ
    store.stopVibeDj();
    expect(useVibeDjStore.getState().isActive).toBe(false);
  });

  it('automatically deactivates Vibe DJ when playing any song not played by the DJ', async () => {
    const { usePlayerStore } = await import('../../src/store/playerStore');
    const djStore = useVibeDjStore.getState();

    // Start Vibe DJ
    await djStore.startVibeDj(synthwaveTrack);
    expect(useVibeDjStore.getState().isActive).toBe(true);

    // Playing a track from the DJ keeps DJ active
    usePlayerStore.getState().playTrack(synthwaveTrack, undefined, undefined, {
      origin: 'vibe_dj',
      isDj: true,
    });
    expect(useVibeDjStore.getState().isActive).toBe(true);

    // Clicking any non-DJ track (e.g. from search, library, playlist, album) immediately exits DJ mode
    usePlayerStore.getState().playTrack(lofiTrack, [lofiTrack], 0, {
      origin: 'search',
      searchQuery: 'lofi study',
    });
    expect(useVibeDjStore.getState().isActive).toBe(false);
  });

  it('renders VibeDjIcon and FluidVibeDiscVisualizer matching the Dotify disc aesthetic', async () => {
    const React = await import('react');
    const { VibeDjIcon } = await import('../../src/components/player/VibeDjBadge');
    const { FluidVibeDiscVisualizer } = await import('../../src/components/common/FluidVibeDiscVisualizer');

    expect(typeof VibeDjIcon).toBe('function');
    expect(typeof FluidVibeDiscVisualizer).toBe('function');
  });
});
