import React from 'react';
import { useThemeStore } from '../../store/themeStore';

interface BrandLogoProps {
  size?: number;
  className?: string;
  customColor?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ size = 28, className = '', customColor }) => {
  const { colors } = useThemeStore();
  const accent = customColor || colors.accent || '#1ed760';

  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={`select-none shrink-0 transition-transform ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Dotify Logo"
    >
      {/* Dynamic Accent Color Circle */}
      <circle
        cx="256"
        cy="256"
        r="238"
        fill={accent}
        style={{ fill: accent }}
        className="transition-colors duration-200"
      />

      {/* Centered Black Dot */}
      <circle
        cx="256"
        cy="256"
        r="88"
        fill="#000000"
        style={{ fill: '#000000' }}
      />
    </svg>
  );
};
