import { create } from 'zustand';
import { UpgradeRequest, UpgradeAttachment, HostStatus, UpgradeType } from '../types/upgrade';
import { upgradeService } from '../services/upgradeService';

interface UpgradeStoreState {
  isHelpModalOpen: boolean;
  activeRequestId: string | null;
  requests: UpgradeRequest[];
  hostStatus: HostStatus;

  openHelpModal: (requestId?: string) => void;
  closeHelpModal: () => void;
  toggleHelpModal: (open?: boolean, requestId?: string) => void;
  setActiveRequestId: (id: string | null) => void;

  submitRequest: (params: {
    type: UpgradeType;
    title: string;
    prompt: string;
    attachments: UpgradeAttachment[];
    autoApply?: boolean;
  }) => Promise<UpgradeRequest>;

  sendChatMessage: (requestId: string, text: string, attachments?: UpgradeAttachment[]) => Promise<void>;
  retryRequest: (requestId: string) => Promise<void>;
  applyUpgrade: (requestId: string) => Promise<{ ok: boolean; version?: string; error?: string }>;
}

export const useUpgradeStore = create<UpgradeStoreState>((set, get) => {
  // Wire real-time service subscriptions
  upgradeService.subscribeToRequests((requests) => {
    set({ requests });
  });

  upgradeService.subscribeToHostStatus((hostStatus) => {
    set({ hostStatus });
  });

  return {
    isHelpModalOpen: false,
    activeRequestId: null,
    requests: [],
    hostStatus: upgradeService.getHostStatus(),

    openHelpModal: (requestId) =>
      set({
        isHelpModalOpen: true,
        activeRequestId: requestId !== undefined ? requestId : get().activeRequestId,
      }),

    closeHelpModal: () => set({ isHelpModalOpen: false }),

    toggleHelpModal: (open, requestId) =>
      set((state) => ({
        isHelpModalOpen: open !== undefined ? open : !state.isHelpModalOpen,
        activeRequestId: requestId !== undefined ? requestId : state.activeRequestId,
      })),

    setActiveRequestId: (id) => set({ activeRequestId: id }),

    submitRequest: async (params) => {
      const created = await upgradeService.submitRequest(params);
      set({ activeRequestId: created.id });
      return created;
    },

    sendChatMessage: async (requestId, text, attachments = []) => {
      await upgradeService.sendChatMessage(requestId, text, attachments);
    },

    retryRequest: async (requestId) => {
      await upgradeService.retryRequest(requestId);
    },

    applyUpgrade: async (requestId) => {
      return await upgradeService.applyUpgrade(requestId);
    },
  };
});
