// Pair shape of /translate_a/t vs gtx /single, plus 8-paragraph timing.
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
execSync(
  'npx esbuild src/providers/google.ts --bundle --format=esm --platform=node --outfile=/tmp/ibt-google-155.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const { googleProvider, sentencesLikeGtx } = await import(pathToFileURL('/tmp/ibt-google-155.mjs').href);

const fixtures = [
  'Nobody talked about price, nobody shilled the token and told the audience to buy.',
  'The virtue signaling was not about being superior to other forms of money, but about supporting humanitarian efforts with community grants. There were lots of technical discussions.',
  '1. Nobody talked about price. 2. Cypherpunks write code.',
  'See https://example.com/a and also @someone #tag.',
  'Zcash is more decentralized 🚀 than last year. Teams ship in the open.',
  '進步不一定要更快。真正的進步是選擇自己的速度。',
  '좋은 디자인은 조용합니다. 읽기를 도우면서도 방해하지 않습니다.',
  '良いデザインは静かです。読むことを助け、邪魔をしません。',
  'The only response was “we wish they were here to debate the matters as a community”.',
  'Dr. Smith went to the U.S. conference. He spoke at 3 p.m. about ZSA.',
];
const settings = { targetLangCode: 'zh-TW', sourceLang: 'auto' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realFetch = globalThis.fetch.bind(globalThis);
let failed = 0;
function check(name, cond, extra) {
  if (!cond) { failed++; console.error('FAIL', name, extra || ''); }
  else console.log('ok', name);
}

// Mock /t returns one translation per q. Pair originals must stay the whole line.
let sawT = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/translate_a/t')) {
    sawT++;
    await sleep(80);
    const q = new URL(u).searchParams.get('q') || '';
    return { status: 200, ok: true, json: async () => [[`譯:${q.slice(0, 8)}`, 'en']] };
  }
  throw new Error('single should not be called');
};
for (const text of fixtures) {
  const pairs = await googleProvider.translateBlock(text, settings);
  const sameO = pairs.length === 1 && pairs[0].o === text;
  check('pair o ' + text.slice(0, 24), sameO, JSON.stringify(pairs.map((p) => p.o)));
}
check('used /t', sawT === fixtures.length, String(sawT));

// Unparseable /t falls back to /single and keeps that pair.
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/translate_a/t')) return { status: 200, ok: true, json: async () => ({ nope: true }) };
  const q = new URL(u).searchParams.get('q') || '';
  return { status: 200, ok: true, json: async () => [[[`舊:${q}`, q]]] };
};
const fell = await googleProvider.translateBlock('Hello there.', settings);
check('fallback o', fell.length === 1 && fell[0].o === 'Hello there.' && fell[0].t === '舊:Hello there.', JSON.stringify(fell));

// Eight paragraphs, mock 80ms on /t. No global gap.
const lines = fixtures.slice(0, 8);
globalThis.fetch = async (url) => {
  await sleep(80);
  const q = new URL(String(url)).searchParams.get('q') || '';
  return { status: 200, ok: true, json: async () => [[`譯`, 'en']] };
};
const t0 = performance.now();
await Promise.all(lines.map((line) => googleProvider.translateBlock(line, settings)));
const mockMs = Math.round(performance.now() - t0);
console.log('mock eight paragraphs', mockMs + 'ms');
check('mock under 400ms', mockMs < 400, String(mockMs));

async function liveOne(label, url) {
  const t = performance.now();
  try {
    const res = await realFetch(url);
    const ms = Math.round(performance.now() - t);
    console.log(label, res.status, ms + 'ms');
    return { status: res.status, ms };
  } catch (err) {
    console.log(label, String(err.name || err.message));
    return { status: 0, ms: 0 };
  }
}
const sample = encodeURIComponent(lines[0]);
await liveOne('live /t dict-chrome-ex', `https://translate.googleapis.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=zh-TW&q=${sample}`);
await liveOne('live /t gtx', `https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&tl=zh-TW&q=${sample}`);
await liveOne('live /single gtx', `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-TW&dt=t&q=${sample}`);

// Pair originals vs live /single.
let compared = 0;
let equal = 0;
for (const text of fixtures) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-TW&dt=t&q=' + encodeURIComponent(text);
  try {
    const res = await realFetch(url);
    if (!res.ok) { console.log('gtx', res.status, text.slice(0, 20)); continue; }
    const data = await res.json();
    const origs = (Array.isArray(data?.[0]) ? data[0] : [])
      .filter((s) => Array.isArray(s) && s[1])
      .map((s) => String(s[1]).trim());
    const ours = sentencesLikeGtx(text);
    compared++;
    const ok = origs.length === ours.length && origs.every((o, i) => o === ours[i]);
    if (ok) equal++;
    else console.log('DIFF', text.slice(0, 40), origs, ours);
  } catch (err) {
    console.log('gtx err', String(err.message || err).slice(0, 80));
  }
}
console.log('gtx orig match', equal + '/' + compared);
check('gtx origs that answered match', compared >= 8 && equal === compared, equal + '/' + compared);

globalThis.fetch = realFetch;
const tLive = performance.now();
const livePairs = await Promise.all(lines.map((line) => googleProvider.translateBlock(line, settings).then((pairs) => pairs.map((p) => p.t).join('')).catch((err) => 'ERR ' + String(err.message || err).slice(0, 40))));
const liveMs = Math.round(performance.now() - tLive);
console.log('live eight via provider', liveMs + 'ms');
livePairs.forEach((t, i) => console.log(i + 1, t.slice(0, 60)));

if (failed) process.exit(1);
console.log('PASS');
