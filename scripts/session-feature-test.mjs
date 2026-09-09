import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { job, value, waitValue } from './lab-cli.mjs';

const results=[];
const check=(name,detail)=>{results.push({name,result:'pass',detail});console.log('PASS',name,detail??'');};
const plugin="app.plugins.plugins['link-float']";
const guest="document.querySelector('.peek-surface webview')";
const article='http://127.0.0.1:4180/article';
async function ready() {
  await job(`const w=${guest};for(let i=0;i<100;i++){try{if(await w.executeJavaScript('!!window.fixtureReady'))return true;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Fixture unavailable');`);
}
async function open(url=article, settle=true) {
  await job(`await ${plugin}.openUrl(${JSON.stringify(url)},sessionSource);return true;`);
  await ready();
  if(settle)await waitValue(`${plugin}.current.reading.initialized`);
}
async function close() { return job(`return await ${plugin}.current?.close();`); }
async function page(code) { return job(`return await ${guest}.executeJavaScript(${JSON.stringify(code)});`); }
async function key(keyCode,modifiers=[],inGuest=false) {
  await job(`const wc=${inGuest?guest:'electron.remote.getCurrentWebContents()'};wc.sendInputEvent({type:'keyDown',keyCode:${JSON.stringify(keyCode)},modifiers:${JSON.stringify(modifiers)}});wc.sendInputEvent({type:'keyUp',keyCode:${JSON.stringify(keyCode)},modifiers:${JSON.stringify(modifiers)}});return true;`);
}
async function click(selector,label) {
  const target=label?`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent===${JSON.stringify(label)})`:`document.querySelector(${JSON.stringify(selector)})`;
  await job(`const el=${target};if(!el)throw Error('Click target missing');const r=el.getBoundingClientRect();if(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)!==el)throw Error('Click target is covered');const wc=electron.remote.getCurrentWebContents();const input={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:'left',clickCount:1};wc.sendInputEvent({...input,type:'mouseDown'});wc.sendInputEvent({...input,type:'mouseUp'});return true;`);
}
async function typedDraft() {
  await job(`const w=${guest};const r=await w.executeJavaScript('document.querySelector("#draft").getBoundingClientRect().toJSON()');w.focus();const e={x:Math.round(r.x+30),y:Math.round(r.y+20),button:'left',clickCount:1};w.sendInputEvent({...e,type:'mouseDown'});w.sendInputEvent({...e,type:'mouseUp'});w.sendInputEvent({type:'keyDown',keyCode:'a'});w.sendInputEvent({type:'char',keyCode:'a'});w.sendInputEvent({type:'keyUp',keyCode:'a'});return true;`);
  await waitValue(`${guest}.getURL().includes('/guard')`);
  const result=await page('({trusted:trustedInput,activated:navigator.userActivation.hasBeenActive,draft:document.querySelector("#draft").value})');
  assert.deepEqual(result,{trusted:true,activated:true,draft:'a'});
}
async function confirmation() { await waitValue("!!document.querySelector('.peek-confirmation')"); }
async function cancel() {
  await click('.peek-confirmation button','Cancel');
  await waitValue(`!${plugin}.current.closing`);
  assert.equal(await value("!!document.querySelector('.peek-confirmation')"),false);
  assert.equal(await value("!!document.querySelector('.peek-close-cover')||!!document.querySelector('.peek-surface').dataset.peekMotion"),false);
}

