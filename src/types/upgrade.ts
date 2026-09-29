export type UpgradeType = 'upgrade' | 'fix';

export type UpgradeStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface UpgradeAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl?: string;
  previewDataUrl?: string;
  attachmentDocId?: string;
  sizeBytes?: number;
  localPath?: string;
}

export interface UpgradeChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  authorName?: string;
  text: string;
  attachments?: UpgradeAttachment[];
  createdAt: number;
}

export interface UpgradeRequest {
  id: string;
  type: UpgradeType;
  title: string;
  prompt: string;
  status: UpgradeStatus;
  model: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  submittedBy: {
    uid: string;
    email: string;
    displayName: string;
    platform: string;
  };
  attachments: UpgradeAttachment[];
  messages: UpgradeChatMessage[];
  inboxDir?: string;
  savedImages?: string[];
  forkName?: string;
  forkBranch?: string;
  forkPath?: string;
  cliCommand?: string;
  agentLogs?: string;
  agentSummary?: string;
  changedFiles?: string[];
  commitHash?: string;
  error?: string;
}

export interface HostStatus {
  status: 'online' | 'busy' | 'offline';
  hostname?: string;
  platform?: string;
  model?: string;
  activeRequestId?: string | null;
  lastSeen?: number;
  inboxRoot?: string;
  forksRoot?: string;
}
