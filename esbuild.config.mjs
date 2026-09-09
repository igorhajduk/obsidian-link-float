import { build } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';

await build({
  entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', target: 'es2022',
  external: ['obsidian', 'electron', '@codemirror/view', '@codemirror/state', '@codemirror/language'],
  outfile: 'main.js', sourcemap: false,
  banner: { js: '/*!\n' + (await readFile('LICENSE', 'utf8')).trim() + '\n*/' },
});
await mkdir('dist', { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css']) await copyFile(name, `dist/${name}`);
