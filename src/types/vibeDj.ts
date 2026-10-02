import { Track } from './track';
import { MacroGenre } from './vibes';

export interface VibeVector {
  energy: number;          // 0.0 (ambient/sleep) to 1.0 (hardstyle/heavy metal/hyper energy)
  danceability: number;    // 0.0 (freeform/classical) to 1.0 (four-on-the-floor dance)
  mood: number;            // 0.0 (melancholic/dark/introspective) to 1.0 (euphoric/sunny/celebratory)
  acousticness: number;    // 0.0 (pure electronic/synthesizers) to 1.0 (pure acoustic/unplugged/organic)
  tempoNormalized: number; // 0.0 (~60 BPM) to 1.0 (~180 BPM)
  familiarity: number;     // 0.0 (pure underground discovery) to 1.0 (heavy rotation favorite)
  genreWeights: Record<MacroGenre, number>; // Normalized weights summing to ~1.0
}

export interface VibeDjTrackRecommendation {
  track: Track;
  vibeScore: number;       // 0 to 100 overall compatibility score
  vibeReason: string;      // Human-readable reason for why Vibe chose this track
  predictedEnergy: number; // 0.0 to 1.0
  sourceTier: 'taste_catalogue' | 'ai_discovery' | 'serendipity';
  isNovelty: boolean;      // True if user has never played this track before
  matchBreakdown?: {
    vibeAlignment: number;
    tasteAffinity: number;
    noveltyBonus: number;
    artistDiversity: number;
    energySmoothing: number;
  };
}

export interface VibeDjArtistRecommendation {
  id: string;
  name: string;
  reason: string;
  sampleTrackTitle?: string;
  artworkUrl?: string;
  affinityScore: number;
  macroGenre: MacroGenre;
  isFollowed?: boolean;
}

export interface VibeDjHistoryItem {
  track: Track;
  playedAt: number;
  durationPlayedMs?: number;
  completionRate?: number;
  skipped?: boolean;
  replayed?: boolean;
  vibeReason?: string;
}

export interface VibeDjState {
  isActive: boolean;
  vibeLabel: string;
  vibeTagline: string;
  themeColor: 'purple' | 'emerald' | 'rose' | 'blue' | 'amber';
  themeGradient: string;
  accentColor: string;
  currentVector: VibeVector;
  djQueue: VibeDjTrackRecommendation[];
  history: VibeDjHistoryItem[];
  recommendedArtists: VibeDjArtistRecommendation[];
  shakeCount: number;
  lastShakeTimestamp: number;
  isShaking: boolean;
  isGenerating: boolean;
  statusMessage?: string;
}
