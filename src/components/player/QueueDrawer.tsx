import React, { useMemo, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { ListMusic, GripVertical, Sparkles, Play, Pause, X } from 'lucide-react';
import {
  DEFAULT_MUSIC_ARTWORK,
  getTrackArtwork,
  resolveTrackArtwork,
  isUglyPlaceholder,
} from '../../services/artworkService';

const FALLBACK_ARTWORK = DEFAULT_MUSIC_ARTWORK;

function formatDuration(seconds?: number): string {
  if (!seconds || !isFinite(seconds) || seconds <= 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export const QueueDrawer: React.FC = () => {
  const {
    queue,
    currentTrack,
    currentTrackIndex,
    isPlaying,
    togglePlay,
    playTrack,
    removeFromQueue,
    clearQueue,
    reorderQueue,
    navigateToArtist,
    autoplayEnabled,
    enableAutoplay,
  } = usePlayerStore();

  const [draggedQueueIndex, setDraggedQueueIndex] = useState<number | null>(null);
  const [dragOverQueueIndex, setDragOverQueueIndex] = useState<number | null>(null);

  // Resolve the active index of currentTrack inside queue so past & current tracks are excluded
  const effectiveCurrentIndex = useMemo(() => {
    if (!currentTrack) return -1;
    if (
      currentTrackIndex >= 0 &&
      currentTrackIndex < queue.length &&
      queue[currentTrackIndex]?.id === currentTrack.id
    ) {
      return currentTrackIndex;
    }
    const refIdx = queue.indexOf(currentTrack);
    if (refIdx !== -1) return refIdx;
    return queue.findIndex((t) => t.id === currentTrack.id);
  }, [queue, currentTrack, currentTrackIndex]);

  // Only show genuinely upcoming tracks (strictly after the currently playing track)
  const upcomingItems = useMemo(() => {
    if (effectiveCurrentIndex === -1) {
      return queue
        .map((track, queueIndex) => ({ track, queueIndex }))
        .filter((item) => !currentTrack || item.track.id !== currentTrack.id);
    }
    return queue.slice(effectiveCurrentIndex + 1).map((track, offset) => ({
      track,
      queueIndex: effectiveCurrentIndex + 1 + offset,
    }));
  }, [queue, effectiveCurrentIndex, currentTrack]);

  const canClear = upcomingItems.length > 0;

  const handleDragStart = (e: React.DragEvent, queueIndex: number) => {
    e.dataTransfer.setData('text/plain', String(queueIndex));
    e.dataTransfer.effectAllowed = 'move';
    setDraggedQueueIndex(queueIndex);
  };

  const handleDragOver = (e: React.DragEvent, queueIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverQueueIndex !== queueIndex) {
      setDragOverQueueIndex(queueIndex);
    }
  };

  const handleDrop = (e: React.DragEvent, toQueueIndex: number) => {
    e.preventDefault();
    const fromQueueIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!isNaN(fromQueueIndex) && fromQueueIndex !== toQueueIndex) {
      reorderQueue(fromQueueIndex, toQueueIndex);
    }
    setDraggedQueueIndex(null);
    setDragOverQueueIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedQueueIndex(null);
    setDragOverQueueIndex(null);
  };

  return (
    <div
      data-testid="queue-drawer"
      className="flex flex-col h-full bg-surface text-primary overflow-hidden"
    >
      {/* Pinned Top Section: Now Playing + Next Up Header */}
      <div className="px-3.5 pt-3.5 pb-2 flex flex-col gap-3.5 shrink-0">
        {currentTrack && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold text-muted uppercase tracking-wider px-0.5">
              Now Playing
            </span>
            <div
              onClick={togglePlay}
              className="group flex items-center gap-3 p-2.5 rounded-xl bg-elevated border border-customBorder hover:border-accent/40 transition-all cursor-pointer shadow-sm"
            >
              <div className="relative w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-highlight shadow-sm">
                <img
                  src={getTrackArtwork(currentTrack)}
                  alt={currentTrack.title}
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (target.src !== FALLBACK_ARTWORK) {
                      target.src = FALLBACK_ARTWORK;
                      resolveTrackArtwork(currentTrack.artist, currentTrack.title).then((url) => {
                        if (url && !isUglyPlaceholder(url)) target.src = url;
                      });
                    }
                  }}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  {isPlaying ? (
                    <Pause size={16} className="text-white fill-white" />
                  ) : (
                    <Play size={16} className="text-white fill-white ml-0.5" />
                  )}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold truncate text-accent leading-tight">
                  {currentTrack.title}
                </p>
                <p
                  onClick={(e) => {
                    e.stopPropagation();
                    navigateToArtist(currentTrack.artist);
                  }}
                  className="text-xs text-secondary truncate hover:underline hover:text-primary cursor-pointer transition-colors mt-0.5"
                >
                  {currentTrack.artist}
                </p>
              </div>

              {/* Equalizer Playing Indicator */}
              <div
                className="flex items-end gap-[2.5px] h-3.5 px-1 shrink-0"
                title={isPlaying ? 'Playing' : 'Paused'}
              >
                <span
                  className="w-[2.5px] bg-accent rounded-full origin-bottom transition-transform"
                  style={{
                    height: '100%',
                    animation: isPlaying ? 'eq-bar 0.8s ease-in-out infinite' : 'none',
                    transform: isPlaying ? undefined : 'scaleY(0.35)',
                  }}
                />
                <span
                  className="w-[2.5px] bg-accent rounded-full origin-bottom transition-transform"
                  style={{
                    height: '100%',
                    animation: isPlaying ? 'eq-bar 0.6s ease-in-out infinite 0.2s' : 'none',
                    transform: isPlaying ? undefined : 'scaleY(0.65)',
                  }}
                />
                <span
                  className="w-[2.5px] bg-accent rounded-full origin-bottom transition-transform"
                  style={{
                    height: '100%',
                    animation: isPlaying ? 'eq-bar 0.9s ease-in-out infinite 0.4s' : 'none',
                    transform: isPlaying ? undefined : 'scaleY(0.45)',
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Next Up Section Header & Inline Controls */}
        <div className="flex items-center justify-between pt-0.5 px-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-muted uppercase tracking-wider">
              Next Up
            </span>
            {upcomingItems.length > 0 && (
              <span className="text-[11px] font-mono text-muted">
                ({upcomingItems.length})
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              role="switch"
              aria-checked={autoplayEnabled}
              data-testid="autoplay-toggle-btn"
              onClick={() => enableAutoplay(!autoplayEnabled)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-all border ${
                autoplayEnabled
                  ? 'bg-accent/15 text-accent border-accent/30'
                  : 'text-muted hover:text-secondary border-transparent hover:bg-elevated'
              }`}
              title={
                autoplayEnabled
                  ? 'Autoplay on: similar tracks play when queue ends'
                  : 'Autoplay off'
              }
            >
              <Sparkles size={11} />
              <span>Autoplay</span>
            </button>

            {canClear && (
              <button
                data-testid="clear-queue-btn"
                onClick={clearQueue}
                className="text-[11px] font-medium text-secondary hover:text-red-400 transition-colors px-2 py-0.5 rounded-md hover:bg-elevated"
                title="Clear upcoming tracks"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable Upcoming List */}
      <div className="flex-1 overflow-y-auto px-2.5 pb-4 min-h-0">
        {upcomingItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-10 text-muted">
            {autoplayEnabled && currentTrack ? (
              <>
                <Sparkles size={22} className="text-accent/60 mb-2" />
                <p className="text-xs font-medium text-secondary">No upcoming tracks</p>
                <p className="text-[11px] text-muted mt-1 max-w-[200px]">
                  Similar tracks will play automatically when this song ends
                </p>
              </>
            ) : (
              <>
                <ListMusic size={24} className="opacity-30 mb-2" />
                <p className="text-xs font-medium text-secondary">No upcoming tracks</p>
                <p className="text-[11px] text-muted mt-1 max-w-[200px]">
                  Add songs from any album, playlist, or search
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {upcomingItems.map(({ track, queueIndex }, displayIdx) => {
              const isDragged = draggedQueueIndex === queueIndex;
              const isDragOver = dragOverQueueIndex === queueIndex;
              const durationText = formatDuration(track.duration);

              return (
                <div
                  key={`${track.id}-${queueIndex}`}
                  data-testid={`queue-item-${displayIdx}`}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, queueIndex)}
                  onDragOver={(e) => handleDragOver(e, queueIndex)}
                  onDrop={(e) => handleDrop(e, queueIndex)}
                  onDragEnd={handleDragEnd}
                  onClick={() => playTrack(track, queue, queueIndex)}
                  className={`group flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-all cursor-pointer select-none border ${
                    isDragOver
                      ? 'border-accent bg-elevated'
                      : isDragged
                      ? 'opacity-40 border-dashed border-customBorder'
                      : 'border-transparent hover:bg-elevated/80'
                  }`}
                >
                  {/* Subtle Drag Handle */}
                  <span
                    onClick={(e) => e.stopPropagation()}
                    className="cursor-grab active:cursor-grabbing text-muted/40 group-hover:text-secondary transition-colors shrink-0"
                    title="Drag to reorder"
                  >
                    <GripVertical size={14} />
                  </span>

                  {/* Artwork with Hover Play Overlay */}
                  <div className="relative w-9 h-9 rounded-md overflow-hidden shrink-0 bg-highlight">
                    <img
                      src={getTrackArtwork(track)}
                      alt={track.title}
                      onError={(e) => {
                        const target = e.currentTarget;
                        if (target.src !== FALLBACK_ARTWORK) {
                          target.src = FALLBACK_ARTWORK;
                          resolveTrackArtwork(track.artist, track.title).then((url) => {
                            if (url && !isUglyPlaceholder(url)) target.src = url;
                          });
                        }
                      }}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Play size={13} className="text-white fill-white ml-0.5" />
                    </div>
                  </div>

                  {/* Track Title & Artist */}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-primary truncate leading-snug">
                      {track.title}
                    </p>
                    <p
                      onClick={(e) => {
                        e.stopPropagation();
                        navigateToArtist(track.artist);
                      }}
                      className="text-[11px] text-secondary truncate hover:underline hover:text-primary transition-colors leading-snug"
                    >
                      {track.artist}
                    </p>
                  </div>

                  {/* Duration (default) / Remove Button (hover) */}
                  <div className="flex items-center justify-end shrink-0 min-w-[28px]">
                    {durationText && (
                      <span className="text-[11px] font-mono text-muted group-hover:hidden">
                        {durationText}
                      </span>
                    )}
                    <button
                      data-testid={`remove-queue-item-${displayIdx}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromQueue(queueIndex);
                      }}
                      className={`${
                        durationText ? 'hidden group-hover:flex' : 'opacity-0 group-hover:opacity-100 flex'
                      } items-center justify-center p-1 text-muted hover:text-red-400 transition-colors rounded-md hover:bg-highlight`}
                      title="Remove from queue"
                      aria-label={`Remove ${track.title} from queue`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

