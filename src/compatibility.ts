import type { App, Editor, EditorPosition, KeymapContext, Scope, WorkspaceLeaf } from 'obsidian';
import { webUrl } from './links';

// Private Obsidian integration is contained here. Verified on desktop 1.13.7.
export interface Guest extends HTMLElement {
  getWebContentsId(): number;
  getURL(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  focus(): void;
  executeJavaScript<T = unknown>(code: string, userGesture?: boolean): Promise<T>;
}

export interface GuestContents {
  isDestroyed(): boolean;
  capturePage(): Promise<{ isEmpty(): boolean; getSize(): { width: number; height: number }; toBitmap(): Uint8Array<ArrayBuffer> }>;
  loadURL(url: string): Promise<void>;
  stop(): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

export function contentsFor(guest: Guest): GuestContents | null {
  const host = guest.ownerDocument.defaultView as (Window & {
    electron?: { remote?: { webContents?: { fromId(id: number): GuestContents | undefined } } };
  }) | null;
  try { return host?.electron?.remote?.webContents?.fromId(guest.getWebContentsId()) ?? null; }
  catch { return null; }
}

export function hasWebViewer(app: App): boolean {
  return !!(app as App & { internalPlugins?: { getEnabledPluginById(id: string): unknown } })
    .internalPlugins?.getEnabledPluginById('webviewer');
}

export function guestFor(leaf: WorkspaceLeaf): Guest | null {
  const guest = leaf.view.containerEl.querySelector<Guest>('webview');
  return guest && typeof guest.getWebContentsId === 'function' ? guest : null;
}

export function editorLink(editor: Editor, position: EditorPosition): string | null {
  const token = (editor as Editor & {
    getClickableTokenAt?: (position: EditorPosition) => { type: string; text: string } | null;
  }).getClickableTokenAt?.(position);
  return token?.type === 'external-link' ? webUrl(token.text) : null;
}

export function hideTabHeader(leaf: WorkspaceLeaf): () => void {
  const header = (leaf as WorkspaceLeaf & { tabHeaderEl?: HTMLElement }).tabHeaderEl;
  header?.classList.add('peek-transient-tab');
  return () => header?.classList.remove('peek-transient-tab');
}

/** Keep the two preview leaves painted while core changes the selected tab. */
export function keepLeafVisible(leaf: WorkspaceLeaf): () => void {
  const el = leafElement(leaf);
  const descriptor = Object.getOwnPropertyDescriptor(el, 'toggle');
  const original = el.toggle.bind(el);
  let active = true;
  let requestedVisible = el.style.display !== 'none';
  const toggle = (visible: boolean): void => {
    if (active) {
      requestedVisible = visible;
      original(true);
    } else original(visible);
  };
  el.toggle = toggle;
  original(true);
  return () => {
    active = false;
    if (el.toggle === toggle) {
      if (descriptor) Object.defineProperty(el, 'toggle', descriptor);
      else Reflect.deleteProperty(el, 'toggle');
    }
    original(requestedVisible);
  };
}

/** The top-layer page uses its own layout; Keep restores core's leaf styles. */
export function preparePreviewLeaf(leaf: WorkspaceLeaf): () => void {
  const el = leafElement(leaf);
  const header = el.querySelector<HTMLElement>('.view-header');
  const hadLeafClass = el.classList.contains('workspace-leaf');
  const hadHeaderClass = header?.classList.contains('view-header-always-show') ?? false;
  el.classList.remove('workspace-leaf');
  header?.classList.remove('view-header-always-show');
  const releaseVisibility = keepLeafVisible(leaf);
  return () => {
    releaseVisibility();
    el.classList.toggle('workspace-leaf', hadLeafClass);
    header?.classList.toggle('view-header-always-show', hadHeaderClass);
  };
}

export function leafElement(leaf: WorkspaceLeaf): HTMLElement {
  return (leaf as WorkspaceLeaf & { containerEl: HTMLElement }).containerEl;
}

export function workspaceElement(app: App): HTMLElement {
  const el = (app.workspace.rootSplit as typeof app.workspace.rootSplit & { containerEl?: HTMLElement }).containerEl;
  if (!el) throw new Error('This Obsidian workspace does not expose its central content area.');
  return el;
}

export function leafId(leaf: WorkspaceLeaf): string {
  const id = (leaf as WorkspaceLeaf & { id?: string }).id;
  if (typeof id !== 'string') throw new Error('This Obsidian workspace does not expose stable leaf identifiers.');
  return id;
}

type SearchView = WorkspaceLeaf['view'] & {
  showSearch?: () => void;
  closeSearch?: () => void;
  searchContainerEl?: HTMLElement;
};

export function handlePageSearchKey(leaf: WorkspaceLeaf, event: KeyboardEvent, context: KeymapContext): boolean | undefined {
  const view = leaf.view as SearchView;
  if (!view.searchContainerEl?.querySelector('.document-search-container')) return;
  const scope: (Scope & { handleKey?: (event: KeyboardEvent, context: KeymapContext) => boolean | undefined }) | null = view.scope;
  return scope?.handleKey?.(event, context);
}

export function showPageSearch(leaf: WorkspaceLeaf): boolean {
  const view = leaf.view as SearchView;
  if (typeof view.showSearch !== 'function') return false;
  view.showSearch();
  return !!view.searchContainerEl?.querySelector('.document-search-container');
}

export function closePageSearch(leaf: WorkspaceLeaf): boolean {
  const view = leaf.view as SearchView;
  if (!view.searchContainerEl?.querySelector('.document-search-container') || typeof view.closeSearch !== 'function') return false;
  view.closeSearch();
  return true;
}

interface PageContents extends GuestContents {
  executeJavaScriptInIsolatedWorld<T>(worldId: number, scripts: { code: string }[]): Promise<T>;
  insertCSS(css: string, options: { cssOrigin: 'user' }): Promise<string>;
  removeInsertedCSS(key: string): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

/** The bridge is private; fail at this boundary when required methods disappear. */
export function pageBridge(guest: Guest): {
  run: <T = unknown>(code: string) => Promise<T>;
  style: (css: string) => Promise<string>;
  unstyle: (key: string) => Promise<void>;
  messages: (receive: (message: string) => void) => () => void;
} | null {
  const wc = contentsFor(guest) as PageContents | null;
  if (!wc || ['executeJavaScriptInIsolatedWorld', 'insertCSS', 'removeInsertedCSS', 'on'].some(name => typeof Reflect.get(wc, name) !== 'function')) return null;
  return {
    run: <T>(code: string) => wc.executeJavaScriptInIsolatedWorld<T>(18364, [{ code }]),
    style: css => wc.insertCSS(css, { cssOrigin: 'user' }),
    unstyle: key => wc.removeInsertedCSS(key),
    messages(receive) {
      const listener = (...args: unknown[]) => {
        // Electron 43's bridge uses the legacy event, level, message signature.
        if (typeof args[2] === 'string') receive(args[2]);
      };
      wc.on('console-message', listener);
      return () => { try { if (!wc.isDestroyed()) wc.removeListener('console-message', listener); } catch { /* Destroyed guest. */ } };
    },
  };
}
