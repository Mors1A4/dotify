# Dead Ends — Dotify Upgrade Ecosystem

| Iteration | Approach Tried | Why It Failed | Files Touched |
|---|---|---|---|
| M2 It1 | `generateForgottenFavorites` returning empty array `[]` when telemetry history is zero | Shelf 5 hides on HomeView, violating cold-start UX where all 5 shelves must be populated | `src/services/recommendationEngine.ts`, `src/components/views/HomeView.tsx` |
| M2 It1 | Array truthiness fallback `catalogue.filter(...) || fallback` | `[]` is truthy in JavaScript, so empty filtered array never triggers `|| fallback`, returning 0 tracks | `src/services/recommendationEngine.ts` |
| M2 It1 | Slicing same full catalogue for all Daily Mixes on single-genre history | Produces identical tracks across Mix 1 and Mix 2 (Jaccard similarity = 1.0) | `src/services/recommendationEngine.ts` |
| M2 It1 | Permissive fallback on anti-clumping candidate exhaustion | Allowed up to 6 consecutive tracks by the same artist; strict invariant `<= 2 consecutive tracks` violated | `src/services/artistService.ts`, `src/services/recommendationEngine.ts` |
| M2 It1 | Tracks matching both seed artist and genre added to both candidate pools without dedup | Produced duplicate track IDs in autoplay queue, causing `playerStore.nextTrack` `findIndex` to jump backward to index 0 in an infinite runaway loop | `src/services/recommendationEngine.ts`, `src/store/playerStore.ts` |
