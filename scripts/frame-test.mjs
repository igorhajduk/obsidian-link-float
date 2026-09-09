import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { job } from './lab-cli.mjs';

const vault = fileURLToPath(new URL('../.lab/Peek Lab', import.meta.url));
const report = await job(`
  if(app.vault.adapter.basePath!==VAULT)throw Error('Wrong vault');
  const plugin=app.plugins.plugins['link-float'],workspace=app.workspace;
  if(plugin.current||workspace.getLeavesOfType('webviewer').length)throw Error('Existing lab page');
  const left=workspace.leftSplit,right=workspace.rightSplit;
  const original={left:left.collapsed,right:right.collapsed,leftSize:left.size,rightSize:right.size};
  const delay=()=>new Promise(resolve=>setTimeout(resolve,350)),states=[];
  const capture=label=>{
    const surface=document.querySelector('.peek-surface'),r=surface.getBoundingClientRect(),w=workspace.rootSplit.containerEl.getBoundingClientRect(),p=plugin.current;
    states.push({label,page:r.toJSON(),workspace:w.toJSON(),guest:p.guest.getWebContentsId(),controls:[...surface.querySelectorAll('.peek-controls > button')].map(button=>{const b=button.getBoundingClientRect();return {right:b.right,left:b.left,hit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===button};})});
  };
  try{
    left.expand();right.collapse();await delay();
    await plugin.openUrl('http://127.0.0.1:4180/article?frame-test=1',workspace.getLeavesOfType('markdown')[0]);
    await new Promise(resolve=>setTimeout(resolve,600));capture('Left open');
    left.collapse();await delay();capture('Both closed');
    right.expand();await delay();capture('Right open');
    left.expand();await delay();capture('Both open');
    left.setSize(380);await delay();capture('Left resized with right open');
    await plugin.current.close();await delay();
    return {date:new Date().toISOString(),pluginVersion:plugin.manifest.version,viewport:{width:innerWidth,height:innerHeight},states,clean:!document.querySelector('.peek-surface,.peek-narrow,[style*="--peek-area-"]')};
  }finally{
    plugin.current?.forceClose();
    left.setSize(original.leftSize);right.setSize(original.rightSize);
    left[original.left?'collapse':'expand']();right[original.right?'collapse':'expand']();
  }
`.replace('VAULT', JSON.stringify(vault)), 15000);
const ids = new Set(report.states.map(state => state.guest));
assert.equal(ids.size, 1, 'Sidebar changes keep the same guest');
for (const { label, page, workspace, controls } of report.states) {
  assert.ok(Math.abs(page.width / workspace.width - .8) < .01, label + ': width follows central workspace');
  assert.ok(Math.abs(page.x + page.width / 2 - workspace.x - workspace.width / 2) < 1, label + ': centered between sidebars');
  assert.ok(controls.every(button => button.hit && button.left >= page.right && button.right <= workspace.right), label + ': controls remain in the available margin');
}
assert.ok(report.states[1].page.width > report.states[0].page.width, 'Hiding a sidebar grows the page');
assert.ok(report.states[4].page.width < report.states[3].page.width, 'Widening a sidebar shrinks the page');
assert.equal(report.clean, true, 'Temporary geometry is removed on close');
await writeFile(new URL('../test-results/frame-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
