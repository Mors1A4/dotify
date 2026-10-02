import { Track } from '../types/track';
import { MacroGenre } from '../types/vibes';
import {
  VibeVector,
  VibeDjTrackRecommendation,
  VibeDjArtistRecommendation,
  VibeDjHistoryItem,
} from '../types/vibeDj';
import { genreProfiler } from './genreProfiler';
import { telemetryDb } from './telemetryDb';
import { recommendationEngine } from './recommendationEngine';
import { fetchTopCharts, searchCharts } from './chartsApi';
import { geminiVibeService } from './geminiVibeService';
import { getTrackArtwork, resolveTrackArtwork, isUglyPlaceholder } from './artworkService';
import { extractPrimaryArtist } from './artistService';
import { isUserFavouredPlay } from './listeningClassifier';
import { TrackPlayRecord, ArtistAffinityRecord } from '../types/telemetry';
import { FollowedArtist } from '../types/artist';

const ALL_MACRO_GENRES: MacroGenre[] = [
  'Electronic & Dance',
  'Hip-Hop & Urban',
  'Rock & Alternative',
  'Pop & Anthems',
  'Chill & Lo-Fi',
  'Acoustic & Folk',
  'Jazz & Soul',
  'Classical & Cinematic',
];

interface VibeThemeMeta {
  label: string;
  tagline: string;
  themeColor: 'purple' | 'emerald' | 'rose' | 'blue' | 'amber';
  themeGradient: string;
  accentColor: string;
}

const GENRE_THEMES: Record<MacroGenre, VibeThemeMeta> = {
  'Electronic & Dance': {
    label: 'Neon Cyber Circuit',
    tagline: 'Driving synthesizers, rhythmic kinetic drops, and high-adrenaline momentum',
    themeColor: 'purple',
    themeGradient: 'from-purple-950/90 via-slate-900 to-indigo-950 border-purple-500/40',
    accentColor: '#a855f7',
  },
  'Hip-Hop & Urban': {
    label: 'Urban Bassline Flow',
    tagline: 'Crisp boom-bap cadences, heavyweight 808s, and lyrical groove',
    themeColor: 'amber',
    themeGradient: 'from-amber-950/90 via-stone-900 to-yellow-950 border-amber-500/40',
    accentColor: '#f59e0b',
  },
  'Rock & Alternative': {
    label: 'Electric Velocity',
    tagline: 'Raw overdrive guitars, driving anthems, and visceral acoustic presence',
    themeColor: 'rose',
    themeGradient: 'from-rose-950/90 via-slate-900 to-red-950 border-rose-500/40',
    accentColor: '#f43f5e',
  },
  'Pop & Anthems': {
    label: 'Prismatic Euphoria',
    tagline: 'Soaring singalong hooks, radiant festival energy, and uplifting rhythms',
    themeColor: 'rose',
    themeGradient: 'from-pink-950/90 via-slate-900 to-rose-950 border-pink-500/40',
    accentColor: '#fb7185',
  },
  'Chill & Lo-Fi': {
    label: 'Velvet Midnight Reverie',
    tagline: 'Mellow vinyl crackle, tape-warm Rhodes chords, and restorative stillness',
    themeColor: 'blue',
    themeGradient: 'from-blue-950/90 via-slate-900 to-cyan-950 border-blue-500/40',
    accentColor: '#38bdf8',
  },
  'Acoustic & Folk': {
    label: 'Sunlit Timber & Soul',
    tagline: 'Organic fingerpicked melodies, intimate harmonies, and timeless storytelling',
    themeColor: 'emerald',
    themeGradient: 'from-emerald-950/90 via-stone-900 to-teal-950 border-emerald-500/40',
    accentColor: '#10b981',
  },
  'Jazz & Soul': {
    label: 'Smoky Groove Lounge',
    tagline: 'Warm brass textures, syncopated upright bass, and velvet vocal warmth',
    themeColor: 'amber',
    themeGradient: 'from-amber-950/90 via-slate-900 to-orange-950 border-amber-600/40',
    accentColor: '#d97706',
  },
  'Classical & Cinematic': {
    label: 'Symphonic Infinity',
    tagline: 'Expansive orchestral swells, contemplative piano, and cinematic grandeur',
    themeColor: 'purple',
    themeGradient: 'from-indigo-950/90 via-slate-900 to-violet-950 border-indigo-500/40',
    accentColor: '#818cf8',
  },
};

