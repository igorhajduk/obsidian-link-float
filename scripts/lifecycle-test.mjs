import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { cli, job, value, waitValue } from './lab-cli.mjs';

const results = [];
const check = (name, detail) => { results.push({ name, result: 'pass', detail }); console.log('PASS', name, detail ?? ''); };
const guest = "document.querySelector('.peek-surface webview')";
const plugin = "app.plugins.plugins['link-float']";
async function close() { await job("await app.plugins.plugins['link-float'].current?.close();return true;"); }
async function source() {
  await job(`window.lifeSource=app.workspace.getLeavesOfType('markdown')[0];app.workspace.setActiveLeaf(lifeSource);return true;`);
}
async function ready() {
  await job(`const w=${guest};for(let i=0;i<100;i++){try{if(await w.executeJavaScript('!!window.fixtureReady'))return true;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Fixture not ready');`);
}
async function open() {
  await job(`await ${plugin}.openUrl('http://127.0.0.1:4179/',lifeSource);return true;`);
  await ready();
}
async function key(keyCode, modifiers = [], inGuest = false) {
  await job(`const wc=${inGuest ? guest : 'electron.remote.getCurrentWebContents()'};wc.sendInputEvent({type:'keyDown',keyCode:${JSON.stringify(keyCode)},modifiers:${JSON.stringify(modifiers)}});wc.sendInputEvent({type:'keyUp',keyCode:${JSON.stringify(keyCode)},modifiers:${JSON.stringify(modifiers)}});return true;`);
}

