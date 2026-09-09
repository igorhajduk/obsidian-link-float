import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { cli, job, value, waitValue } from './lab-cli.mjs';

const rows = [];
const check = (name, detail) => { rows.push({ name, result: 'pass', detail }); console.log(`PASS ${name}`, detail ?? ''); };
const guest = "document.querySelector('.peek-surface webview')";
async function ready() {
  await job(`const guest=${guest}; const until=Date.now()+15000; while(Date.now()<until){try {if(await guest.executeJavaScript('!!window.fixtureReady'))return true;}catch{} await new Promise(r=>setTimeout(r,100));}throw Error('fixture did not load');`);
}
async function guestEval(code) { return job(`return await ${guest}.executeJavaScript(${JSON.stringify(code)});`); }
async function open(url = 'http://127.0.0.1:4179/') {
  await job(`await app.plugins.plugins['link-float'].openUrl(${JSON.stringify(url)});return true;`);
  await ready();
}
async function close() { await job("await app.plugins.plugins['link-float'].current?.close();return true;"); }
async function clickLink(selector, modifier = 'shift', label) {
  await job(`electron.remote.getCurrentWindow().show();electron.remote.getCurrentWindow().focus();return true;`);
  const target = label ? `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent===${JSON.stringify(label)})` : `document.querySelector(${JSON.stringify(selector)})`;
  await waitValue(`!!(${target})`);
  return job(`const a=${target};if(!a)throw Error('link missing');a.scrollIntoView();const r=a.getBoundingClientRect();const wc=electron.remote.getCurrentWebContents();const input={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:'left',clickCount:1,modifiers:[${JSON.stringify(modifier)}]};wc.sendInputEvent({...input,type:'mouseDown'});wc.sendInputEvent({...input,type:'mouseUp'});return true;`);
}

