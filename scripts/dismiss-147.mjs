import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
execSync('npx esbuild scripts/dismiss-entry.ts --bundle --format=iife --platform=browser --outfile=/tmp/ibt-147-sel.js --log-level=error', { cwd: root, stdio: 'inherit' });
mkdirSync('/tmp/ibt-147', { recursive: true });
const js = pathToFileURL('/tmp/ibt-147-sel.js').href;
writeFileSync('/tmp/ibt-147/page.html', `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; display: flex; min-height: 100vh; background: #000; color: #fff; font: 16px/1.5 sans-serif; }
  #nav { width: 240px; padding: 24px; }
  main { padding: 32px; max-width: 560px; }
</style></head><body>
<aside id="nav">首頁</aside>
<main><p id="post">I run a big scanning job. If so, it goes onto the more computationally expensive stage handled by a large model.</p></main>
<script>window.chrome = {
  storage: { sync: { get: async () => ({}), set: async () => {} }, local: { get: async () => ({ ibt_vocab: [] }), set: async () => {} }, onChanged: { addListener() {} } },
  runtime: { sendMessage: async () => ({ ok: true, lookup: { translation: '計算地', sourceLang: 'en', dict: [{ pos: '副詞', terms: ['計算地'] }] }, pairs: [{ t: '如果是，就會進入由大型模型處理、計算成本更高的階段。' }] }) },
};</script>
<script src="${js}"></script>
</body></html>`);

const port = 9403;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-147/profile', 'about:blank',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg); };
function rpc(method, params = {}) {
  const n = ++id;
  ws.send(JSON.stringify({ id: n, method, params }));
  return new Promise((resolve) => pending.set(n, resolve));
}
await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Page.navigate', { url: pathToFileURL('/tmp/ibt-147/page.html').href });
await new Promise((r) => setTimeout(r, 600));
const result = await rpc('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
  const nav = document.getElementById('nav');
  nav.addEventListener('pointerdown', (e) => e.stopPropagation());
  nav.addEventListener('mousedown', (e) => e.stopPropagation());
  const post = document.getElementById('post');
  const node = post.firstChild;
  const word = 'computationally';
  const at = node.textContent.indexOf(word);
  const range = document.createRange();
  range.setStart(node, at);
  range.setEnd(node, at + word.length);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  const rect = range.getBoundingClientRect();
  post.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left, clientY: rect.top + 4, button: 0 }));
  post.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 30, clientY: rect.top + 4, button: 0 }));
  await new Promise((r) => setTimeout(r, 250));
  const opened = !!document.querySelector('.ibt-sel-card');
  nav.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 40, button: 0 }));
  nav.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 12, clientY: 40, button: 0 }));
  const closed = !document.querySelector('.ibt-sel-card');
  return { opened, closed };
})()` });
console.log(JSON.stringify(result, null, 2).slice(0, 2500));
const value = result?.result?.result?.value;
console.log('dismiss', value);
if (!value?.opened || !value?.closed) process.exitCode = 1;
ws.close();
proc.kill();
