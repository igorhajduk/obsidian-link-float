import assert from 'node:assert/strict';
import test from 'node:test';
import { PositionCache } from '../src/positions';

test('Position storage is bounded, expires, survives reload, and excludes fields and explicit anchors', () => {
  let saved: unknown = null;
  let now = 1_800_000_000_000;
  const storage = { loadLocalStorage: () => saved, saveLocalStorage: (_key: string, data: unknown) => { saved = structuredClone(data); } };
  const cache = new PositionCache(storage, () => now);
  for (let i = 0; i < 120; i++) { now++; cache.put({ url: `https://example.com/${i}`, x: 0, y: i * 100 }); }
  assert.equal(cache.size, 100);
  assert.equal(cache.get('https://example.com/0'), undefined);
  assert.equal(new PositionCache(storage, () => now).get('https://example.com/119')?.y, 11900);
  cache.put({ url: 'https://example.com/article#section', x: 0, y: 99 });
  assert.equal(cache.get('https://example.com/article#section'), undefined);
  cache.put({ url: 'https://example.com/119', x: 0, y: 0 });
  assert.equal(cache.get('https://example.com/119')?.y, 0);
  assert.deepEqual(Object.keys((saved as Record<string, unknown>[])[0]).sort(), ['updatedAt', 'url', 'x', 'y']);
  now += 31 * 24 * 60 * 60 * 1000;
  assert.equal(new PositionCache(storage, () => now).size, 0);
  assert.equal(saved, null, 'Expired entries are removed from persistent storage when loaded');
  cache.clear(); assert.equal(saved, null); assert.equal(cache.revision, 1);
});

test('Malformed, credential-bearing, and non-web bookmarks are ignored', () => {
  const now = Date.now();
  const storage = { loadLocalStorage: () => [null, { url: 'file:///tmp/a', x: 0, y: 2, updatedAt: now }, { url: 'https://user:secret@example.com/', x: 0, y: 2, updatedAt: now }, { url: 'https://example.com/', x: 0, y: -10, updatedAt: now }], saveLocalStorage: () => {} };
  assert.equal(new PositionCache(storage).size, 0);
});

test('Renaming preserves reading positions once and never overwrites the new cache or resurrects cleared data', () => {
  const oldKey = 'obsidian-link-preview:reading-positions:v1';
  const newKey = 'obsidian-link-float:reading-positions:v1';
  const position = { url: 'https://example.com/article', x: 0, y: 1234, updatedAt: Date.now() };
  const values = new Map<string, unknown>([[oldKey, [position]]]);
  const storage = { loadLocalStorage: (key: string) => values.get(key), saveLocalStorage: (key: string, data: unknown) => { values.set(key, structuredClone(data)); } };
  const migrated = new PositionCache(storage);
  assert.deepEqual(migrated.get(position.url), position);
  assert.deepEqual(values.get(newKey), [position]);
  assert.equal(values.get(oldKey), null);

  values.set(oldKey, [{ ...position, y: 99 }]);
  assert.equal(new PositionCache(storage).get(position.url)?.y, 1234, 'Existing Link Float positions win');
  migrated.clear();
  assert.equal(new PositionCache(storage).size, 0);
  assert.equal(values.get(oldKey), null);
});
