import { App, Scope, WorkspaceLeaf, setIcon } from 'obsidian';
import { guestFor, hideTabHeader, keepLeafVisible, preparePreviewLeaf, leafElement, leafId, workspaceElement, closePageSearch, showPageSearch, handlePageSearchKey, type Guest } from './compatibility';
import { withoutPreview } from './layout';
import { isClick, type LinkOrigin } from './links';
import { CloseGuard } from './close-guard';
import { ReadingPositionSession } from './reading';
import type { PositionCache } from './positions';
import { PreviewMotion } from './motion';
import { PreviewFrame } from './frame';

interface PreviewOptions {
  positions: PositionCache;
  rememberPosition: () => boolean;
  userAction: () => void;
}

/** A real core Web viewer leaf enters the CSS top layer without DOM reparenting. */
export class Preview {
  private closed = false;
  private leaf: WorkspaceLeaf | null = null;
  private guest: Guest | null = null;
  private scope: Scope | null = null;
  private chrome: HTMLElement | null = null;
  private releaseHeader: (() => void) | null = null;
  private releaseSourceVisibility: (() => void) | null = null;
  private releaseLeafPresentation: (() => void) | null = null;
  private listeners: (() => void)[] = [];
  private sourceState: unknown;
  private previousFocus: HTMLElement | null;
  private sourceWasInert: boolean;
  private sourceHadVisibilityClass: boolean;
  private locked = false;
  private closeButton: HTMLButtonElement | null = null;
  private status: HTMLElement | null = null;
  private optionsButton: HTMLButtonElement | null = null;
  private menu: HTMLElement | null = null;
  private statusTimer: number | null = null;
  private sourceView;
  private sourceFile: unknown;
  private reading: ReadingPositionSession | null = null;
  private guard = new CloseGuard();
  private closing: Promise<boolean> | null = null;
  private kept = false;
  private motion: PreviewMotion | null = null;
  private frame: PreviewFrame | null = null;
  private confirmation: { element: HTMLElement; resolve: (leave: boolean) => void } | null = null;

  constructor(private app: App, readonly source: WorkspaceLeaf, private url: string, private finished: () => void, private options: PreviewOptions, readonly origin?: LinkOrigin) {
    this.sourceState = source.getEphemeralState();
    this.sourceView = source.view;
    this.sourceFile = source.getViewState().state?.file;
    this.previousFocus = leafElement(source).ownerDocument.activeElement as HTMLElement | null;
    this.sourceWasInert = leafElement(source).inert;
    this.sourceHadVisibilityClass = leafElement(source).classList.contains('peek-source');
  }

  async open(): Promise<void> {
    if (this.closed) return;
    const workspace = this.app.workspace;
    workspace.setActiveLeaf(this.source, { focus: false });
    // Focusing controls activates the transient tab in core. Keep the note
    // painted underneath even while core marks that source tab as inactive.
    leafElement(this.source).classList.add('peek-source');
    this.releaseSourceVisibility = keepLeafVisible(this.source);
    const leaf = this.leaf = workspace.getLeaf('tab');
    this.releaseHeader = hideTabHeader(leaf);
    const el = leafElement(leaf);
    el.classList.add('peek-surface');
    el.setAttribute('popover', 'manual');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Web link preview');
    await leaf.setViewState({ type: 'webviewer', active: true, state: { url: this.url, navigate: true } });
    if (this.closed) { leaf.detach(); return; }
    await leaf.loadIfDeferred();
    if (this.closed) { leaf.detach(); return; }
    const guest = this.guest = guestFor(leaf);
    if (!guest) throw new Error('This Obsidian Web viewer cannot be hosted by Link Float.');
    this.releaseLeafPresentation = preparePreviewLeaf(leaf);

    // Guest navigation, popup routing, permissions, and cookies remain host-owned.
    this.buildChrome(el, guest);
    this.frame = new PreviewFrame(el, workspaceElement(this.app));
    leafElement(this.source).inert = true;
    el.showPopover();
    workspace.setActiveLeaf(this.source, { focus: false });
    leaf.onResize();
    this.motion = new PreviewMotion(el, this.origin);
    this.motion.open(guest);
    this.closeButton?.focus();
    this.reading = new ReadingPositionSession(guest, this.options.positions, this.options.rememberPosition, this.url);

    this.scope = new Scope(this.app.scope);
    this.scope.register([], 'Escape', (event) => {
      if (event.repeat || event.isComposing) return false;
      if (this.confirmation) { this.confirmation.resolve(false); return false; }
      if (this.menu) { this.closeOptions(); return false; }
      if (closePageSearch(leaf)) { this.closeButton?.focus(); return false; }
      const active = el.ownerDocument.activeElement;
      // The first Escape gives guest content its own dismissal opportunity.
      if (active === guest) {
        this.closeButton?.focus();
        this.setStatus('Press Escape again to close, or continue browsing.');
      } else if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') {
        this.closeButton?.focus();
      } else { void this.close(); }
      return false;
    });
    this.scope.register(['Mod'], 'w', () => { void this.close(); return false; });
    this.scope.register(['Mod'], 'f', () => {
      if (this.closing) return false;
      this.closeOptions(false);
      if (!showPageSearch(leaf)) this.setStatus('Find in page is unavailable in this Web viewer.');
      return false;
    });
    this.scope.register(null, null, (event, context) => {
      if (this.confirmation) {
        if (event.key === 'Tab') {
          const buttons = Array.from(this.confirmation.element.querySelectorAll<HTMLButtonElement>('button'));
          const index = buttons.indexOf(el.ownerDocument.activeElement as HTMLButtonElement);
          buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
          return false;
        }
        return;
      }
      return handlePageSearchKey(leaf, event, context);
    });
    this.app.keymap.pushScope(this.scope);
    workspace.requestSaveLayout();

