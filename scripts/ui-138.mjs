import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
mkdirSync('/tmp/ibt-ui138', { recursive: true });
mkdirSync('/opt/cursor/artifacts', { recursive: true });
const css = readFileSync(`${root}src/styles/bilingual.css`, 'utf8');

const tint = `<!doctype html><meta charset="utf-8"><style>${css}
body { margin: 0; font: 14px/2.05 "Segoe UI", sans-serif; }
.row { display: grid; grid-template-columns: 280px 280px; gap: 12px; padding: 16px; }
.cell { padding: 16px; }
.white { background: #fff; color: #1a1d29; }
.ink { background: #1a1a1a; color: #e8e8e8; }
.black { background: #000; color: #e7e9ea; }
.dim { background: #15202b; color: #e7e9ea; }
h2 { margin: 0 0 8px; font: 600 12px/1.4 "Segoe UI", sans-serif; letter-spacing: 0; }
.ref { display: inline; padding: 0.43em 0.57em; border-radius: 0.25em; line-height: 2.05; }
.ref-light { background: #fff8e1; }
.ref-dark { background: #3a3a3a; }
.src { margin: 0 0 6px; font: 14px/1.5 Georgia, serif; }
html { background: #d8dbe3; }
</style>
<div class="row">
  <section class="cell white"><h2>參考 · 白底 #FFF8E1</h2><p class="src">Competition</p><div class="ibt-block"><span class="ref ref-light">競爭</span></div></section>
  <section class="cell white"><h2>實際 · 白底</h2><p class="src">Competition</p><div class="ibt-block"><div class="ibt-trans" data-ibt-on="light"><span>競爭</span></div></div></section>
  <section class="cell ink"><h2>參考 · #1A1A1A 上 #3A3A3A</h2><p class="src">Competition</p><div class="ibt-block"><span class="ref ref-dark">競爭</span></div></section>
  <section class="cell ink"><h2>實際 · #1A1A1A</h2><p class="src">Competition</p><div class="ibt-block"><div class="ibt-trans" data-ibt-on="dark"><span>競爭</span></div></div></section>
</div>
<article class="cell black" style="margin:0 16px 12px;border-radius:12px">
  <h2>X · 純黑</h2>
  <p class="src">The launch window opens at dawn.</p>
  <div class="ibt-block"><div class="ibt-trans" data-ibt-on="dark">發射窗口在黎明打開。</div></div>
</article>
<article class="cell dim" style="margin:0 16px 16px;border-radius:12px">
  <h2>X · 暗藍 #15202B</h2>
  <p class="src">The launch window opens at dawn. Nobody on the floor is speaking above a whisper.</p>
  <div class="ibt-block" style="max-width:280px"><div class="ibt-trans" data-ibt-on="dark">發射窗口在黎明打開。現場沒有人把聲音提高到耳語以上。</div></div>
</article>`;
writeFileSync('/tmp/ibt-ui138/tint.html', tint.replace('<html', '<html data-ibt-highlight="on"').replace('<!doctype html>', '<!doctype html><html data-ibt-highlight="on">').replace('</style>', '</style>'));
// The replace above is messy. Write a clean file instead.
writeFileSync('/tmp/ibt-ui138/tint.html', `<!doctype html><html data-ibt-highlight="on"><meta charset="utf-8"><style>${css}
body { margin: 0; background: #d8dbe3; font: 14px/2.05 "Segoe UI", sans-serif; }
.row { display: grid; grid-template-columns: 300px 300px; gap: 12px; padding: 16px; }
.cell { padding: 16px; border-radius: 12px; }
.white { background: #fff; color: #1a1d29; }
.ink { background: #1a1a1a; color: #e8e8e8; }
.black { background: #000; color: #e7e9ea; }
.dim { background: #15202b; color: #e7e9ea; }
h2 { margin: 0 0 8px; font: 600 12px/1.4 "Segoe UI", sans-serif; }
.ref { display: inline; padding: 0.43em 0.57em; border-radius: 0.25em; line-height: 2.05; }
.ref-light { background: #fff8e1; color: #1a1d29; }
.ref-dark { background: #3a3a3a; color: #e8e8e8; }
.src { margin: 0 0 6px; font: 14px/1.5 Georgia, serif; }
</style>
<div class="row">
  <section class="cell white"><h2>參考 · 白底 #FFF8E1</h2><p class="src">Competition</p><div><span class="ref ref-light">競爭</span></div></section>
  <section class="cell white"><h2>實際 · 白底</h2><p class="src">Competition</p><div class="ibt-block"><div class="ibt-trans" data-ibt-on="light"><span>競爭</span></div></div></section>
  <section class="cell ink"><h2>參考 · #1A1A1A / #3A3A3A</h2><p class="src">Competition</p><div><span class="ref ref-dark">競爭</span></div></section>
  <section class="cell ink"><h2>實際 · #1A1A1A</h2><p class="src">Competition</p><div class="ibt-block"><div class="ibt-trans" data-ibt-on="dark"><span>競爭</span></div></div></section>
</div>
<article class="cell black" style="margin:0 16px 12px"><h2>X · #000</h2><p class="src">The launch window opens at dawn.</p><div class="ibt-block"><div class="ibt-trans" data-ibt-on="dark"><span>發射窗口在黎明打開。</span></div></div></article>
<article class="cell dim" style="margin:0 16px 16px"><h2>X · #15202B</h2><p class="src">The launch window opens at dawn. Nobody on the floor is speaking above a whisper.</p><div class="ibt-block" style="max-width:280px"><div class="ibt-trans" data-ibt-on="dark"><span>發射窗口在黎明打開。現場沒有人把聲音提高到耳語以上。</span></div></div></article>
</html>`);

