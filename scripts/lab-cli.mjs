import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const vaultPath = fileURLToPath(new URL('../.lab/Peek Lab', import.meta.url));
await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
// Obsidian 1.13.7's local CLI transport. Avoid launching a second macOS app
// process per call: its dock.hide() suppresses painting in the test window.
// This is test tooling only and is not bundled into the plugin.
export async function cli(...args) {
  args = args.map(arg => arg.startsWith('code=') ? `code=if(app.vault.adapter.basePath!==${JSON.stringify(vaultPath)})throw Error('The test command requires this checkout’s Peek Lab vault');${arg.slice(5)}` : arg);
  const stdout = await new Promise((resolve, reject) => {
    const socket = createConnection(path.join(homedir(), '.obsidian-cli.sock'));
    let output = '';
    socket.setEncoding('utf8');
    socket.setTimeout(30000, () => socket.destroy(new Error('Obsidian CLI timeout')));
    socket.on('connect', () => socket.write(JSON.stringify({ argv: ['vault=Peek Lab', ...args], tty: false, cwd: process.cwd() }) + '\n'));
    socket.on('data', chunk => output += chunk);
    socket.on('end', () => resolve(output));
    socket.on('error', reject);
  });
  if (stdout.startsWith('Error:')) throw new Error(stdout);
  return stdout.trim();
}
export async function value(code) {
  const output = await cli('eval', `code=JSON.stringify(${code})`);
  return JSON.parse(output.replace(/^=> /, ''));
}
export async function job(code, timeout = 25000) {
  await cli('eval', `code=window.__peekLabJob={pending:true};Promise.resolve().then(async()=>{${code}}).then(value=>window.__peekLabJob={value},error=>window.__peekLabJob={error:String(error)});'started'`);
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const state = await value('window.__peekLabJob');
    if (state.error) throw new Error(state.error);
    if (!state.pending) return state.value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Lab operation timed out');
}
export async function waitValue(code, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await value(code);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Condition timed out: ${code}`);
}
