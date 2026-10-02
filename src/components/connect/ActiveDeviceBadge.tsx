import React from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { DeviceIcon } from './DeviceIcon';

export interface ActiveDeviceBadgeProps {
  compact?: boolean;
  onClick?: () => void;
  className?: string;
}

export const ActiveDeviceBadge: React.FC<ActiveDeviceBadgeProps> = ({
  compact = false,
  onClick,
  className = '',
}) => {
  const { connectMode, activeDevice, toggleDevicePicker } = usePlayerStore();

  const isRemote = connectMode === 'remote_controller' && Boolean(activeDevice && !activeDevice.isCurrentDevice);
  const deviceName = activeDevice?.deviceName || (isRemote ? 'Remote Device' : 'This Computer');
  const deviceType = activeDevice?.deviceType || 'desktop';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClick) {
      onClick();
    } else {
      toggleDevicePicker(true);
    }
  };

  if (!isRemote) {
    if (compact) return null;
    return (
      <button
        onClick={handleClick}
        data-testid="active-device-badge"
        className={`flex items-center gap-1.5 text-xs text-secondary hover:text-primary transition-colors select-none ${className}`}
        title="Listening on this device (Click to connect to another device)"
      >
        <DeviceIcon type={deviceType} size={14} />
        <span className="truncate max-w-[120px]">{deviceName}</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      data-testid="active-device-badge"
      className={`flex items-center gap-2 px-2.5 py-1 rounded-full bg-accent/15 border border-accent/40 text-accent text-xs font-medium hover:bg-accent/25 transition-all select-none ${className}`}
      title={`Listening on ${deviceName} (Click to switch)`}
    >
      <div className="flex items-center gap-0.5 h-3">
        <span className="w-0.5 h-3 bg-accent rounded-full animate-bounce [animation-delay:-0.3s]" />
        <span className="w-0.5 h-2 bg-accent rounded-full animate-bounce [animation-delay:-0.15s]" />
        <span className="w-0.5 h-3 bg-accent rounded-full animate-bounce" />
      </div>
      <DeviceIcon type={deviceType} size={14} className="text-accent" />
      <span className="truncate max-w-[140px]">Listening on {deviceName}</span>
    </button>
  );
};
