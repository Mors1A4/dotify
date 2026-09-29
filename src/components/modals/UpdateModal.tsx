import React from 'react';
import { createPortal } from 'react-dom';
import {
  Download,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  ExternalLink,
  Smartphone,
  Monitor,
  X,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import { useUpdateStore } from '../../store/updateStore';
import { isAndroidApp, isTauriEnvironment } from '../../services/apiConfig';
import { openReleaseAssetExternal } from '../../services/updateService';

export const UpdateModal: React.FC = () => {
  const {
    currentVersion,
    latestRelease,
    updateAvailable,
    recentlyAttempted,
    isChecking,
    isUpdating,
    progressPercent,
    progressStatus,
    updateError,
    isModalOpen,
    setModalOpen,
    dismissCurrentUpdate,
    checkForUpdates,
    startUpdate,
  } = useUpdateStore();

  if (!isModalOpen || typeof document === 'undefined') {
    return null;
  }

  const isAndroid = isAndroidApp() || (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent));
  const isDesktopTauri = isTauriEnvironment() && !isAndroid;

  const publishedDateStr = latestRelease?.publishedAt
    ? new Date(latestRelease.publishedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  const modalContent = (
    <div
      data-testid="update-modal-backdrop"
      onClick={() => {
        if (!isUpdating && !latestRelease?.mandatory) {
          dismissCurrentUpdate();
        }
      }}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div
        data-testid="update-modal"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md bg-surface border border-customBorder rounded-2xl shadow-2xl overflow-hidden text-primary select-none"
      >
        {/* Top Accent Banner */}
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-accent/20 via-elevated/80 to-surface border-b border-customBorder/60">
          {!isUpdating && !latestRelease?.mandatory && (
            <button
              type="button"
              onClick={() => dismissCurrentUpdate()}
              aria-label="Close update modal"
              className="absolute right-4 top-4 p-1.5 rounded-full bg-elevated/80 text-secondary hover:text-primary hover:bg-highlight transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          )}

          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center text-accent shrink-0 shadow-inner">
              {updateAvailable ? <Sparkles size={22} /> : <CheckCircle2 size={22} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-extrabold tracking-tight">
                  {updateAvailable ? 'Update Available' : 'Dotify is Up to Date'}
                </h2>
                {isAndroid ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-elevated text-secondary border border-customBorder">
                    <Smartphone size={10} /> Android
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-elevated text-secondary border border-customBorder">
                    <Monitor size={10} /> Desktop
                  </span>
                )}
              </div>
              <p className="text-xs text-secondary mt-0.5">
                {updateAvailable
                  ? 'A newer version of Dotify is ready to install.'
                  : `You are running the latest release (v${currentVersion}).`}
              </p>
            </div>
          </div>

          {/* Version Comparison Pill */}
          <div className="mt-4 flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-base/70 border border-customBorder/60">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-secondary font-medium">Installed:</span>
              <span className="px-2 py-0.5 rounded-md bg-elevated text-secondary font-mono font-semibold">
                v{currentVersion}
              </span>
              {latestRelease && updateAvailable && (
                <>
                  <ArrowRight size={14} className="text-muted mx-0.5" />
                  <span className="px-2 py-0.5 rounded-md bg-accent/20 text-accent border border-accent/40 font-mono font-bold">
                    v{latestRelease.version}
                  </span>
                </>
              )}
            </div>
            {publishedDateStr && (
              <span className="text-[11px] text-muted font-medium">{publishedDateStr}</span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {latestRelease?.notes && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5">
                What&apos;s New in v{latestRelease.version}
              </div>
              <div className="p-3.5 rounded-xl bg-elevated/60 border border-customBorder/50 text-xs text-secondary leading-relaxed max-h-40 overflow-y-auto whitespace-pre-line select-text">
                {latestRelease.notes}
              </div>
            </div>
          )}

          {/* Live Download & Install Progress Bar */}
          {isUpdating && (
            <div className="space-y-2 p-3.5 rounded-xl bg-elevated border border-accent/30">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-primary flex items-center gap-2">
                  <RefreshCw size={13} className="animate-spin text-accent" />
                  {progressStatus || 'Downloading update...'}
                </span>
                <span className="font-mono font-bold text-accent">{Math.round(progressPercent)}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-base overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-300 ease-out rounded-full"
                  style={{ width: `${Math.max(5, Math.min(100, progressPercent))}%` }}
                />
              </div>
            </div>
          )}

          {/* Recently Attempted Anti-Loop Notice */}
          {recentlyAttempted && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs leading-relaxed">
              <AlertCircle size={15} className="shrink-0 mt-0.5 text-amber-400" />
              <div className="flex-1">
                An update was recently started. If Dotify reopened on the previous version, Windows may have kept the current file locked. You can click <strong>Installer (.exe)</strong> below to run the setup installer directly, or choose <strong>Later</strong> to continue using Dotify.
              </div>
            </div>
          )}

          {/* Error Display */}
          {updateError && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
              <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-400" />
              <div className="flex-1">{updateError}</div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2.5 pt-1">
            {updateAvailable && latestRelease ? (
              <>
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => startUpdate()}
                  data-testid="confirm-update-btn"
                  className="w-full py-3 px-4 rounded-xl bg-accent hover:bg-accentHover disabled:opacity-50 text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer active:scale-[0.99]"
                >
                  {isUpdating ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      <span>Updating Dotify...</span>
                    </>
                  ) : (
                    <>
                      <Download size={16} />
                      <span>
                        {isAndroid
                          ? `Download & Install APK (v${latestRelease.version})`
                          : isDesktopTauri
                          ? `Update & Restart Now (v${latestRelease.version})`
                          : `Update Now (v${latestRelease.version})`}
                      </span>
                    </>
                  )}
                </button>

                {/* Direct Browser / Installer Fallback Links */}
                <div className="flex items-center gap-2">
                  {isAndroid ? (
                    <button
                      type="button"
                      onClick={() => openReleaseAssetExternal(latestRelease.androidApkUrl)}
                      className="flex-1 py-2 px-3 rounded-xl bg-elevated hover:bg-highlight border border-customBorder text-xs font-semibold text-secondary hover:text-primary flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <ExternalLink size={13} />
                      <span>Download APK in Browser</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => openReleaseAssetExternal(latestRelease.windowsSetupUrl)}
                        className="flex-1 py-2 px-3 rounded-xl bg-elevated hover:bg-highlight border border-customBorder text-xs font-semibold text-secondary hover:text-primary flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <ExternalLink size={13} />
                        <span>Installer (.exe)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openReleaseAssetExternal(latestRelease.androidApkUrl)}
                        className="flex-1 py-2 px-3 rounded-xl bg-elevated hover:bg-highlight border border-customBorder text-xs font-semibold text-secondary hover:text-primary flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Smartphone size={13} />
                        <span>Android (.apk)</span>
                      </button>
                    </>
                  )}

                  {!latestRelease.mandatory && !isUpdating && (
                    <button
                      type="button"
                      onClick={() => dismissCurrentUpdate()}
                      className="py-2 px-4 rounded-xl bg-elevated/60 hover:bg-elevated text-xs font-semibold text-muted hover:text-primary transition-colors cursor-pointer"
                    >
                      Later
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isChecking}
                  onClick={() => checkForUpdates(true)}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-elevated hover:bg-highlight border border-customBorder text-xs font-bold text-primary flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <RefreshCw size={14} className={isChecking ? 'animate-spin text-accent' : ''} />
                  <span>{isChecking ? 'Checking...' : 'Check Again'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="py-2.5 px-5 rounded-xl bg-accent text-black font-bold text-xs transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
