import { contentsFor, type Guest } from './compatibility';

export type CloseCheck = 'allowed' | 'blocked' | 'unavailable';

/** Navigation runs native beforeunload without forcibly destroying an embedded guest. */
export class CloseGuard {
  private cancel: (() => void) | null = null;
  private generation = 0;

  async check(guest: Guest): Promise<CloseCheck> {
    const generation = this.generation;
    const contents = contentsFor(guest);
    if (!contents || contents.isDestroyed()) return 'allowed';
    const blank = () => { try { return guest.getURL() === 'about:blank' || !guest.getURL(); } catch { return false; } };
    if (blank()) return 'allowed';
    let activated: boolean | undefined;
    try {
      activated = await Promise.race([
        guest.executeJavaScript<boolean>('navigator.userActivation.hasBeenActive'),
        new Promise<undefined>(resolve => window.setTimeout(() => resolve(undefined), 200)),
      ]);
    } catch { /* Preserve a native prevention request when activation is unknown. */ }
    if (generation !== this.generation || contents.isDestroyed()) return 'allowed';
    return new Promise(resolve => {
      let settled = false;
      const finish = (result: CloseCheck) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        contents.removeListener('will-prevent-unload', blocked);
        contents.removeListener('destroyed', destroyed);
        contents.removeListener('did-navigate', navigated);
        this.cancel = null;
        resolve(result);
      };
      const blocked = () => finish(activated !== false ? 'blocked' : 'allowed');
      const destroyed = () => finish('allowed');
      const navigated = (_event: unknown, url: unknown) => { if (url === 'about:blank') finish('allowed'); };
      const timeout = window.setTimeout(() => {
        try { contents.stop(); } catch { /* Already gone. */ }
        finish(blank() ? 'allowed' : 'unavailable');
      }, 1800);
      this.cancel = () => {
        try { contents.stop(); } catch { /* Already gone. */ }
        finish('unavailable');
      };
      contents.once('will-prevent-unload', blocked);
      contents.once('destroyed', destroyed);
      contents.once('did-navigate', navigated);
      try {
        void contents.loadURL('about:blank').then(() => finish('allowed'), () => {
          // A blocked beforeunload aborts navigation; its event decides the outcome.
          window.setTimeout(() => finish(blank() ? 'allowed' : 'unavailable'), 50);
        });
      } catch { finish('unavailable'); }
    });
  }

  stop(): void { this.generation++; this.cancel?.(); }
}
