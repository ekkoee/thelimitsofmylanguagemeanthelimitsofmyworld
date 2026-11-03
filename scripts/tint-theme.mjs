import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
mkdirSync('/tmp/ibt-theme', { recursive: true });
mkdirSync('/opt/cursor/artifacts', { recursive: true });
execSync('npx esbuild scripts/tint-theme-entry.ts --bundle --format=iife --platform=browser --outfile=/tmp/ibt-theme/theme.js --log-level=error', { cwd: root, stdio: 'inherit' });
const css = readFileSync(`${root}src/styles/bilingual.css`, 'utf8');
const text = '發射窗口在黎明打開，現場沒有人把聲音提高到耳語以上，這一行要換成三行。';
const faces = [
  ['x-dark', '#000', '#e7e9ea'],
  ['x-dim', '#15202b', '#e7e9ea'],
  ['x-light', '#fff', '#0f1419'],
  ['li-light', '#fff', '#191919'],
  ['li-dark', '#1b1f23', '#e9e9e9'],
  ['page', '#f7f7f5', '#1c1c1c'],
];
const faceHtml = faces.map(([name, bg, color]) => `
<article class="face" data-face="${name}" style="background:${bg};color:${color}">
  <h2>${name}</h2>
  <div class="cols">
    <div class="col">
      <div class="ibt-block"><div class="ibt-trans"><span>${text}</span></div><div class="ibt-trans"><span>第二句維持原來的句距。</span></div></div>
    </div>
    <div class="col ibt-highlight">
      <div class="ibt-block"><div class="ibt-trans"><span>${text}</span></div><div class="ibt-trans"><span>第二句維持原來的句距。</span></div></div>
    </div>
  </div>
</article>`).join('');
writeFileSync('/tmp/ibt-theme/page.html', `<!doctype html><html data-theme="dark"><meta charset="utf-8"><style>${css}
body { margin: 0; background: #888; }
.face { margin: 12px; padding: 12px; border-radius: 12px; max-width: 560px; }
h2 { margin: 0 0 8px; font: 600 12px/1.3 "Segoe UI", sans-serif; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ibt-block { width: 220px; }
html[data-theme="light"] #live { background: #fff; color: #0f1419; }
html[data-theme="dark"] #live { background: #000; color: #e7e9ea; }
#live { margin: 12px; padding: 12px; border-radius: 12px; width: 240px; }
</style>
${faceHtml}
<article id="live"><h2>runtime</h2><div class="ibt-highlight"><div class="ibt-block"><div class="ibt-trans"><span>${text}</span></div></div></div></article>
</html>`);

const port = 9384;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-theme/profile', '--window-size=900,1600', 'about:blank',
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
await rpc('Page.navigate', { url: pathToFileURL('/tmp/ibt-theme/page.html').href });
await new Promise((r) => setTimeout(r, 250));
const src = pathToFileURL('/tmp/ibt-theme/theme.js').href;
await rpc('Runtime.evaluate', {
  expression: `new Promise((resolve) => { const s = document.createElement('script'); s.src = ${JSON.stringify(src)}; s.onload = () => setTimeout(resolve, 50); document.body.appendChild(s); })`,
  awaitPromise: true,
});
await rpc('Emulation.setDeviceMetricsOverride', { width: 640, height: 400, deviceScaleFactor: 1, mobile: false });
const report = await rpc('Runtime.evaluate', { expression: `(() => {
  const pitch = (span) => {
    const rects = [...span.getClientRects()];
    const gaps = [];
    const steps = [];
    for (let i = 1; i < rects.length; i++) {
      gaps.push(Math.round((rects[i].top - rects[i - 1].bottom) * 100) / 100);
      steps.push(Math.round((rects[i].top - rects[i - 1].top) * 100) / 100);
    }
    return { lines: rects.length, gaps, steps };
  };
  const faces = [...document.querySelectorAll('.face')].map((face) => {
    const cols = [...face.querySelectorAll('.col')];
    const off = pitch(cols[0].querySelector('.ibt-trans span'));
    const on = pitch(cols[1].querySelector('.ibt-trans span'));
    const chip = getComputedStyle(cols[1].querySelector('.ibt-trans span')).backgroundColor;
    const mode = cols[1].querySelector('.ibt-trans').getAttribute('data-ibt-on');
    const offBlocks = [...cols[0].querySelectorAll('.ibt-trans')].map((n) => n.getBoundingClientRect().top);
    const onBlocks = [...cols[1].querySelectorAll('.ibt-trans')].map((n) => n.getBoundingClientRect().top);
    return {
      face: face.dataset.face,
      mode,
      chip,
      off, on,
      sentence: Math.round((onBlocks[1] - onBlocks[0] - (offBlocks[1] - offBlocks[0])) * 100) / 100,
    };
  });
  return faces;
})()`, returnByValue: true });
const rows = report?.result?.value || [];
console.log(JSON.stringify(rows, null, 2));
let bad = false;
for (const face of rows) {
  const dark = face.face.endsWith('dark') || face.face === 'x-dim';
  if (dark && face.mode !== 'dark') bad = true;
  if (!dark && face.mode !== 'light') bad = true;
  if (dark && String(face.chip).includes('236, 170')) bad = true;
  if (!dark && !String(face.chip).includes('236, 170')) bad = true;
  if (face.on.lines < 3 || face.on.gaps.some((g) => g < 0)) bad = true;
  if (face.off.steps.length && face.on.steps.some((step, i) => Math.abs(step - face.off.steps[i]) > 0.6)) bad = true;
  if (Math.abs(face.sentence) > 0.6) bad = true;
}
const fullH = await rpc('Runtime.evaluate', { expression: 'Math.ceil(document.body.scrollHeight)', returnByValue: true });
await rpc('Emulation.setDeviceMetricsOverride', { width: 640, height: fullH?.result?.value || 1400, deviceScaleFactor: 1, mobile: false });
const full = await rpc('Page.captureScreenshot', { format: 'png' });
writeFileSync('/opt/cursor/artifacts/tint-theme-100.png', Buffer.from(full.data, 'base64'));
console.log('wrote tint-theme-100.png');
await rpc('Emulation.setDeviceMetricsOverride', { width: 640, height: 520, deviceScaleFactor: 1, mobile: false });
const dim = await rpc('Runtime.evaluate', { expression: `(() => {
  const face = document.querySelector('[data-face="x-dim"]');
  const r = face.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
})()`, returnByValue: true });
const box = dim?.result?.value;
if (box) {
  const shot = await rpc('Page.captureScreenshot', { format: 'png', clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 } });
  writeFileSync('/opt/cursor/artifacts/tint-spacing-x-dim.png', Buffer.from(shot.data, 'base64'));
}
const before = await rpc('Runtime.evaluate', { expression: `document.querySelector('#live .ibt-trans').getAttribute('data-ibt-on')`, returnByValue: true });
await rpc('Runtime.evaluate', { expression: `document.documentElement.setAttribute('data-theme', 'light')` });
await new Promise((r) => setTimeout(r, 80));
const after = await rpc('Runtime.evaluate', { expression: `(() => {
  const el = document.querySelector('#live .ibt-trans');
  return { mode: el.getAttribute('data-ibt-on'), chip: getComputedStyle(el.querySelector('span')).backgroundColor };
})()`, returnByValue: true });
console.log('theme', before?.result?.value, JSON.stringify(after?.result?.value));
if (before?.result?.value !== 'dark' || after?.result?.value?.mode !== 'light') bad = true;
if (bad) {
  console.error('theme or spacing check failed');
  process.exitCode = 1;
} else console.log('PASS');
ws.close();
proc.kill();
