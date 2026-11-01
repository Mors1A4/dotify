import React, { useEffect, useRef, useState, useCallback } from 'react';
import { usePlayerStore, remoteProgressInterpolator } from '../../store/playerStore';
import { useLyricsStore } from '../../store/lyricsStore';
import { audioEngine } from '../../audio/audioEngine';
import { LyricLine } from '../../services/lyricsService';
import {
  Mic2,
  Sparkles,
  RefreshCw,
  Music,
  Compass,
  CheckCircle2,
  AlertCircle,
  Clock,
} from 'lucide-react';

interface LyricsViewerProps {
  compact?: boolean;
  className?: string;
  onLineClick?: (line: LyricLine) => void;
}

export const LyricsViewer: React.FC<LyricsViewerProps> = ({
  compact = false,
  className = '',
  onLineClick,
}) => {
  const { currentTrack, isPlaying, connectMode } = usePlayerStore();
  const {
    lyrics,
    isLoading,
    error,
    activeLineIndex,
    nextVocalCountdown,
    isAutoScrollEnabled,
    fontSize,
    fetchLyricsForTrack,
    setActiveLineIndex,
    setNextVocalCountdown,
    setAutoScrollEnabled,
    setFontSize,
  } = useLyricsStore();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const isUserScrollingRef = useRef<boolean>(false);
  const scrollResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSyncButton, setShowSyncButton] = useState<boolean>(false);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);

  // Fetch lyrics whenever current track changes
  useEffect(() => {
    fetchLyricsForTrack(currentTrack);
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist]);

  // High-precision (60fps / 50ms) time tracking loop
  useEffect(() => {
    if (!lyrics || !lyrics.lines || lyrics.lines.length === 0) return;

    let animId: number;

    const checkTime = () => {
      let nowTime = 0;
      if (connectMode === 'remote_controller') {
        nowTime = remoteProgressInterpolator.getCurrentPosition();
      } else {
        nowTime = audioEngine.getCurrentTime();
      }

      setCurrentTimeSec(nowTime);

      const lines = lyrics.lines;
      let currentIndex = -1;
      let nextCountdown: number | null = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const nextLine = lines[i + 1];

        if (nowTime >= line.time && (nowTime < line.endTime || !nextLine)) {
          currentIndex = i;
          break;
        } else if (nowTime < line.time) {
          // If before the first line or between lines, check if it's an instrumental break
          if (i === 0 && line.time - nowTime > 3.5) {
            nextCountdown = Math.ceil(line.time - nowTime);
          } else if (i > 0) {
            const prevLine = lines[i - 1];
            if (nowTime >= prevLine.endTime && line.time - nowTime > 3.5) {
              nextCountdown = Math.ceil(line.time - nowTime);
            }
          }
          break;
        }
      }

      if (currentIndex !== -1) {
        setActiveLineIndex(currentIndex);
        setNextVocalCountdown(null);
      } else {
        setActiveLineIndex(-1);
        setNextVocalCountdown(nextCountdown);
      }

      animId = requestAnimationFrame(checkTime);
    };

    animId = requestAnimationFrame(checkTime);
    return () => cancelAnimationFrame(animId);
  }, [lyrics, connectMode]);

  // Smooth auto-scroll to active line
  useEffect(() => {
    if (!isAutoScrollEnabled || isUserScrollingRef.current) return;
    if (activeLineIndex < 0 || !lineRefs.current[activeLineIndex] || !containerRef.current) return;

    const lineEl = lineRefs.current[activeLineIndex];
    const container = containerRef.current;
    if (!lineEl) return;

    const lineRect = lineEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Calculate center offset
    const lineCenter = lineEl.offsetTop + lineEl.offsetHeight / 2;
    const containerCenter = container.clientHeight / 2;
    const targetScrollTop = Math.max(0, lineCenter - containerCenter);

    container.scrollTo({
      top: targetScrollTop,
      behavior: 'smooth',
    });
  }, [activeLineIndex, isAutoScrollEnabled]);

  // User manual scroll detection
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;

    isUserScrollingRef.current = true;
    setShowSyncButton(true);

    if (scrollResumeTimerRef.current) {
      clearTimeout(scrollResumeTimerRef.current);
    }

    scrollResumeTimerRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
      setShowSyncButton(false);
    }, 4500);
  }, []);

  const handleResumeSync = () => {
    isUserScrollingRef.current = false;
    setShowSyncButton(false);
    if (scrollResumeTimerRef.current) {
      clearTimeout(scrollResumeTimerRef.current);
    }
    if (activeLineIndex >= 0 && lineRefs.current[activeLineIndex] && containerRef.current) {
      const lineEl = lineRefs.current[activeLineIndex];
      const container = containerRef.current;
      if (lineEl) {
        const lineCenter = lineEl.offsetTop + lineEl.offsetHeight / 2;
        const containerCenter = container.clientHeight / 2;
        container.scrollTo({
          top: Math.max(0, lineCenter - containerCenter),
          behavior: 'smooth',
        });
      }
    }
  };

  // Interactive seek on line click
  const handleLineClick = (line: LyricLine) => {
    if (onLineClick) {
      onLineClick(line);
      return;
    }

    audioEngine.seekTo(line.time);
  };

  const getSourceBadge = () => {
    if (!lyrics) return null;
    switch (lyrics.source) {
      case 'lrclib':
        return (
          <span className="flex items-center gap-1 text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 size={11} /> Synced (LRCLIB)
          </span>
        );
      case 'gemini':
        return (
          <span className="flex items-center gap-1 text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Sparkles size={11} /> AI Synchronized (Gemini)
          </span>
        );
      case 'algorithmic':
        return (
          <span className="flex items-center gap-1 text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Compass size={11} /> Algorithmic Sync
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-surface text-secondary border border-customBorder">
            <Mic2 size={11} /> Lyrics
          </span>
        );
    }
  };

  // 1. Loading State
  if (isLoading) {
    return (
      <div className={`flex flex-col items-center justify-center h-full p-6 text-center select-none ${className}`}>
        <div className="relative mb-4">
          <div className="w-12 h-12 rounded-full border-2 border-accent/20 border-t-accent animate-spin" />
          <Mic2 className="absolute inset-0 m-auto text-accent" size={20} />
        </div>
        <p className="text-sm font-medium text-primary">Searching tracked lyrics...</p>
        <p className="text-xs text-muted mt-1">Connecting to live LRC & AI alignment network</p>
      </div>
    );
  }

  // 2. Instrumental Track
  if (lyrics?.instrumental) {
    return (
      <div className={`flex flex-col items-center justify-center h-full p-6 text-center select-none ${className}`}>
        <div className="w-16 h-16 rounded-2xl bg-surface border border-customBorder flex items-center justify-center mb-4 text-accent shadow-lg">
          <Music size={28} />
        </div>
        <h3 className="text-base font-semibold text-primary">Instrumental Track</h3>
        <p className="text-xs text-muted mt-1 max-w-xs">
          This piece is composed without vocal lyrics. Enjoy the music!
        </p>
      </div>
    );
  }

  // 3. Error / No Lyrics Found
  if (error || !lyrics || !lyrics.lines || lyrics.lines.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center h-full p-6 text-center select-none ${className}`}>
        <div className="w-14 h-14 rounded-2xl bg-surface border border-customBorder flex items-center justify-center mb-4 text-muted shadow-sm">
          <AlertCircle size={24} />
        </div>
        <h3 className="text-sm font-semibold text-primary">No Tracked Lyrics</h3>
        <p className="text-xs text-muted mt-1 max-w-xs mb-4">
          {error || `We couldn't find time-synchronized lyrics for "${currentTrack?.title || 'this track'}".`}
        </p>
        <button
          onClick={() => fetchLyricsForTrack(currentTrack)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-highlight text-xs font-medium text-primary border border-customBorder transition-colors"
        >
          <RefreshCw size={12} />
          <span>Retry Search</span>
        </button>
      </div>
    );
  }

  const fontSizeClass =
    fontSize === 'large'
      ? compact
        ? 'text-lg leading-relaxed'
        : 'text-2xl md:text-3xl leading-relaxed'
      : fontSize === 'small'
      ? compact
        ? 'text-xs leading-normal'
        : 'text-base leading-normal'
      : compact
      ? 'text-sm leading-relaxed'
      : 'text-xl md:text-2xl leading-relaxed';

  return (
    <div className={`relative flex flex-col h-full overflow-hidden ${className}`}>
      {/* Header Info & Controls */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-customBorder/40 bg-surface/30 backdrop-blur-sm shrink-0 z-10">
        <div className="flex items-center gap-2 min-w-0">
          {getSourceBadge()}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setFontSize(fontSize === 'small' ? 'medium' : fontSize === 'medium' ? 'large' : 'small')}
            className="px-2 py-0.5 rounded text-[11px] font-mono font-medium text-secondary hover:text-primary hover:bg-highlight transition-colors"
            title="Toggle lyric size"
          >
            {fontSize === 'small' ? 'A' : fontSize === 'medium' ? 'AA' : 'AAA'}
          </button>
        </div>
      </div>

      {/* Instrumental Break Countdown Header */}
      {nextVocalCountdown !== null && nextVocalCountdown > 0 && (
        <div className="flex items-center justify-center gap-2 py-2 px-4 bg-accent/10 border-b border-accent/20 text-accent text-xs font-medium animate-pulse shrink-0">
          <Clock size={13} />
          <span>Vocal re-entry in {nextVocalCountdown}s</span>
          <span className="flex gap-1 items-center ml-1">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-ping" />
          </span>
        </div>
      )}

      {/* Main Lyrics Scroll Feed */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-16 scroll-smooth select-none focus:outline-none"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
        }}
      >
        <div className="max-w-2xl mx-auto flex flex-col gap-5 py-8">
          {lyrics.lines.map((line, index) => {
            const isActive = index === activeLineIndex;
            const isPast = activeLineIndex >= 0 && index < activeLineIndex;
            const isFuture = activeLineIndex >= 0 && index > activeLineIndex;

            if (line.isInstrumental) {
              return (
                <div
                  key={line.id}
                  ref={(el) => (lineRefs.current[index] = el)}
                  onClick={() => handleLineClick(line)}
                  className="flex items-center justify-center py-4 cursor-pointer text-muted hover:text-primary transition-all opacity-40 hover:opacity-100"
                >
                  <span className="text-xs font-mono tracking-widest uppercase flex items-center gap-2">
                    <span>•</span>
                    <span>•</span>
                    <span>•</span>
                    <span>Instrumental</span>
                    <span>•</span>
                    <span>•</span>
                    <span>•</span>
                  </span>
                </div>
              );
            }

            return (
              <div
                key={line.id}
                ref={(el) => (lineRefs.current[index] = el)}
                onClick={() => handleLineClick(line)}
                className={`group relative cursor-pointer font-semibold transition-all duration-300 rounded-xl px-3 py-1.5 ${fontSizeClass} ${
                  isActive
                    ? 'text-accent scale-[1.02] origin-left drop-shadow-sm font-bold'
                    : isPast
                    ? 'text-primary/40 hover:text-primary/80 scale-100 font-medium'
                    : 'text-primary/60 hover:text-primary/90 scale-100 font-medium'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span>{line.text}</span>
                  {isActive && (
                    <span className="shrink-0 text-[10px] font-mono text-accent/80 opacity-0 group-hover:opacity-100 transition-opacity mt-1">
                      {Math.floor(line.time / 60)}:{String(Math.floor(line.time % 60)).padStart(2, '0')}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating "Resume Sync" Pill when user scrolls away */}
      {showSyncButton && (
        <div className="absolute bottom-4 inset-x-0 flex justify-center z-20 pointer-events-none">
          <button
            onClick={handleResumeSync}
            className="pointer-events-auto flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-elevated/90 hover:bg-elevated text-xs font-medium text-accent border border-customBorder shadow-lg backdrop-blur-md transition-all animate-in fade-in zoom-in-95 duration-150 cursor-pointer"
          >
            <Compass size={13} className="animate-spin" />
            <span>Resume live sync</span>
          </button>
        </div>
      )}
    </div>
  );
};