try {
  await job(`electron.remote.getCurrentWindow().show();electron.remote.getCurrentWindow().focus();return true;`);
  await close(); await source();
  const existing = await value("app.workspace.getLeavesOfType('webviewer').map(l=>l.view.webview?.getURL()||l.getViewState().state?.url)");
  assert.ok(existing.every(url => url?.startsWith('http://127.0.0.1:4179/')), 'Only fixture pages may be cleaned up');
  await job(`for(const l of app.workspace.getLeavesOfType('webviewer'))l.detach();return true;`);

  const late = await job(`
    const workspace=app.workspace, originalGet=workspace.getLeaf;
    let resume, staged, originalSet;
    workspace.getLeaf=function(...args){staged=originalGet.apply(this,args);originalSet=staged.setViewState;staged.setViewState=async function(...states){await new Promise(r=>resume=r);return originalSet.apply(this,states);};return staged;};
    try {
      const pending=${plugin}.openUrl('http://127.0.0.1:4179/',lifeSource);
      await ${plugin}.current.close();resume();await pending;
      await new Promise(r=>setTimeout(r,200));
      return {overlays:document.querySelectorAll('.peek-surface').length,webLeaves:app.workspace.getLeavesOfType('webviewer').length,inert:lifeSource.containerEl.inert,active:app.workspace.getMostRecentLeaf()===lifeSource};
    } finally {workspace.getLeaf=originalGet;if(staged)staged.setViewState=originalSet;}
  `);
  assert.deepEqual(late, { overlays: 0, webLeaves: 0, inert: false, active: true });
  check('Closing before leaf creation finishes cannot resurrect the preview or strand the note', late);

  const burst = await job(`
    await Promise.all(Array.from({length:20},(_,i)=>${plugin}.openUrl('http://127.0.0.1:4179/?burst='+i,lifeSource)));
    return {webLeaves:app.workspace.getLeavesOfType('webviewer').length,overlays:document.querySelectorAll('.peek-surface').length};
  `);
  await ready();
  burst.url = await value(`${guest}.getURL()`);
  assert.equal(burst.webLeaves, 1); assert.equal(burst.overlays, 1); assert.match(burst.url, /burst=19/);
  await close();
  check('Twenty concurrent opening requests retain only the latest preview', burst);

  await open();
  await job(`app.workspace.getLeavesOfType('webviewer')[0].detach();return true;`);
  await waitValue("!document.querySelector('.peek-surface') && !lifeSource.containerEl.inert");
  assert.equal(await value(`${plugin}.current===null`), true);
  check('External leaf removal releases the preview scope and source lock');

  await open();
  const identity = await value(`${guest}.getWebContentsId()`);
  await key('f', ['meta']);
  await waitValue("!!document.querySelector('.peek-surface .document-search-container input')");
  const searchGeometry = await value(`(()=>{const i=document.querySelector('.peek-surface .document-search-container input'),r=i.getBoundingClientRect();return {visible:r.width>0&&r.height>0,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===i,focused:document.activeElement===i}})()`);
  assert.deepEqual(searchGeometry, { visible: true, hit: true, focused: true });
  await job(`window.lifeFindResult=null;${guest}.addEventListener('found-in-page',e=>{if(e.result.finalUpdate)lifeFindResult=e.result;});await electron.remote.getCurrentWebContents().insertText('fixture');return true;`);
  const found = await waitValue('window.lifeFindResult');
  assert.ok(found.matches > 0);
  await key('Enter');
  await waitValue('window.lifeFindResult.activeMatchOrdinal===2');
  await key('Escape');
  assert.equal(await value("!!document.querySelector('.peek-surface .document-search-container')"), false);
  assert.equal(await value(`${guest}.getWebContentsId()`), identity);
  check('Cmd+F searches the webpage, Enter advances matches, and Escape closes search first', { matches: found.matches });
  await job(`${guest}.focus();return true;`);
  await key('f', ['meta'], true);
  await waitValue("!!document.querySelector('.peek-surface .document-search-container input')");
  await key('Escape');
  check('Cmd+F also reaches page search from guest focus');

  // Observe the core's real native-menu path while leaving its implementation intact.
  const menu = await job(`
    const Menu=electron.remote.Menu, originalBuild=Menu.buildFromTemplate;
    window.lifeNativeMenu=null;window.lifeMenuLabels=[];
    Menu.buildFromTemplate=function(template){lifeMenuLabels=template.map(i=>i.label).filter(Boolean);lifeNativeMenu=originalBuild.call(this,template);return lifeNativeMenu;};
    try {
      const w=${guest};w.sendInputEvent({type:'mouseDown',x:25,y:250,button:'right',clickCount:1});w.sendInputEvent({type:'mouseUp',x:25,y:250,button:'right',clickCount:1});
      for(let i=0;i<20&&!lifeNativeMenu;i++)await new Promise(r=>setTimeout(r,50));
      return {labels:lifeMenuLabels,created:!!lifeNativeMenu,overlay:!!document.querySelector('.peek-surface')};
    } finally {if(lifeNativeMenu)lifeNativeMenu.closePopup();Menu.buildFromTemplate=originalBuild;}
  `);
  assert.equal(menu.created, true); assert.equal(menu.overlay, true); assert.ok(menu.labels.length >= 3);
  check('Right-click opens the core native page menu without dismissing the preview', menu);
  await close();

  await job(`window.lifeKept=app.workspace.getLeaf('tab');await lifeKept.setViewState({type:'webviewer',state:{url:'http://127.0.0.1:4179/?retained=1'},active:true});return true;`);
  await open();
  const persistence = await job(`
    const preview=app.workspace.getLeavesOfType('webviewer').find(l=>l.containerEl.classList.contains('peek-surface'));
    app.workspace.setActiveLeaf(preview);
    const snapshot=app.workspace.getLayout();
    await app.workspace.saveLayout();
    const disk=JSON.parse(await app.vault.adapter.read(app.vault.configDir+'/workspace.json'));
    return {previewId:preview.id,keptId:lifeKept.id,sourceId:lifeSource.id,snapshot,disk};
  `);
  for (const layout of [persistence.snapshot, persistence.disk]) {
    assert.ok(!JSON.stringify(layout).includes(persistence.previewId));
    assert.ok(JSON.stringify(layout).includes(persistence.keptId));
    assert.equal(layout.active, persistence.sourceId);
  }
  check('Actual saved workspace omits only the preview and restores its source as active');
  await job(`${plugin}.current.keep();await app.workspace.saveLayout();return true;`);
  assert.ok(await value(`JSON.stringify(app.workspace.getLayout()).includes(${JSON.stringify(persistence.previewId)})`));
  check('Keeping the page immediately restores its normal layout persistence');
  await job(`for(const l of app.workspace.getLeavesOfType('webviewer'))l.detach();app.workspace.setActiveLeaf(lifeSource);return true;`);

  await open();
  const restoration = await job(`const layout=app.workspace.getLayout();await ${plugin}.current.close();await app.workspace.changeLayout(layout);return {files:app.workspace.getLeavesOfType('markdown').map(l=>l.getViewState().state.file),webLeaves:app.workspace.getLeavesOfType('webviewer').length,overlays:document.querySelectorAll('.peek-surface').length};`);
  assert.ok(restoration.files.includes('Welcome.md')); assert.equal(restoration.webLeaves, 0); assert.equal(restoration.overlays, 0);
  await source();
  check('Restoring the core workspace snapshot reopens the note without a stray preview tab', restoration);

  const unload = await job(`
    const l=app.workspace.getLeaf('tab');await l.setViewState({type:'webviewer',state:{url:'http://127.0.0.1:4179/?unload=1'},active:true});await l.loadIfDeferred();const w=l.view.webview;
    for(let i=0;i<100;i++){try{if(await w.executeJavaScript('!!window.fixtureReady'))break;}catch{}await new Promise(r=>setTimeout(r,100));}
    await w.executeJavaScript("window.onbeforeunload=e=>{e.preventDefault();e.returnValue='';};true");
    const wc=electron.remote.webContents.fromId(w.getWebContentsId()),events=[];
    wc.once('will-prevent-unload',()=>events.push('prevented'));wc.once('destroyed',()=>events.push('destroyed'));
    wc.close({waitForBeforeUnload:true});await new Promise(r=>setTimeout(r,250));
    const destroyed=wc.isDestroyed();if(!destroyed)await w.executeJavaScript('window.onbeforeunload=null');l.detach();
    return {events,destroyed};
  `);
  results.push({ name: 'Native beforeunload capability probe', result: 'observed', detail: unload });
  console.log('OBSERVED native beforeunload', unload);

  await source();
  await waitValue("electron.remote.webContents.getAllWebContents().filter(w=>w.getType()==='webview'&&w.hostWebContents?.id===electron.remote.getCurrentWebContents().id).length===0");
  const pluginVersion = await value("app.plugins.manifests['link-float'].version");
  await writeFile('test-results/lifecycle-results.json', JSON.stringify({ date: new Date().toISOString(), pluginVersion, results }, null, 2) + '\n');
} catch (error) {
  console.error(error);
  await writeFile('.lab/lifecycle-partial.json', JSON.stringify({ results, error: String(error) }, null, 2));
  process.exitCode = 1;
} finally { await close().catch(() => {}); }
