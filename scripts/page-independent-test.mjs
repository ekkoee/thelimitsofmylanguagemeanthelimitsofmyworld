// Page translation stays on its own request after image failures.
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
execSync(
  'npx esbuild src/providers/gemini.ts src/providers/gemini-image.ts src/providers/google.ts src/providers/microsoft.ts src/core/llm-batcher.ts --bundle --platform=node --format=esm --outdir=/tmp/ibt-page --splitting --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const gemini = await import(pathToFileURL('/tmp/ibt-page/providers/gemini.js').href);
const image = await import(pathToFileURL('/tmp/ibt-page/providers/gemini-image.js').href);
const google = await import(pathToFileURL('/tmp/ibt-page/providers/google.js').href);
const microsoft = await import(pathToFileURL('/tmp/ibt-page/providers/microsoft.js').href);
const batch = await import(pathToFileURL('/tmp/ibt-page/core/llm-batcher.js').href);

const realFetch = globalThis.fetch.bind(globalThis);
let failed = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failed += 1;
}

const geminiSettings = {
  provider: 'gemini',
  model: 'gemini-3.5-flash-lite',
  apiKeys: { gemini: 'page-key', google: '', microsoft: '', openai: '', ollama: '' },
  targetLang: 'Traditional Chinese (zh-TW)',
  sourceLang: 'en',
  targetLangCode: 'zh-TW',
};
const googleSettings = { ...geminiSettings, provider: 'google', model: '' };

function pageResponse(text) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ t: [text] }) }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 0 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const imageCalls = [];
const dayBody = JSON.stringify({
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    message: 'quota',
    details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }] }, { retryDelay: '8250s' }],
  },
});
await image.translateImageSequential({
  key: 'image-key',
  imageModel: 'gemini-2.5-flash-lite',
  mime: 'image/jpeg',
  data: 'abc',
  log: () => undefined,
  fetchImpl: async () => {
    imageCalls.push('429');
    return new Response(dayBody, { status: 429, headers: { 'content-type': 'application/json' } });
  },
}).catch((err) => { imageCalls.push(String(err?.message || err).slice(0, 40)); });

await image.translateImageSequential({
  key: 'image-key',
  imageModel: 'gemini-2.5-flash-lite',
  mime: 'image/jpeg',
  data: 'abc',
  headerTimeoutMs: 200,
  budgetMs: 700,
  log: () => undefined,
  fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
    imageCalls.push('timeout');
    const abort = () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    };
    if (init?.signal?.aborted) abort();
    else init?.signal?.addEventListener('abort', abort, { once: true });
  }),
}).catch(() => { imageCalls.push('timeout-done'); });

let pageModel = '';
globalThis.fetch = async (url) => {
  pageModel = decodeURIComponent(String(url).split('/models/')[1].split(':')[0]);
  return pageResponse('頁面譯文');
};
const pageOut = await gemini.geminiProvider.translate(
  { sentences: ['Hello from a tweet about the river library.'], targetLang: geminiSettings.targetLang, sourceLang: 'en' },
  geminiSettings,
);
check('image 429 and timeout do not block the page request', imageCalls.includes('429') && imageCalls.includes('timeout'));
check('page still calls its own model and returns a translation', pageModel === 'gemini-3.5-flash-lite' && pageOut[0] === '頁面譯文');

let page429s = 0;
globalThis.fetch = async () => {
  page429s += 1;
  return new Response(dayBody, { status: 429, headers: { 'content-type': 'application/json' } });
};
const batcher = new batch.LlmBatcher({
  pace: async () => undefined,
  run: (fn) => fn(),
  onBatchFallback: async (reqs) => reqs.map((req) => [{ o: req.text, t: '免費譯文' }]),
}, { windowMs: 5 });
const pairs = await batcher.submit({
  text: 'Hello from X',
  settings: geminiSettings,
  provider: gemini.geminiProvider,
  mode: 'prose',
});
check('a page 429 falls back to Google with no quota text', page429s >= 1 && pairs[0]?.t === '免費譯文' && !/沒有回傳|免費額度/.test(pairs.map((p) => p.t).join('')));

const tweets = [
  'The city opened a new library beside the river this morning.',
  'Shops were looted as the protests turned violent.',
  'Please bring the blue notebook to the meeting.',
];
globalThis.fetch = realFetch;
let freeOk = 0;
for (const text of tweets) {
  let zh = '';
  let via = '';
  for (let attempt = 0; attempt < 3 && !/[\u4e00-\u9fff]/.test(zh); attempt++) {
    try {
      const got = await google.googleProvider.translateBlock(text, googleSettings);
      zh = got.map((p) => p.t).join('');
      via = 'google';
    } catch (err) {
      console.log('google', String(err?.message || err));
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  console.log(`${via}: ${zh}`);
  if (/[\u4e00-\u9fff]/.test(zh)) freeOk += 1;
}
check('free engine translates an X-like batch with no Gemini key', freeOk === tweets.length);

if (failed) process.exit(1);
console.log('page independence test passed');
