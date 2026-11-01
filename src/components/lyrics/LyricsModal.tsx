import React, { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { audioEngine } from '../../audio/audioEngine';
import { useSmoothSeekbar } from '../../hooks/useSmoothSeekbar';
import { LyricsViewer } from './LyricsViewer';
import {
  X,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Mic2,
} from 'lucide-react';
import {
  getTrackArtwork,
  resolveTrackArtwork,
  DEFAULT_MUSIC_ARTWORK,
  isUglyPlaceholder,
} from '../../services/artworkService';

export const LyricsModal: React.FC = () => {
  const {
    isLyricsModalOpen,
    toggleLyricsModal,
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
    navigateToArtist,
  } = usePlayerStore();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const prevVolumeRef = useRef(volume);

  const displayTrack = currentTrack || audioEngine.getCurrentTrack();

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
    isActive: isLyricsModalOpen,
  });

  const cycleRepeat = () => {
    if (repeatMode === 'off') setRepeatMode('all');
    else if (repeatMode === 'all') setRepeatMode('one');
    else setRepeatMode('off');
  };

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

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Close on Escape key
  useEffect(() => {
    if (!isLyricsModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        toggleLyricsModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLyricsModalOpen, toggleLyricsModal]);

  if (!isLyricsModalOpen || !displayTrack) return null;

  const artworkUrl = getTrackArtwork(displayTrack);

  return (
    <div
      data-testid="lyrics-modal"
      className="fixed inset-0 z-50 flex flex-col bg-base text-primary select-none animate-in fade-in duration-200"
    >
      {/* Dynamic Ambient Frosted Glass Background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-25 filter blur-[120px] scale-125 transition-all duration-1000 bg-cover bg-center"
        style={{
          backgroundImage: `url(${artworkUrl})`,
        }}
      />
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-base/80 via-base/90 to-base" />

      {/* Top Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-customBorder/30 backdrop-blur-md">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-xl overflow-hidden shadow-lg border border-customBorder/60 shrink-0">
            <img
              ref={artworkRef}
              src={artworkUrl}
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
          <div className="min-w-0">
            <h2 className="text-base font-bold text-primary truncate leading-tight">
              {displayTrack.title}
            </h2>
            <button
              onClick={() => {
                toggleLyricsModal(false);
                navigateToArtist(displayTrack.artist);
              }}
              className="text-xs text-secondary hover:text-accent transition-colors truncate mt-0.5"
            >
              {displayTrack.artist}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-xl text-secondary hover:text-primary hover:bg-highlight transition-colors"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button
            onClick={() => toggleLyricsModal(false)}
            data-testid="close-lyrics-modal"
            className="p-2 rounded-xl text-secondary hover:text-primary hover:bg-highlight transition-colors"
            title="Close Lyrics (Esc)"
          >
            <X size={20} />
          </button>
        </div>
      </header>

      {/* Main Lyric Stage */}
      <main className="relative z-10 flex-1 overflow-hidden">
        <LyricsViewer compact={false} className="h-full" />
      </main>

      {/* Bottom Player Controls */}
      <footer className="relative z-10 px-6 py-3 border-t border-customBorder/30 bg-surface/40 backdrop-blur-md flex flex-col gap-2">
        {/* Scrubber */}
        <div className="flex items-center gap-3 w-full max-w-3xl mx-auto">
          <span
            ref={currentTimeRef}
            className="text-[11px] font-mono text-muted w-10 text-right tabular-nums"
          >
            0:00
          </span>
          <div className="relative flex-1 flex items-center group">
            <input
              ref={seekbarRef}
              type="range"
              min="0"
              max="100"
              step="0.05"
              defaultValue="0"
              onInput={handleSeekInput}
              onChange={handleSeekChange}
              className="seekbar w-full h-1 rounded-none appearance-none cursor-pointer group-hover:h-1.5 transition-[height]"
            />
          </div>
          <span
            ref={totalDurationRef}
            className="text-[11px] font-mono text-muted w-10 text-left tabular-nums"
          >
            0:00
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between w-full max-w-3xl mx-auto">
          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleLike(displayTrack)}
              className={`p-2 rounded-lg transition-colors ${
                isLiked(displayTrack.id) ? 'text-accent' : 'text-secondary hover:text-primary'
              }`}
              title="Like song"
            >
              <Heart size={18} fill={isLiked(displayTrack.id) ? 'currentColor' : 'none'} />
            </button>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={toggleShuffle}
              className={`p-2 rounded-lg transition-colors ${
                shuffle ? 'text-accent' : 'text-secondary hover:text-primary'
              }`}
              title="Shuffle"
            >
              <Shuffle size={18} />
            </button>

            <button
              onClick={previousTrack}
              className="p-2 rounded-lg text-secondary hover:text-primary transition-colors"
              title="Previous Track"
            >
              <SkipBack size={20} />
            </button>

            <button
              onClick={togglePlay}
              className="w-11 h-11 rounded-full bg-accent text-accent-content flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-lg"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
            </button>

            <button
              onClick={nextTrack}
              className="p-2 rounded-lg text-secondary hover:text-primary transition-colors"
              title="Next Track"
            >
              <SkipForward size={20} />
            </button>

            <button
              onClick={cycleRepeat}
              className={`p-2 rounded-lg transition-colors ${
                repeatMode !== 'off' ? 'text-accent' : 'text-secondary hover:text-primary'
              }`}
              title={`Repeat: ${repeatMode}`}
            >
              {repeatMode === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
            </button>
          </div>

          <div className="flex items-center gap-2 w-28">
            <button onClick={handleToggleMute} className="text-secondary hover:text-primary">
              {volume === 0 || isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                setIsMuted(false);
                setVolume(parseFloat(e.target.value));
              }}
              className="w-full h-1 rounded-none appearance-none cursor-pointer"
            />
          </div>
        </div>
      </footer>
    </div>
  );
};
