import React from 'react';
import { usePlayerStore, AppView } from '../../store/playerStore';
import { Home, Search, Library, Sparkles } from 'lucide-react';

export const MobileBottomNav: React.FC = () => {
  const { activeView, setActiveView } = usePlayerStore();

  const navItems: { id: AppView; label: string; icon: React.ReactNode; testId: string }[] = [
    { id: 'home', label: 'Home', icon: <Home size={22} />, testId: 'mobile-nav-home' },
    { id: 'vibe-dj', label: 'Vibe DJ', icon: <Sparkles size={22} />, testId: 'mobile-nav-vibe-dj' },
    { id: 'search', label: 'Search', icon: <Search size={22} />, testId: 'mobile-nav-search' },
    { id: 'library', label: 'Your Library', icon: <Library size={22} />, testId: 'mobile-nav-library' },
  ];

  return (
    <nav
      data-testid="mobile-bottom-nav"
      aria-label="Mobile Navigation"
      className="mobile-nav md:hidden fixed bottom-0 left-0 right-0 min-h-[4rem] bg-surface/95 backdrop-blur-lg border-t border-customBorder grid grid-cols-4 items-center z-40 safe-pb select-none"
    >
      {navItems.map((item) => {
        const isActive = activeView === item.id;
        return (
          <button
            key={item.id}
            data-testid={item.testId}
            onClick={() => setActiveView(item.id)}
            className="flex flex-col items-center justify-center h-full w-full min-h-[48px] min-w-[48px] transition-colors"
          >
            <div className={`transition-transform duration-150 ${isActive ? 'scale-110 text-accent' : 'text-secondary'}`}>
              {item.icon}
            </div>
            <span
              className={`text-[10px] mt-1 font-medium tracking-tight ${
                isActive ? 'text-accent font-bold' : 'text-muted'
              }`}
            >
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
