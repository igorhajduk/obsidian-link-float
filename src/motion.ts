import { contentsFor, type Guest } from './compatibility';
import type { LinkOrigin } from './links';

// A damped spring sampled once, then interpolated by Chromium's compositor.
// Normalize the response to reach its resting position on the shared timeline.
const springEasing = (() => {
  const damping = .86, frequency = 35, duration = .28;
  const wave = Math.sqrt(1 - damping * damping);
  const response = (t: number) => 1 - Math.exp(-damping * frequency * t) *
    (Math.cos(frequency * wave * t) + damping / wave * Math.sin(frequency * wave * t));
  const end = response(duration);
  return 'linear(' + Array.from({ length: 121 }, (_, i) => (response(duration * i / 120) / end).toFixed(6)).join(',') + ')';
})();

/** Animate the existing leaf content; never move or recreate the guest. */
export class PreviewMotion {
  private static readonly duration = 280;
  private animations: Animation[] = [];
  private snapshot: HTMLCanvasElement | null = null;
  private cancelPreparation: (() => void) | null = null;
  private standIn: HTMLElement | null = null;
  private stopped = false;
  private generation = 0;
  private readonly page: HTMLElement;
  private readonly reduced: MediaQueryList;
  private readonly preferenceChanged = () => this.settle();

  /** `copyPage` decides, when motion starts, whether a static copy moves instead of the live page. */
  constructor(private surface: HTMLElement, private origin?: LinkOrigin, private copyPage: () => boolean = () => false) {
    this.page = surface.querySelector<HTMLElement>(':scope > .workspace-leaf-content')!;
    this.reduced = surface.ownerDocument.defaultView!.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced.addEventListener('change', this.preferenceChanged);
  }

  private collapsed(): string {
    const { offsetWidth: width, offsetHeight: height } = this.page;
    const frame = this.surface.getBoundingClientRect();
    const viewport = this.surface.ownerDocument.defaultView!;
    const origin = this.origin;
    if (!origin || !Object.values(origin).every(Number.isFinite)) return 'translate(0px, 0px) scale(.88, .88)';
    const x = Math.max(0, Math.min(viewport.innerWidth, origin.x + origin.width / 2));
    const y = Math.max(0, Math.min(viewport.innerHeight, origin.y + origin.height / 2));
    const sx = Math.min(.35, Math.max(24, origin.width) / Math.max(1, width));
    const sy = Math.min(.12, Math.max(12, origin.height) / Math.max(1, height));
    return `translate(${x - frame.left - width / 2}px, ${y - frame.top - height / 2}px) scale(${sx}, ${sy})`;
  }

  /** Keep the page hidden but untransformed, so core can measure while it scrolls to a link target. */
  hold(): void {
    if (!this.stopped && !this.reduced.matches) this.surface.dataset.peekMotion = 'preparing';
  }

  open(guest: Guest | null): void {
    if (this.stopped || this.reduced.matches) return;
    this.surface.dataset.peekMotion = 'preparing';
    this.makeStandIn();
    this.animate('normal');
    for (const animation of this.animations) animation.pause();
    // Attaching an Electron guest stalls the host renderer. Let that work and
    // its first paint finish before advancing the compositor animation clock.
    const viewport = this.surface.ownerDocument.defaultView!;
    let frame = 0, released = false;
    const cleanup = () => {
      guest?.removeEventListener('dom-ready', ready);
      window.clearTimeout(timeout);
      viewport.cancelAnimationFrame(frame);
      this.cancelPreparation = null;
    };
    const start = () => {
      cleanup();
      if (this.stopped || this.surface.dataset.peekMotion !== 'preparing') return;
      this.surface.dataset.peekMotion = 'opening';
      for (const animation of this.animations) animation.play();
    };
    const ready = () => {
      if (released) return;
      released = true;
      frame = viewport.requestAnimationFrame(() => {
        frame = viewport.requestAnimationFrame(() => { frame = viewport.requestAnimationFrame(start); });
      });
    };
    const timeout = window.setTimeout(ready, 120);
    this.cancelPreparation = cleanup;
    // Notes and PDFs render in the host; only their first paint needs to settle.
    if (guest) guest.addEventListener('dom-ready', ready, { once: true }); else ready();
    const page = this.animations[0];
    void page.finished.then(() => {
      if (this.animations[0] === page && this.surface.dataset.peekMotion === 'opening') this.settle();
    }, () => {});
  }

  /**
   * The editor measures its lines through CSS transforms and would scroll or misplace clicks
   * after scaling. Notes therefore move a static copy while the live view keeps its final geometry.
   */
  private makeStandIn(): void {
    this.removeStandIn();
    if (!this.copyPage()) return;
    const copy = this.page.cloneNode(true) as HTMLElement;
    copy.addClass('peek-stand-in');
    copy.setAttribute('aria-hidden', 'true');
    copy.inert = true;
    copy.setCssProps({ '--peek-stand-in-left': `${this.page.offsetLeft}px`, '--peek-stand-in-top': `${this.page.offsetTop}px`, '--peek-stand-in-width': `${this.page.offsetWidth}px`, '--peek-stand-in-height': `${this.page.offsetHeight}px` });
    this.surface.append(copy);
    // Cloning does not carry scroll offsets.
    const live = this.page.querySelectorAll('*'), copied = copy.querySelectorAll('*');
    live.forEach((el, i) => {
      if (el.scrollTop || el.scrollLeft) { copied[i].scrollTop = el.scrollTop; copied[i].scrollLeft = el.scrollLeft; }
    });
    this.standIn = copy;
    this.surface.dataset.peekStandIn = '';
  }