export class VibeDjEngine {
  private static instance: VibeDjEngine;

  public static getInstance(): VibeDjEngine {
    if (!VibeDjEngine.instance) {
      VibeDjEngine.instance = new VibeDjEngine();
    }
    return VibeDjEngine.instance;
  }

  /**
   * Initializes a neutral or telemetry-seeded vibe vector.
   */
  public createInitialVibeVector(
    seedTrack?: Track | null,
    recentPlays: TrackPlayRecord[] = []
  ): VibeVector {
    if (seedTrack) {
      return this.computeTrackVibeVector(seedTrack);
    }

    if (recentPlays && recentPlays.length > 0) {
      // Build vector from recent 10 plays with exponential recency decay
      const valid = recentPlays.slice(-10);
      let cumulative: VibeVector = this.getZeroVibeVector();
      let totalWeight = 0;

      valid.forEach((play, idx) => {
        const weight = Math.pow(1.2, idx); // latest gets highest weight
        const synthTrack: Track = {
          id: play.trackId,
          title: play.title,
          artist: play.artist,
          source: play.source || 'charts',
          duration: Math.round((play.totalDurationMs || 210000) / 1000),
          streamUrl: '',
          sourceMetadata: { genre: play.genre },
        };
        const v = this.computeTrackVibeVector(synthTrack);
        cumulative = this.addWeightedVector(cumulative, v, weight);
        totalWeight += weight;
      });

      if (totalWeight > 0) {
        return this.scaleVector(cumulative, 1 / totalWeight);
      }
    }

    // Default warm electronic/pop starter vector
    return {
      energy: 0.65,
      danceability: 0.70,
      mood: 0.68,
      acousticness: 0.25,
      tempoNormalized: 0.60,
      familiarity: 0.60,
      genreWeights: {
        'Electronic & Dance': 0.40,
        'Pop & Anthems': 0.30,
        'Hip-Hop & Urban': 0.15,
        'Chill & Lo-Fi': 0.15,
        'Rock & Alternative': 0.0,
        'Acoustic & Folk': 0.0,
        'Jazz & Soul': 0.0,
        'Classical & Cinematic': 0.0,
      },
    };
  }

