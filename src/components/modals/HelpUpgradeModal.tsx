import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useUpgradeStore } from '../../store/upgradeStore';
import { UpgradeType, UpgradeAttachment } from '../../types/upgrade';
import { compressImageFile } from '../../services/upgradeService';
import {
  Sparkles,
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
} from 'lucide-react';

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
  } = useUpgradeStore();

  const [mode, setMode] = useState<'create' | 'thread'>('create');
  const [requestType, setRequestType] = useState<UpgradeType>('upgrade');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<UpgradeAttachment[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);

  // Follow-up reply state
  const [replyText, setReplyText] = useState('');
  const [replyAttachments, setReplyAttachments] = useState<UpgradeAttachment[]>([]);
  const [isReplying, setIsReplying] = useState(false);

  // Live log viewer collapse
  const [showLogs, setShowLogs] = useState(true);

  // Full-size image preview modal
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // When activeRequestId changes or modal opens, decide which view to show
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

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-accent/20 text-accent border border-accent/30 animate-pulse">
            <RotateCw size={12} className="animate-spin" />
            Running OpenCode
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 size={12} />
            Fork Ready
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30">
            <AlertCircle size={12} />
            Failed
          </span>
        );
      case 'queued':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
            <Clock size={12} />
            Queued in Cloud
          </span>
        );
    }
  };

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-upgrade-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl h-[92vh] max-h-[760px] bg-surface border border-customBorder rounded-2xl shadow-2xl flex flex-col overflow-hidden text-primary"
      >
        {/* Top Header */}
        <div className="px-4 py-3.5 border-b border-customBorder/70 flex items-center justify-between gap-3 bg-surface/95 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center text-accent shrink-0 shadow-sm">
              <Sparkles size={17} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id="help-upgrade-modal-title" className="text-sm sm:text-base font-bold tracking-tight truncate">
                  Help & AI Upgrade Studio
                </h2>
                <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-elevated border border-customBorder text-secondary">
                  OpenCode • Muse Spark 1.3 xhigh
                </span>
              </div>
              <p className="text-[11px] text-secondary truncate">
                Chat a feature upgrade or fix with screenshots • Auto-forks repo & implements changes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Host PC Status Pill */}
            <div
              className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                hostStatus.status === 'online'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : hostStatus.status === 'busy'
                  ? 'bg-accent/10 text-accent border-accent/30'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}
              title={
                hostStatus.status === 'online'
                  ? 'Host PC is ON and ready to run OpenCode immediately'
                  : hostStatus.status === 'busy'
                  ? 'Host PC is currently building a fork'
                  : 'Host PC is OFF: Requests queue in Firebase and run as soon as your PC turns on'
              }
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  hostStatus.status === 'online'
                    ? 'bg-emerald-400 animate-pulse'
                    : hostStatus.status === 'busy'
                    ? 'bg-accent animate-spin'
                    : 'bg-amber-400'
                }`}
              />
              <span className="text-[11px]">
                {hostStatus.status === 'online'
                  ? 'Host PC Online'
                  : hostStatus.status === 'busy'
                  ? 'Host PC Busy'
                  : 'Host PC Offline (Queuing)'}
              </span>
            </div>

            {/* Close Button */}
            <button
              type="button"
              onClick={closeHelpModal}
              aria-label="Close modal"
              className="p-1.5 rounded-full text-secondary hover:text-primary hover:bg-elevated transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body: Sidebar + Stage */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Column: Request List & New Request Button */}
          <div className="w-64 sm:w-72 border-r border-customBorder/60 bg-base/50 flex flex-col shrink-0 min-h-0">
            <div className="p-3 border-b border-customBorder/40">
              <button
                type="button"
                onClick={() => {
                  setMode('create');
                  setActiveRequestId(null);
                }}
                className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl font-bold text-xs transition-all cursor-pointer shadow-sm ${
                  mode === 'create'
                    ? 'bg-accent text-white shadow-accent/30'
                    : 'bg-elevated hover:bg-highlight text-primary border border-customBorder/60'
                }`}
              >
                <Sparkles size={14} />
                <span>New Upgrade or Fix</span>
              </button>
            </div>

            {/* Request Feed */}
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
              <div className="px-2 pt-1 text-[11px] font-bold text-muted uppercase tracking-wider">
                History & Queue ({requests.length})
              </div>

              {requests.length === 0 ? (
                <div className="py-8 px-4 text-center text-xs text-muted">
                  No requests submitted yet. Click above to chat your first upgrade!
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
                      className={`w-full text-left p-2.5 rounded-xl transition-all cursor-pointer border flex flex-col gap-1.5 ${
                        isSelected
                          ? 'bg-elevated border-accent/60 shadow-sm text-primary'
                          : 'bg-surface/60 hover:bg-elevated/70 border-transparent text-secondary hover:text-primary'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                          {req.type === 'fix' ? (
                            <span className="text-amber-400 flex items-center gap-1">
                              <Bug size={11} /> Fix
                            </span>
                          ) : (
                            <span className="text-accent flex items-center gap-1">
                              <Sparkles size={11} /> Feature
                            </span>
                          )}
                        </span>
                        {renderStatusBadge(req.status)}
                      </div>

                      <div className="flex items-start gap-2">
                        {firstThumb && (
                          <img
                            src={firstThumb}
                            alt=""
                            className="w-8 h-8 rounded-lg object-cover border border-customBorder shrink-0 bg-black/40"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate leading-tight">
                            {req.title || req.prompt}
                          </p>
                          <p className="text-[10px] text-muted truncate mt-0.5">
                            {new Date(req.createdAt).toLocaleDateString()} • {req.messages?.length || 1} msg
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

          {/* Right Column: Active View (Create Composer OR Chat Thread Inspector) */}
          <div className="flex-1 flex flex-col min-h-0 bg-surface/30">
            {mode === 'create' ? (
              /* Composer Form */
              <form onSubmit={handleCreateSubmit} className="flex-1 flex flex-col min-h-0 p-4 sm:p-6 overflow-y-auto">
                <div className="flex flex-col gap-4 max-w-2xl mx-auto w-full">
                  <div>
                    <h3 className="text-base font-bold text-primary">Chat a Feature Upgrade or Bug Fix</h3>
                    <p className="text-xs text-secondary mt-0.5">
                      OpenCode will inspect your instructions & images, create a dedicated git fork of Dotify, and build the upgrade.
                    </p>
                  </div>

                  {/* Type Selector: Feature vs Fix */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRequestType('upgrade')}
                      className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        requestType === 'upgrade'
                          ? 'bg-accent/15 border-accent text-accent'
                          : 'bg-elevated border-customBorder text-secondary hover:text-primary'
                      }`}
                    >
                      <Sparkles size={14} />
                      <span>✨ Feature Upgrade</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setRequestType('fix')}
                      className={`flex-1 py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        requestType === 'fix'
                          ? 'bg-amber-500/15 border-amber-500 text-amber-400'
                          : 'bg-elevated border-customBorder text-secondary hover:text-primary'
                      }`}
                    >
                      <Bug size={14} />
                      <span>🛠️ Bug Fix / Help</span>
                    </button>
                  </div>

                  {/* Title / Slug */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-secondary">
                      Title / Summary (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder={requestType === 'upgrade' ? 'e.g. Add synchronized lyrics sync' : 'e.g. Fix audio stream stutter on pause'}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full bg-elevated border border-customBorder rounded-xl px-3 py-2 text-xs md:text-sm text-primary placeholder-muted outline-none focus:border-accent"
                    />
                  </div>

                  {/* Multi-line Prompt */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-secondary">
                      Description & Instructions *
                    </label>
                    <textarea
                      required
                      rows={5}
                      placeholder="Describe what you want to build or fix in detail. Mention any desired UI layout, components, buttons, or behaviors. OpenCode will implement it in a git fork..."
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      className="w-full bg-elevated border border-customBorder rounded-xl p-3 text-xs md:text-sm text-primary placeholder-muted outline-none focus:border-accent resize-none select-text"
                    />
                  </div>

                  {/* Attached Images & Drag/Drop Area */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-secondary flex items-center gap-1.5">
                        <ImageIcon size={14} className="text-accent" />
                        <span>Attached Images & Screenshots ({pendingAttachments.length})</span>
                      </label>
                      <span className="text-[10px] text-muted">
                        Paste with Ctrl+V or drag & drop
                      </span>
                    </div>

                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleDrop(e, false)}
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-customBorder/80 hover:border-accent/60 rounded-xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer bg-elevated/30 hover:bg-elevated/60 transition-all text-center"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => handleFilesSelected(e.target.files, false)}
                      />
                      <UploadCloud size={24} className="text-secondary" />
                      <p className="text-xs font-medium text-secondary">
                        Click to browse or drop screenshots/photos here
                      </p>
                      <p className="text-[10px] text-muted">
                        Images are saved to your PC inbox (<code className="text-accent">inbox/</code>) and forwarded to OpenCode
                      </p>
                    </div>

                    {isCompressing && (
                      <p className="text-xs text-accent animate-pulse font-medium">
                        Optimizing attached images...
                      </p>
                    )}

                    {/* Previews */}
                    {pendingAttachments.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {pendingAttachments.map((att, idx) => (
                          <div
                            key={att.id}
                            className="relative group rounded-lg overflow-hidden border border-customBorder bg-base w-20 h-20 shrink-0"
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
                              className="absolute top-1 right-1 p-1 rounded-full bg-black/70 hover:bg-rose-500 text-white transition-colors cursor-pointer"
                              title="Remove image"
                            >
                              <X size={11} />
                            </button>
                            <span className="absolute bottom-0 inset-x-0 bg-black/80 text-[9px] text-muted truncate px-1 py-0.5 text-center">
                              {(att.sizeBytes ? (att.sizeBytes / 1024).toFixed(0) : '?') + ' KB'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Offline / Online Queue Notice */}
                  <div className="p-3 rounded-xl bg-elevated/60 border border-customBorder/60 flex items-start gap-2.5 text-xs text-secondary">
                    <Clock size={16} className="text-accent shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-primary">
                        Always-On Cloud Queueing
                      </p>
                      <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
                        If your computer is on, OpenCode starts immediately. If your computer is off or asleep, your request and images will queue in Firebase and auto-run the instant your PC turns on.
                      </p>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={!prompt.trim() || isSubmitting || isCompressing}
                    className="w-full py-3 px-4 rounded-xl bg-accent hover:bg-accentHover disabled:bg-elevated disabled:text-muted text-white font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-accent/20 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <>
                        <RotateCw size={16} className="animate-spin" />
                        <span>Submitting to Firebase Queue...</span>
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        <span>Queue Upgrade with OpenCode (muse-spark-1.3 xhigh)</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : activeRequest ? (
              /* Thread Inspector View */
              <div className="flex-1 flex flex-col min-h-0">
                {/* Thread Header Banner */}
                <div className="p-3.5 border-b border-customBorder/60 bg-surface flex flex-col gap-2 shrink-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted">
                          {activeRequest.type === 'fix' ? '🛠️ Bug Fix' : '✨ Feature Upgrade'}
                        </span>
                        {renderStatusBadge(activeRequest.status)}
                      </div>
                      <h3 className="text-base font-bold text-primary mt-0.5">
                        {activeRequest.title}
                      </h3>
                    </div>

                    {/* Retry / Re-run button */}
                    {(activeRequest.status === 'completed' || activeRequest.status === 'failed') && (
                      <button
                        type="button"
                        onClick={() => retryRequest(activeRequest.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-elevated hover:bg-highlight text-xs font-semibold text-secondary hover:text-primary transition-colors cursor-pointer border border-customBorder"
                        title="Re-run OpenCode on this request"
                      >
                        <RotateCw size={13} />
                        <span>Re-run OpenCode</span>
                      </button>
                    )}
                  </div>

                  {/* Metadata Chips: Git Fork, Branch, Local Inbox */}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {activeRequest.forkBranch && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-elevated border border-customBorder text-secondary font-mono text-[11px]">
                        <GitFork size={13} className="text-accent" />
                        <span>{activeRequest.forkBranch}</span>
                      </span>
                    )}

                    {activeRequest.forkPath && (
                      <span
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-elevated border border-customBorder text-secondary text-[11px] truncate max-w-xs"
                        title={activeRequest.forkPath}
                      >
                        <FolderOpen size={13} className="text-accent" />
                        <span className="truncate">{activeRequest.forkPath}</span>
                      </span>
                    )}

                    {activeRequest.savedImages?.length ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-elevated border border-customBorder text-secondary text-[11px]">
                        <ImageIcon size={13} className="text-accent" />
                        <span>{activeRequest.savedImages.length} images saved to inbox</span>
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Messages & Logs Scroll Area */}
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
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

                        <div
                          className={`max-w-[85%] rounded-2xl p-3.5 text-xs sm:text-sm select-text leading-relaxed whitespace-pre-wrap ${
                            isUser
                              ? 'bg-accent text-white rounded-tr-sm'
                              : 'bg-elevated border border-customBorder/70 text-primary rounded-tl-sm'
                          }`}
                        >
                          {msg.text}

                          {/* Render Attached Images inside message */}
                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2 pt-2 border-t border-white/20">
                              {msg.attachments.map((att) => {
                                const imgSrc = att.dataUrl || att.previewDataUrl;
                                if (!imgSrc) return null;
                                return (
                                  <div
                                    key={att.id}
                                    onClick={() => setPreviewImage(imgSrc)}
                                    className="cursor-pointer group relative rounded-lg overflow-hidden border border-white/20 bg-black/40 w-24 h-24 shrink-0 hover:scale-105 transition-transform"
                                    title="Click to view full size"
                                  >
                                    <img src={imgSrc} alt={att.name} className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                      <ExternalLink size={16} className="text-white" />
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
                    <div className="rounded-xl border border-customBorder overflow-hidden bg-black/80 shadow-md">
                      <div
                        onClick={() => setShowLogs((prev) => !prev)}
                        className="px-3 py-2 bg-elevated/60 border-b border-customBorder/50 flex items-center justify-between cursor-pointer text-xs font-semibold text-secondary hover:text-primary"
                      >
                        <div className="flex items-center gap-2">
                          <Terminal size={14} className="text-accent" />
                          <span>OpenCode CLI Execution Logs</span>
                          {activeRequest.status === 'processing' && (
                            <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
                          )}
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-muted">
                          <span>{showLogs ? 'Collapse' : 'Expand'}</span>
                          {showLogs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
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
                  className="p-3 border-t border-customBorder/60 bg-surface/90 flex flex-col gap-2 shrink-0"
                >
                  {/* Reply Image Previews */}
                  {replyAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 pb-1">
                      {replyAttachments.map((att, idx) => (
                        <div
                          key={att.id}
                          className="relative rounded-lg overflow-hidden border border-customBorder w-14 h-14 shrink-0 bg-black/40"
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
                      className="p-2 rounded-full bg-elevated hover:bg-highlight text-secondary hover:text-primary transition-colors cursor-pointer shrink-0"
                      title="Attach image (or paste with Ctrl+V)"
                    >
                      <Paperclip size={16} />
                    </button>

                    <input
                      type="text"
                      placeholder="Follow up with OpenCode to refine or add to this fork..."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      className="flex-1 bg-elevated border border-customBorder rounded-full px-4 py-2 text-xs md:text-sm text-primary placeholder-muted outline-none focus:border-accent"
                    />

                    <button
                      type="submit"
                      disabled={(!replyText.trim() && replyAttachments.length === 0) || isReplying || isCompressing}
                      className="p-2 rounded-full bg-accent hover:bg-accentHover disabled:bg-elevated disabled:text-muted text-white transition-all cursor-pointer shrink-0"
                      title="Send message"
                    >
                      <Send size={16} />
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
          className="fixed inset-0 z-60 bg-black/90 flex items-center justify-center p-4 animate-in fade-in"
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
              className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl border border-customBorder"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="mt-3 flex items-center gap-3">
              <a
                href={previewImage}
                download="dotify-attachment.png"
                className="px-3 py-1.5 rounded-lg bg-elevated hover:bg-highlight text-xs font-semibold text-primary transition-colors"
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