  private removeStandIn(): void {
    this.standIn?.remove();
    this.standIn = null;
    delete this.surface.dataset.peekStandIn;
  }

  /** Both directions use one timeline. Page pixels stay opaque while shrinking. */
  private animate(direction: PlaybackDirection): void {
    const timing = { duration: PreviewMotion.duration, fill: 'both' as FillMode, direction };
    const page = (this.standIn ?? this.page).animate([
      { transform: this.collapsed() },
      { transform: 'translate(0px, 0px) scale(1, 1)' },
    ], { ...timing, easing: springEasing });
    const backdrop = this.surface.animate([
      { opacity: 0, offset: 0, easing: 'ease-out' },
      { opacity: 1, offset: 180 / PreviewMotion.duration },
      { opacity: 1, offset: 1 },
    ], { ...timing, pseudoElement: '::backdrop' });
    this.animations = [page, backdrop];
  }

  /** A close probe can commit about:blank. Keep its previous pixels in RAM only. */
  async cover(guest: Guest): Promise<boolean> {
    if (this.stopped || this.reduced.matches) return false;
    const generation = this.generation;
    try {
      const contents = contentsFor(guest);
      if (!contents || contents.isDestroyed()) return false;
      const capture = await Promise.race([
        contents.capturePage(),
        new Promise<null>(resolve => window.setTimeout(() => resolve(null), 120)),
      ]);
      if (!capture || capture.isEmpty() || this.stopped || generation !== this.generation) return false;
      const { width, height } = capture.getSize();
      const bytes = capture.toBitmap();
      if (!width || !height || bytes.byteLength !== width * height * 4) return false;
      const pixels = new VideoFrame(bytes, { format: 'BGRA', codedWidth: width, codedHeight: height, timestamp: 0 });
      let expired = false, timeout: number | undefined;
      let bitmap: ImageBitmap | null;
      try {
        bitmap = await Promise.race([
          createImageBitmap(pixels).then(value => {
            if (expired) { value.close(); return null; }
            return value;
          }),
          new Promise<null>(resolve => { timeout = window.setTimeout(() => { expired = true; resolve(null); }, 120); }),
        ]);
      } finally { pixels.close(); window.clearTimeout(timeout); }
      if (!bitmap) return false;
      if (this.stopped || generation !== this.generation) { bitmap.close(); return false; }
      const image = this.page.createEl('canvas');
      image.className = 'peek-close-cover';
      image.setAttribute('aria-hidden', 'true');
      image.width = width;
      image.height = height;
      const context = image.getContext('bitmaprenderer');
      if (!context) { bitmap.close(); image.remove(); return false; }
      context.transferFromImageBitmap(bitmap);
      const frame = this.page.getBoundingClientRect(), rect = guest.getBoundingClientRect();
      const sx = frame.width / this.page.offsetWidth || 1, sy = frame.height / this.page.offsetHeight || 1;
      Object.assign(image.style, { left: `${(rect.left - frame.left) / sx}px`, top: `${(rect.top - frame.top) / sy}px`, width: `${rect.width / sx}px`, height: `${rect.height / sy}px` });
      this.uncover();
      this.snapshot = image;
      this.page.append(image);
      return true;
    } catch { return false; }
  }

  uncover(): void {
    if (this.snapshot) this.snapshot.width = this.snapshot.height = 0;
    this.snapshot?.remove();
    this.snapshot = null;
  }

  beginClose(): void {
    // A close request during preparation must not reveal a page while the
    // native guard is still checking whether that close is allowed.
    this.cancelPreparation?.();
  }

  async close(): Promise<void> {
    if (this.stopped || this.reduced.matches) return;
    this.cancelPreparation?.();
    if (this.surface.dataset.peekMotion === 'preparing') return;
    const opening = ['preparing', 'opening'].includes(this.surface.dataset.peekMotion ?? '') && this.animations.length > 0;
    this.surface.dataset.peekMotion = 'closing';
    if (opening) {
      // Reverse from the current frame instead of jumping to full size first.
      for (const animation of this.animations) animation.reverse();
    } else {
      this.cancelAnimations();
      this.makeStandIn();
      this.animate('reverse');
    }
    await Promise.race([
      this.animations[0].finished.catch(() => {}),
      new Promise(resolve => window.setTimeout(resolve, PreviewMotion.duration + 80)),
    ]);
  }

  private cancelAnimations(): void {
    for (const animation of this.animations) animation.cancel();
    this.animations = [];
  }

  settle(): void {
    this.cancelPreparation?.();
    this.cancelAnimations();
    this.removeStandIn();
    delete this.surface.dataset.peekMotion;
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    this.settle();
    this.uncover();
    this.reduced.removeEventListener('change', this.preferenceChanged);
  }
}
