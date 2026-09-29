import React from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { useUpdateStore } from '../../store/updateStore';
import { Search, ChevronLeft, ChevronRight, Sliders, X, ArrowDownCircle } from 'lucide-react';
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

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (val.trim().length > 0 && activeView !== 'search') {
      setActiveView('search');
    }
  };

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

        {/* Tools (colour scheme now lives in the profile menu to save title space) */}
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

          {/* Google Authentication / User Profile (includes Colour scheme selector) */}
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

        {/* Mobile Action Icons (colour scheme now lives in the profile menu) */}
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

          <AuthButton />
        </div>
      </div>
    </header>
  );
};
