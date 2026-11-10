import React, { useEffect, useState } from 'react';
import {
  Settings,
  Volume2,
  Headphones,
  Speaker,
  Bluetooth,
  Sliders,
  FolderOpen,
  RefreshCw,
  Check,
  Sparkles,
  Wand2,
  ArrowDownCircle,
  Laptop,
  Music,
} from 'lucide-react';
import { useAudioDeviceStore, AudioOutputDevice } from '../../store/audioDeviceStore';
import { usePlayerStore } from '../../store/playerStore';
import { useUpdateStore } from '../../store/updateStore';
import { useUpgradeStore } from '../../store/upgradeStore';
import { ColourSchemeSection } from '../theme/ColourSchemeSection';
import { DownloadFolderModal } from '../common/DownloadFolderModal';
import { fetchDownloadDir } from '../../services/downloadFolderService';
import { APP_VERSION } from '../../version';

export const SettingsView: React.FC = () => {
  const {
    devices,
    activeDeviceId,
    activeDeviceLabel,
    isSupported,
    isLoading,
    isPlayingTestTone,
    errorMessage,
    loadDevices,
    selectDevice,
    promptSystemPicker,
    playTestTone,
    openWindowsSoundSettings,
  } = useAudioDeviceStore();

  const { toggleRightDrawer } = usePlayerStore();
  const { updateAvailable, latestRelease, setModalOpen: setUpdateModalOpen, checkForUpdates } = useUpdateStore();
  const { openHelpModal } = useUpgradeStore();

  const [downloadPath, setDownloadPath] = useState<string>('');
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    loadDevices().catch(() => {});
    fetchDownloadDir()
      .then((info) => setDownloadPath(info.path))
      .catch(() => {});
  }, [loadDevices]);

  const handleCheckForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      await checkForUpdates(true);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const getDeviceIcon = (device: AudioOutputDevice) => {
    const lower = (device.label || '').toLowerCase();
    if (lower.includes('headphone') || lower.includes('headset') || lower.includes('airpod') || lower.includes('earphone')) {
      return <Headphones size={18} className="text-accent flex-shrink-0" />;
    }
    if (lower.includes('bluetooth') || lower.includes('wireless')) {
      return <Bluetooth size={18} className="text-accent flex-shrink-0" />;
    }
    if (device.isDefault || lower.includes('default')) {
      return <Laptop size={18} className="text-accent flex-shrink-0" />;
    }
    return <Speaker size={18} className="text-accent flex-shrink-0" />;
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-8 select-none animate-in fade-in pb-28">
      {/* Page Header */}
      <div className="flex items-center justify-between border-b border-customBorder/60 pb-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-elevated border border-customBorder/80 text-accent shadow-sm">
            <Settings size={26} />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-primary tracking-tight">Settings</h1>
            <p className="text-xs sm:text-sm text-secondary mt-0.5">
              Audio hardware output, downloads, equalizer, and preferences
            </p>
          </div>
        </div>
      </div>

      {/* SECTION 1: Audio Hardware & Output Device (Hero Section) */}
      <section className="space-y-4" data-testid="settings-audio-output-section">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-primary flex items-center gap-2">
              <Volume2 size={20} className="text-accent" />
              <span>Audio Output & Playback Device</span>
            </h2>
            <p className="text-xs text-secondary mt-0.5">
              Choose which speakers, headphones, or soundcard to route Dotify desktop audio through.
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadDevices()}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-elevated hover:bg-highlight border border-customBorder text-xs font-semibold text-secondary hover:text-primary transition-all active:scale-95 cursor-pointer disabled:opacity-50"
            title="Scan for connected audio output hardware"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin text-accent' : ''} />
            <span>Scan Devices</span>
          </button>
        </div>

        {/* Current Active Device Banner */}
        <div className="p-4 rounded-2xl bg-elevated/70 border border-customBorder/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/25 flex items-center justify-center flex-shrink-0 text-accent">
              <Volume2 size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-accent bg-accent/15 px-2 py-0.5 rounded-full border border-accent/20">
                  Active Device
                </span>
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              </div>
              <p className="font-bold text-primary text-sm sm:text-base truncate mt-0.5" data-testid="settings-active-device-name">
                {activeDeviceLabel || 'Default System Audio Output'}
              </p>
            </div>
          </div>

          {/* Test Sound & Native Picker Buttons */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <button
              type="button"
              onClick={playTestTone}
              disabled={isPlayingTestTone}
              data-testid="settings-test-audio-btn"
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-sm active:scale-95 ${
                isPlayingTestTone
                  ? 'bg-accent text-black animate-pulse'
                  : 'bg-elevated hover:bg-highlight text-primary border border-customBorder'
              }`}
              title="Play a pleasant test chord through this output device"
            >
              <Music size={14} className={isPlayingTestTone ? 'animate-bounce' : 'text-accent'} />
              <span>{isPlayingTestTone ? 'Playing Tone...' : 'Test Audio'}</span>
            </button>

            {typeof navigator !== 'undefined' && (navigator.mediaDevices as any)?.selectAudioOutput && (
              <button
                type="button"
                onClick={promptSystemPicker}
                data-testid="settings-select-system-picker-btn"
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-accent hover:brightness-110 text-white flex items-center gap-1.5 shadow-md shadow-accent/20 transition-all cursor-pointer active:scale-95"
                title="Open browser/system audio device picker"
              >
                <Sparkles size={14} />
                <span>Browse System Devices</span>
              </button>
            )}
          </div>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between">
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Device Selection List */}
        <div className="rounded-2xl border border-customBorder/60 bg-elevated/30 overflow-hidden divide-y divide-customBorder/40">
          <div className="px-4 py-2.5 bg-elevated/40">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
              Connected Output Hardware ({devices.length})
            </span>
          </div>

          {devices.length === 0 ? (
            <div className="p-6 text-center text-secondary text-xs">
              <Speaker size={28} className="mx-auto mb-2 text-muted opacity-60" />
              <p>No external output devices detected yet.</p>
              <button
                type="button"
                onClick={() => loadDevices()}
                className="mt-2 text-accent font-semibold hover:underline inline-block cursor-pointer"
              >
                Click to scan for audio devices
              </button>
            </div>
          ) : (
            devices.map((device) => {
              const isSelected = activeDeviceId === device.deviceId;
              return (
                <button
                  key={device.deviceId}
                  type="button"
                  onClick={() => selectDevice(device.deviceId, device.label)}
                  data-testid={`audio-device-item-${device.deviceId}`}
                  className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors cursor-pointer group ${
                    isSelected ? 'bg-accent/10 hover:bg-accent/15' : 'hover:bg-elevated/70'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 pr-3">
                    <div
                      className={`p-2 rounded-xl border flex-shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-accent/20 border-accent/40 text-accent'
                          : 'bg-elevated border-customBorder/60 text-secondary group-hover:text-primary'
                      }`}
                    >
                      {getDeviceIcon(device)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs sm:text-sm font-semibold truncate ${
                            isSelected ? 'text-accent font-bold' : 'text-primary'
                          }`}
                        >
                          {device.label}
                        </span>
                        {device.isDefault && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-elevated border border-customBorder/60 text-muted">
                            System Default
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted font-mono block truncate">
                        ID: {device.deviceId === 'default' ? 'default (system route)' : device.deviceId.slice(0, 24) + '...'}
                      </span>
                    </div>
                  </div>

                  <div className="flex-shrink-0 flex items-center">
                    {isSelected ? (
                      <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center text-white shadow-sm">
                        <Check size={14} />
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border border-customBorder group-hover:border-accent/60 transition-colors" />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Windows Volume Mixer & System Preference integration */}
        <div className="p-3.5 rounded-2xl border border-customBorder/50 bg-elevated/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <Laptop size={17} className="text-secondary flex-shrink-0" />
            <div>
              <p className="font-semibold text-primary">Windows App Volume & Device Preferences</p>
              <p className="text-[11px] text-muted">
                Need OS-level audio redirection or per-app volume? Open Windows system sound mixer.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openWindowsSoundSettings}
            data-testid="settings-windows-sound-btn"
            className="px-3 py-1.5 rounded-xl bg-elevated hover:bg-highlight border border-customBorder text-xs font-semibold text-secondary hover:text-primary transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap self-start sm:self-auto"
          >
            <span>Open Windows Mixer</span>
          </button>
        </div>

        {/* 10-Band Equalizer Quick Link */}
        <div className="p-3.5 rounded-2xl border border-customBorder/50 bg-elevated/20 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2.5">
            <Sliders size={17} className="text-accent flex-shrink-0" />
            <div>
              <p className="font-semibold text-primary">10-Band Hardware Equalizer</p>
              <p className="text-[11px] text-muted">
                Fine-tune bass, mids, treble, and acoustic room compensation presets.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => toggleRightDrawer('equalizer')}
            data-testid="settings-open-eq-btn"
            className="px-3 py-1.5 rounded-xl bg-elevated hover:bg-highlight border border-customBorder text-xs font-semibold text-secondary hover:text-primary transition-all cursor-pointer whitespace-nowrap"
          >
            Open EQ
          </button>
        </div>
      </section>

      {/* SECTION 2: Downloads & Local Storage */}
      <section className="space-y-3 pt-2 border-t border-customBorder/50" data-testid="settings-downloads-section">
        <h2 className="text-lg font-bold text-primary flex items-center gap-2">
          <FolderOpen size={20} className="text-accent" />
          <span>Downloads & Offline MP3 Storage</span>
        </h2>
        <p className="text-xs text-secondary">
          Configure where offline MP3 tracks and Vault downloads are saved on this computer.
        </p>

        <div className="p-4 rounded-2xl bg-elevated/50 border border-customBorder/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted block mb-1">
              Active Download Folder
            </span>
            <span
              className="text-xs sm:text-sm font-mono text-primary truncate block max-w-lg bg-base/50 px-3 py-1.5 rounded-lg border border-customBorder/40"
              data-testid="settings-download-path"
            >
              {downloadPath || 'Default Dotify Music Folder'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsDownloadModalOpen(true)}
            data-testid="settings-change-download-folder-btn"
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-accent hover:brightness-110 text-white flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer whitespace-nowrap self-start sm:self-auto"
          >
            <span>Change Folder</span>
          </button>
        </div>
      </section>

      {/* SECTION 3: Appearance & Themes */}
      <section className="space-y-3 pt-2 border-t border-customBorder/50" data-testid="settings-appearance-section">
        <h2 className="text-lg font-bold text-primary">Appearance & Themes</h2>
        <p className="text-xs text-secondary">
          Personalize the Spotify-inspired OLED dark mode accent colors.
        </p>
        <div className="p-3 rounded-2xl bg-elevated/40 border border-customBorder/60">
          <ColourSchemeSection />
        </div>
      </section>

      {/* SECTION 4: About & Updates */}
      <section className="space-y-3 pt-2 border-t border-customBorder/50" data-testid="settings-about-section">
        <h2 className="text-lg font-bold text-primary">About & Updates</h2>

        <div className="p-4 rounded-2xl bg-elevated/40 border border-customBorder/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-primary text-base">Dotify Music</span>
              <span className="text-xs font-bold font-mono px-2 py-0.5 rounded-full bg-accent/15 border border-accent/25 text-accent">
                v{APP_VERSION}
              </span>
            </div>
            <p className="text-xs text-secondary mt-1">
              Full-stack multi-source music player with YouTube audio, smart recommendations & cross-device sync.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {updateAvailable && latestRelease ? (
              <button
                type="button"
                onClick={() => setUpdateModalOpen(true)}
                data-testid="settings-update-available-btn"
                className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-accent text-black shadow-md shadow-accent/25 hover:bg-accentHover transition-all cursor-pointer flex items-center gap-1.5 animate-pulse"
              >
                <ArrowDownCircle size={15} />
                <span>Update to v{latestRelease.version}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCheckForUpdates}
                disabled={checkingUpdate}
                data-testid="settings-check-update-btn"
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-elevated hover:bg-highlight border border-customBorder text-secondary hover:text-primary transition-all cursor-pointer flex items-center gap-1.5"
              >
                <RefreshCw size={13} className={checkingUpdate ? 'animate-spin text-accent' : ''} />
                <span>{checkingUpdate ? 'Checking...' : 'Check for Updates'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => openHelpModal()}
              data-testid="settings-open-studio-btn"
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-elevated hover:bg-highlight border border-customBorder text-secondary hover:text-primary transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Wand2 size={13} className="text-accent" />
              <span>AI Studio</span>
            </button>
          </div>
        </div>
      </section>

      {/* Download Folder Modal */}
      <DownloadFolderModal
        open={isDownloadModalOpen}
        onClose={() => {
          setIsDownloadModalOpen(false);
          fetchDownloadDir()
            .then((info) => setDownloadPath(info.path))
            .catch(() => {});
        }}
      />
    </div>
  );
};
