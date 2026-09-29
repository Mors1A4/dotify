import React, { useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { audioEngine } from '../../audio/audioEngine';
import { useSmoothSeekbar } from '../../hooks/useSmoothSeekbar';
import { VisualizerCanvas } from './VisualizerCanvas';
import { EqualizerDrawer } from './EqualizerDrawer';
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  Sliders,
  Share2,
  Volume2,
  ListMusic,
  Trash2,
} from 'lucide-react';
import { DeviceIcon } from '../connect/DeviceIcon';
import { VisualizerIcon } from '../common/VisualizerIcon';
import {
  getTrackArtwork,
  resolveTrackArtwork,
  DEFAULT_MUSIC_ARTWORK,
  isUglyPlaceholder,
} from '../../services/artworkService';

export const MobileNowPlayingSheet: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    isBuffering,
    togglePlay,
    nextTrack,
    previousTrack,
    repeatMode,
    setRepeatMode,
    shuffle,
    toggleShuffle,
    toggleLike,
    isLiked,
    volume,
    setVolume,
    isMobileSheetOpen,
    toggleMobileSheet,
    navigateToArtist,
    connectMode,
    activeDevice,
    toggleDevicePicker,
    queue,
    currentTrackIndex,
    playTrack,
    removeFromQueue,
    clearQueue,
  } = usePlayerStore();

  const displayTrack = currentTrack || audioEngine.getCurrentTrack();

  const [sheetTab, setSheetTab] = useState<'art' | 'visualizer' | 'equalizer'>('art');

  const {
    seekbarRef,
    currentTimeRef,
    totalDurationRef,
    artworkRef,
    trackMetaRef,
    handleSeekInput,
    handleSeekChange,
  } = useSmoothSeekbar({
    track: displayTrack,
    isActive: isMobileSheetOpen,
  });

  if (!isMobileSheetOpen || !displayTrack) return null;

  const cycleRepeat = () => {
    if (repeatMode === 'off') setRepeatMode('all');
    else if (repeatMode === 'all') setRepeatMode('one');
    else setRepeatMode('off');
  };

  return (
    <div
      data-testid="now-playing-sheet"
      className="md:hidden fixed inset-0 bg-base/98 backdrop-blur-2xl z-50 flex flex-col p-6 safe-pb transition-all duration-300 animate-in slide-in-from-bottom overflow-y-auto"
    >
      {/* Sheet Top Bar */}
      <div className="flex items-center justify-between h-12 mb-4 shrink-0">
        <button
          onClick={() => toggleMobileSheet(false)}
          data-testid="dismiss-sheet-btn"
          aria-label="Close sheet"
          className="p-2 -ml-2 rounded-full text-secondary hover:text-primary transition-colors"
        >
          <ChevronDown size={28} />
        </button>

        <span className="text-xs uppercase font-bold tracking-widest text-muted truncate max-w-[200px]">
          {displayTrack.album || displayTrack.artist || 'Now Playing'}
        </span>

        <button
          onClick={() => {
            if (navigator.share) {
              navigator.share({ title: displayTrack.title, text: `Listening to ${displayTrack.title} on dotify` }).catch(() => {});
            }
          }}
          className="p-2 -mr-2 rounded-full text-secondary hover:text-primary transition-colors"
        >
          <Share2 size={20} />
        </button>
      </div>

      {/* Main Viewport: Large Art, Visualizer, or EQ */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-[280px] shrink-0 my-2">
        {sheetTab === 'art' && (
          <div className="w-full max-w-xs aspect-square rounded-2xl overflow-hidden shadow-2xl border border-customBorder relative group">
            <img
              ref={artworkRef}
              src={getTrackArtwork(displayTrack)}
              alt={displayTrack.title}
              className="w-full h-full object-cover"
              onError={(e) => {
                const target = e.currentTarget;
                if (target.src !== DEFAULT_MUSIC_ARTWORK) {
                  target.src = DEFAULT_MUSIC_ARTWORK;
                  resolveTrackArtwork(displayTrack.artist, displayTrack.title).then((url) => {
                    if (url && !isUglyPlaceholder(url)) target.src = url;
                  });
                }
              }}
            />
          </div>
        )}

        {sheetTab === 'visualizer' && (
          <div className="w-full flex-1 flex items-center justify-center">
            <VisualizerCanvas className="w-full max-w-sm" />
          </div>
        )}

        {sheetTab === 'equalizer' && (
          <div className="w-full flex-1 overflow-y-auto max-w-sm rounded-xl">
            <EqualizerDrawer />
          </div>
        )}

        {/* View Switcher Chips */}
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => setSheetTab('art')}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
              sheetTab === 'art' ? 'bg-accent text-accent-content' : 'bg-elevated text-secondary'
            }`}
          >
            Artwork
          </button>
          <button
            onClick={() => setSheetTab('visualizer')}
            className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all ${
              sheetTab === 'visualizer' ? 'bg-accent text-accent-content' : 'bg-elevated text-secondary'
            }`}
          >
            <VisualizerIcon size={13} accentHighlight={sheetTab !== 'visualizer'} />
            <span>Visualizer</span>
          </button>
          <button
            onClick={() => setSheetTab('equalizer')}
            className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 transition-all ${
              sheetTab === 'equalizer' ? 'bg-accent text-accent-content' : 'bg-elevated text-secondary'
            }`}
          >
            <Sliders size={13} />
            <span>EQ</span>
          </button>
        </div>
      </div>

      {/* Track Metadata & Heart */}
      <div className="flex items-center justify-between mb-4 mt-2">
        <div ref={trackMetaRef} className="min-w-0 flex-1 pr-4">
          <h2 data-testid="sheet-track-title" className="text-xl font-bold text-primary truncate">
            {displayTrack.title}
          </h2>
          <p
            data-testid="sheet-track-artist"
            onClick={() => {
              navigateToArtist(displayTrack.artist);
              toggleMobileSheet(false);
            }}
            className="text-sm text-secondary truncate mt-0.5 hover:underline hover:text-primary cursor-pointer transition-colors"
          >
            {displayTrack.artist}
          </p>
        </div>

        <button
          onClick={() => toggleLike(displayTrack)}
          className="p-2 text-secondary hover:text-accent transition-colors"
        >
          <Heart
            size={24}
            className={isLiked(displayTrack.id) ? 'text-accent fill-accent' : ''}
          />
        </button>
      </div>

      {/* Scrubber */}
      <div className="flex flex-col gap-1 mb-6">
        <div className="relative w-full flex items-center">
          <input
            ref={seekbarRef}
            type="range"
            min="0"
            max="500"
            step="any"
            defaultValue="0"
            style={{
              background: 'linear-gradient(to right, #ffffff 0%, #ffffff 0%, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0.2) 100%)',
            }}
            data-testid="sheet-seekbar"
            disabled={displayTrack.duration === Infinity}
            onInput={handleSeekInput}
            onChange={handleSeekChange}
            className="w-full h-1 rounded-none appearance-none cursor-pointer"
          />
          {isBuffering && (
            <div
              aria-hidden="true"
              className="seekbar-shimmer pointer-events-none absolute inset-x-0 h-1 overflow-hidden"
            />
          )}
        </div>

        <div className="flex justify-between text-xs font-mono text-muted mt-1">
          <span ref={currentTimeRef}>0:00</span>
          <span ref={totalDurationRef}>0:00</span>
        </div>
      </div>

      {/* Full Playback Transport */}
      <div className="flex items-center justify-between px-4 mb-2">
        <button
          onClick={toggleShuffle}
          data-testid="sheet-shuffle-btn"
          aria-label="Shuffle"
          aria-pressed={shuffle}
          className={`p-2 rounded-full transition-colors ${
            shuffle ? 'text-accent' : 'text-secondary'
          }`}
        >
          <Shuffle size={20} />
        </button>

        <button
          onClick={previousTrack}
          data-testid="sheet-prev-btn"
          aria-label="Previous"
          className="text-primary p-2 active:scale-90 transition-transform"
        >
          <SkipBack size={28} />
        </button>

        <button
          onClick={togglePlay}
          data-testid="sheet-play-btn"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="w-16 h-16 rounded-full bg-accent text-accent-content flex items-center justify-center shadow-xl hover:scale-105 active:scale-95 transition-all"
        >
          {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />}
        </button>

        <button
          onClick={nextTrack}
          data-testid="sheet-next-btn"
          aria-label="Next"
          className="text-primary p-2 active:scale-90 transition-transform"
        >
          <SkipForward size={28} />
        </button>

        <button
          onClick={cycleRepeat}
          data-testid="sheet-repeat-btn"
          aria-label={`Repeat: ${repeatMode}`}
          className={`p-2 rounded-full transition-colors ${
            repeatMode !== 'off' ? 'text-accent' : 'text-secondary'
          }`}
        >
          {repeatMode === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
        </button>
      </div>

      {/* Connect to a Device Row (Touch-friendly >= 48px tap target) */}
      <button
        onClick={() => toggleDevicePicker(true)}
        data-testid="sheet-device-picker-btn"
        className="flex items-center justify-between w-full py-2.5 px-4 rounded-xl bg-elevated/70 border border-customBorder hover:border-accent/40 transition-all mt-4 mb-1 min-h-[48px] select-none"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <DeviceIcon
            type={activeDevice?.deviceType || 'desktop'}
            size={18}
            className={connectMode === 'remote_controller' ? 'text-accent' : 'text-secondary'}
          />
          <div className="text-left min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted font-bold">Current Device</p>
            <p className={`text-xs font-semibold truncate ${connectMode === 'remote_controller' ? 'text-accent' : 'text-primary'}`}>
              {connectMode === 'remote_controller' ? `Listening on ${activeDevice?.deviceName || 'Remote Device'}` : 'Listening on This Device'}
            </p>
          </div>
        </div>
        <span className="text-xs text-accent font-medium px-2.5 py-1 rounded bg-accent/10 border border-accent/20">
          Change
        </span>
      </button>

      {/* Mobile Volume Control */}
      <div className="flex items-center gap-3 px-4 mt-3 shrink-0">
        <Volume2 size={16} className="text-secondary shrink-0" />
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          style={{
            background: `linear-gradient(to right, #ffffff 0%, #ffffff ${volume * 100}%, rgba(255, 255, 255, 0.2) ${volume * 100}%, rgba(255, 255, 255, 0.2) 100%)`,
          }}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="w-full h-1 rounded-none appearance-none cursor-pointer"
        />
      </div>

      {/* Up Next / Queue Section */}
      {(() => {
        const effectiveIdx =
          currentTrackIndex >= 0 &&
          currentTrackIndex < queue.length &&
          queue[currentTrackIndex]?.id === displayTrack.id
            ? currentTrackIndex
            : queue.findIndex((t) => t.id === displayTrack.id);

        const upcomingItems =
          effectiveIdx !== -1
            ? queue.slice(effectiveIdx + 1).map((track, offset) => ({
                track,
                queueIndex: effectiveIdx + 1 + offset,
              }))
            : queue
                .map((track, queueIndex) => ({ track, queueIndex }))
                .filter((item) => item.track.id !== displayTrack.id);

        return (
          <div className="mt-8 pt-5 border-t border-customBorder/60 flex flex-col gap-3 pb-8 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ListMusic className="text-accent" size={18} />
                <h3 className="font-bold text-sm text-primary">Up Next</h3>
                {upcomingItems.length > 0 && (
                  <span className="text-[11px] bg-elevated text-muted px-2 py-0.5 rounded-full font-mono">
                    {upcomingItems.length}
                  </span>
                )}
              </div>

              {upcomingItems.length > 0 && (
                <button
                  onClick={clearQueue}
                  className="text-xs text-secondary hover:text-red-400 flex items-center gap-1 transition-colors px-2 py-1 rounded hover:bg-elevated min-h-[36px]"
                  title="Clear upcoming tracks"
                >
                  <Trash2 size={13} />
                  <span>Clear</span>
                </button>
              )}
            </div>

            {upcomingItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center text-muted">
                <p className="text-xs text-secondary">No upcoming tracks</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {upcomingItems.map(({ track, queueIndex }) => (
                  <div
                    key={`${track.id}-${queueIndex}`}
                    onClick={() => playTrack(track, queue, queueIndex)}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-xl transition-all cursor-pointer select-none border border-customBorder/30 bg-surface/50 hover:bg-elevated min-h-[48px]"
                  >
                    <img
                      src={getTrackArtwork(track)}
                      alt={track.title}
                      className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-highlight"
                      onError={(e) => {
                        const target = e.currentTarget;
                        if (target.src !== DEFAULT_MUSIC_ARTWORK) {
                          target.src = DEFAULT_MUSIC_ARTWORK;
                          resolveTrackArtwork(track.artist, track.title).then((url) => {
                            if (url && !isUglyPlaceholder(url)) target.src = url;
                          });
                        }
                      }}
                    />

                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate text-primary">
                        {track.title}
                      </p>
                      <p className="text-[11px] text-secondary truncate mt-0.5">
                        {track.artist}
                      </p>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromQueue(queueIndex);
                      }}
                      className="p-2 text-muted hover:text-red-400 active:scale-95 transition-all rounded-lg shrink-0 min-h-[40px] min-w-[40px] flex items-center justify-center"
                      title="Remove from queue"
                      aria-label={`Remove ${track.title} from queue`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
};

