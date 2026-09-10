import { getCssSelector } from 'css-selector-generator';
import type { HidingRule, TargetGuard } from './data';
import { isClick, matchesModifier, type TriggerModifier } from './links';

export interface PageConfig { key: string; token: string; marker: string; modifier: TriggerModifier; rules: HidingRule[] }

/** Runs only in an isolated guest world. No Obsidian or Node access. */
export function install(config: PageConfig): void {
  const host = window as unknown as Record<string, { release: () => void }>;
  host[config.key]?.release();
  const { marker, token } = config;
  const emit = (type: string, data: object = {}) => console.debug(token + JSON.stringify({ type, url: location.href, ...data }));
  const stop = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
  let released = false, picking = false, selected: Element | null = null, hovered: Element | null = null;
  let draft: { selector: string; guard: TargetGuard } | null = null;
  let down: { x: number; y: number; anchor: HTMLAnchorElement } | null = null;
  let timer: number | undefined;
  let picker = 0;
  let lastStatus = '';
  const marked = new Set<Element>();
  const stable = (value: string) => value.length <= 128 && !/\d{3}|[a-f\d]{8,}|^css-|^sc-/.test(value);
  const digest = (text: string) => {
    let hash = 2166136261;
    for (const char of text.replace(/\s+/g, ' ').trim().slice(0, 2048)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(16);
  };
  const guardFor = (el: Element): TargetGuard => {
    const id = stable(el.id) ? el.id : '';
    return { tag: el.localName, id, classes: Array.from(el.classList).filter(stable).slice(0, 10), text: id ? '' : digest(el.textContent ?? '') };
  };
  const accepts = (el: Element, guard: TargetGuard) => el.localName === guard.tag && (!guard.id || el.id === guard.id) &&
    guard.classes.every(name => el.classList.contains(name)) && (!guard.text || digest(el.textContent ?? '') === guard.text);
  const eligible = (el: Element | null): el is Element => !!el && el.getRootNode() === document &&
    !['html', 'body', 'head', 'script', 'style', 'link', 'meta'].includes(el.localName);
  const highlight = (el: Element | null) => {
    hovered = el?.isConnected ? el : null;
    const r = hovered?.getBoundingClientRect();
    emit('highlight', { picker, rect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null, viewport: { width: innerWidth, height: innerHeight } });
  };
  const reconcile = () => {
    if (released) return;
    observer.disconnect();
    const desired = new Set<Element>();
    const statuses: { id: string; state: string }[] = [];
    for (const rule of config.rules) {
      if (rule.origin !== location.origin) continue;
      let state = 'missing';
      try {
        const matches = document.querySelectorAll(rule.selector);
        if (matches.length > 1) state = 'ambiguous';
        else if (matches.length === 1) {
          const el = matches[0];
          if (eligible(el) && accepts(el, rule.guard)) { desired.add(el); state = 'hidden'; }
          else state = 'changed';
        }
      } catch { state = 'invalid'; }
      statuses.push({ id: rule.id, state });
    }
    if (draft && selected?.isConnected) desired.add(selected);
    // Frameworks can clone our marker along with a node. Reconcile those copies too.
    for (const el of Array.from(document.querySelectorAll(`[${marker}]`))) if (!desired.has(el)) el.removeAttribute(marker);
    for (const el of marked) if (!desired.has(el)) { el.removeAttribute(marker); marked.delete(el); }
    for (const el of desired) { el.setAttribute(marker, ''); marked.add(el); }
    if (config.rules.some(rule => rule.origin === location.origin) || picking) observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    const status = JSON.stringify(statuses);
    if (status !== lastStatus) { lastStatus = status; emit('status', { statuses }); }
    if (picking && hovered) highlight(hovered);
  };
  const observer = new MutationObserver(() => {
    if (timer === undefined) timer = window.setTimeout(() => { timer = undefined; reconcile(); }, 100);
  });
  const cancel = () => { picking = false; draft = null; selected = null; down = null; highlight(null); reconcile(); };
  const modifier = (e: MouseEvent) => matchesModifier(e, config.modifier);
  const anchorFor = (e: MouseEvent) => {
    const el = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!el || el.hasAttribute('download')) return null;
    try { const url = new URL(el.href); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? el : null; } catch { return null; }
  };
  const select = (el: Element | null) => {
    if (!picking || draft || !eligible(el)) return;
    try {
      const selector = getCssSelector(el, { selectors: ['id', 'class', 'tag'], ignoreGeneratedClassNames: true, maxCandidates: 40, maxCombinations: 100, includeTag: true, blacklist: [name => /\d{3}|[a-f\d]{8,}|^\.css-|^\.sc-/.test(name)] });
      const matches = document.querySelectorAll(selector);
      if (selector.length > 2048 || matches.length !== 1 || matches[0] !== el) throw new Error('The element cannot be selected reliably. Try its container.');
      selected = el; draft = { selector, guard: guardFor(el) }; highlight(null); reconcile();
      emit('selected', { draft });
    } catch { emit('error', { message: 'The element cannot be selected reliably. Try its container.' }); }
  };
  const mousedown = (event: MouseEvent) => {
    down = null;
    if (!event.isTrusted || event.button !== 0) return;
    if (picking) { stop(event); return; }
    const anchor = modifier(event) && anchorFor(event);
    if (anchor && !event.defaultPrevented) { down = { x: event.clientX, y: event.clientY, anchor }; stop(event); }
  };
  const click = (event: MouseEvent) => {
    if (!event.isTrusted || event.button !== 0) return;
    if (picking) { stop(event); return; }
    const pending = down; down = null;
    if (!pending) return;
    stop(event);
    if (!modifier(event) || !isClick(pending, { x: event.clientX, y: event.clientY }) || anchorFor(event) !== pending.anchor) return;
    const r = pending.anchor.getBoundingClientRect();
    emit('open', { href: pending.anchor.href, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, viewport: { width: innerWidth, height: innerHeight } });
  };
  const keydown = (e: KeyboardEvent) => { if (e.isTrusted && e.key === 'Escape') { down = null; if (picking) { stop(e); cancel(); emit('cancel'); } } };
  const dragstart = () => { down = null; };
  const reposition = () => { if (picking && hovered) highlight(hovered); };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  window.addEventListener('mousedown', mousedown, true);
  window.addEventListener('click', click, true);
  window.addEventListener('keydown', keydown, true);
  window.addEventListener('dragstart', dragstart, true);
  const api = {
    identity: token,
    update(rules: HidingRule[], modifier: TriggerModifier) { config.rules = rules; config.modifier = modifier; reconcile(); },
    pick(id: number) { cancel(); picker = id; picking = true; reconcile(); },
    hover(x: number, y: number, id: number) {
      if (!picking || draft || id !== picker) return;
      const el = document.elementFromPoint(x * innerWidth, y * innerHeight);
      highlight(eligible(el) ? el : null);
    },
    clearHover(id: number) { if (id === picker) highlight(null); },
    select(x: number, y: number) { select(document.elementFromPoint(x * innerWidth, y * innerHeight)); },
    scroll(x: number, y: number, dx: number, dy: number) {
      if (!picking) return;
      let el = document.elementFromPoint(x * innerWidth, y * innerHeight);
      while (el && el !== document.documentElement) {
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) { el.scrollBy(dx, dy); return; }
        el = el.parentElement;
      }
      window.scrollBy(dx, dy);
    },
    cancel,
    confirm() {
      if (!draft || !selected?.isConnected) return false;
      const matches = document.querySelectorAll(draft.selector);
      return matches.length === 1 && matches[0] === selected && accepts(selected, draft.guard);
    },
    release() {
      released = true; observer.disconnect(); window.clearTimeout(timer);
      for (const el of marked) el.removeAttribute(marker);
      for (const el of Array.from(document.querySelectorAll(`[${marker}]`))) el.removeAttribute(marker);
      window.removeEventListener('mousedown', mousedown, true);
      window.removeEventListener('click', click, true); window.removeEventListener('keydown', keydown, true); window.removeEventListener('dragstart', dragstart, true);
      window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition);
      delete host[config.key];
    },
  };
  host[config.key] = api;
  reconcile();
}
