import { create } from 'zustand';
import { safeStorage } from '../utils/storage';
import { audioEngine } from '../audio/audioEngine';

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
  groupId?: string;
  isDefault?: boolean;
}

interface AudioDeviceState {
  devices: AudioOutputDevice[];
  activeDeviceId: string;
  activeDeviceLabel: string;
  isSupported: boolean;
  isLoading: boolean;
  isPlayingTestTone: boolean;
  errorMessage: string | null;

  loadDevices: () => Promise<void>;
  selectDevice: (deviceId: string, label?: string) => Promise<boolean>;
  promptSystemPicker: () => Promise<boolean>;
  playTestTone: () => Promise<void>;
  openWindowsSoundSettings: () => Promise<void>;
}

const STORAGE_KEY_DEVICE_ID = 'dotify_audio_output_device';
const STORAGE_KEY_DEVICE_LABEL = 'dotify_audio_output_device_label';

function checkSetSinkIdSupport(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    typeof HTMLAudioElement !== 'undefined' &&
    'setSinkId' in HTMLAudioElement.prototype
  );
}

export const useAudioDeviceStore = create<AudioDeviceState>((set, get) => {
  const initialDeviceId = safeStorage.getItem(STORAGE_KEY_DEVICE_ID, 'default') || 'default';
  const initialDeviceLabel = safeStorage.getItem(STORAGE_KEY_DEVICE_LABEL, 'Default Audio Output') || 'Default Audio Output';

  // Wire up devicechange listener once if in browser
  if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
    try {
      navigator.mediaDevices.addEventListener('devicechange', () => {
        get().loadDevices().catch(() => {});
      });
    } catch {}
  }

  return {
    devices: [],
    activeDeviceId: initialDeviceId,
    activeDeviceLabel: initialDeviceLabel,
    isSupported: checkSetSinkIdSupport(),
    isLoading: false,
    isPlayingTestTone: false,
    errorMessage: null,

    loadDevices: async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
        set({ isSupported: false });
        return;
      }

      set({ isLoading: true, errorMessage: null });

      try {
        const rawDevices = await navigator.mediaDevices.enumerateDevices();
        const outputs = rawDevices.filter((d) => d.kind === 'audiooutput');

        const seenIds = new Set<string>();
        const mappedDevices: AudioOutputDevice[] = [];

        // Always include default system output as first entry
        const hasExplicitDefault = outputs.some((d) => d.deviceId === 'default');

        outputs.forEach((device, index) => {
          const id = device.deviceId;
          if (seenIds.has(id)) return;
          seenIds.add(id);

          let label = device.label ? device.label.trim() : '';
          if (!label) {
            if (id === 'default') {
              label = 'Default System Audio Output';
            } else if (id === 'communications') {
              label = 'Communications Audio Device';
            } else {
              label = `Speaker / Headphones (${mappedDevices.length + 1})`;
            }
          }

          mappedDevices.push({
            deviceId: id,
            label,
            groupId: device.groupId,
            isDefault: id === 'default',
          });
        });

        // If no explicit 'default' entry was enumerated, ensure one exists at the top
        if (!hasExplicitDefault) {
          mappedDevices.unshift({
            deviceId: 'default',
            label: 'Default System Audio Output',
            isDefault: true,
          });
        }

        const currentActiveId = get().activeDeviceId;
        const matchingDevice = mappedDevices.find((d) => d.deviceId === currentActiveId);
        const resolvedLabel = matchingDevice ? matchingDevice.label : get().activeDeviceLabel;

        set({
          devices: mappedDevices,
          activeDeviceLabel: resolvedLabel,
          isLoading: false,
          isSupported: checkSetSinkIdSupport(),
        });
      } catch (err: any) {
        console.warn('[AudioDeviceStore] Failed to enumerate audio devices:', err);
        set({
          isLoading: false,
          errorMessage: err?.message || 'Could not enumerate audio output devices',
        });
      }
    },

    selectDevice: async (deviceId: string, label?: string) => {
      const { devices } = get();
      const matched = devices.find((d) => d.deviceId === deviceId);
      const chosenLabel = label || matched?.label || (deviceId === 'default' ? 'Default System Audio Output' : 'Audio Output Device');

      try {
        const ok = await audioEngine.setAudioOutputDevice(deviceId);
        if (ok) {
          safeStorage.setItem(STORAGE_KEY_DEVICE_ID, deviceId);
          safeStorage.setItem(STORAGE_KEY_DEVICE_LABEL, chosenLabel);
          set({
            activeDeviceId: deviceId,
            activeDeviceLabel: chosenLabel,
            errorMessage: null,
          });
          return true;
        } else {
          set({ errorMessage: `Failed to route audio to ${chosenLabel}` });
          return false;
        }
      } catch (err: any) {
        console.warn('[AudioDeviceStore] Error selecting output device:', err);
        set({ errorMessage: err?.message || 'Failed to switch output device' });
        return false;
      }
    },

    promptSystemPicker: async () => {
      if (typeof navigator === 'undefined' || !(navigator.mediaDevices as any)?.selectAudioOutput) {
        // Fallback: reload enumerated devices
        await get().loadDevices();
        return false;
      }

      try {
        const pickedDevice: MediaDeviceInfo = await (navigator.mediaDevices as any).selectAudioOutput();
        if (pickedDevice && pickedDevice.deviceId) {
          const label = pickedDevice.label || 'Selected Audio Device';
          await get().selectDevice(pickedDevice.deviceId, label);
          await get().loadDevices();
          return true;
        }
        return false;
      } catch (err: any) {
        if (err.name !== 'AbortError' && err.name !== 'NotAllowedError') {
          console.warn('[AudioDeviceStore] selectAudioOutput error:', err);
          set({ errorMessage: err?.message || 'Failed to open system audio picker' });
        }
        return false;
      }
    },

    playTestTone: async () => {
      const { activeDeviceId, isPlayingTestTone } = get();
      if (isPlayingTestTone) return;

      set({ isPlayingTestTone: true });

      try {
        const AudioCtx =
          typeof window !== 'undefined'
            ? window.AudioContext || (window as any).webkitAudioContext
            : (globalThis as any).AudioContext;
        if (!AudioCtx) {
          set({ isPlayingTestTone: false });
          return;
        }

        const ctx = new AudioCtx();
        if (typeof (ctx as any).setSinkId === 'function' && activeDeviceId && activeDeviceId !== 'default') {
          try {
            await (ctx as any).setSinkId(activeDeviceId);
          } catch {}
        }

        // Two-tone pleasant chord chime: 523.25 Hz (C5) -> 659.25 Hz (E5) -> 783.99 Hz (G5)
        const now = ctx.currentTime;
        const notes = [
          { freq: 523.25, start: 0.0, dur: 0.18 },
          { freq: 659.25, start: 0.12, dur: 0.20 },
          { freq: 783.99, start: 0.24, dur: 0.35 },
        ];

        notes.forEach(({ freq, start, dur }) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + start);

          gain.gain.setValueAtTime(0.001, now + start);
          gain.gain.exponentialRampToValueAtTime(0.25, now + start + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(now + start);
          osc.stop(now + start + dur);
        });

        setTimeout(() => {
          try {
            ctx.close();
          } catch {}
          set({ isPlayingTestTone: false });
        }, 700);
      } catch (err) {
        console.warn('[AudioDeviceStore] Failed to play test tone:', err);
        set({ isPlayingTestTone: false });
      }
    },

    openWindowsSoundSettings: async () => {
      // In Tauri Windows, open Windows App volume and device preferences
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('open_external_browser', { url: 'ms-settings:apps-volume' });
      } catch {
        // Fallback for browser / web dev
        try {
          window.open('ms-settings:apps-volume', '_blank');
        } catch {}
      }
    },
  };
});
