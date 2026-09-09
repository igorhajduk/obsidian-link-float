import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { cli, job, value } from './lab-cli.mjs';

// Reload only the fixture vault's renderer, never quit or restart the shared application.
const fixture = 'http://127.0.0.1:4179/';
const article = 'http://127.0.0.1:4180/article?window-reload=1';
const before = await job(`
  await app.plugins.plugins['link-float'].current?.close();
  const existing=app.workspace.getLeavesOfType('webviewer');
  if(existing.length)throw Error('Recovery check requires an empty test workspace');
  const source=app.workspace.getLeavesOfType('markdown')[0];
  await source.setViewState({type:'markdown',state:{file:'Welcome.md',mode:'preview'},active:true});
  const kept=app.workspace.getLeaf('tab');
  await kept.setViewState({type:'webviewer',state:{url:'${fixture}?kept-on-reload=1'},active:true});
  await kept.loadIfDeferred();
  for(let i=0;i<100;i++){try{if(await kept.view.webview.executeJavaScript('!!window.fixtureReady'))break;}catch{}await new Promise(r=>setTimeout(r,100));}
  for(let i=0;i<100&&!kept.getViewState().state?.url;i++)await new Promise(r=>setTimeout(r,50));
  if(!kept.getViewState().state?.url)throw Error('Retained tab has not committed its URL');
  await app.plugins.plugins['link-float'].openUrl('${article}',source);
  const plugin=app.plugins.plugins['link-float'];
  for(let i=0;i<100&&!plugin.current.reading.initialized;i++)await new Promise(r=>setTimeout(r,50));
  await document.querySelector('.peek-surface webview').executeJavaScript('scrollTo(0,2100);document.querySelector("#draft").value="discard on reload";true');
  await plugin.current.reading.capture();
  if(plugin.positions.get('${article}')?.y!==2100)throw Error('Position not saved before reload');
  const preview=app.workspace.getLeavesOfType('webviewer').find(l=>l.containerEl.classList.contains('peek-surface'));
  app.workspace.setActiveLeaf(preview);
  await app.workspace.saveLayout();
  return {sourceId:source.id,keptId:kept.id,previewId:preview.id,timeOrigin:performance.timeOrigin,version:app.plugins.manifests['link-float'].version};
`);
console.log('Reloading only the Peek Lab window');
await cli('eval', "code=setTimeout(()=>location.reload(),150);'scheduled'");
let restored;
const deadline = Date.now() + 30000;
while (Date.now() < deadline) {
  try {
    const state = await value(`(()=>{if(performance.timeOrigin===${before.timeOrigin}||!app.workspace.layoutReady||!app.plugins.plugins['link-float'])return null;return {timeOrigin:performance.timeOrigin,activeId:app.workspace.getMostRecentLeaf()?.id,markdown:app.workspace.getLeavesOfType('markdown').map(l=>({id:l.id,file:l.getViewState().state.file})),web:app.workspace.getLeavesOfType('webviewer').map(l=>({id:l.id,url:l.getViewState().state.url})),overlays:document.querySelectorAll('.peek-surface').length,inert:app.workspace.getLeavesOfType('markdown').some(l=>l.containerEl.inert)};})()`);
    if (state) { restored = state; break; }
  } catch { /* Renderer temporarily unavailable while it reloads. */ }
  await new Promise(resolve => setTimeout(resolve, 200));
}
assert.ok(restored, 'Peek Lab reloaded within the deadline');
assert.notEqual(restored.timeOrigin, before.timeOrigin);
assert.equal(restored.activeId, before.sourceId);
assert.deepEqual(restored.web, [{ id: before.keptId, url: `${fixture}?kept-on-reload=1` }]);
assert.ok(restored.markdown.some(l=>l.id===before.sourceId&&l.file==='Welcome.md'));
assert.equal(restored.overlays, 0); assert.equal(restored.inert, false);
console.log('PASS Reload restores the note and retained page, without the temporary preview');

const session = await job(`
  const source=app.workspace.getLeavesOfType('markdown')[0];
  await app.plugins.plugins['link-float'].openUrl('${fixture}',source);
  const w=document.querySelector('.peek-surface webview');
  for(let i=0;i<100;i++){try{if(await w.executeJavaScript('!!window.fixtureReady'))break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const status=await w.executeJavaScript('document.querySelector("#session").textContent');
  await app.plugins.plugins['link-float'].current.close();
  for(const l of app.workspace.getLeavesOfType('webviewer'))l.detach();
  app.workspace.setActiveLeaf(source);await app.workspace.saveLayout();
  return status;
`);
assert.match(session, /Signed in/);
console.log('PASS Fixture session survives the window reload');
const reading = await job(`
  const plugin=app.plugins.plugins['link-float'],source=app.workspace.getLeavesOfType('markdown')[0];
  await plugin.openUrl('${article}',source);
  for(let i=0;i<100&&!plugin.current.reading.initialized;i++)await new Promise(r=>setTimeout(r,50));
  const state=await document.querySelector('.peek-surface webview').executeJavaScript('({y:scrollY,draft:document.querySelector("#draft").value})');
  await plugin.current.close();return state;
`);
assert.deepEqual(reading,{y:2100,draft:''});
console.log('PASS Reading position survives the window reload without restoring the draft');
await writeFile('test-results/recovery-results.json', JSON.stringify({ date: new Date().toISOString(), pluginVersion: before.version, before, restored, fixtureSession: session, reading, scope: 'Peek Lab renderer reload, not a full application restart' }, null, 2) + '\n');
