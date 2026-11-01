import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const out = '/opt/cursor/artifacts';
mkdirSync(out, { recursive: true });
const css = pathToFileURL(root + 'dist/bilingual.css').href;
function popup(theme) {
  const dark = theme === 'dark';
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${css}"><style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: ${dark ? '#0e1116' : '#f4f6fb'}; }
  </style></head><body>
  <div class="ibt-sel-card ${dark ? 'ibt-sel-dark' : ''}" style="position:relative">
    <div class="ibt-sel-head"><span class="ibt-sel-grip"><svg viewBox="0 0 24 24" width="14" height="14">${[[9,7],[15,7],[9,12],[15,12],[9,17],[15,17]].map(([x,y]) => `<circle cx="${x}" cy="${y}" r="1.35" fill="currentColor"/>`).join('')}</svg></span>
      <button class="ibt-sel-copy" type="button" aria-label="複製"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M9 9h10v10H9zM5 15V5h10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button class="ibt-sel-save" type="button" aria-pressed="true"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 3.4l2.2 4.6 5 .7-3.6 3.5.9 5L12 15.2 7.5 17.2l.9-5L4.8 8.7l5-.7z" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg></button>
      <button class="ibt-sel-x" type="button"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>
    </div>
    <div class="ibt-sel-orig"><span>computationally</span><button class="ibt-sel-speak" type="button" aria-label="朗讀原文"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 9.5v5h3.2L12 19V5L7.2 9.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
    <div class="ibt-sel-body">計算地</div>
    <div class="ibt-sel-ex"><div class="ibt-sel-ex-label">例句</div>
      <p class="ibt-sel-ex-en">If so, it goes onto the more <span class="ibt-sel-hit">computationally</span> expensive stage handled by a large model.</p>
      <p class="ibt-sel-ex-zh">如果是，就會進入由大型模型處理、計算成本更高的階段。</p>
    </div>
  </div></body></html>`;
}
writeFileSync('/tmp/ibt-147-popup-dark.html', popup('dark'));
writeFileSync('/tmp/ibt-147-popup-light.html', popup('light'));

const words = ['released','proprietary','modification','recsys','expensive','computationally','unlimited','library','quiet','consequences','workflow','hypothesis'];
const samples = words.map((word, i) => ({
  id: word, word, translation: '譯文', pos: '名詞', meanings: '字義', dict: [],
  context: `This sentence uses ${word} in a real page.`,
  contextZh: `這一句裡用到了${word}。`,
  title: 'Example', url: 'https://example.com', savedAt: Date.now() - i * 86400000,
}));
const port = 9407;
const proc = spawn('/opt/google/chrome/chrome', ['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${port}`,'--user-data-dir=/tmp/ibt-147/shot','about:blank'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg.result); };
function rpc(method, params = {}) { const n = ++id; ws.send(JSON.stringify({ id: n, method, params })); return new Promise((resolve) => pending.set(n, resolve)); }
await rpc('Page.enable');
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: `window.chrome = { runtime: { getManifest: () => ({ version: '1.4.47' }), openOptionsPage() {}, sendMessage: async () => ({}) }, storage: { sync: { get: async () => ({}), set: async () => {} }, local: { get: async () => ({ ibt_vocab: ${JSON.stringify(samples)} }), set: async () => {} }, onChanged: { addListener() {} } } };` });
async function go(url) { await rpc('Page.navigate', { url }); await new Promise((r) => setTimeout(r, 500)); }
async function shot(file, width, height, scheme) {
  await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  await rpc('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  await new Promise((r) => setTimeout(r, 80));
  const res = await rpc('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('wrote', file);
}
await go(pathToFileURL('/tmp/ibt-147-popup-dark.html').href);
await shot('/opt/cursor/artifacts/popup-example-dark-147.png', 560, 460, 'dark');
await go(pathToFileURL('/tmp/ibt-147-popup-light.html').href);
await shot('/opt/cursor/artifacts/popup-example-light-147.png', 560, 460, 'light');
await go(pathToFileURL(root + 'dist/options.html').href);
await rpc('Runtime.evaluate', { expression: `document.getElementById('vocab').scrollIntoView({block:'center'})` });
await shot('/opt/cursor/artifacts/vocab-scroll-dark-147.png', 980, 820, 'dark');
await shot('/opt/cursor/artifacts/vocab-scroll-light-147.png', 980, 820, 'light');
const metrics = await rpc('Runtime.evaluate', { expression: `(() => { const sc = document.querySelector('.vocab-scroll'); const list = document.querySelector('.vocab-list'); return { scroll: sc.clientHeight, full: list.scrollHeight, overflow: getComputedStyle(sc).overflowY }; })()`, returnByValue: true });
console.log('vocab scroll', JSON.stringify(metrics?.result?.value));
ws.close();
proc.kill();
