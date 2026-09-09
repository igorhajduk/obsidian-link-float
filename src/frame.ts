/** Follow the central workspace, which excludes both visible sidebars. */
export class PreviewFrame {
  private readonly observer: ResizeObserver;
  private readonly viewport: Window;
  private readonly update = () => {
    const rect = this.workspace.getBoundingClientRect();
    let left = Math.max(0, Math.min(this.viewport.innerWidth, rect.left));
    let right = Math.min(this.viewport.innerWidth, Math.max(left, rect.right));
    // In a very narrow window, a dock can leave less than a usable page width.
    // Keep the preview and its controls usable without changing the dock state.
    if (right - left < 320) { left = 0; right = this.viewport.innerWidth; }
    const width = right - left;
    this.surface.style.setProperty('--peek-area-left', left + 'px');
    this.surface.style.setProperty('--peek-area-width', width + 'px');
    this.surface.classList.toggle('peek-narrow', width <= 600);
  };

  constructor(private surface: HTMLElement, private workspace: HTMLElement) {
    this.viewport = surface.ownerDocument.defaultView!;
    this.observer = new ResizeObserver(this.update);
    this.observer.observe(workspace);
    this.viewport.addEventListener('resize', this.update);
    this.update();
  }

  stop(): void {
    this.observer.disconnect();
    this.viewport.removeEventListener('resize', this.update);
    this.surface.style.removeProperty('--peek-area-left');
    this.surface.style.removeProperty('--peek-area-width');
    this.surface.classList.remove('peek-narrow');
  }
}
