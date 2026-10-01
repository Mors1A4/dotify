import React, { useEffect, useState } from 'react';
import { useMp3VaultStore, SavedMp3Track, PeerMp3Track } from '../../services/mp3VaultService';
import { usePlayerStore } from '../../store/playerStore';
import { DownloadFolderModal } from '../common/DownloadFolderModal';
import {
  Download,
  Trash2,
  Wifi,
  HardDrive,
  FolderOpen,
  RefreshCw,
  Play,
  Heart,
  CheckCircle2,
  Smartphone,
  Monitor,
  Plus,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import {
  getTrackArtwork,
  resolveTrackArtwork,
  DEFAULT_MUSIC_ARTWORK,
  isUglyPlaceholder,
} from '../../services/artworkService';
import { isTauriEnvironment, isAndroidApp } from '../../services/apiConfig';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return `${Math.round(bytes / 1024)} KB`;
  return `${mb.toFixed(1)} MB`;
}

function formatDuration(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const Mp3VaultPanel: React.FC = () => {
  const {
    savedTracks,
    peerTracks,
    peers,
    localDevice,
    savingTrackIds,
    autoSaveCompleted,
    autoWifiSync,
    isScanningWifi,
    isSyncingPeers,
    statusMessage,
    toggleAutoSaveCompleted,
    toggleAutoWifiSync,
    refreshVault,
    scanWifiPeers,
    addPeerByIp,
    saveTrackAsMp3,
    deleteSavedMp3,
    cleanupSavedMp3s,
    syncWithWifiPeers,
    exportMp3File,
    openMp3Folder,
  } = useMp3VaultStore();

  const {
    playTrack,
    currentTrack,
    likedTracks,
    toggleLike,
    isLiked,
    navigateToArtist,
  } = usePlayerStore();

  const [manualIpInput, setManualIpInput] = useState('');
  const [isAddingIp, setIsAddingIp] = useState(false);
  const [deletePropagateWifi, setDeletePropagateWifi] = useState(false);
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);

  useEffect(() => {
    refreshVault();
  }, []);

  const totalLocalBytes = savedTracks.reduce((sum, t) => sum + (t.sizeBytes || 0), 0);
  const likedIds = likedTracks.map((t) => t.id);
  const unlikedSavedCount = savedTracks.filter((t) => !isLiked(t.id)).length;

  // Tracks that exist on a WiFi peer but are not currently saved on this device
  const localIdSet = new Set(savedTracks.map((t) => t.id));
  const remoteOnlyPeerTracks: PeerMp3Track[] = [];
  const seenRemoteIds = new Set<string>();
  for (const pt of peerTracks) {
    if (!localIdSet.has(pt.id) && !seenRemoteIds.has(pt.id)) {
      seenRemoteIds.add(pt.id);
      remoteOnlyPeerTracks.push(pt);
    }
  }

  const handleAddPeerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualIpInput.trim()) return;
    setIsAddingIp(true);
    const res = await addPeerByIp(manualIpInput.trim());
    setIsAddingIp(false);
    if (res.ok) {
      setManualIpInput('');
    }
  };

  const handlePlaySavedTrack = (track: SavedMp3Track) => {
    playTrack(track, savedTracks);
  };

  return (
    <div data-testid="mp3-vault-view" className="flex flex-col gap-6">
      {/* Status Toast Banner */}
      {statusMessage && (
        <div className="px-4 py-2.5 rounded-xl bg-accent/20 border border-accent/40 text-accent text-xs font-bold flex items-center justify-between shadow-sm">
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Top Mode Controls: Auto-Save Complete Plays vs Click-to-Download & WiFi Auto-Sync */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Card 1: Auto-Save Complete Plays vs Click-to-Download */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-950/50 via-surface to-elevated border border-emerald-700/30 flex items-start justify-between gap-4 shadow-lg">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 flex-shrink-0 mt-0.5">
              <Download size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-primary">
                  Auto-Save Completed Tracks as MP3
                </h3>
                <span
                  className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase ${
                    autoSaveCompleted
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-elevated text-muted'
                  }`}
                >
                  {autoSaveCompleted ? 'Auto-Save ON' : 'Click-to-Download Only'}
                </span>
              </div>
              <p className="text-xs text-secondary mt-1 leading-relaxed">
                {autoSaveCompleted
                  ? 'Every song you play 100% to the end is automatically saved as an .mp3 file. You can also click the Download icon on any song anytime.'
                  : 'Tracks will only be saved as .mp3 when you click the Download icon on a song or in the player bar.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="toggle-auto-save-mp3-btn"
            onClick={toggleAutoSaveCompleted}
            className={`px-4 py-2 rounded-full text-xs font-extrabold transition-all flex-shrink-0 cursor-pointer ${
              autoSaveCompleted
                ? 'bg-emerald-500 text-black hover:bg-emerald-400 shadow-md'
                : 'bg-elevated text-secondary hover:text-primary border border-customBorder'
            }`}
          >
            {autoSaveCompleted ? 'Enabled' : 'Disabled'}
          </button>
        </div>

        {/* Card 2: WiFi Network Multi-Device Sync */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-sky-950/50 via-surface to-elevated border border-sky-700/30 flex items-start justify-between gap-4 shadow-lg">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-sky-500/20 text-sky-400 flex-shrink-0 mt-0.5">
              <Wifi size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-primary">
                  WiFi Network MP3 Sync
                </h3>
                <span
                  className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase ${
                    autoWifiSync
                      ? 'bg-sky-500/20 text-sky-400'
                      : 'bg-elevated text-muted'
                  }`}
                >
                  {autoWifiSync ? 'Auto-Sync ON' : 'Manual Pull Only'}
                </span>
              </div>
              <p className="text-xs text-secondary mt-1 leading-relaxed">
                {autoWifiSync
                  ? 'Automatically syncs saved MP3s across your phone and computers on the same WiFi network. Deleted tracks stay deleted and will not re-download.'
                  : 'Auto-sync is paused. You can browse MP3s on your other WiFi devices below and click to pull only the tracks you want.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="toggle-wifi-sync-mp3-btn"
            onClick={toggleAutoWifiSync}
            className={`px-4 py-2 rounded-full text-xs font-extrabold transition-all flex-shrink-0 cursor-pointer ${
              autoWifiSync
                ? 'bg-sky-400 text-black hover:bg-sky-300 shadow-md'
                : 'bg-elevated text-secondary hover:text-primary border border-customBorder'
            }`}
          >
            {autoWifiSync ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </div>

      {/* WiFi Devices & Local Storage Overview */}
      <div className="p-5 rounded-2xl bg-elevated/40 border border-customBorder flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <HardDrive size={18} className="text-accent" />
            <div>
              <h3 className="text-sm font-bold text-primary">
                Devices on Same WiFi ({peers.length + 1} Connected)
              </h3>
              <p className="text-xs text-secondary">
                This Device:{' '}
                <span className="font-mono text-primary font-semibold">
                  {localDevice?.ip || '127.0.0.1'}:{localDevice?.port || 3001}
                </span>
                {localDevice?.mp3Dir ? ` • Folder: ${localDevice.mp3Dir}` : ''}
                {localDevice?.mp3Dir && (
                  <button
                    type="button"
                    onClick={() => setIsDownloadModalOpen(true)}
                    data-testid="vault-change-download-folder-btn"
                    className="ml-2 underline hover:text-primary transition-colors cursor-pointer"
                    title="Change the download folder for this device (also available in the profile menu)"
                  >
                    Change
                  </button>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isTauriEnvironment() && !isAndroidApp() && (
              <button
                type="button"
                onClick={() => openMp3Folder()}
                data-testid="open-mp3-folder-btn"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-elevated hover:bg-highlight text-xs font-bold text-primary border border-customBorder transition-colors cursor-pointer"
                title="Open the folder on your computer where MP3 files are saved"
              >
                <FolderOpen size={14} className="text-accent" />
                <span>Open MP3 Folder</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => scanWifiPeers()}
              disabled={isScanningWifi}
              data-testid="scan-wifi-peers-btn"
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-elevated hover:bg-highlight text-xs font-bold text-primary border border-customBorder transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={14} className={isScanningWifi ? 'animate-spin text-accent' : 'text-accent'} />
              <span>{isScanningWifi ? 'Scanning WiFi...' : 'Scan WiFi Devices'}</span>
            </button>

            {peers.length > 0 && (
              <button
                type="button"
                onClick={() => syncWithWifiPeers()}
                disabled={isSyncingPeers}
                data-testid="sync-now-wifi-btn"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent text-accent-content text-xs font-extrabold shadow-md hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
              >
                <Wifi size={14} className={isSyncingPeers ? 'animate-pulse' : ''} />
                <span>{isSyncingPeers ? 'Syncing MP3s...' : 'Sync All Now'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Connected Device Pills + Manual IP Connect */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* This Device Card */}
          <div className="p-3.5 rounded-xl bg-surface/80 border border-accent/40 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-accent/20 text-accent">
                {isAndroidApp() ? <Smartphone size={18} /> : <Monitor size={18} />}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-primary truncate">
                  {localDevice?.deviceName || 'This Device'} (You)
                </p>
                <p className="text-[11px] text-secondary font-mono truncate">
                  {localDevice?.ip || 'Local'} • {savedTracks.length} MP3s ({formatBytes(totalLocalBytes)})
                </p>
              </div>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent/20 text-accent">
              Active
            </span>
          </div>

          {/* Discovered WiFi Peer Cards */}
          {peers.map((peer) => (
            <div
              key={peer.ip}
              className="p-3.5 rounded-xl bg-surface/80 border border-sky-500/40 flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-sky-500/20 text-sky-400">
                  {peer.deviceType === 'mobile' ? <Smartphone size={18} /> : <Monitor size={18} />}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-primary truncate">{peer.deviceName}</p>
                  <p className="text-[11px] text-secondary font-mono truncate">
                    {peer.ip} • {peer.mp3Count} MP3s ({formatBytes(peer.totalSizeBytes)})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => syncWithWifiPeers(peer.ip)}
                disabled={isSyncingPeers}
                className="px-2.5 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-[11px] font-bold flex-shrink-0 cursor-pointer transition-colors"
                title={`Pull MP3s from ${peer.deviceName}`}
              >
                Pull MP3s
              </button>
            </div>
          ))}

          {/* Direct IP Connect Form (for linking Phone / PC 1 / PC 2 directly by IP if router isolates broadcast) */}
          <form
            onSubmit={handleAddPeerSubmit}
            className="p-3 rounded-xl bg-surface/50 border border-customBorder/60 flex items-center gap-2"
          >
            <input
              type="text"
              value={manualIpInput}
              onChange={(e) => setManualIpInput(e.target.value)}
              placeholder="Link device IP (e.g. 192.168.1.45)"
              className="bg-base border border-customBorder rounded-lg px-2.5 py-1.5 text-xs text-primary placeholder:text-muted flex-1 min-w-0 focus:outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={isAddingIp || !manualIpInput.trim()}
              className="px-3 py-1.5 rounded-lg bg-elevated hover:bg-highlight text-xs font-bold text-primary border border-customBorder flex items-center gap-1 flex-shrink-0 cursor-pointer disabled:opacity-40"
            >
              {isAddingIp ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              <span>Link</span>
            </button>
          </form>
        </div>
      </div>

      {/* Cleanup & Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-elevated/40 border border-customBorder/40">
        <div className="flex items-center gap-3">
          {savedTracks.length > 0 && (
            <button
              type="button"
              onClick={() => playTrack(savedTracks[0], savedTracks)}
              className="w-10 h-10 rounded-full bg-accent text-accent-content flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all cursor-pointer"
              title="Play All Saved MP3s"
            >
              <Play size={18} fill="currentColor" className="ml-0.5" />
            </button>
          )}
          <div>
            <h2 className="text-base font-bold text-primary">
              Saved MP3s on This Device ({savedTracks.length})
            </h2>
            <p className="text-xs text-secondary">
              {formatBytes(totalLocalBytes)} stored locally • Instant offline playback
            </p>
          </div>
        </div>

        {/* Cleanup Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {peers.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-secondary cursor-pointer select-none mr-1">
              <input
                type="checkbox"
                checked={deletePropagateWifi}
                onChange={(e) => setDeletePropagateWifi(e.target.checked)}
                className="rounded accent-emerald-500"
              />
              <span>Also delete on WiFi peers</span>
            </label>
          )}

          {unlikedSavedCount > 0 && (
            <button
              type="button"
              data-testid="cleanup-unliked-mp3s-btn"
              onClick={() => {
                if (
                  confirm(
                    `Clean up ${unlikedSavedCount} unliked MP3${
                      unlikedSavedCount === 1 ? '' : 's'
                    }? Your Liked Songs will be kept safe.`
                  )
                ) {
                  cleanupSavedMp3s('unliked', likedIds, deletePropagateWifi);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-bold transition-colors cursor-pointer"
              title="Delete all saved MP3s that are not in your Liked Songs"
            >
              <Trash2 size={13} />
              <span>Clean Up Unliked ({unlikedSavedCount})</span>
            </button>
          )}

          {savedTracks.length > 0 && (
            <button
              type="button"
              data-testid="delete-all-mp3s-btn"
              onClick={() => {
                if (
                  confirm(
                    `Delete all ${savedTracks.length} saved MP3 files from ${
                      deletePropagateWifi ? 'ALL connected WiFi devices' : 'this device'
                    }?`
                  )
                ) {
                  cleanupSavedMp3s('all', [], deletePropagateWifi);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30 text-xs font-bold transition-colors cursor-pointer"
            >
              <Trash2 size={13} />
              <span>Delete All ({savedTracks.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Saved MP3 Tracks Table */}
      {savedTracks.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-12 px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider border-b border-customBorder/50">
            <span className="col-span-1">#</span>
            <span className="col-span-6 sm:col-span-5">Track</span>
            <span className="hidden sm:block sm:col-span-3">Source / Size</span>
            <span className="col-span-5 sm:col-span-3 text-right">Manage MP3</span>
          </div>

          <div className="flex flex-col gap-1 mt-1">
            {savedTracks.map((track, idx) => {
              const isCurrent = currentTrack?.id === track.id;
              return (
                <div
                  key={`${track.id}-${idx}`}
                  data-testid="saved-mp3-item"
                  onClick={() => handlePlaySavedTrack(track)}
                  className={`group grid grid-cols-12 items-center px-4 py-2.5 rounded-lg transition-colors cursor-pointer ${
                    isCurrent ? 'bg-elevated' : 'hover:bg-elevated/50'
                  }`}
                >
                  <div className="col-span-1 flex items-center">
                    <span className="text-xs text-muted group-hover:hidden w-4 text-center">
                      {idx + 1}
                    </span>
                    <span className="hidden group-hover:block text-accent w-4 text-center">
                      <Play size={14} fill="currentColor" />
                    </span>
                  </div>

                  {/* Artwork & Title */}
                  <div className="col-span-6 sm:col-span-5 flex items-center gap-3 min-w-0 pr-2">
                    <img
                      src={getTrackArtwork(track)}
                      alt={track.title}
                      className="w-10 h-10 rounded object-cover flex-shrink-0 bg-highlight"
                      onError={(e) => {
                        const target = e.currentTarget;
                        if (target.src !== DEFAULT_MUSIC_ARTWORK) {
                          target.src = DEFAULT_MUSIC_ARTWORK;
                          resolveTrackArtwork(track.artist, track.title).then((url) => {
                            if (url && !isUglyPlaceholder(url)) target.src = url;
                          });
                        }
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p
                          className={`text-sm font-semibold truncate ${
                            isCurrent ? 'text-accent' : 'text-primary'
                          }`}
                        >
                          {track.title}
                        </p>
                        <span title="Saved locally as MP3" className="flex-shrink-0">
                          <CheckCircle2
                            size={13}
                            className="text-emerald-400"
                          />
                        </span>
                      </div>
                      <p
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateToArtist(track.artist);
                        }}
                        className="text-xs text-secondary truncate hover:underline hover:text-primary"
                      >
                        {track.artist}
                      </p>
                    </div>
                  </div>

                  {/* Source badge & File Size */}
                  <div className="hidden sm:flex sm:col-span-3 flex-col min-w-0 pr-2">
                    <span className="text-xs text-primary font-mono">
                      {formatBytes(track.sizeBytes)} • {formatDuration(track.duration)}
                    </span>
                    <span className="text-[11px] text-muted truncate">
                      {track.savedReason === 'auto_complete'
                        ? 'Auto-saved (Played 100%)'
                        : track.savedReason === 'wifi_sync'
                        ? `Synced from ${track.originDeviceName || 'WiFi Peer'}`
                        : 'Saved MP3'}
                    </span>
                  </div>

                  {/* Actions: Like, Export .mp3, Delete */}
                  <div
                    className="col-span-5 sm:col-span-3 flex items-center justify-end gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => toggleLike(track)}
                      className="p-1.5 rounded-lg text-secondary hover:text-accent transition-colors cursor-pointer"
                      title={isLiked(track.id) ? 'Liked (Protected from Unliked Cleanup)' : 'Like track'}
                    >
                      <Heart
                        size={15}
                        className={isLiked(track.id) ? 'text-accent fill-accent' : ''}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={() => exportMp3File(track)}
                      className="px-2.5 py-1 rounded-lg bg-elevated hover:bg-highlight text-xs font-bold text-primary border border-customBorder flex items-center gap-1 transition-colors cursor-pointer"
                      title="Export / Save .mp3 file"
                    >
                      <Download size={13} />
                      <span className="hidden md:inline">.mp3</span>
                    </button>

                    <button
                      type="button"
                      data-testid={`vault-delete-mp3-${track.id}`}
                      onClick={() => deleteSavedMp3(track.id, deletePropagateWifi)}
                      className="p-1.5 rounded-lg bg-elevated hover:bg-red-500/20 text-muted hover:text-red-400 border border-customBorder transition-colors cursor-pointer"
                      title={
                        deletePropagateWifi
                          ? 'Delete MP3 from this device & all WiFi devices'
                          : 'Delete MP3 from this device'
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-center py-14 px-4 rounded-2xl bg-elevated/20 border border-customBorder/40 text-muted">
          <HardDrive size={40} className="mx-auto opacity-30 mb-3" />
          <p className="text-base font-semibold text-primary">No saved MP3s on this device yet</p>
          <p className="text-xs text-secondary mt-1 max-w-md mx-auto">
            {autoSaveCompleted
              ? 'Listen to any track all the way through to auto-save it as an MP3, or click the Download icon on any song to save it immediately.'
              : 'Click the Download icon on any track or enable Auto-Save above to automatically save tracks you finish listening to.'}
          </p>
        </div>
      )}

      {/* Available on Other WiFi Devices Section (for Manual Pull or Previewing Peer Vaults) */}
      {remoteOnlyPeerTracks.length > 0 && (
        <div className="flex flex-col gap-3 pt-4 border-t border-customBorder/40">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-primary flex items-center gap-2">
                <Wifi size={16} className="text-sky-400" />
                <span>Available on Your Other WiFi Devices ({remoteOnlyPeerTracks.length})</span>
              </h3>
              <p className="text-xs text-secondary">
                Click "Pull MP3" on any track below to copy it over WiFi to this device.
              </p>
            </div>
            <button
              type="button"
              onClick={() => syncWithWifiPeers()}
              disabled={isSyncingPeers}
              className="px-3.5 py-1.5 rounded-xl bg-sky-500 text-black font-extrabold text-xs hover:bg-sky-400 transition-colors cursor-pointer"
            >
              Pull All ({remoteOnlyPeerTracks.length})
            </button>
          </div>

          <div className="flex flex-col gap-1">
            {remoteOnlyPeerTracks.map((pt) => {
              const isSaving = savingTrackIds.includes(pt.id);
              const peerFileUrl = `http://${pt.peerIp}:${pt.peerPort || 3001}/api/mp3s/file/${encodeURIComponent(
                pt.id
              )}`;
              return (
                <div
                  key={`${pt.peerIp}-${pt.id}`}
                  onClick={() =>
                    playTrack({
                      ...pt,
                      streamUrl: peerFileUrl,
                    })
                  }
                  className="grid grid-cols-12 items-center px-4 py-2.5 rounded-lg bg-elevated/30 hover:bg-elevated/60 transition-colors cursor-pointer"
                >
                  <div className="col-span-7 flex items-center gap-3 min-w-0">
                    <img
                      src={getTrackArtwork(pt)}
                      alt={pt.title}
                      className="w-9 h-9 rounded object-cover flex-shrink-0 bg-highlight"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-primary truncate">{pt.title}</p>
                      <p className="text-xs text-secondary truncate">
                        {pt.artist} • <span className="text-sky-400">{pt.peerDeviceName}</span>
                      </p>
                    </div>
                  </div>

                  <div className="col-span-2 text-xs text-muted font-mono hidden sm:block">
                    {formatBytes(pt.sizeBytes)}
                  </div>

                  <div
                    className="col-span-5 sm:col-span-3 flex items-center justify-end gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() =>
                        saveTrackAsMp3(pt, 'manual_download', peerFileUrl, pt.peerDeviceName)
                      }
                      className="px-3 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      {isSaving ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Download size={13} />
                      )}
                      <span>{isSaving ? 'Pulling...' : 'Pull MP3'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <DownloadFolderModal
        open={isDownloadModalOpen}
        onClose={() => {
          setIsDownloadModalOpen(false);
          refreshVault().catch(() => {});
        }}
      />
    </div>
  );
};
