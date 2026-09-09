import assert from 'node:assert/strict';
import test from 'node:test';
import { withoutPreview } from '../src/layout';

test('Temporary page is absent from a snapshot while its source and unrelated tabs retain their state', () => {
  const layout = {
    main: { type: 'split', children: [{ type: 'tabs', currentTab: 1, children: [
      { type: 'leaf', id: 'note', state: { file: 'note.md', scroll: 123 } },
      { type: 'leaf', id: 'peek', state: { url: 'https://example.com' } },
      { type: 'leaf', id: 'web', state: { url: 'https://example.org' } },
    ] }] }, active: 'peek', 'left-ribbon': { hiddenItems: { canvas: true } },
  };
  const original = structuredClone(layout);
  const result = withoutPreview(layout, 'peek', 'note') as typeof layout;
  assert.deepEqual(layout, original);
  assert.deepEqual(result.main.children[0].children, [layout.main.children[0].children[0], layout.main.children[0].children[2]]);
  assert.equal(result.main.children[0].currentTab, 0);
  assert.equal(result.active, 'note');
  assert.deepEqual(result['left-ribbon'], layout['left-ribbon']);
  layout.main.children[0].currentTab = 2;
  layout.active = 'web';
  const otherActive = withoutPreview(layout, 'peek', 'note') as typeof layout;
  assert.equal(otherActive.main.children[0].currentTab, 1);
  assert.equal(otherActive.active, 'web');
});
