// Draw text images, OCR them with tesseract.js, translate with free Google, render in place.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createWorker } from 'tesseract.js';

const root = new URL('..', import.meta.url).pathname;
mkdirSync('/tmp/ibt-ocr', { recursive: true });
mkdirSync('/opt/cursor/artifacts', { recursive: true });
execSync(
  'npx esbuild src/ocr/paragraphs.ts --bundle --platform=node --format=esm --outfile=/tmp/ibt-ocr-paragraphs.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const { tokensToRegions } = await import(pathToFileURL('/tmp/ibt-ocr-paragraphs.mjs').href);

const scenes = [
  { id: 'ft', w: 880, h: 220, lines: [
    ['Productivity is surging in AI sectors', 24, 48, 22],
    ['US', 40, 120, 20], ['UK', 220, 120, 20], ['Canada', 400, 120, 20], ['Sweden', 620, 120, 20],
  ], expect: ['Productivity', 'Canada'] },
  { id: 'article', w: 760, h: 180, lines: [
    ['Bret rewrote the JavaScript over a weekend.', 24, 50, 20],
    ['The new code was a third of the size.', 24, 86, 20],
  ], expect: ['JavaScript', 'weekend'] },
  { id: 'email', w: 720, h: 160, lines: [
    ['Hi Scott, watermarking is now enabled.', 28, 60, 22],
  ], expect: ['Scott', 'watermarking'] },
  { id: 'manga', w: 640, h: 280, bubble: true, lines: [
    ['Did you see the comet?', 180, 120, 22],
  ], expect: ['comet'] },
  { id: 'x', w: 760, h: 160, lines: [
    ['A new photo model shipped today.', 24, 80, 28],
  ], expect: ['photo', 'shipped'] },
  { id: 's6', w: 640, h: 120, lines: [['The library closes at six.', 20, 60, 22]], expect: ['library'] },
  { id: 's7', w: 640, h: 120, lines: [['Please bring the blue notebook.', 20, 60, 22]], expect: ['notebook'] },
  { id: 's8', w: 640, h: 120, lines: [['Markets opened higher on Monday.', 20, 60, 22]], expect: ['Monday'] },
  { id: 's9', w: 640, h: 120, lines: [['The train leaves from platform four.', 20, 60, 22]], expect: ['platform'] },
  { id: 's10', w: 640, h: 120, lines: [['She published the notes last night.', 20, 60, 22]], expect: ['published'] },
];

function page() {
  const blocks = scenes.map((scene) => {
    const draws = scene.lines.map(([text, x, y, size]) => `g.fillText(${JSON.stringify(text)}, ${x}, ${y}); g.font = '${size}px sans-serif';`).join('\n');
    // font must be set before fillText
    const textDraws = scene.lines.map(([text, x, y, size]) => `g.font='${size}px Georgia, serif'; g.fillStyle='#222'; g.fillText(${JSON.stringify(text)}, ${x}, ${y});`).join('');
    const bubble = scene.bubble
      ? `g.fillStyle='#f7f7f7'; g.fillRect(140,80,360,110); g.strokeStyle='#222'; g.strokeRect(140,80,360,110);`
      : '';
    const bg = scene.bubble ? '#2b2b2b' : '#f4f1ea';
    return `(() => { const c=document.createElement('canvas'); c.width=${scene.w}; c.height=${scene.h}; const g=c.getContext('2d'); g.fillStyle='${bg}'; g.fillRect(0,0,c.width,c.height); ${bubble} ${textDraws} document.getElementById('out').insertAdjacentHTML('beforeend', '<div data-id="${scene.id}">'+c.toDataURL()+'</div>'); })();`;
  }).join('\n');
  return `<!doctype html><meta charset="utf-8"><body><div id="out"></div><script>${blocks}</script></body>`;
}

writeFileSync('/tmp/ibt-ocr/src.html', page());
const dom = execSync(
  '/opt/google/chrome/chrome --headless --disable-gpu --no-sandbox --virtual-time-budget=4000 --dump-dom file:///tmp/ibt-ocr/src.html',
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
const images = new Map();
for (const match of dom.matchAll(/data-id="([^"]+)">data:image\/png;base64,([^<]+)/g)) {
  const buf = Buffer.from(match[2], 'base64');
  const file = `/tmp/ibt-ocr/${match[1]}.png`;
  writeFileSync(file, buf);
  images.set(match[1], file);
}
if (images.size !== scenes.length) {
  console.error('drew', images.size, 'images');
  process.exit(1);
}

const worker = await createWorker('eng');
const times = [];
let ok = 0;
const rendered = [];
for (const scene of scenes) {
  const file = images.get(scene.id);
  const t0 = Date.now();
  const result = await worker.recognize(file);
  const ms = Date.now() - t0;
  times.push(ms);
  const words = (result.data.words || []).filter((w) => (w.confidence || 0) >= 45 && w.text.trim()).map((w) => ({
    text: w.text.trim(), x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0,
  }));
  const regions = tokensToRegions(words, scene.w, scene.h, []);
  const text = regions.map((r) => r.text).join(' ');
  const hit = scene.expect.every((word) => text.toLowerCase().includes(word.toLowerCase()));
  if (hit) ok += 1;
  console.log(`${hit ? 'OK' : 'MISS'} ${scene.id} ${ms}ms "${text.slice(0, 120)}"`);
  if (['ft', 'article', 'email', 'manga', 'x'].includes(scene.id)) rendered.push({ scene, regions, file });
}
await worker.terminate();
const mean = Math.round(times.reduce((s, n) => s + n, 0) / times.length);
console.log(`ocr ${ok}/${scenes.length} mean ${mean}ms`);
if (ok < 10) process.exit(1);

async function translate(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=${encodeURIComponent(text)}`;
  let last = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    last = res.status;
    if (res.ok) {
      const data = await res.json();
      return (data[0] || []).map((part) => part[0] || '').join('').trim();
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw new Error(`gtx ${last}`);
}

execSync(
  'npx esbuild scripts/image-paint-preview.ts --bundle --format=iife --platform=browser --outfile=/tmp/ibt-ocr/paint.js --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const css = readFileSync(`${root}src/styles/bilingual.css`, 'utf8');
const paint = readFileSync('/tmp/ibt-ocr/paint.js', 'utf8');
for (const item of rendered) {
  const regions = [];
  for (const region of item.regions) {
    const textZh = await translate(region.text);
    console.log(`zh ${item.scene.id}: ${textZh}`);
    regions.push({ textEn: region.text, textZh, box: region.box, kind: region.text.split(/\s+/).length >= 6 ? 'paragraph' : 'line' });
  }
  const b64 = readFileSync(item.file).toString('base64');
  const htmlPath = `/tmp/ibt-ocr/${item.scene.id}.html`;
  const pngPath = `/opt/cursor/artifacts/ocr-${item.scene.id}.png`;
  const payload = JSON.stringify({ mode: 'inplace', regions, text: '' }).replace(/</g, '\\u003c');
  writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8"><style>${css} html,body{margin:0;background:#fff} #stage{position:relative;display:inline-block}</style><body><div id="stage"><img id="pic" width="${item.scene.w}" height="${item.scene.h}" src="data:image/png;base64,${b64}"><div id="overlay" class="ibt-img-overlay" style="left:0;top:0"></div></div><script>window.__ibtPaint=${payload}</script><script>${paint}</script></body>`);
  execSync(`/opt/google/chrome/chrome --headless --disable-gpu --no-sandbox --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=2000 --window-size=${item.scene.w},${item.scene.h + 20} --screenshot=${pngPath} ${pathToFileURL(htmlPath).href}`, { stdio: 'inherit' });
}
console.log('ocr local test passed');
