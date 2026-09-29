# Milestone 1 Technical Plan: Dedicated Artist View & Instant Artist Radio

**Explorer**: `explorer_m1_2` (Teamwork Preview Explorer)  
**Milestone**: Milestone 1 (Low-Latency Streaming, Artist View, Queue & Playlist Management)  
**Target Codebase**: dotify (`c:\Users\monty\Documents\AB\notify`)  
**Date**: 2026-09-19  

---

## 1. Executive Summary & Objective

In accordance with `ORIGINAL_REQUEST.md` (Follow-up dated 2026-09-19) and `PROJECT.md` (Milestone 1 Contracts), this plan specifies the architecture, data contracts, fallback mechanisms, algorithmic radio formulas, component layouts, and global navigation hooks for the **Dedicated Artist View & Artist Radio**.

### Core User Capabilities Delivered
1. **Universal Artist Navigation**: Clicking any artist name anywhere in the application (PlayerBar, HomeView, SearchView, LibraryView, QueueDrawer, MobileMiniPlayer, and MobileNowPlayingSheet) smoothly navigates to that artist's dedicated profile.
2. **Dedicated Artist Profile**: A rich, Spotify-grade view featuring dynamic hero banner art, artist portrait, listener stats, genre tags, top tracks table, albums carousel/grid, discography releases, and related artists.
3. **Instant "Artist Radio" Mix**: Clicking "Artist Radio" creates an algorithmic 50-track continuous station (40% anchor artist, 35% related artists, 25% genre discovery) with golden-ratio dispersion, immediately pre-warms upcoming tracks, and starts sub-second playback.
4. **4-Tier Fallback Hierarchy**: Resolves artist metadata across Deezer, Audius, Internet Archive, and deterministic on-device synthetic generation for offline, obscure, or custom tracks.

---

## 2. Type Definitions (`src/types/artist.ts`)

The artist domain model harmonizes the contracts specified in `PROJECT.md` § 2 and `survey_streaming_data.md` § 2.1 while strictly referencing `Track` from `src/types/track.ts`.

### Proposed File Content: `src/types/artist.ts`

```ts
import { Track } from './track';

/**
 * Summary metadata for an artist's album or single release.
 */
export interface AlbumSummary {
  id: string; // e.g. "charts:album:12345" | "audius:album:xyz"
  title: string;
  coverUrl?: string;
  artworkUrl?: string; // Backwards-compatible alias for coverUrl
  releaseYear?: string | number;
  trackCount?: number;
  recordType?: 'album' | 'single' | 'ep' | 'compilation';
  tracks?: Track[];
}

/**
 * Summary for a related artist displayed in "Fans Also Like".
 */
export interface RelatedArtist {
  id: string; // e.g. "charts:artist:27" | "audius:user:eAZl3" | "synthetic:name"
  name: string;
  imageUrl?: string;
  avatarUrl?: string; // Backwards-compatible alias for imageUrl
  genres?: string[];
  similarityScore?: number; // 0.0 to 1.0
  trackCount?: number;
}

/**
 * Complete Artist Profile data contract.
 */
export interface ArtistProfile {
  id: string; // Unique identifier: "charts:artist:{id}", "audius:{id}", "synthetic:{name}"
  name: string;
  bio?: string;
  imageUrl?: string;
  avatarUrl?: string; // Backwards-compatible alias
  bannerUrl?: string;
  monthlyListeners?: number;
  genres: string[];
  topTracks: Track[]; // Top 10 to 30 popular tracks
  albums: AlbumSummary[]; // Full studio albums and EPs
  discography: Track[]; // Complete aggregated track list
  singlesAndEPs?: AlbumSummary[]; // Optional partition for singles/remixes
  relatedArtists: RelatedArtist[];
  isSynthetic?: boolean; // True if generated from local library/heuristics
  externalLinks?: {
    deezer?: string;
    audius?: string;
    archive?: string;
    radio?: string;
  };
}

/**
 * Configuration for the algorithmic Artist Radio generation.
 */
export interface ArtistRadioConfig {
  artistId: string;
  artistName: string;
  anchorRatio?: number; // Default: 0.40 (40% anchor artist)
  relatedRatio?: number; // Default: 0.35 (35% related artists)
  discoveryRatio?: number; // Default: 0.25 (25% genre discovery)
  length?: number; // Default: 25 to 50 tracks
}
```

