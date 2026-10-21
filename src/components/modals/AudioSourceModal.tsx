import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Radio,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  ShieldCheck,
  Disc3,
  Sliders,
} from 'lucide-react';
import { usePlayerStore } from '../../store/playerStore';
import { audioEngine } from '../../audio/audioEngine';
import {
  getCandidatesForTrack,
  getCachedVideoId,
  YouTubeCandidate,
  markSourceAsBadAndResolveNext,
} from '../../services/youtubeResolver';
import { badSourceService, BadSourceEntry } from '../../services/badSourceService';
import {
  getTrackArtwork,
  resolveTrackArtwork,
  DEFAULT_MUSIC_ARTWORK,
  isUglyPlaceholder,
} from '../../services/artworkService';

function formatDuration(sec?: number): string {
  if (!sec || !isFinite(sec) || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const AudioSourceModal: React.FC = () => {
  const {
    isSourceModalOpen,
    sourceModalTrack,
    closeSourceModal,
    currentTrack,
    isPlaying,
    switchAudioSource,
  } = usePlayerStore();

  const [candidates, setCandidates] = useState<YouTubeCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{
    text: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const [modalTab, setModalTab] = useState<'candidates' | 'blocked'>('candidates');
  const [blockedSources, setBlockedSources] = useState<BadSourceEntry[]>([]);

  const track = sourceModalTrack || currentTrack || audioEngine.getCurrentTrack();
  const isCurrentlyPlayingThisTrack = Boolean(
    track && currentTrack && (track.id === currentTrack.id || (track.artist === currentTrack.artist && track.title === currentTrack.title))
  );

  const refreshBlocked = () => {
    setBlockedSources(badSourceService.getBadSources());
  };

  const loadCandidates = async () => {
    if (!track) return;
    setIsLoading(true);
    setStatusBanner(null);

    try {
      const activeVid =
        (isCurrentlyPlayingThisTrack ? audioEngine.getCurrentVideoId() : null) ||
        getCachedVideoId(track.artist, track.title);
      setActiveVideoId(activeVid);

      const list = await getCandidatesForTrack(track.artist, track.title, track.duration);
      setCandidates(list);
      refreshBlocked();
    } catch (err: any) {
      console.warn('[AudioSourceModal] Failed to load candidates:', err);
      setStatusBanner({
        text: 'Failed to search alternative sources. Check network connection.',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isSourceModalOpen && track) {
      loadCandidates();
    } else {
      setCandidates([]);
      setStatusBanner(null);
      setModalTab('candidates');
    }
  }, [isSourceModalOpen, track?.id, track?.artist, track?.title]);

  const activeCandidate = useMemo(() => {
    if (!activeVideoId) return null;
    return candidates.find((c) => c.videoId === activeVideoId) || null;
  }, [candidates, activeVideoId]);

  if (!isSourceModalOpen || !track || typeof document === 'undefined') {
    return null;
  }

  const handleMarkAsBad = async (videoId: string, videoTitle?: string, reason = 'audio_watermark') => {
    if (isSwitching) return;
    setIsSwitching(true);
    setStatusBanner(null);

    try {
      const { newVideoId } = await markSourceAsBadAndResolveNext(
        track.artist,
        track.title,
        videoId,
        track.duration,
        reason,
        videoTitle
      );

      refreshBlocked();

      if (newVideoId) {
        if (isCurrentlyPlayingThisTrack) {
          await audioEngine.switchSource(newVideoId);
        } else {
          await switchAudioSource(track, newVideoId);
        }
        setActiveVideoId(newVideoId);
        setStatusBanner({
          text: 'Source marked as bad (audio watermark)! Switched to next clean version.',
          type: 'success',
        });
      } else {
        setStatusBanner({
          text: 'Source marked as bad, but no clean candidates found.',
          type: 'info',
        });
      }

      // Re-fetch candidate list with updated blacklist tags
      const updatedList = await getCandidatesForTrack(track.artist, track.title, track.duration);
      setCandidates(updatedList);
    } catch (err: any) {
      setStatusBanner({
        text: err?.message || 'Failed to switch source',
        type: 'error',
      });
    } finally {
      setIsSwitching(false);
    }
  };

  const handleSelectCandidate = async (candidate: YouTubeCandidate) => {
    if (isSwitching || candidate.videoId === activeVideoId) return;
    setIsSwitching(true);
    setStatusBanner(null);

    try {
      if (isCurrentlyPlayingThisTrack) {
        await audioEngine.switchSource(candidate.videoId);
      } else {
        await switchAudioSource(track, candidate.videoId);
      }
      setActiveVideoId(candidate.videoId);
      refreshBlocked();

      // If it was previously marked bad, unmark it
      if (badSourceService.isBad(candidate.videoId)) {
        badSourceService.unmarkBad(candidate.videoId);
        const updatedList = await getCandidatesForTrack(track.artist, track.title, track.duration);
        setCandidates(updatedList);
        refreshBlocked();
      }

      setStatusBanner({
        text: `Switched audio source to: "${candidate.title}"`,
        type: 'success',
      });
    } catch (err: any) {
      setStatusBanner({
        text: err?.message || 'Failed to switch to candidate',
        type: 'error',
      });
    } finally {
      setIsSwitching(false);
    }
  };

  const handleUnblock = async (videoId: string) => {
    badSourceService.unmarkBad(videoId);
    refreshBlocked();
    if (track) {
      const updatedList = await getCandidatesForTrack(track.artist, track.title, track.duration);
      setCandidates(updatedList);
    }
    setStatusBanner({
      text: 'Source unblocked and restored to candidate pool.',
      type: 'info',
    });
  };

  const modalContent = (
    <div
      data-testid="audio-source-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeSourceModal();
      }}
    >
      <div
        data-testid="audio-source-modal"
        className="relative w-full max-w-xl max-h-[90vh] bg-surface border border-customBorder rounded-2xl shadow-2xl flex flex-col overflow-hidden text-primary animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-customBorder/60 bg-elevated/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-accent/15 text-accent flex items-center justify-center">
              <Radio size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">Audio Source & Watermark Fixer</h2>
              <p className="text-xs text-secondary">
                Exclude bad versions with voice drops, watermarks, or poor rips
              </p>
            </div>
          </div>
          <button
            onClick={closeSourceModal}
            className="p-1.5 rounded-full text-secondary hover:text-primary hover:bg-elevated transition-colors"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Track Snapshot Pill */}
        <div className="flex items-center gap-3.5 px-6 py-3 bg-base/60 border-b border-customBorder/40">
          <img
            src={getTrackArtwork(track)}
            alt={track.title}
            className="w-12 h-12 rounded-lg object-cover bg-elevated shadow-sm flex-shrink-0"
            onError={(e) => {
              const target = e.currentTarget;
              if (target.src !== DEFAULT_MUSIC_ARTWORK) {
                target.src = DEFAULT_MUSIC_ARTWORK;
                resolveTrackArtwork(track.artist, track.title).then((url) => {
                  if (url && !isUglyPlaceholder(url)) target.src = url;
                });
              }
            }}
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold truncate leading-tight text-primary">
              {track.title}
            </h3>
            <p className="text-xs text-secondary truncate mt-0.5">
              {track.artist}
              {track.album ? ` • ${track.album}` : ''}
            </p>
          </div>

          <button
            onClick={loadCandidates}
            disabled={isLoading || isSwitching}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-secondary hover:text-primary hover:bg-elevated rounded-lg transition-colors disabled:opacity-50"
            title="Re-scan YouTube for candidates"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Status Toast Banner */}
        {statusBanner && (
          <div
            className={`px-6 py-2.5 text-xs flex items-center gap-2 border-b transition-all ${
              statusBanner.type === 'success'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : statusBanner.type === 'error'
                ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                : 'bg-accent/15 text-accent border-accent/30'
            }`}
          >
            {statusBanner.type === 'success' ? (
              <CheckCircle2 size={15} className="shrink-0" />
            ) : statusBanner.type === 'error' ? (
              <AlertTriangle size={15} className="shrink-0" />
            ) : (
              <ShieldCheck size={15} className="shrink-0" />
            )}
            <span className="flex-1 font-medium">{statusBanner.text}</span>
          </div>
        )}

        {/* Current Active Source Box */}
        <div className="px-6 py-3.5 bg-elevated/20 border-b border-customBorder/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
              <Disc3 size={13} className="text-accent" />
              Active Audio Stream
            </span>
            {activeVideoId && (
              <a
                href={`https://www.youtube.com/watch?v=${activeVideoId}`}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-secondary hover:text-accent flex items-center gap-1 transition-colors"
                title="Preview video directly on YouTube"
              >
                <span>yt:{activeVideoId}</span>
                <ExternalLink size={11} />
              </a>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-xl bg-elevated border border-customBorder/80">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-primary truncate">
                {activeCandidate?.title || (activeVideoId ? `YouTube Candidate [${activeVideoId}]` : 'Resolving best source...')}
              </p>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-muted">
                {activeCandidate?.duration ? (
                  <span>Duration: {formatDuration(activeCandidate.duration)}</span>
                ) : null}
                {isCurrentlyPlayingThisTrack && (
                  <span className="px-1.5 py-0.5 rounded bg-accent/20 text-accent font-semibold text-[10px]">
                    {isPlaying ? 'Now Playing' : 'Current'}
                  </span>
                )}
              </div>
            </div>

            {activeVideoId && (
              <button
                onClick={() => handleMarkAsBad(activeVideoId, activeCandidate?.title || undefined)}
                disabled={isSwitching}
                className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-rose-500/25 active:scale-95 transition-all cursor-pointer disabled:opacity-50 shrink-0"
                title="Mark this video source as bad (voice drops, watermark, or wrong audio) and switch to the next cleanest candidate"
              >
                <AlertTriangle size={13} />
                <span>Mark as Bad (Watermark)</span>
              </button>
            )}
          </div>
        </div>

        {/* Tab Navigation (Candidates vs Blocked History) */}
        <div className="flex items-center px-6 pt-3 border-b border-customBorder/40 gap-4 text-xs font-medium">
          <button
            onClick={() => setModalTab('candidates')}
            className={`pb-2 border-b-2 transition-all ${
              modalTab === 'candidates'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            Alternative Sources ({candidates.length})
          </button>
          <button
            onClick={() => {
              refreshBlocked();
              setModalTab('blocked');
            }}
            className={`pb-2 border-b-2 transition-all ${
              modalTab === 'blocked'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            Blocked Sources ({blockedSources.length})
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-3 min-h-[220px]">
          {modalTab === 'candidates' ? (
            isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted gap-3">
                <RefreshCw size={24} className="animate-spin text-accent" />
                <span className="text-xs">Searching YouTube for alternative sources...</span>
              </div>
            ) : candidates.length === 0 ? (
              <div className="text-center py-10 text-muted text-xs">
                No alternative audio candidates found.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {candidates.map((cand, idx) => {
                  const isActive = cand.videoId === activeVideoId;
                  const isBad = Boolean(cand.isBad);

                  return (
                    <div
                      key={cand.videoId}
                      className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition-all ${
                        isActive
                          ? 'bg-accent/10 border-accent/40 shadow-sm'
                          : isBad
                          ? 'bg-elevated/30 border-rose-500/20 opacity-60'
                          : 'bg-elevated/60 border-customBorder hover:border-customBorder/80'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-muted w-4">
                            #{idx + 1}
                          </span>
                          <p
                            className={`text-xs font-semibold truncate ${
                              isActive ? 'text-accent' : isBad ? 'text-rose-300' : 'text-primary'
                            }`}
                            title={cand.title}
                          >
                            {cand.title}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 mt-1 ml-6 text-[11px] text-muted">
                          <span className="font-mono">{formatDuration(cand.duration)}</span>
                          {isActive && (
                            <span className="px-1.5 py-0.2 rounded bg-accent/20 text-accent font-bold text-[10px]">
                              Active
                            </span>
                          )}
                          {isBad && (
                            <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-400 font-semibold text-[10px]">
                              Blocked (Watermark)
                            </span>
                          )}
                          <a
                            href={`https://www.youtube.com/watch?v=${cand.videoId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-secondary hover:text-accent inline-flex items-center gap-0.5 transition-colors"
                          >
                            <span>yt:{cand.videoId}</span>
                            <ExternalLink size={10} />
                          </a>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isBad ? (
                          <button
                            onClick={() => handleUnblock(cand.videoId)}
                            className="px-2.5 py-1 text-xs rounded-lg bg-elevated hover:bg-highlight border border-customBorder text-secondary hover:text-primary transition-colors flex items-center gap-1"
                            title="Unblock candidate"
                          >
                            <RotateCcw size={12} />
                            <span>Unblock</span>
                          </button>
                        ) : isActive ? (
                          <button
                            onClick={() => handleMarkAsBad(cand.videoId, cand.title)}
                            disabled={isSwitching}
                            className="px-2.5 py-1 text-xs rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 transition-colors flex items-center gap-1"
                            title="Mark this active source as bad (watermark)"
                          >
                            <AlertTriangle size={12} />
                            <span>Mark Bad</span>
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => handleSelectCandidate(cand)}
                              disabled={isSwitching}
                              className="px-3 py-1 text-xs font-semibold rounded-lg bg-accent text-accent-content hover:scale-105 active:scale-95 transition-all flex items-center gap-1"
                              title="Switch to this source"
                            >
                              <Play size={11} fill="currentColor" />
                              <span>Use Source</span>
                            </button>
                            <button
                              onClick={() => handleMarkAsBad(cand.videoId, cand.title)}
                              disabled={isSwitching}
                              className="p-1.5 rounded-lg text-secondary hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                              title="Mark as bad (watermark) so it never plays"
                            >
                              <AlertTriangle size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            /* Blocked Sources Tab */
            blockedSources.length === 0 ? (
              <div className="text-center py-10 text-muted text-xs">
                No sources are currently blocked.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs text-muted mb-1 px-1">
                  <span>Blocked YouTube video IDs ({blockedSources.length})</span>
                  <button
                    onClick={() => {
                      badSourceService.clearAll();
                      refreshBlocked();
                      loadCandidates();
                    }}
                    className="text-secondary hover:text-rose-400 transition-colors text-[11px]"
                  >
                    Clear All Blocked
                  </button>
                </div>
                {blockedSources.map((item) => (
                  <div
                    key={item.videoId}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl bg-elevated/40 border border-customBorder text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-primary truncate">
                        {item.title ? `${item.artist} - ${item.title}` : `yt:${item.videoId}`}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted">
                        <span className="text-rose-400 font-medium">
                          {item.reason === 'audio_watermark' ? 'Audio watermark' : item.reason}
                        </span>
                        <span>•</span>
                        <a
                          href={`https://www.youtube.com/watch?v=${item.videoId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-accent flex items-center gap-0.5"
                        >
                          <span>{item.videoId}</span>
                          <ExternalLink size={10} />
                        </a>
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnblock(item.videoId)}
                      className="px-2.5 py-1 text-xs rounded-lg bg-elevated hover:bg-highlight border border-customBorder text-secondary hover:text-primary transition-colors flex items-center gap-1 shrink-0"
                    >
                      <RotateCcw size={12} />
                      <span>Restore</span>
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* Footer info note */}
        <div className="px-6 py-2.5 bg-base border-t border-customBorder/40 text-[11px] text-muted flex items-center justify-between">
          <span>Marked sources are permanently blacklisted and never chosen again.</span>
          <button
            onClick={closeSourceModal}
            className="px-4 py-1 text-xs font-medium rounded-lg bg-elevated hover:bg-highlight transition-colors text-primary"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
