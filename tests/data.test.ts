import test from 'node:test';
import assert from 'node:assert/strict';
import { DataStore, parseData, type HidingRule, type PluginData } from '../src/data';

const rule: HidingRule = { id: 'one', origin: 'https://example.com', selector: '#banner', guard: { tag: 'div', id: 'banner', classes: [], text: '' }, created: 1 };
test('legacy settings migrate without inventing rules', () => {
  assert.deepEqual(parseData({ modifier: 'Alt', rememberPosition: false }), { version: 1, settings: { modifier: 'Alt', rememberPosition: false }, rules: [] });
});
test('concurrent rule and settings writes preserve both namespaces', async () => {
  const writes: PluginData[] = [];
  let changed = 0;
  const store = new DataStore(null, async data => { await new Promise(resolve => setTimeout(resolve, 5)); writes.push(data); }, () => changed++);
  await Promise.all([store.add(rule), store.settings({ modifier: 'Meta', rememberPosition: false })]);
  assert.equal(writes.length, 2); assert.equal(changed, 2);
  const restored = parseData(writes[1]);
  assert.deepEqual(restored.rules, [rule]); assert.equal(restored.settings.modifier, 'Meta');
  await store.remove('one'); assert.equal(store.data.rules.length, 0);
});
test('failed saves leave confirmed state intact and the next write can recover', async () => {
  let fails = true, changes = 0;
  const store = new DataStore(null, async () => { if (fails) throw new Error('disk full'); }, () => changes++);
  await assert.rejects(store.add(rule)); assert.equal(store.data.rules.length, 0); assert.equal(changes, 0);
  fails = false; await store.add(rule); assert.deepEqual(store.data.rules, [rule]); assert.equal(changes, 1);
});
test('unknown versions and malformed persisted rules cannot be overwritten by settings', () => {
  assert.throws(() => parseData({ version: 2 }));
  assert.throws(() => parseData({ version: 1, rules: { one: rule } }));
  assert.throws(() => parseData({ version: 1, rules: null }));
  assert.throws(() => parseData({ rules: [{ ...rule, origin: 'https://example.com/path' }] }));
  assert.throws(() => parseData({ rules: [rule, rule] }));
});
