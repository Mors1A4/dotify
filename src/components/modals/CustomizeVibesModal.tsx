import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, SlidersHorizontal, Check, Plus, Trash2, ChevronDown, ChevronUp, Lightbulb, RefreshCw } from 'lucide-react';
import { UserVibeConfig } from '../../types/vibes';
import { dailyVibeManager, DEFAULT_VIBE_PRESETS } from '../../services/dailyVibeManager';
import { useAuthStore } from '../../store/authStore';

export interface CustomizeVibesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSavedAndRegenerated?: () => void;
  isOnboarding?: boolean;
}

const THEME_COLORS: Array<'purple' | 'emerald' | 'rose' | 'blue' | 'amber'> = [
  'purple',
  'emerald',
  'rose',
  'blue',
  'amber',
];

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/40', text: 'text-purple-400', dot: 'bg-purple-500' },
  emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/40', text: 'text-emerald-400', dot: 'bg-emerald-500' },
  rose: { bg: 'bg-rose-500/10', border: 'border-rose-500/40', text: 'text-rose-400', dot: 'bg-rose-500' },
  blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/40', text: 'text-blue-400', dot: 'bg-blue-500' },
  amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/40', text: 'text-amber-400', dot: 'bg-amber-500' },
};

const DEFAULT_SLOT_EXAMPLES = [
  'e.g. Late Night Coding',
  'e.g. Deep Focus Work',
  'e.g. High Energy Workout',
  'e.g. Sunday Relaxation',
  'e.g. Neon Night Drive',
];

