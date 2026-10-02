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

/** A link as written in a note, before it is resolved against the vault. */
export type NoteLink = { kind: 'web'; url: string } | { kind: 'note'; linktext: string };

/** Notes and PDFs open in a preview; other files and links back to the source keep core behavior. */
export function previewsFile(file: { path: string; extension: string }, sourcePath: string): boolean {
  return file.path !== sourcePath && ['md', 'pdf'].includes(file.extension);
}

export function isClick(start: { x: number; y: number }, end: { x: number; y: number }): boolean {
  return Math.abs(start.x - end.x) <= 4 && Math.abs(start.y - end.y) <= 4;
}
