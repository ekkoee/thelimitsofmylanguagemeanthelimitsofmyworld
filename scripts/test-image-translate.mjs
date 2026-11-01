// Run the extension's image-request code.
//
//   GEMINI_API_KEY=... node scripts/test-image-translate.mjs path/to/image.png
//
// Prints the model, the latency, and the Traditional Chinese lines.
// Without a key, check the request sequence (no network):
//
//   node scripts/test-image-translate.mjs --self-test
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
execSync(
  'npx esbuild src/providers/gemini-image.ts --bundle --platform=node --format=esm --outfile=/tmp/ibt-image-api.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const api = await import(pathToFileURL('/tmp/ibt-image-api.mjs').href);

function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) process.exitCode = 1;
}

if (process.argv.includes('--self-test')) {
  const parsed = api.parseImageTranslation(JSON.stringify({
    regions: [
      { text_en: 'TRUE.', text_zh: '真實。', box_2d: [540, 400, 580, 520] },
      { text_en: "THIS BABY'S SIX-EYED HALLOWEEN LOOK HAS EVERYONE AT KINDERGARTEN DOING A DOUBLE TAKE", text_zh: '這名寶寶的六眼萬聖節造型讓幼兒園裡的每個人都忍不住多看兩眼', box_2d: [680, 40, 920, 960] },
      { text_en: '2014', text_zh: '2014', box_2d: [300, 80, 330, 140] },
      { text_en: 'The model writes high quality code very quickly and the whole team', text_zh: '這個模型寫程式又快又好，整個團隊', box_2d: [200, 40, 250, 900] },
      { text_en: 'notices how fast the new code lands.', text_zh: '都注意到新程式碼有多快。', box_2d: [255, 40, 310, 900] },
      { text_en: 'Productivity is surging in AI-adopting sectors in the US, but not elsewhere', text_zh: '美國採用 AI 的產業生產力激增，但其他地區則否', box_2d: [20, 20, 60, 980] },
      { text_en: 'Real output per worker in AI-adopting sectors versus the earlier trend', text_zh: '採用 AI 的產業中每位工人的實際產出，對比先前趨勢', box_2d: [80, 20, 120, 980] },
      { text_en: 'November 7, 2026', text_zh: '2026年11月7日', box_2d: [400, 40, 430, 300] },
    ],
  }));
  check('parses box_2d into fractions', parsed.regions[0].box && Math.abs(parsed.regions[0].box[0] - 0.4) < 0.01 && Math.abs(parsed.regions[0].box[1] - 0.54) < 0.01);
  check('parses text_en and text_zh', parsed.regions[1].textZh.includes('萬聖節') && parsed.regions[0].textEn === 'TRUE.');
  const placed = api.selectInPlace(parsed.regions);
  check('axis year is not painted', !placed.regions.some((r) => r.textEn === '2014'));
  check('stacked prose becomes one paragraph', placed.mode === 'inplace' && placed.regions.some((r) => r.kind === 'paragraph' && r.textZh.includes('程式碼')));
  check('a title and the subtitle under it stay two regions', placed.regions.filter((r) => r.textZh.includes('生產力') || r.textZh.includes('實際產出')).length === 2);
  check('a bare date is not painted', !placed.regions.some((r) => r.textEn.startsWith('November')));
  execSync(
    'npx esbuild src/content/image-inplace.ts --bundle --platform=node --format=esm --outfile=/tmp/ibt-image-place.mjs --log-level=error',
    { cwd: root, stdio: 'inherit' },
  );
  const place = await import(pathToFileURL('/tmp/ibt-image-place.mjs').href);
  const padded = place.padBox([0.1, 0.1, 0.2, 0.05], 1000, 500);
  const padPx = 0.05 * 500 * 0.12;
  check('pad is about 12% of the box height on every side', Math.abs(padded[0] * 1000 - (100 - padPx)) < 0.6 && Math.abs(padded[1] * 500 - (50 - padPx)) < 0.6);
  check('english echo is detected', api.echoesEnglish('TRUE.', 'TRUE.'));
  check('chinese is not an echo', !api.echoesEnglish('TRUE.', '真實。'));
  const raw = 'Gemini 429 retry=12: {"error":{"code":429,"message":"You exceeded your current quota","retryDelay":"12s"}}';
  const quota = api.friendlyTranslateError(raw, 'image');
  check('429 is a short Chinese line', quota.includes('額度不足') && quota.includes('12') && !quota.includes('{') && !quota.includes('exceeded'));
  check('no key is a Chinese prompt', api.friendlyTranslateError('NO_API_KEY:image', 'image').includes('Gemini 金鑰'));
  await sequence();
  if (process.exitCode) process.exit(process.exitCode);
  console.log('\nimage request self-test passed');
  process.exit(0);
}