try {
  await job(`electron.remote.getCurrentWindow().show();electron.remote.getCurrentWindow().focus();return true;`);
  await job(`app.plugins.plugins['link-float'].settings.modifier='Shift';return true;`);
  await close();
  const runtime = await value(`({electron:process.versions.electron,chromium:process.versions.chrome,platform:process.platform,core:!!app.internalPlugins.getEnabledPluginById('webviewer')})`);
  console.log('Runtime', runtime);
  await job(`for(const leaf of app.workspace.getLeavesOfType('webviewer'))leaf.detach();window.labSource=app.workspace.getLeavesOfType('markdown')[0];await labSource.setViewState({type:'markdown',state:{file:'Welcome.md',mode:'preview'},active:true});return true;`);
  await waitValue(`!!document.querySelector('.markdown-preview-view a[href="http://127.0.0.1:4179/"]')`);
  const baseline = await value(`({file:labSource.view.file.path,content:labSource.view.data,leaves:app.workspace.getLeavesOfType('markdown').length})`);
  await clickLink('.markdown-preview-view a[href="http://127.0.0.1:4179/"]');
  await waitValue("!!document.querySelector('.peek-surface:popover-open')");
  await ready();
  const rect = await value("document.querySelector('.peek-surface').getBoundingClientRect().toJSON()");
  assert.ok(rect.width > 300 && rect.height > 300);
  check('Shift-click in Reading view opens a real overlay', { width: rect.width, height: rect.height });
  assert.deepEqual(await guestEval('({require:typeof require,process:typeof process})'), { require: 'undefined', process: 'undefined' });
  check('Guest has no Node globals; fixture with frame-ancestors none loads');

  // Keep the assertion away from the document bottom, where viewport resizing legitimately clamps scrollY.
  const before = await guestEval(`document.body.style.minHeight='3000px';document.querySelector('#draft').value='retained draft';history.pushState({test:true},'', '#retained');scrollTo(0,450);({token:window.instanceToken,draft:document.querySelector('#draft').value,history:history.length,scroll:scrollY,url:location.href})`);
  const guestId = await value(`${guest}.getWebContentsId()`);
  await cli('eval', "code=document.querySelector('.peek-controls [aria-label=\"Keep as Obsidian tab\"]').click()");
  assert.equal(await value("!!document.querySelector('.peek-surface')"), false);
  const after = await job(`const w=app.workspace.getLeavesOfType('webviewer')[0].view.webview;return {id:w.getWebContentsId(),state:await w.executeJavaScript('({token:window.instanceToken,draft:document.querySelector("#draft").value,history:history.length,scroll:scrollY,url:location.href})')};`);
  assert.equal(after.id, guestId); assert.deepEqual(after.state, before);
  check('Keep as tab preserves guest identity, form, history, scroll, and JS instance');
  const restoredTabs = await job(`
    const kept=app.workspace.getLeavesOfType('webviewer')[0],el=kept.containerEl;
    const shown=e=>getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0;
    const before={page:shown(el),source:shown(labSource.containerEl),header:shown(el.querySelector('.view-header'))};
    app.workspace.setActiveLeaf(labSource);
    const sourceActive={page:shown(el),source:shown(labSource.containerEl)};
    app.workspace.setActiveLeaf(kept);
    const pageActive={page:shown(el),source:shown(labSource.containerEl)};
    return {before,sourceActive,pageActive};
  `);
  assert.deepEqual(restoredTabs, {
    before: { page: true, source: false, header: true },
    sourceActive: { page: false, source: true },
    pageActive: { page: true, source: false },
  });
  check('Keep restores the browser header and normal visibility when switching between tabs');
  await job(`app.workspace.getLeavesOfType('webviewer')[0].detach();app.workspace.setActiveLeaf(labSource);return true;`);

  await open('http://127.0.0.1:4179/sign-in');
  assert.match(await guestEval('document.querySelector("#session").textContent'), /Signed in/);
  const firstGuest = await value(`${guest}.getWebContentsId()`);
  await close(); await open();
  assert.notEqual(await value(`${guest}.getWebContentsId()`), firstGuest);
  assert.match(await guestEval('document.querySelector("#session").textContent'), /Signed in/);
  check('HttpOnly login cookie survives closing and creating a new guest');

  const currentUrl = await value(`${guest}.getURL()`);
  await guestEval("document.querySelector('#bad').click();true");
  assert.equal(await value(`${guest}.getURL()`), currentUrl);
  check('Host blocks fixture file URL navigation');
  const tabCount = await value("app.workspace.getLeavesOfType('webviewer').length");
  const popup = await guestEval("window.open('/popup','_blank') === null");
  assert.equal(popup, true);
  const afterPopup = await value("app.workspace.getLeavesOfType('webviewer').length");
  assert.equal(afterPopup, tabCount + 1);
  check('Host denies a native popup but routes the URL to a core Web viewer tab', { nativePopupDenied: popup, extraTabs: afterPopup - tabCount });
  await job(`for(const leaf of app.workspace.getLeavesOfType('webviewer')){if(!leaf.containerEl.classList.contains('peek-surface'))leaf.detach();}return true;`);

  await job(`const w=${guest};await w.executeJavaScript('document.querySelector("#draft").focus()');w.focus();w.sendInputEvent({type:'keyDown',keyCode:'Escape'});w.sendInputEvent({type:'keyUp',keyCode:'Escape'});return true;`);
  assert.equal(await value("!!document.querySelector('.peek-surface')"), true);
  check('First Escape from focused guest keeps preview open');
  await job(`electron.remote.getCurrentWebContents().sendInputEvent({type:'keyDown',keyCode:'Escape'});electron.remote.getCurrentWebContents().sendInputEvent({type:'keyUp',keyCode:'Escape'});return true;`);
  await waitValue("!document.querySelector('.peek-surface')");
  check('Second Escape closes preview and restores the source');
  assert.equal(await value('app.workspace.getMostRecentLeaf() === labSource'), true);
  assert.deepEqual(await value(`({file:labSource.view.file.path,content:labSource.view.data,leaves:app.workspace.getLeavesOfType('markdown').length})`), baseline);
  check('Source note contents and leaf survive opening and closing');

  await job(`app.plugins.plugins['link-float'].settings.modifier='Alt';return true;`);
  await clickLink('.markdown-preview-view a[href="http://127.0.0.1:4179/"]', 'alt');
  await waitValue("!!document.querySelector('.peek-surface')"); await close();
  await job(`app.plugins.plugins['link-float'].settings.modifier='Shift';return true;`);
  check('Configured Alt-click opens the preview');

  await job(`window.labSecondSource=app.workspace.createLeafBySplit(labSource,'vertical');await labSecondSource.setViewState({type:'markdown',state:{file:'Welcome.md',mode:'preview'},active:true});app.workspace.setActiveLeaf(labSource);return true;`);
  await waitValue(`!!labSecondSource.view.containerEl.querySelector('a[href="http://127.0.0.1:4179/"]')`);
  await job(`labSecondSource.view.containerEl.querySelector('a[href="http://127.0.0.1:4179/"]').id='lab-inactive-link';return true;`);
  await clickLink('#lab-inactive-link');
  await waitValue("!!document.querySelector('.peek-surface')"); await close();
  assert.equal(await value('app.workspace.getMostRecentLeaf()===labSecondSource'), true);
  await job(`labSecondSource.detach();app.workspace.setActiveLeaf(labSource);return true;`);
  check('Clicking an inactive split restores the clicked note');

  await job(`await labSource.setViewState({type:'markdown',state:{file:'Welcome.md',mode:'source',source:false},active:true});return true;`);
  await waitValue("!!document.querySelector('.cm-editor')");
  const cursorBefore = await value('labSource.view.editor.listSelections()');
  // Place the fixture link in view and click its rendered label with trusted Electron input.
  await clickLink('.cm-link .cm-underline', 'shift', 'Session fixture');
  await waitValue("!!document.querySelector('.peek-surface')"); await ready();
  await close();
  assert.deepEqual(await value('labSource.view.editor.listSelections()'), cursorBefore);
  check('Shift-click in Live Preview preserves editor selection');

  await open();
  await job(`const w=${guest};w.focus();w.sendInputEvent({type:'keyDown',keyCode:'w',modifiers:['meta']});w.sendInputEvent({type:'keyUp',keyCode:'w',modifiers:['meta']});return true;`);
  await waitValue("!document.querySelector('.peek-surface')");
  assert.equal(await value('labSource.containerEl.isConnected'), true);
  check('Cmd+W from guest closes only the preview');

  await open();
  await job(`app.workspace.setActiveLeaf(app.workspace.getLeavesOfType('webviewer')[0]);await app.plugins.plugins['link-float'].openUrl('http://127.0.0.1:4179/');await app.plugins.plugins['link-float'].current.close();return true;`);
  assert.equal(await value('app.workspace.getMostRecentLeaf()===labSource'), true);
  check('Replacing a guest-focused preview retains the original source');

  const stress = await job(`const plugin=app.plugins.plugins['link-float'];for(let i=0;i<100;i++){await plugin.openUrl('http://127.0.0.1:4179/');await plugin.current.close();}await new Promise(r=>setTimeout(r,600));return {webLeaves:app.workspace.getLeavesOfType('webviewer').length,overlays:document.querySelectorAll('.peek-surface').length,inert:labSource.containerEl.inert};`, 60000);
  assert.deepEqual(stress, { webLeaves: 0, overlays: 0, inert: false });
  check('100 rapid open/close cycles leave no temporary leaves, overlays, or inert source', stress);
  await waitValue(`electron.remote.webContents.getAllWebContents().filter(w=>w.getType()==='webview'&&w.hostWebContents?.id===electron.remote.getCurrentWebContents().id).length===0`);
  check('No guest webContents remain in the test vault after teardown');

  await open();
  await job(`await app.plugins.disablePlugin('link-float');return true;`);
  assert.equal(await value("document.querySelectorAll('.peek-surface').length"), 0);
  assert.equal(await value("app.workspace.getLeavesOfType('webviewer').length"), 0);
  await job(`await app.plugins.enablePlugin('link-float');return true;`);
  check('Plugin unload removes the active preview');
  await mkdir('docs', { recursive: true });
  const pluginVersion = await value("app.plugins.manifests['link-float'].version");
  await writeFile('test-results/runtime-results.json', JSON.stringify({ date: new Date().toISOString(), pluginVersion, obsidian: '1.13.7', runtime, rows }, null, 2) + '\n');
} catch (error) {
  console.error(error);
  await mkdir('.lab', { recursive: true });
  await writeFile('.lab/runtime-partial.json', JSON.stringify({ rows, error: String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await job(`const plugin=app.plugins.plugins['link-float'];if(plugin)plugin.settings.modifier='Shift';return true;`).catch(() => {});
}
