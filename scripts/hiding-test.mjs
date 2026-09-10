import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { cli, job, value, waitValue } from './lab-cli.mjs';

const rows = [];
const pass = (name, detail) => { rows.push({ name, result: 'pass', detail }); console.log('PASS', name, detail ?? ''); };
const plugin = "app.plugins.plugins['link-float']";
const base = 'http://127.0.0.1:4182';
const html = `<!doctype html><html><head><title>Hiding and native Peek fixture</title><style>
body{font:18px system-ui;margin:50px;background:#fafafa;color:#222}#banner{display:block!important;background:#ffe8af;padding:24px;margin-bottom:24px;width:440px}a{display:inline-block;margin:12px}input{padding:10px}#spacer{height:2200px}.cards{margin:24px}
</style><script>window.activations=0;window.addEventListener('pointerdown',()=>activations++,true);window.addEventListener('click',()=>activations++,true);</script></head><body>
<aside id=banner><b>Persistent banner</b><input id=bannerInput value="original"></aside>
<a id=next href=/destination target=_blank>Open destination</a><a id=normal href=/normal>Ordinary link</a>
<input id=draft><div class=cards><p class=card>First card</p><p class=card>Second card</p></div><div id=spacer></div>
<script>window.instanceToken=crypto.randomUUID();window.savedNode=document.querySelector('#banner');window.savedNode.customState={count:7};savedNode.addEventListener('fixture',()=>savedNode.customState.count++);document.querySelector('#draft').addEventListener('input',()=>{if(location.pathname==='/guard')window.onbeforeunload=e=>{e.preventDefault();e.returnValue='draft';return 'draft';}});window.fixtureReady=true;</script></body></html>`;
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
await new Promise(resolve => server.listen(4182, '127.0.0.1', resolve));
async function page(leaf, code) { return job(`return await ${leaf}.view.webview.executeJavaScript(${JSON.stringify(code)});`); }
async function loaded(leaf) {
  await job(`const l=${leaf};for(let i=0;i<100;i++){try{if(await l.view.webview.executeJavaScript('!!window.fixtureReady'))return true;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Fixture not ready');`);
  await waitValue(`${plugin}.pages.pages.get(${leaf}.view.webview)?.installed`);
}
async function leaf(name, path = '/') {
  await job(`window.${name}=app.workspace.getLeaf('tab');await ${name}.setViewState({type:'webviewer',state:{url:${JSON.stringify(base + path)}},active:true});return true;`);
  await loaded(name);
}
async function hidden(leaf, selector = '#banner', expected = true) {
  await job(`for(let i=0;i<100;i++){const hidden=await ${leaf}.view.webview.executeJavaScript(${JSON.stringify(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).display === 'none'`)});if(hidden===${expected})return true;await new Promise(r=>setTimeout(r,50));}throw Error('Unexpected hidden state: ${leaf} ${selector}');`);
}
async function hostClick(label, within = '.peek-picker') {
  await job(`const el=[...document.querySelectorAll(${JSON.stringify(within + ' button')})].find(b=>b.textContent===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!el)throw Error('Missing button: ${label}');el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(!el.contains(hit))throw Error('Covered button: ${label}');const wc=electron.remote.getCurrentWebContents(),e={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:'left',clickCount:1};wc.sendInputEvent({...e,type:'mouseDown'});wc.sendInputEvent({...e,type:'mouseUp'});return true;`);
}
async function select(leaf, selector) {
  await job(`const p=${plugin};await p.pages.pages.get(${leaf}.view.webview).pick();return true;`);
  await waitValue("!!document.querySelector('.peek-picker-shield')");
  await job(`const g=${leaf}.view.webview;const r=await g.executeJavaScript(${JSON.stringify(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const r=el.getBoundingClientRect();return {x:r.x+10,y:r.y+10,w:innerWidth,h:innerHeight}})()`)});const b=g.getBoundingClientRect();const x=b.x+r.x*b.width/r.w,y=b.y+r.y*b.height/r.h;const hit=document.elementFromPoint(x,y);if(!hit?.classList.contains('peek-picker-shield'))throw Error('Picker target covered by host controls');const wc=electron.remote.getCurrentWebContents(),e={x:Math.round(x),y:Math.round(y),button:'left',clickCount:1};wc.sendInputEvent({...e,type:'mouseMove'});wc.sendInputEvent({...e,type:'mouseDown'});wc.sendInputEvent({...e,type:'mouseUp'});return true;`);
  await waitValue(`${plugin}.pages.pages.get(${leaf}.view.webview)?.draft !== null`);
}
async function guestClick(leaf, selector, modifiers = [], drag = 0) {
  await job(`const g=${leaf}.view.webview;const r=await g.executeJavaScript(${JSON.stringify(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`)});const wc=electron.remote.webContents.fromId(g.getWebContentsId());const e={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:'left',clickCount:1,modifiers:${JSON.stringify(modifiers)}};wc.sendInputEvent({...e,type:'mouseDown'});if(${drag})wc.sendInputEvent({...e,x:e.x+${drag},type:'mouseMove'});wc.sendInputEvent({...e,x:e.x+${drag},type:'mouseUp'});return true;`);
}
async function screenshot(name) { await job(`require('fs').writeFileSync(${JSON.stringify(new URL('../test-results/' + name, import.meta.url).pathname)},(await electron.remote.getCurrentWebContents().capturePage()).toPNG());return true;`); }
async function hover(leaf, selector = '#banner') {
  await job(`const g=${leaf}.view.webview;const r=await g.executeJavaScript(${JSON.stringify(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+10,y:r.y+10,w:innerWidth,h:innerHeight}})()`)});const b=g.getBoundingClientRect(),x=b.x+r.x*b.width/r.w,y=b.y+r.y*b.height/r.h;if(!document.elementFromPoint(x,y)?.classList.contains('peek-picker-shield'))throw Error('Hover target covered');const wc=electron.remote.getCurrentWebContents();wc.sendInputEvent({type:'mouseMove',x:Math.round(x+1),y:Math.round(y+1)});wc.sendInputEvent({type:'mouseMove',x:Math.round(x),y:Math.round(y)});return true;`);
}
async function highlightMatches(leaf, selector = '#banner') {
  await job(`let last;for(let i=0;i<80;i++){const g=${leaf}.view.webview,r=await g.executeJavaScript(${JSON.stringify(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,vw:innerWidth,vh:innerHeight}})()`)}),b=g.getBoundingClientRect(),h=document.querySelector('.peek-picker-highlight.is-active'),a=h?.getBoundingClientRect(),expected={x:b.x+r.x*b.width/r.vw,y:b.y+r.y*b.height/r.vh,width:r.width*b.width/r.vw,height:r.height*b.height/r.vh};last={actual:a?.toJSON(),expected,highlight:h?.outerHTML,picker:${plugin}.pages.pages.get(g).picker};if(a&&getComputedStyle(h).display!=='none'&&['x','y','width','height'].every(k=>Math.abs(a[k]-expected[k])<2))return true;await new Promise(r=>setTimeout(r,50));}throw Error('Highlight does not align with its page element: '+JSON.stringify(last));`);
}

try {
  await job(`if(app.workspace.getLeavesOfType('webviewer').some(l=>!l.view.webview?.getURL().startsWith('http://127.0.0.1:')))throw Error('Fixture-only vault required');${plugin}.current?.forceClose();for(const l of app.workspace.getLeavesOfType('webviewer'))l.detach();for(const r of [...${plugin}.store.data.rules])await ${plugin}.store.remove(r.id);${plugin}.settings.modifier='Shift';await ${plugin}.saveSettings();window.hideSource=app.workspace.getLeavesOfType('markdown')[0];electron.remote.getCurrentWindow().show();electron.remote.getCurrentWindow().focus();return true;`);
  await leaf('hideA'); await leaf('hideB', '/other');
  await job(`await app.plugins.disablePlugin('link-float');await app.plugins.enablePlugin('link-float');app.workspace.setActiveLeaf(hideA);return true;`);
  await loaded('hideA'); await loaded('hideB');
  assert.equal(await value(`${plugin}.pages.pages.size`), 2);
  await job(`${plugin}.pages.manage(hideA);app.workspace.setActiveLeaf(hideB);return true;`);
  assert.equal(await value("!!document.querySelector('.peek-picker')"), false);
  await job('app.workspace.setActiveLeaf(hideA);return true;');
  pass('Registry discovers pre-existing independent Web Viewer tabs and closes page controls when switching tabs');

  const pageMarkup = await page('hideA', 'document.documentElement.outerHTML');
  await job(`await ${plugin}.pages.pages.get(hideA.view.webview).pick();return true;`);
  await hover('hideA'); await highlightMatches('hideA');
  assert.equal(await page('hideA', 'document.documentElement.outerHTML'), pageMarkup);
  await screenshot('hiding-highlight.png');
  await page('hideA', 'scrollTo(0,80);true'); await highlightMatches('hideA');
  assert.equal(await value("getComputedStyle(document.querySelector('.peek-picker-shield')).overflow"), 'hidden');
  await page('hideA', 'savedNode.style.width="360px";true'); await highlightMatches('hideA');
  await page('hideA', 'savedNode.style.width="";scrollTo(0,0);true'); await highlightMatches('hideA');
  const oldViewport = await page('hideA', 'innerWidth');
  await job('electron.remote.webContents.fromId(hideA.view.webview.getWebContentsId()).setZoomFactor(1.25);return true;');
  try {
    await job(`for(let i=0;i<80;i++){if(await hideA.view.webview.executeJavaScript('innerWidth')!==${oldViewport})return true;await new Promise(r=>setTimeout(r,50));}throw Error('Zoom did not change viewport');`);
    await highlightMatches('hideA');
  } finally { await job('electron.remote.webContents.fromId(hideA.view.webview.getWebContentsId()).setZoomFactor(1);return true;'); }
  await highlightMatches('hideA');
  pass('Host highlight tracks scrolling, DOM resizing and 125 percent web zoom without changing page markup');

  await job(`const r=document.querySelector('.peek-picker').getBoundingClientRect();electron.remote.getCurrentWebContents().sendInputEvent({type:'mouseMove',x:Math.round(r.x+20),y:Math.round(r.y+20)});return true;`);
  await waitValue("!document.querySelector('.peek-picker-highlight.is-active')");
  await hover('hideA'); await highlightMatches('hideA');
  await page('hideA', 'savedNode.remove();true');
  await waitValue("!document.querySelector('.peek-picker-highlight.is-active')");
  await page('hideA', 'document.body.prepend(savedNode);true');
  await hover('hideA'); await highlightMatches('hideA');
  await hostClick('Cancel');
  assert.equal(await value("!!document.querySelector('.peek-picker-highlight')"), false);
  await job(`await Promise.all([${plugin}.pages.pages.get(hideA.view.webview).pick(),${plugin}.pages.pages.get(hideA.view.webview).pick()]);return true;`);
  assert.equal(await value("document.querySelectorAll('.peek-picker-shield').length"), 1);
  assert.equal(await value("!!document.querySelector('.peek-picker-highlight.is-active')"), false);
  await hover('hideA'); await highlightMatches('hideA');
  await job('hideA.view.webview.reload();return true;'); await loaded('hideA');
  assert.equal(await value("!!document.querySelector('.peek-picker-highlight')"), false);
  pass('Leaving the page, removing the target, Cancel, rapid picker restart and navigation clear the highlight');

  await select('hideA', '#banner'); await hidden('hideA');
  assert.equal(await page('hideA', 'activations'), 0);
  assert.equal(await page('hideA', 'Object.keys(window).some(k=>k.startsWith("__linkFloat_"))'), false);
  await hostClick('Cancel'); await hidden('hideA', '#banner', false);
  assert.deepEqual(await page('hideA', '({same:savedNode===document.querySelector("#banner"),value:document.querySelector("#bannerInput").value,state:savedNode.customState.count})'), { same: true, value: 'original', state: 7 });
  assert.equal(await value(`${plugin}.store.data.rules.length`), 0);
  pass('Picker shields page handlers; Cancel restores original nodes, input and JS state; helper is isolated');

  await job(`await ${plugin}.openUrl('${base}/preview',hideSource);window.hidePreview=${plugin}.current.pageLeaf();return true;`); await loaded('hidePreview');
  assert.deepEqual(await value("[...document.querySelectorAll('.peek-controls>button')].map(b=>b.getAttribute('aria-label'))"), ['Close preview', 'Keep as Obsidian tab', 'Hide elements', 'Preview options']);
  await hostClick('Hide elements', '.peek-controls');
  await waitValue("!!document.querySelector('.peek-picker-shield')");
  await hover('hidePreview'); await highlightMatches('hidePreview');
  await screenshot('hiding-highlight-preview.png');
  pass('Host highlight aligns inside the preview overlay and leaves controls reachable');
  // select() restarts the same picker and exercises the same trusted host input.
  await select('hidePreview', '#banner');
  await screenshot('hiding-picker.png');
  await hostClick('Save'); await waitValue(`${plugin}.store.data.rules.length===1`);
  await hidden('hideA'); await hidden('hideB'); await hidden('hidePreview');
  const keptId = await value('hidePreview.view.webview.getWebContentsId()');
  await hostClick('Keep as Obsidian tab', '.peek-controls');
  assert.equal(await value('hidePreview.view.webview.getWebContentsId()'), keptId);
  await hidden('hidePreview');
  pass('Save in Peek applies to independent same-origin tabs; required rail order and Keep preserve hiding and guest identity');

  await job(`hidePreview.view.webview.reload();return true;`); await loaded('hidePreview'); await hidden('hidePreview');
  await job(`${plugin}.settings.modifier='Alt';await ${plugin}.saveSettings();await app.plugins.disablePlugin('link-float');return true;`);
  await hidden('hideA', '#banner', false); await hidden('hidePreview', '#banner', false);
  assert.equal(await page('hideA', '[...document.querySelectorAll("*")].some(el=>el.getAttributeNames().some(k=>k.startsWith("data-link-float-")))'), false);
  await job(`await app.plugins.enablePlugin('link-float');return true;`); await loaded('hideA'); await hidden('hideA');
  assert.equal(await value(`${plugin}.settings.modifier`), 'Alt');
  assert.equal(await value(`${plugin}.store.data.rules.length`), 1);
  await job(`${plugin}.settings.modifier='Shift';await ${plugin}.saveSettings();return true;`);
  pass('Rules survive page reload, settings changes and plugin restart; unload removes active markers from native tabs');

  await page('hideA', 'savedNode.dispatchEvent(new Event("fixture"));true');
  assert.equal(await page('hideA', 'savedNode.customState.count'), 8);
  await page('hideA', 'window.bannerClone=savedNode.cloneNode(true);document.body.append(bannerClone);true');
  await hidden('hideA', '#banner', false);
  assert.equal(await page('hideA', 'getComputedStyle(bannerClone).display'), 'block');
  await page('hideA', 'bannerClone.remove();true'); await hidden('hideA');
  await page('hideA', 'savedNode.remove();true');
  await job(`await new Promise(r=>setTimeout(r,150));return true;`);
  assert.equal(await value(`${plugin}.store.data.rules.length`), 1);
  await page('hideA', 'document.body.prepend(savedNode);true'); await hidden('hideA');
  pass('Mutation observation suspends ambiguous matches, retains missing rules and reapplies when the original target returns');

  await job(`app.workspace.setActiveLeaf(hidePreview);${plugin}.pages.manage(hidePreview);return true;`);
  await screenshot('hiding-manager.png');
  await hostClick('Show again'); await waitValue(`${plugin}.store.data.rules.length===0`);
  await hidden('hideA', '#banner', false); await hidden('hideB', '#banner', false); await hidden('hidePreview', '#banner', false);
  await hostClick('Done');
  pass('Persistent Show again removes the rule and restores every matching live tab');

  await job(`app.workspace.setActiveLeaf(hideA);return true;`);
  await select('hideA', '.card:nth-child(2)');
  await hostClick('Save'); await waitValue(`${plugin}.store.data.rules.length===1`);
  await hidden('hideA', '.card:nth-child(2)');
  await page('hideA', 'document.querySelector(".cards").prepend(document.querySelector(".card:nth-child(2)"));true');
  await hidden('hideA', '.card:nth-child(2)', false);
  await hidden('hideA', '.card:first-child', false);
  await job(`await ${plugin}.store.remove(${plugin}.store.data.rules[0].id);return true;`);
  pass('A positional selector cannot hide a different sibling after reordering');

  const before = await page('hideA', 'document.querySelector("#draft").value="source draft";history.pushState({fixture:1},"","#source");({id:instanceToken,url:location.href,history:history.length,draft:document.querySelector("#draft").value,scroll:scrollY})');
  const sourceId = await value('hideA.view.webview.getWebContentsId()');
  await guestClick('hideA', '#next', ['shift'], 12);
  await job('await new Promise(r=>setTimeout(r,100));return true;');
  assert.equal(await value(`!!${plugin}.current`), false);
  await guestClick('hideA', '#next', ['shift']);
  await waitValue(`!!${plugin}.current?.pageLeaf()`);
  await job(`window.hideDestination=${plugin}.current.pageLeaf();return true;`); await loaded('hideDestination');
  assert.equal(await value(`${plugin}.current.source===hideA`), true);
  assert.equal(await value("app.workspace.getLeavesOfType('webviewer').length"), 4);
  assert.deepEqual(await page('hideA', '({id:instanceToken,url:location.href,history:history.length,draft:document.querySelector("#draft").value,scroll:scrollY})'), before);
  await job(`await ${plugin}.current.close();return true;`);
  assert.equal(await value('app.workspace.getMostRecentLeaf()===hideA'), true);
  assert.equal(await value('hideA.view.webview.getWebContentsId()'), sourceId);
  assert.deepEqual(await page('hideA', '({id:instanceToken,url:location.href,history:history.length,draft:document.querySelector("#draft").value,scroll:scrollY})'), before);
  pass('Trusted modifier-click in a native tab opens one Peek, ignores drags, and close preserves source URL/history/form/scroll/guest');

  await guestClick('hideA', '#next', ['shift']); await waitValue(`!!${plugin}.current?.pageLeaf()`);
  await job(`window.hideKeptDestination=${plugin}.current.pageLeaf();return true;`); await loaded('hideKeptDestination');
  const destinationId = await value('hideKeptDestination.view.webview.getWebContentsId()');
  await hostClick('Keep as Obsidian tab', '.peek-controls');
  assert.equal(await value('hideKeptDestination.view.webview.getWebContentsId()'), destinationId);
  assert.equal(await value('hideA.view.webview.getWebContentsId()'), sourceId);
  assert.equal(await value('app.workspace.getMostRecentLeaf()===hideKeptDestination'), true);
  pass('Keep promotes only the destination when Peek was opened from a native tab');

  await job(`app.workspace.setActiveLeaf(hideB);return true;`);
  await guestClick('hideB', '#normal');
  await waitValue('hideB.view.webview.getURL().endsWith("/normal")');
  assert.equal(await value(`!!${plugin}.current`), false);
  pass('Ordinary native link clicks retain normal navigation');

  await job(`app.workspace.setActiveLeaf(hideA);const p=${plugin};p.settings.modifier='Alt';await p.saveSettings();electron.remote.webContents.fromId(hideA.view.webview.getWebContentsId()).setZoomFactor(1.25);await new Promise(r=>setTimeout(r,100));return true;`);
  try {
    const origin = await job(`const g=hideA.view.webview;const r=await g.executeJavaScript('(()=>{const r=document.querySelector("#next").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,vw:innerWidth,vh:innerHeight}})()');const b=g.getBoundingClientRect();const origin={x:b.x+r.x*b.width/r.vw,y:b.y+r.y*b.height/r.vh,width:r.width*b.width/r.vw,height:r.height*b.height/r.vh};const wc=electron.remote.webContents.fromId(g.getWebContentsId()),zoom=wc.getZoomFactor(),e={x:Math.round((r.x+r.width/2)*zoom),y:Math.round((r.y+r.height/2)*zoom),button:'left',clickCount:1,modifiers:['alt']};wc.sendInputEvent({...e,type:'mouseDown'});wc.sendInputEvent({...e,type:'mouseUp'});return origin;`);
    await waitValue(`!!${plugin}.current`);
    const actual = await value(`${plugin}.current.origin`);
    for (const key of ['x','y','width','height']) assert.ok(Math.abs(actual[key] - origin[key]) < 2, key);
    await job(`await ${plugin}.current.close();return true;`);
    await select('hideA', '#banner'); await hostClick('Cancel'); await hidden('hideA', '#banner', false);
  } finally {
    await job(`electron.remote.webContents.fromId(hideA.view.webview.getWebContentsId()).setZoomFactor(1);${plugin}.settings.modifier='Shift';await ${plugin}.saveSettings();return true;`);
  }
  pass('Configured Alt-click and picker coordinates work at 125 percent web zoom');

  await job(`app.workspace.setActiveLeaf(hideA);return true;`);
  await select('hideA', '#banner'); await hostClick('Save'); await waitValue(`${plugin}.store.data.rules.length===1`);
  await job(`await ${plugin}.openUrl('${base}/guard',hideSource);window.hideGuard=${plugin}.current.pageLeaf();return true;`);
  await loaded('hideGuard'); await hidden('hideGuard');
  await guestClick('hideGuard', '#draft');
  await job(`const w=hideGuard.view.webview;w.focus();w.sendInputEvent({type:'keyDown',keyCode:'a'});w.sendInputEvent({type:'char',keyCode:'a'});w.sendInputEvent({type:'keyUp',keyCode:'a'});window.hideClosing=${plugin}.current.close();return true;`);
  await waitValue("!!document.querySelector('.peek-confirmation')");
  await hostClick('Cancel', '.peek-confirmation');
  await waitValue(`!${plugin}.current.closing`);
  assert.equal(await job('return await hideClosing;'), false);
  await hidden('hideGuard'); assert.equal(await page('hideGuard', 'document.querySelector("#draft").value'), 'a');
  await page('hideGuard', 'window.onbeforeunload=null;true'); await job(`await ${plugin}.current.close();return true;`);
  pass('Cancel in the native close warning retains confirmed hiding and the live draft');

  // Overlap retains hiding until every owning rule has been removed.
  await job(`const r=${plugin}.store.data.rules[0];await ${plugin}.store.add({...r,id:crypto.randomUUID()});await ${plugin}.store.remove(r.id);return true;`);
  await hidden('hideA'); assert.equal(await value(`${plugin}.store.data.rules.length`), 1);
  pass('Overlapping saved rules retain shared target ownership after one rule is removed');

  // Confirm exact-origin scope on another host serving the same fixture.
  await job(`window.hideOtherOrigin=app.workspace.getLeaf('tab');await hideOtherOrigin.setViewState({type:'webviewer',state:{url:'http://localhost:4182/'},active:true});return true;`);
  await loaded('hideOtherOrigin'); await hidden('hideOtherOrigin', '#banner', false);
  await job('hideOtherOrigin.detach();return true;');
  pass('The same selector on a different origin is not hidden');

  const bounds = await value('electron.remote.getCurrentWindow().getBounds()');
  const theme = await value("document.body.classList.contains('theme-dark')?'theme-dark':'theme-light'");
  try {
    await job(`app.workspace.setActiveLeaf(hideA);${plugin}.pages.manage(hideA);electron.remote.getCurrentWindow().setSize(440,740);await new Promise(r=>setTimeout(r,150));return true;`);
    for (const nextTheme of ['theme-light','theme-dark']) {
      const geometry = await job(`document.body.classList.remove('theme-dark','theme-light');document.body.classList.add('${nextTheme}');const p=document.querySelector('.peek-picker'),r=p.getBoundingClientRect();return {fits:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,buttons:[...p.querySelectorAll('button')].every(b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})};`);
      assert.deepEqual(geometry, { fits: true, buttons: true });
    }
    await screenshot('hiding-manager-narrow.png');
    await hostClick('Done');
  } finally {
    await job(`electron.remote.getCurrentWindow().setBounds(${JSON.stringify(bounds)});document.body.classList.remove('theme-dark','theme-light');document.body.classList.add('${theme}');return true;`);
  }
  pass('Rule management stays within a narrow viewport with reachable controls in light and dark themes');

  // Reload only the disposable vault renderer, retaining the saved rule.
  await job(`app.workspace.requestSaveLayout();await new Promise(r=>setTimeout(r,1800));return true;`);
  await cli('eval', 'code=setTimeout(()=>location.reload(),50);true');
  await new Promise(resolve => setTimeout(resolve,1500));
  await waitValue(`!!${plugin}?.pages`, 20000);
  await job(`window.hideRestored=app.workspace.getLeavesOfType('webviewer').find(l=>l.getViewState().state?.url?.startsWith('${base}/'));if(!hideRestored)throw Error('Restored leaf missing');app.workspace.setActiveLeaf(hideRestored);await hideRestored.loadIfDeferred();return true;`);
  await loaded('hideRestored'); await hidden('hideRestored');
  assert.equal(await value(`${plugin}.store.data.rules.length`), 1);
  pass('Saved rules and restored ordinary tabs reapply after a full vault renderer reload');

  const runtime = await value('({electron:process.versions.electron,chromium:process.versions.chrome,platform:process.platform})');
  await writeFile('test-results/hiding-results.json', JSON.stringify({ date: new Date().toISOString(), runtime, rows }, null, 2) + '\n');
} catch (error) {
  await writeFile('.lab/hiding-partial.json', JSON.stringify({ rows, error: String(error) }, null, 2));
  throw error;
} finally {
  await job(`const p=${plugin};p?.current?.forceClose();if(p){for(const r of [...p.store.data.rules])await p.store.remove(r.id);p.settings.modifier='Shift';await p.saveSettings();}for(const l of app.workspace.getLeavesOfType('webviewer')){if(l.getViewState().state?.url?.startsWith('${base}'))l.detach();}return true;`).catch(() => {});
  server.close();
}
