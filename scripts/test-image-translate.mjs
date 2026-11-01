// Run the extension's image-request code.
//
//   GEMINI_API_KEY=... node scripts/test-image-translate.mjs path/to/image.png
//
// Prints the model, the latency, and the Traditional Chinese lines.
// Without a key, check the request sequence (no network):
//
//   node scripts/test-image-translate.mjs --self-test
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
      { text_en: 'TRUE.', text_zh: '真實。', box: [0.4, 0.55, 0.1, 0.04] },
      { text_en: "THIS BABY'S SIX-EYED HALLOWEEN LOOK", text_zh: '這名寶寶的六眼萬聖節造型', box: [0.05, 0.7, 0.9, 0.2] },
    ],
  }));
  check('parses text_en and text_zh', parsed.regions[1].textZh.includes('萬聖節') && parsed.regions[0].textEn === 'TRUE.');
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
if (!got.regions.length) console.log(got.text || '(no text)');
