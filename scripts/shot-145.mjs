import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const out = '/opt/cursor/artifacts';
mkdirSync('/tmp/ibt-145', { recursive: true });
mkdirSync(out, { recursive: true });
const css = pathToFileURL(root + 'dist/bilingual.css').href;
const cases = [
  ['lead', '「這是假設經理們會做得很好，」安德森說。'],
  ['period', '好的設計很安靜，它幫助你閱讀，卻不會打擾你。'],
  ['ellipsis', 'Marc Andreessen 揭露了哈佛商學院是如何建立在一個 1941 年的錯誤理論之上，以及它現在是如何崩潰的……'],
  ['mixed', 'Marc Andreessen 揭露了哈佛商學院是如何建立在一個 1941 年的錯誤理論之上。'],
  ['wrap', '好的設計很安靜，它幫助你閱讀，卻不會打擾你。這句話會折成兩行，色塊仍然分開。'],
];
function chipPage(theme) {
  const blocks = cases.map(([id, text]) => `<div class="row" id="${id}"><div class="ibt-block"><div class="ibt-trans" data-ibt-on="${theme}"><span>${text}</span></div></div></div>`).join('');
  return `<!doctype html><html data-ibt-highlight="on"><head><meta charset="utf-8"><link rel="stylesheet" href="${css}"><style>
    body { margin: 0; padding: 24px; background: ${theme === 'dark' ? '#000' : '#fff'}; color: ${theme === 'dark' ? '#e7e9ea' : '#0f1419'}; }
    .row { width: 280px; margin: 0 0 28px; font: 20px/1.5 "PingFang TC","Microsoft JhengHei",sans-serif; }
    #wrap { width: 220px; }
  </style></head><body>${blocks}</body></html>`;
}
writeFileSync('/tmp/ibt-145/chip-dark.html', chipPage('dark'));
writeFileSync('/tmp/ibt-145/chip-light.html', chipPage('light'));
writeFileSync('/tmp/ibt-145/popup.html', `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${css}"><style>
  body { margin: 0; min-height: 100vh; background: #0e1116; display: grid; place-items: center; }
</style></head><body>
<div class="ibt-sel-card ibt-sel-dark" style="position:relative">
  <div class="ibt-sel-head"><span class="ibt-sel-grip"></span>
    <button class="ibt-sel-save" type="button" aria-pressed="true" aria-label="已收入單字本"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 3.4l2.2 4.6 5 .7-3.6 3.5.9 5L12 15.2 7.5 17.2l.9-5L4.8 8.7l5-.7z" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg></button>
    <button class="ibt-sel-x" type="button" aria-label="關閉"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>
  </div>
  <div class="ibt-sel-orig"><span>consequences</span><button class="ibt-sel-speak" type="button" aria-label="朗讀原文"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 9.5v5h3.2L12 19V5L7.2 9.5zM15.4 9.2a3.8 3.8 0 0 1 0 5.6M17.6 7a6.5 6.5 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>
  <div class="ibt-sel-body">結果<div class="ibt-sel-dict"><div>名詞 後果、結果、續編、續集</div></div></div>
  <div class="ibt-sel-actions"><button class="ibt-sel-copy" type="button">複製</button></div>
</div></body></html>`);

const port = 9395;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-145/profile', '--window-size=1280,900', 'about:blank',
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
const samples = JSON.stringify([
  { id: 'consequences', word: 'consequences', translation: '結果', pos: '名詞', meanings: '後果、結果、續編、續集', dict: [], context: 'The decision had consequences.', title: 'Example', url: 'https://example.com/a', savedAt: Date.now() },
  { id: 'quiet', word: 'quiet', translation: '安靜', pos: '形容詞', meanings: '安靜的、輕聲的', dict: [], context: 'Good design is quiet.', title: 'Notes', url: 'https://example.com/b', savedAt: Date.now() - 86400000 },
  { id: 'library', word: 'library', translation: '圖書館', pos: '名詞', meanings: '圖書館、藏書', dict: [], context: 'The library by the river.', title: 'City', url: 'https://example.com/c', savedAt: Date.now() - 172800000 },
]);
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: `window.chrome = {
  runtime: { getManifest: () => ({ version: '1.4.45' }), openOptionsPage() {}, sendMessage: async () => ({}) },
  storage: {
    sync: { get: async () => ({}), set: async () => {} },
    local: { get: async () => ({ ibt_vocab: ${samples} }), set: async () => {} },
    onChanged: { addListener() {} },
  },
  tabs: { query: async () => [{ id: 1, url: 'https://example.com' }] },
  scripting: { executeScript: async () => {}, insertCSS: async () => {} },
};` });

async function shot(file, width, height, scheme) {
  await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme || 'light' }] });
  await rpc('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  await new Promise((r) => setTimeout(r, 120));
  const res = await rpc('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('wrote', file);
}
async function go(url) {
  await rpc('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 500));
}

await go(pathToFileURL('/tmp/ibt-145/chip-dark.html').href);
const measured = await rpc('Runtime.evaluate', { expression: `(() => {
  const out = {};
  for (const row of document.querySelectorAll('.row')) {
    const span = row.querySelector('.ibt-trans > span');
    const boxes = [...span.getClientRects()];
    const range = document.createRange();
    range.selectNodeContents(span);
    const inks = [...range.getClientRects()];
    out[row.id] = boxes.map((b, i) => {
      const t = inks[i] || inks[0];
      return {
        top: Math.round((t.top - b.top) * 10) / 10,
        right: Math.round((b.right - t.right) * 10) / 10,
        bottom: Math.round((b.bottom - t.bottom) * 10) / 10,
        left: Math.round((t.left - b.left) * 10) / 10,
        text: span.textContent.slice(0, 18),
      };
    });
  }
  return out;
})()`, returnByValue: true });
console.log(JSON.stringify(measured?.result?.value, null, 2));
await shot(`${out}/chip-dark-145.png`, 520, 980, 'dark');
await go(pathToFileURL('/tmp/ibt-145/chip-light.html').href);
await shot(`${out}/chip-light-145.png`, 520, 980, 'light');

await go(pathToFileURL(`${root}dist/options.html`).href);
await rpc('Runtime.evaluate', { expression: `document.getElementById('look').scrollIntoView({block:'start'})` });
await new Promise((r) => setTimeout(r, 80));
await shot(`${out}/options-look-dark-145.png`, 1100, 980, 'dark');
await rpc('Runtime.evaluate', { expression: `document.getElementById('vocab').scrollIntoView({block:'start'})` });
await new Promise((r) => setTimeout(r, 80));
await shot(`${out}/vocab-dark-145.png`, 1100, 780, 'dark');
await shot(`${out}/vocab-light-145.png`, 1100, 780, 'light');
await go(pathToFileURL('/tmp/ibt-145/popup.html').href);
await shot(`${out}/popup-save-145.png`, 520, 420, 'dark');
ws.close();
proc.kill();
