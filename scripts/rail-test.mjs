import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { cli, job, value, waitValue } from './lab-cli.mjs';

const results = [];
const check = (name, detail) => { results.push({ name, result: 'pass', detail }); console.log('PASS', name, detail ?? ''); };
const frame = "document.querySelector('.peek-surface')";
const guest = `${frame}?.querySelector('webview')`;
const options = '.peek-controls [aria-label="Preview options"]';
const closeButton = '.peek-controls [aria-label="Close preview"]';
async function close() { await job("await app.plugins.plugins['link-float'].current?.close();return true;"); }
async function open() {
  await job(`await app.plugins.plugins['link-float'].openUrl('http://127.0.0.1:4179/',window.railSource);return true;`);
  await job(`const w=${guest};for(let i=0;i<100;i++){try{if(await w.executeJavaScript('!!window.fixtureReady'))return true;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Fixture unavailable');`);
}
async function click(selector, label) {
  await job(`electron.remote.getCurrentWindow().show();electron.remote.getCurrentWindow().focus();return true;`);
  const target = label ? `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent===${JSON.stringify(label)})` : `document.querySelector(${JSON.stringify(selector)})`;
  await waitValue(`!!(${target})`);
  await job(`const el=${target};const r=el.getBoundingClientRect();const wc=electron.remote.getCurrentWebContents();const event={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:'left',clickCount:1};wc.sendInputEvent({...event,type:'mouseDown'});wc.sendInputEvent({...event,type:'mouseUp'});return true;`);
}
async function backdrop() {
  await job(`const r=${frame}.getBoundingClientRect();const wc=electron.remote.getCurrentWebContents();const event={x:Math.max(2,Math.round(r.left-6)),y:Math.round(r.top+180),button:'left',clickCount:1};wc.sendInputEvent({...event,type:'mouseDown'});wc.sendInputEvent({...event,type:'mouseUp'});return true;`);
}
async function escape() {
  await job(`const wc=electron.remote.getCurrentWebContents();wc.sendInputEvent({type:'keyDown',keyCode:'Escape'});wc.sendInputEvent({type:'keyUp',keyCode:'Escape'});return true;`);
}
async function geometry() {
  await waitValue(`!${frame}.dataset.peekMotion`);
  return value(`(()=>{const frame=${frame};const page=${guest}.getBoundingClientRect();const f=frame.getBoundingClientRect();const buttons=[...frame.querySelectorAll('.peek-controls > button')];return {frame:f.toJSON(),page:page.toJSON(),viewport:{width:innerWidth,height:innerHeight},workspace:app.workspace.rootSplit.containerEl.getBoundingClientRect().toJSON(),header:getComputedStyle(frame.querySelector('.view-header')).display,oldToolbar:!!frame.querySelector('.peek-toolbar'),buttons:buttons.map(b=>{const r=b.getBoundingClientRect();return {rect:r.toJSON(),label:b.getAttribute('aria-label'),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b}})}})()`);
}
function assertGeometry(g) {
  assert.equal(g.header, 'none'); assert.equal(g.oldToolbar, false);
  assert.ok(Math.abs(g.page.top - g.frame.top) <= 2, 'Page starts at the top edge');
  assert.ok(Math.abs((g.frame.left-(g.workspace.width<320?0:g.workspace.left)) - ((g.workspace.width<320?g.viewport.width:g.workspace.right)-g.frame.right)) < 1, 'Page is centered in the central workspace');
  assert.ok(Math.abs(g.frame.top - (g.viewport.height - g.frame.bottom)) < 1, 'Vertical margins are balanced');
  assert.ok(g.frame.top <= Math.max(10, g.viewport.height * 0.012) + 1, 'Page reaches near the window edges vertically');
  if (g.workspace.width > 600) assert.ok(Math.abs(g.frame.width / g.workspace.width - 0.8) < 0.01, 'Page occupies about 80 percent of the available workspace');
  assert.equal(g.buttons.length, 4);
  for (const b of g.buttons) {
    assert.ok(b.rect.left > g.frame.right, `${b.label} is outside the page`);
    assert.ok(b.rect.right <= g.viewport.width, `${b.label} fits the viewport`);
    assert.equal(b.hit, true, `${b.label} is actually hit-testable, not clipped`);
    assert.ok(Math.abs(b.rect.width - b.rect.height) < 1, `${b.label} is square before rounding`);
  }
}

