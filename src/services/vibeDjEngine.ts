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
import { TrackPlayRecord, ArtistAffinityRecord, GenreAffinityRecord } from '../types/telemetry';
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

const SPAM_TITLE_REGEX =
  /\b(karaoke|tribute to|made famous by|8d audio|ringtone|white noise|sleep sounds|hz frequency|study alpha waves|binaural beats|baby sleep)\b/i;

export interface TelemetrySnapshot {
  recentPlays: TrackPlayRecord[];
  artistAffinities: Map<string, ArtistAffinityRecord>;
  genreAffinities: Map<string, GenreAffinityRecord>;
  likedTrackIds: Set<string>;
  followedArtists: Set<string>;
  sessionId: string;
  shakeCount: number;
  sessionTracksPlayed: number;
}

interface ScoredCandidate {
  track: Track;
  vector: VibeVector;
  dominantGenre: MacroGenre;
  intrinsicScore: number;
  familiarityTier: 'anchor' | 'deep_cut' | 'discovery';
  vibeSimilarity: number;
  artistKey: string;
}

/**
 * 1. Session-Salted Deterministic Hash -> [-1.0, +1.0]
 * Fixes static Murmur hash bias by salting with sessionId and shakeCount.
 */
export function computeSessionSaltedHash(sessionId: string, shakeCount: number, trackId: string): number {
  const input = `${sessionId}:${shakeCount}:${trackId}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/**
 * 2. Track Exposure Cooldown & Chronic Skip Gate
 */
export function computeTrackCooldownAndGate(
  track: Track,
  playsForTrack: TrackPlayRecord[],
  sessionHistory: VibeDjHistoryItem[],
  isLiked: boolean,
  nowMs: number = Date.now()
): { allowed: boolean; cooldownMultiplier: number; familiarityLevel: number; historicalScore: number } {
  // Hard block if already played in the active DJ session
  if (sessionHistory.some((h) => h.track.id === track.id)) {
    return { allowed: false, cooldownMultiplier: 0, familiarityLevel: 1, historicalScore: 0 };
  }

  // Hard block low-quality SEO / karaoke / meditation spam unless user liked it
  if (!isLiked && SPAM_TITLE_REGEX.test(`${track.title} ${track.artist}`)) {
    return { allowed: false, cooldownMultiplier: 0, familiarityLevel: 0, historicalScore: 0 };
  }

  if (playsForTrack.length === 0) {
    return {
      allowed: true,
      cooldownMultiplier: 1.0,
      familiarityLevel: isLiked ? 0.8 : 0.15,
      historicalScore: isLiked ? 0.85 : 0.5,
    };
  }

  const lastPlayMs = Math.max(...playsForTrack.map((p) => p.startTime));
  const hoursSinceLastPlay = Math.max(0, (nowMs - lastPlayMs) / 3_600_000);

  // Hard lockout: Do not replay anything heard in the last 6 hours
  if (hoursSinceLastPlay < 6) {
    return { allowed: false, cooldownMultiplier: 0, familiarityLevel: 1, historicalScore: 0 };
  }

  // Chronic skip ban: Played >= 2 times with >= 65% skip rate and not liked
  const totalPlays = playsForTrack.length;
  const skipCount = playsForTrack.filter((p) => p.skipped).length;
  const skipRate = skipCount / totalPlays;
  if (!isLiked && totalPlays >= 2 && skipRate >= 0.65) {
    return { allowed: false, cooldownMultiplier: 0, familiarityLevel: 0.7, historicalScore: 0.1 };
  }

  // Exponential recency & frequency decay
  const fourteenDaysAgo = nowMs - 14 * 24 * 3_600_000;
  const playsLast14d = playsForTrack.filter((p) => p.startTime >= fourteenDaysAgo).length;
  const halfLifeHours = 18 * (1 + 0.35 * playsLast14d);
  const cooldownMultiplier = Math.max(0.08, 1.0 - 0.85 * Math.exp(-hoursSinceLastPlay / halfLifeHours));

  // Historical completion quality
  const avgCompletion =
    playsForTrack.reduce((acc, p) => acc + p.completionRate * (p.intent === 'favoured' ? 1.2 : 0.9), 0) /
    totalPlays;
  const historicalScore = Math.max(0, Math.min(1, avgCompletion - 0.35 * skipRate));
  const familiarityLevel = Math.min(0.98, 0.45 + 0.12 * totalPlays);

  return { allowed: true, cooldownMultiplier, familiarityLevel, historicalScore };
}

/**
 * 3. Gaussian Acoustic + Cosine Genre Vibe Similarity
 */
export function computeVibeSimilarity(sessionVec: VibeVector, trackVec: VibeVector): number {
  const dE = sessionVec.energy - trackVec.energy;
  const dA = sessionVec.acousticness - trackVec.acousticness;
  const dD = sessionVec.danceability - trackVec.danceability;
  const dM = sessionVec.mood - trackVec.mood;
  const dT = sessionVec.tempoNormalized - trackVec.tempoNormalized;

  const distSq = 0.30 * dE * dE + 0.22 * dA * dA + 0.20 * dD * dD + 0.18 * dM * dM + 0.10 * dT * dT;
  const acousticSim = Math.exp(-4.5 * distSq);

  let dot = 0;
  let normS = 0;
  let normT = 0;
  const genres = Object.keys(sessionVec.genreWeights) as MacroGenre[];
  for (const g of genres) {
    const ws = sessionVec.genreWeights[g] ?? 0;
    const wt = trackVec.genreWeights[g] ?? 0;
    dot += ws * wt;
    normS += ws * ws;
    normT += wt * wt;
  }
  const genreCosine = normS > 0 && normT > 0 ? dot / (Math.sqrt(normS) * Math.sqrt(normT)) : 0;

  return 0.60 * acousticSim + 0.40 * genreCosine;
}

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
   * Updates the live session vibe vector based on real-time user reaction using Dual-Horizon Adaptation.
   * - anchorVector: Anchor vector tethering the session's overall identity.
   * - isFatigueSkip: If true (user already likes or frequently listens to the song), treats as fatigue cooldown WITHOUT penalizing the genre or acoustic vector.
   * - Elastic tether: pulls live vector back towards anchor by lambda = 0.15 on each completion.
   */
  public updateSessionVibeVector(
    currentVector: VibeVector,
    track: Track,
    outcome: 'completed' | 'skipped' | 'replayed' | 'liked',
    completionRate: number = 1.0,
    anchorVector?: VibeVector,
    isFatigueSkip = false
  ): VibeVector & { currentVector: VibeVector; anchorVector: VibeVector } {
    const trackVector = this.computeTrackVibeVector(track);
    const anchor = anchorVector || currentVector;
    const updatedAnchor = { ...anchor, genreWeights: { ...anchor.genreWeights } };
    const updatedLive = { ...currentVector, genreWeights: { ...currentVector.genreWeights } };

    if (outcome === 'skipped') {
      if (!isFatigueSkip) {
        // True vibe mismatch skip: Course-correction away from track characteristics
        const penaltyFactor = 0.35 * Math.max(0.5, 1.0 - completionRate);

        const energyDelta = trackVector.energy - currentVector.energy;
        updatedLive.energy = Math.max(0.1, Math.min(1.0, currentVector.energy - energyDelta * penaltyFactor));

        const acousticDelta = trackVector.acousticness - currentVector.acousticness;
        updatedLive.acousticness = Math.max(0.0, Math.min(1.0, currentVector.acousticness - acousticDelta * penaltyFactor));

        // Diminish the skipped track's genre weight
        for (const g of ALL_MACRO_GENRES) {
          if (trackVector.genreWeights[g] > 0.5) {
            updatedLive.genreWeights[g] = Math.max(0.02, updatedLive.genreWeights[g] - 0.20);
          } else {
            updatedLive.genreWeights[g] = Math.min(0.6, updatedLive.genreWeights[g] + 0.04);
          }
        }
      }
      // If fatigue skip: Do NOT penalize genre or acoustic vector!
    } else {
      // Positive reinforcement
      const isFavoured = outcome === 'replayed' || outcome === 'liked';
      const learningRateLive = (isFavoured ? 0.35 : 0.20) * Math.max(0.4, completionRate);
      const learningRateAnchor = (isFavoured ? 0.18 : 0.06) * Math.max(0.4, completionRate);

      // 1. Move live vector towards track
      const rawLiveE = currentVector.energy + (trackVector.energy - currentVector.energy) * learningRateLive;
      const rawLiveD = currentVector.danceability + (trackVector.danceability - currentVector.danceability) * learningRateLive;
      const rawLiveM = currentVector.mood + (trackVector.mood - currentVector.mood) * learningRateLive;
      const rawLiveA = currentVector.acousticness + (trackVector.acousticness - currentVector.acousticness) * learningRateLive;
      const rawLiveT = currentVector.tempoNormalized + (trackVector.tempoNormalized - currentVector.tempoNormalized) * learningRateLive;

      // 2. Tether live vector back towards anchor (lambda = 0.15) to prevent unbounded drift
      const lambda = 0.15;
      updatedLive.energy = (1 - lambda) * rawLiveE + lambda * anchor.energy;
      updatedLive.danceability = (1 - lambda) * rawLiveD + lambda * anchor.danceability;
      updatedLive.mood = (1 - lambda) * rawLiveM + lambda * anchor.mood;
      updatedLive.acousticness = (1 - lambda) * rawLiveA + lambda * anchor.acousticness;
      updatedLive.tempoNormalized = (1 - lambda) * rawLiveT + lambda * anchor.tempoNormalized;

      for (const g of ALL_MACRO_GENRES) {
        const rawLiveG = currentVector.genreWeights[g] + (trackVector.genreWeights[g] - currentVector.genreWeights[g]) * learningRateLive;
        updatedLive.genreWeights[g] = (1 - lambda) * rawLiveG + lambda * (anchor.genreWeights[g] || 0);
      }

      // 3. Slow anchor progression
      updatedAnchor.energy = anchor.energy + (trackVector.energy - anchor.energy) * learningRateAnchor;
      updatedAnchor.danceability = anchor.danceability + (trackVector.danceability - anchor.danceability) * learningRateAnchor;
      updatedAnchor.mood = anchor.mood + (trackVector.mood - anchor.mood) * learningRateAnchor;
      updatedAnchor.acousticness = anchor.acousticness + (trackVector.acousticness - anchor.acousticness) * learningRateAnchor;
      updatedAnchor.tempoNormalized = anchor.tempoNormalized + (trackVector.tempoNormalized - anchor.tempoNormalized) * learningRateAnchor;

      for (const g of ALL_MACRO_GENRES) {
        updatedAnchor.genreWeights[g] = anchor.genreWeights[g] + (trackVector.genreWeights[g] - anchor.genreWeights[g]) * learningRateAnchor;
      }
    }

    // Normalize genre weights
    const totalLiveSum = Object.values(updatedLive.genreWeights).reduce((a, b) => a + b, 0);
    if (totalLiveSum > 0) {
      for (const g of ALL_MACRO_GENRES) {
        updatedLive.genreWeights[g] /= totalLiveSum;
      }
    }
    const totalAnchorSum = Object.values(updatedAnchor.genreWeights).reduce((a, b) => a + b, 0);
    if (totalAnchorSum > 0) {
      for (const g of ALL_MACRO_GENRES) {
        updatedAnchor.genreWeights[g] /= totalAnchorSum;
      }
    }

    // Attach dual-horizon outputs
    (updatedLive as any).currentVector = updatedLive;
    (updatedLive as any).anchorVector = updatedAnchor;

    return updatedLive as VibeVector & { currentVector: VibeVector; anchorVector: VibeVector };
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

    // 6. Track-specific acoustic signature derived from track id / duration / title
    let trackHash = 0;
    const str = `${candidate.id}:${candidate.title}:${candidate.artist}`;
    for (let i = 0; i < str.length; i++) {
      trackHash = (trackHash << 5) - trackHash + str.charCodeAt(i);
      trackHash |= 0;
    }
    const normalizedHash = Math.abs(trackHash % 1000) / 1000; // 0.0 to 1.0

    // Duration tempo heuristic: shorter tracks lean punchier, longer tracks lean deeper
    const durSec = candidate.duration || 210;
    const durationPacingModifier = durSec < 190 ? 0.04 : durSec > 320 ? -0.04 : 0.01;

    // Rich, natural serendipity distribution (+/- 7%)
    const serendipity = (normalizedHash - 0.5) * 0.14 + durationPacingModifier;

    // Composite Weighted Score (0 to 100)
    const composite =
      vibeAlignment * 42 +
      tasteAffinity * 22 +
      noveltyBonus * 12 +
      artistDiversity * 12 +
      energySmoothing * 8 +
      serendipity * 100;

    const vibeScore = Math.round(Math.max(38, Math.min(99, composite)));

    // Generate intelligent, varied reason
    const dominant = this.getDominantGenre(sessionVector);
    let vibeReason = `Curated for your ${dominant} soundscape`;
    if (followedArtistNames.has(candidatePrimaryArtist)) {
      vibeReason = `By ${candidate.artist} (one of your followed artists)`;
    } else if (likedTrackIds.has(candidate.id)) {
      vibeReason = `Beloved track from your collection matching this vibe`;
    } else if (trackVector.energy > 0.78 && sessionVector.energy > 0.65) {
      vibeReason = `High-energy momentum booster matching your tempo`;
    } else if (trackVector.acousticness > 0.68 && sessionVector.acousticness > 0.45) {
      vibeReason = `Organic acoustic warmth complementing your flow`;
    } else if (trackVector.danceability > 0.78 && sessionVector.danceability > 0.65) {
      vibeReason = `Kinetic rhythm and driving groove pick`;
    } else if (trackVector.energy < 0.45 && sessionVector.energy < 0.5) {
      vibeReason = `Restorative downtime texture for contemplative listening`;
    } else if (vibeAlignment > 0.84) {
      vibeReason = `Harmonically aligned with your active mood`;
    } else if (isNovelty && normalizedHash > 0.65) {
      vibeReason = `Fresh underground discovery tailored to your taste`;
    } else if (isNovelty && normalizedHash > 0.35) {
      vibeReason = `Hand-picked discovery matching this session`;
    } else if (isNovelty) {
      vibeReason = `Crossover pick providing sonic contrast`;
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
   * Generates a deep, high-quality ranked recommendation pool for Vibe DJ v2.0.
   * Leverages:
   * 1. Three-Ring Candidate Retrieval (Comfort Core, Taste-Graph Expansion, Vetted Discovery)
   * 2. Hard Pre-Scoring Quality Gate (6h lockout, chronic skip ban, SEO spam filter)
   * 3. Continuous Telemetry & Exponential Exposure Fatigue (half-life tau decay)
   * 4. Sequential Chain Decoder with 5-track Sinusoidal Wave Pacing and tight Stepwise Continuity
   */
  public async generateNextDjQueue(
    sessionVector: VibeVector,
    history: VibeDjHistoryItem[],
    count: number = 8,
    options?: {
      sessionId?: string;
      shakeCount?: number;
      sessionTracksPlayed?: number;
      lastPlayedTrack?: Track | null;
    }
  ): Promise<{
    queue: VibeDjTrackRecommendation[];
    recommendedArtists: VibeDjArtistRecommendation[];
  }> {
    const nowMs = Date.now();
    const sessionId = options?.sessionId || `session_${nowMs}`;
    const shakeCount = options?.shakeCount || 0;
    const sessionTracksPlayed = options?.sessionTracksPlayed ?? history.length;
    const lastTrack = options?.lastPlayedTrack || (history.length > 0 ? history[0].track : null);
    const dominant = this.getDominantGenre(sessionVector);

    // 1. Gather on-device telemetry, likes, followed artists, and affinities
    let plays: TrackPlayRecord[] = [];
    let rawArtistAffinities: ArtistAffinityRecord[] = [];
    let rawGenreAffinities: GenreAffinityRecord[] = [];
    try {
      plays = await telemetryDb.getAllPlays();
      rawArtistAffinities = await telemetryDb.getAllArtistAffinities();
      rawGenreAffinities = await telemetryDb.getAllGenreAffinities();
    } catch {}

    const { likedTracks, followedArtists, playlists } =
      typeof window !== 'undefined'
        ? (await import('../store/playerStore')).usePlayerStore.getState()
        : { likedTracks: [], followedArtists: [], playlists: [] };

    const likedTrackIds = new Set((likedTracks || []).map((t) => t.id));
    const followedArtistNames = new Set(
      (followedArtists || []).map((a) => a.name.toLowerCase().trim())
    );

    const artistAffinityMap = new Map<string, ArtistAffinityRecord>();
    for (const a of rawArtistAffinities) {
      artistAffinityMap.set(a.artist.toLowerCase().trim(), a);
    }
    const genreAffinityMap = new Map<string, GenreAffinityRecord>();
    for (const g of rawGenreAffinities) {
      genreAffinityMap.set(g.genre.toLowerCase().trim(), g);
    }

    const telemetry: TelemetrySnapshot = {
      recentPlays: plays,
      artistAffinities: artistAffinityMap,
      genreAffinities: genreAffinityMap,
      likedTrackIds,
      followedArtists: followedArtistNames,
      sessionId,
      shakeCount,
      sessionTracksPlayed,
    };

    // 2. Build Three-Ring Candidate Pool
    const candidateMap = new Map<string, Track>();

    // ── RING 1: Comfort Core (~30%) ──
    // A. Unplayed / rested tracks from high-affinity artists
    const highAffinityArtists = rawArtistAffinities
      .filter((a) => a.affinityScore >= 40)
      .sort((a, b) => b.affinityScore - a.affinityScore)
      .slice(0, 6);

    for (const ha of highAffinityArtists) {
      try {
        const artistTracks = await searchCharts(ha.artist, 10);
        for (const t of artistTracks) {
          if (!candidateMap.has(t.id)) candidateMap.set(t.id, t);
        }
      } catch {}
    }

    // B. Rested library favorites (Liked Songs and custom playlists not played in last 72 hours)
    const seventyTwoHoursAgo = nowMs - 72 * 3600 * 1000;
    const libraryTracks = [...(likedTracks || []), ...(playlists || []).flatMap((pl) => pl.tracks || [])];
    const recentPlayTimes = new Map<string, number>();
    for (const p of plays) {
      const cur = recentPlayTimes.get(p.trackId) || 0;
      if (p.startTime > cur) recentPlayTimes.set(p.trackId, p.startTime);
    }

    for (const t of libraryTracks) {
      const lastPlayTime = recentPlayTimes.get(t.id) || 0;
      if (lastPlayTime < seventyTwoHoursAgo && !candidateMap.has(t.id)) {
        candidateMap.set(t.id, t);
      }
    }

    // ── RING 2: Taste-Graph Expansion (~45%) ──
    // A. Granular Sub-Genre Queries matching current MacroGenre
    const matchingSubGenres = rawGenreAffinities
      .filter((g) => {
        const macro = genreProfiler.classifyGenre(g.genre);
        return macro === dominant;
      })
      .sort((a, b) => b.affinityScore - a.affinityScore)
      .slice(0, 3)
      .map((g) => g.genre);

    // Fallback sub-genres if user has few recorded sub-genres
    const defaultSubGenres: Record<MacroGenre, string[]> = {
      'Electronic & Dance': ['Synthwave', 'Deep House', 'Melodic Techno'],
      'Hip-Hop & Urban': ['Boom Bap', 'Neo Soul', 'Lofi Hip Hop'],
      'Rock & Alternative': ['Indie Rock', 'Shoegaze', 'Post-Punk'],
      'Pop & Anthems': ['Indie Pop', 'Nu-Disco', 'Electropop'],
      'Chill & Lo-Fi': ['Chillhop', 'Ambient Lo-Fi', 'Downtempo'],
      'Acoustic & Folk': ['Indie Folk', 'Fingerstyle Guitar', 'Chamber Folk'],
      'Jazz & Soul': ['Neo-Soul', 'Jazz Hop', 'Cool Jazz'],
      'Classical & Cinematic': ['Neo-Classical', 'Ambient Orchestral', 'Minimalist Piano'],
    };

    const targetSubQueries = matchingSubGenres.length > 0 ? matchingSubGenres : defaultSubGenres[dominant] || [dominant];
    for (const sub of targetSubQueries) {
      try {
        const subTracks = await searchCharts(sub, 12);
        for (const t of subTracks) {
          if (!candidateMap.has(t.id)) {
            candidateMap.set(t.id, {
              ...t,
              sourceMetadata: { ...t.sourceMetadata, genre: t.sourceMetadata?.genre || sub },
            });
          }
        }
      } catch {}
    }

    // B. Session Artist Adjacency (top 3 completed artists from session history)
    const topSessionArtists = Array.from(
      new Set(
        history
          .filter((h) => !h.skipped && (h.completionRate ?? 1.0) >= 0.70)
          .map((h) => extractPrimaryArtist(h.track.artist).trim())
      )
    ).slice(0, 3);

    for (const aName of topSessionArtists) {
      try {
        const mixTracks = await searchCharts(`${aName} mix`, 8);
        for (const t of mixTracks) {
          if (!candidateMap.has(t.id)) candidateMap.set(t.id, t);
        }
      } catch {}
    }

    // ── RING 3: Vetted Discovery (~25%) ──
    // A. High-retention community tracks
    try {
      const { communityListeningService } = await import('./communityListeningService');
      const commTrends = await communityListeningService.getTrendingArtists();
      for (const trend of commTrends) {
        for (const t of trend.recentTracks || []) {
          const macro = genreProfiler.classifyGenre(t.sourceMetadata?.genre, t.artist, t.title);
          if (macro === dominant && !candidateMap.has(t.id)) {
            candidateMap.set(t.id, t);
          }
        }
      }
    } catch {}

    // B. Recommendation Engine Discovery Shelves
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

    // C. Top Charts / Target Genre Fallback
    try {
      const charts = await fetchTopCharts();
      for (const t of charts) {
        if (!candidateMap.has(t.id)) candidateMap.set(t.id, t);
      }
      if (candidateMap.size < 40) {
        const deepSearch = await searchCharts(dominant, 15);
        for (const t of deepSearch) {
          if (!candidateMap.has(t.id)) candidateMap.set(t.id, t);
        }
      }
    } catch {}

    const candidates = Array.from(candidateMap.values());

    // 3. Step A & B: Hard Quality Gate, Intrinsic Scoring, and Sequential Chain Decoder
    const selectedQueue = this.buildSequentialChainQueue(
      candidates,
      sessionVector,
      lastTrack,
      history,
      telemetry,
      count
    );

    // 4. Generate contextual Vibe Recommended Artists
    const recommendedArtists = this.generateVibeArtistRecommendations(
      sessionVector,
      candidates,
      plays,
      followedArtists,
      rawArtistAffinities
    );

    return {
      queue: selectedQueue,
      recommendedArtists,
    };
  }

  /**
   * Executes the Greedy Sequential Chain Decoder (k = 0 ... queueSize - 1)
   * with tight stepwise energy/tempo continuity and a 5-track sinusoidal wave target.
   */
  private buildSequentialChainQueue(
    candidates: Track[],
    sessionVector: VibeVector,
    lastPlayedTrack: Track | null,
    sessionHistory: VibeDjHistoryItem[],
    telemetry: TelemetrySnapshot,
    queueSize: number = 8
  ): VibeDjTrackRecommendation[] {
    const nowMs = Date.now();

    // Index plays by trackId for O(1) lookup
    const playsByTrack = new Map<string, TrackPlayRecord[]>();
    for (const play of telemetry.recentPlays) {
      const list = playsByTrack.get(play.trackId) ?? [];
      list.push(play);
      playsByTrack.set(play.trackId, list);
    }

    // Track recently skipped artists in this session to avoid repeating them
    const sessionSkippedArtists = new Set(
      sessionHistory
        .filter((h) => h.skipped && (h.completionRate ?? 0) < 0.35)
        .map((h) => extractPrimaryArtist(h.track.artist).toLowerCase().trim())
    );

    // Step A: Hard Pre-Scoring Quality Gate & Intrinsic Fit Scoring
    const scoredPool: ScoredCandidate[] = [];
    const seenTrackIds = new Set<string>();

    for (const track of candidates) {
      if (!track?.id || seenTrackIds.has(track.id)) continue;
      seenTrackIds.add(track.id);

      const artistKey = extractPrimaryArtist(track.artist).toLowerCase().trim();
      if (sessionSkippedArtists.has(artistKey)) continue;

      const isLiked = telemetry.likedTrackIds.has(track.id);
      const trackPlays = playsByTrack.get(track.id) ?? [];

      const gate = computeTrackCooldownAndGate(track, trackPlays, sessionHistory, isLiked, nowMs);
      if (!gate.allowed) continue;

      const trackVec = this.computeTrackVibeVector(track);
      const dominantGenre = genreProfiler.classifyGenre(track.sourceMetadata?.genre, track.artist, track.title);
      const vibeSim = computeVibeSimilarity(sessionVector, trackVec);

      // Reject tracks that fundamentally clash with active vibe
      if (vibeSim < 0.38) continue;

      // Continuous Telemetry Taste Affinity
      const artistRec = telemetry.artistAffinities.get(artistKey);
      const artistNorm = artistRec ? artistRec.affinityScore / 100 : 0.32;
      const isFollowed = telemetry.followedArtists.has(artistKey);

      const trackGenre = (track.sourceMetadata?.genre || dominantGenre).toLowerCase().trim();
      const genreRec = telemetry.genreAffinities.get(trackGenre);
      const genreNorm = genreRec ? genreRec.affinityScore / 100 : 0.40;

      // Deep Cut Bonus: Unplayed track by high-affinity or followed artist
      const isArtistDeepCut = trackPlays.length === 0 && (artistNorm >= 0.60 || isFollowed);
      const trackHistScore = isArtistDeepCut ? 0.88 : gate.historicalScore;

      const tasteAffinity = Math.min(
        1.0,
        0.45 * Math.max(artistNorm, isFollowed ? 0.80 : 0) +
          0.25 * genreNorm +
          0.20 * trackHistScore +
          0.10 * (isLiked ? 1.0 : 0.0)
      );

      // Familiarity Alignment
      const effectiveFam = isArtistDeepCut ? 0.55 : gate.familiarityLevel;
      const freshnessScore = 1.0 - Math.abs(sessionVector.familiarity - effectiveFam);

      // Duration & Pacing Sanity
      const durSec = track.duration || 200;
      const durationQuality = durSec < 75 ? 0.2 : durSec > 480 ? 0.65 : 1.0;

      // Session-Salted Exploration Noise [-3.5, +3.5]
      const explorationNoise =
        computeSessionSaltedHash(telemetry.sessionId, telemetry.shakeCount, track.id) * 3.5;

      const rawScore =
        45 * vibeSim + 25 * tasteAffinity + 20 * freshnessScore + 10 * durationQuality;

      const intrinsicScore = gate.cooldownMultiplier * rawScore + explorationNoise;

      const familiarityTier: ScoredCandidate['familiarityTier'] =
        trackPlays.length > 0 || isLiked
          ? 'anchor'
          : artistNorm >= 0.55 || isFollowed
          ? 'deep_cut'
          : 'discovery';

      scoredPool.push({
        track,
        vector: trackVec,
        dominantGenre,
        intrinsicScore,
        familiarityTier,
        vibeSimilarity: vibeSim,
        artistKey,
      });
    }

    // Step B: Greedy Sequential Chain Decoding (Slot k = 0 ... queueSize - 1)
    const selectedQueue: VibeDjTrackRecommendation[] = [];
    const usedTrackIds = new Set<string>();

    // Recent artist ring buffer (last 6 played in session)
    const recentArtists: string[] = sessionHistory
      .slice(-6)
      .map((h) => extractPrimaryArtist(h.track.artist).toLowerCase().trim());

    let prevVector: VibeVector = lastPlayedTrack
      ? this.computeTrackVibeVector(lastPlayedTrack)
      : sessionVector;

    // Desired pacing pattern across the 8-track queue
    const slotRolePattern: ScoredCandidate['familiarityTier'][] = [
      'anchor',
      'deep_cut',
      'deep_cut',
      'discovery',
      'anchor',
      'deep_cut',
      'discovery',
      'deep_cut',
    ];

    for (let slot = 0; slot < queueSize; slot++) {
      const desiredRole = slotRolePattern[slot % slotRolePattern.length];

      // 5-track sinusoidal energy wave around user's target energy
      const wavePhase = ((telemetry.sessionTracksPlayed + slot) % 5) / 5;
      const targetSlotEnergy = Math.max(
        0.08,
        Math.min(0.96, sessionVector.energy + 0.08 * Math.sin(wavePhase * 2 * Math.PI))
      );

      let bestCandidate: ScoredCandidate | null = null;
      let bestChainScore = -Infinity;

      for (const cand of scoredPool) {
        if (usedTrackIds.has(cand.track.id)) continue;

        // Hard block if artist appeared within the last 4 steps
        const last4Artists = recentArtists.slice(-4);
        if (last4Artists.includes(cand.artistKey)) continue;

        // Soft penalty if artist appeared 5-6 steps ago
        const artistPenalty = recentArtists.includes(cand.artistKey) ? -14 : 0;

        // Stepwise Transition Continuity from prevVector -> cand.vector
        const dE = Math.abs(prevVector.energy - cand.vector.energy);
        const dT = Math.abs(prevVector.tempoNormalized - cand.vector.tempoNormalized);
        const dA = Math.abs(prevVector.acousticness - cand.vector.acousticness);

        const stepPenaltyE = Math.max(0, dE - 0.18);
        const stepPenaltyT = Math.max(0, dT - 0.20);
        const transitionMultiplier = Math.exp(
          -8.0 * stepPenaltyE * stepPenaltyE - 6.0 * stepPenaltyT * stepPenaltyT
        );

        const textureBridgePenalty = dA > 0.40 ? -8.0 * (dA - 0.40) : 0;

        // Alignment with the 5-track wave energy target
        const waveFitBonus = 6.0 * (1.0 - Math.abs(targetSlotEnergy - cand.vector.energy));

        // Role pacing bonus (+7 pts for matching the slot's familiarity tier)
        const roleBonus = cand.familiarityTier === desiredRole ? 7.0 : 0;

        const totalSlotScore =
          cand.intrinsicScore * (0.75 + 0.25 * transitionMultiplier) +
          waveFitBonus +
          roleBonus +
          textureBridgePenalty +
          artistPenalty;

        if (totalSlotScore > bestChainScore) {
          bestChainScore = totalSlotScore;
          bestCandidate = cand;
        }
      }

      if (!bestCandidate) break;

      usedTrackIds.add(bestCandidate.track.id);
      recentArtists.push(bestCandidate.artistKey);
      prevVector = bestCandidate.vector;

      const isNovelty = bestCandidate.familiarityTier === 'discovery';
      selectedQueue.push({
        track: bestCandidate.track,
        vibeScore: Math.max(40, Math.min(99, Math.round(bestChainScore))),
        vibeReason: this.buildExplainableReason(bestCandidate),
        predictedEnergy: bestCandidate.vector.energy,
        sourceTier: bestCandidate.familiarityTier === 'anchor' ? 'taste_catalogue' : isNovelty ? 'ai_discovery' : 'serendipity',
        isNovelty,
      });
    }

    return selectedQueue;
  }

  private buildExplainableReason(cand: ScoredCandidate): string {
    if (cand.familiarityTier === 'deep_cut') {
      return `Fresh deep cut from ${cand.track.artist} matching your flow`;
    }
    if (cand.familiarityTier === 'anchor') {
      return `Rested favorite anchoring your ${cand.dominantGenre} soundscape`;
    }
    if (cand.vector.energy > 0.75) {
      return `High-energy momentum pick locking into your tempo`;
    }
    if (cand.vector.acousticness > 0.65) {
      return `Organic acoustic texture bridging your current mood`;
    }
    return `Harmonically matched discovery tailored to your taste profile`;
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
