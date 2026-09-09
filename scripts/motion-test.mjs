import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { job, value, waitValue } from './lab-cli.mjs';

const results = [];
const check = (name, detail) => { results.push({ name, result: 'pass', detail }); console.log('PASS', name, detail ?? ''); };
const plugin = "app.plugins.plugins['link-float']";
const frame = "document.querySelector('.peek-surface')";
const guest = `${frame}?.querySelector('webview')`;
const article = 'http://127.0.0.1:4180/article?motion=1';
const origin = { x: 220, y: 160, width: 100, height: 20 };
const open = (rect = origin) => job(`await ${plugin}.openUrl('${article}',motionSource,${JSON.stringify(rect)});return true;`);
const close = () => job(`return await ${plugin}.current?.close();`);
const ready = () => job(`const w=${guest};for(let i=0;i<100;i++){try{if(await w.executeJavaScript('!!window.fixtureReady'))return true;}catch{}await new Promise(r=>setTimeout(r,40));}throw Error('Fixture unavailable');`);

async function trace(action) {
  return job(`
    const frames=[],start=performance.now();let recording=true;
    const sample=()=>{const el=${frame};if(el){const p=el.querySelector('.workspace-leaf-content'),r=p.getBoundingClientRect(),w=el.querySelector('webview');let id=null;try{id=w?.getWebContentsId();}catch{}frames.push({t:performance.now()-start,phase:el.dataset.peekMotion??'idle',rect:r.toJSON(),opacity:getComputedStyle(p).opacity,backdrop:getComputedStyle(el,'::backdrop').opacity,id,cover:!!el.querySelector('.peek-close-cover'),sourceVisible:getComputedStyle(motionSource.containerEl).display!=='none'&&motionSource.containerEl.getBoundingClientRect().width>0});}if(recording)requestAnimationFrame(sample);};
    requestAnimationFrame(sample);
    try {${action}} finally {recording=false;}
    return frames;
  `);
}

