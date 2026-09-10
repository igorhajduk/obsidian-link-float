import type { TriggerModifier } from './links';

export interface Settings { modifier: TriggerModifier; rememberPosition: boolean }
export interface TargetGuard { tag: string; id: string; classes: string[]; text: string }
export interface HidingRule { id: string; origin: string; selector: string; guard: TargetGuard; created: number }
export interface PluginData { version: 1; settings: Settings; rules: HidingRule[] }
const defaults: Settings = { modifier: 'Shift', rememberPosition: true };

export function validRule(value: unknown): value is HidingRule {
  if (!value || typeof value !== 'object') return false;
  const r = value as HidingRule;
  try {
    const url = new URL(r.origin);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === r.origin &&
      typeof r.id === 'string' && /^[\w-]{1,80}$/.test(r.id) && typeof r.selector === 'string' && r.selector.length > 0 && r.selector.length <= 2048 &&
      Number.isFinite(r.created) && !!r.guard && typeof r.guard.tag === 'string' && /^[a-z][\w-]*$/.test(r.guard.tag) &&
      !['html', 'body', 'head', 'script', 'style'].includes(r.guard.tag) && typeof r.guard.id === 'string' && r.guard.id.length <= 256 &&
      Array.isArray(r.guard.classes) && r.guard.classes.length <= 10 && r.guard.classes.every(c => typeof c === 'string' && c.length <= 128) &&
      typeof r.guard.text === 'string' && r.guard.text.length <= 16;
  } catch { return false; }
}

export function parseData(value: unknown): PluginData {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (raw.version !== undefined && raw.version !== 1) throw new Error('Unsupported Link Float data version. Existing data was left intact.');
  const source = raw.settings && typeof raw.settings === 'object' ? raw.settings as Record<string, unknown> : raw;
  const settings = { ...defaults };
  if (['Shift', 'Alt', 'Control', 'Meta'].includes(String(source.modifier))) settings.modifier = source.modifier as TriggerModifier;
  if (typeof source.rememberPosition === 'boolean') settings.rememberPosition = source.rememberPosition;
  if (raw.rules !== undefined && !Array.isArray(raw.rules)) throw new Error('Invalid saved hiding rules. Existing data was left intact.');
  const rules = Array.isArray(raw.rules) ? raw.rules : [];
  if (rules.length > 500 || rules.some(r => !validRule(r)) || new Set(rules.map(r => (r as HidingRule).id)).size !== rules.length) {
    throw new Error('Invalid saved hiding rules. Existing data was left intact.');
  }
  return { version: 1, settings, rules: structuredClone(rules) as HidingRule[] };
}

/** All mutations use one serialized read/modify/write path, including settings. */
export class DataStore {
  data: PluginData;
  private pending: Promise<void> = Promise.resolve();
  constructor(saved: unknown, private write: (data: PluginData) => Promise<void>, private changed: () => void) { this.data = parseData(saved); }
  private update(change: (next: PluginData) => void): Promise<void> {
    const operation = this.pending.then(async () => {
      const next = structuredClone(this.data);
      change(next);
      parseData(next);
      await this.write(next);
      this.data = next;
      this.changed();
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
  settings(settings: Settings): Promise<void> { const copy = { ...settings }; return this.update(next => { next.settings = copy; }); }
  add(rule: HidingRule): Promise<void> { const copy = structuredClone(rule); return this.update(next => { next.rules.push(copy); }); }
  remove(id: string): Promise<void> { return this.update(next => { next.rules = next.rules.filter(rule => rule.id !== id); }); }
}
