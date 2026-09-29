import React from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { audioEngine } from '../../audio/audioEngine';
import { useSmoothSeekbar } from '../../hooks/useSmoothSeekbar';
import { Play, Pause, Heart } from 'lucide-react';
import { DeviceIcon } from '../connect/DeviceIcon';
import {
  getTrackArtwork,
  resolveTrackArtwork,
  DEFAULT_MUSIC_ARTWORK,
  isUglyPlaceholder,
} from '../../services/artworkService';

export const MobileMiniPlayer: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    togglePlay,
    toggleLike,
    isLiked,
    toggleMobileSheet,
    navigateToArtist,
    connectMode,
    activeDevice,
    toggleDevicePicker,
  } = usePlayerStore();

  const displayTrack = currentTrack || audioEngine.getCurrentTrack();

  const { miniProgressRef, artworkRef, trackMetaRef } = useSmoothSeekbar({
    track: displayTrack,
    isActive: true,
  });

  if (!displayTrack) return null;

  return (
    <div
      data-testid="mini-player"
      onClick={() => toggleMobileSheet(true)}
      className="mobile-player md:hidden fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] left-2 right-2 h-14 bg-elevated/95 backdrop-blur-md rounded-xl border border-customBorder shadow-2xl flex items-center justify-between px-3 z-30 cursor-pointer overflow-hidden select-none transition-all active:scale-[0.99]"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <img
          ref={artworkRef}
          src={getTrackArtwork(displayTrack)}
          alt={displayTrack.title}
          className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
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
        <div ref={trackMetaRef} className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-primary truncate">{displayTrack.title}</p>
          {connectMode === 'remote_controller' ? (
            <p className="text-[10px] text-accent flex items-center gap-1 font-semibold truncate">
              <DeviceIcon type={activeDevice?.deviceType || 'desktop'} size={11} className="text-accent" />
              <span>Listening on {activeDevice?.deviceName || 'Remote Device'}</span>
            </p>
          ) : (
            <p
              onClick={(e) => {
                e.stopPropagation();
                navigateToArtist(displayTrack.artist);
              }}
              className="text-[11px] text-secondary truncate hover:underline hover:text-primary cursor-pointer transition-colors"
            >
              {displayTrack.artist}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 pl-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleDevicePicker(true);
          }}
          data-testid="mini-device-picker-btn"
          aria-label="Connect to a device"
          className={`p-1.5 transition-colors ${
            connectMode === 'remote_controller' ? 'text-accent' : 'text-secondary hover:text-primary'
          }`}
          title="Connect to a device"
        >
          <DeviceIcon type={activeDevice?.deviceType || 'desktop'} size={16} />
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleLike(displayTrack);
          }}
          className="p-1.5 text-secondary hover:text-accent transition-colors"
        >
          <Heart
            size={18}
            className={isLiked(displayTrack.id) ? 'text-accent fill-accent' : ''}
          />
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
          className="w-9 h-9 rounded-full bg-accent text-accent-content flex items-center justify-center transition-transform active:scale-95 shadow"
        >
          {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
        </button>
      </div>

      {/* Thin playback progress line at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-highlight">
        <div ref={miniProgressRef} className="h-full bg-accent w-0" />
      </div>
    </div>
  );
};