  /**
   * Extracts an acoustic vibe vector for any given track based on genre, artist, and acoustic keywords.
   */
  public computeTrackVibeVector(track: Track): VibeVector {
    const genre = track.sourceMetadata?.genre || '';
    const macroGenre = genreProfiler.classifyGenre(genre, track.artist, track.title);
    const titleLower = (track.title || '').toLowerCase();
    const artistLower = (track.artist || '').toLowerCase();

    // Baseline metrics by MacroGenre
    let energy = 0.5;
    let danceability = 0.5;
    let mood = 0.5;
    let acousticness = 0.5;
    let tempoNormalized = 0.5;

    switch (macroGenre) {
      case 'Electronic & Dance':
        energy = 0.85;
        danceability = 0.92;
        mood = 0.75;
        acousticness = 0.05;
        tempoNormalized = 0.72;
        break;
      case 'Hip-Hop & Urban':
        energy = 0.72;
        danceability = 0.85;
        mood = 0.62;
        acousticness = 0.15;
        tempoNormalized = 0.55;
        break;
      case 'Rock & Alternative':
        energy = 0.82;
        danceability = 0.52;
        mood = 0.55;
        acousticness = 0.30;
        tempoNormalized = 0.68;
        break;
      case 'Pop & Anthems':
        energy = 0.74;
        danceability = 0.82;
        mood = 0.82;
        acousticness = 0.22;
        tempoNormalized = 0.64;
        break;
      case 'Chill & Lo-Fi':
        energy = 0.28;
        danceability = 0.38;
        mood = 0.50;
        acousticness = 0.60;
        tempoNormalized = 0.38;
        break;
      case 'Acoustic & Folk':
        energy = 0.38;
        danceability = 0.32;
        mood = 0.60;
        acousticness = 0.92;
        tempoNormalized = 0.45;
        break;
      case 'Jazz & Soul':
        energy = 0.50;
        danceability = 0.62;
        mood = 0.66;
        acousticness = 0.70;
        tempoNormalized = 0.50;
        break;
      case 'Classical & Cinematic':
        energy = 0.40;
        danceability = 0.18;
        mood = 0.52;
        acousticness = 0.85;
        tempoNormalized = 0.42;
        break;
    }

    // Keyword heuristics tuning
    if (
      titleLower.includes('remix') ||
      titleLower.includes('club') ||
      titleLower.includes('hard') ||
      titleLower.includes('bass') ||
      titleLower.includes('turbo') ||
      titleLower.includes('drill')
    ) {
      energy = Math.min(1.0, energy + 0.15);
      danceability = Math.min(1.0, danceability + 0.10);
      tempoNormalized = Math.min(1.0, tempoNormalized + 0.12);
    }

    if (
      titleLower.includes('slowed') ||
      titleLower.includes('acoustic') ||
      titleLower.includes('lofi') ||
      titleLower.includes('ambient') ||
      titleLower.includes('sleep') ||
      titleLower.includes('chill') ||
      titleLower.includes('unplugged') ||
      titleLower.includes('piano')
    ) {
      energy = Math.max(0.1, energy - 0.25);
      acousticness = Math.min(1.0, acousticness + 0.30);
      tempoNormalized = Math.max(0.1, tempoNormalized - 0.20);
    }

    if (
      titleLower.includes('happy') ||
      titleLower.includes('party') ||
      titleLower.includes('summer') ||
      titleLower.includes('sun') ||
      titleLower.includes('love') ||
      titleLower.includes('euphoria')
    ) {
      mood = Math.min(1.0, mood + 0.18);
    }

    if (
      titleLower.includes('sad') ||
      titleLower.includes('dark') ||
      titleLower.includes('cry') ||
      titleLower.includes('lonely') ||
      titleLower.includes('night') ||
      titleLower.includes('shadow')
    ) {
      mood = Math.max(0.1, mood - 0.20);
    }

    // Genre distribution one-hot with minor ambient blend
    const genreWeights: Record<MacroGenre, number> = {} as any;
    for (const g of ALL_MACRO_GENRES) {
      genreWeights[g] = g === macroGenre ? 0.85 : 0.15 / (ALL_MACRO_GENRES.length - 1);
    }

    return {
      energy,
      danceability,
      mood,
      acousticness,
      tempoNormalized,
      familiarity: 0.5,
      genreWeights,
    };
  }

