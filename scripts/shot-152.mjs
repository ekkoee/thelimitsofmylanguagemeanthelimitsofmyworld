import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const out = '/opt/cursor/artifacts';
mkdirSync(out, { recursive: true });
const port = 9417;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-152/shot', 'about:blank',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg.result);
};
function rpc(method, params = {}) {
  const n = ++seq;
  ws.send(JSON.stringify({ id: n, method, params }));
  return new Promise((resolve) => pending.set(n, resolve));
}
await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.chrome = {
    runtime: { getManifest: () => ({ version: '1.4.52' }), openOptionsPage() {}, sendMessage: async () => ({}) },
    storage: {
      sync: { get: async () => ({ ibt_settings: { uiLang: new URLSearchParams(location.search).get('ui') || 'zh-TW', targetLangCode: 'zh-TW', viewMode: 'both', provider: 'google', transHighlight: true, transHighlightSet: true } }), set: async () => {} },
      local: { get: async () => ({ ibt_vocab: [] }), set: async () => {} },
      onChanged: { addListener() {} },
    },
  };`,
});
async function go(ui) {
  const url = pathToFileURL(root + 'dist/options.html').href + '?ui=' + encodeURIComponent(ui);
  await rpc('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 600));
  await rpc('Runtime.evaluate', { expression: `document.querySelector('.tint-live').scrollIntoView({block:'center'})` });
  await new Promise((r) => setTimeout(r, 80));
}
async function text() {
  const res = await rpc('Runtime.evaluate', {
    expression: `(() => {
      const orig = [...document.querySelectorAll('[data-preview="orig"]')].map((n) => n.textContent);
      const trans = [...document.querySelectorAll('[data-preview="trans"]')].map((n) => n.textContent);
      const cards = [...document.querySelectorAll('.tone-light, .tone-dark')].map((n) => n.getBoundingClientRect().height);
      return { orig, trans, cards };
    })()`,
    returnByValue: true,
  });
  return res?.result?.value;
}
async function shot(file) {
  await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 2, mobile: false });
  await rpc('Runtime.evaluate', { expression: `document.querySelector('.tint-live').scrollIntoView({block:'center'})` });
  await new Promise((r) => setTimeout(r, 100));
  const res = await rpc('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('wrote', file);
}

let failed = 0;
function expect(name, got, want) {
  if (got !== want) { failed++; console.error('FAIL', name, JSON.stringify(got)); }
  else console.log('ok', name);
}
const cases = [
  ['ko', '좋은 디자인은 조용합니다. 읽기를 도우면서도 방해하지 않습니다.', 'Good design is quiet; it helps you read without getting in the way.'],
  ['ja', '良いデザインは静かです。読むことを助け、邪魔をしません。', 'Good design is quiet; it helps you read without getting in the way.'],
  ['en', 'Good design is quiet; it helps you read without getting in the way.', '好的設計很安靜，它幫助你閱讀，卻不會打擾你。'],
  ['de', 'Gutes Design ist leise. Es hilft beim Lesen und steht nicht im Weg.', 'Good design is quiet; it helps you read without getting in the way.'],
];
for (const [ui, trans, orig] of cases) {
  await go(ui);
  const got = await text();
  console.log(ui, JSON.stringify(got));
  expect(ui + ' trans', got?.trans?.[0], trans);
  expect(ui + ' trans dark', got?.trans?.[1], trans);
  expect(ui + ' orig', got?.orig?.[0], orig);
  const heights = got?.cards || [];
  if (heights.length === 2 && Math.abs(heights[0] - heights[1]) > 2) {
    failed++;
    console.error('FAIL', ui, 'card heights', heights);
  } else console.log('ok', ui, 'heights', heights);
  await shot(`${out}/preview-${ui}-152.png`);
}
ws.close();
proc.kill();
if (failed) process.exit(1);
console.log('PASS');
