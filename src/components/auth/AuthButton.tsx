import React, { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { LogOut, Cloud, Loader2, User as UserIcon } from 'lucide-react';

export const AuthButton: React.FC = () => {
  const { user, isLoading, isSyncing, signOut, openAuthModal } = useAuthStore();
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
      <button
        onClick={openAuthModal}
        data-testid="google-signin-btn"
        className="flex items-center gap-1.5 p-2 sm:px-3.5 sm:py-1.5 rounded-full bg-elevated hover:bg-highlight sm:bg-accent sm:hover:brightness-110 sm:text-accent-content text-secondary hover:text-primary text-xs font-bold transition-all active:scale-95 flex-shrink-0"
        title="Sign in to sync your library across devices"
      >
        <UserIcon size={16} />
        <span className="hidden sm:inline">Sign In</span>
      </button>
    );
  }

  const firstName = user.displayName ? user.displayName.split(' ')[0] : 'User';

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        data-testid="user-profile-btn"
        className="flex items-center gap-2 bg-elevated hover:bg-highlight p-1 pr-2.5 rounded-full border border-customBorder transition-all"
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
          className={`w-2 h-2 rounded-full ${isSyncing ? 'bg-amber-400 animate-pulse' : 'bg-accent'}`}
          title={isSyncing ? 'Syncing library...' : 'Cloud Synced'}
        />
      </button>

      {isOpen && (
        <div
          data-testid="user-dropdown-menu"
          className="absolute right-0 mt-2 w-56 bg-surface border border-customBorder rounded-xl shadow-2xl p-2 z-50 flex flex-col gap-1.5 animate-in fade-in select-none"
        >
          <div className="px-3 py-2 border-b border-customBorder/50">
            <p className="text-xs font-bold text-primary truncate">{user.displayName || 'Dotify Listener'}</p>
            <p className="text-[11px] text-muted truncate">{user.email}</p>
            <div className="flex items-center gap-1 mt-1 text-[10px] text-accent font-semibold">
              <Cloud size={12} />
              <span>Personal library cloud synced</span>
            </div>
          </div>

          <button
            onClick={async () => {
              setIsOpen(false);
              await signOut();
            }}
            data-testid="signout-btn"
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-500/10 rounded-lg transition-colors text-left"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </div>
  );
};
