import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const out = '/opt/cursor/artifacts';
mkdirSync(out, { recursive: true });
const port = 9416;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-151/shot', 'about:blank',
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
    runtime: { getManifest: () => ({ version: '1.4.51' }), openOptionsPage() {}, sendMessage: async () => ({}) },
    storage: {
      sync: { get: async () => ({ ibt_settings: { uiLang: new URLSearchParams(location.search).get('ui') || '', targetLangCode: 'de', viewMode: 'both', provider: 'google' } }), set: async () => {} },
      local: { get: async () => ({ ibt_vocab: [] }), set: async () => {} },
      onChanged: { addListener() {} },
    },
    tabs: { query: async () => [{ id: 1, url: 'https://example.com/article' }] },
  };`,
});
async function go(file, ui) {
  const url = pathToFileURL(root + 'dist/' + file).href + '?ui=' + encodeURIComponent(ui);
  await rpc('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 500));
}
async function shot(file, width, height, scheme) {
  await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
  const measured = await rpc('Runtime.evaluate', { expression: 'Math.ceil(document.documentElement.scrollHeight)', returnByValue: true });
  await rpc('Emulation.setDeviceMetricsOverride', {
    width, height: height || measured?.result?.value || 800, deviceScaleFactor: 2, mobile: false,
  });
  await new Promise((r) => setTimeout(r, 120));
  const res = await rpc('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('wrote', file);
}
async function text(expr) {
  const res = await rpc('Runtime.evaluate', { expression: expr, returnByValue: true });
  return res?.result?.value;
}

await go('popup.html', 'zh-TW');
console.log('popup zh', await text(`document.querySelector('h1').textContent + ' | ' + document.getElementById('ctaHint').textContent + ' | ' + document.getElementById('viewMode').selectedOptions[0].textContent`));
await shot(`${out}/popup-zh-151.png`, 360, 0, 'dark');
await go('popup.html', 'en');
console.log('popup en', await text(`document.querySelector('h1').textContent + ' | ' + document.getElementById('translatePage').textContent + ' | ' + document.getElementById('viewMode').selectedOptions[0].textContent`));
await shot(`${out}/popup-en-151.png`, 360, 0, 'dark');
await go('popup.html', 'de');
console.log('popup de', await text(`document.querySelector('h1').textContent + ' | ' + document.getElementById('translatePage').textContent + ' | ' + document.getElementById('ctaHint').textContent + ' | ' + document.getElementById('viewMode').selectedOptions[0].textContent`));
await shot(`${out}/popup-de-151.png`, 360, 0, 'dark');
await go('popup.html', 'ja');
console.log('popup ja', await text(`document.querySelector('h1').textContent + ' | ' + document.getElementById('translatePage').textContent + ' | ' + document.getElementById('altHint')?.textContent`));
await shot(`${out}/popup-ja-151.png`, 360, 0, 'dark');
await go('options.html', 'en');
console.log('options en', await text(`document.querySelector('#general h2').textContent + ' | ' + document.querySelector('#uiLang').selectedOptions[0].textContent + ' | ' + document.querySelector('.rail a[href="#look"]').textContent`));
await shot(`${out}/options-en-151.png`, 1180, 860, 'dark');
await go('options.html', 'de');
console.log('options de', await text(`document.querySelector('#general h2').textContent + ' | ' + document.querySelector('label.field span').textContent + ' | ' + document.querySelector('#uiLang').selectedOptions[0].textContent + ' | ' + document.querySelector('#order').selectedOptions[0].textContent`));
await shot(`${out}/options-de-151.png`, 1180, 900, 'dark');
ws.close();
proc.kill();
