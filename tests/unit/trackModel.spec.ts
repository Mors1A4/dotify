import { describe, it, expect } from 'vitest';
import {
  MOCK_AUDIUS_TRACK,
  MOCK_ARCHIVE_TRACK,
  MOCK_RADIO_TRACK,
  MOCK_P2P_TRACK,
  Track,
} from '../fixtures/mockData';

export function validateTrack(track: Track): boolean {
  if (!track.id || typeof track.id !== 'string') return false;
  if (!['audius', 'archive', 'radio', 'p2p'].includes(track.source)) return false;
  if (!track.title || typeof track.title !== 'string') return false;
  if (!track.artist || typeof track.artist !== 'string') return false;
  if (typeof track.duration !== 'number') return false;
  if (!track.streamUrl || typeof track.streamUrl !== 'string') return false;
  if (!track.sourceMetadata || typeof track.sourceMetadata !== 'object') return false;

  // Specific prefix validation
  const expectedPrefix = `${track.source}:`;
  if (!track.id.startsWith(expectedPrefix)) return false;

  return true;
}

describe('Unified Track Model Contract', () => {
  it('validates Audius track conforms to schema', () => {
    expect(validateTrack(MOCK_AUDIUS_TRACK)).toBe(true);
    expect(MOCK_AUDIUS_TRACK.source).toBe('audius');
    expect(MOCK_AUDIUS_TRACK.id.startsWith('audius:')).toBe(true);
  });

  it('validates Internet Archive track conforms to schema', () => {
    expect(validateTrack(MOCK_ARCHIVE_TRACK)).toBe(true);
    expect(MOCK_ARCHIVE_TRACK.source).toBe('archive');
    expect(MOCK_ARCHIVE_TRACK.id.startsWith('archive:')).toBe(true);
  });

  it('validates Live Radio track conforms to schema with infinite duration', () => {
    expect(validateTrack(MOCK_RADIO_TRACK)).toBe(true);
    expect(MOCK_RADIO_TRACK.source).toBe('radio');
    expect(MOCK_RADIO_TRACK.duration).toBe(Infinity);
    expect(MOCK_RADIO_TRACK.id.startsWith('radio:')).toBe(true);
  });

  it('validates P2P Torrent track conforms to schema with infoHash and fileIndex', () => {
    expect(validateTrack(MOCK_P2P_TRACK)).toBe(true);
    expect(MOCK_P2P_TRACK.source).toBe('p2p');
    expect(MOCK_P2P_TRACK.id.startsWith('p2p:')).toBe(true);
    expect(MOCK_P2P_TRACK.sourceMetadata.infoHash).toBeDefined();
    expect(MOCK_P2P_TRACK.sourceMetadata.fileIndex).toBe(0);
  });

  it('rejects invalid tracks missing required fields or prefix', () => {
    const invalidTrack: any = {
      id: 'bad-id',
      source: 'unknown',
      title: 'Bad Track',
    };
    expect(validateTrack(invalidTrack)).toBe(false);
  });
});
