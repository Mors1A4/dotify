import React, { useState, useEffect } from 'react';
import { useJamStore } from '../../store/jamStore';
import { usePlayerStore } from '../../store/playerStore';
import { resolveSpotifyUrl, isSpotifyLink } from '../../services/spotifyApi';
import QRCode from 'qrcode';
import {
  Users,
  Radio,
  Share2,
  Copy,
  Check,
  X,
  Music2,
  ArrowRight,
  LogOut,
  Sparkles,
  Link,
  Loader2,
} from 'lucide-react';

export const JamModal: React.FC = () => {
  const {
    isConnected,
    isHost,
    roomCode,
    hostName,
    members,
    statusMessage,
    createRoom,
    joinRoom,
    leaveRoom,
  } = useJamStore();

  const isJamModalOpen = usePlayerStore((s) => s.isJamModalOpen);
  const toggleJamModal = usePlayerStore((s) => s.toggleJamModal);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const addToQueue = usePlayerStore((s) => s.addToQueue);

  const [activeTab, setActiveTab] = useState<'host' | 'join' | 'spotify'>('host');
  const [inputCode, setInputCode] = useState('');
  const [userName, setUserName] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // Spotify import state
  const [spotifyInput, setSpotifyInput] = useState('');
  const [isResolvingSpotify, setIsResolvingSpotify] = useState(false);
  const [spotifyStatus, setSpotifyStatus] = useState<string | null>(null);

  // Check URL query parameters for ?jam=CODE on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jamParam = params.get('jam');
    if (jamParam && !isConnected) {
      joinRoom(jamParam, 'Mobile Guest');
      toggleJamModal(true);
      // Clean up URL without reloading
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Generate QR Code whenever roomCode changes
  useEffect(() => {
    if (roomCode) {
      const joinUrl = `${window.location.origin}/?jam=${roomCode}`;
      QRCode.toDataURL(joinUrl, {
        width: 240,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      })
        .then((url) => setQrDataUrl(url))
        .catch((err) => console.error('QR generation error:', err));
    }
  }, [roomCode]);

  if (!isJamModalOpen) return null;

  const handleCopyLink = () => {
    if (!roomCode) return;
    const joinUrl = `${window.location.origin}/?jam=${roomCode}`;
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(joinUrl).catch(() => {});
      } else {
        const el = document.createElement('textarea');
        el.value = joinUrl;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
    } catch {
      // Ignore copy error
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCreateJam = () => {
    createRoom(userName.trim() || 'DJ Host');
  };

  const handleJoinJam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputCode.trim()) return;
    joinRoom(inputCode.trim(), userName.trim() || 'Friend');
  };

  const handleImportSpotify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spotifyInput.trim()) return;

    setIsResolvingSpotify(true);
    setSpotifyStatus(null);

    try {
      const res = await resolveSpotifyUrl(spotifyInput.trim());
      if (res.type === 'track' && res.track) {
        playTrack(res.track);
        setSpotifyStatus(`Playing "${res.track.title}" by ${res.track.artist}`);
      } else if (res.tracks && res.tracks.length > 0) {
        // Queue full playlist
        playTrack(res.tracks[0], res.tracks);
        setSpotifyStatus(`Imported "${res.title}" (${res.tracks.length} tracks)`);
      }
      setSpotifyInput('');
    } catch (err: any) {
      setSpotifyStatus(`Error: ${err.message || 'Could not resolve Spotify link'}`);
    } finally {
      setIsResolvingSpotify(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border bg-card/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-spotify/20 flex items-center justify-center text-spotify">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                Dotify Jam & Group Session
                <span className="text-[10px] bg-spotify/20 text-spotify uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold">
                  Free
                </span>
              </h2>
              <p className="text-xs text-muted">
                {isConnected
                  ? `Active Session • ${members.length} listening together`
                  : 'Collaborative real-time listening with friends'}
              </p>
            </div>
          </div>
          <button
            onClick={() => toggleJamModal(false)}
            className="p-2 rounded-full hover:bg-highlight text-muted hover:text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation (when not connected) */}
        {!isConnected && (
          <div className="flex border-b border-border bg-surface">
            <button
              onClick={() => setActiveTab('host')}
              className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 ${
                activeTab === 'host'
                  ? 'border-spotify text-spotify bg-highlight/30'
                  : 'border-transparent text-muted hover:text-primary'
              }`}
            >
              Start Jam
            </button>
            <button
              onClick={() => setActiveTab('join')}
              className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 ${
                activeTab === 'join'
                  ? 'border-spotify text-spotify bg-highlight/30'
                  : 'border-transparent text-muted hover:text-primary'
              }`}
            >
              Join Session
            </button>
            <button
              onClick={() => setActiveTab('spotify')}
              className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 ${
                activeTab === 'spotify'
                  ? 'border-spotify text-spotify bg-highlight/30'
                  : 'border-transparent text-muted hover:text-primary'
              }`}
            >
              Spotify Link
            </button>
          </div>
        )}

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Status Message */}
          {statusMessage && (
            <div className="px-4 py-2.5 rounded-xl bg-spotify/10 border border-spotify/30 text-spotify text-xs font-medium flex items-center gap-2">
              <Sparkles className="w-4 h-4 shrink-0" />
              {statusMessage}
            </div>
          )}

          {/* ACTIVE JAM VIEW */}
          {isConnected ? (
            <div className="space-y-6 text-center">
              <div className="p-4 bg-surface rounded-2xl border border-border inline-block">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Jam QR Code"
                    className="w-52 h-52 rounded-xl mx-auto shadow-md"
                  />
                ) : (
                  <div className="w-52 h-52 flex items-center justify-center text-muted">
                    <Loader2 className="w-8 h-8 animate-spin" />
                  </div>
                )}
                <p className="text-[11px] text-muted mt-2">Scan with phone camera to join</p>
              </div>

              <div>
                <span className="text-xs uppercase tracking-widest text-muted font-bold block mb-1">
                  Jam Room Code
                </span>
                <div className="flex items-center justify-center gap-3">
                  <span className="text-3xl font-black tracking-widest text-spotify font-mono bg-highlight px-4 py-1.5 rounded-xl border border-border">
                    {roomCode}
                  </span>
                  <button
                    onClick={handleCopyLink}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-highlight hover:bg-white/10 text-xs font-semibold text-primary transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4 text-spotify" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copied Link' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Connected Members */}
              <div className="bg-surface rounded-xl p-4 text-left border border-border">
                <h4 className="text-xs font-bold text-muted uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-spotify" />
                  Listening Together ({members.length})
                </h4>
                <div className="flex flex-wrap gap-2">
                  {members.map((m, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium bg-highlight border border-border flex items-center gap-1.5"
                    >
                      <span className="w-2 h-2 rounded-full bg-spotify animate-ping" />
                      {m.name} {m.isHost && '(Host)'}
                    </span>
                  ))}
                </div>
              </div>

              {/* Leave Button */}
              <button
                onClick={leaveRoom}
                className="w-full py-2.5 rounded-xl border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Leave Jam Session
              </button>
            </div>
          ) : activeTab === 'host' ? (
            /* START JAM TAB */
            <div className="space-y-4">
              <div className="p-4 bg-surface rounded-xl border border-border text-left space-y-1">
                <h3 className="text-sm font-semibold text-primary">Host a Group Listening Session</h3>
                <p className="text-xs text-muted leading-relaxed">
                  Start a Jam and invite anyone nearby. Friends on Android, iPhone, or PC can scan the
                  QR code or click your link to sync playback and queue songs together.
                </p>
              </div>

              <div className="space-y-2 text-left">
                <label className="text-xs font-medium text-muted">Your Display Name</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="e.g. DJ Monty"
                  className="w-full px-4 py-2.5 rounded-xl bg-surface border border-border text-primary text-sm focus:outline-none focus:border-spotify"
                />
              </div>

              <button
                onClick={handleCreateJam}
                className="w-full py-3 rounded-xl bg-spotify hover:bg-spotify-hover text-black font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-spotify/20"
              >
                <Radio className="w-4 h-4" />
                Launch Jam & Show QR Code
              </button>
            </div>
          ) : activeTab === 'join' ? (
            /* JOIN JAM TAB */
            <form onSubmit={handleJoinJam} className="space-y-4 text-left">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted">Jam Room Code</label>
                <input
                  type="text"
                  maxLength={6}
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                  placeholder="e.g. 7K4L9M"
                  className="w-full px-4 py-3 rounded-xl bg-surface border border-border text-primary text-lg font-mono tracking-widest uppercase focus:outline-none focus:border-spotify"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted">Your Name</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="e.g. Alex"
                  className="w-full px-4 py-2.5 rounded-xl bg-surface border border-border text-primary text-sm focus:outline-none focus:border-spotify"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-spotify hover:bg-spotify-hover text-black font-bold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <ArrowRight className="w-4 h-4" />
                Join Session
              </button>
            </form>
          ) : (
            /* SPOTIFY IMPORT TAB */
            <form onSubmit={handleImportSpotify} className="space-y-4 text-left">
              <div className="p-4 bg-surface rounded-xl border border-border space-y-1">
                <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
                  <Link className="w-4 h-4 text-spotify" />
                  Import Spotify Links & QR
                </h3>
                <p className="text-xs text-muted leading-relaxed">
                  Got a Spotify track, album, or playlist link? Paste it here to extract the music and
                  stream it instantly on Dotify without a Spotify account.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted">Spotify URL or URI</label>
                <input
                  type="text"
                  value={spotifyInput}
                  onChange={(e) => setSpotifyInput(e.target.value)}
                  placeholder="https://open.spotify.com/track/... or playlist"
                  className="w-full px-4 py-2.5 rounded-xl bg-surface border border-border text-primary text-xs focus:outline-none focus:border-spotify font-mono"
                />
              </div>

              {spotifyStatus && (
                <div
                  className={`p-3 rounded-xl text-xs ${
                    spotifyStatus.startsWith('Error')
                      ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                      : 'bg-spotify/10 text-spotify border border-spotify/30'
                  }`}
                >
                  {spotifyStatus}
                </div>
              )}

              <button
                type="submit"
                disabled={isResolvingSpotify || !spotifyInput.trim()}
                className="w-full py-3 rounded-xl bg-spotify hover:bg-spotify-hover disabled:opacity-50 text-black font-bold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                {isResolvingSpotify ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Music2 className="w-4 h-4" />
                )}
                {isResolvingSpotify ? 'Resolving Music...' : 'Play / Queue in Dotify'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
