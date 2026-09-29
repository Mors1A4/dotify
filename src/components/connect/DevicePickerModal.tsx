import React, { useState, useEffect } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { DeviceIcon } from './DeviceIcon';
import { castService } from '../../services/castService';
import { X, Volume2, Loader2, Wifi, Check, RefreshCw } from 'lucide-react';

export const DevicePickerModal: React.FC = () => {
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    castService.fetchCastDevices();
    castService.scanForDevices();
  }, []);

  const handleScanClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsScanning(true);
    await castService.scanForDevices();
    setIsScanning(false);
  };

  const {
    isDevicePickerOpen,
    toggleDevicePicker,
    remoteDevices,
    activeDevice,
    connectMode,
    isTransferringPlayback,
    transferringToId,
    transferPlaybackTo,
    setRemoteVolume,
    volume,
    setVolume,
  } = usePlayerStore();

  if (!isDevicePickerOpen) return null;

  // Determine local and active devices
  const localIsActive = connectMode !== 'remote_controller';
  const currentActiveDevice = activeDevice || (localIsActive ? {
    deviceId: 'local_device',
    deviceName: 'This Computer',
    deviceType: 'desktop' as const,
    role: 'active_host' as const,
    isCurrentDevice: true,
    isActive: true,
    volume: volume,
    lastSeen: Date.now(),
  } : null);

  const handleDeviceClick = async (targetDeviceId: string) => {
    if (isTransferringPlayback) return;
    if (activeDevice && activeDevice.deviceId === targetDeviceId) return;
    await transferPlaybackTo(targetDeviceId);
  };

  return (
    <div
      data-testid="device-picker-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-base/80 backdrop-blur-md animate-in fade-in select-none"
      onClick={() => toggleDevicePicker(false)}
    >
      <div
        className="relative w-full max-w-md bg-surface border border-customBorder rounded-2xl shadow-2xl p-6 flex flex-col gap-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-customBorder/60 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent">
              <DeviceIcon type={currentActiveDevice?.deviceType || 'desktop'} size={18} />
            </div>
            <div>
              <h3 className="font-bold text-base text-primary">Connect to a device</h3>
              <p className="text-xs text-secondary">Spotify Connect-style LAN sync</p>
            </div>
          </div>
          <button
            onClick={() => toggleDevicePicker(false)}
            data-testid="close-device-picker-btn"
            className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-highlight transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Current Active Device Spotlight Card */}
        {currentActiveDevice && (
          <div className="p-4 rounded-xl bg-elevated/70 border border-accent/40 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-accent/20 text-accent">
                  <DeviceIcon type={currentActiveDevice.deviceType} size={22} />
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider text-accent">
                    Current Playback Device
                  </span>
                  <h4 className="text-sm font-bold text-primary truncate max-w-[200px]">
                    {currentActiveDevice.deviceName} {currentActiveDevice.isCurrentDevice && '(This Device)'}
                  </h4>
                </div>
              </div>

              {/* Equalizer animation badge */}
              <div className="flex items-center gap-1 bg-accent/20 px-2 py-1 rounded-md">
                <span className="w-1 h-3 bg-accent rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1 h-4 bg-accent rounded-full animate-bounce" />
              </div>
            </div>

            {/* Quick Volume slider for active device */}
            <div className="flex items-center gap-3 pt-2 border-t border-customBorder/30">
              <Volume2 size={16} className="text-secondary shrink-0" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={currentActiveDevice.isCurrentDevice ? volume : currentActiveDevice.volume ?? volume}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (currentActiveDevice.isCurrentDevice) {
                    setVolume(val);
                  } else {
                    setRemoteVolume(currentActiveDevice.deviceId, val);
                  }
                }}
                data-testid="device-volume-slider"
                className="w-full h-1 rounded-none appearance-none cursor-pointer"
              />
              <span className="text-xs font-mono text-muted w-8 text-right">
                {Math.round((currentActiveDevice.isCurrentDevice ? volume : currentActiveDevice.volume ?? volume) * 100)}%
              </span>
            </div>
          </div>
        )}

        {/* Discovered Devices List */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-muted px-1">
            Select a device
          </span>

          <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
            {remoteDevices.length === 0 ? (
              <div className="p-4 rounded-xl border border-customBorder/40 bg-elevated/20 text-center text-xs text-muted">
                No other devices found on local network.
              </div>
            ) : (
              remoteDevices.map((dev) => {
                const isActive = activeDevice?.deviceId === dev.deviceId || (dev.isCurrentDevice && localIsActive);
                const isTargetOfTransfer = isTransferringPlayback && transferringToId === dev.deviceId;

                return (
                  <button
                    key={dev.deviceId}
                    data-testid={`device-item-${dev.deviceId}`}
                    onClick={() => handleDeviceClick(dev.deviceId)}
                    disabled={isActive || isTransferringPlayback}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all text-left ${
                      isActive
                        ? 'border-accent bg-accent/10 cursor-default'
                        : 'border-customBorder/50 bg-elevated/40 hover:bg-elevated hover:border-customBorder'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`p-2 rounded-lg ${isActive ? 'bg-accent/20 text-accent' : 'bg-surface text-secondary'}`}>
                        <DeviceIcon type={dev.deviceType} size={18} />
                      </div>
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold truncate ${isActive ? 'text-accent' : 'text-primary'}`}>
                          {dev.deviceName}
                          {dev.isCurrentDevice && ' (This Device)'}
                        </p>
                        <p className="text-xs text-muted truncate">
                          {isActive
                            ? 'Listening on this device'
                            : dev.isCurrentDevice
                            ? 'Switch playback back here'
                            : dev.deviceType === 'speaker' || dev.deviceId.startsWith('cast:')
                            ? 'Google Cast Smart Speaker'
                            : 'Available on local network'}
                        </p>
                      </div>
                    </div>

                    {/* Status indicator / Transfer button */}
                    <div>
                      {isTargetOfTransfer ? (
                        <div className="flex items-center gap-1.5 text-accent text-xs font-medium">
                          <Loader2 size={14} className="animate-spin" />
                          <span>Transferring...</span>
                        </div>
                      ) : isActive ? (
                        <Check size={18} className="text-accent" />
                      ) : (
                        <span className="text-xs text-secondary hover:text-accent font-medium px-2.5 py-1 rounded bg-surface border border-customBorder/60">
                          Transfer
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Footer & Radar discovery status */}
        <div className="flex items-center justify-between pt-2 border-t border-customBorder/40 text-xs text-muted">
          <button
            onClick={handleScanClick}
            disabled={isScanning}
            className="flex items-center gap-2 hover:text-primary transition-colors cursor-pointer"
          >
            <RefreshCw size={12} className={isScanning ? 'animate-spin text-accent' : 'text-accent'} />
            <span>{isScanning ? 'Scanning Wi-Fi network...' : 'Scan for Speakers'}</span>
          </button>
          <div className="flex items-center gap-1">
            <Wifi size={13} />
            <span>LAN & Cast Sync</span>
          </div>
        </div>
      </div>
    </div>
  );
};
