import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { usePlayerStore } from '../../src/store/playerStore';
import { Track } from '../../src/types/track';

const mockTrack: Track = {
  id: 'mobile-test-track-1',
  title: 'Midnight Sun',
  artist: 'Retro Horizon',
  album: 'Neon Nights',
  duration: 180,
  artworkUrl: 'https://example.com/art.jpg',
  streamUrl: 'https://example.com/stream.mp3',
  source: 'audius',
  sourceMetadata: {},
};

describe('MobileNowPlayingSheet - Hook Integrity & Rules of Hooks Guard', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      currentTrack: mockTrack,
      isMobileSheetOpen: false,
      isPlaying: false,
      queue: [mockTrack],
      currentTrackIndex: 0,
    });
  });

  afterEach(() => {
    usePlayerStore.setState({
      isMobileSheetOpen: false,
      currentTrack: null,
      queue: [],
    });
  });

  it('guarantees all React hooks are strictly invoked BEFORE any conditional early return', () => {
    const filePath = path.resolve(__dirname, '../../src/components/player/MobileNowPlayingSheet.tsx');
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    let earlyReturnIndex = -1;
    const hookIndices: { name: string; line: number }[] = [];

    lines.forEach((rawLine, idx) => {
      const line = rawLine.trim();
      // Detect component early return
      if (/^if\s*\(.*(!isMobileSheetOpen|!displayTrack).*\)\s*return null;/.test(line)) {
        earlyReturnIndex = idx + 1;
      }
      // Detect React hook invocations at component level
      if (/\b(use[A-Z]\w*|React\.use\w+)(<.*>)?\s*\(/.test(line)) {
        hookIndices.push({ name: line, line: idx + 1 });
      }
    });

    expect(earlyReturnIndex).toBeGreaterThan(0);
    expect(hookIndices.length).toBeGreaterThanOrEqual(3);

    // Strict Invariant: No hooks are permitted after early return (prevents Minified React error #310)
    for (const hook of hookIndices) {
      expect(
        hook.line,
        `Hook "${hook.name}" at line ${hook.line} was declared after early return at line ${earlyReturnIndex}`
      ).toBeLessThan(earlyReturnIndex);
    }
  });

  it('correctly toggles isMobileSheetOpen in store when expanding a song on mobile', () => {
    expect(usePlayerStore.getState().isMobileSheetOpen).toBe(false);

    // User taps song / mini-player to expand
    usePlayerStore.getState().toggleMobileSheet(true);
    expect(usePlayerStore.getState().isMobileSheetOpen).toBe(true);

    // User swipes down or clicks dismiss button to close
    usePlayerStore.getState().toggleMobileSheet(false);
    expect(usePlayerStore.getState().isMobileSheetOpen).toBe(false);

    // Toggle without argument inverts state
    usePlayerStore.getState().toggleMobileSheet();
    expect(usePlayerStore.getState().isMobileSheetOpen).toBe(true);
    usePlayerStore.getState().toggleMobileSheet();
    expect(usePlayerStore.getState().isMobileSheetOpen).toBe(false);
  });
});
