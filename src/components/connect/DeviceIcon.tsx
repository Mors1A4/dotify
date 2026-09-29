import React from 'react';
import { Laptop, Smartphone, Tablet, Speaker, Tv, Cast, Globe } from 'lucide-react';
import { DeviceType } from '../../types/connect';

export interface DeviceIconProps {
  type?: DeviceType;
  size?: number;
  className?: string;
}

export const DeviceIcon: React.FC<DeviceIconProps> = ({ type = 'desktop', size = 18, className = '' }) => {
  switch (type) {
    case 'mobile':
      return <Smartphone size={size} className={className} />;
    case 'tablet':
      return <Tablet size={size} className={className} />;
    case 'speaker':
      return <Speaker size={size} className={className} />;
    case 'tv':
      return <Tv size={size} className={className} />;
    case 'cast':
      return <Cast size={size} className={className} />;
    case 'web':
      return <Globe size={size} className={className} />;
    case 'desktop':
    default:
      return <Laptop size={size} className={className} />;
  }
};
