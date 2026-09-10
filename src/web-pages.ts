import { Notice, type App, type WorkspaceLeaf } from 'obsidian';
import { guestFor, leafElement, pageBridge, type Guest } from './compatibility';
import { type DataStore, type HidingRule, validRule } from './data';
import { isClick, webUrl, type LinkOrigin, type TriggerModifier } from './links';

declare const __LINK_FLOAT_PAGE__: string;
type Draft = Pick<HidingRule, 'selector' | 'guard'>;
interface PageOptions { store: DataStore; modifier: () => TriggerModifier; open: (url: string, leaf: WorkspaceLeaf, origin: LinkOrigin) => void }

/** Plugin lifetime, covering existing, restored, direct and kept core tabs. */
export class WebPages {
  private pages = new Map<Guest, PageController>();
  private observer: MutationObserver;
  private timer: number | null = null;
  private stopped = false;
  constructor(private app: App, private options: PageOptions) {
    this.observer = new MutationObserver(records => {
      if (records.some(record => [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some(node => node.instanceOf(Element) && (node.matches('webview, .workspace-leaf') || node.querySelector('webview'))))) this.schedule();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.scan();
  }
  schedule(): void { if (!this.stopped && this.timer === null) this.timer = window.setTimeout(() => { this.timer = null; this.scan(); }, 0); }
  private scan(): void {
    if (this.stopped) return;
    const live = new Set<Guest>();
    for (const leaf of this.app.workspace.getLeavesOfType('webviewer')) {
      if (leafElement(leaf).ownerDocument !== document) continue;
      const guest = guestFor(leaf);
      if (!guest) continue;
      live.add(guest);
      if (!this.pages.has(guest)) this.pages.set(guest, new PageController(leaf, guest, this.options));
    }
    for (const [guest, controller] of this.pages) if (!live.has(guest)) { controller.stop(); this.pages.delete(guest); }
  }
  update(): void { for (const page of this.pages.values()) page.update(); }
  activeLeafChanged(leaf: WorkspaceLeaf | null, preview: WorkspaceLeaf | null): void {
    for (const page of this.pages.values()) if (page.leaf !== leaf && page.leaf !== preview) page.cancel();
  }
  private closePanels(except: WorkspaceLeaf): void { for (const page of this.pages.values()) if (page.leaf !== except) page.cancel(); }
  pick(leaf: WorkspaceLeaf): void { this.scan(); this.closePanels(leaf); const page = this.pages.get(guestFor(leaf)!); if (page) void page.pick(); else new Notice('Open a web viewer page first.'); }
  manage(leaf?: WorkspaceLeaf): void {
    this.scan();
    if (leaf) this.closePanels(leaf);
    const target = leaf && this.pages.get(guestFor(leaf)!);
    if (target) target.manage(); else new Notice('Open a web viewer page to manage hidden elements.');
  }
  cancel(leaf: WorkspaceLeaf): boolean { return this.pages.get(guestFor(leaf)!)?.cancel() ?? false; }
  stop(): void { this.stopped = true; this.observer.disconnect(); if (this.timer !== null) window.clearTimeout(this.timer); for (const page of this.pages.values()) page.stop(); this.pages.clear(); }
}

class PageController {
  private bridge: ReturnType<typeof pageBridge> = null;
  private generation = 0;
  private active = true;
  private key = `__linkFloat_${crypto.randomUUID().replaceAll('-', '')}`;
  private marker = `data-link-float-${crypto.randomUUID().replaceAll('-', '')}`;
  private token = '';
  private css: string | null = null;
  private ready: Promise<void> = Promise.resolve();
  private installed = false;
  private listeners: (() => void)[] = [];
  private removeMessages: (() => void) | null = null;
  private panel: HTMLElement | null = null;
  private panelResize: ResizeObserver | null = null;
  private draft: Draft | null = null;
  private shield: HTMLElement | null = null;
  private releaseShield: (() => void) | null = null;
  private panelMode: 'pick' | 'manage' | null = null;
  private saving = false;
  private statuses = new Map<string, string>();
  constructor(readonly leaf: WorkspaceLeaf, private guest: Guest, private options: PageOptions) {
    const listen = (name: string, callback: EventListener) => { guest.addEventListener(name, callback); this.listeners.push(() => guest.removeEventListener(name, callback)); };
    // CSS keys are scoped to a document and may be reused after navigation.
    listen('did-navigate', () => { this.generation++; this.css = null; this.installed = false; this.cancel(); });
    listen('dom-ready', () => this.initialize());
    listen('did-start-navigation', event => { if ((event as Event & { isMainFrame?: boolean }).isMainFrame !== false) this.cancel(); });
    listen('did-navigate-in-page', event => { if ((event as Event & { isMainFrame?: boolean }).isMainFrame !== false) { this.cancel(); this.update(); } });
    listen('destroyed', () => this.stop());
    this.initialize();
  }
  private initialize(): void {
    const generation = ++this.generation;
    this.installed = false;
    this.cancel();
    this.ready = this.ready.catch(() => {}).then(async () => {
      if (!this.active || generation !== this.generation) return;
      this.removeMessages?.();
      this.bridge = pageBridge(this.guest);
      if (!this.bridge) return;
      const bridge = this.bridge;
      const sameDocument = await bridge.run<boolean>(`${this.runtime()} !== undefined`);
      if (sameDocument && this.css) await bridge.unstyle(this.css).catch(() => {});
      await bridge.run(`${this.runtime()}?.release()`);
      this.css = null;
      if (!this.active || generation !== this.generation) return;
      this.token = `link-float:${crypto.randomUUID()}:`;
      const token = this.token;
      this.removeMessages = bridge.messages(message => {
        if (this.active && generation === this.generation && message.startsWith(token) && message.length < 131072) {
          try { this.receive(JSON.parse(message.slice(token.length)) as Record<string, unknown>); } catch { /* Malformed guest output. */ }
        }
      });
      const css = await bridge.style(`[${this.marker}]{display:none!important}`);
      if (!this.active || generation !== this.generation) return;
      this.css = css;
      const config = { key: this.key, token, marker: this.marker, modifier: this.options.modifier(), rules: this.options.store.data.rules };
      await bridge.run(`${__LINK_FLOAT_PAGE__}\nLinkFloatPage.install(${JSON.stringify(config)})`);
      if (!this.active || generation !== this.generation) { await bridge.run(`${this.runtime()}?.release()`).catch(() => {}); return; }
      this.installed = true;
    }).catch(() => { this.installed = false; });
  }
  private receive(message: Record<string, unknown>): void {
    if (typeof message.url !== 'string' || message.url !== this.url()) return;
    if (message.type === 'selected' && this.panelMode === 'pick' && !this.saving) {
      const candidate = this.rule(message.draft as Draft);
      if (!validRule(candidate)) return;
      this.draft = message.draft as Draft;
      this.renderPicker();
    } else if (message.type === 'cancel') this.cancel();
    else if (message.type === 'error' && this.panelMode === 'pick') new Notice('The element cannot be selected reliably. Try its container.');
    else if (message.type === 'status' && Array.isArray(message.statuses)) {
      this.statuses = new Map((message.statuses as unknown[]).filter((s): s is { id: string; state: string } => !!s && typeof s === 'object' && 'id' in s && typeof s.id === 'string' && 'state' in s && typeof s.state === 'string').map(s => [s.id, s.state]));
      if (this.panelMode === 'manage') this.renderManager();
    } else if (message.type === 'open' && !this.panel && leafElement(this.leaf).isConnected) {
      const href = typeof message.href === 'string' && webUrl(message.href);
      const r = message.rect as LinkOrigin | undefined;
      const viewport = message.viewport as { width: number; height: number } | undefined;
      if (!href || !r || !viewport || ![r.x, r.y, r.width, r.height, viewport.width, viewport.height].every(Number.isFinite) || viewport.width <= 0 || viewport.height <= 0) return;
      if (leafElement(this.leaf).inert) return;
      const bounds = this.guest.getBoundingClientRect();
      const x = bounds.width / viewport.width, y = bounds.height / viewport.height;
      this.options.open(href, this.leaf, { x: bounds.x + r.x * x, y: bounds.y + r.y * y, width: r.width * x, height: r.height * y });
    }
  }
  private runtime(): string {
    const key = JSON.stringify(this.key), token = JSON.stringify(this.token);
    return `(window[${key}]?.identity === ${token} ? window[${key}] : undefined)`;
  }
  private url(): string { try { return this.guest.getURL(); } catch { return ''; } }
  private rule(draft: Draft): HidingRule {
    return { id: crypto.randomUUID(), origin: new URL(this.url()).origin, selector: draft?.selector, guard: draft?.guard, created: Date.now() };
  }
  update(): void {
    void this.ready.then(async () => {
      if (this.active && this.installed) await this.bridge?.run(`${this.runtime()}?.update(${JSON.stringify(this.options.store.data.rules)},${JSON.stringify(this.options.modifier())})`);
      if (this.panelMode === 'manage') this.renderManager();
    }).catch(() => {});
  }
  async pick(): Promise<void> {
    await this.ready;
    if (!this.active) return;
    if (!this.installed || !webUrl(this.url())) { new Notice('This web viewer page is not ready for hiding elements.'); return; }
    this.cancel(); this.panelMode = 'pick'; this.renderPicker();
    try { await this.bridge?.run(`${this.runtime()}?.pick()`); if (this.panelMode === 'pick') this.createShield(); }
    catch { this.cancel(); new Notice('Could not start element selection.'); }
  }
  private createShield(): void {
    const parent = leafElement(this.leaf);
    const shield = this.shield = parent.createDiv({ cls: 'peek-picker-shield', attr: { tabindex: '0', 'aria-label': 'Choose a page element; Escape cancels' } });
    const geometry = () => {
      const g = this.guest.getBoundingClientRect(), p = parent.getBoundingClientRect();
      const scale = p.width / parent.offsetWidth || 1;
      shield.setCssProps({ '--picker-left': `${(g.x - p.x) / scale}px`, '--picker-top': `${(g.y - p.y) / scale}px`, '--picker-width': `${g.width / scale}px`, '--picker-height': `${g.height / scale}px` });
    };
    const coordinates = (e: MouseEvent) => { const r = shield.getBoundingClientRect(); return [(e.clientX - r.x) / r.width, (e.clientY - r.y) / r.height]; };
    let hovering = false, down: { x: number; y: number } | null = null;
    const run = (method: string, args: number[]) => this.bridge?.run(`${this.runtime()}?.${method}(${args.join(',')})`).catch(() => {});
    shield.addEventListener('pointermove', event => {
      if (hovering || this.draft) return;
      hovering = true;
      void run('hover', coordinates(event))?.finally(() => { hovering = false; });
    });
    shield.addEventListener('pointerdown', event => { if (event.button === 0) { event.preventDefault(); down = { x: event.clientX, y: event.clientY }; } });
    shield.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      if (event.button === 0 && down && isClick(down, { x: event.clientX, y: event.clientY })) void run('select', coordinates(event));
      down = null;
    });
    shield.addEventListener('wheel', event => {
      event.preventDefault(); event.stopPropagation();
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? shield.clientHeight : 1;
      void run('scroll', [...coordinates(event), event.deltaX * factor, event.deltaY * factor]);
    }, { passive: false });
    shield.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancel(); } });
    const resize = new ResizeObserver(geometry);
    resize.observe(this.guest); resize.observe(parent); window.addEventListener('resize', geometry);
    this.releaseShield = () => { resize.disconnect(); window.removeEventListener('resize', geometry); };
    geometry(); shield.focus();
  }
  private makePanel(): HTMLElement {
    if (!this.panel) {
      this.panel = leafElement(this.leaf).createDiv({ cls: 'peek-picker', attr: { role: 'dialog', 'aria-label': 'Hidden page elements', popover: 'manual' } });
      this.panelResize = new ResizeObserver(() => this.positionPanel());
      this.panelResize.observe(this.guest);
      this.positionPanel(); this.panel.showPopover();
      this.panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.cancel(); } });
    }
    this.panel.empty();
    return this.panel;
  }
  private positionPanel(): void {
    const right = Math.max(16, window.innerWidth - this.guest.getBoundingClientRect().right + 16);
    this.panel?.setCssProps({ '--picker-panel-right': `${Math.min(right, Math.max(16, window.innerWidth - 406))}px` });
  }
  private button(panel: HTMLElement, text: string, action: () => void, primary = false): HTMLButtonElement {
    const button = panel.createEl('button', { text, cls: primary ? 'mod-cta' : '', attr: { type: 'button' } });
    button.addEventListener('click', action); return button;
  }
  private renderPicker(): void {
    if (this.panelMode !== 'pick') return;
    const panel = this.makePanel();
    panel.createEl('strong', { text: this.draft ? 'Hide this element on this website?' : 'Choose an element to hide' });
    panel.createEl('p', { text: this.draft ? 'The preview is temporary until you save. You can show it again from Hidden elements.' : 'Point at an element, then click. Press Escape to cancel.' });
    if (this.draft) {
      panel.createEl('p', { text: new URL(this.url()).origin });
      panel.createEl('code', { text: this.draft.selector });
    }
    const buttons = panel.createDiv({ cls: 'peek-picker-actions' });
    if (this.draft) {
      const save = this.button(buttons, 'Save', () => { void this.save(); }, true);
      save.disabled = this.saving;
      this.button(buttons, 'Choose another', () => { void this.pick(); }).disabled = this.saving;
      save.focus();
    }
    this.button(buttons, 'Cancel', () => this.cancel());
    this.button(buttons, 'Hidden elements', () => this.manage());
  }
  private async save(): Promise<void> {
    if (!this.draft || this.saving) return;
    const rule = this.rule(this.draft);
    const generation = this.generation;
    this.saving = true; this.renderPicker();
    try {
      const confirmed = await this.bridge?.run<boolean>(`${this.runtime()}?.confirm() ?? false`);
      if (!confirmed || generation !== this.generation || !this.active || this.panelMode !== 'pick') {
        new Notice('The page changed. Choose the element again before saving.');
        return;
      }
      await this.options.store.add(rule);
      if (this.active && generation === this.generation) { this.cancel(); new Notice('Element hidden. Use hidden elements to show it again.'); }
    } catch { if (this.active) new Notice('Could not save the hiding rule. Try again; the preview has not been saved.'); }
    finally { this.saving = false; if (this.panelMode === 'pick') this.renderPicker(); }
  }
  manage(): void { this.cancel(); this.panelMode = 'manage'; this.renderManager(); }
  private renderManager(): void {
    if (this.panelMode !== 'manage') return;
    const refocus = !this.panel || this.panel.contains(this.panel.ownerDocument.activeElement);
    const focusedId = this.panel?.querySelector<HTMLButtonElement>('button:focus')?.dataset.ruleId;
    const panel = this.makePanel();
    panel.createEl('strong', { text: 'Hidden elements' });
    panel.createEl('p', { text: 'Saved rules apply to the exact website address, including its subdomain and port. Show again removes a rule from every matching tab.' });
    const rules = this.options.store.data.rules;
    if (!rules.length) panel.createEl('p', { text: 'No saved hiding rules.' });
    const list = panel.createDiv({ cls: 'peek-rule-list' });
    for (const rule of [...rules].reverse()) {
      const row = list.createDiv({ cls: 'peek-rule-row' });
      row.createSpan({ text: rule.origin });
      row.createEl('code', { text: rule.selector });
      const labels: Record<string, string> = { hidden: 'Hidden on this page', missing: 'No match on this page', ambiguous: 'Paused: multiple matches', changed: 'Paused: element changed', invalid: 'Paused: invalid selector' };
      const state = this.statuses.get(rule.id);
      if (state) row.createEl('small', { text: labels[state] ?? 'Not applied' });
      const button = this.button(row, 'Show again', () => {
        button.disabled = true;
        void this.options.store.remove(rule.id).catch(() => { button.disabled = false; new Notice('Could not remove this rule. Try again.'); });
      });
      button.dataset.ruleId = rule.id;
    }
    const buttons = panel.createDiv({ cls: 'peek-picker-actions' });
    this.button(buttons, 'Hide another element', () => { void this.pick(); });
    const done = this.button(buttons, 'Done', () => this.cancel());
    if (refocus) (Array.from(list.querySelectorAll<HTMLButtonElement>('button')).find(button => button.dataset.ruleId === focusedId) ?? done).focus();
  }
  cancel(): boolean {
    const existed = !!this.panel;
    this.releaseShield?.(); this.releaseShield = null; this.shield?.remove(); this.shield = null;
    this.panelResize?.disconnect(); this.panelResize = null;
    this.panel?.remove(); this.panel = null; this.panelMode = null; this.draft = null;
    if (existed && this.installed) void this.bridge?.run(`${this.runtime()}?.cancel()`).catch(() => {});
    return existed;
  }
  stop(): void {
    if (!this.active) return;
    this.active = false; this.generation++;
    this.cancel(); this.removeMessages?.();
    for (const remove of this.listeners.splice(0)) remove();
    void this.ready.finally(async () => {
      const sameDocument = await this.bridge?.run<boolean>(`${this.runtime()} !== undefined`).catch(() => false);
      if (sameDocument && this.css) await this.bridge?.unstyle(this.css).catch(() => {});
      await this.bridge?.run(`${this.runtime()}?.release()`).catch(() => {});
    });
  }
}