  /**
   * Updates the live session vibe vector based on real-time user reaction.
   * - Completion / Replay / Like: Positive reinforcement towards track characteristics.
   * - Skip (<30%): Immediate course-correction away from track characteristics.
   */
  public updateSessionVibeVector(
    currentVector: VibeVector,
    track: Track,
    outcome: 'completed' | 'skipped' | 'replayed' | 'liked',
    completionRate: number = 1.0
  ): VibeVector {
    const trackVector = this.computeTrackVibeVector(track);
    const updated = { ...currentVector, genreWeights: { ...currentVector.genreWeights } };

    if (outcome === 'skipped') {
      // Negative course-correction (repel from skipped vibe)
      const penaltyFactor = 0.35 * Math.max(0.5, 1.0 - completionRate);

      // If skipped a slow track, bump up energy; if skipped a loud track, tone it down
      const energyDelta = trackVector.energy - currentVector.energy;
      updated.energy = Math.max(0.1, Math.min(1.0, currentVector.energy - energyDelta * penaltyFactor));

      const acousticDelta = trackVector.acousticness - currentVector.acousticness;
      updated.acousticness = Math.max(0.0, Math.min(1.0, currentVector.acousticness - acousticDelta * penaltyFactor));

      // Diminish the skipped track's genre weight
      for (const g of ALL_MACRO_GENRES) {
        if (trackVector.genreWeights[g] > 0.5) {
          updated.genreWeights[g] = Math.max(0.02, updated.genreWeights[g] - 0.20);
        } else {
          updated.genreWeights[g] = Math.min(0.6, updated.genreWeights[g] + 0.04);
        }
      }
    } else {
      // Positive reinforcement
      const learningRate = outcome === 'replayed' || outcome === 'liked' ? 0.40 : 0.22;

      updated.energy = currentVector.energy + (trackVector.energy - currentVector.energy) * learningRate;
      updated.danceability = currentVector.danceability + (trackVector.danceability - currentVector.danceability) * learningRate;
      updated.mood = currentVector.mood + (trackVector.mood - currentVector.mood) * learningRate;
      updated.acousticness = currentVector.acousticness + (trackVector.acousticness - currentVector.acousticness) * learningRate;
      updated.tempoNormalized = currentVector.tempoNormalized + (trackVector.tempoNormalized - currentVector.tempoNormalized) * learningRate;

      for (const g of ALL_MACRO_GENRES) {
        updated.genreWeights[g] =
          currentVector.genreWeights[g] +
          (trackVector.genreWeights[g] - currentVector.genreWeights[g]) * learningRate;
      }
    }

    // Normalize genre weights to sum to 1.0
    const totalGenreSum = Object.values(updated.genreWeights).reduce((a, b) => a + b, 0);
    if (totalGenreSum > 0) {
      for (const g of ALL_MACRO_GENRES) {
        updated.genreWeights[g] = updated.genreWeights[g] / totalGenreSum;
      }
    }

    return updated;
  }

  /**
   * "Shake Up the Vibe": Rotates the session vector dramatically to an exciting new musical territory.
   * Guarantees at least 2 graph hops away in genre space and shifts energy/acoustic texture.
   */
  public shakeUpVibe(
    currentVector: VibeVector,
    currentDominantGenre?: MacroGenre
  ): {
    newVector: VibeVector;
    theme: VibeThemeMeta;
    targetGenre: MacroGenre;
  } {
    const dominant = currentDominantGenre || this.getDominantGenre(currentVector);

    // Complementary and contrasting rotation candidates (at least 2 hops away)
    const CONTRAST_MAP: Record<MacroGenre, MacroGenre[]> = {
      'Electronic & Dance': ['Acoustic & Folk', 'Hip-Hop & Urban', 'Rock & Alternative', 'Chill & Lo-Fi'],
      'Hip-Hop & Urban': ['Rock & Alternative', 'Electronic & Dance', 'Acoustic & Folk', 'Pop & Anthems'],
      'Rock & Alternative': ['Electronic & Dance', 'Hip-Hop & Urban', 'Chill & Lo-Fi', 'Jazz & Soul'],
      'Pop & Anthems': ['Rock & Alternative', 'Chill & Lo-Fi', 'Electronic & Dance', 'Jazz & Soul'],
      'Chill & Lo-Fi': ['Electronic & Dance', 'Rock & Alternative', 'Hip-Hop & Urban', 'Pop & Anthems'],
      'Acoustic & Folk': ['Electronic & Dance', 'Hip-Hop & Urban', 'Pop & Anthems', 'Rock & Alternative'],
      'Jazz & Soul': ['Electronic & Dance', 'Rock & Alternative', 'Pop & Anthems', 'Acoustic & Folk'],
      'Classical & Cinematic': ['Electronic & Dance', 'Hip-Hop & Urban', 'Rock & Alternative', 'Pop & Anthems'],
    };

    const candidates = CONTRAST_MAP[dominant] || ALL_MACRO_GENRES.filter((g) => g !== dominant);
    const targetGenre = candidates[Math.floor(Math.random() * candidates.length)];
    const theme = GENRE_THEMES[targetGenre];

    // Construct dramatic new vector
    const newVector: VibeVector = {
      energy: targetGenre === 'Chill & Lo-Fi' || targetGenre === 'Acoustic & Folk' ? 0.35 : 0.85,
      danceability: targetGenre === 'Electronic & Dance' || targetGenre === 'Pop & Anthems' ? 0.90 : 0.45,
      mood: currentVector.mood > 0.5 ? 0.35 : 0.80, // Invert mood for noticeable shakeup
      acousticness: targetGenre === 'Acoustic & Folk' || targetGenre === 'Classical & Cinematic' ? 0.88 : 0.10,
      tempoNormalized: targetGenre === 'Chill & Lo-Fi' ? 0.35 : 0.75,
      familiarity: 0.50,
      genreWeights: {} as any,
    };

    for (const g of ALL_MACRO_GENRES) {
      newVector.genreWeights[g] = g === targetGenre ? 0.80 : 0.20 / (ALL_MACRO_GENRES.length - 1);
    }

    return { newVector, theme, targetGenre };
  }

