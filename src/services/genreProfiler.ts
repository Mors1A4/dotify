import { TrackPlayRecord } from '../types/telemetry';
import { Track } from '../types/track';
import { FollowedArtist } from '../types/artist';
import { MacroGenre, GenreGroupAffinity, UserTasteProfile } from '../types/vibes';

const MACRO_GENRE_KEYWORDS: Record<MacroGenre, string[]> = {
  'Electronic & Dance': [
    'electronic',
    'dance',
    'techno',
    'house',
    'edm',
    'synthwave',
    'trance',
    'dubstep',
    'electro',
    'drum and bass',
    'drum & bass',
    'dnb',
    'future bass',
    'club',
    'synth',
    'cyberpunk',
    'eurodance',
    'garage',
    'breakbeat',
    'hardstyle',
    'deep house',
    'tech house',
    'progressive house',
    'remix',
  ],
  'Hip-Hop & Urban': [
    'hip hop',
    'hip-hop',
    'rap',
    'trap',
    'drill',
    'r&b',
    'rnb',
    'neo-soul',
    'grime',
    'urban',
    'afrobeats',
    'boom bap',
    'cloud rap',
    'hiphop',
    'conscious rap',
    'gangsta rap',
  ],
  'Rock & Alternative': [
    'rock',
    'indie',
    'alternative',
    'punk',
    'metal',
    'grunge',
    'hard rock',
    'shoegaze',
    'post-rock',
    'emo',
    'heavy metal',
    'classic rock',
    'psychedelic',
    'garage rock',
    'prog rock',
  ],
  'Pop & Anthems': [
    'pop',
    'synthpop',
    'dance-pop',
    'electropop',
    'indie pop',
    'k-pop',
    'kpop',
    'j-pop',
    'hyperpop',
    'chart',
    'teen pop',
    'mainstream',
    'dance pop',
    'power pop',
  ],
  'Chill & Lo-Fi': [
    'lo-fi',
    'lofi',
    'chillhop',
    'study beats',
    'downtempo',
    'ambient',
    'chill',
    'chillout',
    'relax',
    'lounge',
    'coffee',
    'sleep',
    'meditation',
    'drone',
  ],
  'Acoustic & Folk': [
    'acoustic',
    'folk',
    'singer-songwriter',
    'americana',
    'country',
    'bluegrass',
    'indie folk',
    'unplugged',
  ],
  'Jazz & Soul': [
    'jazz',
    'soul',
    'blues',
    'funk',
    'motown',
    'groove',
    'bossa nova',
    'swing',
    'bebop',
    'fusion',
  ],
  'Classical & Cinematic': [
    'classical',
    'orchestral',
    'soundtrack',
    'film score',
    'cinematic',
    'piano',
    'instrumental',
    'baroque',
    'symphonic',
    'score',
    'ost',
    'neoclassical',
  ],
};

export class GenreProfiler {
  private static instance: GenreProfiler;

  public static getInstance(): GenreProfiler {
    if (!GenreProfiler.instance) {
      GenreProfiler.instance = new GenreProfiler();
    }
    return GenreProfiler.instance;
  }