---

## 3. Artist Service Architecture (`src/services/artistService.ts`)

The artist service coordinates fetching, multi-tier fallback resolution, data sanitization, and the instant Artist Radio mix generator.

```
┌────────────────────────────────────────────────────────────────────────┐
│                   navigateToArtist(artistName, id?)                    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                       Does ID have explicit provider?
                      ┌─────────────┴─────────────┐
                     Yes                          No
                      │                           │
          Direct Provider Query        Query Deezer Search API
        (charts / audius / archive)    /api/charts/search/artist?q=
                      │                           │
                      │◄──────────────────────────┘
                      ▼
             Mainstream API Hit?
             ├── YES ──► Tier 1: Deezer API
             │           - Details (/api/charts/artist/:id)
             │           - Top Tracks (/api/charts/artist/:id/top)
             │           - Albums (/api/charts/artist/:id/albums)
             │           - Related Artists (/api/charts/artist/:id/related)
             │
             └── NO ───► Tier 2: Audius API Fallback
                         - User search (/api/audius/users/search?query=)
                         - Tracks search (/api/audius/tracks/search?query=)
                         │
                         └── Failed? ──► Tier 3: Internet Archive Fallback
                                         - Advanced search (mediatype:audio AND creator:)
                                         │
                                         └── Failed? ──► Tier 4: Synthetic Profile
                                                         - Scan Liked Tracks & Playlists
                                                         - Build dynamic in-memory profile
```

### 3.1 Backend Proxy Route Additions (`server/index.js`)

To enable full Deezer artist metadata without browser CORS issues, the following lightweight proxy routes are added to `server/index.js` (mirroring the existing `/api/charts/artist/:id/top`):

```js
// 1. Artist details (profile, picture, fan count)
app.get('/api/charts/artist/:id', async (req, res) => {
  try {
    const upstream = await fetch(`https://api.deezer.com/artist/${encodeURIComponent(req.params.id)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'Artist not found' });
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// 2. Artist albums
app.get('/api/charts/artist/:id/albums', async (req, res) => {
  try {
    const limit = req.query.limit || 25;
    const upstream = await fetch(`https://api.deezer.com/artist/${encodeURIComponent(req.params.id)}/albums?limit=${limit}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
    });
    if (!upstream.ok) return res.status(upstream.status).json({ data: [] });
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ data: [], error: err.message });
  }
});

// 3. Related artists
app.get('/api/charts/artist/:id/related', async (req, res) => {
  try {
    const limit = req.query.limit || 15;
    const upstream = await fetch(`https://api.deezer.com/artist/${encodeURIComponent(req.params.id)}/related?limit=${limit}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
    });
    if (!upstream.ok) return res.status(upstream.status).json({ data: [] });
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ data: [], error: err.message });
  }
});

