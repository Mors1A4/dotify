# Implementation Plan: Queue Management, Custom Playlists & Spotify Importer

**Author**: `explorer_m1_3` (Teamwork Preview Explorer)  
**Milestone**: Milestone 1 (Queue Management, Playlists & Spotify Importer)  
**Target Files**:
- `src/store/playerStore.ts`
- `src/types/playlist.ts` (new)
- `src/services/spotifyImporter.ts` (new)
- `src/components/player/QueueDrawer.tsx`
- `src/components/views/LibraryView.tsx`
- `src/components/modals/SpotifyImportModal.tsx` (new)
- `src/components/common/TrackActionMenu.tsx` (new / reusable dropdown)

---

## Executive Summary

This specification designs the exact technical implementation strategy for:
1. **Full Queue Management** in `playerStore.ts` and `QueueDrawer.tsx`:
   - Priority insertion via `playNext(track | tracks)`
   - Queue appending via `addToEnd(track | tracks)`
   - Seamless drag-and-drop & button-driven reordering via `reorderQueue(fromIndex, toIndex)` without interrupting active audio
   - Individual track removal via `removeFromQueue(index)` and safe queue clearing via `clearQueue()` (preserving active playback)
   - Distinct "Play Next" badges and sections in `QueueDrawer.tsx`
2. **Custom Playlists & Zero-Auth Spotify Importer** in `LibraryView.tsx` and `src/services/spotifyImporter.ts`:
   - Full playlist CRUD (Create, Rename, Reorder tracks, Delete) persisted in `safeStorage`
   - One-click Spotify Importer invoking `/api/spotify/resolve?url=...` with zero API keys
   - Live modal previewing playlist title, artwork, track count, and sample tracks before saving
   - Direct integration with cross-provider playback stream resolution

---

## 1. System Context & Interface Contracts

### 1.1 Type Definitions (`src/types/playlist.ts`)

Create `src/types/playlist.ts` adhering to the contract defined in `PROJECT.md` § Interface Contract 4:

```ts
import { Track } from './track';

export interface CustomPlaylist {
  id: string; // `pl_${Date.now()}_${randomHex}`
  name: string;
  description?: string;
  coverArt?: string;
  createdAt: number;
  updatedAt: number;
  isPinned?: boolean;
  tracks: Track[];
}

export interface SpotifyImportPreview {
  playlistTitle: string;
  playlistDescription?: string;
  playlistCoverUrl?: string;
  totalTracks: number;
  resolvedTracks: Track[];
  unresolvedCount: number;
}

export interface SpotifyParseResult {
  isValid: boolean;
  type?: 'playlist' | 'album' | 'track';
  id?: string;
  sanitizedUrl?: string;
  error?: string;
}
```

---

## 2. Store Design (`src/store/playerStore.ts`)

### 2.1 Interface Contract Updates

Extend `PlayerStoreState` with enhanced queue and playlist actions:

```ts
// In src/store/playerStore.ts
import { CustomPlaylist } from '../types/playlist';

interface PlayerStoreState {
  // ... existing state ...
  currentTrack: Track | null;
  queue: Track[];
  history: Track[];
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
  repeatMode: 'off' | 'all' | 'one';
  shuffle: boolean;
  autoplayEnabled: boolean; // Interface contract 3

  // Persistence
  likedTracks: Track[];
  playlists: CustomPlaylist[];

  // Enhanced Queue Actions
  playNext: (track: Track | Track[]) => void;
  addToEnd: (track: Track | Track[]) => void;
  addToQueue: (track: Track) => void; // Kept as alias to addToEnd for backwards compatibility
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  enableAutoplay: (enabled: boolean) => void;

  // Custom Playlist Actions
  createPlaylist: (name: string, description?: string, coverArt?: string) => string;
  renamePlaylist: (playlistId: string, newName: string) => void;
  deletePlaylist: (playlistId: string) => void;
  reorderPlaylistTracks: (playlistId: string, fromIndex: number, toIndex: number) => void;
  addTrackToPlaylist: (playlistId: string, track: Track) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  importCustomPlaylist: (playlist: Omit<CustomPlaylist, 'id' | 'createdAt' | 'updatedAt'>) => string;
}
```

