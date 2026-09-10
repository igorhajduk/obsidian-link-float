import { build } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';

const page = await build({ entryPoints: ['src/page-runtime.ts'], bundle: true, format: 'iife', globalName: 'LinkFloatPage', target: 'es2022', write: false, minify: true });

await build({
  entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', target: 'es2022',
  external: ['obsidian', 'electron', '@codemirror/view', '@codemirror/state', '@codemirror/language'],
  outfile: 'main.js', sourcemap: false,
  define: { __LINK_FLOAT_PAGE__: JSON.stringify(page.outputFiles[0].text) },
  banner: { js: '/*!\n' + (await readFile('LICENSE', 'utf8')).trim() + '\n\nCSS Selector Generator 3.9.4\n' + (await readFile('node_modules/css-selector-generator/LICENSE', 'utf8')).trim() + '\n*/' },
});
await mkdir('dist', { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css']) await copyFile(name, `dist/${name}`);
