import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
mkdirSync('/opt/cursor/artifacts', { recursive: true });
const port = 9386;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-ui141/profile', '--window-size=1100,900', 'about:blank',
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
  runtime: { getManifest: () => ({ version: '1.4.42' }), openOptionsPage() {}, sendMessage: async () => ({}) },
  storage: { sync: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
  tabs: { query: async () => [{ id: 1, url: 'https://example.com' }] },
  scripting: { executeScript: async () => {}, insertCSS: async () => {} },
};` });
async function scheme(value) {
  await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
}
async function shotFit(file, w) {
  await rpc('Emulation.setDeviceMetricsOverride', { width: w, height: 160, deviceScaleFactor: 2, mobile: false });
  const sized = await rpc('Runtime.evaluate', { expression: 'Math.ceil(Math.max(document.body.scrollHeight, document.body.offsetHeight))', returnByValue: true });
  const h = Math.min(sized?.result?.value || 800, 1600);
  await rpc('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
  const res = await rpc('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('wrote', file, w, h);
}
async function openExt(name) {
  await rpc('Page.navigate', { url: pathToFileURL(`${root}dist/${name}`).href });
  await new Promise((r) => setTimeout(r, 500));
}
await scheme('light');
await openExt('options.html');
const audit = await rpc('Runtime.evaluate', { expression: `(() => {
  const text = document.body.innerText;
  const fox = text.includes('敏捷的棕色狐狸跳過懶狗，然後安靜地在河邊休息。');
  const bad = text.includes('敏捷的棕狐跨越懶狗');
  return {
    fox, bad,
    swatches: document.querySelectorAll('#tintSwatches .swatch').length,
    none: !document.getElementById('barColorNone').hidden && !document.getElementById('transColorNone').hidden,
    reset: !!document.getElementById('resetDefaults'),
    order: document.querySelector('label.field span') && document.body.innerText.includes('影片字幕順序'),
    instant: document.getElementById('selectionInstant').checked,
  };
})()`, returnByValue: true });
console.log('audit', JSON.stringify(audit?.result?.value));
async function shotLook(file) {
  const box = await rpc('Runtime.evaluate', { expression: `(() => {
    const el = document.querySelector('[data-panel="look"]');
    window.scrollTo(0, Math.max(0, el.offsetTop - 24));
    return { h: el.offsetHeight + 48 };
  })()`, returnByValue: true });
  const h = box?.result?.value?.h || 900;
  await rpc('Emulation.setDeviceMetricsOverride', { width: 860, height: h, deviceScaleFactor: 2, mobile: false });
  await rpc('Runtime.evaluate', { expression: `document.querySelector('[data-panel="look"]').scrollIntoView({ block: 'start' })` });
  await new Promise((r) => setTimeout(r, 80));
  const res = await rpc('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('wrote', file, h);
}
await shotLook('/opt/cursor/artifacts/options-look-light.png');
await scheme('dark');
await openExt('options.html');
await shotLook('/opt/cursor/artifacts/options-look-dark.png');
await scheme('light');
await openExt('popup.html');
await shotFit('/opt/cursor/artifacts/popup-lang-light.png', 320);
await scheme('dark');
await openExt('popup.html');
await shotFit('/opt/cursor/artifacts/popup-lang-dark.png', 320);
if (!audit?.result?.value?.fox || audit.result.value.bad || !audit.result.value.none || !audit.result.value.reset || !audit.result.value.instant) {
  console.error('options audit failed');
  process.exitCode = 1;
}
ws.close();
proc.kill();
