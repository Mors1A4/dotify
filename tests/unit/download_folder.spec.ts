import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  fetchDownloadDir,
  setDownloadFolder,
  getCachedClientDownloadDir,
} from '../../src/services/downloadFolderService';

describe('Download folder configuration (per-client)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('stores the folder per-client in localStorage, never keyed by user', () => {
    // Simulate a previously cached per-client choice
    localStorage.setItem(
      'dotify_v1_mp3_download_dir_client_custom',
      JSON.stringify('C:\\Music\\Dotify-Custom')
    );
    localStorage.setItem(
      'dotify_v1_mp3_download_dir_client_default',
      JSON.stringify('C:\\Users\\Test\\Music\\Dotify')
    );
    const cached = getCachedClientDownloadDir();
    expect(cached.custom).toBe('C:\\Music\\Dotify-Custom');
    expect(cached.def).toBe('C:\\Users\\Test\\Music\\Dotify');
    // No user id may appear in the per-client keys
    const keys = Object.keys(localStorage);
    expect(keys.some((k) => /user|uid|email/i.test(k))).toBe(false);
  });

  it('fetches the current (initial) download location from the daemon', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          path: 'C:\\Users\\Test\\Music\\Dotify',
          defaultPath: 'C:\\Users\\Test\\Music\\Dotify',
          customPath: null,
          writable: true,
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const info = await fetchDownloadDir();
    expect(info.path).toBe('C:\\Users\\Test\\Music\\Dotify');
    expect(info.defaultPath).toBe('C:\\Users\\Test\\Music\\Dotify');
    expect(info.customPath).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/mp3s/download-dir'),
      expect.anything()
    );
  });

  it('rejects empty paths before hitting the backend (writable check is server-side)', async () => {
    await expect(setDownloadFolder('   ')).rejects.toThrow(/choose a download folder/i);
  });

  it('posts the new folder and caches the per-client result with moved count', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          path: 'D:\\DotifyMp3s',
          defaultPath: 'C:\\Users\\Test\\Music\\Dotify',
          customPath: 'D:\\DotifyMp3s',
          movedCount: 7,
          writable: true,
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const info = await setDownloadFolder('D:\\DotifyMp3s');
    expect(info.path).toBe('D:\\DotifyMp3s');
    expect(info.movedCount).toBe(7);
    const cached = getCachedClientDownloadDir();
    expect(cached.custom).toBe('D:\\DotifyMp3s');
  });

  it('surfaces backend not-writable errors to the caller', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error: 'That folder is not writable.' }), {
          status: 400,
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(setDownloadFolder('Z:\\Nope')).rejects.toThrow(/not writable/i);
  });
});
