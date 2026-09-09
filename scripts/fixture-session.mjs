import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const demo = readFileSync(new URL('../tests/fixtures/article.html', import.meta.url));

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:4180');
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  if (url.pathname === '/demo') { response.end(demo); return; }
  const guard = url.pathname === '/guard';
  const delayed = url.searchParams.has('delayed');
  response.end(`<!doctype html><html><head><title>Peek ${guard ? 'close' : 'reading'} lab</title><style>
    html{scroll-behavior:auto}body{font:18px system-ui;color:#24283b;background:#f7f8fc;max-width:780px;margin:40px auto;padding:0 24px}
    input{font:inherit;padding:12px;width:90%}section{height:850px;border-top:1px solid #ccd;padding:24px 0;box-sizing:border-box}
    </style></head><body><h1>${guard ? 'Close confirmation' : 'Reading position'}</h1>
    <p>${guard ? 'Typing arms a standard beforeunload handler.' : 'Close and reopen this URL to resume reading. Form values are not restored.'}</p>
    <p><input id=draft placeholder="Unsaved draft"></p><p><a href=/article#section-3>Open section 3 explicitly</a></p>
    <div id=article>${guard || delayed ? '' : Array.from({length:6},(_,i)=>`<section id=section-${i+1}><h2>Section ${i+1}</h2><p>Reading position fixture</p></section>`).join('')}</div>
    <script>
    window.instanceToken=crypto.randomUUID();window.beforeCount=0;window.trustedInput=false;
    const draft=document.querySelector('#draft');
    if(${guard})draft.addEventListener('input',e=>{window.trustedInput=e.isTrusted;window.onbeforeunload=draft.value?event=>{window.beforeCount++;event.preventDefault();event.returnValue='Unsaved fixture';return 'Unsaved fixture';}:null});
    if(${delayed})setTimeout(()=>{document.querySelector('#article').innerHTML=Array.from({length:6},(_,i)=>'<section id=section-'+(i+1)+'><h2>Section '+(i+1)+'</h2></section>').join('')},700);
    window.fixtureReady=true;
    </script></body></html>`);
});
server.listen(4180, '127.0.0.1', () => console.log('Peek session fixture: http://127.0.0.1:4180/'));
