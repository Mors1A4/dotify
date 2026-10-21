import React, { useState } from 'react';
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
  ThumbsDown,
  RotateCcw,
} from 'lucide-react';
import { getTrackArtwork, DEFAULT_MUSIC_ARTWORK } from '../../services/artworkService';
import { VibeDjArtistRecommendation, VibeDjTrackRecommendation } from '../../types/vibeDj';

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
    shakeUpVibe,
    playRecommendedArtist,
    playQueueTrack,
    setVectorMetric,
    steerAwayFromTrack,
    replayHistoryTrack,
  } = useVibeDjStore();

  const {
    currentTrack,
    isPlaying,
    togglePlay,
    nextTrack,
    navigateToArtist,
  } = usePlayerStore();

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
                    onClick={togglePlay}
                    className="px-5 py-3.5 rounded-2xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition-all backdrop-blur-md border border-white/20 flex items-center gap-2 shadow-lg cursor-pointer"
                    title={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? (
                      <>
                        <Pause size={14} fill="currentColor" />
                        <span>Pause</span>
                      </>
                    ) : (
                      <>
                        <Play size={14} fill="currentColor" />
                        <span>Play</span>
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={() => startVibeDj()}
                    className="px-5 py-3.5 rounded-2xl bg-accent text-white text-xs font-bold transition-all shadow-lg hover:opacity-90 flex items-center gap-2 cursor-pointer"
                  >
                    <Play size={14} fill="currentColor" />
                    <span>Drop In</span>
                  </button>
                )}
              </div>
            </div>

            {/* Right: Spinning Vinyl Deck of Current Song */}
            <div className="flex flex-col items-center">
              <div className="relative group w-48 h-48 md:w-56 md:h-56">
                {/* Vinyl record disc */}
                <div
                  className={`absolute inset-0 rounded-full bg-stone-950 border-4 border-stone-800 shadow-2xl flex items-center justify-center transition-all ${
                    isPlaying ? 'animate-[spin_12s_linear_infinite]' : ''
                  }`}
                  style={{
                    boxShadow: `0 0 35px ${accentColor}40`,
                  }}
                >
                  {/* Concentric vinyl grooves */}
                  <div className="absolute inset-4 rounded-full border border-stone-800/80 pointer-events-none" />
                  <div className="absolute inset-8 rounded-full border border-stone-800/60 pointer-events-none" />
                  <div className="absolute inset-12 rounded-full border border-stone-800/40 pointer-events-none" />

                  {/* Album art center sticker */}
                  <img
                    src={currentArtwork}
                    alt={displayTrack?.title || 'Current Vibe'}
                    className="w-24 h-24 md:w-28 md:h-28 rounded-full object-cover shadow-inner border-2 border-stone-900 pointer-events-none"
                  />
                  {/* Center hole */}
                  <div className="absolute w-5 h-5 rounded-full bg-stone-900 border border-stone-700 pointer-events-none" />
                </div>

                {/* Center play/pause overlay on hover */}
                <button
                  onClick={togglePlay}
                  className="absolute inset-0 rounded-full flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-xs text-white cursor-pointer"
                  title={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause size={36} fill="currentColor" />
                  ) : (
                    <Play size={36} fill="currentColor" className="ml-1" />
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

          {/* Vibe Metrics Radar Bar (Interactive Sliders) */}
          <div className="mt-8 pt-6 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* Energy Slider */}
            <div className="bg-black/30 backdrop-blur-md rounded-2xl p-3.5 border border-white/10 space-y-2 hover:border-amber-400/40 transition-colors">
              <div className="flex items-center justify-between text-[11px] font-semibold text-white/80">
                <span className="flex items-center gap-1.5">
                  <Flame size={13} className="text-amber-400" />
                  <span>Energy</span>
                </span>
                <span className="text-amber-300 font-mono text-xs font-bold">{energyPercent}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="95"
                value={energyPercent}
                onChange={(e) => setVectorMetric('energy', Number(e.target.value) / 100)}
                className="w-full h-1.5 bg-white/15 rounded-lg appearance-none cursor-pointer accent-amber-400 hover:accent-amber-300 focus:outline-none"
                title="Drag to adjust Energy intensity"
              />
            </div>

            {/* Dance Slider */}
            <div className="bg-black/30 backdrop-blur-md rounded-2xl p-3.5 border border-white/10 space-y-2 hover:border-rose-400/40 transition-colors">
              <div className="flex items-center justify-between text-[11px] font-semibold text-white/80">
                <span className="flex items-center gap-1.5">
                  <Zap size={13} className="text-rose-400" />
                  <span>Dance</span>
                </span>
                <span className="text-rose-300 font-mono text-xs font-bold">{dancePercent}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="95"
                value={dancePercent}
                onChange={(e) => setVectorMetric('danceability', Number(e.target.value) / 100)}
                className="w-full h-1.5 bg-white/15 rounded-lg appearance-none cursor-pointer accent-rose-400 hover:accent-rose-300 focus:outline-none"
                title="Drag to adjust Danceability groove"
              />
            </div>

            {/* Mood Slider */}
            <div className="bg-black/30 backdrop-blur-md rounded-2xl p-3.5 border border-white/10 space-y-2 hover:border-blue-400/40 transition-colors">
              <div className="flex items-center justify-between text-[11px] font-semibold text-white/80">
                <span className="flex items-center gap-1.5">
                  <TrendingUp size={13} className="text-blue-400" />
                  <span>Mood</span>
                </span>
                <span className="text-blue-300 font-mono text-xs font-bold">{moodPercent}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="95"
                value={moodPercent}
                onChange={(e) => setVectorMetric('mood', Number(e.target.value) / 100)}
                className="w-full h-1.5 bg-white/15 rounded-lg appearance-none cursor-pointer accent-blue-400 hover:accent-blue-300 focus:outline-none"
                title="Drag to adjust Mood valence"
              />
            </div>

            {/* Acoustic Slider */}
            <div className="bg-black/30 backdrop-blur-md rounded-2xl p-3.5 border border-white/10 space-y-2 hover:border-emerald-400/40 transition-colors">
              <div className="flex items-center justify-between text-[11px] font-semibold text-white/80">
                <span className="flex items-center gap-1.5">
                  <Compass size={13} className="text-emerald-400" />
                  <span>Acoustic</span>
                </span>
                <span className="text-emerald-300 font-mono text-xs font-bold">{acousticPercent}%</span>
              </div>
              <input
                type="range"
                min="10"
                max="95"
                value={acousticPercent}
                onChange={(e) => setVectorMetric('acousticness', Number(e.target.value) / 100)}
                className="w-full h-1.5 bg-white/15 rounded-lg appearance-none cursor-pointer accent-emerald-400 hover:accent-emerald-300 focus:outline-none"
                title="Drag to adjust Acoustic warmth"
              />
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
                  const matchBadgeColor =
                    item.vibeScore >= 80
                      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25'
                      : item.vibeScore >= 70
                      ? 'text-sky-400 bg-sky-500/10 border-sky-500/25'
                      : 'text-amber-400 bg-amber-500/10 border-amber-500/25';

                  return (
                    <div
                      key={`${item.track.id}_${index}`}
                      onClick={() => playQueueTrack(index)}
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
                          <div className="text-[10px] text-secondary/70 truncate mt-0.5">
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
                        <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-md border ${matchBadgeColor}`}>
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
                    className="group flex items-center justify-between text-xs py-1.5 px-2 rounded-xl hover:bg-elevated/60 transition-colors border-b border-customBorder/30 last:border-b-0"
                  >
                    <div className="min-w-0 pr-2 flex items-center gap-2">
                      <button
                        onClick={() => replayHistoryTrack(h.track)}
                        title="Replay this track"
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-white/10 text-secondary hover:text-white transition-opacity shrink-0 cursor-pointer"
                      >
                        <RotateCcw size={12} />
                      </button>
                      <div className="min-w-0">
                        <div
                          onClick={() => replayHistoryTrack(h.track)}
                          className="font-semibold text-primary truncate hover:underline cursor-pointer"
                        >
                          {h.track.title}
                        </div>
                        <div className="text-[11px] text-secondary truncate">
                          {h.track.artist}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {!h.skipped && (
                        <button
                          onClick={() => steerAwayFromTrack(h.track)}
                          title="Steer DJ away from this sound"
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-rose-500/20 text-secondary hover:text-rose-400 transition-all cursor-pointer"
                        >
                          <ThumbsDown size={12} />
                        </button>
                      )}

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
