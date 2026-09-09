import type { Guest } from './compatibility';
import { PositionCache } from './positions';
import { webUrl } from './links';

interface Snapshot { url: string; x: number; y: number }
interface RestoreResult { cancelled: boolean; done: boolean }
const snapshotCode = '({url:location.href,x:scrollX,y:scrollY})';

/** Temporary page helper only observes navigation input and moves the document viewport. */
function installRestore(key: string, x: number, y: number): RestoreResult {
  const host = window as unknown as Record<string, unknown>;
  let cancelled = false;
  const input = (event: Event) => {
    if (!event.isTrusted) return;
    if (event instanceof KeyboardEvent && !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) return;
    cancelled = true;
  };
  const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  events.forEach(event => window.addEventListener(event, input, { capture: true, passive: true }));
  const api = {
    attempt() {
      if (!cancelled) window.scrollTo({ left: x, top: y, behavior: 'instant' });
      return { cancelled, done: Math.abs(scrollX - x) <= 2 && Math.abs(scrollY - y) <= 2 };
    },
    release() {
      events.forEach(event => window.removeEventListener(event, input, true));
      delete host[key];
    },
  };
  host[key] = api;
  return api.attempt();
}

export class ReadingPositionSession {
  private active = true;
  private initialized = false;
  private initializing = false;
  private sampling = false;
  private key: string | null = null;
  private revision: number;
  private timer: number;
  private ready = () => { void this.initialize(); };

  constructor(private guest: Guest, private cache: PositionCache, private enabled: () => boolean, private openingUrl: string) {
    this.revision = cache.revision;
    guest.addEventListener('dom-ready', this.ready);
    this.timer = window.setInterval(() => { void (this.initialized ? this.capture() : this.initialize()); }, 400);
    void this.initialize();
  }

  private async snapshot(): Promise<Snapshot | null> {
    try {
      const result = await this.guest.executeJavaScript<Snapshot>(snapshotCode);
      return webUrl(result.url) ? result : null;
    } catch { return null; }
  }

  private async initialize(): Promise<void> {
    if (!this.active || this.initialized || this.initializing || !this.enabled()) return;
    this.initializing = true;
    try {
      const initial = await this.snapshot();
      if (!initial || !this.active) return;
      const position = this.cache.get(initial.url);
      if (position && !new URL(this.openingUrl).hash && this.revision === this.cache.revision) {
        const key = this.key = `__peek_reading_${crypto.randomUUID().replaceAll('-', '')}`;
        let result = await this.guest.executeJavaScript<RestoreResult>(`(${installRestore.toString()})(${JSON.stringify(key)},${position.x},${position.y})`);
        const deadline = Date.now() + 2500;
        while (this.active && this.enabled() && this.revision === this.cache.revision && !result.cancelled && !result.done && Date.now() < deadline) {
          await new Promise(resolve => window.setTimeout(resolve, 100));
          if (!this.active || this.revision !== this.cache.revision) break;
          result = await this.guest.executeJavaScript<RestoreResult>(`window[${JSON.stringify(key)}]?.attempt() ?? {cancelled:true,done:false}`);
        }
      }
      this.initialized = true;
      await this.capture(true);
    } catch { this.initialized = true; }
    finally { this.initializing = false; this.releaseHelper(); }
  }

  async capture(touch = false): Promise<void> {
    if (!this.active || !this.enabled() || !this.initialized || this.sampling || this.revision !== this.cache.revision) return;
    this.sampling = true;
    try {
      const position = await this.snapshot();
      if (position && this.active && this.revision === this.cache.revision) this.cache.put(position, touch);
    } finally { this.sampling = false; }
  }

  private releaseHelper(): void {
    const key = this.key;
    this.key = null;
    if (key) void this.guest.executeJavaScript(`window[${JSON.stringify(key)}]?.release()`).catch(() => {});
  }

  stop(): void {
    this.active = false;
    window.clearInterval(this.timer);
    this.guest.removeEventListener('dom-ready', this.ready);
    this.releaseHelper();
  }
}
