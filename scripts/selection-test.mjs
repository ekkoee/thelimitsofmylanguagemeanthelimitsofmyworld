// Selection popup on a local article page, with the free-engine response stubbed
// the way the background would answer, then a live Google check of the same text.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
mkdirSync('/tmp/ibt-sel', { recursive: true });
mkdirSync('/opt/cursor/artifacts', { recursive: true });
execSync(
  'npx esbuild scripts/selection-entry.ts --bundle --format=iife --platform=browser --outfile=/tmp/ibt-sel/selection.js --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const css = (await import('node:fs')).readFileSync(`${root}src/styles/bilingual.css`, 'utf8');
const html = `<!doctype html><meta charset="utf-8"><style>${css}
body { margin: 32px; font: 18px/1.5 Georgia, serif; max-width: 640px; }
</style><body>
<p id="story">The city opened a new library beside the river this morning.</p>
<script>
window.chrome = { runtime: { sendMessage: async (msg) => {
  window.__msg = msg;
  if (msg.type === 'lookup') return { ok: true, lookup: { translation: '圖書館', dict: [{ pos: '名詞', terms: ['圖書館', '藏書樓'] }] } };
  return { ok: true, pairs: [{ o: msg.text, t: '這座城市今早在河邊開了一座新圖書館。' }] };
}}};
</script>
<script src="file:///tmp/ibt-sel/selection.js"></script>
</body>`;
writeFileSync('/tmp/ibt-sel/index.html', html);
writeFileSync('/tmp/ibt-sel/selection-entry-ok', '1');

const port = 9344;
const chrome = execSync('which /opt/google/chrome/chrome').toString().trim() || '/opt/google/chrome/chrome';
const proc = (await import('node:child_process')).spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-sel/profile', 'about:blank',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg.result);
};
function rpc(method, params = {}) {
  const n = ++id;
  ws.send(JSON.stringify({ id: n, method, params }));
  return new Promise((resolve) => pending.set(n, resolve));
}
await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Page.navigate', { url: pathToFileURL('/tmp/ibt-sel/index.html').href });
await new Promise((r) => setTimeout(r, 400));
await rpc('Runtime.evaluate', { expression: `
  const p = document.getElementById('story');
  const range = document.createRange();
  range.selectNodeContents(p);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
  'selected';
`, returnByValue: true });
await new Promise((r) => setTimeout(r, 500));
const clicked = await rpc('Runtime.evaluate', { expression: `
  const btn = document.querySelector('.ibt-sel-btn');
  if (!btn) 'no-button';
  else { btn.click(); 'clicked'; }
`, returnByValue: true });
await new Promise((r) => setTimeout(r, 300));
const text = await rpc('Runtime.evaluate', { expression: `document.querySelector('.ibt-sel-body')?.innerText || ''`, returnByValue: true });
await rpc('Page.captureScreenshot', { format: 'png' }).then((res) => {
  if (res?.data) writeFileSync('/opt/cursor/artifacts/selection-popup.png', Buffer.from(res.data, 'base64'));
});
ws.close();
proc.kill();
const body = text?.result?.value || '';
console.log('selection body:', body);
if (!body.includes('圖書館')) {
  console.error('selection click result', clicked?.result?.value, body);
  process.exit(1);
}
const gtx = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=' + encodeURIComponent('The city opened a new library beside the river this morning.'));
const data = await gtx.json();
const zh = (data[0] || []).map((p) => p[0]).join('');
console.log('live gtx:', zh);
if (!zh.includes('圖書館') && !zh.includes('圖書館'.slice(0, 1))) {
  // The live engine must return Chinese. The popup fixture is separate.
  if (!/[\u4e00-\u9fff]/.test(zh)) { console.error('gtx returned no Chinese'); process.exit(1); }
}
console.log('selection test passed');
