import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { job } from './lab-cli.mjs';

// This diagnostic measures Chromium's presented-frame reports, not a video's
// encoded frame rate. It temporarily owns only the Peek Lab debugger.
const vaultPath = fileURLToPath(new URL('../.lab/Peek Lab', import.meta.url));
const rawPath = new URL('../.lab/performance/current-trace.json', import.meta.url);
await mkdir(new URL('../.lab/performance/', import.meta.url), { recursive: true });
const metadata = await job(`
  const plugin=app.plugins.plugins['link-float'];
  if(app.vault.adapter.basePath!==VAULTPATH)throw Error('Wrong vault');
  if(plugin.current||app.workspace.getLeavesOfType('webviewer').length)throw Error('Close existing lab pages before measuring');
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)throw Error('Reduced motion is active');
  const contents=electron.remote.getCurrentWebContents(),d=contents.debugger,win=electron.remote.getCurrentWindow();
  if(d.isAttached())throw Error('Another debugger owns this window');
  win.show();win.focus();d.attach('1.3');
  let done,started=false,ended=false,watcher;
  const completed=new Promise(resolve=>done=resolve);
  const listener=(_event,method,params)=>{if(method==='Tracing.tracingComplete')done(params.stream);};
  d.on('message',listener);
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  try{
    // Streaming avoids delivering thousands of trace events through Electron
    // remote callbacks, which would itself stall the application.
    await d.sendCommand('Tracing.start',{categories:'blink.user_timing,cc,benchmark',options:'record-until-full',transferMode:'ReturnAsStream'});
    started=true;
    await delay(300);
    for(let i=0;i<3;i++){
      performance.mark('peek-open-'+i);
      await plugin.openUrl('http://127.0.0.1:4180/article?performance='+i,app.workspace.getLeavesOfType('markdown')[0],{x:220,y:160,width:100,height:20});
      const preview=plugin.current;
      watcher=new MutationObserver(()=>{
        if(preview.motion?.surface.dataset.peekMotion==='opening'){
          performance.mark('motion-start-'+i);watcher.disconnect();
        }
      });
      watcher.observe(preview.motion.surface,{attributes:true,attributeFilter:['data-peek-motion']});
      await delay(600);watcher.disconnect();
      for(const key of ['cover','close']){
        const original=preview.motion[key].bind(preview.motion);
        preview.motion[key]=async(...args)=>{
          performance.mark(key+'-start-'+i);
          const result=await original(...args);
          performance.mark(key+'-end-'+i);return result;
        };
      }
      performance.mark('peek-close-'+i);await preview.close();
      performance.mark('peek-closed-'+i);await delay(150);
    }
    await d.sendCommand('Tracing.end');ended=true;
    const handle=await completed,chunks=[];
    try{
      for(;;){
        const part=await d.sendCommand('IO.read',{handle,size:1048576});
        chunks.push(part.base64Encoded?Buffer.from(part.data,'base64').toString():part.data);
        if(part.eof)break;
      }
    }finally{await d.sendCommand('IO.close',{handle});}
    const events=JSON.parse(chunks.join('')).traceEvents.filter(event=>event.pid===process.pid);
    require('fs').writeFileSync(RAWPATH,JSON.stringify({traceEvents:events}));
    const display=electron.remote.screen.getDisplayMatching(win.getBounds());
    return {date:new Date().toISOString(),pluginVersion:plugin.manifest.version,rendererPid:process.pid,electron:process.versions.electron,display:{label:display.label,frequency:display.displayFrequency,scaleFactor:display.scaleFactor},window:win.getBounds()};
  }finally{
    watcher?.disconnect();
    if(started&&!ended)await d.sendCommand('Tracing.end').catch(()=>{});
    d.removeListener('message',listener);d.detach();plugin.current?.forceClose();
    for(const entry of performance.getEntriesByType('mark'))if(/^(peek-open-|motion-start-|cover-(start|end)-|close-(start|end)-|peek-close-|peek-closed-)/.test(entry.name))performance.clearMarks(entry.name);
  }
`.replace('VAULTPATH', JSON.stringify(vaultPath)).replace('RAWPATH', JSON.stringify(fileURLToPath(rawPath))), 20000);

const events = JSON.parse(await readFile(rawPath, 'utf8')).traceEvents;
const mark = name => {
  const event = events.find(event => event.cat === 'blink.user_timing' && event.name === name);
  assert.ok(event, 'Missing trace marker: ' + name);
  return event.ts;
};
function frames(start) {
  const unique = new Map();
  for (const event of events) {
    if (event.name !== 'PipelineReporter' || event.ph !== 'b' || event.ts < start || event.ts >= start + 280000) continue;
    const report = event.args.frame_reporter;
    const key = [report.layer_tree_host_id, report.frame_source, report.frame_sequence].join(':');
    if (!unique.has(key)) unique.set(key, new Set());
    unique.get(key).add(report.state);
  }
  const counts = { presented: 0, partial: 0, dropped: 0, noUpdate: 0 };
  for (const states of unique.values()) {
    if (states.has('STATE_PRESENTED_ALL')) counts.presented++;
    else if (states.has('STATE_PRESENTED_PARTIAL')) counts.partial++;
    else if (states.has('STATE_DROPPED')) counts.dropped++;
    else counts.noUpdate++;
  }
  return counts;
}
const trials = Array.from({ length: 3 }, (_, i) => ({
  openingPreparationMs: (mark('motion-start-' + i) - mark('peek-open-' + i)) / 1000,
  opening: frames(mark('motion-start-' + i)),
  closing: frames(mark('close-start-' + i)),
  closingCoverMs: (mark('cover-end-' + i) - mark('cover-start-' + i)) / 1000,
  closingStartMs: (mark('close-start-' + i) - mark('peek-close-' + i)) / 1000,
  closingTotalMs: (mark('peek-closed-' + i) - mark('peek-close-' + i)) / 1000,
}));
const report = {
  ...metadata,
  method: 'Three fixture cycles without screen recording. Chromium PipelineReporter states during each 280 ms motion interval, deduplicated by compositor/frame source/sequence. Preparation and cover time are reported separately.',
  limitations: 'A local diagnostic on this display and runtime; no guarantee of zero dropped frames on every website or under other system load. The raw trace is kept in the ignored lab directory.',
  trials,
};
await writeFile(new URL('../test-results/motion-performance-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ display: report.display, pluginVersion: report.pluginVersion, trials }, null, 2));
