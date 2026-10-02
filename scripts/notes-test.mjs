import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { job, value, waitValue } from './lab-cli.mjs';

const vault = new URL('../.lab/Peek Lab/', import.meta.url);
const rows = [];
const check = (name, detail) => { rows.push({ name, result: 'pass', detail }); console.log(`PASS ${name}`, detail ?? ''); };
const plugin = "app.plugins.plugins['link-float']";
const surface = "document.querySelector('.peek-surface:popover-open')";
const front = 'electron.remote.getCurrentWindow().show();electron.remote.getCurrentWindow().focus();';

// A text-only PDF with numbered pages, so page restoration can be asserted.
function samplePdf(pages) {
  const objects = [];
  const add = body => objects.push(body);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let n = 1; n <= pages; n++) {
    const text = Array.from({ length: 40 }, (_, i) => `BT /F1 14 Tf 72 ${760 - i * 18} Td (Fixture page ${n} line ${i}) Tj ET\n`).join('');
    add(`<< /Length ${text.length} >>\nstream\n${text}endstream`);
  }
  const parent = 2 + pages * 2;
  for (let n = 1; n <= pages; n++) add(`<< /Type /Page /Parent ${parent} 0 R /MediaBox [0 0 612 792] /Contents ${n + 1} 0 R /Resources << /Font << /F1 1 0 R >> >> >>`);
  add(`<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${pages + 2 + i} 0 R`).join(' ')}] /Count ${pages} >>`);
  add(`<< /Type /Catalog /Pages ${parent} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const target = `# Note target\n\nIntro paragraph.\n\n${Array.from({ length: 60 }, (_, i) => `Filler line ${i}.`).join('\n\n')}\n\n## Deep section\n\nLine one of the deep section. ^deep-block\n\n${Array.from({ length: 40 }, (_, i) => `Tail line ${i}.`).join('\n\n')}\n\nPDF from target: [[Note fixture.pdf]]\n`;