  /**
   * Classifies any raw genre string, artist, or track title into a standardized MacroGenre group.
   */
  public classifyGenre(rawGenre?: string, artistName?: string, trackTitle?: string): MacroGenre {
    const raw = (rawGenre || '').toLowerCase().trim();
    const artist = (artistName || '').toLowerCase().trim();
    const title = (trackTitle || '').toLowerCase().trim();

    // Prepare all (keyword, macro) pairs sorted by keyword length descending
    const allKeywordPairs: { kw: string; macro: MacroGenre }[] = [];
    for (const [macro, keywords] of Object.entries(MACRO_GENRE_KEYWORDS) as [MacroGenre, string[]][]) {
      for (const kw of keywords) {
        allKeywordPairs.push({ kw, macro });
      }
    }
    allKeywordPairs.sort((a, b) => b.kw.length - a.kw.length);

    // 1. Exact match check on rawGenre
    if (raw && raw !== 'unknown') {
      for (const pair of allKeywordPairs) {
        if (raw === pair.kw) {
          return pair.macro;
        }
      }

      // Substring check on rawGenre (longer keywords checked first)
      for (const pair of allKeywordPairs) {
        if (raw.includes(pair.kw)) {
          return pair.macro;
        }
      }
    }

    // 2. Keyword heuristic checks in title and artist
    const combined = `${title} ${artist}`;
    for (const pair of allKeywordPairs) {
      const regex = new RegExp(`\\b${pair.kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(combined)) {
        return pair.macro;
      }
    }

    // 3. Fallback based on Pop & Anthems default
    return 'Pop & Anthems';
  }

  /**
   * Analyzes the user's listening history telemetry, liked tracks, and followed artists
   * to construct an enriched taste profile with grouped macro genre affinities.
   */
  public profileUserGenres(
    plays: TrackPlayRecord[] = [],
    likedTracks: Track[] = [],
    followedArtists: FollowedArtist[] = []
  ): UserTasteProfile {
    // Check if cold start
    const validPlays = plays.filter(
      (p) =>
        !p.trackId?.includes('mock-') &&
        !p.artist?.toLowerCase().includes('synthetic pulse') &&
        !p.title?.toLowerCase().includes('klarity')
    );

    const isColdStart = validPlays.length === 0 && likedTracks.length === 0 && followedArtists.length === 0;

    if (isColdStart) {
      return this.getColdStartTasteProfile();
    }

    // Accumulators per MacroGenre
    const groupStats = new Map<
      MacroGenre,
      {
        score: number;
        playCount: number;
        totalDurationMs: number;
        subgenres: Map<string, number>;
        artists: Map<string, number>;
      }
    >();

    const allGroups: MacroGenre[] = [
      'Electronic & Dance',
      'Hip-Hop & Urban',
      'Rock & Alternative',
      'Pop & Anthems',
      'Chill & Lo-Fi',
      'Acoustic & Folk',
      'Jazz & Soul',
      'Classical & Cinematic',
    ];

    for (const g of allGroups) {
      groupStats.set(g, {
        score: 0,
        playCount: 0,
        totalDurationMs: 0,
        subgenres: new Map(),
        artists: new Map(),
      });
    }

    // 1. Process Track Plays
    let totalListeningTimeMs = 0;
    const artistPlayCounts = new Map<string, { count: number; group: MacroGenre }>();
    const trackPlayCounts = new Map<string, { title: string; artist: string; count: number }>();

    for (const play of validPlays) {
      const durationMs = play.durationPlayedMs || play.timePlayedMs || 0;
      totalListeningTimeMs += durationMs;

      const group = this.classifyGenre(play.genre, play.artist, play.title);
      const stats = groupStats.get(group)!;

      stats.playCount += 1;
      stats.totalDurationMs += durationMs;

      // Completion bonus & skip penalty
      const completion = typeof play.completionRate === 'number' ? play.completionRate : 0.5;
      const replayBonus = play.replayed ? 1.5 : 1.0;
      const skipPenalty = play.skipped ? 0.3 : 1.0;
      const playWeight = Math.max(0.1, completion * replayBonus * skipPenalty);
      stats.score += playWeight * 10;

      // Subgenre tracker
      if (play.genre && play.genre !== 'Unknown') {
        const rawG = play.genre.trim();
        stats.subgenres.set(rawG, (stats.subgenres.get(rawG) || 0) + 1);
      }

      // Artist tracker
      if (play.artist) {
        stats.artists.set(play.artist, (stats.artists.get(play.artist) || 0) + 1);
        const existing = artistPlayCounts.get(play.artist) || { count: 0, group };
        existing.count += 1;
        artistPlayCounts.set(play.artist, existing);
      }

      // Track tracker
      if (play.title && play.artist) {
        const trackKey = `${play.artist}:::${play.title}`;
        const existing = trackPlayCounts.get(trackKey) || { title: play.title, artist: play.artist, count: 0 };
        existing.count += 1;
        trackPlayCounts.set(trackKey, existing);
      }
    }

    // 2. Process Liked Tracks (high explicit intent)
    for (const track of likedTracks) {
      const group = this.classifyGenre(track.sourceMetadata?.genre, track.artist, track.title);
      const stats = groupStats.get(group)!;
      stats.score += 25; // Significant boost for liked tracks
      if (track.artist) {
        stats.artists.set(track.artist, (stats.artists.get(track.artist) || 0) + 2);
        const existing = artistPlayCounts.get(track.artist) || { count: 0, group };
        existing.count += 2;
        artistPlayCounts.set(track.artist, existing);
      }
    }

    // 3. Process Followed Artists
    for (const artist of followedArtists) {
      const artistGenres = artist.genres || [];
      const primaryGenre = artistGenres.length > 0 ? artistGenres[0] : '';
      const group = this.classifyGenre(primaryGenre, artist.name);
      const stats = groupStats.get(group)!;
      stats.score += 30; // High boost for followed artist
      stats.artists.set(artist.name, (stats.artists.get(artist.name) || 0) + 3);
    }

    // Compute totals and percentages
    const totalScore = Array.from(groupStats.values()).reduce((sum, g) => sum + g.score, 0);

    const sortedGroups: GenreGroupAffinity[] = allGroups
      .map((group) => {
        const stats = groupStats.get(group)!;
        const percentage = totalScore > 0 ? Math.round((stats.score / totalScore) * 1000) / 10 : 0;
        const affinityScore = Math.min(100, Math.round(stats.score));

        const topSubgenres = Array.from(stats.subgenres.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([name]) => name);

        const sampleArtists = Array.from(stats.artists.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([name]) => name);

        return {
          group,
          affinityScore,
          playCount: stats.playCount,
          totalTimePlayedMs: stats.totalDurationMs,
          percentage,
          topSubgenres,
          sampleArtists,
        };
      })
      .filter((g) => g.affinityScore > 0)
      .sort((a, b) => b.affinityScore - a.affinityScore);

    // If all scores were 0 (e.g. only skipped plays), fallback to cold start
    if (sortedGroups.length === 0) {
      return this.getColdStartTasteProfile();
    }

    // Top Artists
    const topArtists = Array.from(artistPlayCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([name, data]) => ({ name, playCount: data.count, genreGroup: data.group }));

    // Top Tracks
    const topTracks = Array.from(trackPlayCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((t) => ({ title: t.title, artist: t.artist, playCount: t.count }));

    const dominantGenre = sortedGroups[0]?.group || 'Pop & Anthems';

    // Summary description for LLM prompting
    const top3Genres = sortedGroups.slice(0, 3).map((g) => `${g.group} (${g.percentage}%)`).join(', ');
    const top3Artists = topArtists.slice(0, 4).map((a) => a.name).join(', ');
    const summaryText = `Listener Taste Profile: Dominant genres: ${top3Genres}. Top artists: ${
      top3Artists || 'Eclectic'
    }. Total tracks played: ${validPlays.length}.`;

    return {
      topGenreGroups: sortedGroups,
      dominantGenre,
      topArtists,
      topTracks,
      totalPlays: validPlays.length,
      totalListeningTimeMs,
      isColdStart: false,
      summaryText,
    };
  }

  /**
   * Cold start profile for new listeners with no recorded plays or likes yet.
   * Strictly avoids hardcoding fake artists or genre assumptions.
   */
  private getColdStartTasteProfile(): UserTasteProfile {
    return {
      topGenreGroups: [],
      dominantGenre: undefined,
      topArtists: [],
      topTracks: [],
      totalPlays: 0,
      totalListeningTimeMs: 0,
      isColdStart: true,
      summaryText: 'New listener with no recorded listening history.',
    };
  }
}

export const genreProfiler = GenreProfiler.getInstance();
