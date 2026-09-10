import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
assert.equal(manifest.id, 'link-float');
assert.ok((await readFile('main.js', 'utf8')).includes((await readFile('LICENSE', 'utf8')).trim()), 'The bundle must retain its license notice.');
assert.ok((await readFile('main.js', 'utf8')).includes((await readFile('node_modules/css-selector-generator/LICENSE', 'utf8')).trim()), 'The bundle must retain the selector generator license notice.');
const directory = `dist/${manifest.id}`;
await mkdir(directory, { recursive: true });
const checksums = [];
for (const name of ['main.js', 'manifest.json', 'styles.css']) {
  await copyFile(name, `${directory}/${name}`);
  checksums.push(`${createHash('sha256').update(await readFile(name)).digest('hex')}  ${name}`);
}
await writeFile('dist/SHA256SUMS', checksums.join('\n') + '\n');
console.log(`Installable plugin: ${directory}`);