async function sequence() {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    const model = decodeURIComponent(String(_url).split('/models/')[1].split(':')[0]);
    calls.push({ model, at: Date.now(), bytes: body.contents[0].parts[1].inline_data.data.length });
    const primary = calls.filter((c) => c.model === 'gemini-3.5-flash').length;
    if (model === 'gemini-3.5-flash' && primary === 1) {
      return new Response(JSON.stringify({ error: { code: 429, message: 'You exceeded your current quota', retryDelay: '1s' } }), {
        status: 429,
        headers: { 'retry-after': '1', 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ regions: [{ text_en: 'HELLO', text_zh: '你好' }] }) }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const t0 = Date.now();
  const got = await api.translateImageSequential({
    key: 'test-key',
    model: 'gemini-3.5-flash',
    mime: 'image/jpeg',
    data: 'abc',
    fetchImpl,
    log: (line) => console.log(line),
  });
  const overlap = calls.length >= 2 && calls[1].at < calls[0].at + 500;
  check('429 retries the same model once, not a second model in parallel', calls.length === 2 && calls[0].model === calls[1].model && !overlap);
  check('retry waited about a second', Date.now() - t0 >= 900);
  check('chinese came back from the retry', got.text === '你好' && got.model === 'gemini-3.5-flash');
}

const key = process.env.GEMINI_API_KEY || '';
const file = process.argv[2];
if (!key) {
  console.error('Set GEMINI_API_KEY, or run with --self-test');
  process.exit(1);
}
if (!file) {
  console.error('Usage: GEMINI_API_KEY=... node scripts/test-image-translate.mjs image.png');
  process.exit(1);
}
const bytes = readFileSync(file);
const mime = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
const t0 = Date.now();
const got = await api.translateImageSequential({
  key,
  model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  mime,
  data: bytes.toString('base64'),
  log: (line) => console.log(line),
});
console.log(`model: ${got.model}`);
console.log(`latency_ms: ${Date.now() - t0}`);
for (const region of got.regions) {
  console.log(`en: ${region.textEn}`);
  console.log(`zh: ${region.textZh}`);
}
execSync(
  'npx esbuild src/core/st2t.ts --bundle --platform=node --format=esm --outfile=/tmp/ibt-st2t.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const st2t = await import(pathToFileURL('/tmp/ibt-st2t.mjs').href);
const mapped = (got.regions || []).map((r) => ({ ...r, textZh: st2t.toTraditional(r.textZh || '') }));
const picked = api.selectInPlace(mapped);
console.log(`place: ${picked.mode} regions=${picked.regions.length}`);
const shown = picked.mode === 'inplace' ? picked.regions : mapped;
for (const region of shown) {
  console.log(`en: ${region.textEn}`);
  console.log(`zh: ${region.textZh}`);
}
if (!shown.length) console.log(got.text || '(no text)');
const htmlPath = file.replace(/\.[^.]+$/, '') + '.ibt.html';
const pngPath = file.replace(/\.[^.]+$/, '') + '.ibt.png';
writeInPlacePreview({
  htmlPath,
  pngPath,
  mime,
  bytes,
  payload: {
    mode: picked.mode,
    regions: picked.regions,
    text: st2t.toTraditional(got.text || mapped.map((r) => r.textZh).join('\n')),
  },
});

function imageSize(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) break;
      const mark = buf[o + 1];
      if (mark === 0xd8 || mark === 0xd9) { o += 2; continue; }
      const len = buf.readUInt16BE(o + 2);
      if (mark >= 0xc0 && mark <= 0xc2) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
      o += 2 + len;
    }
  }
  return { w: 1200, h: 900 };
}

function writeInPlacePreview({ htmlPath, pngPath, mime, bytes, payload }) {
  execSync(
    'npx esbuild scripts/image-paint-preview.ts --bundle --format=iife --platform=browser --outfile=/tmp/ibt-image-paint.js --log-level=error',
    { cwd: root, stdio: 'inherit' },
  );
  const css = readFileSync(`${root}src/styles/bilingual.css`, 'utf8');
  const paint = readFileSync('/tmp/ibt-image-paint.js', 'utf8');
  const { w, h } = imageSize(bytes);
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const html = `<!doctype html><meta charset="utf-8"><style>${css}
html,body{margin:0;background:#fff}
#stage{position:relative;display:inline-block}
</style><body><div id="stage"><img id="pic" alt="" width="${w}" height="${h}" src="data:${mime};base64,${bytes.toString('base64')}" style="display:block"><div id="overlay" class="ibt-img-overlay" style="left:0;top:0"></div></div>
<script>window.__ibtPaint=${json}</script>
<script>${paint}</script></body>`;
  writeFileSync(htmlPath, html);
  console.log(`html: ${htmlPath}`);
  const bins = ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const bin = bins.find((p) => existsSync(p));
  if (!bin) {
    console.log('png: skipped (chrome not found); open the html file');
    return;
  }
  const ww = Math.min(2400, Math.max(400, w));
  const wh = Math.min(1800, Math.max(300, h));
  try {
    execSync(
      `"${bin}" --headless --disable-gpu --no-sandbox --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=2500 --window-size=${ww},${wh} --screenshot="${pngPath}" "${pathToFileURL(resolve(htmlPath)).href}"`,
      { stdio: 'inherit' },
    );
    console.log(`png: ${pngPath}`);
  } catch {
    console.log('png: skipped (chrome screenshot failed); open the html file');
  }
}
