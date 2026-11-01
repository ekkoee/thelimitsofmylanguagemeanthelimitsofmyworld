// OCR the Economist chart, keep each label in its own box, and paint Chinese at glyph height.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createWorker } from 'tesseract.js';

const root = new URL('..', import.meta.url).pathname;
const src = '/cursor/stores/bot/grok-bot/agents/baca523c-02d6-4958-a214-119edef069bb/attachments/01M6AS6A7WQFSM42F1X9Q5ZTA8.png';
mkdirSync('/tmp/ibt-chart', { recursive: true });
mkdirSync('/opt/cursor/artifacts', { recursive: true });
copyFileSync(src, '/opt/cursor/artifacts/chart-before.png');
copyFileSync(src, '/tmp/ibt-chart/chart.png');

execSync(
  'npx esbuild scripts/chart-lib-entry.ts --bundle --platform=node --format=esm --outfile=/tmp/ibt-chart/lib.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const lib = await import(pathToFileURL('/tmp/ibt-chart/lib.mjs').href);

const worker = await createWorker('eng');
await worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
const result = await worker.recognize('/tmp/ibt-chart/chart.png');
await worker.terminate();
const words = (result.data.words || []).filter((w) => (w.confidence || 0) >= 60 && w.text && !lib.isOcrNoise(w.text));
const tokens = words.map((w) => ({
  text: w.text.trim(),
  x: w.bbox.x0,
  y: w.bbox.y0,
  w: w.bbox.x1 - w.bbox.x0,
  h: w.bbox.y1 - w.bbox.y0,
}));
const { width, height } = { width: 957, height: 857 };
const regions = lib.tokensToRegions(tokens, width, height);
const kept = regions.filter((r) => !lib.shouldSkipImageText(r.text));
console.log('regions', regions.map((r) => `${r.text} @${r.box.map((n) => n.toFixed(2)).join(',')}`).join('\n'));

let failed = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failed += 1;
}
const texts = regions.map((r) => r.text);
check('Sweden is its own label', texts.some((t) => /sweden/i.test(t) && t.length < 24));
check('Netherlands is its own label', texts.some((t) => /netherlands/i.test(t) && t.length < 24));
check('Switzerland is its own label', texts.some((t) => /switzerland/i.test(t) && t.length < 24));
check('no symbol junk regions', !texts.some((t) => lib.isOcrNoise(t) || /^[@®o]|\[J/.test(t)));
check('bare abbreviations stay pixels', !kept.some((r) => /^(US|TX|FL|NY|CA|UK|OH|MI|IL|PA|NC|GA)$/.test(r.text)));
check('short labels are not chart-wide', kept.filter((r) => r.text.split(/\s+/).length <= 3).every((r) => r.box[2] < 0.42));

async function translate(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=${encodeURIComponent(text)}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      return (data[0] || []).map((part) => part[0] || '').join('').trim();
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  return text;
}

const painted = [];
for (const region of kept) {
  const textZh = await translate(region.text);
  painted.push({
    textEn: region.text,
    textZh,
    box: region.box,
    kind: 'line',
  });
  console.log(`${region.text} -> ${textZh}`);
}

execSync(
  'npx esbuild scripts/image-paint-preview.ts --bundle --format=iife --platform=browser --outfile=/tmp/ibt-chart/paint.js --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const css = readFileSync(`${root}src/styles/bilingual.css`, 'utf8');
const paint = readFileSync('/tmp/ibt-chart/paint.js', 'utf8');
const b64 = readFileSync('/tmp/ibt-chart/chart.png').toString('base64');
const payload = JSON.stringify({ mode: 'inplace', regions: painted, text: '' }).replace(/</g, '\\u003c');
const htmlPath = '/tmp/ibt-chart/view.html';
writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><style>${css}
html,body{margin:0;background:#fff}
#stage{position:relative;display:inline-block}
</style><body><div id="stage"><img id="pic" width="957" height="857" src="data:image/png;base64,${b64}"><div id="overlay" class="ibt-img-overlay" style="left:0;top:0"></div></div><script>window.__ibtPaint=${payload}</script><script>${paint}</script></body>`);

const port = 9355;
const chrome = '/opt/google/chrome/chrome';
const proc = (await import('node:child_process')).spawn(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-chart/profile', '--window-size=1000,920', 'about:blank',
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
await rpc('Emulation.setDeviceMetricsOverride', { width: 980, height: 900, deviceScaleFactor: 1, mobile: false });
await rpc('Page.navigate', { url: pathToFileURL(htmlPath).href });
await new Promise((r) => setTimeout(r, 700));
const measured = await rpc('Runtime.evaluate', {
  expression: `(() => {
    const img = document.getElementById('pic');
    const nodes = [...document.querySelectorAll('.ibt-img-region')];
    const regions = window.__ibtPaint.regions;
    return nodes.map((el, i) => {
      const rawH = (regions[i]?.box?.[3] || 0) * img.clientHeight;
      const font = parseFloat(getComputedStyle(el).fontSize);
      return { text: el.textContent, font, rawH, wide: el.clientWidth };
    });
  })()`,
  returnByValue: true,
});
const rows = measured?.result?.value || [];
console.log(rows.map((r) => `${r.text} font ${r.font}px box ${r.rawH.toFixed(1)}px`).join('\n'));
check('every label font is within the source box', rows.length > 0 && rows.every((r) => r.font <= r.rawH + 0.75));
const shot = await rpc('Page.captureScreenshot', { format: 'png' });
writeFileSync('/opt/cursor/artifacts/chart-after.png', Buffer.from(shot.data, 'base64'));
ws.close();
proc.kill();
if (failed) process.exit(1);
console.log('chart ocr test passed');