  /**
   * Resolves the dominant MacroGenre from a vibe vector.
   */
  public getDominantGenre(vector: VibeVector): MacroGenre {
    let topGenre: MacroGenre = 'Electronic & Dance';
    let maxWeight = -1;

    for (const [g, w] of Object.entries(vector.genreWeights) as [MacroGenre, number][]) {
      if (w > maxWeight) {
        maxWeight = w;
        topGenre = g;
      }
    }

    return topGenre;
  }

  /**
   * Returns theme styling and human-readable vibe label for the active vector.
   */
  public getThemeForVector(vector: VibeVector): VibeThemeMeta {
    const dominant = this.getDominantGenre(vector);
    const base = GENRE_THEMES[dominant] || GENRE_THEMES['Electronic & Dance'];

    if (vector.energy > 0.8) {
      return {
        ...base,
        label: `${base.label} (High Energy)`,
      };
    } else if (vector.energy < 0.35) {
      return {
        ...base,
        label: `${base.label} (Mellow Downtempo)`,
      };
    }
    return base;
  }

  /**
   * Scores a candidate track against the active session vector and user telemetry.
   */
  public scoreCandidate(
    candidate: Track,
    sessionVector: VibeVector,
    recentArtists: string[],
    playedTrackIds: Set<string>,
    likedTrackIds: Set<string>,
    followedArtistNames: Set<string>,
    lastTrack?: Track | null
  ): VibeDjTrackRecommendation {
    const trackVector = this.computeTrackVibeVector(candidate);
    const candidatePrimaryArtist = extractPrimaryArtist(candidate.artist).toLowerCase().trim();

    // 1. Vector Cosine Similarity (Vibe Alignment: 0.0 - 1.0)
    const energyDist = Math.abs(sessionVector.energy - trackVector.energy);
    const acousticDist = Math.abs(sessionVector.acousticness - trackVector.acousticness);
    const moodDist = Math.abs(sessionVector.mood - trackVector.mood);
    const danceDist = Math.abs(sessionVector.danceability - trackVector.danceability);

    let genreDotProduct = 0;
    for (const g of ALL_MACRO_GENRES) {
      genreDotProduct += (sessionVector.genreWeights[g] || 0) * (trackVector.genreWeights[g] || 0);
    }

    const acousticSimilarity =
      1.0 - (energyDist * 0.35 + acousticDist * 0.25 + moodDist * 0.20 + danceDist * 0.20);
    const vibeAlignment = Math.max(0, Math.min(1.0, acousticSimilarity * 0.5 + genreDotProduct * 0.5));

    // 2. Taste Affinity (telemetry, liked tracks, followed artists)
    let tasteAffinity = 0.5;
    if (likedTrackIds.has(candidate.id)) tasteAffinity += 0.35;
    if (followedArtistNames.has(candidatePrimaryArtist)) tasteAffinity += 0.30;

    // 3. Novelty bonus (tracks user hasn't heard get a discovery lift)
    const isNovelty = !playedTrackIds.has(candidate.id);
    const noveltyBonus = isNovelty ? 0.20 : 0.05;

    // 4. Artist Diversity penalty (anti-clumping)
    let artistDiversity = 1.0;
    const last3Artists = recentArtists.slice(-3);
    const last6Artists = recentArtists.slice(-6);

    if (last3Artists.includes(candidatePrimaryArtist)) {
      artistDiversity = 0.15; // Heavy penalty if played in last 3 songs
    } else if (last6Artists.includes(candidatePrimaryArtist)) {
      artistDiversity = 0.55;
    }

    // 5. Energy Smoothing (avoid sudden jarring BPM/energy jumps)
    let energySmoothing = 1.0;
    if (lastTrack) {
      const lastVector = this.computeTrackVibeVector(lastTrack);
      const delta = Math.abs(lastVector.energy - trackVector.energy);
      if (delta > 0.45) {
        energySmoothing = Math.max(0.3, 1.0 - (delta - 0.45) * 1.5);
      }
    }

    // 6. Serendipity jitter (+/- 0.05)
    const serendipity = (Math.random() - 0.5) * 0.10;

    // Composite Weighted Score (0 to 100)
    const composite =
      vibeAlignment * 38 +
      tasteAffinity * 25 +
      noveltyBonus * 15 +
      artistDiversity * 12 +
      energySmoothing * 10 +
      serendipity * 5;

    const vibeScore = Math.round(Math.max(10, Math.min(99, composite)));

    // Generate smart reason
    const dominant = this.getDominantGenre(sessionVector);
    let vibeReason = `Curated for your ${dominant} flow`;
    if (followedArtistNames.has(candidatePrimaryArtist)) {
      vibeReason = `By ${candidate.artist} (one of your followed artists)`;
    } else if (likedTrackIds.has(candidate.id)) {
      vibeReason = `Familiar favorite matching this vibe`;
    } else if (vibeAlignment > 0.85) {
      vibeReason = `Peak match for your current soundscape`;
    } else if (isNovelty) {
      vibeReason = `Fresh discovery aligned with your taste`;
    }

    return {
      track: candidate,
      vibeScore,
      vibeReason,
      predictedEnergy: trackVector.energy,
      sourceTier: isNovelty ? 'ai_discovery' : 'taste_catalogue',
      isNovelty,
      matchBreakdown: {
        vibeAlignment,
        tasteAffinity,
        noveltyBonus,
        artistDiversity,
        energySmoothing,
      },
    };
  }