    let backdropDown: { x: number; y: number } | null = null;
    const outside = (event: MouseEvent) => {
      if (event.target !== el && event.target instanceof Node && el.contains(event.target)) return false;
      const r = (el.querySelector<HTMLElement>(':scope > .workspace-leaf-content') ?? el).getBoundingClientRect();
      return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
    };
    this.listen(el.ownerDocument, 'mousedown', (event: Event) => {
      const mouse = event as MouseEvent;
      backdropDown = mouse.button === 0 && outside(mouse) ? { x: mouse.clientX, y: mouse.clientY } : null;
      if (this.menu && event.target instanceof Node && !this.menu.contains(event.target) && !this.optionsButton?.contains(event.target)) {
        this.closeOptions(false);
        if (backdropDown) { backdropDown = null; event.preventDefault(); event.stopImmediatePropagation(); return; }
      }
      if (backdropDown) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    this.listen(el.ownerDocument, 'click', (event: Event) => {
      if (!outside(event as MouseEvent)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const mouse = event as MouseEvent;
      if (backdropDown && !this.locked && isClick(backdropDown, { x: mouse.clientX, y: mouse.clientY })) void this.close();
      backdropDown = null;
    }, true);
  }

  private buildChrome(el: HTMLElement, guest: Guest): void {
    const chrome = this.chrome = el.createDiv();
    chrome.className = 'peek-controls';
    chrome.setAttribute('role', 'group');
    chrome.setAttribute('aria-label', 'Preview controls');
    const button = (icon: string, label: string, action: () => void) => {
      const b = chrome.createEl('button', { cls: 'peek-control', attr: { type: 'button', 'aria-label': label, title: label } });
      setIcon(b, icon); b.addEventListener('click', action); return b;
    };
    this.closeButton = button('x', 'Close preview', () => { void this.close(); });
    button('maximize-2', 'Keep as Obsidian tab', () => this.keep());
    this.optionsButton = button('ellipsis', 'Preview options', () => this.menu ? this.closeOptions() : this.openOptions());
    this.optionsButton.setAttribute('aria-haspopup', 'menu');
    this.optionsButton.setAttribute('aria-expanded', 'false');
    this.status = el.createDiv();
    this.status.className = 'peek-status';
    this.status.setAttribute('role', 'status');
    el.prepend(chrome);
    el.append(this.status);
    this.listen(guest, 'focus', () => { this.closeOptions(false); this.setStatus(''); });
    this.listen(guest, 'did-start-loading', () => this.setStatus('Loading…', false));
    for (const name of ['dom-ready', 'did-stop-loading']) this.listen(guest, name, () => this.setStatus(''));
    this.listen(guest, 'did-start-navigation', () => this.closeOptions(false));
  }

  private openOptions(): void {
    if (this.closed || !this.chrome || !this.guest) return;
    const menu = this.menu = this.chrome.createDiv({ cls: 'peek-menu', attr: { role: 'menu', 'aria-label': 'Preview options' } });
    this.optionsButton?.setAttribute('aria-expanded', 'true');
    const guest = this.guest;
    const currentUrl = this.currentUrl();
    menu.createDiv({ cls: 'peek-menu-url', text: currentUrl, attr: { title: currentUrl, role: 'presentation' } });
    const item = (icon: string, label: string, action: () => void, disabled = false) => {
      const button = menu.createEl('button', { cls: 'peek-menu-item', attr: { type: 'button', role: 'menuitem', tabindex: '-1' } });
      setIcon(button.createSpan({ cls: 'peek-menu-icon' }), icon);
      button.createSpan({ text: label });
      button.disabled = disabled;
      button.addEventListener('click', () => {
        this.closeOptions();
        try { action(); } catch { this.setStatus('This page is still loading. Try again shortly.'); }
      });
      return button;
    };
    let back = false, forward = false;
    try { back = guest.canGoBack(); forward = guest.canGoForward(); } catch { /* Guest is attaching. */ }
    item('arrow-left', 'Back', () => guest.goBack(), !back);
    item('arrow-right', 'Forward', () => guest.goForward(), !forward);
    item('rotate-cw', 'Reload page', () => guest.reload());
    item('copy', 'Copy page address', () => { void this.copyAddress(); });
    menu.createDiv({ cls: 'peek-menu-separator', attr: { role: 'separator' } });
    const pin = item('pin', 'Keep open on outside click', () => {
      this.locked = !this.locked;
      this.optionsButton?.classList.toggle('is-pinned', this.locked);
      this.setStatus(this.locked ? 'Preview pinned. Outside clicks will keep it open.' : 'Preview unpinned.');
    });
    pin.setAttribute('role', 'menuitemcheckbox');
    pin.setAttribute('aria-checked', String(this.locked));
    const items = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    menu.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab', 'Escape'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape' || event.key === 'Tab') { this.closeOptions(); return; }
      const buttons = items();
      const at = buttons.indexOf(menu.ownerDocument.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    });
    items()[0]?.focus();
  }

