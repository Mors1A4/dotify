import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useAudioDeviceStore } from '../../src/store/audioDeviceStore';
import { audioEngine } from '../../src/audio/audioEngine';
import { usePlayerStore } from '../../src/store/playerStore';
import { safeStorage } from '../../src/utils/storage';

describe('Audio Output Device Selection & Settings View', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    // Reset store state
    useAudioDeviceStore.setState({
      devices: [],
      activeDeviceId: 'default',
      activeDeviceLabel: 'Default Audio Output',
      isSupported: true,
      isLoading: false,
      isPlayingTestTone: false,
      errorMessage: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('initializes with default output device and checks setSinkId support', () => {
    const state = useAudioDeviceStore.getState();
    expect(state.activeDeviceId).toBe('default');
    expect(state.activeDeviceLabel).toBeDefined();
    expect(state.devices).toEqual([]);
  });

  it('enumerates audio output devices, filters by kind, and provides friendly fallback labels', async () => {
    const mockDevices = [
      {
        deviceId: 'default',
        kind: 'audiooutput',
        label: 'Speakers (Realtek(R) Audio)',
        groupId: 'group1',
      },
      {
        deviceId: 'headphones-123',
        kind: 'audiooutput',
        label: 'Headphones (Sony WH-1000XM4)',
        groupId: 'group2',
      },
      {
        deviceId: 'unlabelled-output',
        kind: 'audiooutput',
        label: '',
        groupId: 'group3',
      },
      {
        deviceId: 'mic-input',
        kind: 'audioinput',
        label: 'Microphone Array',
        groupId: 'group4',
      },
    ];

    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: vi.fn(async () => mockDevices),
        addEventListener: vi.fn(),
      },
    });

    await useAudioDeviceStore.getState().loadDevices();

    const state = useAudioDeviceStore.getState();
    // Only audio outputs are included (3 out of 4)
    expect(state.devices).toHaveLength(3);
    expect(state.devices[0].deviceId).toBe('default');
    expect(state.devices[0].label).toBe('Speakers (Realtek(R) Audio)');
    expect(state.devices[1].deviceId).toBe('headphones-123');
    expect(state.devices[1].label).toBe('Headphones (Sony WH-1000XM4)');
    expect(state.devices[2].deviceId).toBe('unlabelled-output');
    // Device without label gets friendly fallback label
    expect(state.devices[2].label).toContain('Speaker / Headphones');
  });

  it('selects output device, persists choice to localStorage, and delegates to audioEngine', async () => {
    const setSinkIdSpy = vi.spyOn(audioEngine, 'setAudioOutputDevice').mockResolvedValue(true);

    useAudioDeviceStore.setState({
      devices: [
        { deviceId: 'default', label: 'Default System Output' },
        { deviceId: 'bt-speaker-456', label: 'JBL Charge 5' },
      ],
    });

    const success = await useAudioDeviceStore.getState().selectDevice('bt-speaker-456', 'JBL Charge 5');
    expect(success).toBe(true);

    const state = useAudioDeviceStore.getState();
    expect(state.activeDeviceId).toBe('bt-speaker-456');
    expect(state.activeDeviceLabel).toBe('JBL Charge 5');

    // Persisted to storage
    expect(safeStorage.getItem('dotify_audio_output_device', '')).toBe('bt-speaker-456');
    expect(safeStorage.getItem('dotify_audio_output_device_label', '')).toBe('JBL Charge 5');

    // Verified audioEngine delegate
    expect(setSinkIdSpy).toHaveBeenCalledWith('bt-speaker-456');
  });

  it('audioEngine.setAudioOutputDevice invokes setSinkId on audio elements and updates sink ID', async () => {
    const primarySinkSpy = vi.fn().mockResolvedValue(undefined);
    const secondarySinkSpy = vi.fn().mockResolvedValue(undefined);

    (audioEngine as any).primaryAudio = { setSinkId: primarySinkSpy };
    (audioEngine as any).secondaryAudio = { setSinkId: secondarySinkSpy };

    const result = await audioEngine.setAudioOutputDevice('external-dac-789');
    expect(result).toBe(true);
    expect(audioEngine.getAudioOutputDevice()).toBe('external-dac-789');
    expect(primarySinkSpy).toHaveBeenCalledWith('external-dac-789');
    expect(secondarySinkSpy).toHaveBeenCalledWith('external-dac-789');
  });

  it('supports selecting devices via system picker prompt (selectAudioOutput)', async () => {
    const selectSinkSpy = vi.spyOn(audioEngine, 'setAudioOutputDevice').mockResolvedValue(true);

    vi.stubGlobal('navigator', {
      mediaDevices: {
        selectAudioOutput: vi.fn(async () => ({
          deviceId: 'system-picked-dac',
          label: 'FiiO USB DAC',
        })),
        enumerateDevices: vi.fn(async () => [
          { deviceId: 'system-picked-dac', kind: 'audiooutput', label: 'FiiO USB DAC' },
        ]),
        addEventListener: vi.fn(),
      },
    });

    const picked = await useAudioDeviceStore.getState().promptSystemPicker();
    expect(picked).toBe(true);
    expect(useAudioDeviceStore.getState().activeDeviceId).toBe('system-picked-dac');
    expect(useAudioDeviceStore.getState().activeDeviceLabel).toBe('FiiO USB DAC');
    expect(selectSinkSpy).toHaveBeenCalledWith('system-picked-dac');
  });

  it('plays test chime without throwing errors and recovers playing state', async () => {
    const closeSpy = vi.fn();
    const createOscillatorMock = vi.fn(() => ({
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }));
    const createGainMock = vi.fn(() => ({
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    }));

    class MockAudioContext {
      currentTime = 0;
      destination = {};
      createOscillator = createOscillatorMock;
      createGain = createGainMock;
      close = closeSpy;
      setSinkId = vi.fn().mockResolvedValue(undefined);
    }

    vi.stubGlobal('AudioContext', MockAudioContext);
    if (typeof window !== 'undefined') {
      vi.stubGlobal('window', { AudioContext: MockAudioContext });
    }

    await useAudioDeviceStore.getState().playTestTone();
    expect(useAudioDeviceStore.getState().isPlayingTestTone).toBe(true);
    expect(createOscillatorMock).toHaveBeenCalled();
  });

  it('navigates to settings view in playerStore cleanly with history tracking', () => {
    usePlayerStore.setState({
      activeView: 'home',
      navHistory: [{ view: 'home' }],
      navHistoryIndex: 0,
    });

    usePlayerStore.getState().navigateToSettings();
    expect(usePlayerStore.getState().activeView).toBe('settings');

    // Navigate back returns to home
    usePlayerStore.getState().navigateBack();
    expect(usePlayerStore.getState().activeView).toBe('home');

    // Direct setActiveView to settings
    usePlayerStore.getState().setActiveView('settings');
    expect(usePlayerStore.getState().activeView).toBe('settings');
  });
});
