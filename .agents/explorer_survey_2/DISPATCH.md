# Dispatch Task: Explorer Survey 2 (UI/UX, Responsive Layout, MediaSession, Theme Engine, State)
Investigate zero-latency UI architecture, Android & Desktop responsive layouts, MediaSession integration, themes, and persistence.

## 2026-09-18T08:01:44Z
Investigate and design the zero-latency UI/UX architecture, responsive cross-platform layouts, MediaSession integration, theme engine, and persistence state model:
1. Desktop Layout (>= 768px):
   - 3-column Spotify-style authentic dark layout:
     * Collapsible left sidebar (navigation, library, playlists)
     * Top sticky bar (search bar, filter pills, theme toggle, equalizer button)
     * Central content feed (infinite scroll / grid for trending, search results, playlist view)
     * Right collapsible drawer (active queue, track info, lyrics/credits, quick equalizer)
     * Persistent bottom playback bar (track info, playback controls, seekbar, volume, shuffle/repeat, EQ toggle)
2. Android / Mobile Layout (< 768px):
   - Mobile bottom navigation bar (Home, Search, Library)
   - Floating mini-player bar above bottom nav (with track title, artist, play/pause, tap to expand)
   - Tap-to-expand full-screen Now-Playing modal sheet with 48px touch tap targets, large artwork, full scrub bar, volume, queue button, and gesture-friendly dismiss
3. High-Frequency / Zero-Latency State Architecture:
   - Scrubbing seekbar at 100ms and 60 FPS audio visualizer: how to achieve this without re-rendering parent components (e.g. direct DOM / ref manipulation, custom hooks, Zustand transient updates, or requestAnimationFrame)
4. System Media Integration:
   - Full navigator.mediaSession implementation: metadata (title, artist, album, artwork array with 96x96, 128x128, 256x256, 512x512)
   - Action handlers: 'play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto'
   - Position state synchronization: setPositionState({ duration, playbackRate, position })
   - Hardware media keys and lock screen notification drawer support on Android and Desktop browsers
5. Theme Engine:
   - CSS Custom Properties token design (e.g., --bg-base, --bg-surface, --bg-elevated, --text-primary, --text-secondary, --accent, --accent-hover, --border)
   - Presets: Spotify OLED Pure Black, Nord Frost, Cyberpunk Neon, Retro Winamp, Rose Pine
   - Instant live custom color picker (updating CSS vars in root instantaneously without page reload)
6. Library & State Persistence:
   - LocalStorage schemas for: Liked songs, Custom playlists (supporting cross-source tracks: Audius, Archive, Radio, P2P), Queue, Playback history, Theme selection, Custom colors, Equalizer settings, Volume.

Deliver a detailed architecture blueprint with exact CSS token definitions, state contracts, and component hierarchy.