  private closeOptions(focus = true): void {
    if (!this.menu) return;
    this.menu.remove(); this.menu = null;
    this.optionsButton?.setAttribute('aria-expanded', 'false');
    if (focus) this.optionsButton?.focus();
  }

  private currentUrl(): string {
    try { return this.guest?.getURL() || this.url; } catch { return this.url; }
  }

  private async copyAddress(): Promise<void> {
    try {
      await leafElement(this.source).ownerDocument.defaultView!.navigator.clipboard.writeText(this.currentUrl());
      this.setStatus('Page address copied.');
    } catch { this.setStatus('Could not copy the page address.'); }
  }

  private setStatus(value: string, transient = true): void {
    if (this.statusTimer) window.clearTimeout(this.statusTimer);
    this.statusTimer = null;
    if (this.closed || !this.status) return;
    this.status.textContent = value;
    if (value && transient) this.statusTimer = window.setTimeout(() => this.setStatus(''), 3500);
  }

  private listen(target: EventTarget, type: string, callback: EventListener, capture = false): void {
    target.addEventListener(type, callback, capture);
    this.listeners.push(() => target.removeEventListener(type, callback, capture));
  }

  ownsSource(): boolean {
    return leafElement(this.source).isConnected && this.source.view === this.sourceView && this.source.getViewState().state?.file === this.sourceFile;
  }
  containsLeaf(leaf: WorkspaceLeaf): boolean { return this.leaf === leaf; }
  isAttached(): boolean { return !this.leaf || leafElement(this.leaf).isConnected; }
  savedLayout(layout: Record<string, unknown>): Record<string, unknown> {
    return this.leaf && !this.closed ? withoutPreview(layout, leafId(this.leaf), leafId(this.source)) : layout;
  }

  keep(): void {
    if (this.closed || this.closing || !this.leaf || !this.guest) return;
    this.options.userAction();
    this.kept = true;
    const leaf = this.leaf;
    this.disposeShell();
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    leaf.onResize();
    this.app.workspace.requestSaveLayout();
  }

  close(userAction = true): Promise<boolean> {
    if (this.closed) return Promise.resolve(!this.kept);
    if (userAction) this.options.userAction();
    if (this.closing) return this.closing;
    if (!this.guest) { this.finishClose(); return Promise.resolve(true); }
    this.closeOptions(false);
    this.motion?.beginClose();
    this.setClosing(true);
    const closing = this.checkClose().finally(() => {
      if (this.closing === closing) this.closing = null;
      if (!this.closed) this.setClosing(false);
    });
    this.closing = closing;
    return closing;
  }

