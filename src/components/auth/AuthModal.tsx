import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '../../store/authStore';
import { X, Loader2, Zap, User as UserIcon } from 'lucide-react';

interface AuthModalProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen: propIsOpen, onClose: propOnClose }) => {
  const storeIsOpen = useAuthStore((s) => s.isAuthModalOpen);
  const storeClose = useAuthStore((s) => s.closeAuthModal);
  const { signIn, signInWithFastProfile, isLoading } = useAuthStore();

  const isOpen = propIsOpen !== undefined ? propIsOpen : storeIsOpen;
  const handleClose = () => {
    if (propOnClose) propOnClose();
    else storeClose();
  };

  const [activeTab, setActiveTab] = useState<'quick' | 'google'>('quick');
  const [fastInput, setFastInput] = useState('');
  const [isSubmittingFast, setIsSubmittingFast] = useState(false);
  const [googlePrompting, setGooglePrompting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    setLocalError(null);
    setGooglePrompting(true);
    try {
      await signIn();
      handleClose();
    } catch (err: any) {
      setLocalError(err.message || 'Failed to sign in with Google');
    } finally {
      setGooglePrompting(false);
    }
  };

  const handleFastSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fastInput.trim()) return;

    setLocalError(null);
    setIsSubmittingFast(true);
    try {
      await signInWithFastProfile(fastInput.trim());
      handleClose();
    } catch (err: any) {
      setLocalError(err.message || 'Failed to connect profile');
    } finally {
      setIsSubmittingFast(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-md bg-surface border border-customBorder rounded-2xl shadow-2xl p-6 flex flex-col gap-5 overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-customBorder pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent/20 text-accent flex items-center justify-center font-black text-sm">
              d
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-primary tracking-tight">
                Dotify Account
              </h2>
              <p className="text-xs text-secondary">
                Sync music & playlists across PC and phone
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-secondary hover:text-primary rounded-full hover:bg-highlight transition-colors"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-elevated p-1 rounded-xl border border-customBorder">
          <button
            type="button"
            onClick={() => { setActiveTab('quick'); setLocalError(null); }}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'quick'
                ? 'bg-accent text-accent-content shadow-sm'
                : 'text-secondary hover:text-primary'
            }`}
          >
            <Zap size={13} />
            <span>1-Click Account</span>
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('google'); setLocalError(null); }}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'google'
                ? 'bg-accent text-accent-content shadow-sm'
                : 'text-secondary hover:text-primary'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>Google Sign-In</span>
          </button>
        </div>

        {localError && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs leading-relaxed">
            {localError}
          </div>
        )}

        {/* Tab 1: 1-Click Fast Profile (Zero Passwords, Zero Friction) */}
        {activeTab === 'quick' && (
          <form onSubmit={handleFastSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-secondary uppercase tracking-wider mb-1.5">
                Nickname or Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted">
                  <UserIcon size={15} />
                </div>
                <input
                  type="text"
                  value={fastInput}
                  onChange={(e) => setFastInput(e.target.value)}
                  placeholder="e.g. monty or friend@email.com"
                  autoFocus
                  disabled={isSubmittingFast}
                  className="w-full bg-elevated border border-customBorder focus:border-accent text-primary placeholder-muted rounded-xl pl-10 pr-4 py-3 text-sm outline-none transition-all"
                />
              </div>
            </div>

            <div className="p-3 rounded-xl bg-highlight/40 border border-customBorder text-xs text-secondary leading-relaxed">
              💡 <b>0 passwords needed.</b> Entering the same nickname or email on PC and Phone connects you to the same account instantly.
            </div>

            <button
              type="submit"
              disabled={!fastInput.trim() || isSubmittingFast}
              className="w-full flex items-center justify-center gap-2 bg-accent text-accent-content font-bold text-sm py-3 px-5 rounded-full hover:brightness-110 active:scale-95 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmittingFast ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Connecting Account...</span>
                </>
              ) : (
                <>
                  <Zap size={16} />
                  <span>Connect & Sync</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* Tab 2: Google Sign-In */}
        {activeTab === 'google' && (
          <div className="space-y-4 text-center py-2">
            <p className="text-xs text-secondary leading-relaxed">
              Connect with your Google account to automatically sync your library across any browser or device.
            </p>

            <button
              onClick={handleGoogleSignIn}
              disabled={isLoading || googlePrompting}
              data-testid="modal-google-signin-btn"
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 active:scale-95 text-gray-900 font-bold text-sm py-3.5 px-6 rounded-full shadow-md transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {googlePrompting ? (
                <>
                  <Loader2 size={18} className="animate-spin text-gray-900" />
                  <span>Connecting to Google...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  <span>Continue with Google</span>
                </>
              )}
            </button>

            {googlePrompting && (
              <button
                type="button"
                onClick={() => setGooglePrompting(false)}
                className="text-xs text-muted hover:text-primary underline transition-colors"
              >
                Cancel and use 1-Click Account instead
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
};
