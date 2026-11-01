import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
mkdirSync('/opt/cursor/artifacts', { recursive: true });
mkdirSync('/tmp/ibt-ui134', { recursive: true });
const css = readFileSync(`${root}src/styles/bilingual.css`, 'utf8');
const demo = `<!doctype html><meta charset="utf-8"><style>${css}
body { margin: 0; background: #e5e7eb; font: 14px/1.5 "Segoe UI", sans-serif; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 16px; }
.panel { padding: 16px 18px 20px; }
.light { background: #fff; color: #1f2937; }
.dark { background: #141414; color: #f3f4f6; }
h2 { margin: 0 0 12px; font-size: 12px; font-weight: 650; color: #6c7aff; }
.src { margin: 0 0 6px; font: 15px/1.5 Georgia, serif; }
.narrow { max-width: 220px; }
.ibt-block { margin: 0; }
</style>
<div class="grid">
  <section class="panel light"><h2>亮色 · 預設</h2>
    <p class="src">The quick brown fox jumps over the lazy dog.</p>
    <div class="ibt-block narrow"><div class="ibt-trans" data-ibt-on="light">敏捷的棕狐跨越懶狗，然後在河邊停下來。</div></div>
  </section>
  <section class="panel light ibt-highlight"><h2>亮色 · 半透明底色</h2>
    <p class="src">The quick brown fox jumps over the lazy dog.</p>
    <div class="ibt-block narrow"><div class="ibt-trans" data-ibt-on="light">敏捷的棕狐跨越懶狗，然後在河邊停下來。</div></div>
  </section>
  <section class="panel dark"><h2>深色 · 預設</h2>
    <p class="src">The quick brown fox jumps over the lazy dog.</p>
    <div class="ibt-block narrow"><div class="ibt-trans" data-ibt-on="dark">敏捷的棕狐跨越懶狗，然後在河邊停下來。</div></div>
  </section>
  <section class="panel dark ibt-highlight"><h2>深色 · 半透明底色</h2>
    <p class="src">The quick brown fox jumps over the lazy dog.</p>
    <div class="ibt-block narrow"><div class="ibt-trans" data-ibt-on="dark">敏捷的棕狐跨越懶狗，然後在河邊停下來。</div></div>
  </section>
</div>`;
writeFileSync('/tmp/ibt-ui134/highlight.html', demo);

const port = 9377;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-ui134/profile', '--window-size=1100,900', 'about:blank',
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
  runtime: { getManifest: () => ({ version: '1.4.35' }), openOptionsPage() {}, sendMessage: async () => ({}) },
  storage: { sync: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
  tabs: { query: async () => [{ id: 1, url: 'https://example.com/story' }] },
  scripting: { executeScript: async () => {}, insertCSS: async () => {} },
};` });
async function shot(file, w, h) {
  await rpc('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
  const res = await rpc('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('wrote', file);
}
async function scheme(value) {
  await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
}
await rpc('Page.navigate', { url: pathToFileURL('/tmp/ibt-ui134/highlight.html').href });
await new Promise((r) => setTimeout(r, 300));
await shot('/opt/cursor/artifacts/highlight-layers.png', 980, 560);

const dist = pathToFileURL(`${root}dist/`).href;
async function openExt(name) {
  await rpc('Page.navigate', { url: `${dist}${name}` });
  await new Promise((r) => setTimeout(r, 450));
}
await scheme('light');
await openExt('options.html');
await shot('/opt/cursor/artifacts/options-light.png', 980, 1280);
const measured = await rpc('Runtime.evaluate', { expression: `(() => {
  const box = document.getElementById('transHighlight');
  box.checked = true;
  box.dispatchEvent(new Event('change'));
  const light = document.querySelector('.tone-light .ibt-trans');
  const dark = document.querySelector('.tone-dark .ibt-trans');
  const size = (el) => {
    const a = el.getBoundingClientRect();
    const b = el.parentElement.getBoundingClientRect();
    return { text: Math.round(a.width), row: Math.round(b.width) };
  };
  return { light: size(light), dark: size(dark) };
})()`, returnByValue: true });
const widths = measured?.result?.value;
console.log('tint widths', JSON.stringify(widths));
if (!widths || widths.light.text > widths.light.row * 0.75 || widths.dark.text > widths.dark.row * 0.75) {
  console.error('tint still fills the row');
  process.exitCode = 1;
}
await new Promise((r) => setTimeout(r, 200));
await shot('/opt/cursor/artifacts/options-tint-preview.png', 980, 1280);
await scheme('dark');
await openExt('options.html');
await shot('/opt/cursor/artifacts/options-dark.png', 980, 1280);
await scheme('light');
await openExt('popup.html');
await shot('/opt/cursor/artifacts/popup-light.png', 360, 560);
await scheme('dark');
await openExt('popup.html');
await shot('/opt/cursor/artifacts/popup-dark.png', 360, 560);
ws.close();
proc.kill();
console.log('shots done');
