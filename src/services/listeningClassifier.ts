import { TrackPlayRecord, PlayOrigin, PlayIntent, PlayContext } from '../types/telemetry';
import { Track } from '../types/track';
import { extractPrimaryArtist } from './artistService';

export interface UserAffinityContext {
  likedTrackIds?: Set<string>;
  followedArtistNames?: Set<string>;
  followedArtists?: Set<string>;
  userPlaylistTrackIds?: Set<string>;
  playlistTrackIds?: Set<string>;
  vibePlaylistTrackIds?: Set<string>;
  searchHistoryQueries?: string[];
}

export class ListeningClassifier {
  private static instance: ListeningClassifier;

  public static getInstance(): ListeningClassifier {
    if (!ListeningClassifier.instance) {
      ListeningClassifier.instance = new ListeningClassifier();
    }
    return ListeningClassifier.instance;
  }

  /**
   * Resolves whether an origin represents explicit user favour.
   */
  public isFavouredOrigin(origin?: PlayOrigin): boolean {
    if (!origin) return false;
    return (
      origin === 'search' ||
      origin === 'artist' ||
      origin === 'song' ||
      origin === 'library' ||
      origin === 'user_playlist'
    );
  }

  /**
   * Resolves whether an origin represents exploratory/passive listening (vibe, discover, autoplay, etc.).
   */
  public isExploratoryOrigin(origin?: PlayOrigin): boolean {
    if (!origin) return false;
    return (
      origin === 'vibe_dj' ||
      origin === 'vibe_playlist' ||
      origin === 'discover_track' ||
      origin === 'discover_weekly' ||
      origin === 'autoplay' ||
      origin === 'radio' ||
      origin === 'charts' ||
      origin === 'recommendation'
    );
  }

  /**
   * Evaluates if a given play record reflects explicit user favour (high intent).
   * User-favoured includes:
   * - Explicit search queries clicked
   * - Clicking directly on artist profiles / top hits
   * - Clicking directly on an individual song / album
   * - Playing from library or user custom playlist
   * - Explicitly replaying a song (even if discovered on a vibe playlist)
   * - Explicitly liking a song or following the artist
   */
  public isUserFavouredPlay(
    play: Partial<TrackPlayRecord>,
    context?: UserAffinityContext
  ): boolean {
    if (!play) return false;

    // Explicit replay is always a user-favoured signal
    if (play.replayed) return true;

    // Explicit like on the track record
    if (play.userLiked) return true;

    // If already marked as favoured
    if (play.intent === 'favoured') return true;

    // Explicit user context checks (liked track, followed artist, saved in custom playlist)
    if (play.trackId && context?.likedTrackIds?.has(play.trackId)) return true;
    const followed = context?.followedArtistNames || context?.followedArtists;
    if (play.artist && followed) {
      const primary = extractPrimaryArtist(play.artist).toLowerCase().trim();
      const raw = play.artist.toLowerCase().trim();
      if (followed.has(primary) || followed.has(raw)) return true;
    }
    const userPlaylists = context?.userPlaylistTrackIds || context?.playlistTrackIds;
    if (play.trackId && userPlaylists?.has(play.trackId)) return true;

    // Explicit origin check
    if (play.origin) {
      if (this.isFavouredOrigin(play.origin)) return true;
      if (this.isExploratoryOrigin(play.origin)) return false;
    }

    // Heuristics for unclassified / legacy records:
    // If it's a vibe track ID or has vibe metadata -> exploratory
    if (play.trackId?.startsWith('vibe:')) return false;
    if (
      play.title &&
      (play.title.includes('(Discovery') || play.title.includes('Discovery Echo'))
    ) {
      return false;
    }
    if (play.source === 'radio') return false;
    if (play.genre && play.genre.toLowerCase().includes('vibe')) return false;

    // If skipped, definitely not favoured
    if (play.skipped) return false;

    // If it was completed >= 0.8 without skip and no negative signals on an unclassified legacy track,
    // grant legacy user-favoured status to prevent breaking existing cold-start tests
    if (play.origin === undefined && typeof play.completionRate === 'number' && play.completionRate >= 0.8) {
      return true;
    }

    return false;
  }

  /**
   * Returns a normalized weighting factor (0.0 to 1.0) for recommendation scoring.
   * User-favoured plays get full weight (1.0).
   * Exploratory / vibe / discover tracks get reduced weight (0.15 - 0.25).
   */
  public getIntentWeight(
    play: Partial<TrackPlayRecord>,
    context?: UserAffinityContext
  ): number {
    if (this.isUserFavouredPlay(play, context)) {
      return 1.0;
    }
    if (play.skipped) {
      return 0.05;
    }
    // Exploratory plays that were completed get light discovery weight
    const completion = typeof play.completionRate === 'number' ? play.completionRate : 0.5;
    return 0.15 * Math.max(0.2, completion);
  }

