import React, { useRef, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { audioEngine } from '../../audio/audioEngine';
import { useSmoothSeekbar } from '../../hooks/useSmoothSeekbar';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Heart,
  ListMusic,
  Sliders,
  Radio,
} from 'lucide-react';
import { ActiveDeviceBadge } from '../connect/ActiveDeviceBadge';
import { DeviceIcon } from '../connect/DeviceIcon';
import { VisualizerIcon } from '../common/VisualizerIcon';
import {
  getTrackArtwork,
  resolveTrackArtwork,
  DEFAULT_MUSIC_ARTWORK,
  isUglyPlaceholder,
} from '../../services/artworkService';
import { SaveMp3Button } from '../common/SaveMp3Button';
import { VibeDjBadge } from '../player/VibeDjBadge';

export const PlayerBar: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    isBuffering,
    togglePlay,
    nextTrack,
    previousTrack,
    volume,
    setVolume,
    repeatMode,
    setRepeatMode,
    shuffle,
    toggleShuffle,
    toggleLike,
    isLiked,
    isRightDrawerOpen,
    rightDrawerTab,
    toggleRightDrawer,
    isVisualizerOpen,
    toggleVisualizer,
    navigateToArtist,
    connectMode,
    activeDevice,
    toggleDevicePicker,
  } = usePlayerStore();

  const displayTrack = currentTrack || audioEngine.getCurrentTrack();

  const [isMuted, setIsMuted] = useState(false);
  const prevVolumeRef = useRef(volume);

  const {
    seekbarRef,
    currentTimeRef,
    totalDurationRef,
    artworkRef,
    trackMetaRef,
    handleSeekInput,
    handleSeekChange,
  } = useSmoothSeekbar({ track: displayTrack, isActive: true });

  const handleToggleMute = () => {
    if (isMuted) {
      setVolume(prevVolumeRef.current || 0.8);
      setIsMuted(false);
    } else {
      prevVolumeRef.current = volume;
      setVolume(0);
      setIsMuted(true);
    }
  };

  const cycleRepeat = () => {
    if (repeatMode === 'off') setRepeatMode('all');
    else if (repeatMode === 'all') setRepeatMode('one');
    else setRepeatMode('off');
  };

  if (!displayTrack) return null;

  return (
    <footer
      data-testid="player-bar"
      className="hidden md:grid grid-cols-3 items-center h-20 bg-playerBg border-t border-customBorder px-4 z-30 select-none"
    >
      {/* Left: Track info */}
      <div className="flex items-center gap-3.5 min-w-0 pr-4">
        {displayTrack ? (
          <>
            <img
              ref={artworkRef}
              src={getTrackArtwork(displayTrack)}
              alt={displayTrack.title}
              className="w-14 h-14 rounded-md object-cover shadow-md flex-shrink-0 will-change-transform"
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
            <div ref={trackMetaRef} className="flex flex-col min-w-0 will-change-transform">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-primary truncate hover:underline cursor-pointer">
                  {displayTrack.title}
                </span>
              </div>
              <span
                onClick={() => navigateToArtist(displayTrack.artist)}
                className="text-xs text-secondary truncate hover:underline hover:text-primary cursor-pointer transition-colors"
              >
                {displayTrack.artist}
              </span>
            </div>

            <button
              onClick={() => toggleLike(displayTrack)}
              data-testid="like-btn"
              aria-label="Like"
              className="ml-2 text-secondary hover:text-accent transition-colors p-1"
              title={isLiked(displayTrack.id) ? 'Unlike' : 'Like'}
            >
              <Heart
                size={18}
                className={isLiked(displayTrack.id) ? 'text-accent fill-accent' : ''}
              />
            </button>

            <SaveMp3Button track={displayTrack} size={17} />
            <VibeDjBadge compact={false} />
          </>
        ) : (
          <div className="flex items-center gap-3 text-muted text-xs">
            <div className="w-14 h-14 rounded-md bg-elevated/40 flex items-center justify-center">
              <Radio size={20} className="opacity-30" />
            </div>
            <span>No track playing</span>
          </div>
        )}
      </div>

      {/* Center: Transport & Smooth 60fps Seekbar */}
      <div className="flex flex-col items-center justify-center max-w-xl w-full mx-auto">
        {/* Buttons */}
        <div className="flex items-center gap-4 mb-1.5">
          <button
            onClick={toggleShuffle}
            data-testid="shuffle-btn"
            aria-label="Shuffle"
            aria-pressed={shuffle}
            className={`p-1.5 rounded-full transition-colors ${
              shuffle ? 'text-accent' : 'text-secondary hover:text-primary'
            }`}
            title={shuffle ? 'Shuffle On' : 'Shuffle Off'}
          >
            <Shuffle size={16} />
          </button>

          <button
            onClick={previousTrack}
            data-testid="prev-track-btn"
            aria-label="Previous"
            className="text-secondary hover:text-primary transition-colors"
            title="Previous track"
          >
            <SkipBack size={20} />
          </button>

          <button
            onClick={togglePlay}
            data-testid="play-btn"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="w-9 h-9 rounded-full bg-accent text-accent-content flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-md"
          >
            {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
          </button>

          <button
            onClick={nextTrack}
            data-testid="next-track-btn"
            aria-label="Next"
            className="text-secondary hover:text-primary transition-colors"
            title="Next track"
          >
            <SkipForward size={20} />
          </button>

          <button
            onClick={cycleRepeat}
            data-testid="repeat-btn"
            aria-label={`Repeat: ${repeatMode}`}
            className={`p-1.5 rounded-full transition-colors ${
              repeatMode !== 'off' ? 'text-accent' : 'text-secondary hover:text-primary'
            }`}
            title={`Repeat: ${repeatMode}`}
          >
            {repeatMode === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </button>
        </div>

        {/* Seekbar Container */}
        <div className="flex items-center gap-2 w-full">
          <span
            ref={currentTimeRef}
            data-testid="current-time"
            className="text-[11px] font-mono text-muted w-10 text-right tabular-nums"
          >
            0:00
          </span>

          <div className="relative flex-1 flex items-center">
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
              onInput={handleSeekInput}
              onChange={handleSeekChange}
              data-testid="player-seekbar"
              className="seekbar w-full h-1 rounded-none appearance-none cursor-pointer hover:h-1.5 transition-[height]"
            />
            {isBuffering && (
              <div className="pointer-events-none absolute inset-x-0 h-1 overflow-hidden">
                <div className="seekbar-shimmer h-full w-1/3" />
              </div>
            )}
          </div>

          <span
            ref={totalDurationRef}
            data-testid="total-duration"
            className="text-[11px] font-mono text-muted w-10 text-left tabular-nums"
          >
            0:00
          </span>
        </div>
      </div>

      {/* Right: Extra controls (Visualizer, Queue, Equalizer, Volume) */}
      <div className="flex items-center justify-end gap-3 pl-4">
        <button
          onClick={() => toggleVisualizer()}
          className={`p-1.5 rounded transition-colors cursor-pointer ${
            isVisualizerOpen
              ? 'text-accent bg-elevated'
              : 'text-secondary hover:text-primary'
          }`}
          title="Audio Spectrum & Nebula Visualizer"
          aria-label="Audio Visualizer"
        >
          <VisualizerIcon size={18} />
        </button>

        <button
          onClick={() => toggleRightDrawer('queue')}
          data-testid="toggle-queue"
          aria-label="Queue"
          className={`p-1.5 rounded transition-colors ${
            isRightDrawerOpen && rightDrawerTab === 'queue'
              ? 'text-accent bg-elevated'
              : 'text-secondary hover:text-primary'
          }`}
          title="Play Queue"
        >
          <ListMusic size={18} />
        </button>

        <button
          onClick={() => toggleRightDrawer('equalizer')}
          data-testid="open-equalizer-btn"
          aria-label="Equalizer"
          className={`p-1.5 rounded transition-colors ${
            isRightDrawerOpen && rightDrawerTab === 'equalizer'
              ? 'text-accent bg-elevated'
              : 'text-secondary hover:text-primary'
          }`}
          title="10-Band Equalizer"
        >
          <Sliders size={18} />
        </button>

        {/* Connect to a Device (Spotify Connect) */}
        <div className="flex items-center gap-2">
          <ActiveDeviceBadge compact={false} />
          <button
            onClick={() => toggleDevicePicker()}
            data-testid="device-picker-btn"
            aria-label="Connect to a device"
            className={`p-1.5 rounded transition-colors ${
              connectMode === 'remote_controller'
                ? 'text-accent hover:text-accent/80'
                : 'text-secondary hover:text-primary'
            }`}
            title={connectMode === 'remote_controller' ? `Listening on ${activeDevice?.deviceName || 'remote device'}` : 'Connect to a device'}
          >
            <DeviceIcon type={activeDevice?.deviceType || 'desktop'} size={18} />
          </button>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-2 w-28 ml-2">
          <button
            onClick={handleToggleMute}
            className="text-secondary hover:text-primary transition-colors"
          >
            {volume === 0 || isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
            value={isMuted ? 0 : volume}
            style={{
              background: `linear-gradient(to right, #ffffff 0%, #ffffff ${(isMuted ? 0 : volume) * 100}%, rgba(255, 255, 255, 0.2) ${(isMuted ? 0 : volume) * 100}%, rgba(255, 255, 255, 0.2) 100%)`,
            }}
            onChange={(e) => {
              setIsMuted(false);
              setVolume(parseFloat(e.target.value));
            }}
            className="w-full h-1 rounded-none appearance-none cursor-pointer hover:h-1.5 transition-all"
          />
        </div>
      </div>
    </footer>
  );
};
