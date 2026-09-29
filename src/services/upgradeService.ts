import { db } from './firebase';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
} from 'firebase/firestore';
import { UpgradeRequest, UpgradeAttachment, UpgradeChatMessage, HostStatus, UpgradeType } from '../types/upgrade';
import { safeStorage } from '../utils/storage';
import { getApiBaseUrl, isAndroidApp } from './apiConfig';
import { authService } from './authService';

const UPGRADE_COLLECTION = 'upgrade_requests';
const ATTACHMENT_COLLECTION = 'upgrade_request_attachments';
const SYSTEM_COLLECTION = 'upgrade_system';
const STORAGE_LOCAL_UPGRADES = 'dotify_cached_upgrades';

export async function compressImageFile(
  file: File,
  maxDimension = 1600,
  quality = 0.82
): Promise<UpgradeAttachment> {
  const id = `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const name = file.name || `image_${Date.now()}.png`;

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const rawDataUrl = e.target?.result as string;
      if (!rawDataUrl) {
        return resolve({
          id,
          name,
          mimeType: file.type || 'image/png',
          dataUrl: '',
          previewDataUrl: '',
          sizeBytes: file.size,
        });
      }

      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
        }

        const outMime = file.type === 'image/png' && file.size < 400000 ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(outMime, quality);

        // Generate tiny micro thumbnail for instant list view
        const thumbCanvas = document.createElement('canvas');
        const thumbScale = Math.min(1, 160 / Math.max(img.width, img.height));
        thumbCanvas.width = Math.max(1, Math.round(img.width * thumbScale));
        thumbCanvas.height = Math.max(1, Math.round(img.height * thumbScale));
        const thumbCtx = thumbCanvas.getContext('2d');
        if (thumbCtx) {
          thumbCtx.drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);
        }
        const previewDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.65);

        resolve({
          id,
          name,
          mimeType: outMime,
          dataUrl,
          previewDataUrl,
          sizeBytes: Math.round(dataUrl.length * 0.75),
        });
      };

      img.onerror = () => {
        resolve({
          id,
          name,
          mimeType: file.type || 'image/png',
          dataUrl: rawDataUrl,
          previewDataUrl: rawDataUrl,
          sizeBytes: file.size,
        });
      };

      img.src = rawDataUrl;
    };

    reader.onerror = () => {
      resolve({
        id,
        name,
        mimeType: file.type || 'image/png',
        dataUrl: '',
        previewDataUrl: '',
        sizeBytes: 0,
      });
    };

    reader.readAsDataURL(file);
  });
}

export class UpgradeService {
  private static instance: UpgradeService;
  private cachedRequests: UpgradeRequest[] = [];
  private requestSubscribers: Array<(reqs: UpgradeRequest[]) => void> = [];
  private hostStatusSubscribers: Array<(status: HostStatus) => void> = [];
  private currentHostStatus: HostStatus = { status: 'offline' };

  private constructor() {
    this.cachedRequests = safeStorage.getItem<UpgradeRequest[]>(STORAGE_LOCAL_UPGRADES, []);
    this.setupListeners();
  }

  public static getInstance(): UpgradeService {
    if (!UpgradeService.instance) {
      UpgradeService.instance = new UpgradeService();
    }
    return UpgradeService.instance;
  }

  private setupListeners() {
    if (typeof window === 'undefined') return;

    // 1. Subscribe to Firestore upgrade_requests
    try {
      const q = query(collection(db, UPGRADE_COLLECTION));
      onSnapshot(
        q,
        (snapshot) => {
          const list: UpgradeRequest[] = [];
          snapshot.forEach((snap) => {
            const data = snap.data() as UpgradeRequest;
            if (data && data.id) {
              list.push(data);
            }
          });

          list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          this.cachedRequests = list;
          safeStorage.setItem(STORAGE_LOCAL_UPGRADES, list);
          this.notifyRequestSubscribers();
        },
        (err) => {
          console.debug('[UpgradeService] Firestore request sync deferred:', err.message);
        }
      );
    } catch (e) {
      console.debug('[UpgradeService] Firestore onSnapshot setup deferred:', e);
    }

    // 2. Subscribe to Firestore Host Status (tells if your PC is ON and running OpenCode)
    try {
      const hostDocRef = doc(db, SYSTEM_COLLECTION, 'host_status');
      onSnapshot(
        hostDocRef,
        (snapshot) => {
          if (snapshot.exists()) {
            const raw = snapshot.data() as HostStatus;
            const isFresh = Date.now() - (raw.lastSeen || 0) < 60000;
            this.currentHostStatus = {
              ...raw,
              status: isFresh ? raw.status || 'online' : 'offline',
            };
          } else {
            this.currentHostStatus = { status: 'offline' };
          }
          this.notifyHostSubscribers();
        },
        () => {
          this.checkHostStatusViaLocalApi();
        }
      );
    } catch {
      this.checkHostStatusViaLocalApi();
    }

    // Fallback polling for host status
    setInterval(() => {
      this.checkHostStatusViaLocalApi();
    }, 15000);
  }

  private async checkHostStatusViaLocalApi() {
    try {
      const baseUrl = getApiBaseUrl() || 'http://localhost:3001';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${baseUrl}/api/upgrades/status`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        this.currentHostStatus = {
          status: 'online',
          hostname: data.hostname,
          model: data.model,
          activeRequestId: data.activeRequestId,
          lastSeen: Date.now(),
          inboxRoot: data.inboxRoot,
          forksRoot: data.forksRoot,
        };
        this.notifyHostSubscribers();
      }
    } catch {
      // Offline or local server not directly reachable
    }
  }

  private notifyRequestSubscribers() {
    this.requestSubscribers.forEach((cb) => {
      try {
        cb(this.cachedRequests);
      } catch {}
    });
  }

  private notifyHostSubscribers() {
    this.hostStatusSubscribers.forEach((cb) => {
      try {
        cb(this.currentHostStatus);
      } catch {}
    });
  }

  public subscribeToRequests(callback: (reqs: UpgradeRequest[]) => void): () => void {
    this.requestSubscribers.push(callback);
    callback(this.cachedRequests);
    return () => {
      this.requestSubscribers = this.requestSubscribers.filter((cb) => cb !== callback);
    };
  }

  public subscribeToHostStatus(callback: (status: HostStatus) => void): () => void {
    this.hostStatusSubscribers.push(callback);
    callback(this.currentHostStatus);
    return () => {
      this.hostStatusSubscribers = this.hostStatusSubscribers.filter((cb) => cb !== callback);
    };
  }

  public getHostStatus(): HostStatus {
    return this.currentHostStatus;
  }

  public async submitRequest(params: {
    type: UpgradeType;
    title: string;
    prompt: string;
    attachments: UpgradeAttachment[];
    autoApply?: boolean;
  }): Promise<UpgradeRequest> {
    const user = authService.getCurrentUser();
    const now = Date.now();
    const id = `req_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const platform = isAndroidApp() ? 'android' : typeof window !== 'undefined' && (window as any).__TAURI__ ? 'windows' : 'web';

    const submittedBy = {
      uid: user?.uid || 'guest',
      email: user?.email || 'user@dotify.local',
      displayName: user?.displayName || 'Dotify User',
      platform,
    };

    // 1. Separate full dataUrls into Firestore attachment collection to keep the main doc light
    const sanitizedAttachments: UpgradeAttachment[] = [];
    for (let i = 0; i < params.attachments.length; i++) {
      const att = params.attachments[i];
      const attDocId = `${id}_att_${i}`;

      if (att.dataUrl && att.dataUrl.length > 50) {
        try {
          await setDoc(doc(db, ATTACHMENT_COLLECTION, attDocId), {
            id: attDocId,
            requestId: id,
            name: att.name,
            mimeType: att.mimeType,
            dataUrl: att.dataUrl,
            createdAt: now,
          });
        } catch (attErr: any) {
          console.warn('[UpgradeService] Attachment upload to Firestore deferred:', attErr.message);
        }
      }

      sanitizedAttachments.push({
        id: att.id || attDocId,
        name: att.name,
        mimeType: att.mimeType,
        attachmentDocId: attDocId,
        previewDataUrl: att.previewDataUrl || (att.dataUrl && att.dataUrl.length < 80000 ? att.dataUrl : ''),
        sizeBytes: att.sizeBytes || 0,
      });
    }

    const initialMessage: UpgradeChatMessage = {
      id: `msg_${now}`,
      role: 'user',
      authorName: submittedBy.displayName,
      text: params.prompt,
      attachments: sanitizedAttachments,
      createdAt: now,
    };

    const newRequest: UpgradeRequest = {
      id,
      type: params.type,
      title: params.title.trim() || params.prompt.slice(0, 50),
      prompt: params.prompt,
      status: 'queued',
      model: 'opencode/muse-spark-1.3 (xhigh)',
      createdAt: now,
      updatedAt: now,
      submittedBy,
      attachments: sanitizedAttachments,
      messages: [initialMessage],
      autoApply: params.autoApply ?? true,
    };

    // 2. Save locally immediately
    this.cachedRequests = [newRequest, ...this.cachedRequests.filter((r) => r.id !== id)];
    safeStorage.setItem(STORAGE_LOCAL_UPGRADES, this.cachedRequests);
    this.notifyRequestSubscribers();

    // 3. Write to Firestore `upgrade_requests` collection (queues in cloud even if PC is off)
    try {
      const cleanDoc = JSON.parse(JSON.stringify(newRequest));
      await setDoc(doc(db, UPGRADE_COLLECTION, id), cleanDoc, { merge: true });
      console.log('[UpgradeService] Request submitted to Firebase Cloud Queue successfully:', id);
    } catch (err: any) {
      console.warn('[UpgradeService] Firestore queue write error:', err.message);
    }

    // 4. Also notify local server if online for instant pickup
    try {
      const baseUrl = getApiBaseUrl() || 'http://localhost:3001';
      fetch(`${baseUrl}/api/upgrades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newRequest,
          attachments: params.attachments, // send full attachments if local server is reachable
        }),
      }).catch(() => {});
    } catch {}

    return newRequest;
  }

  public async sendChatMessage(
    requestId: string,
    text: string,
    attachments: UpgradeAttachment[] = []
  ): Promise<void> {
    const user = authService.getCurrentUser();
    const now = Date.now();
    const authorName = user?.displayName || 'Dotify User';

    const existing = this.cachedRequests.find((r) => r.id === requestId);
    if (!existing) return;

    const sanitizedAttachments: UpgradeAttachment[] = [];
    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      const attDocId = `${requestId}_att_${now}_${i}`;

      if (att.dataUrl && att.dataUrl.length > 50) {
        try {
          await setDoc(doc(db, ATTACHMENT_COLLECTION, attDocId), {
            id: attDocId,
            requestId,
            name: att.name,
            mimeType: att.mimeType,
            dataUrl: att.dataUrl,
            createdAt: now,
          });
        } catch {}
      }

      sanitizedAttachments.push({
        id: att.id || attDocId,
        name: att.name,
        mimeType: att.mimeType,
        attachmentDocId: attDocId,
        previewDataUrl: att.previewDataUrl || '',
        sizeBytes: att.sizeBytes || 0,
      });
    }

    const newMsg: UpgradeChatMessage = {
      id: `msg_${now}`,
      role: 'user',
      authorName,
      text,
      attachments: sanitizedAttachments,
      createdAt: now,
    };

    const updated: UpgradeRequest = {
      ...existing,
      status: 'queued', // Re-queues so the PC worker runs OpenCode on the same fork
      messages: [...(existing.messages || []), newMsg],
      attachments: [...(existing.attachments || []), ...sanitizedAttachments],
      prompt: text,
      updatedAt: now,
    };

    this.cachedRequests = this.cachedRequests.map((r) => (r.id === requestId ? updated : r));
    safeStorage.setItem(STORAGE_LOCAL_UPGRADES, this.cachedRequests);
    this.notifyRequestSubscribers();

    try {
      const cleanDoc = JSON.parse(JSON.stringify(updated));
      await setDoc(doc(db, UPGRADE_COLLECTION, requestId), cleanDoc, { merge: true });
    } catch (err: any) {
      console.warn('[UpgradeService] Firestore chat reply sync deferred:', err.message);
    }

    try {
      const baseUrl = getApiBaseUrl() || 'http://localhost:3001';
      fetch(`${baseUrl}/api/upgrades/${encodeURIComponent(requestId)}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          attachments,
          authorName,
        }),
      }).catch(() => {});
    } catch {}
  }

  public async retryRequest(requestId: string): Promise<void> {
    const existing = this.cachedRequests.find((r) => r.id === requestId);
    if (!existing) return;

    const updated: UpgradeRequest = {
      ...existing,
      status: 'queued',
      updatedAt: Date.now(),
      error: undefined,
    };

    this.cachedRequests = this.cachedRequests.map((r) => (r.id === requestId ? updated : r));
    safeStorage.setItem(STORAGE_LOCAL_UPGRADES, this.cachedRequests);
    this.notifyRequestSubscribers();

    try {
      await setDoc(
        doc(db, UPGRADE_COLLECTION, requestId),
        { status: 'queued', updatedAt: Date.now(), error: '' },
        { merge: true }
      );
    } catch {}
  }

  public async getAttachmentFullDataUrl(att: UpgradeAttachment): Promise<string> {
    if (att.dataUrl && att.dataUrl.startsWith('data:')) {
      return att.dataUrl;
    }
    if (att.attachmentDocId) {
      try {
        const snap = await getDoc(doc(db, ATTACHMENT_COLLECTION, att.attachmentDocId));
        if (snap.exists()) {
          const data = snap.data();
          if (data?.dataUrl) {
            att.dataUrl = data.dataUrl;
            return data.dataUrl;
          }
        }
      } catch {}
    }
    return att.previewDataUrl || '';
  }

  public async applyUpgrade(requestId: string): Promise<{ ok: boolean; version?: string; error?: string }> {
    const baseUrl = getApiBaseUrl() || 'http://localhost:3001';
    try {
      const res = await fetch(`${baseUrl}/api/upgrades/${encodeURIComponent(requestId)}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return data;
    } catch (err: any) {
      console.error('[UpgradeService] applyUpgrade failed:', err);
      return { ok: false, error: err.message };
    }
  }
}

export const upgradeService = UpgradeService.getInstance();
