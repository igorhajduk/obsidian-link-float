import { FileView, Modal, Notice, Platform, normalizePath, parseLinktext, Plugin, PluginSettingTab, Setting, type SettingDefinitionItem, type WorkspaceLeaf } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import { dismissPagePreviews, editorLink, hasWebViewer, leafElement } from './compatibility';
import { isClick, matchesModifier, previewsFile, webUrl, type NoteLink, type TriggerModifier, type LinkOrigin } from './links';
import { Preview, type PreviewTarget } from './preview';
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
  private pendingClick: { target: PreviewTarget; source: WorkspaceLeaf; x: number; y: number; origin?: LinkOrigin } | null = null;

  async onload(): Promise<void> {
    let saved: unknown = null, unreadable = false;
    try { saved = await this.loadData(); } catch { unreadable = true; }
    // Core reports unparseable JSON as missing data; tell that apart from a first run.
    if (saved == null && !unreadable) unreadable = await this.hasUnparseableData();
    this.store = new DataStore(saved, data => this.saveData(data), () => this.pages?.update());
    // A synced or hand-edited data.json must never stop the plugin from loading.
    if (unreadable) this.store.readOnly = 'Link Float could not read its data.json. Settings and hiding rules are read-only until the file is fixed or removed.';
    else if (this.store.damaged) await this.replaceDamagedData(saved);
    if (this.store.readOnly) new Notice(this.store.readOnly, 10000);
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
    this.addCommand({ id: 'preview-link-at-cursor', name: 'Preview link at caret', editorCallback: (editor, context) => {
      const link = editorLink(editor, editor.getCursor());
      const target = link && this.resolve(link, context.file?.path ?? '');
      if (target) void this.show(target); else new Notice('Place the caret on a web link or a link to another note or PDF.');
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
      const anchor = target?.closest<HTMLAnchorElement>('.markdown-preview-view a.external-link, .markdown-preview-view a.internal-link');
      if (!anchor) return;
      if (anchor.classList.contains('internal-link')) {
        const linktext = anchor.getAttribute('data-href');
        if (linktext) this.acceptDown(event, { kind: 'note', linktext });
      } else {
        const url = webUrl(anchor.getAttribute('href') || '');
        if (url) this.acceptDown(event, { kind: 'web', url });
      }
    }, true);
    this.registerDomEvent(document, 'click', event => this.acceptClick(event), true);
    this.registerDomEvent(document, 'keydown', event => { if (event.key === 'Escape') this.pendingClick = null; }, true);

    this.registerEditorExtension(EditorView.domEventHandlers({
      mousedown: (event, view) => {
        const offset = view.posAtCoords({ x: event.clientX, y: event.clientY });
        const info = view.state.field(editorInfoField, false);
        if (offset === null || !info?.editor) return false;
        const line = view.state.doc.lineAt(offset);
        const link = editorLink(info.editor, { line: line.number - 1, ch: offset - line.from });
        return link ? this.acceptDown(event, link) : false;
      },
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => this.pages?.activeLeafChanged(leaf, this.current?.pageLeaf() ?? null)));
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      this.pages?.schedule();
      if (this.current && (!this.current.ownsSource() || !this.current.isAttached())) this.current.forceClose();
    }));
  }

  private acceptDown(event: MouseEvent, link: NoteLink): boolean {
    if (event.button !== 0 || event.defaultPrevented || !matchesModifier(event, this.settings.modifier)) return false;
    const source = this.app.workspace.getLeavesOfType('markdown').find(leaf =>
      event.target instanceof Node && leaf.view.containerEl.contains(event.target));
    if (!source || source.view.getViewType() !== 'markdown' || leafElement(source).ownerDocument !== document) return false;
    // Links that do not resolve to another note or PDF keep their core behavior.
    const preview = this.resolve(link, source.view instanceof FileView ? source.view.file?.path ?? '' : '');
    if (!preview) return false;
    const target = event.target as Element | null;
    const rect = target?.closest('a, .cm-underline')?.getBoundingClientRect();
    const origin = rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : { x: event.clientX, y: event.clientY, width: 0, height: 0 };
    this.pendingClick = { target: preview, source, x: event.clientX, y: event.clientY, origin };
    event.preventDefault(); event.stopImmediatePropagation();
    if (preview.kind === 'file') dismissPagePreviews(source);
    return true;
  }

  private acceptClick(event: MouseEvent): void {
    const pending = this.pendingClick;
    this.pendingClick = null;
    if (!pending) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.button === 0 && matchesModifier(event, this.settings.modifier) && isClick(pending, { x: event.clientX, y: event.clientY })) {
      void this.show(pending.target, pending.source, pending.origin);
    }
  }

  /** Resolve note links the way core does, so headings, blocks, and PDF pages keep their native handling. */
  private resolve(link: NoteLink, sourcePath: string): PreviewTarget | null {
    if (link.kind === 'web') return { kind: 'web', url: link.url };
    const { path, subpath } = parseLinktext(link.linktext);
    const file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
    return file && previewsFile(file, sourcePath) ? { kind: 'file', file, subpath } : null;
  }

  async openUrl(value: string, source = this.app.workspace.getMostRecentLeaf(), origin?: LinkOrigin): Promise<void> {
    const url = webUrl(value);
    if (!url) { new Notice('Enter a valid HTTP or HTTPS URL without embedded credentials.'); return; }
    await this.show({ kind: 'web', url }, source, origin);
  }

  async show(target: PreviewTarget, source = this.app.workspace.getMostRecentLeaf(), origin?: LinkOrigin): Promise<void> {
    if (this.unloaded) return;
    if (source && this.current?.containsLeaf(source)) source = this.current.source;
    if (!source || leafElement(source).ownerDocument !== document) { new Notice('Open the preview from the main vault window.'); return; }
    if (target.kind === 'web' && !hasWebViewer(this.app)) {
      new MessageModal(this.app, 'Enable Web viewer', 'Enable Settings → Core plugins → Web viewer, then try this link again.').open(); return;
    }
    if (typeof leafElement(source).showPopover !== 'function') {
      new MessageModal(this.app, 'Unsupported browser runtime', 'Update the Obsidian desktop installer to enable web previews.').open(); return;
    }
    const intent = ++this.openIntent;
    if (this.current && !await this.current.close(false)) return;
    if (this.unloaded || intent !== this.openIntent) return;
    const preview = new Preview(this.app, source, target, () => { if (this.current === preview) this.current = null; }, {
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
      new Notice(this.store.readOnly ?? 'Could not save settings.');
    }
  }

  private dataPath(name: string): string {
    return normalizePath(`${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/${name}`);
  }

  private async hasUnparseableData(): Promise<boolean> {
    try {
      const path = this.dataPath('data.json');
      if (!await this.app.vault.adapter.exists(path)) return false;
      const text = await this.app.vault.adapter.read(path);
      if (!text.trim()) return false;
      JSON.parse(text);
      return false;
    } catch { return true; }
  }

  /** Copy the original data aside before the first write drops unreadable rules. */
  private async replaceDamagedData(saved: unknown): Promise<void> {
    const backup = this.dataPath(`data-backup-${Date.now()}.json`);
    try {
      await this.app.vault.adapter.write(backup, JSON.stringify(saved, null, 2));
      await this.store.save();
      new Notice(`Link Float removed saved hiding rules it could not read. The previous data was copied to ${backup}.`, 10000);
    } catch {
      this.store.readOnly = 'Link Float could not read some saved hiding rules or back them up. Settings and hiding rules are read-only for this session.';
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
        name: 'Click modifier', desc: 'Hold this key while clicking a web link or a link to another note or PDF.',
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