let originalBounds, originalTheme;
try {
  await close();
  originalBounds = await value('electron.remote.getCurrentWindow().getBounds()');
  originalTheme = await value("document.body.classList.contains('theme-dark') ? 'dark' : 'light'");
  await job(`window.railSource=app.workspace.getLeavesOfType('markdown')[0];app.workspace.setActiveLeaf(railSource);electron.remote.getCurrentWindow().show();electron.remote.getCurrentWindow().focus();return true;`);
  await open();
  const normal = await geometry(); assertGeometry(normal);
  check('Webpage fills the frame; four external round controls are visible and hit-testable', { viewport: normal.viewport });
  const identity = await value(`${guest}.getWebContentsId()`);
  await click(options);
  assert.equal(await value("!!document.querySelector('.peek-menu')"), true);
  assert.equal(await value(`${guest}.getWebContentsId()`), identity);
  check('Clicking the outside options button opens its menu without dismissing or remounting the page');
  await escape();
  assert.equal(await value("!!document.querySelector('.peek-menu')"), false);
  assert.equal(await value(`!!${frame}`), true);
  check('Escape dismisses the options menu before the preview');

  await click(options);
  await click('.peek-menu-item', 'Keep open on outside click');
  await backdrop();
  assert.equal(await value(`!!${frame}`), true);
  check('Pinning from the menu protects against outside-click dismissal');
  await click(options);
  assert.equal(await value("document.querySelector('.peek-menu [role=menuitemcheckbox]').getAttribute('aria-checked')"), 'true');
  await click('.peek-menu-item', 'Keep open on outside click');
  await backdrop();
  await waitValue(`!${frame}`);
  assert.equal(await value(`!!${frame}`), false);
  check('Unpinning restores outside-click dismissal');

  await open();
  const idBeforeResize = await value(`${guest}.getWebContentsId()`);
  await job(`electron.remote.getCurrentWindow().setSize(440,740);await new Promise(r=>setTimeout(r,150));return true;`);
  assertGeometry(await geometry());
  await click(options);
  const menuRect = await value("document.querySelector('.peek-menu').getBoundingClientRect().toJSON()");
  assert.ok(menuRect.left >= 0 && menuRect.top >= 0);
  assert.ok(menuRect.right <= await value('innerWidth') && menuRect.bottom <= await value('innerHeight'));
  await escape();
  assert.equal(await value(`${guest}.getWebContentsId()`), idBeforeResize);
  check('External controls and menu fit a narrow window without recreating the guest');
  await job(`document.body.classList.remove('theme-dark');document.body.classList.add('theme-light');return true;`);
  assertGeometry(await geometry());
  await job(`document.body.classList.remove('theme-light');document.body.classList.add('theme-dark');return true;`);
  assertGeometry(await geometry());
  check('Controls remain hit-testable in the default light and dark themes');
  await job(`electron.remote.getCurrentWindow().setBounds(${JSON.stringify(originalBounds)});return true;`);
  await click(closeButton);
  await waitValue(`!${frame}`);
  assert.equal(await value(`!!${frame}`), false);
  check('The external close button dismisses the preview with a real mouse click');

  const lateError = await job(`
    const workspace=app.workspace, originalGet=workspace.getLeaf;
    const modalCount=document.querySelectorAll('.modal-container').length;
    let rejectLoad, stagedLeaf, originalSet;
    workspace.getLeaf=function(...args){const leaf=originalGet.apply(this,args);stagedLeaf=leaf;originalSet=leaf.setViewState;leaf.setViewState=()=>new Promise((resolve,reject)=>rejectLoad=reject);return leaf;};
    try {
      const pending=app.plugins.plugins['link-float'].openUrl('http://127.0.0.1:4179/',railSource);
      app.commands.executeCommandById('link-float:close-preview');
      rejectLoad(new Error('Controlled late failure after dismissal'));
      await pending;
      return {modalDelta:document.querySelectorAll('.modal-container').length-modalCount,overlays:document.querySelectorAll('.peek-surface').length};
    } finally {workspace.getLeaf=originalGet;if(stagedLeaf)stagedLeaf.setViewState=originalSet;}
  `);
  assert.deepEqual(lateError, { modalDelta: 0, overlays: 0 });
  check('A late loading failure after dismissal does not resurrect a modal or preview');

  await open();
  await job(`await railSource.setViewState({type:'empty',active:true});return true;`);
  await waitValue(`!${frame}`);
  assert.equal(await value('railSource.view.getViewType()'), 'empty');
  await job(`await railSource.setViewState({type:'markdown',state:{file:'Welcome.md',mode:'preview'},active:true});return true;`);
  check('Replacing the source view closes its preview without restoring an unrelated view');
  const pluginVersion = await value("app.plugins.manifests['link-float'].version");
  await writeFile('test-results/rail-results.json', JSON.stringify({ date: new Date().toISOString(), pluginVersion, results }, null, 2) + '\n');
} catch (error) {
  console.error(error);
  await writeFile('.lab/rail-partial.json', JSON.stringify({ results, error: String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await close().catch(() => {});
  if (originalBounds) await job(`electron.remote.getCurrentWindow().setBounds(${JSON.stringify(originalBounds)});return true;`).catch(() => {});
  if (originalTheme) await job(`document.body.classList.remove('theme-dark','theme-light');document.body.classList.add('theme-${originalTheme}');return true;`).catch(() => {});
}
