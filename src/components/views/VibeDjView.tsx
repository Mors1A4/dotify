import React, { useEffect, useState } from 'react';
import { useVibeDjStore } from '../../store/vibeDjStore';
import { usePlayerStore } from '../../store/playerStore';
import {
  Sparkles,
  Disc3,
  Play,
  Pause,
  SkipForward,
  Radio,
  Sliders,
  CheckCircle2,
  XCircle,
  Repeat,
  Flame,
  Music2,
  Users,
  Compass,
  Zap,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';
import { getTrackArtwork, DEFAULT_MUSIC_ARTWORK } from '../../services/artworkService';
import { VibeDjArtistRecommendation, VibeDjTrackRecommendation } from '../../types/vibeDj';
import { FluidVibeDiscVisualizer } from '../common/FluidVibeDiscVisualizer';

export const VibeDjView: React.FC = () => {
  const {
    isActive,
    vibeLabel,
    vibeTagline,
    themeColor,
    themeGradient,
    accentColor,
    currentVector,
    djQueue,
    history,
    recommendedArtists,
    shakeCount,
    isShaking,
    isGenerating,
    statusMessage,
    startVibeDj,
    stopVibeDj,
    shakeUpVibe,
    playRecommendedArtist,
  } = useVibeDjStore();

  const {
    currentTrack,
    isPlaying,
    togglePlay,
    nextTrack,
    playTrack,
    navigateToArtist,
  } = usePlayerStore();

  const [hasStartedInitial, setHasStartedInitial] = useState(false);

  // If user opens Vibe DJ view and it's not active yet, offer 1-click launch or auto-start
  useEffect(() => {
    if (!isActive && !hasStartedInitial) {
      setHasStartedInitial(true);
      startVibeDj();
    }
  }, [isActive, hasStartedInitial, startVibeDj]);

  const displayTrack = currentTrack;
  const currentArtwork = displayTrack ? getTrackArtwork(displayTrack) : DEFAULT_MUSIC_ARTWORK;

  const energyPercent = Math.round(currentVector.energy * 100);
  const dancePercent = Math.round(currentVector.danceability * 100);
  const moodPercent = Math.round(currentVector.mood * 100);
  const acousticPercent = Math.round(currentVector.acousticness * 100);

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 pb-28 select-none">
      {/* Dynamic Background Glow */}
      <div
        className="fixed inset-0 pointer-events-none opacity-25 blur-3xl transition-all duration-1000"
        style={{
          background: `radial-gradient(circle at 50% 25%, ${accentColor} 0%, transparent 65%)`,
        }}
      />

      <div className="relative max-w-6xl mx-auto space-y-8">
        {/* DJ Master Hero Deck */}
        <div
          className={`relative rounded-3xl p-6 md:p-8 border shadow-2xl overflow-hidden bg-gradient-to-br ${themeGradient} transition-all duration-700`}
        >
          {/* Subtle vinyl groove background texture */}
          <div className="absolute -right-20 -bottom-20 w-96 h-96 rounded-full border border-white/5 opacity-40 pointer-events-none animate-[spin_60s_linear_infinite]" />
          <div className="absolute -right-10 -bottom-10 w-72 h-72 rounded-full border border-white/5 opacity-30 pointer-events-none animate-[spin_40s_linear_infinite]" />

          <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-8">
            {/* Left: Vibe Persona & Status */}
            <div className="flex-1 text-center lg:text-left space-y-3">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-xs font-semibold uppercase tracking-wider text-white shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Live AI DJ • Vibe</span>
                {shakeCount > 0 && (
                  <span className="text-white/60 font-normal">
                    (Shift #{shakeCount})
                  </span>
                )}
              </div>

              <div>
                <h1 className="text-3xl md:text-5xl font-black text-white tracking-tight drop-shadow-md">
                  {vibeLabel}
                </h1>
                <p className="text-sm md:text-base text-white/80 mt-1 max-w-xl font-medium">
                  {vibeTagline}
                </p>
              </div>

              {/* Status Notice */}
              {(isShaking || isGenerating || statusMessage) && (
                <div className="inline-flex items-center gap-2 text-xs font-medium text-amber-200 bg-amber-500/20 px-3 py-1 rounded-full border border-amber-500/30 animate-pulse">
                  <Sparkles size={12} className="animate-spin" />
                  <span>{statusMessage || 'Vibe is calibrating the flow...'}</span>
                </div>
              )}

              {/* Actions row: Shake Up button */}
              <div className="pt-2 flex flex-wrap items-center justify-center lg:justify-start gap-3">
                <button
                  onClick={shakeUpVibe}
                  disabled={isShaking}
                  className="group relative px-6 py-3.5 rounded-2xl bg-white text-slate-950 font-bold text-sm hover:scale-105 active:scale-95 transition-all duration-200 shadow-xl flex items-center gap-2.5 disabled:opacity-50 overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-amber-200 via-rose-200 to-purple-200 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <Sparkles
                    size={18}
                    className={`relative text-purple-600 transition-transform ${
                      isShaking ? 'animate-spin' : 'group-hover:rotate-45'
                    }`}
                  />
                  <span className="relative">Shake Up the Vibe</span>
                </button>

                {isActive ? (
                  <button
                    onClick={stopVibeDj}
                    className="px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white/90 text-xs font-semibold backdrop-blur-md border border-white/15 transition-colors"
                  >
                    Pause DJ Session
                  </button>
                ) : (
                  <button
                    onClick={() => startVibeDj()}
                    className="px-5 py-3 rounded-2xl bg-accent text-white text-xs font-bold transition-all shadow-lg hover:opacity-90 flex items-center gap-2"
                  >
                    <Play size={14} fill="currentColor" />
                    <span>Drop In</span>
                  </button>
                )}
              </div>
            </div>

            {/* Right: Fluid Audio-Reactive Disc Deck */}
            <div className="flex flex-col items-center">
              <div className="relative group flex items-center justify-center p-2">
                <FluidVibeDiscVisualizer
                  size={210}
                  themeColor={accentColor}
                  accentColor={accentColor}
                  className="drop-shadow-[0_0_35px_rgba(0,0,0,0.85)]"
                />

                {/* Center play/pause overlay on hover */}
                <button
                  onClick={togglePlay}
                  className="absolute inset-0 m-auto w-16 h-16 rounded-full flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-all backdrop-blur-xs text-white shadow-xl hover:scale-110 active:scale-95 z-20 cursor-pointer"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause size={30} fill="currentColor" />
                  ) : (
                    <Play size={30} fill="currentColor" className="ml-1" />
                  )}
                </button>
              </div>

              {/* Now playing subtitle */}
              {displayTrack && (
                <div className="mt-3 text-center max-w-[220px]">
                  <div className="text-sm font-bold text-white truncate hover:underline cursor-pointer">
                    {displayTrack.title}
                  </div>
                  <div
                    onClick={() => navigateToArtist(displayTrack.artist)}
                    className="text-xs text-white/70 truncate hover:text-white cursor-pointer transition-colors"
                  >
                    {displayTrack.artist}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Vibe Metrics Radar Bar */}
          <div className="mt-8 pt-6 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-black/25 backdrop-blur-md rounded-xl p-3 border border-white/5 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold text-white/70">
                <span className="flex items-center gap-1.5">
                  <Flame size={12} className="text-amber-400" />
                  <span>Energy</span>
                </span>
                <span className="text-white font-mono">{energyPercent}%</span>
              </div>
              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400 rounded-full transition-all duration-700"
                  style={{ width: `${energyPercent}%` }}
                />
              </div>
            </div>

            <div className="bg-black/25 backdrop-blur-md rounded-xl p-3 border border-white/5 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold text-white/70">
                <span className="flex items-center gap-1.5">
                  <Zap size={12} className="text-rose-400" />
                  <span>Dance</span>
                </span>
                <span className="text-white font-mono">{dancePercent}%</span>
              </div>
              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-rose-400 rounded-full transition-all duration-700"
                  style={{ width: `${dancePercent}%` }}
                />
              </div>
            </div>

            <div className="bg-black/25 backdrop-blur-md rounded-xl p-3 border border-white/5 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold text-white/70">
                <span className="flex items-center gap-1.5">
                  <TrendingUp size={12} className="text-blue-400" />
                  <span>Mood</span>
                </span>
                <span className="text-white font-mono">{moodPercent}%</span>
              </div>
              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-400 rounded-full transition-all duration-700"
                  style={{ width: `${moodPercent}%` }}
                />
              </div>
            </div>

            <div className="bg-black/25 backdrop-blur-md rounded-xl p-3 border border-white/5 space-y-1">
              <div className="flex items-center justify-between text-[11px] font-semibold text-white/70">
                <span className="flex items-center gap-1.5">
                  <Compass size={12} className="text-emerald-400" />
                  <span>Acoustic</span>
                </span>
                <span className="text-white font-mono">{acousticPercent}%</span>
              </div>
              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-400 rounded-full transition-all duration-700"
                  style={{ width: `${acousticPercent}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Section: Vibe's Recommended Artists */}
        {recommendedArtists.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg md:text-xl font-bold text-primary flex items-center gap-2">
                  <Users size={18} className="text-accent" />
                  <span>Artists Matching This Vibe</span>
                </h2>
                <p className="text-xs text-secondary mt-0.5">
                  Hand-picked pioneers and personal favorites aligning with this soundscape
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
              {recommendedArtists.map((artist) => (
                <div
                  key={artist.id}
                  onClick={() => playRecommendedArtist(artist)}
                  className="group p-3.5 rounded-2xl bg-surface border border-customBorder/60 hover:border-accent/60 hover:bg-elevated/70 transition-all duration-200 cursor-pointer flex flex-col items-center text-center shadow-sm relative overflow-hidden"
                >
                  <div className="relative w-20 h-20 rounded-full overflow-hidden mb-2.5 shadow-md group-hover:scale-105 transition-transform">
                    <img
                      src={artist.artworkUrl || DEFAULT_MUSIC_ARTWORK}
                      alt={artist.name}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                      <Play size={20} fill="currentColor" className="ml-0.5" />
                    </div>
                  </div>

                  <div className="text-xs font-bold text-primary truncate w-full group-hover:text-accent transition-colors">
                    {artist.name}
                  </div>
                  <div className="text-[10px] text-secondary/80 line-clamp-2 mt-1 leading-snug">
                    {artist.reason}
                  </div>

                  {artist.isFollowed && (
                    <span className="mt-2 text-[9px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                      Followed
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section: Up Next in the Mix & Sequential Stream */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Upcoming Tracks in Vibe Queue (2 cols) */}
          <div className="lg:col-span-2 space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base md:text-lg font-bold text-primary flex items-center gap-2">
                  <Sliders size={17} className="text-accent" />
                  <span>Up Next In Vibe's Flow ({djQueue.length})</span>
                </h2>
                <p className="text-xs text-secondary mt-0.5">
                  Sequential picks scored against your real-time listening reaction
                </p>
              </div>

              <button
                onClick={() => nextTrack()}
                className="text-xs font-semibold text-accent hover:underline flex items-center gap-1"
              >
                <span>Play Next</span>
                <ArrowRight size={13} />
              </button>
            </div>

            {djQueue.length === 0 ? (
              <div className="p-8 rounded-2xl bg-surface border border-customBorder/50 text-center text-secondary text-xs">
                Generating fresh recommendations for you...
              </div>
            ) : (
              <div className="space-y-2">
                {djQueue.map((item, index) => {
                  const art = getTrackArtwork(item.track);
                  return (
                    <div
                      key={`${item.track.id}_${index}`}
                      onClick={() => {
                        const queueTracks = djQueue.map((q) => q.track);
                        playTrack(item.track, queueTracks, index, {
                          origin: 'vibe_playlist',
                          intent: 'exploratory',
                          playlistName: vibeLabel,
                        });
                      }}
                      className="group flex items-center justify-between p-3 rounded-xl bg-surface border border-customBorder/50 hover:bg-elevated hover:border-accent/40 transition-all cursor-pointer shadow-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative w-11 h-11 rounded-lg overflow-hidden flex-shrink-0 bg-elevated">
                          <img
                            src={art}
                            alt={item.track.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                            <Play size={14} fill="currentColor" className="ml-0.5" />
                          </div>
                        </div>

                        <div className="min-w-0">
                          <div className="text-xs font-bold text-primary truncate group-hover:text-accent transition-colors">
                            {item.track.title}
                          </div>
                          <div className="text-[11px] text-secondary truncate">
                            {item.track.artist}
                          </div>
                          <div className="text-[10px] text-secondary/60 truncate mt-0.5">
                            {item.vibeReason}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 flex-shrink-0">
                        {item.isNovelty && (
                          <span className="hidden sm:inline text-[9px] font-semibold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
                            Discovery
                          </span>
                        )}
                        <span className="text-[11px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/25">
                          {item.vibeScore}% Match
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Session History (How Vibe Learned) */}
          <div className="space-y-3.5">
            <div>
              <h2 className="text-base md:text-lg font-bold text-primary flex items-center gap-2">
                <Disc3 size={17} className="text-accent" />
                <span>Session Flow</span>
              </h2>
              <p className="text-xs text-secondary mt-0.5">
                How Vibe adapted to your plays & skips
              </p>
            </div>

            <div className="bg-surface rounded-2xl border border-customBorder/60 p-3.5 space-y-2.5 max-h-[460px] overflow-y-auto">
              {history.length === 0 ? (
                <div className="py-8 text-center text-secondary/70 text-xs">
                  Session started. Played tracks and your skips will appear here.
                </div>
              ) : (
                history.map((h, idx) => (
                  <div
                    key={`${h.track.id}_hist_${idx}`}
                    className="flex items-center justify-between text-xs py-1.5 border-b border-customBorder/30 last:border-b-0"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-semibold text-primary truncate">
                        {h.track.title}
                      </div>
                      <div className="text-[11px] text-secondary truncate">
                        {h.track.artist}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {h.skipped ? (
                        <span
                          className="flex items-center gap-1 text-[10px] text-amber-400 font-medium"
                          title="Skipped early (DJ steered away)"
                        >
                          <XCircle size={12} />
                          <span>Skipped</span>
                        </span>
                      ) : h.replayed ? (
                        <span
                          className="flex items-center gap-1 text-[10px] text-cyan-400 font-medium"
                          title="Replayed (DJ reinforced this style)"
                        >
                          <Repeat size={12} />
                          <span>Replayed</span>
                        </span>
                      ) : (
                        <span
                          className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium"
                          title="Completed (Positive taste alignment)"
                        >
                          <CheckCircle2 size={12} />
                          <span>Vibed</span>
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