let debuggerAttached = false;
try {
  const existing = await value("app.workspace.getLeavesOfType('webviewer').map(l=>l.view.webview?.getURL())");
  assert.ok(existing.every(url => url?.startsWith('http://127.0.0.1:')), 'Use fixture-only lab');
  await job(`${plugin}.current?.forceClose();for(const l of app.workspace.getLeavesOfType('webviewer'))l.detach();window.motionSource=app.workspace.getLeavesOfType('markdown')[0];app.workspace.setActiveLeaf(motionSource);electron.remote.getCurrentWindow().show();electron.remote.getCurrentWindow().focus();return true;`);
  await job(`const d=electron.remote.getCurrentWebContents().debugger;if(d.isAttached())throw Error('An existing debugger owns this lab window');d.attach('1.3');await d.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});return true;`);
  debuggerAttached = true;

  const opening = await trace(`await ${plugin}.openUrl('${article}',motionSource,${JSON.stringify(origin)});await new Promise(r=>setTimeout(r,500));`);
  const full = opening.at(-1).rect;
  const growing = opening.filter(f => f.phase === 'opening');
  assert.ok(growing.length >= 3, 'Opening has visible intermediate frames');
  assert.ok(growing[0].rect.width < full.width * .9, 'Starts near the link instead of appearing full size');
  assert.ok(Math.abs(growing[0].rect.x - origin.x) < Math.abs(full.x - origin.x) + full.width * .4);
  assert.equal(new Set(opening.map(f => f.id).filter(Boolean)).size, 1, 'No guest recreation during motion');
  assert.equal(opening.at(-1).phase, 'idle');
  assert.equal(opening.at(-1).opacity, '1');
  assert.ok(opening.every(f => f.opacity === (f.phase === 'preparing' ? '0' : '1')), 'Preparation leaves the source visible; movement uses opaque page pixels');
  assert.ok(growing.some(f => Number(f.backdrop) > 0 && Number(f.backdrop) < 1));
  assert.ok(opening.every(f => f.sourceVisible), 'The original note remains painted behind every opening frame');
  await ready();
  check('Opening has intermediate page and backdrop frames and retains one live guest', { samples: growing.length, firstWidth: growing[0].rect.width, finalWidth: full.width, finalFrameMs: Math.round(opening.at(-1).t) });

  const closing = await trace(`await ${plugin}.current.close();`);
  const shrinking = closing.filter(f => f.phase === 'closing');
  assert.ok(shrinking.length >= 2, 'Closing has intermediate frames');
  assert.ok(shrinking.at(-1).rect.width < shrinking[0].rect.width * .75);
  assert.ok(shrinking.every(f => f.cover), 'The native blank-navigation probe stays covered');
  assert.ok(shrinking.every(f => f.opacity === '1'), 'The page stays opaque while returning to the link');
  assert.ok(closing.every(f => f.sourceVisible), 'The original note remains painted behind every closing frame');
  assert.equal(await value(`!!${frame}||motionSource.containerEl.inert||!!document.querySelector('.peek-close-cover, .peek-source')`), false);
  check('Allowed close shrinks covered page pixels and removes every visual layer', { samples: shrinking.length, totalCloseMs: Math.round(closing.at(-1).t) });

  const reversal = await job(`
    await ${plugin}.openUrl('${article}',motionSource,${JSON.stringify(origin)});
    const p=${plugin}.current,m=p.motion,el=${frame},page=el.querySelector('.workspace-leaf-content');
    m.cancelPreparation?.();el.dataset.peekMotion='opening';
    const times=[0,35,70,140,196,240,280],sample=()=>{const r=page.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,opacity:getComputedStyle(page).opacity,backdrop:Number(getComputedStyle(el,'::backdrop').opacity)};};
    const forward=times.map(t=>{for(const a of m.animations){a.pause();a.currentTime=t;}return sample();});
    m.settle();
    const originalClose=m.close.bind(m);let backward,duration;
    m.close=async()=>{const pending=originalClose();duration=m.animations[0].effect.getTiming().duration;backward=times.map(t=>{for(const a of m.animations){a.pause();a.currentTime=280-t;}return sample();});for(const a of m.animations)a.play();await pending;};
    // Wait for the real page before its native close check captures it.
    for(let i=0;i<100;i++){try{if(await p.guest.executeJavaScript('!!window.fixtureReady'))break;}catch{}await new Promise(r=>setTimeout(r,30));}
    await p.close();return {duration,times,forward,backward};
  `);
  assert.equal(reversal.duration, 280);
  assert.equal(reversal.backward.length, reversal.forward.length);
  for (let i = 0; i < reversal.forward.length; i++) {
    for (const property of ['x', 'y', 'width', 'height', 'backdrop']) assert.ok(Math.abs(reversal.forward[i][property] - reversal.backward[i][property]) < .3, `Mirrored frame ${i}: ${property}`);
    assert.equal(reversal.backward[i].opacity, '1');
  }
  check('Closing reproduces opening geometry and backdrop in reverse on the same timeline', { duration: reversal.duration, comparedFrames: reversal.times.length });

  await open(); await ready();
  await job(`const p=${plugin}.current;window.motionCloseCheck=p.guard.check.bind(p.guard);p.guard.check=async guest=>{const result=await motionCloseCheck(guest);window.motionGuardResult=result;await new Promise(resolve=>window.motionResumeGuard=resolve);return result;};window.motionClosing=p.close();return true;`);
  await waitValue("typeof window.motionResumeGuard==='function'");
  const blankCovered = await value(`({url:${guest}.getURL(),result:motionGuardResult,cover:!!${frame}.querySelector('.peek-close-cover'),tag:${frame}.querySelector('.peek-close-cover')?.tagName,color:(()=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.drawImage(${frame}.querySelector('.peek-close-cover'),10,10,1,1,0,0,1,1);return [...x.getImageData(0,0,1,1).data];})()})`);
  assert.equal(blankCovered.url, 'about:blank'); assert.equal(blankCovered.result, 'allowed'); assert.equal(blankCovered.cover, true); assert.equal(blankCovered.tag, 'CANVAS'); assert.deepEqual(blankCovered.color, [247,248,252,255]);
  await job(`require('fs').writeFileSync(${JSON.stringify(new URL('../test-results/close-cover-proof.png', import.meta.url).pathname)},(await electron.remote.getCurrentWebContents().capturePage()).toPNG());motionResumeGuard();await motionClosing;delete window.motionResumeGuard;return true;`);
  check('The last page frame remains visible after native navigation commits about:blank');

  await open(); await ready();
  const kept = await job(`const p=${plugin}.current,w=${guest};const before={id:w.getWebContentsId(),token:await w.executeJavaScript('instanceToken')};p.keep();const after={id:w.getWebContentsId(),token:await w.executeJavaScript('instanceToken')};return {before,after,transformed:getComputedStyle(w.closest('.workspace-leaf-content')).transform,animations:document.getAnimations().filter(a=>a.effect?.target?.closest?.('.peek-surface')).length};`);
  assert.deepEqual(kept.before, kept.after); assert.equal(kept.transformed, 'none'); assert.equal(kept.animations, 0);
  await job(`for(const l of app.workspace.getLeavesOfType('webviewer'))l.detach();return true;`);
  check('Keep cancels motion and preserves the same usable page', kept.before);

  const earlyKeep = await job(`await ${plugin}.openUrl('${article}',motionSource,${JSON.stringify(origin)});const p=${plugin}.current,w=${guest},leaf=p.leaf,phase=${frame}.dataset.peekMotion;p.keep();await new Promise(r=>setTimeout(r,350));return {phase,sameElement:leaf.view.webview===w&&w.isConnected,overlay:!!${frame},transform:getComputedStyle(w.closest('.workspace-leaf-content')).transform,inert:motionSource.containerEl.inert};`);
  assert.equal(earlyKeep.phase, 'preparing'); assert.equal(earlyKeep.sameElement, true); assert.equal(earlyKeep.overlay, false); assert.equal(earlyKeep.transform, 'none'); assert.equal(earlyKeep.inert, false);
  await job(`for(const l of app.workspace.getLeavesOfType('webviewer'))l.detach();return true;`);
  check('Keep during the first opening frame cannot later restore the overlay', earlyKeep);

  const interrupted = await trace(`await ${plugin}.openUrl('${article}',motionSource,${JSON.stringify(origin)});await new Promise(r=>setTimeout(r,50));await ${plugin}.current.close();await new Promise(r=>setTimeout(r,320));`);
  assert.equal(await value(`!!${frame}||motionSource.containerEl.inert`), false);
  check('Closing during opening cannot resurrect a preview or leave the note inert', { phases: [...new Set(interrupted.map(f => f.phase))] });

  await open();
  await waitValue(`${frame}?.dataset.peekMotion==='opening'`);
  await job(`for(const a of ${plugin}.current.motion.animations){a.pause();a.currentTime=35;}return true;`);
  await ready();
  const outsideDuringOpening = await job(`const el=${frame},full=el.getBoundingClientRect(),page=el.querySelector('.workspace-leaf-content').getBoundingClientRect(),x=Math.round(full.right-20),y=Math.round(full.top+100);const contents=electron.remote.getCurrentWebContents(),e={x,y,button:'left',clickCount:1};contents.sendInputEvent({...e,type:'mouseDown'});contents.sendInputEvent({...e,type:'mouseUp'});return {insideFinal:x>full.left&&x<full.right&&y>full.top&&y<full.bottom,outsidePage:x<page.left||x>page.right||y<page.top||y>page.bottom};`);
  assert.deepEqual(outsideDuringOpening, { insideFinal: true, outsidePage: true });
  await waitValue(`!${frame}`);
  assert.equal(await value("motionSource.containerEl.inert||!!document.querySelector('.peek-source')"), false);
  check('Outside click follows the visible page boundary while it is opening');

  await open();
  await job(`await app.plugins.disablePlugin('link-float');await new Promise(r=>setTimeout(r,350));await app.plugins.enablePlugin('link-float');return true;`);
  assert.equal(await value(`!!${frame}||motionSource.containerEl.inert||!!document.querySelector('.peek-close-cover')`), false);
  check('Plugin unload during opening cancels animation and releases the note');

  await open(); await ready();
  await job(`const p=${plugin}.current,contents=electron.remote.webContents.fromId(${guest}.getWebContentsId());window.motionOriginalCapture=contents.capturePage;contents.capturePage=()=>new Promise(resolve=>window.motionResumeCapture=resolve);window.motionClosing=p.close();return true;`);
  await waitValue("typeof window.motionResumeCapture==='function'");
  await job(`${plugin}.current.forceClose();motionResumeCapture({isEmpty:()=>false,toDataURL:()=>{throw Error('Late capture must not be used');}});await motionClosing;delete window.motionResumeCapture;return true;`);
  assert.equal(await value(`!!${frame}||motionSource.containerEl.inert||!!document.querySelector('.peek-close-cover')`), false);
  check('A late page capture after forced teardown cannot recreate a visual layer');

  await open(); await ready();
  const failedCapture = await job(`const p=${plugin}.current,contents=electron.remote.webContents.fromId(${guest}.getWebContentsId());contents.capturePage=()=>Promise.reject(Error('Controlled capture failure'));const closed=await p.close();return {closed,overlay:!!${frame},inert:motionSource.containerEl.inert};`);
  assert.deepEqual(failedCapture, { closed: true, overlay: false, inert: false });
  check('Failed image capture still completes an allowed close and releases the note');

  await open(); await ready();
  const lateBitmap = await job(`
    const original=window.createImageBitmap;let resume,bitmap;
    window.createImageBitmap=async(...args)=>{const value=await original(...args);if(!(args[0] instanceof VideoFrame))return value;bitmap=value;return new Promise(resolve=>resume=()=>resolve(value));};
    try{
      const closed=await ${plugin}.current.close();
      if(!resume)throw Error('Bitmap conversion was not reached');
      resume();await new Promise(r=>setTimeout(r,20));
      return {closed,overlay:!!${frame},lateWidth:bitmap.width,inert:motionSource.containerEl.inert};
    }finally{window.createImageBitmap=original;resume?.();}
  `);
  assert.deepEqual(lateBitmap, { closed: true, overlay: false, lateWidth: 0, inert: false });
  check('A timed-out bitmap conversion completes close and releases its late image', lateBitmap);

  await job(`await electron.remote.getCurrentWebContents().debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});return true;`);
  const reduced = await trace(`await ${plugin}.openUrl('${article}',motionSource,${JSON.stringify(origin)});await new Promise(r=>setTimeout(r,100));`);
  assert.ok(reduced.length); assert.ok(reduced.every(f => f.phase === 'idle' && f.opacity === '1'));
  await ready();
  const reducedClose = await trace(`await ${plugin}.current.close();`);
  assert.ok(reducedClose.every(f => f.phase === 'idle' && !f.cover));
  check('Reduced motion opens and closes without scaling, fading, or a captured cover');

  await job(`await electron.remote.getCurrentWebContents().debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});return true;`);
  await open(null); await ready(); await waitValue(`!${frame}.dataset.peekMotion`);
  assert.equal(await value(`getComputedStyle(${frame}.querySelector('.workspace-leaf-content')).transform`), 'none'); await close();
  check('Command opening without link geometry settles cleanly at the standard frame');

  const version = await value("app.plugins.manifests['link-float'].version");
  await writeFile('test-results/motion-results.json', JSON.stringify({ date: new Date().toISOString(), pluginVersion: version, results, traces: { opening, closing, interrupted, reduced } }, null, 2) + '\n');
} catch (error) {
  console.error(error); await writeFile('.lab/motion-partial.json', JSON.stringify({ results, error: String(error) }, null, 2)); process.exitCode = 1;
} finally {
  await job(`${plugin}.current?.forceClose();if(typeof window.motionResumeGuard==='function')motionResumeGuard();if(typeof window.motionResumeCapture==='function')motionResumeCapture(null);return true;`).catch(() => {});
  if (debuggerAttached) await job(`const d=electron.remote.getCurrentWebContents().debugger;await d.sendCommand('Emulation.setEmulatedMedia',{features:[]});d.detach();return true;`).catch(() => {});
}