  private async checkClose(): Promise<boolean> {
    const [covered] = await Promise.all([
      this.motion?.cover(this.guest!),
      Promise.race([this.reading?.capture(), new Promise(resolve => window.setTimeout(resolve, 180))]),
    ]);
    if (this.closed || !this.guest) return !this.kept;
    const result = await this.guard.check(this.guest);
    if (this.closed) return !this.kept;
    if (result !== 'allowed') {
      this.motion?.uncover();
      this.motion?.settle();
      if (!await this.confirmLeave(result === 'blocked')) return false;
    }
    // Without a captured frame, dispose an allowed blank probe immediately.
    if (!this.closed && (covered || result !== 'allowed')) await this.motion?.close();
    if (!this.closed) this.finishClose();
    return !this.kept;
  }

  private confirmLeave(siteRequested: boolean): Promise<boolean> {
    const guest = this.guest!;
    const previous = guest.ownerDocument.activeElement as HTMLElement | null;
    const wasBlocked = guest.classList.contains('peek-guest-blocked');
    guest.classList.add('peek-guest-blocked');
    const layer = leafElement(this.leaf!).createDiv({ cls: 'peek-confirmation' });
    const card = layer.createDiv({ cls: 'peek-confirmation-card', attr: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'peek-confirmation-title', 'aria-describedby': 'peek-confirmation-description' } });
    card.createEl('h2', { text: siteRequested ? 'Leave this page?' : 'Close this preview?', attr: { id: 'peek-confirmation-title' } });
    card.createEl('p', { text: siteRequested ? 'Changes you made may not be saved.' : 'The page did not respond to the close request.', attr: { id: 'peek-confirmation-description' } });
    const buttons = card.createDiv({ cls: 'peek-confirmation-buttons' });
    return new Promise(resolve => {
      const finish = (leave: boolean) => {
        if (this.confirmation?.element !== layer) return;
        this.confirmation = null;
        layer.remove();
        guest.classList.toggle('peek-guest-blocked', wasBlocked);
        if (!leave && previous?.isConnected) previous.focus({ preventScroll: true });
        resolve(leave);
      };
      this.confirmation = { element: layer, resolve: finish };
      const cancel = buttons.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
      const leave = buttons.createEl('button', { text: 'Leave', cls: 'mod-warning', attr: { type: 'button' } });
      cancel.addEventListener('click', () => finish(false));
      leave.addEventListener('click', () => finish(true));
      cancel.focus();
    });
  }

  private setClosing(value: boolean): void {
    this.chrome?.querySelectorAll<HTMLButtonElement>(':scope > button').forEach(button => { button.disabled = value; });
  }

  forceClose(): void {
    if (this.closed) return;
    this.options.userAction();
    this.guard.stop();
    this.confirmation?.resolve(false);
    this.finishClose();
  }

  private finishClose(): void {
    if (this.closed) return;
    const leaf = this.leaf;
    this.disposeShell();
    leaf?.detach();
    if (this.ownsSource()) {
      this.app.workspace.setActiveLeaf(this.source, { focus: false });
      this.source.setEphemeralState(this.sourceState);
      if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
    }
  }

  private disposeShell(): void {
    this.closed = true;
    this.motion?.stop();
    this.motion = null;
    this.frame?.stop();
    this.frame = null;
    this.reading?.stop();
    this.reading = null;
    this.guard.stop();
    this.confirmation?.resolve(false);
    this.closeOptions(false);
    if (this.statusTimer) window.clearTimeout(this.statusTimer);
    for (const remove of this.listeners.splice(0)) remove();
    if (this.scope) this.app.keymap.popScope(this.scope);
    this.scope = null;
    leafElement(this.source).inert = this.sourceWasInert;
    leafElement(this.source).classList.toggle('peek-source', this.sourceHadVisibilityClass);
    const el = this.leaf ? leafElement(this.leaf) : null;
    if (el?.matches(':popover-open')) el.hidePopover();
    el?.classList.remove('peek-surface');
    for (const attr of ['popover', 'role', 'aria-label']) el?.removeAttribute(attr);
    this.chrome?.remove(); this.status?.remove(); this.releaseHeader?.();
    this.releaseLeafPresentation?.();
    this.releaseLeafPresentation = null;
    this.releaseSourceVisibility?.();
    this.releaseSourceVisibility = null;
    this.finished();
    this.app.workspace.requestSaveLayout();
  }
}