  /**
   * Generates a deep, high-quality ranked recommendation pool for Vibe DJ.
   */
  public async generateNextDjQueue(
    sessionVector: VibeVector,
    history: VibeDjHistoryItem[],
    count: number = 8
  ): Promise<{
    queue: VibeDjTrackRecommendation[];
    recommendedArtists: VibeDjArtistRecommendation[];
  }> {
    const recentArtists = history.map((h) => extractPrimaryArtist(h.track.artist).toLowerCase().trim());
    const playedTrackIds = new Set(history.map((h) => h.track.id));
    const lastTrack = history.length > 0 ? history[history.length - 1].track : null;

    // 1. Gather telemetry, likes, followed artists
    let plays: TrackPlayRecord[] = [];
    let artistAffinities: ArtistAffinityRecord[] = [];
    try {
      plays = await telemetryDb.getAllPlays();
      artistAffinities = await telemetryDb.getAllArtistAffinities();
    } catch {}

    const { likedTracks, followedArtists, playlists } =
      typeof window !== 'undefined'
        ? (await import('../store/playerStore')).usePlayerStore.getState()
        : { likedTracks: [], followedArtists: [], playlists: [] };

    const likedTrackIds = new Set((likedTracks || []).map((t) => t.id));
    const followedArtistNames = new Set(
      (followedArtists || []).map((a) => a.name.toLowerCase().trim())
    );

    for (const p of plays) {
      playedTrackIds.add(p.trackId);
    }

    // 2. Build candidate pool from multiple sources
    const candidateMap = new Map<string, Track>();

    // A. Top Charts & Genre Exploration
    try {
      const charts = await fetchTopCharts();
      for (const t of charts) {
        if (!candidateMap.has(t.id)) candidateMap.set(t.id, t);
      }
    } catch {}

    // B. Made For You & Discovery Shelves
    try {
      const shelfTracks = recommendationEngine.generateMadeForYou(
        plays,
        Array.from(candidateMap.values()),
        likedTracks,
        followedArtists
      );
      for (const t of shelfTracks) {
        if (!candidateMap.has(t.id)) candidateMap.set(t.id, t);
      }
    } catch {}

    // C. User Liked Tracks & Custom Playlists
    for (const t of likedTracks || []) {
      if (!candidateMap.has(t.id)) candidateMap.set(t.id, t);
    }
    for (const pl of playlists || []) {
      for (const t of pl.tracks || []) {
        if (!candidateMap.has(t.id)) candidateMap.set(t.id, t);
      }
    }

    // D. Target Genre Search for Deep Pool
    const dominant = this.getDominantGenre(sessionVector);
    try {
      const genreSearches = await searchCharts(dominant, 20);
      for (const t of genreSearches) {
        if (!candidateMap.has(t.id)) candidateMap.set(t.id, t);
      }
    } catch {}

    const candidates = Array.from(candidateMap.values());

    // 3. Score every candidate
    const scoredList: VibeDjTrackRecommendation[] = [];
    for (const cand of candidates) {
      const scored = this.scoreCandidate(
        cand,
        sessionVector,
        recentArtists,
        playedTrackIds,
        likedTrackIds,
        followedArtistNames,
        lastTrack
      );
      scoredList.push(scored);
    }

    // 4. Sort descending by vibeScore
    scoredList.sort((a, b) => b.vibeScore - a.vibeScore);

    // 5. Apply Anti-Clumping selection (Max 1 song per artist in top queue)
    const selectedQueue: VibeDjTrackRecommendation[] = [];
    const queueArtists = new Set<string>();

    for (const item of scoredList) {
      const artist = extractPrimaryArtist(item.track.artist).toLowerCase().trim();
      if (!queueArtists.has(artist)) {
        queueArtists.add(artist);
        selectedQueue.push(item);
      }
      if (selectedQueue.length >= count) break;
    }

    // Fallback if needed
    if (selectedQueue.length < count) {
      for (const item of scoredList) {
        if (!selectedQueue.some((q) => q.track.id === item.track.id)) {
          selectedQueue.push(item);
        }
        if (selectedQueue.length >= count) break;
      }
    }

    // 6. Generate Vibe Recommended Artists
    const recommendedArtists = this.generateVibeArtistRecommendations(
      sessionVector,
      candidates,
      plays,
      followedArtists,
      artistAffinities
    );

    return {
      queue: selectedQueue,
      recommendedArtists,
    };
  }

