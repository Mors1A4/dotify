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
    try {
      localStorage.removeItem(`${this.prefix}${key}`);
    } catch {}
  }
}

export const safeStorage = new SafeStorage();