const links = `# Note fixture links\n\n- Wiki: [[Note target]]\n- Heading: [[Note target#Deep section]]\n- Block: [[Note target#^deep-block]]\n- Markdown: [markdown link](Note%20target.md)\n- PDF: [[Note fixture.pdf]]\n- PDF page: [[Note fixture.pdf#page=4]]\n- Missing: [[Note fixture missing]]\n- Self: [[#Note fixture links]]\n- Image: [[Note fixture.png]]\n`;
// 1×1 transparent PNG.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function clickLink(selector, { modifier = 'shift', label } = {}) {
  await job(`${front}return true;`);
  const find = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${label ? `e.textContent.trim()===${JSON.stringify(label)}` : 'true'})`;
  await waitValue(`!!(${find})`);
  return job(`const a=${find};a.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(r));const r=a.getBoundingClientRect();const wc=electron.remote.getCurrentWebContents();const input={x:Math.round(r.x+Math.min(r.width/2,20)),y:Math.round(r.y+r.height/2),button:'left',clickCount:1,modifiers:${JSON.stringify(modifier ? [modifier] : [])}};wc.sendInputEvent({...input,type:'mouseDown'});wc.sendInputEvent({...input,type:'mouseUp'});return true;`);
}
async function key(keyCode, modifiers = []) {
  await job(`const wc=electron.remote.getCurrentWebContents();wc.sendInputEvent({type:'keyDown',keyCode:${JSON.stringify(keyCode)},modifiers:${JSON.stringify(modifiers)}});wc.sendInputEvent({type:'keyUp',keyCode:${JSON.stringify(keyCode)},modifiers:${JSON.stringify(modifiers)}});return true;`);
}
// Shown, settled, and controls built; the view type alone can change before the overlay appears.
const diagnose = () => value(`(()=>{const p=${plugin}.current;const s=document.querySelector('.peek-surface');return {preview:!!p,popover:!!s?.matches(':popover-open'),motion:s?.dataset.peekMotion??null,standIn:!!s?.querySelector('.peek-stand-in'),controls:!!(p?.closeButton&&s?.contains(p.closeButton)),view:p?.pageLeaf()?.view.getViewType()??null,closed:p?.closed??null,shown:p?.shown??null}})()`);
const openedOnce = () => waitValue(`!!${surface} && !${surface}.dataset.peekMotion && ${surface}.contains(${plugin}.current?.closeButton) && ${plugin}.current.pageLeaf().view.getViewType()`, 15000);
async function opened() {
  try { return await openedOnce(); }
  catch (error) { throw new Error(`${error.message}\nPreview state: ${JSON.stringify(await diagnose())}`); }
}
const closed = () => waitValue(`!document.querySelector('.peek-surface') && !${plugin}.current`, 15000);
const shownFile = () => value(`${plugin}.current?.pageLeaf()?.view.file?.path ?? null`);
const sourceState = () => value(`({file:noteSource.view.file?.path, mode:noteSource.view.getMode?.(), visible:getComputedStyle(noteSource.containerEl).display!=='none', inert:noteSource.containerEl.inert, markdownLeaves:app.workspace.getLeavesOfType('markdown').length})`);
async function sourceMode(mode) {
  await job(`await noteSource.setViewState({type:'markdown',state:{file:'Note fixture links.md',mode:${JSON.stringify(mode)},source:false},active:true});app.workspace.setActiveLeaf(noteSource,{focus:true});return true;`);
  await waitValue(mode === 'preview' ? "!!noteSource.containerEl.querySelector('.markdown-preview-view a.internal-link')" : "!!noteSource.containerEl.querySelector('.cm-content .cm-hmd-internal-link')");
}
// Where a link target sits in a view, relative to the view height, after core scrolls to it.
const place = (view, text) => `(()=>{const v=${view};const c=v.containerEl.querySelector('.view-content').getBoundingClientRect();const e=[...v.containerEl.querySelectorAll('.cm-line, h2, p')].find(e=>e.textContent.includes(${JSON.stringify(text)}));if(!e)return null;const b=e.getBoundingClientRect();return b.top>=c.top&&b.bottom<=c.bottom?Math.round((b.top-c.top)/c.height*100)/100:null})()`;
async function nativePlace(linktext, text) {
  return job(`app.workspace.setActiveLeaf(noteSource,{focus:true});await app.workspace.openLinkText(${JSON.stringify(linktext)},'Note fixture links.md','tab');const leaf=app.workspace.getMostRecentLeaf();let at=null;for(let i=0;i<30&&at===null;i++){await new Promise(r=>setTimeout(r,100));at=${place('leaf.view', text)};}await new Promise(r=>setTimeout(r,800));at=${place('leaf.view', text)};leaf.detach();app.workspace.setActiveLeaf(noteSource,{focus:true});return at;`);
}
async function previewPlace(text) {
  await waitValue(place(`${plugin}.current.pageLeaf().view`, text));
  await new Promise(resolve => setTimeout(resolve, 800));
  return value(place(`${plugin}.current.pageLeaf().view`, text));
}
async function closeByEscape() {
  await job(`${plugin}.current?.closeButton?.focus();return true;`);
  await key('Escape');
  await closed();
}

try {
  await writeFile(new URL('Note target.md', vault), target);
  await writeFile(new URL('Note fixture links.md', vault), links);
  await writeFile(new URL('Note fixture.pdf', vault), samplePdf(10));
  await writeFile(new URL('Note fixture.png', vault), png);
  await waitValue("['Note target.md','Note fixture links.md','Note fixture.pdf','Note fixture.png'].every(p=>app.vault.getAbstractFileByPath(p))");
  await job(`${front}${plugin}.current?.forceClose();${plugin}.settings.modifier='Shift';window.noteSource=app.workspace.getLeavesOfType('markdown')[0];noteSource.view.containerEl.querySelectorAll('.document-search-close-button').forEach(b=>b.click());return true;`);
  await sourceMode('preview');
  const baseline = await sourceState();

  await clickLink('.markdown-preview-view a.internal-link', { label: 'Note target' });
  assert.equal(await opened(), 'markdown');
  assert.equal(await shownFile(), 'Note target.md');
  const during = await sourceState();
  assert.equal(during.file, 'Note fixture links.md'); assert.equal(during.visible, true); assert.equal(during.inert, true);
  const rect = await value(`${surface}.getBoundingClientRect().toJSON()`);
  assert.ok(rect.width > 300 && rect.height > 300);
  assert.deepEqual(await value(`[...${surface}.querySelectorAll('.peek-controls > button')].map(b=>b.getAttribute('aria-label'))`), ['Close preview', 'Keep as Obsidian tab', 'Preview options']);
  check('Shift-click on a note link in Reading view shows that note over the unchanged source', { width: Math.round(rect.width), height: Math.round(rect.height) });

  await closeByEscape();
  assert.deepEqual(await sourceState(), baseline);
  check('Escape closes the note preview and restores the source without extra leaves');

  // Hovering shows core's page preview first. Opening must remove it, must not lay the note out
  // beside the source, and must not show controls before the page moves.
  const opening = await job(`${front}const wc=electron.remote.getCurrentWebContents();const a=[...noteSource.view.containerEl.querySelectorAll('.markdown-preview-view a.internal-link')].find(e=>e.textContent.trim()==='Note fixture.pdf');a.scrollIntoView({block:'center'});await new Promise(r=>requestAnimationFrame(r));const r=a.getBoundingClientRect();const x=Math.round(r.x+Math.min(r.width/2,20)),y=Math.round(r.y+r.height/2);
    for(let i=0;i<6;i++){wc.sendInputEvent({type:'mouseMove',x:x-12+i*2,y});await new Promise(r=>setTimeout(r,40));}
    let hovered=false;for(let i=0;i<30&&!hovered;i++){await new Promise(r=>setTimeout(r,100));hovered=!!document.querySelector('.hover-popover');}
    const width=noteSource.containerEl.getBoundingClientRect().width,samples=[];let sampling=true;
    const sample=()=>{const s=document.querySelector('.peek-surface');if(s){const controls=s.querySelector('.peek-controls');samples.push({phase:s.classList.contains('peek-pending')?'pending':s.dataset.peekMotion??'shown',visible:getComputedStyle(s).visibility,controls:controls?getComputedStyle(controls).opacity:null,sourceWidth:noteSource.containerEl.getBoundingClientRect().width,hover:!!document.querySelector('.hover-popover')});}if(sampling)requestAnimationFrame(sample);};requestAnimationFrame(sample);
    const e={x,y,button:'left',clickCount:1,modifiers:['shift']};wc.sendInputEvent({...e,type:'mouseDown'});wc.sendInputEvent({...e,type:'mouseUp'});
    for(let i=0;i<100&&!(document.querySelector('.peek-surface:popover-open')&&!document.querySelector('.peek-surface').dataset.peekMotion);i++)await new Promise(r=>setTimeout(r,30));
    sampling=false;wc.sendInputEvent({type:'mouseMove',x:5,y:5});return {hovered,width,samples};`);
  assert.equal(opening.hovered, true, 'Core page preview appears on hover');
  assert.ok(opening.samples.length > 3);
  assert.ok(opening.samples.every(f => f.sourceWidth === opening.width), 'The source keeps its width');
  assert.ok(opening.samples.every(f => f.phase !== 'pending' || f.visible === 'hidden'), 'The opening note is hidden until shown');
  assert.ok(opening.samples.every(f => !['pending', 'preparing'].includes(f.phase) || f.controls === null || f.controls === '0'), 'Controls wait for the page: ' + JSON.stringify(opening.samples.filter(f => ['pending', 'preparing'].includes(f.phase))));
  assert.equal(opening.samples.at(-1).hover, false, 'Core page preview is dismissed');
  await opened();
  check('Opening dismisses the hover preview without flashing the file beside the source', { frames: opening.samples.length, phases: [...new Set(opening.samples.map(f => f.phase))] });
  await closeByEscape();

  for (const [label, linktext, text, name] of [
    ['Note target > Deep section', 'Note target#Deep section', 'Deep section', 'heading'],
    ['Note target > ^deep-block', 'Note target#^deep-block', 'Line one of the deep section', 'block'],
  ]) {
    const native = await nativePlace(linktext, text);
    await clickLink('.markdown-preview-view a.internal-link', { label });
    await opened();
    const preview = await previewPlace(text);
    assert.ok(native !== null && preview !== null && Math.abs(native - preview) <= 0.06, `${name}: native ${native}, preview ${preview}`);
    check(`A ${name} link opens the note where core places that ${name}`, { native, preview });
    await closeByEscape();
  }

  await clickLink('.markdown-preview-view a.internal-link', { label: 'markdown link' });
  await opened();
  assert.equal(await shownFile(), 'Note target.md');
  await closeByEscape();
  check('A Markdown-style link to a note opens the same preview');

  await clickLink('.markdown-preview-view a.internal-link', { label: 'Note fixture.pdf > page=4' });
  assert.equal(await opened(), 'pdf');
  const linkedPage = await waitValue(`${plugin}.current.pageLeaf().view.viewer?.child?.pdfViewer?.pdfViewer?.currentPageNumber===4 && 4`);
  assert.deepEqual(await value(`[...${surface}.querySelectorAll('.peek-controls > button')].map(b=>b.getAttribute('aria-label'))`), ['Close preview', 'Keep as Obsidian tab', 'Preview options']);
  check('A PDF link with a page opens the PDF preview on that page', { page: linkedPage });

  // Native PDF.js history records the visible page; the preview must not replace that behavior.
  const wheeled = await job(`const leaf=${plugin}.current.pageLeaf();const pv=leaf.view.viewer.child.pdfViewer.pdfViewer;const r=leaf.view.containerEl.querySelector('.pdf-viewer-container').getBoundingClientRect();const wc=electron.remote.getCurrentWebContents();for(let i=0;i<200&&pv.currentPageNumber<7;i++){wc.sendInputEvent({type:'mouseWheel',x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),deltaX:0,deltaY:-120,canScroll:true});await new Promise(r=>setTimeout(r,40));}await new Promise(r=>setTimeout(r,1500));return pv.currentPageNumber;`);
  await closeByEscape();
  await clickLink('.markdown-preview-view a.internal-link', { label: 'Note fixture.pdf' });
  await opened();
  const remembered = await waitValue(`${plugin}.current.pageLeaf().view.viewer?.child?.pdfViewer?.pdfViewer?.pagesCount && ${plugin}.current.pageLeaf().view.viewer.child.pdfViewer.pdfViewer.currentPageNumber`);
  assert.equal(remembered, wheeled);
  await closeByEscape();
  const native = await job(`const file=app.vault.getAbstractFileByPath('Note fixture.pdf');const leaf=app.workspace.getLeaf('tab');await leaf.openFile(file,{active:true});await new Promise(r=>setTimeout(r,2000));const page=leaf.view.viewer.child.pdfViewer.pdfViewer.currentPageNumber;leaf.detach();app.workspace.setActiveLeaf(noteSource,{focus:true});return page;`);
  assert.equal(native, wheeled);
  check('A plain PDF link reopens at the position remembered by core, shared with ordinary tabs', { scrolledTo: wheeled, reopened: remembered, ordinaryTab: native });

  await sourceMode('source');
  await clickLink('.markdown-source-view .cm-content .cm-hmd-internal-link', { label: 'Note target' });
  assert.equal(await opened(), 'markdown');
  assert.equal(await shownFile(), 'Note target.md');
  assert.equal(await value("noteSource.view.editor.getValue()"), links);
  check('Shift-click on a note link in Live Preview opens the preview without changing the source text or selection target');
  await closeByEscape();
  await sourceMode('preview');

  const ignored = await job(`const p=${plugin};const r=l=>p.resolve({kind:'note',linktext:l},'Note fixture links.md');return {missing:r('Note fixture missing'),self:r('#Note fixture links'),image:r('Note fixture.png'),note:r('Note target')?.file.path};`);
  assert.deepEqual(ignored, { missing: null, self: null, image: null, note: 'Note target.md' });
  await clickLink('.markdown-preview-view a.internal-link', { label: 'Note fixture links' });
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(await value("!!document.querySelector('.peek-surface')"), false);
  check('Unresolved links, links within the source note, and images keep core behavior', ignored);

  await clickLink('.markdown-preview-view a.internal-link', { label: 'Note target', modifier: null });
  await waitValue("noteSource.view.file?.path==='Note target.md'");
  assert.equal(await value("!!document.querySelector('.peek-surface')"), false);
  check('A plain click on a note link still navigates the source tab');
  await sourceMode('preview');

  await clickLink('.markdown-preview-view a.internal-link', { label: 'Note target' });
  await opened();
  // The preview opens in the vault's default mode; the editor renders the last line once scrolled to it.
  await job(`const e=${plugin}.current.pageLeaf().view.editor;const last=e.lastLine();e.scrollIntoView({from:{line:last,ch:0},to:{line:last,ch:0}});return true;`);
  await clickLink('.peek-surface .cm-content .cm-hmd-internal-link, .peek-surface .markdown-preview-view a.internal-link', { label: 'Note fixture.pdf' });
  assert.equal(await opened(), 'pdf');
  assert.equal(await value(`${plugin}.current.source===noteSource`), true);
  assert.equal(await value('document.querySelectorAll(".peek-surface").length'), 1);
  check('Shift-click inside a note preview replaces it while keeping the original source');
  await closeByEscape();

  await clickLink('.markdown-preview-view a.internal-link', { label: 'Note target' });
  await opened();
  const leafId = await value(`${plugin}.current.pageLeaf().id`);
  await job(`document.querySelector('.peek-controls [aria-label="Keep as Obsidian tab"]').click();return true;`);
  await closed();
  const kept = await value(`(()=>{const l=app.workspace.getLeafById(${JSON.stringify(leafId)});return l&&{file:l.view.file?.path,active:app.workspace.getMostRecentLeaf()===l,header:getComputedStyle(l.tabHeaderEl).display!=='none',popover:l.containerEl.hasAttribute('popover')}})()`);
  assert.deepEqual(kept, { file: 'Note target.md', active: true, header: true, popover: false });
  await job(`app.workspace.getLeafById(${JSON.stringify(leafId)}).detach();app.workspace.setActiveLeaf(noteSource,{focus:true});return true;`);
  check('Keep turns the note preview into an ordinary active tab');

  // Editing inside the preview: the first Escape leaves the editor, the second closes, and core saves the note.
  await clickLink('.markdown-preview-view a.internal-link', { label: 'Note target' });
  await opened();
  await job(`const v=${plugin}.current.pageLeaf().view;await v.setState({...v.getState(),mode:'source',source:false},{history:false});v.editor.focus();v.editor.setCursor({line:2,ch:0});return true;`);
  await waitValue(`document.activeElement?.closest('.peek-surface .cm-content')!=null`);
  await job(`electron.remote.getCurrentWebContents().insertText('Edited in preview. ');return true;`);
  await waitValue(`${plugin}.current.pageLeaf().view.editor.getLine(2).startsWith('Edited in preview. ')`);
  await key('Escape');
  assert.equal(await value(`!!${surface} && document.activeElement?.getAttribute('aria-label')`), 'Close preview');
  await key('Escape');
  await closed();
  const saved = await job(`for(let i=0;i<50;i++){const line=(await app.vault.read(app.vault.getAbstractFileByPath('Note target.md'))).split('\\n')[2];if(line.startsWith('Edited in preview. '))return line;await new Promise(r=>setTimeout(r,200));}return null;`);
  assert.ok(saved.startsWith('Edited in preview. '));
  check('Editing in a note preview: first Escape leaves the text, second closes, and the edit is saved', { line: saved });

  await clickLink('.markdown-preview-view a.internal-link', { label: 'Note target' });
  await opened();
  await key('f', ['meta']);
  const search = await waitValue(`(()=>{const page=${plugin}.current.pageLeaf().view.containerEl;const inPage=!!page.querySelector('.document-search-container');const inSource=!!noteSource.view.containerEl.querySelector('.document-search-container');return inPage||inSource?{inPage,inSource}:null})()`, 5000);
  assert.deepEqual(search, { inPage: true, inSource: false });
  check('Find in a note preview searches the previewed note, not the source', search);
  await closeByEscape();
  assert.deepEqual(await sourceState(), baseline);
  check('After all scenarios the source note is unchanged and no preview leaves remain');
} finally {
  await job(`${plugin}.current?.forceClose();return true;`).catch(() => {});
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  await writeFile(new URL('../test-results/notes-test.json', import.meta.url), JSON.stringify(rows, null, 2));
}
