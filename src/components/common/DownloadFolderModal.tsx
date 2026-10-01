import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, FolderOpen, Loader2, CheckCircle2, AlertTriangle, RotateCcw } from 'lucide-react';
import {
  fetchDownloadDir,
  pickDownloadFolderViaSystemBrowser,
  setDownloadFolder,
  type DownloadDirInfo,
} from '../../services/downloadFolderService';
import { useMp3VaultStore } from '../../services/mp3VaultService';

interface Props {
  open: boolean;
  onClose: () => void;
}

export const DownloadFolderModal: React.FC<Props> = ({ open, onClose }) => {
  const { refreshVault } = useMp3VaultStore();
  const [info, setInfo] = useState<DownloadDirInfo | null>(null);
  const [inputPath, setInputPath] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuccess(null);
    setIsLoading(true);
    fetchDownloadDir()
      .then((dir) => {
        setInfo(dir);
        // Initial value is the current download location until the user changes it
        setInputPath(dir.customPath || dir.path);
      })
      .catch((err) => {
        setError(err?.message || 'Could not load the current download folder');
      })
      .finally(() => setIsLoading(false));
  }, [open ]);

  if (!open) return null;

  const handleBrowse = async () => {
    setError(null);
    setIsPicking(true);
    try {
      const picked = await pickDownloadFolderViaSystemBrowser(info?.path);
      if (picked) {
        // Web File System Access API only yields a folder name hint; Tauri yields a full path.
        // If it looks like a bare name (no separator), append it to the current parent
        // so the user can review a usable absolute path before saving.
        if (!picked.match(/[\\/]/) && info?.path) {
          const sep = info.path.includes('\\') ? '\\' : '/';
          const parent = info.path.replace(/[\\/][^\\/]*$/, '');
          setInputPath(`${parent}${sep}${picked}`);
          setError(
            'Your browser only revealed the folder name — please review the full path above before saving.'
          );
        } else {
          setInputPath(picked);
        }
      }
    } finally {
      setIsPicking(false);
    }
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    const target = inputPath.trim();
    if (!target) {
      setError('Please choose a download folder');
      return;
    }
    setIsSaving(true);
    try {
      const updated = await setDownloadFolder(target);
      setInfo(updated);
      setInputPath(updated.path);
      const moved = Number(updated.movedCount || 0);
      setSuccess(
        moved > 0
          ? `Download folder updated. Moved ${moved} file${moved === 1 ? '' : 's'} to the new folder.`
          : 'Download folder updated.'
      );
      // Reload the vault so track paths + folder display reflect the new location
      refreshVault().catch(() => {});
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not set download folder');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefault = async () => {
    if (!info?.defaultPath) return;
    setInputPath(info.defaultPath);
    setError(null);
    setSuccess(null);
  };

  // Portal to document.body: TopBar has backdrop-blur-md which creates a CSS
  // containing block that traps position:fixed descendants. Without a portal
  // the modal is clipped inside the header and appears invisible.
  const modalContent = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      data-testid="download-folder-modal-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Download folder settings"
        data-testid="download-folder-modal"
        className="w-full max-w-md bg-surface border border-customBorder rounded-2xl shadow-2xl p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-accent/15 text-accent">
              <FolderOpen size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-primary">Download Folder</h2>
              <p className="text-[11px] text-secondary">Stored on this device only</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close download folder settings"
            className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-secondary py-6 justify-center">
            <Loader2 size={15} className="animate-spin text-accent" />
            <span>Loading current download folder…</span>
          </div>
        ) : (
          <>
            <div className="p-3 rounded-xl bg-elevated/50 border border-customBorder/60">
              <p className="text-[11px] font-bold text-muted uppercase tracking-wide">
                Current folder (this device)
              </p>
              <p
                className="text-xs text-primary font-mono break-all mt-1"
                data-testid="download-folder-current-path"
              >
                {info?.path || '—'}
              </p>
              {info && !info.writable && (
                <p className="flex items-center gap-1.5 text-[11px] text-amber-400 mt-1.5">
                  <AlertTriangle size={12} />
                  <span>This folder is not writable. Choose another folder below.</span>
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="download-folder-input"
                className="text-[11px] font-bold text-secondary uppercase tracking-wide"
              >
                New download folder
              </label>
              <div className="flex gap-2">
                <input
                  id="download-folder-input"
                  type="text"
                  value={inputPath}
                  onChange={(e) => setInputPath(e.target.value)}
                  placeholder="C:\Users\You\Music\Dotify"
                  spellCheck={false}
                  autoComplete="off"
                  data-testid="download-folder-path-input"
                  className="flex-1 min-w-0 bg-base border border-customBorder rounded-xl px-3 py-2 text-xs text-primary font-mono placeholder:text-muted placeholder:font-sans focus:outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={handleBrowse}
                  disabled={isPicking || isSaving}
                  data-testid="download-folder-browse-btn"
                  className="px-3 py-2 rounded-xl bg-elevated hover:bg-highlight border border-customBorder text-xs font-bold text-primary flex items-center gap-1.5 flex-shrink-0 transition-colors cursor-pointer disabled:opacity-50"
                  title="Choose a folder with the system file browser"
                >
                  {isPicking ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <FolderOpen size={14} className="text-accent" />
                  )}
                  <span>{isPicking ? 'Browsing…' : 'Browse…'}</span>
                </button>
              </div>
              <p className="text-[11px] text-muted leading-relaxed">
                Uses your system file browser. The folder is checked to be writable, and
                currently downloaded files are moved there automatically.
              </p>
            </div>

            {error && (
              <div
                data-testid="download-folder-error"
                className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold flex items-start gap-2"
              >
                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div
                data-testid="download-folder-success"
                className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold flex items-start gap-2"
              >
                <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
                <span>{success}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={handleResetToDefault}
                disabled={!info?.defaultPath || isSaving}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold text-secondary hover:text-primary transition-colors cursor-pointer disabled:opacity-40"
                title="Reset to the original download location"
              >
                <RotateCcw size={13} />
                <span>Reset to default</span>
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-secondary hover:text-primary transition-colors cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || isLoading}
                  data-testid="download-folder-save-btn"
                  className="px-4 py-2 rounded-xl bg-accent hover:brightness-110 text-white text-xs font-extrabold shadow-md flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSaving && <Loader2 size={13} className="animate-spin" />}
                  <span>{isSaving ? 'Moving files…' : 'Set Download Folder'}</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
};