  /**
   * Classifies an incoming or past listening record into origin, intent, and intentWeight.
   */
  public classifyListeningRecord(
    play: Partial<TrackPlayRecord>,
    context?: UserAffinityContext
  ): { origin: PlayOrigin; intent: PlayIntent; intentWeight: number } {
    // 1. If explicit origin is already specified
    if (play.origin && play.origin !== 'unknown') {
      const isFav = this.isUserFavouredPlay(play, context);
      const intent: PlayIntent = isFav ? 'favoured' : 'exploratory';
      const intentWeight = intent === 'favoured' ? 1.0 : play.skipped ? 0.05 : 0.2;
      return { origin: play.origin, intent, intentWeight };
    }

    // 2. Check for explicit user favour signals
    if (play.replayed) {
      return { origin: 'song', intent: 'favoured', intentWeight: 1.0 };
    }

    if (play.trackId && context?.likedTrackIds?.has(play.trackId)) {
      return { origin: 'library', intent: 'favoured', intentWeight: 1.0 };
    }

    if (play.artist && context?.followedArtistNames) {
      const primary = extractPrimaryArtist(play.artist).toLowerCase().trim();
      if (context.followedArtistNames.has(primary)) {
        return { origin: 'artist', intent: 'favoured', intentWeight: 1.0 };
      }
    }

    if (play.trackId && context?.userPlaylistTrackIds?.has(play.trackId)) {
      return { origin: 'user_playlist', intent: 'favoured', intentWeight: 1.0 };
    }

    // 3. Check for exploratory markers
    if (
      play.trackId?.startsWith('vibe:') ||
      (play.genre && play.genre.toLowerCase().includes('vibe')) ||
      context?.vibePlaylistTrackIds?.has(play.trackId || '')
    ) {
      return {
        origin: 'vibe_playlist',
        intent: 'exploratory',
        intentWeight: play.skipped ? 0.05 : 0.15,
      };
    }

    if (
      (play.title && (play.title.includes('(Discovery') || play.title.includes('Discovery Echo'))) ||
      play.trackId?.includes('discovery')
    ) {
      return {
        origin: 'discover_track',
        intent: 'exploratory',
        intentWeight: play.skipped ? 0.05 : 0.15,
      };
    }

    if (play.source === 'radio') {
      return {
        origin: 'radio',
        intent: 'exploratory',
        intentWeight: play.skipped ? 0.05 : 0.2,
      };
    }

    // 4. Fallback for unclassified legacy records
    if (!play.skipped && typeof play.completionRate === 'number' && play.completionRate >= 0.8) {
      return { origin: 'song', intent: 'favoured', intentWeight: 0.8 };
    }

    return { origin: 'unknown', intent: 'exploratory', intentWeight: 0.15 };
  }

  /**
   * Helper to resolve active play context from current player store state when playing a track.
   */
  public resolveContextFromState(
    track: Track,
    state: {
      activeView?: string;
      searchQuery?: string;
      selectedArtist?: { name: string } | null;
      selectedAlbum?: { title: string } | null;
      selectedPlaylistId?: string | null;
      queue?: Track[];
    }
  ): PlayContext {
    // Check track metadata first
    if (track.id?.startsWith('vibe:') || track.sourceMetadata?.vibe) {
      return {
        origin: 'vibe_playlist',
        intent: 'exploratory',
        playlistName: track.sourceMetadata?.vibe,
      };
    }

    if (track.title?.includes('(Discovery') || (track as any).isWebDiscovery) {
      return {
        origin: 'discover_track',
        intent: 'exploratory',
      };
    }

    const view = state.activeView;
    if (view === 'search') {
      return {
        origin: 'search',
        intent: 'favoured',
        searchQuery: state.searchQuery || '',
      };
    }

    if (view === 'artist') {
      return {
        origin: 'artist',
        intent: 'favoured',
        artistName: state.selectedArtist?.name || track.artist,
      };
    }

    if (view === 'album') {
      return {
        origin: 'song',
        intent: 'favoured',
        albumTitle: state.selectedAlbum?.title || track.album,
        artistName: track.artist,
      };
    }

    if (view === 'playlist') {
      const plId = state.selectedPlaylistId || '';
      if (plId.startsWith('vibe_') || plId.includes('vibe')) {
        return {
          origin: 'vibe_playlist',
          intent: 'exploratory',
          playlistId: plId,
        };
      }
      return {
        origin: 'user_playlist',
        intent: 'favoured',
        playlistId: plId,
      };
    }

    if (view === 'library') {
      return {
        origin: 'library',
        intent: 'favoured',
      };
    }

    return {
      origin: 'song',
      intent: 'favoured',
    };
  }
}

export const listeningClassifier = ListeningClassifier.getInstance();
export const isFavouredOrigin = (origin?: PlayOrigin) =>
  listeningClassifier.isFavouredOrigin(origin);
export const isExploratoryOrigin = (origin?: PlayOrigin) =>
  listeningClassifier.isExploratoryOrigin(origin);
export const isUserFavouredPlay = (play: Partial<TrackPlayRecord>, context?: UserAffinityContext) =>
  listeningClassifier.isUserFavouredPlay(play, context);
export const getIntentWeight = (play: Partial<TrackPlayRecord>, context?: UserAffinityContext) =>
  listeningClassifier.getIntentWeight(play, context);
export const classifyListeningRecord = (
  play: Partial<TrackPlayRecord>,
  context?: UserAffinityContext
) => listeningClassifier.classifyListeningRecord(play, context);
