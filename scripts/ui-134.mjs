import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
mkdirSync('/opt/cursor/artifacts', { recursive: true });
mkdirSync('/tmp/ibt-ui134', { recursive: true });
const css = readFileSync(`${root}src/styles/bilingual.css`, 'utf8');
function article(tone, highlight) {
  const dark = tone === 'dark';
  const on = dark ? 'dark' : 'light';
  const bg = dark ? '#161616' : '#f7f7f5';
  const ink = dark ? '#e6e6e6' : '#1c1c1c';
  const flag = highlight ? 'data-ibt-highlight="on"' : 'data-ibt-highlight="off"';
  return `<!doctype html><html ${flag}><meta charset="utf-8"><style>${css}
html, body { margin: 0; background: ${bg}; color: ${ink}; }
article { max-width: 640px; margin: 0 auto; padding: 48px 28px 64px; }
h1 { margin: 0 0 18px; font: 600 28px/1.3 Georgia, serif; }
.src { margin: 18px 0 0; font: 17px/1.6 Georgia, serif; }
.ibt-block { margin: 2px 0 0; }
</style><body>
<article>
  <h1>${dark ? 'Night shift at the depot' : 'Morning light on the workbench'}</h1>
  <p class="src">The quiet page keeps its own color. A translation sits under each paragraph and uses that same ink, whether or not a tint is painted behind the words.</p>
  <div class="ibt-block"><div class="ibt-trans" data-ibt-on="${on}">安靜的頁面保留自己的字色。每一段下面的譯文用同樣的墨水，底色開或關都不改字的顏色。</div></div>
  <p class="src">On a long line the tint has to stop at the last glyph. It must not stretch into a bar across the column, and the next wrapped line starts its own chip.</p>
  <div class="ibt-block"><div class="ibt-trans" data-ibt-on="${on}">長句的底色必須停在最後一個字。它不該拉成橫跨整欄的色條，換行後的下一行要自己一塊貼著文字的底。</div></div>
</article></body></html>`;
}
writeFileSync('/tmp/ibt-ui134/page-light-on.html', article('light', true));
writeFileSync('/tmp/ibt-ui134/page-light-off.html', article('light', false));
writeFileSync('/tmp/ibt-ui134/page-dark-on.html', article('dark', true));
writeFileSync('/tmp/ibt-ui134/page-dark-off.html', article('dark', false));

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
  runtime: { getManifest: () => ({ version: '1.4.36' }), openOptionsPage() {}, sendMessage: async () => ({}) },
  storage: { sync: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
  tabs: { query: async () => [{ id: 1, url: 'https://example.com/story' }] },
  scripting: { executeScript: async () => {}, insertCSS: async () => {} },
};` });
async function shot(file, w, h) {
  await rpc('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
  const res = await rpc('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('wrote', file, w, h);
}
async function shotFit(file, w) {
  await rpc('Emulation.setDeviceMetricsOverride', { width: w, height: 120, deviceScaleFactor: 2, mobile: false });
  const sized = await rpc('Runtime.evaluate', {
    expression: 'Math.ceil(Math.max(document.body.scrollHeight, document.body.offsetHeight))',
    returnByValue: true,
  });
  const h = sized?.result?.value || 120;
  await shot(file, w, h);
  return h;
}
async function scheme(value) {
  await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
}
const pages = [
  ['page-light-on.html', '/opt/cursor/artifacts/page-light-tint-on.png', true],
  ['page-light-off.html', '/opt/cursor/artifacts/page-light-tint-off.png', false],
  ['page-dark-on.html', '/opt/cursor/artifacts/page-dark-tint-on.png', true],
  ['page-dark-off.html', '/opt/cursor/artifacts/page-dark-tint-off.png', false],
];
for (const [name, file, tint] of pages) {
  await rpc('Page.navigate', { url: pathToFileURL(`/tmp/ibt-ui134/${name}`).href });
  await new Promise((r) => setTimeout(r, 250));
  const measured = await rpc('Runtime.evaluate', { expression: `(() => {
    const zh = document.querySelectorAll('.ibt-trans');
    const src = document.querySelector('.src');
    const srcColor = getComputedStyle(src).color;
    return [...zh].map((el) => {
      const rects = [...el.getClientRects()];
      const block = el.parentElement.getBoundingClientRect().width;
      const bg = getComputedStyle(el).backgroundColor;
      return {
        color: getComputedStyle(el).color,
        srcColor,
        bg,
        lines: rects.length,
        last: Math.round(rects.at(-1).width),
        block: Math.round(block),
        border: getComputedStyle(el.parentElement).borderLeftWidth,
      };
    });
  })()`, returnByValue: true });
  const rows = measured?.result?.value || [];
  console.log(name, JSON.stringify(rows));
  const bad = rows.length < 2 || rows.some((row) => {
    if (row.color !== row.srcColor) return true;
    if (row.border !== '0px') return true;
    if (tint && (row.lines < 2 || row.last > row.block * 0.92)) return true;
    if (tint && name.includes('light') && !row.bg.includes('250, 235, 180')) return true;
    if (tint && name.includes('dark') && !row.bg.includes('255, 255, 255')) return true;
    if (!tint && row.bg !== 'rgba(0, 0, 0, 0)') return true;
    return false;
  });
  if (bad) {
    console.error('page tint check failed', name);
    process.exitCode = 1;
  }
  await shotFit(file, 760);
}

const dist = pathToFileURL(`${root}dist/`).href;
async function openExt(name) {
  await rpc('Page.navigate', { url: `${dist}${name}` });
  await new Promise((r) => setTimeout(r, 450));
}
await scheme('light');
await openExt('options.html');
const preview = await rpc('Runtime.evaluate', { expression: `(() => {
  const light = document.querySelector('.tone-light .ibt-trans');
  const dark = document.querySelector('.tone-dark .ibt-trans');
  const hero = document.getElementById('readerZh');
  const size = (el) => {
    const a = el.getBoundingClientRect();
    const b = el.parentElement.getBoundingClientRect();
    return { text: Math.round(a.width), row: Math.round(b.width), bg: getComputedStyle(el).backgroundColor };
  };
  const gone = ['transColor', 'barStyle', 'barColor'].filter((id) => document.getElementById(id));
  return { light: size(light), dark: size(dark), hero: size(hero), gone, checked: document.getElementById('transHighlight').checked };
})()`, returnByValue: true });
const widths = preview?.result?.value;
console.log('options preview', JSON.stringify(widths));
if (!widths || widths.gone.length || !widths.checked
  || widths.light.text > widths.light.row * 0.75
  || widths.dark.text > widths.dark.row * 0.75
  || !widths.light.bg.includes('250, 235, 180')
  || !String(widths.dark.bg).includes('255, 255, 255')) {
  console.error('options tint preview failed');
  process.exitCode = 1;
}
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
ws.close();
proc.kill();
console.log('shots done');