export const CustomizeVibesModal: React.FC<CustomizeVibesModalProps> = ({
  isOpen,
  onClose,
  onSavedAndRegenerated,
  isOnboarding = false,
}) => {
  const { user } = useAuthStore();
  const accountId = user?.uid || 'guest';

  // Exactly 5 vibe slots
  const [slots, setSlots] = useState<UserVibeConfig[]>([
    { id: 'vibe_1', label: '', prompt: '', themeColor: 'purple' },
    { id: 'vibe_2', label: '', prompt: '', themeColor: 'emerald' },
    { id: 'vibe_3', label: '', prompt: '', themeColor: 'rose' },
    { id: 'vibe_4', label: '', prompt: '', themeColor: 'blue' },
    { id: 'vibe_5', label: '', prompt: '', themeColor: 'amber' },
  ]);

  const [expandedSlotIndex, setExpandedSlotIndex] = useState<number | null>(null);
  const [quickAddInput, setQuickAddInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  // Initialize slots when modal opens
  useEffect(() => {
    if (isOpen) {
      const saved = dailyVibeManager.getUserVibes(accountId);
      if (saved && saved.length === 5) {
        setSlots(saved.map((s, idx) => ({ ...s, themeColor: s.themeColor || THEME_COLORS[idx % 5] })));
      } else {
        // Fresh onboarding: clean empty slots ready for typing
        setSlots(
          THEME_COLORS.map((color, idx) => ({
            id: `vibe_${idx + 1}`,
            label: '',
            prompt: '',
            themeColor: color,
          }))
        );
      }
      setExpandedSlotIndex(null);
      setQuickAddInput('');
      setStatusNotice(null);
    }
  }, [isOpen, accountId]);

  if (!isOpen) return null;

  const filledSlotsCount = slots.filter((s) => s.label.trim().length > 0).length;
  const isAllFilled = filledSlotsCount === 5;

  const handleUpdateSlotLabel = (index: number, newLabel: string) => {
    setStatusNotice(null);
    setSlots((prev) =>
      prev.map((s, idx) => {
        if (idx !== index) return s;
        const cleanLabel = newLabel;
        const cleanId = cleanLabel.trim()
          ? cleanLabel.trim().toLowerCase().replace(/[^a-z0-9]/g, '_')
          : `vibe_${idx + 1}`;
        return {
          ...s,
          id: cleanId,
          label: cleanLabel,
          isAmended: true,
          // If prompt wasn't manually customized, keep it synced with label
          prompt: s.prompt ? s.prompt : `Soundscape for ${cleanLabel} matching your personal taste.`,
        };
      })
    );
  };

  const handleUpdateSlotPrompt = (index: number, newPrompt: string) => {
    setSlots((prev) =>
      prev.map((s, idx) => (idx === index ? { ...s, prompt: newPrompt, isAmended: true } : s))
    );
  };

  const handleClearSlot = (index: number) => {
    setStatusNotice(null);
    setSlots((prev) =>
      prev.map((s, idx) =>
        idx === index
          ? {
              id: `vibe_${idx + 1}`,
              label: '',
              prompt: '',
              themeColor: THEME_COLORS[idx % 5],
              isAmended: true,
            }
          : s
      )
    );
  };

  const handleQuickAdd = () => {
    const trimmed = quickAddInput.trim();
    if (!trimmed) return;

    // Find first empty slot
    const emptyIndex = slots.findIndex((s) => !s.label.trim());
    if (emptyIndex === -1) {
      setStatusNotice('All 5 vibe slots are filled. Clear or edit a slot to change it.');
      return;
    }

    handleUpdateSlotLabel(emptyIndex, trimmed);
    setQuickAddInput('');
    setStatusNotice(null);
  };

  const handleSelectIdea = (idea: UserVibeConfig) => {
    setStatusNotice(null);
    // Find first empty slot
    const emptyIndex = slots.findIndex((s) => !s.label.trim());
    if (emptyIndex === -1) {
      setStatusNotice('All 5 vibe slots are already filled. Clear a slot first.');
      return;
    }

    setSlots((prev) =>
      prev.map((s, idx) =>
        idx === emptyIndex
          ? {
              id: idea.id,
              label: idea.label,
              prompt: idea.prompt,
              themeColor: idea.themeColor || THEME_COLORS[idx % 5],
              defaultCover: idea.defaultCover,
              isAmended: true,
            }
          : s
      )
    );
  };

  const handleFillStandardIdeas = () => {
    setSlots(DEFAULT_VIBE_PRESETS.slice(0, 5).map((p, idx) => ({ ...p, themeColor: THEME_COLORS[idx % 5] })));
    setStatusNotice('Filled slots with 5 starter ideas. Feel free to edit or re-type any of them!');
  };

  const handleSaveAndCurate = async () => {
    const uncompleted = slots.findIndex((s) => !s.label.trim());
    if (uncompleted !== -1) {
      setStatusNotice(`Please type or fill Vibe ${uncompleted + 1} to have all 5 daily vibes.`);
      return;
    }

    setIsSaving(true);
    setStatusNotice(null);

    try {
      // 1. Save user vibes to storage
      dailyVibeManager.saveUserVibes(slots, accountId);

      // 2. Curate 5 playlists tailored to user's taste with Gemini
      await dailyVibeManager.getDailyVibes(accountId, true);

      // 3. Notify parent
      onSavedAndRegenerated?.();
      onClose();
    } catch (err: any) {
      console.error('[CustomizeVibesModal] Error during vibe curation:', err);
      // Fallback guarantees cache is saved, so always refresh parent and close
      onSavedAndRegenerated?.();
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={isSaving ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl bg-surface border border-subtle/50 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-subtle/40 flex items-center justify-between bg-card/60">
          <div>
            <div className="flex items-center gap-2.5">
              <SlidersHorizontal className="text-accent" size={20} />
              <h2 className="text-lg sm:text-xl font-bold text-primary tracking-tight">
                {isOnboarding ? 'Set Up Your 5 Vibe Playlists' : 'Customize Your 5 Vibe Playlists'}
              </h2>
            </div>
            <p className="text-xs text-secondary mt-1 max-w-lg">
              Type the 5 vibes, activities, or moods you want soundtracks for. Dotify AI curates 20–30 tracks for each vibe, deeply tailored to your music taste. Refresh anytime for a brand new mix.
            </p>
          </div>

          <button
            onClick={onClose}
            disabled={isSaving}
            className="p-2 rounded-xl text-secondary hover:text-primary hover:bg-elevated/80 transition-colors disabled:opacity-40"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Status notification banner */}
        {statusNotice && (
          <div className="px-6 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-300 flex items-center justify-between">
            <span>{statusNotice}</span>
            <button
              onClick={() => setStatusNotice(null)}
              className="text-amber-300/70 hover:text-amber-200 ml-2"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Quick Type Input Bar */}
          <div className="p-3.5 rounded-xl bg-elevated/40 border border-subtle/40 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              value={quickAddInput}
              onChange={(e) => setQuickAddInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleQuickAdd();
                }
              }}
              placeholder="Type any vibe (e.g. Late Night Coding, Gym PR, Sunday Brunch)..."
              maxLength={40}
              className="flex-1 px-3.5 py-2 bg-surface border border-subtle/70 rounded-lg text-sm text-primary placeholder-secondary/50 focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={handleQuickAdd}
              disabled={!quickAddInput.trim()}
              className="px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-1.5 shrink-0"
            >
              <Plus size={14} />
              <span>Add to Next Slot</span>
            </button>
          </div>

          {/* The 5 Vibe Slots */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider">
                Your 5 Vibes ({filledSlotsCount} / 5 Ready)
              </h3>
              <button
                type="button"
                onClick={handleFillStandardIdeas}
                className="text-xs text-secondary/70 hover:text-accent transition-colors flex items-center gap-1"
                title="Fill with standard starter suggestions"
              >
                <RefreshCw size={11} />
                <span>Fill with starter ideas</span>
              </button>
            </div>

            {slots.map((slot, idx) => {
              const colorInfo = COLOR_MAP[slot.themeColor || THEME_COLORS[idx % 5]];
              const isFilled = slot.label.trim().length > 0;
              const isExpanded = expandedSlotIndex === idx;

              return (
                <div
                  key={`slot-${idx}`}
                  className={`p-3.5 rounded-xl border transition-all ${
                    isFilled
                      ? `${colorInfo.bg} ${colorInfo.border}`
                      : 'bg-elevated/20 border-dashed border-subtle/60 hover:border-subtle'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Slot badge */}
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                        isFilled
                          ? `${colorInfo.text} bg-surface border ${colorInfo.border}`
                          : 'text-secondary/50 bg-surface/50 border border-subtle/40'
                      }`}
                    >
                      {idx + 1}
                    </div>

                    {/* Vibe label text input */}
                    <input
                      type="text"
                      value={slot.label}
                      onChange={(e) => handleUpdateSlotLabel(idx, e.target.value)}
                      placeholder={DEFAULT_SLOT_EXAMPLES[idx]}
                      maxLength={35}
                      className="flex-1 bg-surface/80 border border-subtle/50 focus:border-accent rounded-lg px-3 py-1.5 text-sm font-medium text-primary placeholder-secondary/40 focus:outline-none transition-colors"
                    />

                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isFilled && (
                        <button
                          type="button"
                          onClick={() => setExpandedSlotIndex(isExpanded ? null : idx)}
                          className="p-1.5 rounded-lg text-secondary/70 hover:text-primary hover:bg-elevated/60 transition-colors"
                          title="Optional soundscape direction"
                        >
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      )}

                      {isFilled && (
                        <button
                          type="button"
                          onClick={() => handleClearSlot(idx)}
                          className="p-1.5 rounded-lg text-secondary/70 hover:text-red-400 hover:bg-elevated/60 transition-colors"
                          title="Clear this slot"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expandable Optional Music Direction */}
                  {isExpanded && isFilled && (
                    <div className="mt-3 pt-3 border-t border-subtle/30 space-y-1.5 animate-in fade-in duration-150">
                      <label className="block text-[11px] font-medium text-secondary">
                        Optional Musical Direction / Tone (sent to Gemini):
                      </label>
                      <input
                        type="text"
                        value={slot.prompt || ''}
                        onChange={(e) => handleUpdateSlotPrompt(idx, e.target.value)}
                        placeholder={`e.g. Fast-paced synthwave, energetic beats, zero vocal distraction...`}
                        maxLength={160}
                        className="w-full bg-surface border border-subtle/60 focus:border-accent rounded-lg px-3 py-1.5 text-xs text-primary placeholder-secondary/40 focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Inspiration Ideas section */}
          <div className="pt-2">
            <div className="flex items-center gap-1.5 mb-2.5">
              <Lightbulb size={13} className="text-amber-400" />
              <h4 className="text-xs font-semibold text-secondary">
                Need ideas? Click any to fill an empty slot:
              </h4>
            </div>

            <div className="flex flex-wrap gap-2">
              {DEFAULT_VIBE_PRESETS.map((preset) => {
                const isAlreadySelected = slots.some(
                  (s) => s.label.trim().toLowerCase() === preset.label.trim().toLowerCase()
                );

                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectIdea(preset)}
                    disabled={isAlreadySelected}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${
                      isAlreadySelected
                        ? 'opacity-40 border-subtle bg-elevated/10 cursor-not-allowed text-secondary'
                        : 'border-subtle/60 bg-elevated/30 hover:bg-elevated/80 hover:border-accent/60 text-primary'
                    }`}
                  >
                    <span>+ {preset.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-subtle/40 flex items-center justify-between bg-card/60">
          <div className="text-xs text-secondary">
            {isAllFilled ? (
              <span className="text-accent font-medium">All 5 vibes ready!</span>
            ) : (
              <span>Fill {5 - filledSlotsCount} more vibe{5 - filledSlotsCount === 1 ? '' : 's'} to continue</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-xs font-medium text-secondary hover:text-primary transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveAndCurate}
              disabled={isSaving || !isAllFilled}
              className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-md"
            >
              {isSaving ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Curating 5 Playlists...</span>
                </>
              ) : (
                <>
                  <Check size={14} />
                  <span>{isOnboarding ? 'Curate Playlists' : 'Save & Curate'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
