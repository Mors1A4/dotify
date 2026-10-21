import { describe, it, expect, beforeEach } from 'vitest';
import { badSourceService } from '../../src/services/badSourceService';
import {
  rankCandidates,
  resolveYouTubeVideoId,
  markSourceAsBadAndResolveNext,
  setExplicitSource,
  getCachedVideoId,
  YouTubeCandidate,
} from '../../src/services/youtubeResolver';

describe('Bad Source & Audio Watermark Exclusion System', () => {
  beforeEach(() => {
    localStorage.clear();
    badSourceService.clearAll();
  });

  it('marks a video ID as bad and persists to localStorage', () => {
    expect(badSourceService.isBad('badVideo123')).toBe(false);

    badSourceService.markBad({
      videoId: 'badVideo123',
      artist: 'Rick Astley',
      title: 'Never Gonna Give You Up',
      videoTitle: 'Never Gonna Give You Up (AudioJungle Watermark)',
      reason: 'audio_watermark',
    });

    expect(badSourceService.isBad('badVideo123')).toBe(true);

    const list = badSourceService.getBadSources();
    expect(list.length).toBe(1);
    expect(list[0].videoId).toBe('badVideo123');
    expect(list[0].reason).toBe('audio_watermark');

    // Test persistence in localStorage
    const stored = JSON.parse(localStorage.getItem('dotify_bad_sources') || '[]');
    expect(stored.length).toBe(1);
    expect(stored[0].videoId).toBe('badVideo123');
  });

  it('unmarks a bad source when restored', () => {
    badSourceService.markBad({
      videoId: 'badVideo123',
      artist: 'Artist',
      title: 'Song',
      reason: 'audio_watermark',
    });
    expect(badSourceService.isBad('badVideo123')).toBe(true);

    badSourceService.unmarkBad('badVideo123');
    expect(badSourceService.isBad('badVideo123')).toBe(false);
    expect(badSourceService.getBadSources().length).toBe(0);
  });

  it('rankCandidates flags candidates marked as bad and deprioritizes them', () => {
    badSourceService.markBad({
      videoId: 'watermarked',
      artist: 'Queen',
      title: 'Bohemian Rhapsody',
      reason: 'audio_watermark',
    });

    const candidates: YouTubeCandidate[] = [
      {
        videoId: 'watermarked',
        title: 'Queen - Bohemian Rhapsody (Official Audio with Watermark)',
        duration: 355,
      },
      {
        videoId: 'cleanAudio1',
        title: 'Queen - Bohemian Rhapsody (Official Audio Clean)',
        duration: 354,
      },
    ];

    const ranked = rankCandidates(candidates, 'Queen', 'Bohemian Rhapsody', 354);

    const badCand = ranked.find((c) => c.videoId === 'watermarked');
    const cleanCand = ranked.find((c) => c.videoId === 'cleanAudio1');

    expect(badCand?.isBad).toBe(true);
    expect(badCand?.badReason).toBe('audio_watermark');
    expect(cleanCand?.isBad).toBe(false);

    // Clean candidate must win first place
    expect(ranked[0].videoId).toBe('cleanAudio1');
    expect(cleanCand!.score!).toBeGreaterThan(badCand!.score!);
  });

  it('purges bad source from cached resolution and selects next clean candidate', async () => {
    const artist = 'Test Artist';
    const title = 'Test Track';
    const badVid = 'badVid11111';
    const cleanVid = 'cleanVid222';

    // Seed cache with bad video
    setExplicitSource(artist, title, badVid);
    expect(getCachedVideoId(artist, title)).toBe(badVid);

    // Now mark as bad and resolve next
    badSourceService.markBad({
      videoId: badVid,
      artist,
      title,
      reason: 'audio_watermark',
    });

    // Cached check must return null because it detects the cached video is bad
    expect(getCachedVideoId(artist, title)).toBeNull();
  });

  it('setExplicitSource clears bad status and commits preference', () => {
    const artist = 'Daft Punk';
    const title = 'One More Time';
    const chosenVid = 'daft1234567';

    badSourceService.markBad({
      videoId: chosenVid,
      artist,
      title,
      reason: 'audio_watermark',
    });
    expect(badSourceService.isBad(chosenVid)).toBe(true);

    // User explicitly sets this candidate
    setExplicitSource(artist, title, chosenVid);
    expect(badSourceService.isBad(chosenVid)).toBe(false);
    expect(getCachedVideoId(artist, title)).toBe(chosenVid);
  });
});