### 2.2 Detailed Action Implementations

#### A. `playNext(track: Track | Track[])`
- **Objective**: Insert track(s) immediately after the active track ($i + 1$).
- **Audio Playback Invariant**: **Zero interruption**. `audioEngine.playTrack()` is NOT called if playback is already active.
- **Pre-Warming Hook**: Immediately triggers `prefetchTrack(firstInsertedTrack)` to prime the low-latency cache for sub-second transition.
- **Implementation**:
```ts
playNext: (track: Track | Track[]) => {
  const { queue, currentTrack } = get();
  const tracksToInsert = Array.isArray(track) ? track : [track];
  if (tracksToInsert.length === 0) return;

  // If no track is currently playing or queue is empty, start immediately
  if (!currentTrack || queue.length === 0) {
    get().playTrack(tracksToInsert[0], tracksToInsert);
    return;
  }

  // Find index of current playing track
  const currentIndex = queue.findIndex((t) => t.id === currentTrack.id);
  const insertIndex = currentIndex !== -1 ? currentIndex + 1 : queue.length;

  const updatedQueue = [
    ...queue.slice(0, insertIndex),
    ...tracksToInsert,
    ...queue.slice(insertIndex),
  ];

  safeStorage.setItem('queue', updatedQueue);
  set({ queue: updatedQueue });

  // Prime pre-warm engine for the new upcoming track
  try {
    prefetchTrack(tracksToInsert[0]);
  } catch {}
},
```

#### B. `addToEnd(track: Track | Track[])`
- **Objective**: Append track(s) to the end of the queue.
- **Audio Playback Invariant**: Audio continues playing uninterrupted.
- **Implementation**:
```ts
addToEnd: (track: Track | Track[]) => {
  const { queue, currentTrack } = get();
  const tracksToAdd = Array.isArray(track) ? track : [track];
  if (tracksToAdd.length === 0) return;

  if (!currentTrack && queue.length === 0) {
    get().playTrack(tracksToAdd[0], tracksToAdd);
    return;
  }

  const updatedQueue = [...queue, ...tracksToAdd];
  safeStorage.setItem('queue', updatedQueue);
  set({ queue: updatedQueue });
},
addToQueue: (track: Track) => get().addToEnd(track), // Alias for backwards compatibility
```

#### C. `reorderQueue(fromIndex: number, toIndex: number)`
- **Objective**: Move queue item from `fromIndex` to `toIndex`.
- **Audio Playback Invariant**: Active playback continues without drop, pause, or reset.
- **Boundary Checks**: Validates `0 <= fromIndex, toIndex < queue.length`.
- **Implementation**:
```ts
reorderQueue: (fromIndex: number, toIndex: number) => {
  const { queue, currentTrack } = get();
  if (
    fromIndex < 0 ||
    fromIndex >= queue.length ||
    toIndex < 0 ||
    toIndex >= queue.length ||
    fromIndex === toIndex
  ) {
    return;
  }

  const updatedQueue = [...queue];
  const [movedItem] = updatedQueue.splice(fromIndex, 1);
  updatedQueue.splice(toIndex, 0, movedItem);

  safeStorage.setItem('queue', updatedQueue);
  set({ queue: updatedQueue });

  // If upcoming tracks changed relative to currentTrack, pre-warm new position + 1
  if (currentTrack) {
    const curIdx = updatedQueue.findIndex((t) => t.id === currentTrack.id);
    if (curIdx !== -1 && updatedQueue[curIdx + 1]) {
      try {
        prefetchTrack(updatedQueue[curIdx + 1]);
      } catch {}
    }
  }
},
```

#### D. `removeFromQueue(index: number)`
- **Objective**: Remove track at specific index.
- **Behavior**:
  - If `index` is NOT the current track: slices element; audio continues uninterrupted.
  - If `index` IS the current track: advances to `nextTrack()` if remaining tracks exist, else halts cleanly.
