import React from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { useThemeStore } from '../../store/themeStore';
import { useUpdateStore } from '../../store/updateStore';
import { ACCENT_PRESETS } from '../../types/theme';
import { Search, ChevronLeft, ChevronRight, Palette, Sliders, ChevronDown, Check, X, ArrowDownCircle } from 'lucide-react';
import { AuthButton } from '../auth/AuthButton';
import { BrandLogo } from '../common/BrandLogo';
import { VisualizerIcon } from '../common/VisualizerIcon';

export const TopBar: React.FC = () => {
  const {
    activeView,
    setActiveView,
    searchQuery,
    setSearchQuery,
    toggleRightDrawer,
    isVisualizerOpen,
    toggleVisualizer,
    navigateBack,
    navigateForward,
    canNavigateBack,
    canNavigateForward,
  } = usePlayerStore();
  const { updateAvailable, latestRelease, setModalOpen: setUpdateModalOpen } = useUpdateStore();
  const { colors, setAccentColor } = useThemeStore();
  const [isThemeHovered, setIsThemeHovered] = React.useState(false);
  const [isThemeOpen, setIsThemeOpen] = React.useState(false);
  const desktopThemeRef = React.useRef<HTMLDivElement | null>(null);
  const mobileThemeRef = React.useRef<HTMLDivElement | null>(null);

  const isThemeExpanded = isThemeHovered || isThemeOpen;

  const activePreset = ACCENT_PRESETS.find(
    (p) => p.color.toLowerCase() === colors.accent.toLowerCase()
  );
  const activeAccentName = activePreset ? activePreset.name : `Custom (${colors.accent})`;

  React.useEffect(() => {
    if (!isThemeOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inDesktop = desktopThemeRef.current && desktopThemeRef.current.contains(target);
      const inMobile = mobileThemeRef.current && mobileThemeRef.current.contains(target);
      if (!inDesktop && !inMobile) {
        setIsThemeOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsThemeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isThemeOpen]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (val.trim().length > 0 && activeView !== 'search') {
      setActiveView('search');
    }
  };

  const renderThemeMenu = () => (
    <div
      data-testid="theme-dropdown-menu"
      className="absolute right-0 top-full mt-2 w-48 bg-surface border border-customBorder rounded-xl shadow-2xl p-1.5 z-50 flex flex-col gap-0.5 animate-in fade-in select-none"
    >
      {ACCENT_PRESETS.map((t) => {
        const isSelected = colors.accent.toLowerCase() === t.color.toLowerCase();
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setAccentColor(t.color, t.hoverColor);
              setIsThemeOpen(false);
              setIsThemeHovered(false);
            }}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              isSelected
                ? 'bg-elevated text-primary'
                : 'text-secondary hover:bg-elevated/60 hover:text-primary'
            }`}
          >
            <span
              className="w-3 h-3 rounded-full shrink-0 shadow-sm"
              style={{ backgroundColor: t.color }}
            />
            <span className="truncate">{t.name}</span>
            {isSelected && <Check size={13} className="text-accent ml-auto shrink-0" />}
          </button>
        );
      })}
    </div>
  );

  return (
    <header className="safe-pt bg-surface/90 backdrop-blur-md border-b border-customBorder/60 z-30 transition-all">
      {/* Desktop Header (>= md) */}
      <div className="hidden md:flex items-center justify-between gap-4 h-16 px-4 md:px-6">
        {/* Navigation history & Global Search */}
        <div className="flex items-center gap-3 flex-1 max-w-xl">
          <div className="hidden sm:flex items-center gap-1.5 text-secondary">
            <button
              onClick={navigateBack}
              disabled={!canNavigateBack}
              data-testid="nav-back-btn"
              className={`p-2 rounded-full transition-all ${
                canNavigateBack
                  ? 'bg-elevated/70 hover:bg-elevated hover:text-primary cursor-pointer active:scale-95'
                  : 'bg-elevated/30 text-muted/30 cursor-not-allowed pointer-events-none'
              }`}
              title={canNavigateBack ? 'Go back (Alt+Left)' : 'Go back'}
              aria-label="Go back"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={navigateForward}
              disabled={!canNavigateForward}
              data-testid="nav-forward-btn"
              className={`p-2 rounded-full transition-all ${
                canNavigateForward
                  ? 'bg-elevated/70 hover:bg-elevated hover:text-primary cursor-pointer active:scale-95'
                  : 'bg-elevated/30 text-muted/30 cursor-not-allowed pointer-events-none'
              }`}
              title={canNavigateForward ? 'Go forward (Alt+Right)' : 'Go forward'}
              aria-label="Go forward"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            />
            <input
              type="text"
              placeholder="What do you want to play? Search songs, artists, albums..."
              value={searchQuery}
              onChange={handleSearchChange}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              className="w-full bg-elevated text-primary placeholder-muted text-xs md:text-sm pl-10 pr-8 py-2.5 rounded-full border border-customBorder/50 focus:border-accent focus:bg-highlight outline-none transition-all select-text"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary p-1 rounded-full transition-colors cursor-pointer"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Tools & Themes */}
        <div className="flex items-center gap-2">
          {updateAvailable && latestRelease && (
            <button
              type="button"
              onClick={() => setUpdateModalOpen(true)}
              data-testid="topbar-update-btn"
              aria-label="Update Available"
              className="px-2.5 py-1.5 rounded-full flex items-center gap-1.5 text-xs font-extrabold bg-accent text-black shadow-md shadow-accent/25 hover:bg-accentHover transition-all cursor-pointer animate-pulse"
              title={`Update Available: v${latestRelease.version}`}
            >
              <ArrowDownCircle size={15} />
              <span>Update v{latestRelease.version}</span>
            </button>
          )}


          {/* Visualizer Toggle */}
          <button
            onClick={() => toggleVisualizer()}
            data-testid="toggle-visualizer"
            aria-label="Toggle Audio Visualizer"
            className={`p-2 rounded-full transition-all cursor-pointer ${
              isVisualizerOpen
                ? 'bg-accent/20 text-accent border border-accent/40 shadow-sm'
                : 'bg-elevated hover:bg-highlight text-secondary hover:text-primary'
            }`}
            title="Audio Spectrum & Nebula Visualizer"
          >
            <VisualizerIcon size={18} />
          </button>

          {/* Equalizer Toggle */}
          <button
            onClick={() => toggleRightDrawer('equalizer')}
            data-testid="open-equalizer-btn"
            aria-label="Equalizer"
            className="p-2 rounded-full bg-elevated hover:bg-highlight text-secondary hover:text-primary transition-colors"
            title="10-Band Equalizer"
          >
            <Sliders size={17} />
          </button>

          {/* Expanding Theme Palette Dropdown */}
          <div
            ref={desktopThemeRef}
            onMouseEnter={() => setIsThemeHovered(true)}
            onMouseLeave={() => setIsThemeHovered(false)}
            className="relative flex items-center"
          >
            <button
              type="button"
              onClick={() => setIsThemeOpen((prev) => !prev)}
              data-testid="theme-selector"
              aria-label="Select Theme Color"
              aria-expanded={isThemeOpen}
              title="Select Accent Color"
              className={`group relative flex items-center h-[33px] rounded-full bg-elevated hover:bg-highlight transition-all duration-300 ease-out overflow-hidden cursor-pointer ${
                isThemeExpanded
                  ? 'w-[164px] pl-8 pr-6 border border-customBorder text-primary'
                  : 'w-[33px] px-0 border border-transparent text-secondary hover:text-primary'
              }`}
            >
              <Palette
                size={17}
                className={`absolute left-[8px] top-1/2 -translate-y-1/2 shrink-0 transition-colors duration-200 ${
                  isThemeExpanded ? 'text-accent' : 'text-secondary group-hover:text-primary'
                }`}
              />
              <span
                className={`text-xs font-semibold truncate whitespace-nowrap transition-opacity duration-200 ${
                  isThemeExpanded ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {activeAccentName}
              </span>
              <ChevronDown
                size={14}
                className={`absolute right-2.5 top-1/2 -translate-y-1/2 shrink-0 text-secondary group-hover:text-primary transition-all duration-200 ${
                  isThemeExpanded ? 'opacity-100' : 'opacity-0'
                } ${isThemeOpen ? 'rotate-180 text-accent' : ''}`}
              />
            </button>

            {isThemeOpen && renderThemeMenu()}
          </div>

          {/* Google Authentication / User Profile */}
          <AuthButton />
        </div>
      </div>

      {/* Mobile Header (< md) */}
      <div className="flex md:hidden items-center justify-between gap-2 h-14 px-3">
        {/* Brand logo & title */}
        <button
          onClick={() => {
            setActiveView('home');
            document.getElementById('content')?.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="flex items-center gap-2 text-primary font-extrabold text-base tracking-tight hover:text-accent transition-colors cursor-pointer select-none"
        >
          <BrandLogo size={28} />
          <span className="font-bold tracking-tight">dotify</span>
        </button>

        {/* Mobile Action Icons */}
        <div className="flex items-center gap-1.5">
          {updateAvailable && latestRelease && (
            <button
              type="button"
              onClick={() => setUpdateModalOpen(true)}
              aria-label="Update Available"
              className="px-2 py-1 rounded-full flex items-center gap-1 text-[11px] font-extrabold bg-accent text-black shadow-sm animate-pulse"
              title={`Update Available: v${latestRelease.version}`}
            >
              <ArrowDownCircle size={13} />
              <span>v{latestRelease.version}</span>
            </button>
          )}

          {activeView !== 'search' && (
            <button
              onClick={() => setActiveView('search')}
              aria-label="Search"
              className="p-2 rounded-full bg-elevated text-secondary hover:text-primary transition-colors"
              title="Search"
            >
              <Search size={16} />
            </button>
          )}


          <button
            onClick={() => toggleVisualizer()}
            aria-label="Toggle Audio Visualizer"
            className={`p-2 rounded-full transition-colors ${
              isVisualizerOpen
                ? 'bg-accent/20 text-accent'
                : 'bg-elevated text-secondary hover:text-primary'
            }`}
            title="Audio Spectrum & Nebula Visualizer"
          >
            <VisualizerIcon size={16} />
          </button>

          <button
            onClick={() => toggleRightDrawer('equalizer')}
            aria-label="Equalizer"
            className="p-2 rounded-full bg-elevated text-secondary hover:text-primary transition-colors"
            title="10-Band Equalizer"
          >
            <Sliders size={16} />
          </button>

          {/* Mobile Expanding Theme Palette Dropdown */}
          <div
            ref={mobileThemeRef}
            onMouseEnter={() => setIsThemeHovered(true)}
            onMouseLeave={() => setIsThemeHovered(false)}
            className="relative flex items-center"
          >
            <button
              type="button"
              onClick={() => setIsThemeOpen((prev) => !prev)}
              aria-label="Select Theme Color"
              aria-expanded={isThemeOpen}
              title="Select Accent Color"
              className={`group relative flex items-center h-8 rounded-full bg-elevated transition-all duration-300 ease-out overflow-hidden cursor-pointer ${
                isThemeExpanded
                  ? 'w-[144px] pl-7 pr-5 border border-customBorder text-primary'
                  : 'w-8 px-0 border border-transparent text-secondary hover:text-primary'
              }`}
            >
              <Palette
                size={16}
                className={`absolute left-[8px] top-1/2 -translate-y-1/2 shrink-0 transition-colors duration-200 ${
                  isThemeExpanded ? 'text-accent' : 'text-secondary'
                }`}
              />
              <span
                className={`text-xs font-semibold truncate whitespace-nowrap transition-opacity duration-200 ${
                  isThemeExpanded ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {activeAccentName}
              </span>
              <ChevronDown
                size={13}
                className={`absolute right-2 top-1/2 -translate-y-1/2 shrink-0 text-secondary transition-all duration-200 ${
                  isThemeExpanded ? 'opacity-100' : 'opacity-0'
                } ${isThemeOpen ? 'rotate-180 text-accent' : ''}`}
              />
            </button>

            {isThemeOpen && renderThemeMenu()}
          </div>

          <AuthButton />
        </div>
      </div>
    </header>
  );
};

