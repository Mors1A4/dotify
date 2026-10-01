import React, { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useUpgradeStore } from '../../store/upgradeStore';
import { LogOut, Cloud, Loader2, User as UserIcon, Wand2, FolderOpen } from 'lucide-react';
import { ColourSchemeSection } from '../theme/ColourSchemeSection';
import { DownloadFolderModal } from '../common/DownloadFolderModal';
import { fetchDownloadDir } from '../../services/downloadFolderService';

export const AuthButton: React.FC = () => {
  const { user, isLoading, isSyncing, signOut, openAuthModal } = useAuthStore();
  const { openHelpModal, requests: upgradeRequests } = useUpgradeStore();
  const hasProcessingUpgrade = upgradeRequests.some((r) => r.status === 'processing');

  const [isOpen, setIsOpen] = useState(false);
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [downloadPath, setDownloadPath] = useState<string>('');
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Per-client download folder (device-local, never per-user): refresh whenever the
  // profile menu opens so the button subtitle always shows this device's folder.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchDownloadDir()
      .then((info) => {
        if (!cancelled) setDownloadPath(info.path);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const openDownloadSettings = () => {
    setIsOpen(false);
    setIsDownloadModalOpen(true);
  };

  const closeDownloadSettings = () => {
    setIsDownloadModalOpen(false);
    fetchDownloadDir()
      .then((info) => setDownloadPath(info.path))
      .catch(() => {});
  };

  if (isLoading) {
    return (
      <div className="h-8 w-8 rounded-full bg-elevated flex items-center justify-center animate-pulse">
        <Loader2 size={15} className="animate-spin text-muted" />
      </div>
    );
  }

  if (!user) {
    return (
      <>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          data-testid="guest-profile-btn"
          aria-label="Profile and settings"
          aria-expanded={isOpen}
          className="relative flex items-center gap-1.5 p-1.5 sm:px-3 sm:py-1.5 rounded-full bg-elevated hover:bg-highlight border border-customBorder text-secondary hover:text-primary text-xs font-semibold transition-all active:scale-95 flex-shrink-0 cursor-pointer"
          title="Account, Sign In & Help"
        >
          <div className="w-5 h-5 rounded-full bg-surface/80 flex items-center justify-center text-secondary">
            <UserIcon size={13} />
          </div>
          <span className="hidden sm:inline">Sign In</span>
          {hasProcessingUpgrade && (
            <span
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent animate-ping"
              title="OpenCode upgrade running..."
            />
          )}
        </button>

        {isOpen && (
          <div
            data-testid="guest-dropdown-menu"
            className="absolute right-0 mt-2 w-64 bg-surface border border-customBorder rounded-2xl shadow-2xl p-2.5 z-50 flex flex-col gap-1.5 animate-in fade-in select-none"
          >
            <div className="px-3 py-2.5 border-b border-customBorder/50">
              <p className="text-xs font-bold text-primary">Guest Session</p>
              <p className="text-[11px] text-secondary mt-0.5 leading-relaxed">
                Sign in to sync your playlists and library across PC and phone.
              </p>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  openAuthModal();
                }}
                data-testid="google-signin-btn"
                className="mt-2.5 w-full py-2 px-3 rounded-xl bg-accent hover:brightness-110 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md shadow-accent/20"
              >
                <UserIcon size={14} />
                <span>Sign In with Google</span>
              </button>
            </div>

            {/* Colour scheme (moved from TopBar to save title space) */}
            <ColourSchemeSection />

            {/* Download folder (per-client: this device only, OS paths differ) */}
            <div className="rounded-xl border border-customBorder/60 bg-elevated/30 px-1 py-1">
              <p className="px-2 pt-1 text-[10px] font-bold uppercase tracking-wide text-muted">
                Downloads · This device
              </p>
              <button
                type="button"
                onClick={openDownloadSettings}
                data-testid="profile-download-folder-btn"
                title={downloadPath || 'Set the folder where MP3 downloads are saved on this device'}
                className="w-full flex items-center justify-between px-2 py-2 text-xs font-medium text-secondary hover:text-primary hover:bg-elevated/70 rounded-lg transition-colors text-left group cursor-pointer"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FolderOpen size={16} className="text-accent flex-shrink-0" />
                  <div className="min-w-0">
                    <span className="block font-semibold text-primary">Download Folder</span>
                    <span
                      className="block text-[10px] text-muted font-mono truncate max-w-[180px]"
                      data-testid="profile-download-folder-path"
                    >
                      {downloadPath || 'Choose where MP3s are saved…'}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-accent px-2 py-1 rounded-md bg-accent/15 border border-accent/25 flex-shrink-0 ml-2">
                  Change
                </span>
              </button>
            </div>

            {/* Help & AI Studio */}
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                openHelpModal();
              }}
              data-testid="profile-help-upgrade-btn"
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium text-secondary hover:text-primary hover:bg-elevated/70 rounded-xl transition-colors text-left group cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <Wand2
                  size={15}
                  className={hasProcessingUpgrade ? 'text-accent animate-spin' : 'text-accent group-hover:rotate-12 transition-transform'}
                />
                <span>Help & AI Studio</span>
              </div>
              {hasProcessingUpgrade ? (
                <span className="text-[10px] font-bold text-accent animate-pulse px-2 py-0.5 rounded-full bg-accent/15 border border-accent/25">
                  Upgrading...
                </span>
              ) : (
                <span className="text-[10px] text-muted font-mono px-2 py-0.5 rounded-md bg-elevated border border-customBorder/50">
                  Studio
                </span>
              )}
            </button>
          </div>
        )}
      </div>
      <DownloadFolderModal open={isDownloadModalOpen} onClose={closeDownloadSettings} />
    </>
    );
  }

  const firstName = user.displayName ? user.displayName.split(' ')[0] : 'User';

  return (
    <>
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        data-testid="user-profile-btn"
        aria-label="User profile"
        aria-expanded={isOpen}
        className="relative flex items-center gap-2 bg-elevated hover:bg-highlight p-1 pr-2.5 rounded-full border border-customBorder transition-all cursor-pointer"
        title={`Signed in as ${user.displayName || user.email}`}
      >
        <img
          src={user.photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=60&h=60&fit=crop'}
          alt={user.displayName || 'Profile'}
          className="w-6 h-6 rounded-full object-cover"
        />
        <span className="text-xs font-semibold text-primary max-w-[90px] truncate hidden sm:inline">
          {firstName}
        </span>
        <span
          className={`w-2 h-2 rounded-full ${
            hasProcessingUpgrade
              ? 'bg-accent animate-ping'
              : isSyncing
              ? 'bg-amber-400 animate-pulse'
              : 'bg-accent'
          }`}
          title={
            hasProcessingUpgrade
              ? 'OpenCode upgrade running...'
              : isSyncing
              ? 'Syncing library...'
              : 'Cloud Synced'
          }
        />
      </button>

      {isOpen && (
        <div
          data-testid="user-dropdown-menu"
          className="absolute right-0 mt-2 w-60 bg-surface border border-customBorder rounded-2xl shadow-2xl p-2.5 z-50 flex flex-col gap-1.5 animate-in fade-in select-none"
        >
          <div className="px-3 py-2.5 border-b border-customBorder/50">
            <p className="text-xs font-bold text-primary truncate">{user.displayName || 'Dotify Listener'}</p>
            <p className="text-[11px] text-muted truncate">{user.email}</p>
            <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-accent font-semibold">
              <Cloud size={12} />
              <span>Personal library cloud synced</span>
            </div>
          </div>

          {/* Colour scheme (moved from TopBar to save title space) */}
          <ColourSchemeSection />

          {/* Download folder (per-client: this device only, OS paths differ) */}
          <div className="rounded-xl border border-customBorder/60 bg-elevated/30 px-1 py-1">
            <p className="px-2 pt-1 text-[10px] font-bold uppercase tracking-wide text-muted">
              Downloads · This device
            </p>
            <button
              type="button"
              onClick={openDownloadSettings}
              data-testid="profile-download-folder-btn"
              title={downloadPath || 'Set the folder where MP3 downloads are saved on this device'}
              className="w-full flex items-center justify-between px-2 py-2 text-xs font-medium text-secondary hover:text-primary hover:bg-elevated/70 rounded-lg transition-colors text-left group cursor-pointer"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <FolderOpen size={16} className="text-accent flex-shrink-0" />
                <div className="min-w-0">
                  <span className="block font-semibold text-primary">Download Folder</span>
                  <span
                    className="block text-[10px] text-muted font-mono truncate max-w-[160px]"
                    data-testid="profile-download-folder-path"
                  >
                    {downloadPath || 'Choose where MP3s are saved…'}
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-bold text-accent px-2 py-1 rounded-md bg-accent/15 border border-accent/25 flex-shrink-0 ml-2">
                Change
              </span>
            </button>
          </div>

          {/* Help & AI Studio item */}
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              openHelpModal();
            }}
            data-testid="profile-help-upgrade-btn"
            className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium text-secondary hover:text-primary hover:bg-elevated/70 rounded-xl transition-colors text-left group cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Wand2
                size={15}
                className={hasProcessingUpgrade ? 'text-accent animate-spin' : 'text-accent group-hover:rotate-12 transition-transform'}
              />
              <span>Help & AI Studio</span>
            </div>
            {hasProcessingUpgrade ? (
              <span className="text-[10px] font-bold text-accent animate-pulse px-2 py-0.5 rounded-full bg-accent/15 border border-accent/25">
                Upgrading...
              </span>
            ) : (
              <span className="text-[10px] text-muted font-mono px-2 py-0.5 rounded-md bg-elevated border border-customBorder/50">
                Studio
              </span>
            )}
          </button>

          <div className="h-px bg-customBorder/50 my-0.5" />

          <button
            type="button"
            onClick={async () => {
              setIsOpen(false);
              await signOut();
            }}
            data-testid="signout-btn"
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors text-left cursor-pointer"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </div>
    <DownloadFolderModal open={isDownloadModalOpen} onClose={closeDownloadSettings} />
    </>
  );
};