```ts
removeFromQueue: (idx: number) => {
  const { queue, currentTrack, nextTrack } = get();
  if (idx < 0 || idx >= queue.length) return;

  const isCurrent = queue[idx].id === currentTrack?.id;
  const updatedQueue = queue.filter((_, i) => i !== idx);

  safeStorage.setItem('queue', updatedQueue);
  set({ queue: updatedQueue });

  if (isCurrent) {
    if (updatedQueue.length > 0) {
      nextTrack();
    } else {
      audioEngine.pause();
      set({ currentTrack: null, isPlaying: false });
    }
  }
},
```

#### E. `clearQueue()`
- **Objective**: Clears upcoming queued tracks while **preserving active playback**.
- **Behavior**:
  - If `currentTrack` is playing: `queue` becomes `[currentTrack]`. Audio does not pause or glitch.
  - If nothing is playing: `queue` becomes `[]`.
```ts
clearQueue: () => {
  const { currentTrack } = get();
  const updatedQueue = currentTrack ? [currentTrack] : [];
  safeStorage.setItem('queue', updatedQueue);
  set({ queue: updatedQueue });
},
```

#### F. Playlist Management Actions
```ts
createPlaylist: (name: string, description = '', coverArt = '') => {
  const id = `pl_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const newPlaylist: CustomPlaylist = {
    id,
    name: name.trim() || 'My Playlist',
    description: description.trim(),
    coverArt,
    tracks: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const updated = [...get().playlists, newPlaylist];
  safeStorage.setItem(STORAGE_PLAYLISTS, updated);
  set({ playlists: updated });
  return id;
},

renamePlaylist: (playlistId: string, newName: string) => {
  const cleanName = newName.trim();
  if (!cleanName) return;
  const updated = get().playlists.map((p) =>
    p.id === playlistId ? { ...p, name: cleanName, updatedAt: Date.now() } : p
  );
  safeStorage.setItem(STORAGE_PLAYLISTS, updated);
  set({ playlists: updated });
},

reorderPlaylistTracks: (playlistId: string, fromIndex: number, toIndex: number) => {
  const updated = get().playlists.map((p) => {
    if (p.id !== playlistId) return p;
    if (fromIndex < 0 || fromIndex >= p.tracks.length || toIndex < 0 || toIndex >= p.tracks.length) return p;
    const tracks = [...p.tracks];
    const [moved] = tracks.splice(fromIndex, 1);
    tracks.splice(toIndex, 0, moved);
    return { ...p, tracks, updatedAt: Date.now() };
  });
  safeStorage.setItem(STORAGE_PLAYLISTS, updated);
  set({ playlists: updated });
},

