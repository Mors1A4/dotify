import { useState, useEffect } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { audioEngine } from '../audio/audioEngine';

/**
 * React hook that returns true only when audio is actively playing AND producing
 * audible sound energy (silence-aware).
 *
 * It returns false during:
 * - Silent intro pre-roll or quiet gaps at start of playback
 * - Buffering or track switches
 * - Pauses or track ends
 * - Complete volume mute or digital silence
 */
export function useAudioActive(threshold = 5, pollInterval = 50): boolean {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!isPlaying || isBuffering || !currentTrack) {
      setIsActive(false);
      return;
    }

    const check = () => {
      const active = audioEngine.isAudioActive(threshold);
      setIsActive(active);
    };

    check();
    const interval = setInterval(check, pollInterval);
    return () => clearInterval(interval);
  }, [isPlaying, isBuffering, currentTrack, threshold, pollInterval]);

  return isActive;
}
