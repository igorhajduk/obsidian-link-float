import { Modal, Notice, Platform, Plugin, PluginSettingTab, Setting, type SettingDefinitionItem, type WorkspaceLeaf } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { editorLink, hasWebViewer, leafElement } from './compatibility';
import { isClick, matchesModifier, webUrl, type TriggerModifier, type LinkOrigin } from './links';
import { Preview } from './preview';
import { PositionCache } from './positions';
import { DataStore } from './data';
import { WebPages } from './web-pages';

export default class LinkFloatPlugin extends Plugin {
  settings: { modifier: TriggerModifier; rememberPosition: boolean } = { modifier: 'Shift', rememberPosition: true };
  positions!: PositionCache;
  store!: DataStore;
  pages: WebPages | null = null;
  private current: Preview | null = null;
  private unloaded = false;
  private openIntent = 0;
  private settingsRevision = 0;
  private pendingClick: { url: string; source: WorkspaceLeaf; x: number; y: number; origin?: LinkOrigin } | null = null;

  async onload(): Promise<void> {
    const saved: unknown = await this.loadData();
    this.store = new DataStore(saved, data => this.saveData(data), () => this.pages?.update());
    this.settings = { ...this.store.data.settings };
    this.positions = new PositionCache(this.app);
    this.addSettingTab(new PreviewSettings(this));
    if (!Platform.isDesktopApp) return;

    // Layout snapshots omit a temporary preview; keeping it immediately restores normal persistence.
    const workspace = this.app.workspace;
    const descriptor = Object.getOwnPropertyDescriptor(workspace, 'getLayout');
    const originalGetLayout = workspace.getLayout.bind(workspace);
    let filtering = true;
    const getLayout = () => {
      const layout = originalGetLayout();
      return filtering && this.current ? this.current.savedLayout(layout) : layout;
    };
    workspace.getLayout = getLayout;
    this.register(() => {
      filtering = false;
      if (workspace.getLayout === getLayout) {
        if (descriptor) Object.defineProperty(workspace, 'getLayout', descriptor);
        else Reflect.deleteProperty(workspace, 'getLayout');
      }
    });

    this.pages = new WebPages(this.app, { store: this.store, modifier: () => this.settings.modifier, open: (url, leaf, origin) => { void this.openUrl(url, leaf, origin); } });
    this.register(() => this.pages?.stop());
    this.app.workspace.onLayoutReady(() => this.pages?.schedule());
    this.addCommand({ id: 'hide-page-element', name: 'Hide an element on this page', checkCallback: checking => {
      const leaf = this.current?.pageLeaf() ?? this.app.workspace.getMostRecentLeaf();
      if (!leaf || leaf.view.getViewType() !== 'webviewer') return false;
      if (!checking) this.pages?.pick(leaf); return true;
    } });
    this.addCommand({ id: 'manage-hidden-elements', name: 'Manage hidden elements', checkCallback: checking => {
      const leaf = this.current?.pageLeaf() ?? this.app.workspace.getMostRecentLeaf();
      if (!leaf || leaf.view.getViewType() !== 'webviewer') return false;
      if (!checking) this.pages?.manage(leaf); return true;
    } });

    this.addCommand({ id: 'open-url', name: 'Open URL in preview', callback: () => new UrlModal(this).open() });
    this.addCommand({ id: 'preview-link-at-cursor', name: 'Preview link at caret', editorCallback: (editor) => {
      const url = editorLink(editor, editor.getCursor());
      if (url) void this.openUrl(url); else new Notice('Place the caret on an external web link.');
    } });
    this.addCommand({ id: 'close-preview', name: 'Close preview', checkCallback: (checking) => {
      if (!this.current) return false; if (!checking) void this.current.close(); return true;
    } });
    this.addCommand({ id: 'keep-preview', name: 'Keep preview as tab', checkCallback: (checking) => {
      if (!this.current) return false; if (!checking) this.current.keep(); return true;
    } });

    this.registerDomEvent(document, 'mousedown', event => {
      this.pendingClick = null;
      const target = event.target as Element | null;
      if (target?.closest('.cm-editor')) return;
      const anchor = target?.closest<HTMLAnchorElement>('.markdown-preview-view a.external-link');
      const url = anchor && webUrl(anchor.getAttribute('href') || '');
      if (url) this.acceptDown(event, url);
    }, true);
    this.registerDomEvent(document, 'click', event => this.acceptClick(event), true);
    this.registerDomEvent(document, 'keydown', event => { if (event.key === 'Escape') this.pendingClick = null; }, true);

    this.registerEditorExtension(EditorView.domEventHandlers({
      mousedown: (event, view) => {
        const offset = view.posAtCoords({ x: event.clientX, y: event.clientY });
        const info = view.state.field(editorInfoField, false);
        if (offset === null || !info?.editor) return false;
        const line = view.state.doc.lineAt(offset);
        const url = editorLink(info.editor, { line: line.number - 1, ch: offset - line.from });
        return url ? this.acceptDown(event, url) : false;
      },
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => this.pages?.activeLeafChanged(leaf, this.current?.pageLeaf() ?? null)));
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      this.pages?.schedule();
      if (this.current && (!this.current.ownsSource() || !this.current.isAttached())) this.current.forceClose();
    }));
  }

  private acceptDown(event: MouseEvent, url: string): boolean {
    if (event.button !== 0 || event.defaultPrevented || !matchesModifier(event, this.settings.modifier)) return false;
    const source = this.app.workspace.getLeavesOfType('markdown').find(leaf =>
      event.target instanceof Node && leaf.view.containerEl.contains(event.target));
    if (!source || source.view.getViewType() !== 'markdown' || leafElement(source).ownerDocument !== document) return false;
    const target = event.target as Element | null;
    const rect = target?.closest('a, .cm-underline')?.getBoundingClientRect();
    const origin = rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : { x: event.clientX, y: event.clientY, width: 0, height: 0 };
    this.pendingClick = { url, source, x: event.clientX, y: event.clientY, origin };
    event.preventDefault(); event.stopImmediatePropagation();
    return true;
  }

  private acceptClick(event: MouseEvent): void {
    const pending = this.pendingClick;
    this.pendingClick = null;
    if (!pending) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.button === 0 && matchesModifier(event, this.settings.modifier) && isClick(pending, { x: event.clientX, y: event.clientY })) {
      void this.openUrl(pending.url, pending.source, pending.origin);
    }
  }

  async openUrl(value: string, source = this.app.workspace.getMostRecentLeaf(), origin?: LinkOrigin): Promise<void> {
    if (this.unloaded) return;
    const url = webUrl(value);
    if (!url) { new Notice('Enter a valid HTTP or HTTPS URL without embedded credentials.'); return; }
    if (source && this.current?.containsLeaf(source)) source = this.current.source;
    if (!source || leafElement(source).ownerDocument !== document) { new Notice('Open the preview from the main vault window.'); return; }
    if (!hasWebViewer(this.app)) {
      new MessageModal(this.app, 'Enable Web viewer', 'Enable Settings → Core plugins → Web viewer, then try this link again.').open(); return;
    }
    if (typeof leafElement(source).showPopover !== 'function') {
      new MessageModal(this.app, 'Unsupported browser runtime', 'Update the Obsidian desktop installer to enable web previews.').open(); return;
    }
    const intent = ++this.openIntent;
    if (this.current && !await this.current.close(false)) return;
    if (this.unloaded || intent !== this.openIntent) return;
    const preview = new Preview(this.app, source, url, () => { if (this.current === preview) this.current = null; }, {
      positions: this.positions,
      pick: leaf => this.pages?.pick(leaf),
      manage: leaf => this.pages?.manage(leaf),
      cancelPicker: leaf => this.pages?.cancel(leaf) ?? false,
      rememberPosition: () => this.settings.rememberPosition,
      userAction: () => { if (this.current === preview) this.openIntent++; },
    }, origin);
    this.current = preview;
    try { await preview.open(); }
    catch (error) {
      const report = !this.unloaded && this.current === preview;
      preview.forceClose();
      if (report) new MessageModal(this.app, 'Preview unavailable', String(error)).open();
    }
  }

  async saveSettings(): Promise<void> {
    const revision = ++this.settingsRevision;
    try {
      await this.store.settings(this.settings);
      if (revision === this.settingsRevision) { this.settings = { ...this.store.data.settings }; this.pages?.update(); }
    } catch {
      if (revision === this.settingsRevision) { this.settings = { ...this.store.data.settings }; this.pages?.update(); }
      new Notice('Could not save settings.');
    }
  }

  onunload(): void { this.unloaded = true; this.openIntent++; this.pendingClick = null; this.current?.forceClose(); }
}

