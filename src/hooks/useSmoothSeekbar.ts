import React, { useEffect, useRef, useCallback } from 'react';
import { Track } from '../types/track';
import { audioEngine } from '../audio/audioEngine';
import { usePlayerStore } from '../store/playerStore';

export function formatPlaybackTime(secs: number): string {
  if (!secs || isNaN(secs) || !isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function isLiveStreamTrack(duration: number, track: Track | null | undefined): boolean {
  if (!track) return false;
  if (track.source === 'radio' || track.duration === Infinity || duration === Infinity) {
    return true;
  }
  return false;
}

function resolveEffectiveDuration(duration: number, track: Track | null | undefined): number {
  if (isLiveStreamTrack(duration, track)) {
    return Infinity;
  }
  const trackDur =
    track && typeof track.duration === 'number' && isFinite(track.duration) && track.duration > 0
      ? track.duration
      : 0;

  // Strict invariant: Guard against truncated ~29s/30s preview clip overriding true track duration
  if (typeof duration === 'number' && isFinite(duration) && duration > 0) {
    if (duration <= 33 && trackDur > 45) {
      return trackDur;
    }
    return duration;
  }
  return trackDur;
}

export interface SmoothSeekbarOptions {
  track: Track | null | undefined;
  isActive?: boolean;
}

export function useSmoothSeekbar({ track, isActive = true }: SmoothSeekbarOptions) {
  const seekbarRef = useRef<HTMLInputElement | null>(null);
  const currentTimeRef = useRef<HTMLSpanElement | null>(null);
  const totalDurationRef = useRef<HTMLSpanElement | null>(null);
  const miniProgressRef = useRef<HTMLDivElement | null>(null);
  const artworkRef = useRef<HTMLImageElement | null>(null);
  const trackMetaRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef<boolean>(false);

  const visualPercentRef = useRef<number>(0);
  const targetTimeRef = useRef<number>(0);
  const targetDurationRef = useRef<number>(0);
  const lastTrackIdRef = useRef<string | null>(null);
  const trackRef = useRef<Track | null | undefined>(track);
  trackRef.current = track;

  const glideRafRef = useRef<number | null>(null);
  const glideStateRef = useRef<{
    active: boolean;
    startPercent: number;
    startTimePerf: number;
    durationMs: number;
  }>({
    active: false,
    startPercent: 0,
    startTimePerf: 0,
    durationMs: 260,
  });

  const cancelGlide = useCallback(() => {
    glideStateRef.current.active = false;
    if (glideRafRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(glideRafRef.current);
      glideRafRef.current = null;
    }
  }, []);

  const applySeekbarDom = useCallback(
    (percent: number, currentSec: number, durationSec: number, isLive: boolean) => {
      const safePct = Math.max(0, Math.min(100, isFinite(percent) ? percent : 0));
      visualPercentRef.current = safePct;

      if (!isDraggingRef.current && seekbarRef.current) {
        const maxVal = isFinite(durationSec) && durationSec > 0 ? durationSec : 100;
        seekbarRef.current.max = String(maxVal);
        const visualValue = (safePct / 100) * maxVal;
        seekbarRef.current.value = String(visualValue);
        const pctStr = safePct.toFixed(3);
        seekbarRef.current.style.background = `linear-gradient(to right, #ffffff 0%, #ffffff ${pctStr}%, rgba(255, 255, 255, 0.2) ${pctStr}%, rgba(255, 255, 255, 0.2) 100%)`;
      }

      if (miniProgressRef.current) {
        miniProgressRef.current.style.width = `${safePct.toFixed(3)}%`;
      }

      if (!isDraggingRef.current && currentTimeRef.current) {
        currentTimeRef.current.textContent = formatPlaybackTime(currentSec);
      }

      if (totalDurationRef.current) {
        if (isLive) {
          totalDurationRef.current.textContent = 'LIVE';
        } else {
          totalDurationRef.current.textContent = formatPlaybackTime(durationSec);
        }
      }
    },
    []
  );

  const startRewindGlide = useCallback(
    (fromPercent: number) => {
      if (typeof requestAnimationFrame === 'undefined' || fromPercent <= 0.4) {
        cancelGlide();
        const curTrack = trackRef.current;
        const isLive = isLiveStreamTrack(targetDurationRef.current, curTrack);
        const effDur = resolveEffectiveDuration(targetDurationRef.current, curTrack);
        const targetPct =
          effDur > 0 && isFinite(effDur) ? (targetTimeRef.current / effDur) * 100 : 0;
        applySeekbarDom(targetPct, targetTimeRef.current, effDur, isLive);
        return;
      }

      cancelGlide();
      const nowPerf = typeof performance !== 'undefined' ? performance.now() : Date.now();
      glideStateRef.current = {
        active: true,
        startPercent: fromPercent,
        startTimePerf: nowPerf,
        durationMs: 260,
      };

      const stepGlide = () => {
        if (!glideStateRef.current.active || isDraggingRef.current) {
          glideStateRef.current.active = false;
          glideRafRef.current = null;
          return;
        }

        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const elapsed = Math.max(0, now - glideStateRef.current.startTimePerf);
        const t = Math.min(1, elapsed / glideStateRef.current.durationMs);
        // Smooth cubic ease-out curve
        const eased = 1 - Math.pow(1 - t, 3);

        const curTrack = trackRef.current;
        const effDur = resolveEffectiveDuration(targetDurationRef.current, curTrack);
        const isLive = isLiveStreamTrack(effDur, curTrack);
        const liveTargetPct =
          effDur > 0 && isFinite(effDur)
            ? Math.min(100, Math.max(0, (targetTimeRef.current / effDur) * 100))
            : 0;

        const currentPct =
          glideStateRef.current.startPercent +
          (liveTargetPct - glideStateRef.current.startPercent) * eased;

        applySeekbarDom(currentPct, targetTimeRef.current, effDur, isLive);

        if (t < 1) {
          glideRafRef.current = requestAnimationFrame(stepGlide);
        } else {
          glideStateRef.current.active = false;
          glideRafRef.current = null;
          applySeekbarDom(liveTargetPct, targetTimeRef.current, effDur, isLive);
        }
      };

      glideRafRef.current = requestAnimationFrame(stepGlide);
    },
    [applySeekbarDom, cancelGlide]
  );

  // Handle track switches and initial mount state synchronization
  useEffect(() => {
    if (!isActive || !track) return;

    const prevTrackId = lastTrackIdRef.current;
    const isTrackSwitch = prevTrackId !== null && prevTrackId !== track.id;
    lastTrackIdRef.current = track.id;

    if (isTrackSwitch) {
      // Trigger smooth compositor-accelerated transition on artwork & track metadata
      try {
        artworkRef.current?.animate?.(
          [
            { opacity: 0.45, transform: 'scale(0.93)' },
            { opacity: 1, transform: 'scale(1)' },
          ],
          { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        );
        trackMetaRef.current?.animate?.(
          [
            { opacity: 0.3, transform: 'translateY(5px)' },
            { opacity: 1, transform: 'translateY(0px)' },
          ],
          { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        );
      } catch {
        // Ignore if Web Animations API is unavailable
      }

      const initDur = resolveEffectiveDuration(0, track);
      const isLive = isLiveStreamTrack(initDur, track);
      targetTimeRef.current = 0;
      targetDurationRef.current = initDur;

      if (currentTimeRef.current && !isDraggingRef.current) {
        currentTimeRef.current.textContent = '0:00';
      }
      if (totalDurationRef.current) {
        totalDurationRef.current.textContent = isLive ? 'LIVE' : formatPlaybackTime(initDur);
      }

      startRewindGlide(visualPercentRef.current);
    } else {
      // Initial mount or re-open (e.g. expanding MobileSheet or VisualizerModal mid-song)
      const engineTrack = audioEngine.getCurrentTrack();
      const rawCur = engineTrack?.id === track.id ? audioEngine.getCurrentTime() : 0;
      const rawDur = engineTrack?.id === track.id ? audioEngine.getDuration() : 0;
      const effDur = resolveEffectiveDuration(rawDur, track);
      const isLive = isLiveStreamTrack(effDur, track);
      const pct = effDur > 0 && isFinite(effDur) ? (rawCur / effDur) * 100 : 0;

      targetTimeRef.current = rawCur;
      targetDurationRef.current = effDur;
      applySeekbarDom(pct, rawCur, effDur, isLive);
    }
  }, [track?.id, track?.duration, track?.source, isActive, applySeekbarDom, startRewindGlide]);

  // Subscribe to high-frequency AudioEngine time updates
  useEffect(() => {
    if (!isActive) return;

    const unsubscribe = audioEngine.onTimeUpdate((current, duration) => {
      const curTrack = trackRef.current || audioEngine.getCurrentTrack();
      const effDur = resolveEffectiveDuration(duration, curTrack);
      const isLive = isLiveStreamTrack(effDur, curTrack);
      const newPct =
        effDur > 0 && isFinite(effDur) ? Math.min(100, Math.max(0, (current / effDur) * 100)) : 0;

      const prevVisualPct = visualPercentRef.current;
      targetTimeRef.current = current;
      targetDurationRef.current = effDur;

      // Detect rewind to 0:00 (e.g., Repeat One loop or restarting current song)
      if (!isDraggingRef.current && !glideStateRef.current.active && current <= 0.25 && prevVisualPct > 2.0) {
        startRewindGlide(prevVisualPct);
        return;
      }

      // If an explicit mid-track seek/handoff occurred during a rewind glide, cancel glide and snap
      if (glideStateRef.current.active && current > 1.2) {
        cancelGlide();
      }

      if (glideStateRef.current.active) {
        // Glide loop will interpolate bar position; still keep time labels fresh
        if (!isDraggingRef.current && currentTimeRef.current) {
          currentTimeRef.current.textContent = formatPlaybackTime(current);
        }
        if (totalDurationRef.current) {
          totalDurationRef.current.textContent = isLive ? 'LIVE' : formatPlaybackTime(effDur);
        }
        return;
      }

      applySeekbarDom(newPct, current, effDur, isLive);
    });

    return () => {
      unsubscribe();
      cancelGlide();
    };
  }, [isActive, applySeekbarDom, cancelGlide, startRewindGlide]);

  const handleSeekInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      isDraggingRef.current = true;
      cancelGlide();
      const val = parseFloat(e.target.value);
      const max = parseFloat(e.target.max) || 100;
      const percent = max > 0 ? Math.min(100, Math.max(0, (val / max) * 100)) : 0;
      visualPercentRef.current = percent;
      const pctStr = percent.toFixed(3);
      e.target.style.background = `linear-gradient(to right, #ffffff 0%, #ffffff ${pctStr}%, rgba(255, 255, 255, 0.2) ${pctStr}%, rgba(255, 255, 255, 0.2) 100%)`;
      if (currentTimeRef.current) {
        currentTimeRef.current.textContent = formatPlaybackTime(val);
      }
    },
    [cancelGlide]
  );

  const handleSeekChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      cancelGlide();
      const val = parseFloat(e.target.value);
      const max = parseFloat(e.target.max) || 100;
      const percent = max > 0 ? Math.min(100, Math.max(0, (val / max) * 100)) : 0;
      visualPercentRef.current = percent;
      targetTimeRef.current = val;
      const pctStr = percent.toFixed(3);
      e.target.style.background = `linear-gradient(to right, #ffffff 0%, #ffffff ${pctStr}%, rgba(255, 255, 255, 0.2) ${pctStr}%, rgba(255, 255, 255, 0.2) 100%)`;
      isDraggingRef.current = false;
      const store = usePlayerStore.getState();
      if (store.connectMode === 'remote_controller') {
        store.seekTo(val);
      } else {
        audioEngine.seekTo(val);
      }
    },
    [cancelGlide]
  );

  return {
    seekbarRef,
    currentTimeRef,
    totalDurationRef,
    miniProgressRef,
    artworkRef,
    trackMetaRef,
    isDraggingRef,
    handleSeekInput,
    handleSeekChange,
    formatTime: formatPlaybackTime,
  };
}
