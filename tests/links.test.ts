import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isClick, matchesModifier, webUrl, previewsFile } from '../src/links';

test('only explicit HTTP(S) URLs cross the note-to-browser boundary', () => {
  for (const input of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'obsidian://open', '//example.com', 'https://user:password@example.com']) {
    assert.equal(webUrl(input), null, input);
  }
  assert.equal(webUrl('https://example.com/a?q=x#ref'), 'https://example.com/a?q=x#ref');
  assert.equal(webUrl('http://127.0.0.1:4179/'), 'http://127.0.0.1:4179/');
});

test('extra modifiers do not hijack existing Obsidian gestures', () => {
  for (let mask = 0; mask < 16; mask++) {
    const event = { shiftKey: !!(mask & 1), altKey: !!(mask & 2), ctrlKey: !!(mask & 4), metaKey: !!(mask & 8) };
    for (const [key, flag] of [['Shift', 1], ['Alt', 2], ['Control', 4], ['Meta', 8]] as const) {
      assert.equal(matchesModifier(event, key), mask === flag);
    }
  }
});

test('a drag must not open a preview', () => {
  assert.equal(isClick({ x: 10, y: 10 }, { x: 14, y: 14 }), true);
  assert.equal(isClick({ x: 10, y: 10 }, { x: 15, y: 10 }), false);
});
test('only other notes and PDFs open in a preview', () => {
  assert.equal(previewsFile({ path: 'Notes/Target.md', extension: 'md' }, 'Notes/Source.md'), true);
  assert.equal(previewsFile({ path: 'Papers/Paper.pdf', extension: 'pdf' }, 'Notes/Source.md'), true);
  assert.equal(previewsFile({ path: 'Notes/Source.md', extension: 'md' }, 'Notes/Source.md'), false);
  for (const extension of ['png', 'canvas', 'base', 'mp3']) assert.equal(previewsFile({ path: `File.${extension}`, extension }, 'Notes/Source.md'), false);
});
