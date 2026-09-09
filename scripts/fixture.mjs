import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function startFixture(port = 4179) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1:4179');
    if (url.pathname === '/sign-in') {
      response.writeHead(302, { 'Set-Cookie': `peek_lab_session=${randomUUID()}; Max-Age=86400; HttpOnly; SameSite=Lax; Path=/`, Location: '/' });
      return response.end();
    }
    if (url.pathname === '/redirect') {
      response.writeHead(302, { Location: url.searchParams.get('to') || '/' }); return response.end();
    }
    if (url.pathname === '/session') {
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify({ signedIn: /peek_lab_session=/.test(request.headers.cookie || '') }));
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    response.setHeader('X-Frame-Options', 'DENY');
    response.end(`<!doctype html><html><head><title>Peek session lab</title><style>
      body{font:18px system-ui;max-width:720px;margin:60px auto;background:#f7f8fc;color:#24283b;padding:0 24px}
      input,button,a{font:inherit}input{padding:12px;width:85%;border:1px solid #aab;border-radius:8px}
      h1{font-size:40px}section{padding-top:500px}a{color:#405bd3}li{margin:16px 0}
      .badge{color:#166c40;background:#ddf6e7;padding:8px 14px;border-radius:30px;display:inline-block}
      </style></head><body><span class=badge>Live web page · Local fixture</span><h1>Peek session lab</h1>
      <p>This page rejects iframe embedding. It has an editable field, history, scroll, and a persistent login fixture.</p>
      <p id=session>Checking session…</p><p><input id=draft placeholder="Type something, then keep this preview as a tab"></p>
      <ul><li><a id=login href=/sign-in>Sign in to the local fixture</a></li><li><a id=history href=#detail>Navigate to detail</a></li>
      <li><a id=popup href=/popup target=_blank>Try a popup</a></li><li><a id=bad href="file:///tmp/peek-lab-blocked">Try a blocked file URL</a></li></ul>
      <section id=detail><h2>Detail</h2><p>The page instance and field should survive “Keep as Obsidian tab”.</p></section>
      <script>window.instanceToken=crypto.randomUUID();localStorage.setItem('peekVisitCount',String(Number(localStorage.getItem('peekVisitCount')||0)+1));
      fetch('/session').then(r=>r.json()).then(s=>{document.querySelector('#session').textContent=s.signedIn?'Signed in (HttpOnly cookie)':'Signed out';window.fixtureReady=true});</script></body></html>`);
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startFixture(); console.log('Peek fixture: http://127.0.0.1:4179/');
}