// 4. Artist search by query
app.get('/api/charts/search/artist', async (req, res) => {
  try {
    const q = req.query.q || '';
    const limit = req.query.limit || 10;
    if (!q.trim()) return res.json({ data: [] });
    const upstream = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&limit=${limit}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 dotify/1.0.0' },
    });
    if (!upstream.ok) return res.status(upstream.status).json({ data: [] });
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ data: [], error: err.message });
  }
});
```

### 3.2 4-Tier Fallback Engine Implementation Plan

#### Tier 1: Deezer Artist API
1. Parse artist ID or search by name using `/api/charts/search/artist?q=${encodeURIComponent(name)}`.
2. Extract the best match artist ID.
3. Fetch artist detail, top tracks, albums, and related artists concurrently via `Promise.allSettled()`.
4. Format into `ArtistProfile`:
   - `topTracks`: formatted with `/api/stream/track` YouTube extraction + studio 30s preview fallback.
   - `albums`: formatted into `AlbumSummary` array with cover artwork and release year.
   - `relatedArtists`: formatted into `RelatedArtist` array with avatar and name.

#### Tier 2: Audius API Fallback
If Tier 1 fails or returns 0 tracks:
1. Search Audius tracks and users: `/api/audius/tracks/search?query=${encodeURIComponent(name)}&limit=30`.
2. Group tracks by user and release tags.
3. Populate `topTracks` and `discography` directly with Audius MP3 streaming endpoints.
4. Extract unique genre tags and related Audius creators.

#### Tier 3: Internet Archive Fallback
If Tier 1 & 2 return 0 tracks:
1. Query Archive: `mediatype:audio AND creator:"${name}"` via `/api/archive/advancedsearch.php`.
2. Map public domain concerts/tracks to `Track` model with `/api/archive/stream/:id`.
3. Group by concert year or venue into `albums`.

#### Tier 4: Synthetic Profile Generator
If external queries fail or the device is offline:
1. Inspect `safeStorage` for `likedTracks`, `playlists`, and current `queue`.
2. Filter tracks where `track.artist.toLowerCase()` includes or matches `name.toLowerCase()`.
3. If matches are found:
   - Construct an `ArtistProfile` with `isSynthetic: true`.
   - Use the highest-resolution artwork from matched tracks as the avatar.
   - Set `bio`: `"Artist profile synthesized from your local music library and offline favorites."`
   - Group by `album` field for `albums`.
4. If no local matches exist:
   - Produce a graceful minimal shell with a search prompt and genre discovery suggestions.

### 3.3 Instant "Artist Radio" Generation Algorithm

Clicking "Artist Radio" creates a curated continuous radio mix according to the survey specification:

$$\text{Track Pool} = 40\% \text{ Anchor Artist} + 35\% \text{ Related Artists} + 25\% \text{ Genre Discovery}$$

#### Algorithmic Steps:
1. **Anchor Tracks ($Pool_A$)**: Take up to 10 top tracks and B-sides from the target artist.
2. **Related Tracks ($Pool_R$)**: Sample 2-3 top tracks from each of the artist's related artists ($R_1, R_2, R_3, R_4$).
3. **Genre Discovery Tracks ($Pool_G$)**: Sample top-rated tracks matching the artist's primary genres from Audius Trending or Charts.
4. **Golden-Ratio Interleaving & Anti-Clumping**:
   - Stride constraint: **Never place more than 2 tracks by the same artist sequentially**.
   - Interleave sequence: `[A1, R1_1, A2, R2_1, G1, A3, R1_2, R3_1, G2, A4, R2_2, G3, ...]`.
   - Shuffle within pools before interleaving to ensure fresh radio stations on each click.
5. **Instant Pre-Warming**:
   - Immediately execute `prefetchTrack(radioQueue[0])` and `prefetchTrack(radioQueue[1])`.
6. **Playback Hand-off**:
   - Invoke `playTrack(radioQueue[0], radioQueue)` to start playback in $< 1$ second.

---

## 4. Dedicated Artist View Component (`src/components/views/ArtistView.tsx`)

### 4.1 Component Structure & Spotify-Authentic Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│ Back Button & Breadcrumbs: "‹ Back to Home"                            │
├────────────────────────────────────────────────────────────────────────┤
│ HERO HEADER:                                                           │
│ [Avatar 200px]  Verified Artist Badge  Sparkles                        │
│                 ARTIST NAME (6xl font-black)                          │
│                 12,840,900 monthly listeners · Electronic, Synthwave   │
│                                                                        │
│ [ (►) Play Top Hits ]  [ (📻) Artist Radio ]  [ (♡) Follow ]  [ (⋯) ]  │
├────────────────────────────────────────────────────────────────────────┤
│ POPULAR TRACKS (Top 5 / Expand to 10):                                 │
│ #1  Artwork  Title  •  Album               Heart  3:42  (⋯)            │
│ #2  Artwork  Title  •  Album               Heart  4:15  (⋯)            │
│ [ See more / Show less ]                                               │
├────────────────────────────────────────────────────────────────────────┤
│ DISCOGRAPHY / ALBUMS (Horizontal Carousel or Responsive Grid):         │
│ [ Cover ]   [ Cover ]   [ Cover ]   [ Cover ]   [ Cover ]              │
│ Album 1     Album 2     Album 3     Single 1    Single 2               │
│ 2024 · Album 2022 · Album 2020 · EP 2023 · Single 2021 · Single      │
├────────────────────────────────────────────────────────────────────────┤
│ FANS ALSO LIKE (Related Artists Carousel / Grid):                      │
│ (Avatar)    (Avatar)    (Avatar)    (Avatar)    (Avatar)               │
│ Artist B    Artist C    Artist D    Artist E    Artist F               │
│ Electronic  Synthwave   Chillout    Dance       Ambient                │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Key Features in `ArtistView.tsx`
- **Dynamic Gradient Banner**: The hero background uses a subtle radial/linear gradient tinted by dark surface tones and hero artwork, maintaining the OLED pure dark aesthetic.
- **Instant Radio Button**: High-visibility pill button `data-testid="artist-radio-btn"` with `Radio` icon; triggers `artistService.generateArtistRadio(artist)`.
- **Top Tracks Table**: Interactive rows with hover play button, active playing indicators (equalizer pulse), duration, like toggles, and right-click or menu actions.
- **Albums Carousel**: Smooth horizontal scrolling on desktop and mobile, with cover zoom on hover and instant play album button.
- **Related Artists**: Circular portraits that link directly to other artist profiles via `navigateToArtist(rel.name, rel.id)`.
- **Synthetic Profile Banner**: When `profile.isSynthetic === true`, displays a clean badge: `"Offline / Library Profile · Synthesized from your collection"`.
- **Loading Skeleton**: High-fidelity pulsating skeleton during network fetch to eliminate layout shift.

---

## 5. Player Store State & Navigation Integration (`src/store/playerStore.ts`)

### 5.1 Additions to `PlayerStoreState`

```ts
// 1. Expand AppView to include 'artist'
export type AppView = 'home' | 'search' | 'radio' | 'archive' | 'torrents' | 'library' | 'artist';

