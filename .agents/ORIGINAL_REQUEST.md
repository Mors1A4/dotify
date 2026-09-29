# Original User Request

## Initial Request — 2026-09-18T07:55:52Z

Build dotify, an ultra-snappy, lightweight, and super-customizable cross-platform (Android and Desktop) Spotify clone that streams music completely free using open/decentralized audio feeds (Audius, Internet Archive, Radio-Browser) and instant P2P torrent audio streaming with zero UI-induced latency.

Working directory: c:\Users\monty\Documents\AB\notify
Integrity mode: development

## Requirements

### R1. Cross-Platform Responsive & Zero-Latency UI
The application must run smoothly on both desktop and Android devices (as an installable PWA and responsive web app) with zero UI-induced latency. It must feature an authentic dark-themed layout:
- **Desktop view (>= 768px)**: 3-column layout with collapsible navigation sidebar, top search/filter header, central content feed, right drawer (queue/equalizer), and persistent bottom playback bar.
- **Android / Mobile view (< 768px)**: Mobile bottom navigation bar, floating mini-player bar, and a tap-to-expand full-screen Now-Playing sheet with touch-friendly 48px tap targets.
- **System Media Integration**: Full integration with `navigator.mediaSession` providing lock-screen media controls, notification drawer playback widgets, and hardware media key support on both Android and Desktop.
- High-frequency UI elements (seekbar scrubbing at 100ms and 60 FPS audio visualizer) must update without re-rendering parent components or dropping frames.

### R2. Multi-Source Free Streaming & Instant P2P Torrent Engine
Users must be able to search and stream audio instantly from multiple legal, free sources:
- **Decentralized Streams**: Audius API (trending charts, genre filtering, search, and direct MP3 streaming).
- **Public Domain & Live Archives**: Internet Archive (live concerts, public domain collections, search and stream).
- **Live Radio**: Radio-Browser API (search and stream from 35,000+ live global stations).
- **P2P Torrent Streaming Engine**: Paste magnet links or upload `.torrent` files; inspect contained files, detect audio tracks, and stream sequentially via HTTP 206 Partial Content range requests without waiting for the full torrent to download.

### R3. Deep Customizability (Themes & Sound DSP)
The app must be extensively customizable:
- **Theme Engine**: Real-time CSS Custom Properties token switcher with built-in presets (*Spotify OLED Pure Black*, *Nord Frost*, *Cyberpunk Neon*, *Retro Winamp*, *Rose Pine*) plus a custom color picker that updates colors instantaneously without reloading.
- **10-Band Graphic Equalizer**: Web Audio API DSP filter cascade (32Hz to 16kHz) with presets (*Bass Boost, Vocal Clarity, Rock, Electronic, Flat, Custom*) and pre-amp control.

### R4. Library & State Persistence
- User can like tracks, create custom playlists mixing tracks from any source (Audius, Archive, Radio, P2P), and persist their queue and playback history in `localStorage`.

## Acceptance Criteria

### Playback & Streaming
- [ ] Clicking play on an Audius trending track starts audio playback in < 2 seconds.
- [ ] Internet Archive search returns playable tracks with streaming audio and metadata.
- [ ] Live radio stations connect and play continuous live audio.
- [ ] Providing a valid audio magnet link displays torrent files and streams audio sequentially without requiring full file download.

### Responsiveness & Cross-Platform
- [ ] Viewport adapts cleanly between Android mobile (< 768px with bottom navigation & mini-player) and Desktop (>= 768px with 3-column Spotify layout).
- [ ] Lock screen / notification controls reflect current track title, artist, artwork, and respond to play/pause/skip.
- [ ] Seekbar scrubbing updates smoothly at 60 FPS without stutter or lag on audio position updates.

### Customization & Audio DSP
- [ ] Selecting different themes changes UI colors immediately across all components without page reload.
- [ ] Toggling or adjusting 10-band equalizer bands alters the audio output in real-time.
- [ ] Playlists and liked songs persist across page refreshes.

