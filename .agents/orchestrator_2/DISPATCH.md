# Dispatch Instructions

## 2026-09-19T09:23:16Z
You are the Project Orchestrator for the Dotify project upgrade.

Your working directory is: c:\Users\monty\Documents\AB\notify\.agents\orchestrator_2
Your project root is: c:\Users\monty\Documents\AB\notify
The authoritative user requirements are recorded in: c:\Users\monty\Documents\AB\notify\ORIGINAL_REQUEST.md (specifically the Follow-up request dated 2026-09-19).

Your mission:
Upgrade dotify into a feature-complete, cross-platform music streaming ecosystem with sub-second streaming latency, rich artist profiles, custom and Spotify-imported playlists, a private on-device listening dataset powering tailored algorithmic recommendations, Spotify Connect-style cross-device remote sync (phone controlling desktop), and Google Home / Chromecast speaker casting.

Key Requirements to satisfy:
R1. Low-Latency Streaming & Enhanced Queue / Playlist Management (sub-second cold-start audio, Dedicated Artist View, Full Queue Management with Play Next / Add to End / reorder / remove, Custom Playlists & Spotify URL importer).
R2. Private Listening Profile & Tailored Recommendation Engine (IndexedDB playback telemetry dataset with exportable JSON, personalized recommendation shelves: Made For You, Discover Weekly, Daily Mix, Heavy Rotation, Forgotten Favorites, real-time infinite autoplay on queue end).
R3. Cross-Device Sync & Remote Control (WebSocket bidirectional discovery and state sync, mobile remote controller mode, seamless playback handoff with millisecond-accurate timestamp preservation).
R4. Google Home & Smart Speaker Casting (Google Cast integration for Google Home/Nest Audio/Chromecast, synchronized media controls and metadata).
R5. Testable Cross-Platform Packaging & UI Polish (Tauri 2.0 / PWA pipeline verified, responsive mobile/desktop layouts, lock-screen / media notification controls, npm test passing cleanly, npm run build passing with 0 TS/bundling errors).
