import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { job, value } from './lab-cli.mjs';

// Development recording of the fixture-only lab window. No page capture is
// written to disk by the production plugin's closing animation.
const directory = path.resolve('.lab/motion-demo');
await mkdir(directory, { recursive: true });
const plugin = "app.plugins.plugins['link-float']";
let attached = false;
try {
  const info = await value("({path:app.vault.adapter.basePath,web:app.workspace.getLeavesOfType('webviewer').map(l=>l.view.webview?.getURL())})");
  assert.equal(info.path, path.resolve('.lab/Peek Lab'));
  assert.equal(info.web.length, 0, 'Recording starts with only the test note open');
  await job(`window.motionDemoSource=app.workspace.getLeavesOfType('markdown')[0];await motionDemoSource.setViewState({type:'markdown',state:{file:'Preview checks.md',mode:'preview'},active:true});app.workspace.setActiveLeaf(motionDemoSource);${plugin}.settings.modifier='Shift';electron.remote.getCurrentWindow().show();electron.remote.getCurrentWindow().focus();await new Promise(r=>setTimeout(r,250));return true;`);
  await job(`
    const contents=electron.remote.getCurrentWebContents(),d=contents.debugger;
    if(d.isAttached())throw Error('An existing debugger owns the lab window');d.attach('1.3');
    window.motionDemoFrames=[];
    window.motionDemoListener=(_event,method,params)=>{
      if(method!=='Page.screencastFrame')return;
      const index=motionDemoFrames.length;
      require('fs').writeFileSync(${JSON.stringify(directory)}+'/'+String(index).padStart(5,'0')+'.jpg',Buffer.from(params.data,'base64'));
      motionDemoFrames.push({file:String(index).padStart(5,'0')+'.jpg',timestamp:params.metadata.timestamp});
      void d.sendCommand('Page.screencastFrameAck',{sessionId:params.sessionId});
    };
    d.on('message',motionDemoListener);
    await d.sendCommand('Page.startScreencast',{format:'jpeg',quality:90,maxWidth:1496,maxHeight:938,everyNthFrame:1});return true;
  `);
  attached = true;
  await job(`
    const pause=ms=>new Promise(r=>setTimeout(r,ms));
    const contents=electron.remote.getCurrentWebContents();
    const click=(x,y,modifiers=[])=>{const e={x:Math.round(x),y:Math.round(y),button:'left',clickCount:1,modifiers};contents.sendInputEvent({...e,type:'mouseDown'});contents.sendInputEvent({...e,type:'mouseUp'});};
    const open=async selector=>{const a=motionDemoSource.view.containerEl.querySelector(selector);if(!a)throw Error('Demo link missing');const r=a.getBoundingClientRect();click(r.x+r.width/2,r.y+r.height/2,['shift']);await pause(1150);};
    await pause(400);
    await open('a[href="http://127.0.0.1:4180/article?motion-demo=upper"]');
    const frame=document.querySelector('.peek-surface').getBoundingClientRect();click(frame.left-12,frame.top+200);await pause(700);
    await open('a[href="http://127.0.0.1:4180/article?motion-demo=lower"]');
    document.querySelector('.peek-controls [aria-label="Close preview"]').focus();contents.sendInputEvent({type:'keyDown',keyCode:'Escape'});contents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await pause(600);
    return true;
  `);
  const frames = await job(`const d=electron.remote.getCurrentWebContents().debugger;await d.sendCommand('Page.stopScreencast');d.removeListener('message',motionDemoListener);return motionDemoFrames;`);
  assert.ok(frames.length >= 20, 'Recording needs actual intermediate frames');
  await writeFile(path.join(directory, 'frames.json'), JSON.stringify(frames, null, 2) + '\n');
  await writeFile(path.join(directory, 'frames.ffconcat'), 'ffconcat version 1.0\n' + frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(1 / 120, (frames[i + 1]?.timestamp ?? f.timestamp + .6) - f.timestamp).toFixed(6)}\n`).join('') + `file '${frames.at(-1).file}'\n`);
  console.log('Recorded', frames.length, 'frames in', directory);
} finally {
  if (attached) await job(`const d=electron.remote.getCurrentWebContents().debugger;try{await d.sendCommand('Page.stopScreencast');}catch{}if(window.motionDemoListener)d.removeListener('message',motionDemoListener);d.detach();${plugin}.current?.forceClose();await app.workspace.saveLayout();return true;`).catch(() => {});
}
