import React from 'react';
import { Track } from '../../types/track';
import { useMp3VaultStore } from '../../services/mp3VaultService';
import { Download, Loader2, CheckCircle2, Trash2, Wifi } from 'lucide-react';

interface SaveMp3ButtonProps {
  track: Track;
  size?: number;
  showDeleteWhenSaved?: boolean;
  className?: string;
}

export const SaveMp3Button: React.FC<SaveMp3ButtonProps> = ({
  track,
  size = 16,
  showDeleteWhenSaved = true,
  className = '',
}) => {
  const {
    savedTracks,
    peerTracks,
    savingTrackIds,
    saveTrackAsMp3,
    deleteSavedMp3,
    exportMp3File,
  } = useMp3VaultStore();

  if (!track || !track.id || track.source === 'radio') return null;

  const isSaved = savedTracks.some((t) => t.id === track.id);
  const isSaving = savingTrackIds.includes(track.id);
  const peerMatch = !isSaved ? peerTracks.find((pt) => pt.id === track.id) : undefined;

  if (isSaving) {
    return (
      <span
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center justify-center p-1 text-accent ${className}`}
        title="Saving MP3..."
      >
        <Loader2 size={size} className="animate-spin" />
      </span>
    );
  }

  if (isSaved) {
    return (
      <span
        onClick={(e) => e.stopPropagation()}
        className={`inline-flex items-center gap-1 ${className}`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            exportMp3File(track);
          }}
          data-testid={`saved-mp3-badge-${track.id}`}
          className="p-1 text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
          title="Saved as MP3 on this device (Click to export .mp3 file)"
        >
          <CheckCircle2 size={size} />
        </button>
        {showDeleteWhenSaved && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              deleteSavedMp3(track.id, false);
            }}
            data-testid={`delete-mp3-btn-${track.id}`}
            className="p-1 text-muted hover:text-red-400 transition-colors cursor-pointer"
            title="Delete saved MP3 from this device"
          >
            <Trash2 size={Math.max(12, size - 2)} />
          </button>
        )}
      </span>
    );
  }

  if (peerMatch) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const peerUrl = `http://${peerMatch.peerIp}:${peerMatch.peerPort || 3001}/api/mp3s/file/${encodeURIComponent(
            track.id
          )}`;
          saveTrackAsMp3(track, 'manual_download', peerUrl, peerMatch.peerDeviceName);
        }}
        data-testid={`wifi-pull-mp3-btn-${track.id}`}
        className={`p-1 text-sky-400 hover:text-sky-300 transition-colors cursor-pointer ${className}`}
        title={`On WiFi (${peerMatch.peerDeviceName}) — Click to pull MP3 to this device`}
      >
        <Wifi size={size} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        saveTrackAsMp3(track, 'manual_download');
      }}
      data-testid={`download-mp3-btn-${track.id}`}
      className={`p-1 text-secondary hover:text-accent transition-colors cursor-pointer ${className}`}
      title="Download & Save as MP3"
    >
      <Download size={size} />
    </button>
  );
};
