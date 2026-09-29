import React from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { QueueDrawer } from '../player/QueueDrawer';
import { EqualizerDrawer } from '../player/EqualizerDrawer';
import { X, ListMusic, Sliders } from 'lucide-react';

export const RightDrawer: React.FC = () => {
  const { isRightDrawerOpen, rightDrawerTab, toggleRightDrawer } = usePlayerStore();

  if (!isRightDrawerOpen) return null;

  return (
    <aside
      data-testid="right-drawer"
      role="complementary"
      className="hidden lg:flex flex-col w-80 bg-surface border-l border-customBorder h-full z-20 select-none shadow-2xl animate-in slide-in-from-right duration-200"
    >
      {/* Header Tabs */}
      <div className="flex items-center justify-between px-3.5 h-13 py-2.5 border-b border-customBorder shrink-0">
        <div className="flex items-center gap-1 bg-base/40 p-1 rounded-lg border border-customBorder/60">
          <button
            onClick={() => toggleRightDrawer('queue')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              rightDrawerTab === 'queue'
                ? 'bg-elevated text-accent shadow-sm'
                : 'text-secondary hover:text-primary'
            }`}
          >
            <ListMusic size={14} />
            <span>Queue</span>
          </button>

          <button
            onClick={() => toggleRightDrawer('equalizer')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              rightDrawerTab === 'equalizer'
                ? 'bg-elevated text-accent shadow-sm'
                : 'text-secondary hover:text-primary'
            }`}
          >
            <Sliders size={14} />
            <span>Equalizer</span>
          </button>
        </div>

        <button
          onClick={() => toggleRightDrawer()}
          className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-highlight transition-colors"
          title="Close drawer"
          aria-label="Close drawer"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
        {rightDrawerTab === 'queue' ? <QueueDrawer /> : <EqualizerDrawer />}
      </div>
    </aside>
  );
};