export interface SelectedArtistState {
  id: string;
  name: string;
}

// 2. Add state fields
interface PlayerStoreState {
  // Existing fields...
  activeView: AppView;
  currentView: AppView; // Backwards-compatible alias for activeView
  selectedArtist: SelectedArtistState | null;
  previousView: AppView; // For smooth back-navigation

  // New Actions
  navigateToArtist: (artistName: string, artistId?: string) => void;
  navigateBack: () => void;
}
```

### 5.2 Store Implementation Details

```ts
navigateToArtist: (artistName: string, artistId?: string) => {
  if (!artistName || !artistName.trim()) return;
  const cleanName = artistName.trim();
  const id = artistId || `artist:${encodeURIComponent(cleanName.toLowerCase())}`;
  
  set((state) => ({
    previousView: state.activeView === 'artist' ? state.previousView : state.activeView,
    activeView: 'artist',
    currentView: 'artist',
    selectedArtist: { id, name: cleanName },
    isMobileSheetOpen: false, // Close mobile full sheet to reveal artist
  }));
},

navigateBack: () => {
  set((state) => ({
    activeView: state.previousView || 'home',
    currentView: state.previousView || 'home',
  }));
},
```

### 5.3 Updating `src/App.tsx` View Switch

In `src/App.tsx`:
```tsx
import { ArtistView } from './components/views/ArtistView';

// Inside renderActiveView():
case 'artist':
  return <ArtistView />;
