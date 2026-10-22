import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

describe('MobileMiniPlayer - Tap Expansion Invariant', () => {
  it('ensures tapping anywhere on the mini-player song info (including artist name) opens full screen rather than navigating to artist', () => {
    const filePath = path.resolve(__dirname, '../../src/components/layout/MobileMiniPlayer.tsx');
    const content = fs.readFileSync(filePath, 'utf8');

    // 1. Root container must expand mobile sheet on tap
    expect(content).toContain('onClick={() => toggleMobileSheet(true)}');

    // 2. Artist name must NOT intercept clicks with navigateToArtist or e.stopPropagation()
    expect(content).not.toMatch(/onClick=\{.*navigateToArtist.*displayTrack\.artist.*\}/);
    expect(content).not.toContain('navigateToArtist(displayTrack.artist)');

    // 3. Mini-player must not import or destructure navigateToArtist
    expect(content).not.toContain('navigateToArtist,');
  });
});