  /**
   * Generates 4-6 contextual artist recommendations for the current vibe.
   */
  public generateVibeArtistRecommendations(
    sessionVector: VibeVector,
    catalogue: Track[],
    plays: TrackPlayRecord[] = [],
    followedArtists: FollowedArtist[] = [],
    affinities: ArtistAffinityRecord[] = []
  ): VibeDjArtistRecommendation[] {
    const dominant = this.getDominantGenre(sessionVector);
    const followedSet = new Set(followedArtists.map((a) => a.name.toLowerCase().trim()));

    // Aggregate artists in catalogue and plays that fit this dominant genre
    const artistScores = new Map<
      string,
      {
        name: string;
        score: number;
        sampleTrackTitle: string;
        artworkUrl: string;
        isFollowed: boolean;
      }
    >();

    for (const t of catalogue) {
      const name = extractPrimaryArtist(t.artist || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const genre = genreProfiler.classifyGenre(t.sourceMetadata?.genre, t.artist, t.title);

      const isMatchingGenre = genre === dominant;
      if (!isMatchingGenre) continue;

      const isFollowed = followedSet.has(key);
      const baseBoost = isFollowed ? 25 : 10;

      if (!artistScores.has(key)) {
        artistScores.set(key, {
          name,
          score: baseBoost,
          sampleTrackTitle: t.title,
          artworkUrl: t.artworkUrl || getTrackArtwork(t),
          isFollowed,
        });
      } else {
        const existing = artistScores.get(key)!;
        existing.score += 5;
      }
    }

    // Incorporate telemetry play counts
    for (const p of plays) {
      const name = extractPrimaryArtist(p.artist || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (artistScores.has(key)) {
        const item = artistScores.get(key)!;
        const completionBonus = typeof p.completionRate === 'number' ? p.completionRate * 10 : 5;
        item.score += completionBonus;
      }
    }

    const sorted = Array.from(artistScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    return sorted.map((item) => ({
      id: `dj_artist_${item.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      name: item.name,
      reason: item.isFollowed
        ? `Artist you follow in ${dominant}`
        : item.score > 25
        ? `High affinity artist in your ${dominant} history`
        : `Trending soundscape pioneer in ${dominant}`,
      sampleTrackTitle: item.sampleTrackTitle,
      artworkUrl: item.artworkUrl,
      affinityScore: Math.min(100, item.score * 2),
      macroGenre: dominant,
      isFollowed: item.isFollowed,
    }));
  }

  // --- Vector Helper Math ---

  private getZeroVibeVector(): VibeVector {
    const genreWeights: Record<MacroGenre, number> = {} as any;
    for (const g of ALL_MACRO_GENRES) {
      genreWeights[g] = 0;
    }
    return {
      energy: 0,
      danceability: 0,
      mood: 0,
      acousticness: 0,
      tempoNormalized: 0,
      familiarity: 0,
      genreWeights,
    };
  }

  private addWeightedVector(a: VibeVector, b: VibeVector, weight: number): VibeVector {
    const genreWeights: Record<MacroGenre, number> = {} as any;
    for (const g of ALL_MACRO_GENRES) {
      genreWeights[g] = (a.genreWeights[g] || 0) + (b.genreWeights[g] || 0) * weight;
    }
    return {
      energy: a.energy + b.energy * weight,
      danceability: a.danceability + b.danceability * weight,
      mood: a.mood + b.mood * weight,
      acousticness: a.acousticness + b.acousticness * weight,
      tempoNormalized: a.tempoNormalized + b.tempoNormalized * weight,
      familiarity: a.familiarity + b.familiarity * weight,
      genreWeights,
    };
  }

  private scaleVector(v: VibeVector, scale: number): VibeVector {
    const genreWeights: Record<MacroGenre, number> = {} as any;
    for (const g of ALL_MACRO_GENRES) {
      genreWeights[g] = (v.genreWeights[g] || 0) * scale;
    }
    return {
      energy: v.energy * scale,
      danceability: v.danceability * scale,
      mood: v.mood * scale,
      acousticness: v.acousticness * scale,
      tempoNormalized: v.tempoNormalized * scale,
      familiarity: v.familiarity * scale,
      genreWeights,
    };
  }
}

export const vibeDjEngine = VibeDjEngine.getInstance();