## Follow-up — 2026-09-19T09:22:16Z

Upgrade dotify into a feature-complete, cross-platform music streaming ecosystem with sub-second streaming latency, rich artist profiles, custom and Spotify-imported playlists, a private on-device listening dataset powering tailored algorithmic recommendations, Spotify Connect-style cross-device remote sync (phone controlling desktop), and Google Home / Chromecast speaker casting.

Working directory: c:\Users\monty\Documents\AB\notify
Integrity mode: development

## Requirements

### R1. Low-Latency Streaming & Enhanced Queue / Playlist Management
- Sub-second cold-start audio playback across all providers via multi-tier caching, predictive pre-warming, and low-bitrate fast chunks.
- Dedicated Artist View: clicking any artist name anywhere in the app opens their dedicated profile displaying top tracks, full discography, albums, related artists, and an instant "Artist Radio" mix.
- Full Queue Management: add to queue ("Play Next" and "Add to End"), drag-and-drop or reorder queue items, and remove individual tracks.
- Custom Playlists & Spotify Importer: create, rename, reorder, and delete custom playlists; paste any public Spotify playlist URL to resolve, preview, and save tracks into Dotify playlists with one click.

### R2. Private Listening Profile & Tailored Recommendation Engine
- Structured On-Device Listening Dataset: log playback telemetry (completion rate, skips, replays, listening session times, favorite genres) stored privately in IndexedDB with an exportable JSON dataset.
- Recommendation & Discovery Engine: generate dynamic personalized shelves on the Home view ("Discover Weekly", "Daily Mix", "Heavy Rotation", "Forgotten Favorites") and real-time infinite autoplay when the queue ends, calculated directly from the user's listening dataset.

### R3. Cross-Device Sync & Remote Control (Spotify Connect Protocol)
- Bidirectional device discovery and state synchronization over the local network via WebSockets.
- Remote Control Mode: use a mobile phone as a remote controller to view what's playing, play/pause, seek, adjust volume, and switch tracks on a desktop app or TV screen.
- Seamless Playback Handoff: transfer active playback between devices with millisecond-accurate timestamp preservation.

### R4. Google Home & Smart Speaker Casting
- Google Cast integration allowing users to cast audio directly to Google Home, Nest Audio, Chromecast, and smart speakers on the local Wi-Fi.
- Media controls (volume, play/pause, seek, track metadata, and album art) remain synchronized between the casting device and the smart speaker.

### R5. Testable Cross-Platform Packaging & UI Polish
- Tauri 2.0 / PWA pipeline verified for building and testing Android APKs and Desktop binaries.
- Responsive mobile (<768px) and desktop (>=768px) interfaces with system media notification and lock-screen controls.

## Acceptance Criteria

### Playback & Navigation
- [ ] Clicking any artist name navigates to a dedicated Artist View displaying top tracks, albums, and discography.
- [ ] Users can add tracks to the queue ("Play Next" and "Add to End") and reorder tracks in the queue drawer.
- [ ] Pasting a public Spotify playlist link extracts all tracks and imports them into a playable, saved Dotify playlist.
- [ ] Audio playback begins in < 1 second on standard network connections.

### Personalization & Dataset
- [ ] Listening events (completed plays, skips, repeat listens) are persisted to an on-device IndexedDB dataset.
- [ ] Personalized recommendation shelves ("Made For You", "Discover Weekly") render on the home screen based on the user's listening profile.
- [ ] Enabling Autoplay automatically cues up related recommended tracks when the current queue completes.

### Cross-Device Sync & Casting
- [ ] Available local devices appear in a "Connect to a Device" menu.
- [ ] Initiating playback or adjusting volume on a mobile device controls the desktop player in real time.
- [ ] Selecting a Google Home / Chromecast device routes audio playback to the speaker and keeps playback controls in sync.

### Quality & Testing
- [ ] All automated unit and integration tests pass cleanly (`npm test`).
- [ ] Production build succeeds with 0 TypeScript and bundling errors (`npm run build`).