class MessageModal extends Modal {
  constructor(app: Plugin['app'], private heading: string, private message: string) { super(app); }
  onOpen(): void { this.titleEl.setText(this.heading); this.contentEl.createEl('p', { text: this.message }); }
}

class UrlModal extends Modal {
  constructor(private plugin: LinkFloatPlugin) { super(plugin.app); }
  onOpen(): void {
    this.titleEl.setText('Preview a web link');
    let value = '';
    const submit = () => { if (!webUrl(value)) { new Notice('Enter an HTTP or HTTPS URL.'); return; } this.close(); void this.plugin.openUrl(value); };
    new Setting(this.contentEl).setName('URL').addText(text => {
      text.setPlaceholder('https://github.com').onChange(next => value = next);
      text.inputEl.addEventListener('keydown', event => { if (event.key === 'Enter') submit(); });
      text.inputEl.focus();
    });
    new Setting(this.contentEl).addButton(button => button.setButtonText('Open preview').setCta().onClick(submit));
  }
}

class PreviewSettings extends PluginSettingTab {
  constructor(private plugin: LinkFloatPlugin) { super(plugin.app, plugin); }
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: 'Click modifier', desc: 'Hold this key while clicking a web link.',
        render: setting => { setting.addDropdown(dropdown => {
          dropdown.addOptions({ Shift: 'Shift', Alt: 'Alt / Option', Control: 'Control', Meta: 'Command / Windows' })
            .setValue(this.plugin.settings.modifier).onChange(async value => {
              this.plugin.settings.modifier = value as TriggerModifier;
              await this.plugin.saveSettings();
            });
        }); },
      },
      {
        name: 'Remember reading position', desc: 'Resume the document scroll position when reopening a URL. Explicit section links take priority. Form values are not saved.',
        render: setting => { setting.addToggle(toggle => {
          toggle.setValue(this.plugin.settings.rememberPosition).onChange(async value => {
            this.plugin.settings.rememberPosition = value;
            await this.plugin.saveSettings();
          });
        }); },
      },
      {
        name: 'Saved reading positions', desc: 'Up to 100 URLs for 30 days, stored locally for this vault on this device.',
        render: setting => { setting.addButton(button => {
          button.setButtonText('Clear positions').onClick(() => {
            this.plugin.positions.clear();
            new Notice('Saved reading positions cleared.');
          });
        }); },
      },
      {
        name: 'Website sessions', desc: 'Sessions use this vault’s Web viewer storage. Closing a preview does not clear logins. Web viewer controls popup routing; some sign-in flows may not work.',
      },
    ];
  }
}
