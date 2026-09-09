export type TriggerModifier = 'Shift' | 'Alt' | 'Control' | 'Meta';

export interface LinkOrigin { x: number; y: number; width: number; height: number }

export function matchesModifier(event: Pick<MouseEvent, 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>, modifier: TriggerModifier): boolean {
  return event.shiftKey === (modifier === 'Shift') && event.altKey === (modifier === 'Alt') &&
    event.ctrlKey === (modifier === 'Control') && event.metaKey === (modifier === 'Meta');
}

export function webUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function isClick(start: { x: number; y: number }, end: { x: number; y: number }): boolean {
  return Math.abs(start.x - end.x) <= 4 && Math.abs(start.y - end.y) <= 4;
}
