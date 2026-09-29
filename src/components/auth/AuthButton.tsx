import React, { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useUpgradeStore } from '../../store/upgradeStore';
import { LogOut, Cloud, Loader2, User as UserIcon, Wand2 } from 'lucide-react';
import { ColourSchemeSection } from '../theme/ColourSchemeSection';

export const AuthButton: React.FC = () => {
  const { user, isLoading, isSyncing, signOut, openAuthModal } = useAuthStore();
  const { openHelpModal, requests: upgradeRequests } = useUpgradeStore();
  const hasProcessingUpgrade = upgradeRequests.some((r) => r.status === 'processing');

  const [isOpen, setIsOpen] = useState(false);
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

  if (isLoading) {
    return (
      <div className="h-8 w-8 rounded-full bg-elevated flex items-center justify-center animate-pulse">
        <Loader2 size={15} className="animate-spin text-muted" />
      </div>
    );
  }

  if (!user) {
    return (
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
    );
  }

  const firstName = user.displayName ? user.displayName.split(' ')[0] : 'User';

  return (
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
  );
};
