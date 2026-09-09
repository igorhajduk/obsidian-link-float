import type { App } from 'obsidian';
import { webUrl } from './links';

export interface ReadingPosition { url: string; x: number; y: number; updatedAt: number }
const STORAGE_KEY = 'obsidian-link-float:reading-positions:v1';
const LEGACY_STORAGE_KEY = 'obsidian-link-preview:reading-positions:v1';
const MAX_ENTRIES = 100;
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;

/** Local to this vault/device; never stored in the synced plugin settings file. */
export class PositionCache {
  private entries: ReadingPosition[] = [];
  revision = 0;

  constructor(private storage: Pick<App, 'loadLocalStorage' | 'saveLocalStorage'>, private now = Date.now) {
    let saved: unknown;
    let migrating = false;
    try {
      saved = storage.loadLocalStorage(STORAGE_KEY);
      if (saved == null) {
        saved = storage.loadLocalStorage(LEGACY_STORAGE_KEY);
        migrating = Array.isArray(saved);
      }
    } catch { /* A missing cache must not prevent previews. */ }
    if (Array.isArray(saved)) this.entries = saved.filter((value): value is ReadingPosition => this.valid(value)).map(({ url, x, y, updatedAt }) => ({ url, x, y, updatedAt }));
    this.prune();
    if (migrating || Array.isArray(saved) && saved.length !== this.entries.length) {
      try {
        storage.saveLocalStorage(STORAGE_KEY, migrating ? this.entries : this.entries.length ? this.entries : null);
        if (migrating) storage.saveLocalStorage(LEGACY_STORAGE_KEY, null);
      } catch { /* Keep the old cache until the new key has been written successfully. */ }
    }
  }

  private valid(value: unknown): value is ReadingPosition {
    if (!value || typeof value !== 'object') return false;
    const item = value as ReadingPosition;
    return typeof item.url === 'string' && webUrl(item.url) === item.url && !new URL(item.url).hash &&
      [item.x, item.y].every(n => Number.isFinite(n) && n >= 0 && n <= 100_000_000) &&
      Number.isFinite(item.updatedAt) && item.updatedAt > this.now() - MAX_AGE && item.updatedAt <= this.now() + 60_000;
  }

  private prune(): void {
    this.entries = this.entries.filter(entry => this.valid(entry)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_ENTRIES);
  }

  get(url: string): ReadingPosition | undefined {
    this.prune();
    const entry = this.entries.find(item => item.url === url);
    return entry ? { ...entry } : undefined;
  }

  put(position: Pick<ReadingPosition, 'url' | 'x' | 'y'>, touch = false): void {
    const entry = { ...position, updatedAt: this.now() };
    if (!this.valid(entry)) return;
    const previous = this.entries.find(item => item.url === entry.url);
    if (!touch && previous?.x === entry.x && previous?.y === entry.y) return;
    this.entries = [entry, ...this.entries.filter(item => item.url !== entry.url)];
    this.prune();
    try { this.storage.saveLocalStorage(STORAGE_KEY, this.entries); } catch { /* Reading must work when storage is unavailable. */ }
  }

  clear(): void {
    this.revision++;
    this.entries = [];
    this.storage.saveLocalStorage(STORAGE_KEY, null);
    this.storage.saveLocalStorage(LEGACY_STORAGE_KEY, null);
  }

  get size(): number { this.prune(); return this.entries.length; }
}
