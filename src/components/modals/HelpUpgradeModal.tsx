import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useUpgradeStore } from '../../store/upgradeStore';
import { UpgradeType, UpgradeAttachment } from '../../types/upgrade';
import { compressImageFile } from '../../services/upgradeService';
import {
  Wand2,
  Lightbulb,
  Plus,
  Bug,
  UploadCloud,
  X,
  Send,
  GitFork,
  CheckCircle2,
  Clock,
  AlertCircle,
  Terminal,
  Paperclip,
  RotateCw,
  FolderOpen,
  Image as ImageIcon,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Code2,
  Rocket,
} from 'lucide-react';

/**
 * Format timestamp into human-readable relative time (e.g. 'Just now', '12m ago', '2h ago', 'Yesterday')
 */
function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return '';
  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Clean copy-to-clipboard helper with fallback
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Minimalist Code Block with syntax highlight tint & 1-click copy
 */
const CodeBlock: React.FC<{ language?: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="my-2.5 rounded-xl border border-customBorder/80 bg-base/90 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-3 py-1.5 bg-elevated/70 border-b border-customBorder/50 text-[11px] font-mono text-muted">
        <span className="uppercase font-semibold tracking-wider text-secondary">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-highlight text-secondary hover:text-primary transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check size={12} className="text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 text-xs font-mono overflow-x-auto select-text leading-relaxed text-emerald-300/90 whitespace-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
};

/**
 * Format markdown text with bold, inline code, paragraphs, and code blocks
 */
const FormattedMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const parts = useMemo(() => {
    // Split by fenced code blocks: ```lang ... ```
    return text.split(/(```[\s\S]*?```)/g);
  }, [text]);

  return (
    <div className="space-y-2 text-xs sm:text-sm leading-relaxed select-text">
      {parts.map((part, idx) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const match = part.match(/^```(\w+)?\n?([\s\S]*?)```$/);
          const lang = match ? match[1] : '';
          const code = match ? match[2].trimEnd() : part.slice(3, -3);
          return <CodeBlock key={idx} language={lang} code={code} />;
        }

        // Split text by lines
        const lines = part.split('\n');
        return (
          <div key={idx} className="space-y-1">
            {lines.map((line, lIdx) => {
              if (!line.trim()) {
                return <div key={lIdx} className="h-2" />;
              }

              // Parse bold and inline code in line
              const tokens = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);

              return (
                <p key={lIdx}>
                  {tokens.map((token, tIdx) => {
                    if (token.startsWith('`') && token.endsWith('`')) {
                      return (
                        <code
                          key={tIdx}
                          className="px-1.5 py-0.5 rounded-md bg-base/80 border border-customBorder/60 font-mono text-[11px] text-accent font-medium mx-0.5"
                        >
                          {token.slice(1, -1)}
                        </code>
                      );
                    }
                    if (token.startsWith('**') && token.endsWith('**')) {
                      return (
                        <strong key={tIdx} className="font-semibold text-primary">
                          {token.slice(2, -2)}
                        </strong>
                      );
                    }
                    return <span key={tIdx}>{token}</span>;
                  })}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

export const HelpUpgradeModal: React.FC = () => {
  const {
    isHelpModalOpen,
    closeHelpModal,
    activeRequestId,
    setActiveRequestId,
    requests,
    hostStatus,
    submitRequest,
    sendChatMessage,
    retryRequest,
    applyUpgrade,
  } = useUpgradeStore();

  const [mode, setMode] = useState<'create' | 'thread'>('create');
  const [requestType, setRequestType] = useState<UpgradeType>('upgrade');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<UpgradeAttachment[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [autoApply, setAutoApply] = useState(true);

  // Apply & release state
  const [isApplying, setIsApplying] = useState(false);
  const [applyStatusMessage, setApplyStatusMessage] = useState<string | null>(null);

  // Follow-up reply state
  const [replyText, setReplyText] = useState('');
  const [replyAttachments, setReplyAttachments] = useState<UpgradeAttachment[]>([]);
  const [isReplying, setIsReplying] = useState(false);

  // Live log viewer collapse
  const [showLogs, setShowLogs] = useState(false);

  // Full-size image preview modal
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Clipboard copy feedback
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // When activeRequestId changes or modal opens, decide view
  useEffect(() => {
    if (activeRequestId && requests.some((r) => r.id === activeRequestId)) {
      setMode('thread');
    } else {
      setMode('create');
    }
  }, [activeRequestId, requests]);

  // Scroll to bottom of message thread
  useEffect(() => {
    if (mode === 'thread') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [mode, activeRequestId, requests]);

  // Global Esc to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isHelpModalOpen) {
        if (previewImage) {
          setPreviewImage(null);
        } else {
          closeHelpModal();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isHelpModalOpen, previewImage, closeHelpModal]);

  // Clipboard paste listener to attach screenshots with Ctrl+V
  useEffect(() => {
    if (!isHelpModalOpen) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        setIsCompressing(true);
        try {
          const compressed = await Promise.all(imageFiles.map((f) => compressImageFile(f)));
          if (mode === 'create') {
            setPendingAttachments((prev) => [...prev, ...compressed]);
          } else {
            setReplyAttachments((prev) => [...prev, ...compressed]);
          }
        } finally {
          setIsCompressing(false);
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isHelpModalOpen, mode]);

  if (!isHelpModalOpen || typeof document === 'undefined') {
    return null;
  }

  const activeRequest = requests.find((r) => r.id === activeRequestId);

  const handleFilesSelected = async (files: FileList | null, isReply = false) => {
    if (!files || files.length === 0) return;
    setIsCompressing(true);
    try {
      const fileArr = Array.from(files).filter((f) => f.type.startsWith('image/'));
      const compressed = await Promise.all(fileArr.map((f) => compressImageFile(f)));
      if (isReply) {
        setReplyAttachments((prev) => [...prev, ...compressed]);
      } else {
        setPendingAttachments((prev) => [...prev, ...compressed]);
      }
    } finally {
      setIsCompressing(false);
    }
  };

  const handleDrop = async (e: React.DragEvent, isReply = false) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleFilesSelected(e.dataTransfer.files, isReply);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const created = await submitRequest({
        type: requestType,
        title: title.trim() || prompt.slice(0, 50),
        prompt: prompt.trim(),
        attachments: pendingAttachments,
        autoApply,
      });

      setTitle('');
      setPrompt('');
      setPendingAttachments([]);
      setActiveRequestId(created.id);
      setMode('thread');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApplyAndRelease = async (id: string) => {
    setIsApplying(true);
    setApplyStatusMessage('Merging fork changes into live app & compiling...');
    try {
      const res = await applyUpgrade(id);
      if (res.ok) {
        setApplyStatusMessage(`✓ Published in v${res.version}! All clients on Desktop and Android can now update.`);
      } else {
        setApplyStatusMessage(`Error: ${res.error || 'Failed to apply update'}`);
      }
    } catch (err: any) {
      setApplyStatusMessage(`Error: ${err.message || 'Failed to apply'}`);
    } finally {
      setIsApplying(false);
    }
  };

  const handleReplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!replyText.trim() && replyAttachments.length === 0) || !activeRequestId || isReplying) return;

    setIsReplying(true);
    try {
      await sendChatMessage(activeRequestId, replyText.trim(), replyAttachments);
      setReplyText('');
      setReplyAttachments([]);
    } finally {
      setIsReplying(false);
    }
  };

  const copyChip = async (key: string, value: string) => {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-accent/15 text-accent border border-accent/25 animate-pulse">
            <RotateCw size={11} className="animate-spin" />
            <span>Running</span>
          </span>
        );
      case 'released':
      case 'applied':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/25 text-emerald-300 border border-emerald-500/40">
            <Rocket size={11} />
            <span>Update Live</span>
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
            <CheckCircle2 size={11} />
            <span>Fork Ready</span>
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/25">
            <AlertCircle size={11} />
            <span>Failed</span>
          </span>
        );
      case 'queued':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/25">
            <Clock size={11} />
            <span>Queued</span>
          </span>
        );
    }
  };

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-upgrade-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-md animate-in fade-in duration-200 select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl h-[90vh] max-h-[740px] bg-surface/95 border border-customBorder/80 rounded-2xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden text-primary backdrop-blur-xl"
      >
        {/* Minimalist Top Header */}
        <div className="px-5 py-3.5 border-b border-customBorder/60 flex items-center justify-between gap-4 bg-surface shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0 shadow-sm">
              <Wand2 size={16} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id="help-upgrade-modal-title" className="text-sm sm:text-base font-bold tracking-tight truncate">
                  AI Studio & Feedback
                </h2>
                <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-[10px] font-mono text-muted bg-elevated border border-customBorder/50">
                  opencode 1.3
                </span>
              </div>
              <p className="text-[11px] text-muted truncate">
                Chat feature upgrades and bug fixes • OpenCode creates automated git forks
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Host PC Status Pill */}
            <div
              className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                hostStatus.status === 'online'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                  : hostStatus.status === 'busy'
                  ? 'bg-accent/10 text-accent border-accent/25'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/25'
              }`}
              title={
                hostStatus.status === 'online'
                  ? 'Host PC is Online: OpenCode starts immediately'
                  : hostStatus.status === 'busy'
                  ? 'Host PC is Busy building a fork'
                  : 'Host PC is Offline: Requests queue in Firebase and execute when turned on'
              }
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  hostStatus.status === 'online'
                    ? 'bg-emerald-400 animate-pulse'
                    : hostStatus.status === 'busy'
                    ? 'bg-accent animate-spin'
                    : 'bg-amber-400'
                }`}
              />
              <span>
                {hostStatus.status === 'online'
                  ? 'Host Online'
                  : hostStatus.status === 'busy'
                  ? 'Host Busy'
                  : 'Host Queuing'}
              </span>
            </div>

            {/* Close Button */}
            <button
              type="button"
              onClick={closeHelpModal}
              aria-label="Close modal"
              className="p-1.5 rounded-full text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body: Sidebar + Main Stage */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Column: History & Queue List */}
          <div className="w-64 sm:w-72 border-r border-customBorder/60 bg-base/40 flex flex-col shrink-0 min-h-0">
            <div className="p-3 border-b border-customBorder/40">
              <button
                type="button"
                onClick={() => {
                  setMode('create');
                  setActiveRequestId(null);
                }}
                className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl font-bold text-xs transition-all cursor-pointer shadow-sm ${
                  mode === 'create'
                    ? 'bg-accent text-white shadow-accent/25'
                    : 'bg-elevated hover:bg-highlight text-primary border border-customBorder/60'
                }`}
              >
                <Plus size={13} />
                <span>New Request</span>
              </button>
            </div>

            {/* Request Feed */}
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
              <div className="px-2 pt-1 pb-0.5 text-[10px] font-bold text-muted uppercase tracking-wider">
                Requests ({requests.length})
              </div>

              {requests.length === 0 ? (
                <div className="py-12 px-4 text-center text-xs text-muted leading-relaxed">
                  No requests yet.
                  <br />
                  Click above to chat your first upgrade!
                </div>
              ) : (
                requests.map((req) => {
                  const isSelected = mode === 'thread' && activeRequestId === req.id;
                  const firstThumb = req.attachments?.[0]?.previewDataUrl || req.attachments?.[0]?.dataUrl;

                  return (
                    <button
                      key={req.id}
                      type="button"
                      onClick={() => {
                        setActiveRequestId(req.id);
                        setMode('thread');
                      }}
                      className={`w-full text-left p-2.5 rounded-xl transition-all cursor-pointer border flex flex-col gap-1.5 relative overflow-hidden ${
                        isSelected
                          ? 'bg-elevated/90 border-accent/50 shadow-sm text-primary'
                          : 'bg-surface/50 hover:bg-elevated/60 border-transparent text-secondary hover:text-primary'
                      }`}
                    >
                      {/* Active indicator bar */}
                      {isSelected && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r bg-accent" />
                      )}

                      <div className="flex items-center justify-between gap-1.5">
                        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                          {req.type === 'fix' ? (
                            <span className="text-amber-400 flex items-center gap-1">
                              <Bug size={10} /> Fix
                            </span>
                          ) : (
                            <span className="text-accent flex items-center gap-1">
                              <Lightbulb size={10} /> Feature
                            </span>
                          )}
                        </span>
                        {renderStatusBadge(req.status)}
                      </div>

                      <div className="flex items-center gap-2">
                        {firstThumb && (
                          <img
                            src={firstThumb}
                            alt=""
                            className="w-7 h-7 rounded-lg object-cover border border-customBorder/60 shrink-0 bg-base"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate leading-tight">
                            {req.title || req.prompt}
                          </p>
                          <p className="text-[10px] text-muted truncate mt-0.5">
                            {formatRelativeTime(req.createdAt)} • {req.messages?.length || 1} msg
                            {req.attachments?.length ? ` • ${req.attachments.length} img` : ''}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Active View (Create Composer OR Chat Thread) */}
          <div className="flex-1 flex flex-col min-h-0 bg-surface/40">
            {mode === 'create' ? (
              /* Composer Form */
              <form onSubmit={handleCreateSubmit} className="flex-1 flex flex-col min-h-0 p-5 sm:p-7 overflow-y-auto">
                <div className="flex flex-col gap-4 max-w-xl mx-auto w-full">
                  <div>
                    <h3 className="text-base font-bold text-primary">Chat an Upgrade or Bug Fix</h3>
                    <p className="text-xs text-secondary mt-0.5">
                      OpenCode creates an isolated git fork of Dotify, executes the changes, and reports back here.
                    </p>
                  </div>

                  {/* Segmented Type Selector */}
                  <div className="grid grid-cols-2 p-1 bg-elevated/70 rounded-xl border border-customBorder/60 gap-1">
                    <button
                      type="button"
                      onClick={() => setRequestType('upgrade')}
                      className={`py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        requestType === 'upgrade'
                          ? 'bg-surface text-accent shadow-sm'
                          : 'text-secondary hover:text-primary'
                      }`}
                    >
                      <Lightbulb size={13} />
                      <span>Feature Upgrade</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setRequestType('fix')}
                      className={`py-1.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        requestType === 'fix'
                          ? 'bg-surface text-amber-400 shadow-sm'
                          : 'text-secondary hover:text-primary'
                      }`}
                    >
                      <Bug size={13} />
                      <span>Bug Fix / Help</span>
                    </button>
                  </div>

                  {/* Title / Summary */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-secondary">
                      Title (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder={requestType === 'upgrade' ? 'e.g. Add synchronized lyrics or gesture controls' : 'e.g. Fix audio stream stutter on pause'}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full bg-elevated/70 border border-customBorder/70 rounded-xl px-3 py-2 text-xs md:text-sm text-primary placeholder-muted outline-none focus:border-accent"
                    />
                  </div>

                  {/* Prompt Textarea */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-secondary">
                      Instructions & Behavior *
                    </label>
                    <textarea
                      required
                      rows={5}
                      placeholder="Describe the feature or fix in detail. Mention any desired buttons, styling, layout, or components. OpenCode will inspect your instructions and build it in a git fork..."
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      className="w-full bg-elevated/70 border border-customBorder/70 rounded-xl p-3 text-xs md:text-sm text-primary placeholder-muted outline-none focus:border-accent resize-none select-text leading-relaxed"
                    />
                  </div>

                  {/* Minimalist Screenshot Dropzone */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs font-bold text-secondary">
                      <span className="flex items-center gap-1.5">
                        <ImageIcon size={14} className="text-accent" />
                        <span>Attached Screenshots ({pendingAttachments.length})</span>
                      </span>
                      <span className="text-[10px] text-muted font-normal">
                        Press Ctrl+V anywhere to paste
                      </span>
                    </div>

                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleDrop(e, false)}
                      onClick={() => fileInputRef.current?.click()}
                      className="border border-dashed border-customBorder hover:border-accent/60 rounded-xl p-3.5 flex flex-col items-center justify-center gap-1.5 cursor-pointer bg-elevated/30 hover:bg-elevated/60 transition-all text-center"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => handleFilesSelected(e.target.files, false)}
                      />
                      <UploadCloud size={20} className="text-secondary" />
                      <p className="text-xs font-medium text-secondary">
                        Drop screenshot or click to browse
                      </p>
                    </div>

                    {isCompressing && (
                      <p className="text-xs text-accent animate-pulse font-medium">
                        Optimizing screenshot...
                      </p>
                    )}

                    {/* Previews */}
                    {pendingAttachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {pendingAttachments.map((att, idx) => (
                          <div
                            key={att.id}
                            className="relative group rounded-xl overflow-hidden border border-customBorder bg-base w-16 h-16 shrink-0 shadow-sm"
                          >
                            <img
                              src={att.previewDataUrl || att.dataUrl}
                              alt={att.name}
                              className="w-full h-full object-cover"
                            />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingAttachments((prev) => prev.filter((_, i) => i !== idx));
                              }}
                              className="absolute top-1 right-1 p-0.5 rounded-full bg-black/75 hover:bg-rose-500 text-white transition-colors cursor-pointer"
                              title="Remove screenshot"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Auto-publish checkbox */}
                  <label className="flex items-center gap-2 text-xs text-secondary cursor-pointer select-none hover:text-primary pt-0.5">
                    <input
                      type="checkbox"
                      checked={autoApply}
                      onChange={(e) => setAutoApply(e.target.checked)}
                      className="rounded accent-accent w-3.5 h-3.5 cursor-pointer"
                    />
                    <span>Automatically merge fork & publish update when OpenCode finishes</span>
                  </label>

                  {/* Submit CTA */}
                  <button
                    type="submit"
                    disabled={!prompt.trim() || isSubmitting || isCompressing}
                    className="w-full py-2.5 px-4 rounded-xl bg-accent hover:brightness-110 disabled:bg-elevated disabled:text-muted text-white font-bold text-xs md:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md shadow-accent/20 disabled:cursor-not-allowed mt-1"
                  >
                    {isSubmitting ? (
                      <>
                        <RotateCw size={15} className="animate-spin" />
                        <span>Submitting Request...</span>
                      </>
                    ) : (
                      <>
                        <Send size={15} />
                        <span>Submit Request to OpenCode →</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : activeRequest ? (
              /* Thread Inspector View */
              <div className="flex-1 flex flex-col min-h-0">
                {/* Clean Thread Header Toolbar */}
                <div className="px-5 py-3 border-b border-customBorder/60 bg-surface flex flex-col gap-2 shrink-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                          {activeRequest.type === 'fix' ? '🛠️ Bug Fix' : '✨ Feature Upgrade'}
                        </span>
                        {renderStatusBadge(activeRequest.status)}
                      </div>
                      <h3 className="text-sm sm:text-base font-bold text-primary mt-0.5 truncate">
                        {activeRequest.title}
                      </h3>
                    </div>

                    {/* Retry / Re-run button */}
                    {(activeRequest.status === 'completed' || activeRequest.status === 'failed') && (
                      <button
                        type="button"
                        onClick={() => retryRequest(activeRequest.id)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-elevated hover:bg-highlight text-xs font-semibold text-secondary hover:text-primary transition-colors cursor-pointer border border-customBorder/60"
                        title="Re-run OpenCode on this request"
                      >
                        <RotateCw size={12} />
                        <span>Re-run</span>
                      </button>
                    )}
                  </div>

                  {/* Metadata Chips: Branch, Local Directory, Inbox */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs pt-0.5">
                    {activeRequest.forkBranch && (
                      <button
                        type="button"
                        onClick={() => copyChip('branch', activeRequest.forkBranch || '')}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-elevated hover:bg-highlight border border-customBorder/60 text-secondary hover:text-primary font-mono text-[11px] transition-colors cursor-pointer"
                        title="Click to copy git branch"
                      >
                        <GitFork size={12} className="text-accent" />
                        <span className="truncate max-w-xs">{activeRequest.forkBranch}</span>
                        {copiedKey === 'branch' ? (
                          <Check size={11} className="text-emerald-400" />
                        ) : (
                          <Copy size={11} className="text-muted" />
                        )}
                      </button>
                    )}

                    {activeRequest.forkPath && (
                      <button
                        type="button"
                        onClick={() => copyChip('path', activeRequest.forkPath || '')}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-elevated hover:bg-highlight border border-customBorder/60 text-secondary hover:text-primary text-[11px] transition-colors cursor-pointer truncate max-w-xs"
                        title={activeRequest.forkPath}
                      >
                        <FolderOpen size={12} className="text-accent" />
                        <span className="truncate">{activeRequest.forkPath}</span>
                        {copiedKey === 'path' ? (
                          <Check size={11} className="text-emerald-400" />
                        ) : (
                          <Copy size={11} className="text-muted" />
                        )}
                      </button>
                    )}

                    {activeRequest.savedImages?.length ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-elevated border border-customBorder/60 text-secondary text-[11px]">
                        <ImageIcon size={12} className="text-accent" />
                        <span>{activeRequest.savedImages.length} images saved</span>
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Apply & Release Update Action Banner */}
                {activeRequest.status === 'completed' && (
                  <div className="px-5 py-3 bg-gradient-to-r from-accent/20 via-purple-500/10 to-transparent border-b border-accent/30 flex items-center justify-between gap-3 shrink-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-accent">
                        <Rocket size={13} />
                        <span>Fork Changes Ready</span>
                      </div>
                      <p className="text-[11px] text-secondary mt-0.5 truncate">
                        Merge {activeRequest.forkBranch} into live app & publish auto-update for all clients.
                      </p>
                      {applyStatusMessage && (
                        <p className="text-[11px] font-semibold text-accent mt-1 animate-pulse">
                          {applyStatusMessage}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleApplyAndRelease(activeRequest.id)}
                      disabled={isApplying}
                      className="shrink-0 px-3.5 py-1.5 rounded-xl bg-accent hover:brightness-110 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-accent/25 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isApplying ? (
                        <>
                          <RotateCw size={12} className="animate-spin" />
                          <span>Applying...</span>
                        </>
                      ) : (
                        <>
                          <Rocket size={12} />
                          <span>Apply & Release Update</span>
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* If already released */}
                {activeRequest.releasedVersion && (
                  <div className="px-5 py-2.5 bg-emerald-500/15 border-b border-emerald-500/30 flex items-center gap-2 text-xs font-medium text-emerald-400 shrink-0">
                    <CheckCircle2 size={14} className="shrink-0" />
                    <span>
                      Published in <strong>v{activeRequest.releasedVersion}</strong>! All clients on Windows & Android will receive this on launch.
                    </span>
                  </div>
                )}

                {/* Messages & Logs Scroll Area */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-5 flex flex-col gap-4">
                  {/* Messages Feed */}
                  {activeRequest.messages?.map((msg) => {
                    const isUser = msg.role === 'user';
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}
                      >
                        <div className="flex items-center gap-1.5 text-[10px] text-muted px-1">
                          <span className="font-semibold text-secondary">
                            {msg.authorName || (isUser ? 'You' : 'OpenCode')}
                          </span>
                          <span>•</span>
                          <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>

                        {/* Message Card: Elegant dark card instead of garish solid neon red */}
                        <div
                          className={`max-w-[88%] rounded-2xl p-4 select-text leading-relaxed shadow-sm ${
                            isUser
                              ? 'bg-elevated/95 border border-customBorder/80 text-primary rounded-tr-sm'
                              : 'bg-surface/90 border border-customBorder/70 text-primary rounded-tl-sm'
                          }`}
                        >
                          {/* Markdown formatted content */}
                          <FormattedMarkdown text={msg.text} />

                          {/* Render Attached Images inside message */}
                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2 pt-2 border-t border-customBorder/50">
                              {msg.attachments.map((att) => {
                                const imgSrc = att.dataUrl || att.previewDataUrl;
                                if (!imgSrc) return null;
                                return (
                                  <div
                                    key={att.id}
                                    onClick={() => setPreviewImage(imgSrc)}
                                    className="cursor-pointer group relative rounded-xl overflow-hidden border border-customBorder/60 bg-base w-24 h-24 shrink-0 hover:scale-105 transition-transform shadow-sm"
                                    title="Click to view full size"
                                  >
                                    <img src={imgSrc} alt={att.name} className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                      <ExternalLink size={15} className="text-white" />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Live OpenCode CLI Terminal Logs */}
                  {activeRequest.agentLogs && (
                    <div className="rounded-xl border border-customBorder/80 overflow-hidden bg-black/85 shadow-md">
                      <div
                        onClick={() => setShowLogs((prev) => !prev)}
                        className="px-3.5 py-2 bg-elevated/60 border-b border-customBorder/50 flex items-center justify-between cursor-pointer text-xs font-semibold text-secondary hover:text-primary transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <Terminal size={13} className="text-accent" />
                          <span>OpenCode Execution Logs</span>
                          {activeRequest.status === 'processing' && (
                            <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-muted">
                          <span>{showLogs ? 'Hide' : 'Show'}</span>
                          {showLogs ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </div>
                      </div>

                      {showLogs && (
                        <pre className="p-3 text-[11px] font-mono text-emerald-400/90 whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed select-text">
                          {activeRequest.agentLogs}
                        </pre>
                      )}
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Follow-up Chat Composer Bar */}
                <form
                  onSubmit={handleReplySubmit}
                  className="p-3 border-t border-customBorder/60 bg-surface flex flex-col gap-2 shrink-0"
                >
                  {/* Reply Image Previews */}
                  {replyAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 pb-1">
                      {replyAttachments.map((att, idx) => (
                        <div
                          key={att.id}
                          className="relative rounded-lg overflow-hidden border border-customBorder w-12 h-12 shrink-0 bg-base"
                        >
                          <img src={att.previewDataUrl || att.dataUrl} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setReplyAttachments((prev) => prev.filter((_, i) => i !== idx))}
                            className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/80 hover:bg-rose-500 text-white"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      ref={replyFileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => handleFilesSelected(e.target.files, true)}
                    />

                    <button
                      type="button"
                      onClick={() => replyFileInputRef.current?.click()}
                      className="p-2 rounded-xl bg-elevated hover:bg-highlight text-secondary hover:text-primary transition-colors cursor-pointer shrink-0"
                      title="Attach screenshot (or press Ctrl+V to paste)"
                    >
                      <Paperclip size={15} />
                    </button>

                    <input
                      type="text"
                      placeholder="Follow up with OpenCode to refine or add to this fork..."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      className="flex-1 bg-elevated/70 border border-customBorder/70 rounded-xl px-3.5 py-2 text-xs md:text-sm text-primary placeholder-muted outline-none focus:border-accent"
                    />

                    <button
                      type="submit"
                      disabled={(!replyText.trim() && replyAttachments.length === 0) || isReplying || isCompressing}
                      className="p-2 rounded-xl bg-accent hover:brightness-110 disabled:bg-elevated disabled:text-muted text-white transition-all cursor-pointer shrink-0 shadow-sm shadow-accent/20"
                      title="Send message"
                    >
                      <Send size={15} />
                    </button>
                  </div>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Full-Screen Image Lightbox Modal */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 z-60 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-10 right-0 p-1.5 rounded-full bg-surface text-secondary hover:text-primary transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>
            <img
              src={previewImage}
              alt="Full preview"
              className="max-w-full max-h-[85vh] rounded-2xl object-contain shadow-2xl border border-customBorder"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="mt-3 flex items-center gap-3">
              <a
                href={previewImage}
                download="dotify-attachment.png"
                className="px-3 py-1.5 rounded-xl bg-elevated hover:bg-highlight text-xs font-semibold text-primary transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                Download Image
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
};
