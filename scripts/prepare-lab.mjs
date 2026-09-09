import { mkdir, copyFile, writeFile, access, readFile } from 'node:fs/promises';
import path from 'node:path';

const vault = path.resolve('.lab/Peek Lab');
const plugin = path.join(vault, '.obsidian/plugins/link-float');
await mkdir(plugin, { recursive: true });
for (const name of ['main.js', 'styles.css', 'manifest.json']) await copyFile(`dist/${name}`, path.join(plugin, name));
async function initial(name, value) {
  const file = path.join(vault, name);
  try { await access(file); } catch { await writeFile(file, value); }
}
await initial('.obsidian/core-plugins.json', JSON.stringify({ 'file-explorer': true, 'command-palette': true, webviewer: true }));
await initial('.obsidian/community-plugins.json', JSON.stringify(['link-float']));
await initial('Welcome.md', '# Peek Lab\n\nHold **Shift** and click:\n\n- [GitHub](https://github.com)\n- [Google Docs](https://docs.google.com)\n- [Obsidian Help](https://help.obsidian.md)\n- [Session fixture](http://127.0.0.1:4179/)\n\nEditable link: [a reference](https://example.com)\n');
await initial('Preview checks.md', await readFile('tests/fixtures/Preview checks.md', 'utf8'));
console.log(`Prepared ${vault}`);
console.log('Open this folder as a vault and enable Web viewer and Link Float. Personal vaults are not modified.');
