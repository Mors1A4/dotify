# Handoff Report: Milestone 1 — Dedicated Artist View & Instant Artist Radio

**Agent**: `explorer_m1_2` (Teamwork Preview Explorer)  
**Milestone**: Milestone 1 (Dedicated Artist View & Artist Radio)  
**Date**: 2026-09-19  
**Handoff Type**: Hard (Task Complete)  

---

## 1. Observation

Direct observations and evidence collected during code and documentation inspection:

1. **Authoritative Requirements**:
   - `ORIGINAL_REQUEST.md` (Follow-up 2026-09-19, Lines 63, 87):
     > "Dedicated Artist View: clicking any artist name anywhere in the app opens their dedicated profile displaying top tracks, full discography, albums, related artists, and an instant 'Artist Radio' mix."
     > "- [ ] Clicking any artist name navigates to a dedicated Artist View displaying top tracks, albums, and discography."
2. **Current View State in Store**:
   - `src/store/playerStore.ts` (Lines 8, 28, 114):
     `export type AppView = 'home' | 'search' | 'radio' | 'archive' | 'torrents' | 'library';`
     `activeView: AppView;`
     Notice `'artist'` view is not present in `AppView`.
   - `src/App.tsx` (Lines 22–38):
     `switch (activeView) { case 'home': ... case 'search': ... default: return <HomeView />; }`
     No case for `'artist'` exists.
3. **Existing Artist Elements Missing Navigation Handlers**:
   - `src/components/layout/PlayerBar.tsx` (Lines 156–158):
     ```tsx
     <span className="text-xs text-secondary truncate hover:underline cursor-pointer">
       {currentTrack.artist}
     </span>
     ```
     Has `hover:underline cursor-pointer` styling but no `onClick` handler.
   - `src/components/views/HomeView.tsx` (Lines 73–83, 191–193, 219–222):
     In `HomeView.tsx`, clicking Popular Artists runs `fetchArtistTopTracks(artist.id, 20)` and immediately plays track 0 without opening an artist profile. Track cards have `<p data-testid="track-artist">{track.artist}</p>` with no click handler.
   - `src/components/views/SearchView.tsx` (Line 216) & `LibraryView.tsx` (Line 178):
     `<p className="text-xs text-secondary truncate">{track.artist}</p>` with no `onClick` handler.
   - `src/components/layout/MobileMiniPlayer.tsx` (Line 44) & `src/components/player/MobileNowPlayingSheet.tsx` (Line 174):
     Display artist text with no navigation handler.
4. **Backend Proxy Endpoints**:
   - `server/index.js` (Lines 167–179):
     Contains `/api/charts/artist/:id/top` proxying to `https://api.deezer.com/artist/:id/top`.
     Does not yet contain endpoints for `/api/charts/artist/:id` (artist details), `/albums`, or `/related`.
5. **Specification Contracts**:
   - `PROJECT.md` (Lines 119–149) and `survey_streaming_data.md` (Lines 140–177, 205–221):
     Specify `ArtistProfile`, `AlbumSummary`, `RelatedArtist`, `ArtistRadioConfig`, the 40/35/25 radio composition formula, and golden-ratio stride interleaving.
6. **Project Build & Test Status**:
   - `npm test` (vitest run): Exited code 0, 4 test files passed (22 tests) in 619 ms.
   - `npm run build` (tsc && vite build): Exited code 0, built in 3.51s with 0 errors.

---

## 2. Logic Chain

Step-by-step reasoning from observations to implementation design:

1. **Enabling View Routing**:
   - From Observation 2, `activeView` governs central stage rendering in `App.tsx`.
   - By adding `'artist'` to `AppView` in `src/store/playerStore.ts` and adding `selectedArtist: { id: string; name: string } | null` + `currentView: AppView` (synced alias), any component can trigger navigation via a unified action `navigateToArtist(artistName: string, artistId?: string)`.
   - In `src/App.tsx`, adding `case 'artist': return <ArtistView />;` mounts the profile view dynamically.
2. **Fulfilling Universal Artist Click Navigation**:
   - From Observation 3, artist names are rendered in multiple UI components (`PlayerBar`, `HomeView`, `SearchView`, `LibraryView`, `QueueDrawer`, `MobileMiniPlayer`, `MobileNowPlayingSheet`).
   - By attaching `onClick={(e) => { e.stopPropagation(); navigateToArtist(artist); }}` to these elements, clicking any artist name in any context routes the user directly to the artist profile.
   - Introducing `src/components/common/TrackTable.tsx` consolidates duplicated track table JSX from `SearchView`, `LibraryView`, and `ArtistView` into a single DRY component with built-in artist navigation.