try {
  const existing=await value("app.workspace.getLeavesOfType('webviewer').map(l=>l.view.webview?.getURL())");
  assert.ok(existing.every(url=>url?.startsWith('http://127.0.0.1:')),'Use fixture-only lab');
  await job(`${plugin}.current?.forceClose();for(const l of app.workspace.getLeavesOfType('webviewer'))l.detach();window.sessionSource=app.workspace.getLeavesOfType('markdown')[0];app.workspace.setActiveLeaf(sessionSource);${plugin}.settings.rememberPosition=true;${plugin}.positions.clear();electron.remote.getCurrentWindow().show();electron.remote.getCurrentWindow().focus();return true;`);
  await open();
  const before=await page(`scrollTo(0,1750);document.querySelector('#draft').value='discarded draft';({y:scrollY,token:instanceToken})`);
  assert.equal(before.y,1750);
  assert.equal(await close(),true);
  assert.equal(await value("!!document.querySelector('.peek-confirmation')"),false);
  await open();
  const restored=await page('({y:scrollY,token:instanceToken,draft:document.querySelector("#draft").value})');
  assert.equal(restored.y,1750);assert.notEqual(restored.token,before.token);assert.equal(restored.draft,'');
  check('Close/reopen creates a fresh page at the saved position without restoring form values',restored);
  await close();
  await job(`await app.plugins.disablePlugin('link-float');await app.plugins.enablePlugin('link-float');return true;`);
  await open();assert.equal(await page('scrollY'),1750);await close();
  check('Reading position survives plugin reload in local vault storage');

  await open(article+'#section-3');
  assert.ok(Math.abs(await page('document.querySelector("#section-3").getBoundingClientRect().top'))<3);
  await close();check('Explicit section links take priority over remembered scroll');
  await open(article+'?other=1');assert.equal(await page('scrollY'),0);await close();
  check('Distinct URLs do not inherit another page position');

  const delayed=article+'?delayed=1';
  await job(`${plugin}.positions.put({url:${JSON.stringify(delayed)},x:0,y:2200});return true;`);
  await open(delayed);assert.equal(await page('scrollY'),2200);await close();
  check('Restoration waits briefly for delayed page content');
  const interrupted=article+'?delayed=cancel';
  await job(`${plugin}.positions.put({url:${JSON.stringify(interrupted)},x:0,y:2300});return true;`);
  await open(interrupted,false);
  await job(`${guest}.sendInputEvent({type:'mouseWheel',x:100,y:300,deltaX:0,deltaY:120,canScroll:true});await new Promise(r=>setTimeout(r,1100));return true;`);
  assert.notEqual(await page('scrollY'),2300);await close();
  check('Trusted scrolling cancels delayed restoration instead of pulling the reader back');

  await job(`${plugin}.positions.clear();return true;`);
  await open();assert.equal(await page('scrollY'),0);await close();
  check('Clearing saved positions resets later openings');

  await open('http://127.0.0.1:4180/guard');
  assert.equal(await close(),true);
  check('An untouched form closes without a universal warning');
  await open('http://127.0.0.1:4180/guard');await typedDraft();
  const identity=await value(`${guest}.getWebContentsId()`);
  const token=await page('instanceToken');
  const stateBefore=await value(`${plugin}.current.leaf.getViewState()`);
  await job(`window.sessionClosing=${plugin}.current.close();return true;`);
  await confirmation();
  assert.match(await value("document.querySelector('.peek-confirmation h2').textContent"),/Leave this page/);
  const bounds=await value('electron.remote.getCurrentWindow().getBounds()');
  const theme=await value("document.body.classList.contains('theme-dark')?'theme-dark':'theme-light'");
  try {
    assert.equal(await value('document.activeElement.textContent'),'Cancel');
    await key('Tab');assert.equal(await value('document.activeElement.textContent'),'Leave');
    await key('Tab');assert.equal(await value('document.activeElement.textContent'),'Cancel');
    await job(`await new Promise(r=>setTimeout(r,150));require('fs').writeFileSync(${JSON.stringify(new URL('../test-results/close-confirmation.png', import.meta.url).pathname)},(await electron.remote.getCurrentWebContents().capturePage()).toPNG());return true;`);
    await job(`electron.remote.getCurrentWindow().setSize(440,740);await new Promise(r=>setTimeout(r,150));return true;`);
    for(const nextTheme of ['theme-light','theme-dark']) {
      const geometry=await job(`document.body.classList.remove('theme-dark','theme-light');document.body.classList.add('${nextTheme}');const c=document.querySelector('.peek-confirmation-card'),r=c.getBoundingClientRect();return {fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,hits:[...c.querySelectorAll('button')].every(b=>{const p=b.getBoundingClientRect();return document.elementFromPoint(p.x+p.width/2,p.y+p.height/2)===b;})};`);
      assert.deepEqual(geometry,{fits:true,hits:true});
    }
  } finally { await job(`electron.remote.getCurrentWindow().setBounds(${JSON.stringify(bounds)});document.body.classList.remove('theme-dark','theme-light');document.body.classList.add('${theme}');return true;`); }
  check('Leave/Cancel traps keyboard focus and fits a narrow window in light and dark themes');
  await cancel();assert.equal(await job('return await window.sessionClosing;'),false);
  assert.equal(await value(`${guest}.getWebContentsId()`),identity);
  assert.deepEqual(await page('({token:instanceToken,draft:document.querySelector("#draft").value})'),{token,draft:'a'});
  assert.deepEqual(await value(`${plugin}.current.leaf.getViewState()`),stateBefore);
  check('Cancel preserves the same guest, draft, page instance, and core view state');

  await click('.peek-controls [aria-label="Close preview"]');await confirmation();await cancel();
  check('External close button honors the site request');
  await job(`${guest}.focus();return true;`);await key('w',['meta'],true);await confirmation();await cancel();
  check('Cmd+W from the website honors the site request');
  await job(`${guest}.focus();return true;`);await key('Escape',[],true);await key('Escape');await confirmation();
  await key('Escape');await waitValue(`!${plugin}.current.closing`);
  check('Escape reaches the site warning and then cancels it');
  await job(`const r=document.querySelector('.peek-surface').getBoundingClientRect();const wc=electron.remote.getCurrentWebContents();const e={x:Math.round(r.left-8),y:Math.round(r.top+200),button:'left',clickCount:1};wc.sendInputEvent({...e,type:'mouseDown'});wc.sendInputEvent({...e,type:'mouseUp'});return true;`);
  await confirmation();await cancel();check('Outside-click dismissal honors the site request');

  await job(`window.sessionReplacement=${plugin}.openUrl('${article}?replacement=cancel',sessionSource);return true;`);
  await confirmation();await cancel();await job('await sessionReplacement;return true;');
  assert.equal(await value(`${guest}.getWebContentsId()`),identity);
  check('Cancel also prevents replacement by another preview');
  await job(`window.sessionReplacement=${plugin}.openUrl('${article}?replacement=leave',sessionSource);return true;`);
  await confirmation();await click('.peek-confirmation button','Leave');await job('await sessionReplacement;return true;');await ready();
  assert.notEqual(await value(`${guest}.getWebContentsId()`),identity);
  assert.match(await value(`${guest}.getURL()`),/replacement=leave/);
  await close();check('Leave disposes the old page and completes the requested replacement');

  await open('http://127.0.0.1:4180/guard');await typedDraft();
  const keepId=await value(`${guest}.getWebContentsId()`);
  await job(`${plugin}.current.keep();return true;`);
  assert.equal(await value("!!document.querySelector('.peek-confirmation')"),false);
  assert.equal(await value("app.workspace.getLeavesOfType('webviewer')[0].view.webview.getWebContentsId()"),keepId);
  await job(`const l=app.workspace.getLeavesOfType('webviewer')[0];await l.view.webview.executeJavaScript('window.onbeforeunload=null');l.detach();return true;`);
  check('Keeping an edited page needs no warning and preserves the guest');

  await open('http://127.0.0.1:4180/guard');await typedDraft();
  await job(`window.sessionClosing=${plugin}.current.close();return true;`);await confirmation();
  await job(`await app.plugins.disablePlugin('link-float');await sessionClosing;await app.plugins.enablePlugin('link-float');return true;`);
  assert.equal(await value("!!document.querySelector('.peek-confirmation')||!!document.querySelector('.peek-surface')||sessionSource.containerEl.inert"),false);
  check('Plugin unload during a warning disposes the page and releases the note');

  await open();
  await job(`const w=${guest},original=w.executeJavaScript;w.executeJavaScript=function(code,...args){if(code==='navigator.userActivation.hasBeenActive')return new Promise(resolve=>window.sessionActivation=resolve);return original.call(this,code,...args);};window.sessionClosing=${plugin}.current.close();return true;`);
  await waitValue('typeof window.sessionActivation===\'function\'');
  await job(`${plugin}.current.forceClose();sessionActivation(true);await sessionClosing;delete window.sessionActivation;return true;`);
  assert.equal(await value("!!document.querySelector('.peek-confirmation')||!!document.querySelector('.peek-surface')||sessionSource.containerEl.inert"),false);
  check('Forced teardown during an asynchronous close check cannot resurrect a warning');

  const cached=await value(`${plugin}.positions.size`);
  const version=await value("app.plugins.manifests['link-float'].version");
  await writeFile('test-results/session-feature-results.json',JSON.stringify({date:new Date().toISOString(),pluginVersion:version,cacheEntries:cached,results},null,2)+'\n');
} catch(error) {
  console.error(error);await writeFile('.lab/session-feature-partial.json',JSON.stringify({results,error:String(error)},null,2));process.exitCode=1;
} finally { await job(`${plugin}.current?.forceClose();app.workspace.setActiveLeaf(sessionSource);return true;`).catch(()=>{}); }