importCustomPlaylist: (pl) => {
  const id = `pl_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const newPlaylist: CustomPlaylist = {
    id,
    name: pl.name.trim() || 'Imported Playlist',
    description: pl.description || 'Imported from Spotify',
    coverArt: pl.coverArt || '',
    tracks: pl.tracks,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const updated = [...get().playlists, newPlaylist];
  safeStorage.setItem(STORAGE_PLAYLISTS, updated);
  set({ playlists: updated });
  return id;
},
```

---

## 3. UI Component Design: `QueueDrawer.tsx`

### 3.1 UX Structure & Layout
The `QueueDrawer` lives in the collapsible right drawer (Desktop) or accessible via mobile drawer/modal.
It features:
1. **Header**:
   - `ListMusic` icon + "Play Queue" title
   - Track count badge (`queue.length`)
   - **Clear Queue button**: Calls `clearQueue()`. Disabled or hidden when `queue.length <= 1`. Tooltip: "Clear upcoming tracks".
2. **"Now Playing" Section**:
   - Highlighted card with thumbnail, title, artist, source badge, animated pulse/audio visualizer indicator.
3. **"Next in Queue" Section**:
   - Separator header with upcoming track count.
   - For tracks inserted via `playNext`: renders a **"Play Next"** badge (`bg-accent/20 text-accent font-semibold text-[10px] px-1.5 py-0.5 rounded`).
4. **Dual Reordering Mechanisms**:
   - **Desktop**: HTML5 Drag & Drop (`draggable`, `onDragStart`, `onDragOver`, `onDrop`) with active drop indicator line (`border-t-2 border-accent`). Drag handle icon: `GripVertical`.
   - **Touch / Buttons**: Up and Down arrow buttons (`ChevronUp`, `ChevronDown`) for guaranteed accessibility and touch support.
5. **Individual Track Removal**:
   - `Trash2` button with hover highlight and confirmation on mouse/touch.
6. **Direct Jump Playback**:
   - Clicking any track row executes `playTrack(track, queue)`.

### 3.2 Component Code Blueprint
```tsx
import React, { useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { ListMusic, Trash2, Volume2, GripVertical, ChevronUp, ChevronDown, Sparkles } from 'lucide-react';

export const QueueDrawer: React.FC = () => {
  const { queue, currentTrack, playTrack, removeFromQueue, clearQueue, reorderQueue } = usePlayerStore();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const currentTrackIndex = currentTrack ? queue.findIndex((t) => t.id === currentTrack.id) : -1;
  const upcomingTracks = queue.map((track, idx) => ({ track, idx }));
  const canClear = queue.length > 1;

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', String(index));
    e.dataTransfer.effectAllowed = 'move';
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!isNaN(fromIndex) && fromIndex !== toIndex) {
      reorderQueue(fromIndex, toIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div data-testid="queue-drawer" className="p-4 bg-surface text-primary flex flex-col gap-4 h-full overflow-y-auto">
      {/* Drawer Header */}
      <div className="flex items-center justify-between border-b border-customBorder pb-3">
        <div className="flex items-center gap-2">
          <ListMusic className="text-accent" size={20} />
          <h3 className="font-bold text-base">Play Queue</h3>
          <span className="text-xs bg-highlight text-muted px-2 py-0.5 rounded-full font-mono">
            {queue.length}
          </span>
        </div>

        {canClear && (
          <button
            data-testid="clear-queue-btn"
            onClick={clearQueue}
            className="text-xs text-secondary hover:text-red-400 flex items-center gap-1.5 transition-colors px-2 py-1 rounded hover:bg-elevated"
            title="Clear upcoming tracks from queue"
          >
            <Trash2 size={13} />
            <span>Clear</span>
          </button>
        )}
      </div>

      {/* Now Playing Section */}
      {currentTrack && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-muted uppercase tracking-wider">Now Playing</span>
          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-elevated border border-accent/40 shadow-sm">
            <img
              src={currentTrack.artworkUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=100&h=100&fit=crop'}
              alt={currentTrack.title}
              className="w-10 h-10 rounded object-cover flex-shrink-0 bg-highlight"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate text-accent">{currentTrack.title}</p>
              <p className="text-xs text-secondary truncate">{currentTrack.artist}</p>
            </div>
            <Volume2 size={16} className="text-accent animate-pulse shrink-0" />
          </div>
        </div>
      )}

      {/* Next In Queue Section */}
      <div className="flex flex-col gap-2 flex-1 min-h-0">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted uppercase tracking-wider">
            Next In Queue {queue.length > 0 && `(${queue.length})`}
          </span>
        </div>

        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center py-10 text-muted">
            <ListMusic size={32} className="opacity-30 mb-2" />
            <p className="text-sm">Your queue is empty</p>
            <p className="text-xs text-secondary mt-1">Use "Play Next" or "Add to End" to build your queue</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 overflow-y-auto pr-1">
            {upcomingTracks.map(({ track, idx }) => {
              const isCurrent = idx === currentTrackIndex;
              const isNextUp = currentTrackIndex !== -1 && idx === currentTrackIndex + 1;
              const isDragged = draggedIndex === idx;
              const isDragOver = dragOverIndex === idx;

              return (
                <div
                  key={`${track.id}-${idx}`}
                  data-testid={`queue-item-${idx}`}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={(e) => handleDrop(e, idx)}
                  onDragEnd={handleDragEnd}
                  onClick={() => playTrack(track, queue)}
                  className={`group flex items-center justify-between gap-2 p-2 rounded-lg transition-all cursor-pointer select-none border ${
                    isCurrent
                      ? 'bg-elevated border-accent/40 text-accent'
                      : isDragOver
                      ? 'border-accent bg-elevated/60'
                      : isDragged
                      ? 'opacity-40 border-dashed border-secondary'
                      : 'border-transparent hover:bg-elevated'
                  }`}
                >
                  {/* Drag Handle & Reorder Controls */}
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="cursor-grab active:cursor-grabbing p-0.5 text-muted hover:text-primary transition-colors"
                      title="Drag to reorder"
                    >
                      <GripVertical size={14} />
                    </button>

                    <div className="flex flex-col">
                      <button
                        disabled={idx === 0}
                        onClick={() => reorderQueue(idx, idx - 1)}
                        className="text-muted hover:text-primary disabled:opacity-20 p-0.5 transition-colors"
                        title="Move Up"
                        aria-label="Move track up"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        disabled={idx === queue.length - 1}
                        onClick={() => reorderQueue(idx, idx + 1)}
                        className="text-muted hover:text-primary disabled:opacity-20 p-0.5 transition-colors"
                        title="Move Down"
                        aria-label="Move track down"
                      >
                        <ChevronDown size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Thumbnail & Title */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <img
                      src={track.artworkUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=80&h=80&fit=crop'}
                      alt={track.title}
                      className="w-8 h-8 rounded object-cover flex-shrink-0 bg-highlight"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className={`text-xs font-medium truncate ${isCurrent ? 'text-accent font-semibold' : 'text-primary'}`}>
                          {track.title}
                        </p>
                        {isNextUp && !isCurrent && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-accent/20 text-accent uppercase tracking-wider shrink-0">
                            Play Next
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted truncate">{track.artist}</p>
                    </div>
                  </div>

                  {/* Remove Track Button */}
                  <button
                    data-testid={`remove-queue-item-${idx}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromQueue(idx);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-muted hover:text-red-400 transition-opacity rounded hover:bg-highlight"
                    title="Remove from queue"
                    aria-label="Remove track from queue"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
```

---

## 4. Client Service: `src/services/spotifyImporter.ts`

### 4.1 Architecture & Flow
```
Spotify URL (Input)
       │
       ▼
validateSpotifyUrl() ─── Invalid ──► Display validation error message
       │ Valid
       ▼
GET /api/spotify/resolve?url=...
       │
       ▼
Map to SpotifyImportPreview
(Title, Artwork, TrackCount, Resolved Tracks, Unresolved Count)
       │
       ▼
User clicks "Save to Dotify Playlists"
       │
       ▼
importSpotifyPlaylist() ──► playerStore.importCustomPlaylist()
       │
       ▼
Switch to newly created playlist in LibraryView
```

### 4.2 Service Implementation Blueprint
Create `src/services/spotifyImporter.ts`:

```ts
import { Track } from '../types/track';
import { SpotifyImportPreview, SpotifyParseResult, CustomPlaylist } from '../types/playlist';
import { usePlayerStore } from '../store/playerStore';

/**
 * Validates and extracts Spotify entities from URLs and URIs.
 * Supports:
 * - https://open.spotify.com/playlist/{id}?si=...
 * - https://open.spotify.com/album/{id}
 * - https://open.spotify.com/track/{id}
 * - spotify:playlist:{id}
 */
export function validateSpotifyUrl(input: string): SpotifyParseResult {
  if (!input || typeof input !== 'string') {
    return { isValid: false, error: 'Please enter a Spotify URL' };
  }

  const clean = input.trim();
  const isWebUrl = clean.includes('spotify.com');
  const isUri = clean.startsWith('spotify:');

  if (!isWebUrl && !isUri) {
    return { isValid: false, error: 'URL must be a valid open.spotify.com link or spotify: URI' };
  }

  // Extract ID and entity type
  const playlistMatch = clean.match(/(?:playlist\/|playlist:)([a-zA-Z0-9]+)/);
  if (playlistMatch) {
    return {
      isValid: true,
      type: 'playlist',
      id: playlistMatch[1],
      sanitizedUrl: `https://open.spotify.com/playlist/${playlistMatch[1]}`,
    };
  }

  const albumMatch = clean.match(/(?:album\/|album:)([a-zA-Z0-9]+)/);
  if (albumMatch) {
    return {
      isValid: true,
      type: 'album',
      id: albumMatch[1],
      sanitizedUrl: `https://open.spotify.com/album/${albumMatch[1]}`,
    };
  }

  const trackMatch = clean.match(/(?:track\/|track:)([a-zA-Z0-9]+)/);
  if (trackMatch) {
    return {
      isValid: true,
      type: 'track',
      id: trackMatch[1],
      sanitizedUrl: `https://open.spotify.com/track/${trackMatch[1]}`,
    };
  }

  return { isValid: false, error: 'Could not detect a playlist, album, or track in this Spotify link' };
}

/**
 * Resolves a Spotify public link via the backend embed resolver endpoint.
 * Requires zero Spotify API keys or user logins.
 */
export async function fetchSpotifyPreview(url: string): Promise<SpotifyImportPreview> {
  const validation = validateSpotifyUrl(url);
  if (!validation.isValid || !validation.sanitizedUrl) {
    throw new Error(validation.error || 'Invalid Spotify URL');
  }

  const targetUrl = `/api/spotify/resolve?url=${encodeURIComponent(validation.sanitizedUrl)}`;
  const response = await fetch(targetUrl);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch Spotify playlist (HTTP ${response.status})`);
  }

  const data = await response.json();

  if (data.type === 'track' && data.track) {
    return {
      playlistTitle: `${data.track.title} - Single`,
      playlistDescription: `Imported Spotify single by ${data.track.artist}`,
      playlistCoverUrl: data.track.artworkUrl,
      totalTracks: 1,
      resolvedTracks: [data.track],
      unresolvedCount: 0,
    };
  }

  const resolvedTracks: Track[] = data.tracks || [];
  const totalTracks = data.trackCount || resolvedTracks.length;

  return {
    playlistTitle: data.title || 'Spotify Playlist',
    playlistDescription: data.description || 'Imported via Dotify Spotify Resolver',
    playlistCoverUrl: data.artworkUrl || '',
    totalTracks,
    resolvedTracks,
    unresolvedCount: Math.max(0, totalTracks - resolvedTracks.length),
  };
}

/**
 * Saves a resolved Spotify preview directly into Dotify custom playlists.
 */
export function saveSpotifyPlaylistToStore(preview: SpotifyImportPreview): string {
  const store = usePlayerStore.getState();
  const playlistId = store.importCustomPlaylist({
    name: preview.playlistTitle,
    description: preview.playlistDescription,
    coverArt: preview.playlistCoverUrl,
    tracks: preview.resolvedTracks,
  });

  return playlistId;
}
```

---

## 5. UI Component Design: `SpotifyImportModal.tsx`

Create `src/components/modals/SpotifyImportModal.tsx`:
- Modal dialog with dark glassmorphism styling (`bg-surface border border-customBorder rounded-2xl`).
- Step 1: Input field with instant auto-paste, clear button, and "Resolve Playlist" button.
- Step 2: Live preview with album artwork, title, track count badge, and a scrollable sample of resolved tracks.
- Step 3: "Import to Library" primary button (`bg-[#1DB954]` hover: `bg-[#1ed760]`).
- Success feedback: Displays a checkmark toast and navigates to the imported playlist immediately.

```tsx
import React, { useState } from 'react';
import { fetchSpotifyPreview, saveSpotifyPlaylistToStore } from '../../services/spotifyImporter';
import { SpotifyImportPreview } from '../../types/playlist';
import { X, Sparkles, Loader2, Music, Check, ArrowRight, Disc3 } from 'lucide-react';

interface SpotifyImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (playlistId: string) => void;
}

export const SpotifyImportModal: React.FC<SpotifyImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<SpotifyImportPreview | null>(null);

  if (!isOpen) return null;

  const handleResolve = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!urlInput.trim()) return;

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await fetchSpotifyPreview(urlInput);
      setPreview(result);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to resolve Spotify link. Ensure the playlist is public.');
      setPreview(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = () => {
    if (!preview) return;
    const playlistId = saveSpotifyPlaylistToStore(preview);
    onImportSuccess(playlistId);
    onClose();
  };

  return (
    <div
      data-testid="spotify-import-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-base/80 backdrop-blur-md animate-in fade-in"
    >
      <div className="relative w-full max-w-lg bg-surface border border-customBorder rounded-2xl shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-customBorder/50 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#1DB954]/20 flex items-center justify-center text-[#1DB954]">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="font-bold text-base text-primary">Import Spotify Playlist</h3>
              <p className="text-xs text-secondary">Zero-auth embed scraper • No Spotify login required</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-secondary hover:text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* URL Input Form */}
        <form onSubmit={handleResolve} className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-muted uppercase tracking-wider">
            Spotify Playlist, Album, or Track Link
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              data-testid="spotify-url-input"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://open.spotify.com/playlist/..."
              className="flex-1 bg-elevated border border-customBorder rounded-xl px-3.5 py-2.5 text-sm text-primary placeholder-muted focus:outline-none focus:border-accent transition-colors"
            />
            <button
              type="submit"
              data-testid="resolve-spotify-btn"
              disabled={isLoading || !urlInput.trim()}
              className="px-4 py-2.5 rounded-xl bg-accent text-accent-content font-bold text-xs flex items-center gap-1.5 shadow hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 transition-all"
            >
              {isLoading ? <Loader2 size={14} className="animate-spin" /> : <span>Resolve</span>}
            </button>
          </div>
        </form>

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            {errorMessage}
          </div>
        )}

        {/* Resolved Preview Card */}
        {preview && (
          <div className="flex flex-col gap-4 p-4 rounded-xl bg-elevated/70 border border-accent/30 animate-in fade-in">
            <div className="flex items-center gap-4">
              <img
                src={preview.playlistCoverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=120&h=120&fit=crop'}
                alt={preview.playlistTitle}
                className="w-16 h-16 rounded-lg object-cover shadow-md bg-highlight shrink-0"
              />
              <div className="min-w-0 flex-1">
                <h4 className="font-bold text-sm text-primary truncate">{preview.playlistTitle}</h4>
                <p className="text-xs text-secondary truncate mt-0.5">{preview.playlistDescription}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-accent/20 text-accent">
                    {preview.totalTracks} tracks
                  </span>
                  {preview.unresolvedCount > 0 && (
                    <span className="text-[11px] text-muted">
                      ({preview.resolvedTracks.length} ready)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Sample Track Preview */}
            <div className="flex flex-col gap-1 max-h-36 overflow-y-auto border-t border-customBorder/40 pt-2 pr-1">
              <span className="text-[10px] uppercase font-bold text-muted tracking-wider">Tracks Included</span>
              {preview.resolvedTracks.slice(0, 10).map((t, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs py-1 px-1.5 rounded hover:bg-highlight/50">
                  <span className="truncate text-primary flex-1">{idx + 1}. {t.title}</span>
                  <span className="text-muted text-[11px] truncate max-w-[120px] text-right">{t.artist}</span>
                </div>
              ))}
              {preview.resolvedTracks.length > 10 && (
                <span className="text-[11px] text-muted italic text-center py-1">
                  + {preview.resolvedTracks.length - 10} more tracks
                </span>
              )}
            </div>

            {/* Save Button */}
            <button
              onClick={handleSave}
              data-testid="save-spotify-playlist-btn"
              className="w-full py-3 rounded-xl bg-[#1DB954] hover:bg-[#1ed760] text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              <Check size={16} />
              <span>Save as Dotify Playlist</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
```

---

## 6. UI Component Enhancements: `LibraryView.tsx`

### 6.1 Upgrades Designed
1. **"Import from Spotify" Button**:
   - Placed prominently in the LibraryView action bar alongside "New Playlist".
   - Styled with Spotify brand green (`bg-[#1DB954] text-black font-bold`).
   - Toggles `SpotifyImportModal`.
2. **Playlist Rename**:
   - When viewing a custom playlist, an inline edit button (`Pencil size={13}`) allows renaming without reload.
   - Inline form with input and save (`Check`)/cancel (`X`) buttons.
   - Calls `renamePlaylist(selectedPlaylist.id, newName)`.
3. **Playlist Track Reordering**:
   - Reordering arrows (`ChevronUp`, `ChevronDown`) and drag handles (`GripVertical`) on each track row in custom playlists.
   - Calls `reorderPlaylistTracks(selectedPlaylist.id, fromIdx, toIdx)`.
   - Persists automatically to `safeStorage`.
4. **Enhanced Action Bar**:
   - "Play All", "Rename Playlist", "Delete Playlist", and "Total Duration" summary.

---

## 7. Global Context Menus: "Play Next" & "Add to End"

To enable queueing from anywhere in the app (HomeView, SearchView, LibraryView):
- Introduce a lightweight `TrackActionMenu`:
  - When user hovers or clicks 3 dots (`MoreVertical size={14}`) on any track card or table row:
    - **"Play Next"**: Calls `playNext(track)` (inserts right after active track, primes pre-warming).
    - **"Add to Queue"**: Calls `addToEnd(track)` (appends to end of queue).
    - **"Add to Playlist"**: Opens sub-menu to add to any custom playlist.
    - **"Like / Unlike"**: Calls `toggleLike(track)`.

---

## 8. State Invariants & Audio Continuity Guarantee

| Scenario | Operation | Current State | Target State | Playback Behavior |
|---|---|---|---|---|
| Track $i$ playing | `playNext(T_{new})` | `[T_0 ... T_i ... T_N]` | `[T_0 ... T_i, T_{new}, T_{i+1} ... T_N]` | **Zero audio glitch**. $T_i$ continues playing; $T_{new}$ pre-warmed. |
| Track $i$ playing | `addToEnd(T_{new})` | `[T_0 ... T_N]` | `[T_0 ... T_N, T_{new}]` | **Zero audio glitch**. $T_i$ continues playing. |
| Track $i$ playing | `reorderQueue(from, to)` | Active index adjusts | Elements reordered | **Zero audio glitch**. `HTMLAudioElement` continues streaming. |
| Track $i$ playing | `clearQueue()` | Queue length $N$ | Queue becomes `[T_i]` | **Zero audio glitch**. $T_i$ continues playing; upcoming cleared. |
| Track $i$ playing | `removeFromQueue(idx != i)`| Element at `idx` removed | Array sliced | **Zero audio glitch**. $T_i$ continues playing. |
| Track $i$ playing | `removeFromQueue(idx == i)`| Element at `i` removed | Advances to next | $T_{i+1}$ begins playing cleanly. |

---

## 9. Independent Verification & Test Plan

1. **Unit Tests (`tests/unit/queueStore.spec.ts`)**:
   - Verify `playNext` inserts at `currentTrackIndex + 1` when a track is active.
   - Verify `playNext` plays immediately when queue is empty.
   - Verify `addToEnd` appends to queue without modifying current track.
   - Verify `reorderQueue` correctly moves items and maintains `currentTrack` identity.
   - Verify `clearQueue` preserves `currentTrack` while dropping upcoming tracks.
   - Verify `renamePlaylist` and `reorderPlaylistTracks` persist to `dotify_v1_user_playlists`.

2. **Spotify Resolver Tests (`tests/unit/spotifyResolver.spec.ts`)**:
   - Verify `validateSpotifyUrl` parses web links (`open.spotify.com/playlist/...`) and URIs (`spotify:playlist:...`).
   - Verify mock responses from `/api/spotify/resolve` correctly construct `SpotifyImportPreview`.
   - Verify `importCustomPlaylist` properly attaches all tracks to a new playlist in library.

3. **E2E Integration Verification**:
   - Run `npm test` to ensure all existing 22 tests continue to pass.
   - Run `npm run build` to confirm 0 TypeScript compile errors.
