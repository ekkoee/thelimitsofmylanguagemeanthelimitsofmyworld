import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const css = readFileSync(`${root}src/styles/bilingual.css`, 'utf8');
mkdirSync('/tmp/ibt-gap', { recursive: true });
mkdirSync('/opt/cursor/artifacts', { recursive: true });

const surfaces = [
  ['white', '#fff', '#1a1d29', 'light'],
  ['ink', '#1a1a1a', '#e8e8e8', 'dark'],
  ['black', '#000', '#e7e9ea', 'dark'],
  ['dim', '#15202b', '#e7e9ea', 'dark'],
];
const sizes = [14, 15, 16];
const text = '發射窗口在黎明打開現場沒有人把聲音提高到耳語以上這一行要換成三行以上才能看出間距。';
const cells = sizes.flatMap((size) => surfaces.map(([name, bg, color, on]) => `
<section class="cell ${name}" style="font-size:${size}px">
  <h2>${size}px · ${bg}</h2>
  <div class="ibt-block" style="width:180px;font-size:${size}px"><div class="ibt-trans" data-ibt-on="${on}"><span>${text}</span></div></div>
</section>`)).join('');

writeFileSync('/tmp/ibt-gap/gap.html', `<!doctype html><html data-ibt-highlight="on"><meta charset="utf-8"><style>${css}
body { margin: 0; background: #cfd3dc; }
.grid { display: grid; grid-template-columns: repeat(4, 220px); gap: 12px; padding: 16px; }
.cell { padding: 12px; border-radius: 12px; }
.white { background: #fff; color: #1a1d29; }
.ink { background: #1a1a1a; color: #e8e8e8; }
.black { background: #000; color: #e7e9ea; }
.dim { background: #15202b; color: #e7e9ea; }
h2 { margin: 0 0 8px; font: 600 11px/1.3 "Segoe UI", sans-serif; }
</style><div class="grid">${cells}</div></html>`);

const port = 9383;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-gap/profile', '--window-size=1100,1400', 'about:blank',
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
await rpc('Page.navigate', { url: pathToFileURL('/tmp/ibt-gap/gap.html').href });
await new Promise((r) => setTimeout(r, 300));
await rpc('Emulation.setDeviceMetricsOverride', { width: 980, height: 200, deviceScaleFactor: 2, mobile: false });
const measured = await rpc('Runtime.evaluate', { expression: `(() => {
  return [...document.querySelectorAll('.cell')].map((cell) => {
    const span = cell.querySelector('.ibt-trans > span');
    const rects = [...span.getClientRects()].map((r) => ({ top: r.top, bottom: r.bottom, h: r.height }));
    const gaps = [];
    for (let i = 1; i < rects.length; i++) gaps.push(Math.round((rects[i].top - rects[i - 1].bottom) * 100) / 100);
    return { label: cell.querySelector('h2').textContent, lines: rects.length, gaps };
  });
})()`, returnByValue: true });
const rows = measured?.result?.value || [];
console.log(JSON.stringify(rows, null, 2));
let bad = false;
for (const row of rows) {
  if (row.lines < 3) bad = true;
  if (row.gaps.some((g) => g < 2 || g > 4)) bad = true;
}
if (bad) process.exitCode = 1;
const sized = await rpc('Runtime.evaluate', { expression: 'Math.ceil(document.body.scrollHeight)', returnByValue: true });
const h = sized?.result?.value || 900;
await rpc('Emulation.setDeviceMetricsOverride', { width: 980, height: h, deviceScaleFactor: 3, mobile: false });
const shot = await rpc('Page.captureScreenshot', { format: 'png' });
writeFileSync('/opt/cursor/artifacts/tint-gap.png', Buffer.from(shot.data, 'base64'));
console.log('wrote tint-gap.png', h, bad ? 'FAIL' : 'PASS');
const clip = await rpc('Runtime.evaluate', { expression: `(() => {
  const cell = [...document.querySelectorAll('.cell')].find((n) => n.querySelector('h2').textContent.includes('15px') && n.classList.contains('dim'));
  const r = cell.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
})()`, returnByValue: true });
const c = clip?.result?.value;
if (c) {
  const zoom = await rpc('Page.captureScreenshot', { format: 'png', clip: { x: c.x, y: c.y, width: c.width, height: c.height, scale: 3 } });
  writeFileSync('/opt/cursor/artifacts/tint-gap-15202b-15px.png', Buffer.from(zoom.data, 'base64'));
  console.log('wrote tint-gap-15202b-15px.png');
}
const dict = `<!doctype html><meta charset="utf-8"><style>${css}
body { margin: 0; background: #f4f6fb; }
.ibt-sel-card { position: relative !important; margin: 24px; max-height: none !important; overflow: visible !important; }
</style>
<div class="ibt-sel-card">
  <div class="ibt-sel-head"><span class="ibt-sel-grip"></span></div>
  <div class="ibt-sel-orig"><span>Competition</span></div>
  <div class="ibt-sel-body">競爭<div class="ibt-sel-dict"><div>名詞 比賽、競賽、競爭</div><div>動詞 參加比賽</div></div></div>
  <div class="ibt-sel-actions"><button class="ibt-sel-copy">複製</button></div>
</div>`;
writeFileSync('/tmp/ibt-gap/dict.html', dict);
await rpc('Page.navigate', { url: pathToFileURL('/tmp/ibt-gap/dict.html').href });
await new Promise((r) => setTimeout(r, 250));
await rpc('Emulation.setDeviceMetricsOverride', { width: 400, height: 280, deviceScaleFactor: 2, mobile: false });
const dictShot = await rpc('Page.captureScreenshot', { format: 'png' });
writeFileSync('/opt/cursor/artifacts/selection-dict.png', Buffer.from(dictShot.data, 'base64'));
console.log('wrote selection-dict.png');
ws.close();
proc.kill();
