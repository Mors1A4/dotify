import { describe, it, expect, beforeEach } from 'vitest';

export class SafeStorage {
  private prefix = 'dotify_v1_';

  setItem<T>(key: string, value: T): boolean {
    try {
      const serialized = JSON.stringify(value);
      localStorage.setItem(`${this.prefix}${key}`, serialized);
      return true;
    } catch {
      return false;
    }
  }

  getItem<T>(key: string, defaultValue: T): T {
    try {
      const item = localStorage.getItem(`${this.prefix}${key}`);
      if (item === null) return defaultValue;
      return JSON.parse(item) as T;
    } catch {
      return defaultValue;
    }
  }

  removeItem(key: string): void {
    localStorage.removeItem(`${this.prefix}${key}`);
  }
}

describe('SafeStorage LocalStorage Wrapper', () => {
  let storage: SafeStorage;

  beforeEach(() => {
    localStorage.clear();
    storage = new SafeStorage();
  });

  it('prefixes keys with dotify_v1_ namespace', () => {
    storage.setItem('test_key', { foo: 'bar' });
    const raw = localStorage.getItem('dotify_v1_test_key');
    expect(raw).toBe('{"foo":"bar"}');
  });

  it('safely serializes and deserializes complex JSON structures', () => {
    const data = { id: 1, name: 'Playlists', items: ['a', 'b', 'c'] };
    storage.setItem('playlists', data);
    const retrieved = storage.getItem('playlists', null);
    expect(retrieved).toEqual(data);
  });

  it('returns default fallback value when key is missing', () => {
    const fallback = ['default-item'];
    const result = storage.getItem('missing_key', fallback);
    expect(result).toEqual(fallback);
  });

  it('returns default fallback without throwing on corrupted JSON', () => {
    localStorage.setItem('dotify_v1_corrupt', '{malformed-json');
    const fallback = { safe: true };
    const result = storage.getItem('corrupt', fallback);
    expect(result).toEqual(fallback);
  });

  it('handles removal of prefixed keys', () => {
    storage.setItem('to_delete', 123);
    storage.removeItem('to_delete');
    expect(storage.getItem('to_delete', null)).toBeNull();
  });
});
