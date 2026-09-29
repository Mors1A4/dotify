import React, { useState } from 'react';
import { fetchSpotifyPreview, saveSpotifyPlaylistToStore } from '../../services/spotifyImporter';
import { SpotifyImportPreview } from '../../types/playlist';
import { X, Sparkles, Loader2, Check } from 'lucide-react';
import { DEFAULT_MUSIC_ARTWORK } from '../../services/artworkService';
import { usePlayerStore } from '../../store/playerStore';

interface SpotifyImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (playlistId: string) => void;
}

export const SpotifyImportModal: React.FC<SpotifyImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const { playlists } = usePlayerStore();
  const [urlInput, setUrlInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<SpotifyImportPreview | null>(null);

  if (!isOpen) return null;

  const handleResolve = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!urlInput.trim()) return;

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await fetchSpotifyPreview(urlInput);
      setPreview(result);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to resolve Spotify link. Ensure the playlist is public.');
      setPreview(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = () => {
    if (!preview) return;
    const playlistId = saveSpotifyPlaylistToStore(preview);
    onImportSuccess(playlistId);
    onClose();
  };

  return (
    <div
      data-testid="spotify-import-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-base/80 backdrop-blur-md animate-in fade-in"
    >
      <div className="relative w-full max-w-lg bg-surface border border-customBorder rounded-2xl shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-customBorder/50 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#1DB954]/20 flex items-center justify-center text-[#1DB954]">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="font-bold text-base text-primary">Import Spotify Playlist</h3>
              <p className="text-xs text-secondary">Zero-auth embed scraper • No Spotify login required</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-secondary hover:text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* URL Input Form */}
        <form onSubmit={handleResolve} className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-muted uppercase tracking-wider">
            Spotify Playlist, Album, or Track Link
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              data-testid="spotify-url-input"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://open.spotify.com/playlist/..."
              className="flex-1 bg-elevated border border-customBorder rounded-xl px-3.5 py-2.5 text-sm text-primary placeholder-muted focus:outline-none focus:border-accent transition-colors"
            />
            <button
              type="submit"
              data-testid="resolve-spotify-btn"
              disabled={isLoading || !urlInput.trim()}
              className="px-4 py-2.5 rounded-xl bg-accent text-accent-content font-bold text-xs flex items-center gap-1.5 shadow hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 transition-all"
            >
              {isLoading ? <Loader2 size={14} className="animate-spin" /> : <span>Resolve</span>}
            </button>
          </div>
        </form>

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            {errorMessage}
          </div>
        )}

        {/* Resolved Preview Card */}
        {preview && (
          <div className="flex flex-col gap-4 p-4 rounded-xl bg-elevated/70 border border-accent/30 animate-in fade-in">
            <div className="flex items-center gap-4">
              <img
                src={preview.playlistCoverUrl || DEFAULT_MUSIC_ARTWORK}
                alt={preview.playlistTitle}
                className="w-16 h-16 rounded-lg object-cover shadow-md bg-highlight shrink-0"
              />
              <div className="min-w-0 flex-1">
                <h4 className="font-bold text-sm text-primary truncate">{preview.playlistTitle}</h4>
                <p className="text-xs text-secondary truncate mt-0.5">{preview.playlistDescription}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-accent/20 text-accent">
                    {preview.totalTracks} tracks
                  </span>
                  {preview.unresolvedCount > 0 && (
                    <span className="text-[11px] text-muted">
                      ({preview.resolvedTracks.length} ready)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Sample Track Preview */}
            <div className="flex flex-col gap-1 max-h-36 overflow-y-auto border-t border-customBorder/40 pt-2 pr-1">
              <span className="text-[10px] uppercase font-bold text-muted tracking-wider">Tracks Included</span>
              {preview.resolvedTracks.slice(0, 10).map((t, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs py-1 px-1.5 rounded hover:bg-highlight/50">
                  <span className="truncate text-primary flex-1">{idx + 1}. {t.title}</span>
                  <span className="text-muted text-[11px] truncate max-w-[120px] text-right">{t.artist}</span>
                </div>
              ))}
              {preview.resolvedTracks.length > 10 && (
                <span className="text-[11px] text-muted italic text-center py-1">
                  + {preview.resolvedTracks.length - 10} more tracks
                </span>
              )}
            </div>

            {/* Existing Playlist Notice & Save Button */}
            {(() => {
              const existingPlaylist = preview
                ? playlists.find(
                    (p) =>
                      (preview.sourceUrl && p.sourceSpotifyUrl?.trim().toLowerCase() === preview.sourceUrl.trim().toLowerCase()) ||
                      p.name.trim().toLowerCase() === preview.playlistTitle.trim().toLowerCase()
                  )
                : null;

              return (
                <div className="flex flex-col gap-2.5">
                  {existingPlaylist && (
                    <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-accent/15 border border-accent/30 text-accent text-xs font-semibold">
                      <Check size={14} className="shrink-0" />
                      <span>This playlist is already in your library</span>
                    </div>
                  )}
                  <button
                    onClick={handleSave}
                    data-testid="save-spotify-playlist-btn"
                    className="w-full py-3 rounded-xl bg-[#1DB954] hover:bg-[#1ed760] text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                  >
                    <Check size={16} />
                    <span>
                      {existingPlaylist ? 'Already in Library • Open Playlist' : 'Save as Dotify Playlist'}
                    </span>
                  </button>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
};
