# E2E Test Infra: Dotify Upgrade Ecosystem

## Test Philosophy
- Opaque-box, requirement-driven derived directly from `ORIGINAL_REQUEST.md` (Follow-up dated 2026-09-19).
- Zero dependency on internal implementation structures.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Workload Testing.

## Feature Inventory & Target Coverage
| # | Feature | Requirement | Tier 1 (>=5) | Tier 2 (>=5) | Tier 3 (Pairwise) | Tier 4 (Workloads) |
|---|---------|-------------|:------------:|:------------:|:-----------------:|:------------------:|
| 1 | Low-Latency Streaming (<1s cold-start) | R1 | 5 | 5 | ✓ | ✓ |
| 2 | Dedicated Artist View & Discography | R1 | 5 | 5 | ✓ | ✓ |
| 3 | Instant Artist Radio Generation | R1 | 5 | 5 | ✓ | ✓ |
| 4 | Queue Management (Play Next, Add to End, Reorder, Remove) | R1 | 5 | 5 | ✓ | ✓ |
| 5 | Custom Playlists (Create, Rename, Reorder, Delete) | R1 | 5 | 5 | ✓ | ✓ |
| 6 | Spotify Playlist URL Importer & Track Resolver | R1 | 5 | 5 | ✓ | ✓ |
| 7 | IndexedDB Playback Telemetry Dataset | R2 | 5 | 5 | ✓ | ✓ |
| 8 | Telemetry JSON Export & Import | R2 | 5 | 5 | ✓ | ✓ |
| 9 | Personalized Discovery Shelves (Made For You, Discover Weekly, Daily Mix, Heavy Rotation, Forgotten Favorites) | R2 | 5 | 5 | ✓ | ✓ |
| 10 | Infinite Autoplay Engine on Queue End | R2 | 5 | 5 | ✓ | ✓ |
| 11 | Local Device Discovery & Pairing (WebSocket / Connect) | R3 | 5 | 5 | ✓ | ✓ |
| 12 | Remote Controller Mode (Mobile controlling Desktop) | R3 | 5 | 5 | ✓ | ✓ |
| 13 | Seamless Playback Handoff (Millisecond-accurate) | R3 | 5 | 5 | ✓ | ✓ |
| 14 | Google Home & Smart Speaker Casting | R4 | 5 | 5 | ✓ | ✓ |
| 15 | Synchronized Speaker Media Controls & Metadata | R4 | 5 | 5 | ✓ | ✓ |
| 16 | Cross-Platform Packaging, Responsive Views & MediaSession | R5 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- Test Runner: Vitest / Playwright test harness executable via `npm test` and `npm run test:e2e`
- Format: Self-contained TypeScript test specifications in `tests/e2e/` and `tests/unit/`
- Assertion criteria: Exact exit codes, DOM state verification, Web Audio / IndexedDB state queries, and network mock/fixture validations.

## Real-World Application Scenarios (Tier 4)
1. **Scenario 1: Daily Commute**: Import public Spotify playlist -> download/pre-warm -> listen offline -> telemetry records completion -> generate Daily Mix.
2. **Scenario 2: Remote Party**: Desktop plays music on speaker -> phone connects via Connect menu -> phone queues "Play Next" and adjusts volume without local audio echo.
3. **Scenario 3: Smart Speaker Casting**: Desktop discovers Google Home -> routes audio to Chromecast -> cast player maintains synchronized play/pause/volume with Dotify UI.
4. **Scenario 4: Artist Deep-Dive**: User clicks artist name from search -> navigates to dedicated Artist View -> browses full discography -> launches instant Artist Radio.
5. **Scenario 5: Queue Runout to Infinite Autoplay**: User reaches final track of custom queue -> autoplay activates smoothly -> 5 contextual tracks cued with zero playback gap.

## Coverage Thresholds
- Tier 1: ≥ 5 test cases per feature (~80 test cases)
- Tier 2: ≥ 5 boundary test cases per feature (~80 test cases)
- Tier 3: Pairwise cross-feature interactions (~20 test cases)
- Tier 4: ≥ 5 comprehensive application scenarios
- **Total Minimum Target**: ~185 test cases