```

---

## 6. Shared Track Table & Universal Artist Hooking

To avoid duplicating table markup and ensure 100% consistent artist click behavior, a reusable `TrackTable` component will be introduced.

### 6.1 Reusable `src/components/common/TrackTable.tsx`

```tsx
export interface TrackTableProps {
  tracks: Track[];
  showArtwork?: boolean;
  showAlbum?: boolean;
  showSource?: boolean;
  showTrackNumber?: boolean;
  onPlayTrack?: (track: Track, queue: Track[]) => void;
}
```

Every track row in `TrackTable.tsx` includes:
```tsx
<span
  data-testid="track-artist-link"
  onClick={(e) => {
    e.stopPropagation();
    navigateToArtist(track.artist);
  }}
  className="text-xs text-secondary truncate hover:underline hover:text-primary cursor-pointer transition-colors"
>
  {track.artist}
</span>
```

### 6.2 Hooking Artist Clicks Across Existing Views

| Component File | Location | Existing Code | Proposed Hook |
|---|---|---|---|
| `src/components/layout/PlayerBar.tsx` | Left info block (line 156) | `<span className="text-xs text-secondary truncate hover:underline cursor-pointer">{currentTrack.artist}</span>` | Add `onClick={() => navigateToArtist(currentTrack.artist)}` |
| `src/components/views/HomeView.tsx` | Hero Banner (line 108) | `<span>{heroTrack.artist}</span>` | Wrap in clickable link with `onClick={() => navigateToArtist(heroTrack.artist)}` |
| `src/components/views/HomeView.tsx` | Chart track cards (line 191) | `<p data-testid="track-artist">{track.artist}</p>` | Add `onClick={(e) => { e.stopPropagation(); navigateToArtist(track.artist); }}` |
| `src/components/views/HomeView.tsx` | Popular Artists (line 219) | `onClick={() => handleArtistClick(artist)}` | Update `handleArtistClick` to call `navigateToArtist(artist.name, `charts:artist:${artist.id}`)` |
| `src/components/views/HomeView.tsx` | Audius trending cards (line 323) | `<p data-testid="track-artist">{track.artist}</p>` | Add `onClick={(e) => { e.stopPropagation(); navigateToArtist(track.artist); }}` |
| `src/components/views/HomeView.tsx` | Archive live concert rows (line 367) | `<p>{track.artist}</p>` | Add `onClick={(e) => { e.stopPropagation(); navigateToArtist(track.artist); }}` |
| `src/components/views/SearchView.tsx` | Results rows (line 216) | `<p className="text-xs text-secondary truncate">{track.artist}</p>` | Add `onClick={(e) => { e.stopPropagation(); navigateToArtist(track.artist); }}` |
| `src/components/views/LibraryView.tsx` | Liked & Playlist rows (line 178) | `<p className="text-xs text-secondary truncate">{track.artist}</p>` | Add `onClick={(e) => { e.stopPropagation(); navigateToArtist(track.artist); }}` |
| `src/components/player/QueueDrawer.tsx` | Now playing & queue rows (lines 42, 81) | `<p className="text-xs text-secondary truncate">{track.artist}</p>` | Add `onClick={(e) => { e.stopPropagation(); navigateToArtist(track.artist); }}` |
| `src/components/layout/MobileMiniPlayer.tsx` | Mini player artist line (line 44) | `<p className="text-[11px] text-secondary truncate">{currentTrack.artist}</p>` | Add `onClick={(e) => { e.stopPropagation(); navigateToArtist(currentTrack.artist); }}` |
| `src/components/player/MobileNowPlayingSheet.tsx` | Full sheet artist line (line 174) | `<p data-testid="sheet-track-artist">{currentTrack.artist}</p>` | Add `onClick={() => { navigateToArtist(currentTrack.artist); toggleMobileSheet(false); }}` |

---

## 7. Edge Cases & Resilience Strategy

1. **Multi-Artist Track Strings** (`"Daft Punk feat. Pharrell Williams"`, `"Queen, David Bowie"`):
   - Provide a helper function `extractPrimaryArtist(name: string): string` that splits on `feat.`, `ft.`, `&`, `vs.`, `,` to target the lead artist for profile queries while preserving the full display string for credit.
2. **Obscure or Niche Artists with 0 Hits on Deezer/Audius**:
   - The 4-tier fallback triggers Tier 4: searches on-device tracks in `safeStorage` (`likedTracks`, `playlists`, `history`). If found, dynamically synthesizes a profile.
   - If completely unknown, renders a clean minimal profile with a search bar and suggested similar genres instead of a broken page.
3. **Artist Radio on Single-Track Artists**:
   - If an artist has only 1 track, fill the remaining 49 tracks of the radio pool with Audius Trending tracks sharing the track's genre tags and top chart hits.
4. **Sub-second Cold Start for Artist Radio**:
   - The radio generator immediately invokes `prefetchTracks(radioQueue, 2)` before calling `playTrack(radioQueue[0], radioQueue)`, ensuring audio begins within 180–350 ms.
5. **Mobile Viewport (<768px) Adaptation**:
   - Stacks hero header vertically, sets 48px touch targets for "Play" and "Artist Radio" buttons, and ensures touch-friendly horizontal scrolling for albums.

---

## 8. Verification & Independent Test Strategy

### 8.1 Automated Unit Tests
Write tests in `tests/unit/artistView.spec.ts`:
1. **Model Validation**: Test `ArtistProfile`, `AlbumSummary`, and `ArtistRadioConfig` contracts.
2. **Radio Composition & Dispersion**: Test that `generateArtistRadio` produces a 50-track list with the specified 40/35/25 ratio, and that no artist appears more than 2 times in a row.
3. **Fallback Hierarchy**: Test Tier 1 -> Tier 2 -> Tier 3 -> Tier 4 fallback progression with mocked API responses.
4. **Primary Artist Extraction**: Test `extractPrimaryArtist("Calvin Harris feat. Ellie Goulding") === "Calvin Harris"`.

### 8.2 End-to-End & Component Verification Commands
- `npm test` / `vitest run`: Ensure all 4 existing test suites pass cleanly alongside new artist test suites.
- `npm run build`: Verify TypeScript compilation and zero Vite bundling errors.
- Manual / Playwright verification:
  - Click artist name in `PlayerBar` -> verifies navigation to `ArtistView` with artist name matching track.
  - Click artist card in `HomeView` Popular Artists -> verifies navigation to `ArtistView`.
  - Click "Play Artist Radio" -> verifies audio plays, queue is populated with 50 tracks, and top 2 are pre-warmed.

---

## 9. Implementation Checklist for Implementer

- [ ] **Step 1**: Create `src/types/artist.ts` with `AlbumSummary`, `RelatedArtist`, `ArtistProfile`, and `ArtistRadioConfig`.
- [ ] **Step 2**: Add Deezer artist proxy endpoints in `server/index.js` (`/api/charts/artist/:id`, `/albums`, `/related`, `/search/artist`).
- [ ] **Step 3**: Implement `src/services/artistService.ts` with 4-tier fallback and instant Artist Radio algorithm.
- [ ] **Step 4**: Update `src/store/playerStore.ts` with `activeView: 'artist'`, `currentView`, `selectedArtist`, `navigateToArtist`, and `navigateBack`.
- [ ] **Step 5**: Create reusable `src/components/common/TrackTable.tsx` with clickable artist links.
- [ ] **Step 6**: Implement `src/components/views/ArtistView.tsx` with hero, top tracks, albums carousel, discography, and related artists.
- [ ] **Step 7**: Update `src/App.tsx` to render `<ArtistView />` when `activeView === 'artist'`.
- [ ] **Step 8**: Hook artist name clicks across `PlayerBar.tsx`, `HomeView.tsx`, `SearchView.tsx`, `LibraryView.tsx`, `QueueDrawer.tsx`, and mobile player sheets.
- [ ] **Step 9**: Add unit tests in `tests/unit/artistView.spec.ts` and verify `npm test` and `npm run build`.
