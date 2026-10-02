import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { usePlayerStore } from '../../store/playerStore';
import { DeviceIcon } from './DeviceIcon';
import { castService } from '../../services/castService';
import { connectClient } from '../../services/connectClient';
import { isAndroidApp } from '../../services/apiConfig';
import { X, Volume2, Loader2, Wifi, Check, RefreshCw } from 'lucide-react';

export const DevicePickerModal: React.FC = () => {
  const [isScanning, setIsScanning] = useState(false);
  const [sliderVal, setSliderVal] = useState<number | null>(null);
  const isDraggingVol = useRef<boolean>(false);

  const isDevicePickerOpen = usePlayerStore((s) => s.isDevicePickerOpen);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const toggleDevicePicker = usePlayerStore((s) => s.toggleDevicePicker);
  const remoteDevices = usePlayerStore((s) => s.remoteDevices);
  const activeDevice = usePlayerStore((s) => s.activeDevice);
  const connectMode = usePlayerStore((s) => s.connectMode);
  const isTransferringPlayback = usePlayerStore((s) => s.isTransferringPlayback);
  const transferringToId = usePlayerStore((s) => s.transferringToId);
  const transferPlaybackTo = usePlayerStore((s) => s.transferPlaybackTo);
  const setRemoteVolume = usePlayerStore((s) => s.setRemoteVolume);
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);

  useEffect(() => {
    if (isDevicePickerOpen) {
      // Query already-discovered & cached smart speakers instantly via lightweight mDNS
      castService.fetchCastDevices();
    }
  }, [isDevicePickerOpen]);

  const handleScanClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsScanning(true);
    await castService.scanForDevices();
    setIsScanning(false);
  };

  // Determine local and active devices
  const localIsActive = connectMode !== 'remote_controller';
  const localDev = connectClient.getLocalDevice();
  const currentActiveDevice = activeDevice || (localIsActive ? {
    deviceId: localDev.deviceId || 'local_device',
    deviceName: localDev.deviceName || (isAndroidApp() ? 'This Phone' : 'This Computer'),
    deviceType: localDev.deviceType || (isAndroidApp() ? ('mobile' as const) : ('desktop' as const)),
    role: 'active_host' as const,
    isCurrentDevice: true,
    isActive: true,
    volume: volume,
    lastSeen: Date.now(),
  } : null);

  const targetDeviceVolume = currentActiveDevice
    ? (currentActiveDevice.isCurrentDevice ? volume : (currentActiveDevice.volume ?? volume))
    : volume;

  useEffect(() => {
    if (!isDraggingVol.current) {
      setSliderVal(null);
    }
  }, [targetDeviceVolume]);

  const displayVolume = sliderVal !== null ? sliderVal : targetDeviceVolume;

  if (!isDevicePickerOpen) return null;

  const handleDeviceClick = async (targetDeviceId: string) => {
    if (isTransferringPlayback) return;
    if (activeDevice && activeDevice.deviceId === targetDeviceId) {
      if (connectMode === 'remote_controller') return;
      const targetDev = remoteDevices.find((d) => d.deviceId === targetDeviceId) || activeDevice;
      usePlayerStore.getState().setConnectMode('remote_controller', targetDev);
      connectClient.pairWith(targetDeviceId);
      toggleDevicePicker(false);
      return;
    }

    if (!currentTrack) {
      if (targetDeviceId === localDev.deviceId || targetDeviceId === 'local_device') {
        usePlayerStore.getState().setConnectMode('standalone');
        connectClient.setLocalDevice({ role: 'standalone', isActive: true });
        connectClient.setActiveDeviceId(localDev.deviceId);
        toggleDevicePicker(false);
        return;
      }
      const targetDev = remoteDevices.find((d) => d.deviceId === targetDeviceId) || {
        deviceId: targetDeviceId,
        deviceName: targetDeviceId.startsWith('cast:') ? 'Google Cast Speaker' : 'Remote Device',
        deviceType: targetDeviceId.startsWith('cast:') ? ('speaker' as const) : ('desktop' as const),
        role: 'active_host' as const,
        isCurrentDevice: false,
        isActive: true,
        volume: volume,
        lastSeen: Date.now(),
      };
      usePlayerStore.getState().setConnectMode('remote_controller', targetDev);
      connectClient.setActiveDeviceId(targetDeviceId);
      connectClient.pairWith(targetDeviceId);
      toggleDevicePicker(false);
      return;
    }

    await transferPlaybackTo(targetDeviceId);
    toggleDevicePicker(false);
  };

  const modalContent = (
    <div
      data-testid="device-picker-modal"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-base/80 backdrop-blur-md animate-in fade-in select-none"
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

              <div className="flex items-center gap-2">
                {/* Equalizer animation badge */}
                <div className="flex items-center gap-1 bg-accent/20 px-2 py-1 rounded-md">
                  <span className="w-1 h-3 bg-accent rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1 h-4 bg-accent rounded-full animate-bounce" />
                </div>

                {(!currentActiveDevice.isCurrentDevice || connectMode === 'remote_controller') && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await usePlayerStore.getState().disconnectRemoteDevice();
                      toggleDevicePicker(false);
                    }}
                    data-testid="disconnect-active-device-btn"
                    className="px-2.5 py-1 rounded-lg bg-surface hover:bg-highlight border border-customBorder text-xs font-semibold text-secondary hover:text-accent transition-all cursor-pointer"
                    title="Disconnect from remote device and switch playback back to this device"
                  >
                    Disconnect
                  </button>
                )}
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
                value={displayVolume}
                onMouseDown={() => { isDraggingVol.current = true; }}
                onTouchStart={() => { isDraggingVol.current = true; }}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setSliderVal(val);
                  if (currentActiveDevice.isCurrentDevice) {
                    setVolume(val);
                  } else {
                    setRemoteVolume(currentActiveDevice.deviceId, val);
                  }
                }}
                onMouseUp={() => {
                  isDraggingVol.current = false;
                  setSliderVal(null);
                }}
                onTouchEnd={() => {
                  isDraggingVol.current = false;
                  setSliderVal(null);
                }}
                data-testid="device-volume-slider"
                className="w-full h-1 rounded-none appearance-none cursor-pointer"
              />
              <span className="text-xs font-mono text-muted w-8 text-right">
                {Math.round(displayVolume * 100)}%
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
                const isAlreadyControlling = isActive && (dev.isCurrentDevice ? localIsActive : connectMode === 'remote_controller');

                return (
                  <button
                    key={dev.deviceId}
                    data-testid={`device-item-${dev.deviceId}`}
                    onClick={() => handleDeviceClick(dev.deviceId)}
                    disabled={isAlreadyControlling || isTransferringPlayback}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all text-left ${
                      isActive
                        ? 'border-accent bg-accent/10'
                        : 'border-customBorder/50 bg-elevated/40 hover:bg-elevated hover:border-customBorder'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`p-2 rounded-lg ${isActive ? 'bg-accent/20 text-accent' : 'bg-surface text-secondary'}`}>
                        <DeviceIcon type={dev.deviceType} size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-semibold truncate ${isActive ? 'text-accent' : 'text-primary'}`}>
                            {dev.deviceName}
                            {dev.isCurrentDevice && ' (This Device)'}
                          </p>
                          {(dev.deviceType === 'speaker' || dev.deviceId.startsWith('cast:')) && dev.castDetails?.ip && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-mono shrink-0">
                              {dev.castDetails.ip}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted truncate">
                          {isAlreadyControlling
                            ? 'Listening on this device'
                            : isActive
                            ? 'Active playback • Tap to control'
                            : dev.isCurrentDevice
                            ? 'Switch playback back here'
                            : dev.deviceType === 'speaker' || dev.deviceId.startsWith('cast:')
                            ? `${dev.castDetails?.model || 'Google Cast Speaker'} • Tap to stream`
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
                      ) : isAlreadyControlling ? (
                        <Check size={18} className="text-accent" />
                      ) : isActive ? (
                        <span className="text-xs text-accent font-medium px-2.5 py-1 rounded bg-accent/20 border border-accent/40">
                          Control
                        </span>
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
        <div className="flex flex-col gap-2 pt-2 border-t border-customBorder/40">
          <div className="flex items-center justify-between text-xs text-muted">
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
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
};