3. **Multi-Tier Artist Service Data Pipeline**:
   - From Observation 4 & 5, Deezer provides rich mainstream data but may not have obscure/archive tracks or may face network outages.
   - Therefore, `src/services/artistService.ts` must implement a 4-tier fallback hierarchy:
     1. **Tier 1 (Deezer API)**: Mainstream hits, listener counts, studio albums, related artists.
     2. **Tier 2 (Audius API)**: Decentralized indie tracks & genre tagging.
     3. **Tier 3 (Internet Archive)**: Live concert master tapes.
     4. **Tier 4 (Synthetic Profile)**: Local library scan of `safeStorage` tracks for offline/niche artists.
   - Adding 4 minimal proxy routes to `server/index.js` allows seamless upstream querying without CORS blocks.
4. **Algorithmic Artist Radio with Instant Cold-Start**:
   - From Observation 5, Artist Radio requires 40% Anchor Artist, 35% Related Artists, and 25% Genre Discovery tracks.
   - To avoid clumping (e.g. 10 songs by the same artist consecutively), golden-ratio stride dispersion guarantees no more than 2 tracks from the same artist consecutively.
   - Pre-warming the first 2-3 tracks of the generated queue via `prefetchTrack()` guarantees sub-second cold start audio playback.

---

## 3. Caveats

1. **Express Server Restart**:
   - Changes to `server/index.js` (adding the Deezer proxy routes) require restarting the server process (`node server/index.js` or `npm run dev`) to take effect in live development.
2. **External Rate Limits**:
   - Deezer public API enforces standard rate limits (~50 requests per 5 seconds). `artistService.ts` should cache resolved profiles in memory with a 1-hour TTL to prevent repeated upstream queries during rapid navigation.
3. **No Code Modification Performed**:
   - In adherence to explorer role constraints, zero source files were modified. All implementation specifications are documented in `plan_artist_view.md`.

---

## 4. Conclusion

A complete, production-ready implementation plan has been designed and verified for Milestone 1 Dedicated Artist View & Instant Artist Radio.

### Deliverables Produced
- `c:\Users\monty\Documents\AB\notify\.agents\explorer_m1_2\plan_artist_view.md`
- `c:\Users\monty\Documents\AB\notify\.agents\explorer_m1_2\handoff.md`

### Implementation Roadmap for Developer/Implementer
1. Add type contracts to `src/types/artist.ts`.
2. Add Deezer artist routes to `server/index.js`.
3. Implement `src/services/artistService.ts` (4-tier fallback + Artist Radio algorithm).
4. Update `src/store/playerStore.ts` (`activeView: 'artist'`, `selectedArtist`, `navigateToArtist`).
5. Create `src/components/common/TrackTable.tsx`.
6. Implement `src/components/views/ArtistView.tsx`.
7. Wire `src/App.tsx` and hook artist clicks in `PlayerBar.tsx`, `HomeView.tsx`, `SearchView.tsx`, etc.
8. Add automated tests to `tests/unit/artistView.spec.ts` and verify with `npm test` and `npm run build`.

---

## 5. Verification Method

To independently verify the recommendations and future implementation:

1. **Automated Unit Tests**:
   ```powershell
   npm test
   ```
   Ensures all existing tests pass and verifies new unit tests in `tests/unit/artistView.spec.ts`.
2. **Production Compilation & Type-Checking**:
   ```powershell
   npm run build
   ```
   Ensures 0 TypeScript errors (`tsc`) and a clean production Vite bundle.
3. **Interactive & E2E Validation**:
   - In `PlayerBar.tsx`, click the artist name under Now Playing: verify it updates `activeView` to `'artist'` and displays the artist profile.
   - In `HomeView.tsx`, click any artist in Popular Artists: verify it navigates to that artist's profile with top tracks and albums.
   - In `ArtistView.tsx`, click "Play Artist Radio": verify that 50 tracks are queued with the 40/35/25 ratio and playback begins in $< 1$ second.
4. **Invalidation Conditions**:
   - If clicking an artist name fails to change `activeView` to `'artist'`.
   - If an artist with 0 Deezer hits produces an unhandled error or blank screen instead of falling back to Audius/Archive/Synthetic profile.