const card = (dark) => `<!doctype html><meta charset="utf-8"><style>${css}
html, body { margin: 0; height: auto; background: ${dark ? '#0f1117' : '#f4f6fb'}; }
.ibt-sel-card { position: relative !important; margin: 24px; max-height: none !important; overflow: visible !important; }
</style>
<div class="ibt-sel-card${dark ? ' ibt-sel-dark' : ''}">
  <div class="ibt-sel-head">
    <span class="ibt-sel-grip"><svg viewBox="0 0 24 24" width="14" height="14"><circle cx="9" cy="7" r="1.15" fill="currentColor"/><circle cx="15" cy="7" r="1.15" fill="currentColor"/><circle cx="9" cy="12" r="1.15" fill="currentColor"/><circle cx="15" cy="12" r="1.15" fill="currentColor"/><circle cx="9" cy="17" r="1.15" fill="currentColor"/><circle cx="15" cy="17" r="1.15" fill="currentColor"/></svg></span>
    <button class="ibt-sel-pin" aria-label="釘選"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M9 4.5h6l-1 5.5 2.8 2v2H7.2v-2l2.8-2zM12 14v6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>
    <button class="ibt-sel-x" aria-label="關閉"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>
  </div>
  <div class="ibt-sel-orig"><span>Competition</span><button class="ibt-sel-speak" aria-label="朗讀原文"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 9.5v5h3.2L12 19V5L7.2 9.5zM15.4 9.2a3.8 3.8 0 0 1 0 5.6M17.6 7a6.5 6.5 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
  <div class="ibt-sel-body">競爭</div>
  <div class="ibt-sel-actions"><button class="ibt-sel-copy"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M9 9h10v10H9zM5 15V5h10" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>複製</button></div>
</div>`;
writeFileSync('/tmp/ibt-ui138/sel-light.html', card(false));
writeFileSync('/tmp/ibt-ui138/sel-dark.html', card(true));

const port = 9381;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-ui138/profile', '--window-size=1100,900', 'about:blank',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
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
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: `window.chrome = {
  runtime: { getManifest: () => ({ version: '1.4.38' }), openOptionsPage() {}, sendMessage: async () => ({}) },
  storage: { sync: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
  tabs: { query: async () => [{ id: 1, url: 'https://example.com/story' }] },
  scripting: { executeScript: async () => {}, insertCSS: async () => {} },
};` });
async function scheme(value) {
  await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
}
async function shotFit(file, w) {
  await rpc('Emulation.setDeviceMetricsOverride', { width: w, height: 120, deviceScaleFactor: 2, mobile: false });
  const sized = await rpc('Runtime.evaluate', { expression: 'Math.ceil(Math.max(document.body.scrollHeight, document.body.offsetHeight))', returnByValue: true });
  const h = sized?.result?.value || 400;
  await rpc('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
  const res = await rpc('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('wrote', file, w, h);
}
async function openFile(name) {
  await rpc('Page.navigate', { url: pathToFileURL(`/tmp/ibt-ui138/${name}`).href });
  await new Promise((r) => setTimeout(r, 250));
}
async function openExt(name) {
  await rpc('Page.navigate', { url: pathToFileURL(`${root}dist/${name}`).href });
  await new Promise((r) => setTimeout(r, 500));
}
await openFile('tint.html');
const colors = await rpc('Runtime.evaluate', { expression: `(() => {
  const sample = (sel) => {
    const el = document.querySelector(sel);
    const c = getComputedStyle(el);
    return { bg: c.backgroundColor, pad: c.padding, radius: c.borderRadius };
  };
  return { ours: sample('.white .ibt-trans > span'), dark: sample('.ink .ibt-trans > span') };
})()`, returnByValue: true });
console.log('tint', JSON.stringify(colors?.result?.value));
await shotFit('/opt/cursor/artifacts/tint-compare.png', 680);
await scheme('light');
await openExt('options.html');
const audit = await rpc('Runtime.evaluate', { expression: `(() => {
  const text = document.body.innerText;
  const fog = getComputedStyle(document.body).backgroundImage;
  return { casual: /怎麼翻譯|譯文長什麼樣子|一般/.test(text), github: !!document.querySelector('a[aria-label="GitHub"]'), fog };
})()`, returnByValue: true });
console.log('options audit', JSON.stringify(audit?.result?.value));
await shotFit('/opt/cursor/artifacts/options-light.png', 980);
await scheme('dark');
await openExt('options.html');
await shotFit('/opt/cursor/artifacts/options-dark.png', 980);
await scheme('light');
await openExt('popup.html');
await shotFit('/opt/cursor/artifacts/popup-light.png', 320);
await scheme('dark');
await openExt('popup.html');
await shotFit('/opt/cursor/artifacts/popup-dark.png', 320);
async function shotBox(file, w, h) {
  await rpc('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
  const res = await rpc('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('wrote', file, w, h);
}
await openFile('sel-light.html');
await shotBox('/opt/cursor/artifacts/selection-light.png', 400, 240);
await openFile('sel-dark.html');
await shotBox('/opt/cursor/artifacts/selection-dark.png', 400, 240);
ws.close();
proc.kill();
