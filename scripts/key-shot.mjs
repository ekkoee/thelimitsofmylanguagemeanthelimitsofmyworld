// Screenshot the options key field accepting an AQ.-style example. The example is not a real key.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const EXAMPLE = 'AQ.Ab8RN6example-not-a-real-key';
mkdirSync('/opt/cursor/artifacts', { recursive: true });
mkdirSync('/tmp/ibt-key', { recursive: true });

const port = 9378;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-key/profile', '--window-size=1100,900', 'about:blank',
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
  runtime: { getManifest: () => ({ version: '1.4.37' }), openOptionsPage() {}, sendMessage: async () => ({}) },
  storage: { sync: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
  tabs: { query: async () => [{ id: 1, url: 'https://example.com/story' }] },
  scripting: { executeScript: async () => {}, insertCSS: async () => {} },
};
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('https://generativelanguage.googleapis.com/v1beta/models') && (!init || !init.method || init.method === 'GET')) {
    return new Response('{"models":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 599 });
};` });
await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
const dist = pathToFileURL(`${root}dist/`).href;
await rpc('Page.navigate', { url: `${dist}options.html` });
await new Promise((r) => setTimeout(r, 500));
await rpc('Emulation.setDeviceMetricsOverride', { width: 980, height: 720, deviceScaleFactor: 2, mobile: false });
const applied = await rpc('Runtime.evaluate', { expression: `(() => {
  const provider = document.getElementById('provider');
  provider.value = 'gemini';
  provider.dispatchEvent(new Event('change'));
  const input = document.getElementById('key_gemini');
  input.focus();
  input.value = ${JSON.stringify(EXAMPLE)};
  input.dispatchEvent(new Event('change'));
  return true;
})()`, returnByValue: true });
if (!applied?.result?.value) {
  console.error('could not fill the key field');
  process.exitCode = 1;
}
let note = '';
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 100));
  const got = await rpc('Runtime.evaluate', { expression: `document.getElementById('keyNote').textContent`, returnByValue: true });
  note = got?.result?.value || '';
  if (note && note !== '檢查中…') break;
}
const measured = await rpc('Runtime.evaluate', { expression: `(() => {
  const input = document.getElementById('key_gemini');
  input.type = 'text';
  const en = document.querySelector('.reader-en').getBoundingClientRect();
  const zh = document.getElementById('readerZh').getBoundingClientRect();
  const block = document.getElementById('geminiBlock').getBoundingClientRect();
  return {
    note: document.getElementById('keyNote').textContent,
    state: document.getElementById('keyNote').dataset.state || '',
    startsAq: input.value.startsWith('AQ.'),
    placeholder: input.placeholder,
    heroDx: Math.round((zh.left - en.left) * 10) / 10,
    clip: { x: Math.max(0, block.x - 16), y: Math.max(0, block.y - 16), width: Math.min(520, block.width + 32), height: block.height + 8 },
  };
})()`, returnByValue: true });
const info = measured?.result?.value;
console.log('key ui', JSON.stringify({ note: info?.note, state: info?.state, startsAq: info?.startsAq, placeholder: info?.placeholder, heroDx: info?.heroDx }));
if (!info || info.note !== '已儲存' || info.state !== 'ok' || !info.startsAq || Math.abs(info.heroDx) > 1) {
  console.error('key field or hero alignment failed');
  process.exitCode = 1;
}
const clip = info.clip;
const shot = await rpc('Page.captureScreenshot', {
  format: 'png',
  clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 2 },
});
writeFileSync('/opt/cursor/artifacts/gemini-key-aq.png', Buffer.from(shot.data, 'base64'));
console.log('wrote gemini-key-aq.png');
const hero = await rpc('Runtime.evaluate', { expression: `(() => {
  const card = document.getElementById('reader').getBoundingClientRect();
  return { x: card.x, y: card.y, width: card.width, height: card.height };
})()`, returnByValue: true });
const h = hero?.result?.value;
if (h) {
  const heroShot = await rpc('Page.captureScreenshot', {
    format: 'png',
    clip: { x: h.x, y: h.y, width: h.width, height: h.height, scale: 2 },
  });
  writeFileSync('/opt/cursor/artifacts/options-hero-align.png', Buffer.from(heroShot.data, 'base64'));
  console.log('wrote options-hero-align.png');
}
ws.close();
proc.kill();
