import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const out = '/opt/cursor/artifacts';
mkdirSync('/tmp/ibt-146', { recursive: true });
mkdirSync(out, { recursive: true });
const css = pathToFileURL(root + 'dist/bilingual.css').href;
const grip = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">${[[9, 7], [15, 7], [9, 12], [15, 12], [9, 17], [15, 17]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.35" fill="currentColor"/>`).join('')}</svg>`;
const copyIcon = `<svg viewBox="0 0 24 24" width="15" height="15"><path d="M9 9h10v10H9zM5 15V5h10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const speak = `<svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 9.5v5h3.2L12 19V5L7.2 9.5zM15.4 9.2a3.8 3.8 0 0 1 0 5.6M17.6 7a6.5 6.5 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const xicon = `<svg viewBox="0 0 24 24" width="15" height="15"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
function popup(saved) {
  const fill = saved ? 'currentColor' : 'none';
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${css}"><style>body{margin:0;min-height:100vh;background:#0e1116;display:grid;place-items:center}</style></head><body>
<div class="ibt-sel-card ibt-sel-dark" style="position:relative">
  <div class="ibt-sel-head"><span class="ibt-sel-grip">${grip}</span>
    <button class="ibt-sel-save" type="button" aria-pressed="${saved}" aria-label="${saved ? '已收入單字本' : '收入單字本'}"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 3.4l2.2 4.6 5 .7-3.6 3.5.9 5L12 15.2 7.5 17.2l.9-5L4.8 8.7l5-.7z" fill="${fill}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg></button>
    <button class="ibt-sel-x" type="button" aria-label="關閉">${xicon}</button>
  </div>
  <div class="ibt-sel-orig"><span>consequences</span><button class="ibt-sel-speak" type="button" aria-label="朗讀原文">${speak}</button></div>
  <div class="ibt-sel-body">結果<div class="ibt-sel-dict"><div>名詞 後果、結果、續編、續集</div></div></div>
  <div class="ibt-sel-actions"><button class="ibt-sel-copy" type="button">${copyIcon}複製</button></div>
</div></body></html>`;
}
writeFileSync('/tmp/ibt-146/popup-saved.html', popup(true));
writeFileSync('/tmp/ibt-146/popup-unsaved.html', popup(false));

const port = 9398;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-146/profile', '--window-size=1100,900', 'about:blank',
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
const samples = JSON.stringify([
  { id: 'consequences', word: 'consequences', translation: '結果', pos: '名詞', meanings: '後果、結果、續編、續集', dict: [], context: '', title: 'Example', url: 'https://example.com/a', savedAt: Date.now() },
  { id: 'quiet', word: 'quiet', translation: '安靜', pos: '形容詞', meanings: '安靜的、輕聲的', dict: [], context: '', title: 'Notes', url: 'https://example.com/b', savedAt: Date.now() - 86400000 },
  { id: 'library', word: 'library', translation: '圖書館', pos: '名詞', meanings: '圖書館、藏書', dict: [], context: '', title: 'City', url: 'https://example.com/c', savedAt: Date.now() - 172800000 },
]);
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: `window.chrome = {
  runtime: { getManifest: () => ({ version: '1.4.46' }), openOptionsPage() {}, sendMessage: async () => ({}) },
  storage: {
    sync: { get: async () => ({}), set: async () => {} },
    local: { get: async () => ({ ibt_vocab: ${samples} }), set: async () => {} },
    onChanged: { addListener() {} },
  },
};` });
async function shot(file, width, height, scheme) {
  await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  await rpc('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  await new Promise((r) => setTimeout(r, 100));
  const res = await rpc('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('wrote', file);
}
async function go(url) {
  await rpc('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 500));
}
await go(pathToFileURL(`${root}dist/options.html`).href);
await rpc('Runtime.evaluate', { expression: `(() => {
  const s = document.createElement('style');
  s.textContent = '.vocab-list li:first-child .vocab-del{opacity:1}';
  document.head.appendChild(s);
  document.getElementById('vocab').scrollIntoView({block:'center'});
})()` });
await shot(`${out}/vocab-dark-146.png`, 1100, 720, 'dark');
await shot(`${out}/vocab-light-146.png`, 1100, 720, 'light');
await go(pathToFileURL('/tmp/ibt-146/popup-unsaved.html').href);
await shot(`${out}/popup-unsaved-146.png`, 520, 420, 'dark');
await go(pathToFileURL('/tmp/ibt-146/popup-saved.html').href);
await shot(`${out}/popup-saved-146.png`, 520, 420, 'dark');
ws.close();
proc.kill();
