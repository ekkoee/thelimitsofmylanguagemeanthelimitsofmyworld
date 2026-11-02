// Gemini soft-timeout: a slow call is aborted and the same batch is filled by
// the free-engine fallback. A late Gemini body must not replace that result.
// Run: node scripts/gemini-fallback-test.mjs
import { execSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
execSync(
  'npx esbuild src/providers/gemini.ts --bundle --platform=node --format=esm --outfile=/tmp/gemini-fallback-provider.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
execSync(
  'npx esbuild src/core/llm-batcher.ts --bundle --platform=node --format=esm --outfile=/tmp/gemini-fallback-batcher.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const {
  createGeminiGuard, GEMINI_SOFT_TIMEOUT_MS, GEMINI_TIMEOUT_STREAK, GEMINI_COOLDOWN_MS,
  isGeminiFallbackError, geminiGuard, geminiProvider,
} = await import('/tmp/gemini-fallback-provider.mjs');
const { LlmBatcher } = await import('/tmp/gemini-fallback-batcher.mjs');

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}

check('default timeout is 8000ms', GEMINI_SOFT_TIMEOUT_MS === 8000);
check('cooldown after 3 timeouts', GEMINI_TIMEOUT_STREAK === 3);
check('cooldown lasts 60s', GEMINI_COOLDOWN_MS === 60_000);

const settings = {
  provider: 'gemini',
  model: 'gemini-3.5-flash-lite',
  targetLang: 'Traditional Chinese',
  targetLangCode: 'zh-TW',
  sourceLang: 'auto',
  apiKeys: { gemini: 'test-key' },
};

function batcher(onBatchFallback) {
  return new LlmBatcher(
    { pace: async () => {}, run: (fn) => fn(), onBatchFallback },
    { windowMs: 15 },
  );
}

// --- fast Gemini is used as-is ---
{
  const logs = [];
  let calls = 0;
  const guard = createGeminiGuard({ timeoutMs: 80, streak: 3, cooldownMs: 1000, log: (l) => logs.push(l) });
  const provider = {
    id: 'gemini',
    translate: (input) => guard.run(async () => {
      calls += 1;
      return input.sentences.map((s) => `GEM:${s}`);
    }),
  };
  let fell = false;
  const rows = await batcher(async () => { fell = true; return []; }).submit({
    text: 'Hello world.', settings, provider, mode: 'prose',
  });
  check('fast Gemini result kept', rows[0]?.t === 'GEM:Hello world.');
  check('fast path does not call Google', fell === false && calls === 1);
  check('fast path logs no timeout', logs.length === 0);
}

// --- slow Gemini: abort, Google fills the same slot, late body ignored ---
{
  const logs = [];
  const late = [];
  const guard = createGeminiGuard({ timeoutMs: 40, streak: 3, cooldownMs: 5000, log: (l) => logs.push(l) });
  const provider = {
    id: 'gemini',
    translate: (input) => guard.run((signal) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        late.push(input.sentences.join('|'));
        resolve(input.sentences.map(() => 'LATE'));
      }, 250);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        // A fetch that still settles after abort must not become the translation.
        setTimeout(() => late.push('settled-after-abort'), 20);
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      }, { once: true });
    })),
  };
  const rows = await batcher(async (reqs) => reqs.map((r) => [{ o: r.text, t: `FREE:${r.text}` }])).submit({
    text: 'Hello world.', settings, provider, mode: 'prose',
  });
  await new Promise((r) => setTimeout(r, 80));
  check('timeout falls back to Google slot', rows[0]?.t === 'FREE:Hello world.' && rows[0]?.o === 'Hello world.');
  check('late Gemini text never used', rows.every((p) => p.t !== 'LATE') && !late.includes('Hello world.'));
  check('timeout log', logs.some((l) => l === '[IBT] gemini timeout 40ms → google'));
  check('fallback error is the timeout kind', isGeminiFallbackError(Object.assign(new Error('timeout'), { name: 'GeminiFallbackError' })));
}

// --- three timeouts in a row, then skip Gemini until the cooldown ends ---
{
  const logs = [];
  let now = 1_000;
  let calls = 0;
  const guard = createGeminiGuard({
    timeoutMs: 30, streak: 3, cooldownMs: 1000, now: () => now, log: (l) => logs.push(l),
  });
  const slow = (signal) => new Promise((resolve, reject) => {
    calls += 1;
    const timer = setTimeout(() => resolve('should-not-return'), 200);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    }, { once: true });
  });
  for (let i = 0; i < 3; i++) {
    let reason = '';
    try { await guard.run(slow); } catch (err) { reason = err?.reason || ''; }
    check(`timeout ${i + 1} throws`, reason === 'timeout');
  }
  check('three calls were made', calls === 3);
  check('third timeout starts cooldown', logs.some((l) => l === '[IBT] gemini cooldown 1000ms → google'));
  let skipped = '';
  try { await guard.run(slow); } catch (err) { skipped = err?.reason || ''; }
  check('cooldown does not call Gemini', skipped === 'cooldown' && calls === 3);
  check('cooldown skip is logged', logs.includes('[IBT] gemini cooldown → google'));
  now += 1000;
  let again = '';
  try { await guard.run(async () => 'back'); } catch (err) { again = String(err); }
  check('Gemini is tried again after cooldown', again === '' && calls === 3);
}

// --- a success clears the streak, so two later timeouts do not cool down ---
{
  const logs = [];
  const guard = createGeminiGuard({ timeoutMs: 20, streak: 3, cooldownMs: 5000, log: (l) => logs.push(l) });
  const slow = (signal) => new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('too slow to matter')), 200);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    }, { once: true });
  });
  try { await guard.run(slow); } catch { /* timeout */ }
  const fast = await guard.run(async () => 'ok');
  check('success after a timeout still returns', fast === 'ok');
  try { await guard.run(slow); } catch { /* timeout */ }
  try { await guard.run(slow); } catch { /* timeout */ }
  check('streak reset, no cooldown yet', !logs.some((l) => l.includes('cooldown')));
}

// --- real provider: fast JSON is used; 500/429 fall back; 400 does not; 8s abort ---
{
  const input = { sentences: ['Hi'], targetLang: 'Traditional Chinese', sourceLang: 'auto' };
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    check('provider passes AbortSignal', init?.signal instanceof AbortSignal);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ t: ['嗨'] }) }] } }],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, thoughtsTokenCount: 0 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const fast = await geminiProvider.translate(input, settings);
  check('provider fast Gemini text', fast[0] === '嗨');

  globalThis.fetch = async () => new Response('busy', { status: 500 });
  let http = null;
  try { await geminiProvider.translate(input, settings); } catch (err) { http = err; }
  check('provider 500 is a Google fallback', isGeminiFallbackError(http) && http.reason === 'http' && /Gemini 500/.test(http.message));

  globalThis.fetch = async () => new Response('quota', { status: 429 });
  let limited = null;
  try { await geminiProvider.translate(input, settings); } catch (err) { limited = err; }
  check('provider 429 is a Google fallback', isGeminiFallbackError(limited) && /Gemini 429/.test(limited.message));

  globalThis.fetch = async () => new Response('bad', { status: 400 });
  let bad = null;
  try { await geminiProvider.translate(input, settings); } catch (err) { bad = err; }
  check('provider 400 is not a silent fallback', !isGeminiFallbackError(bad) && /Gemini 400/.test(String(bad?.message)));

  globalThis.fetch = async () => { throw Object.assign(new TypeError('fetch failed'), { name: 'TypeError' }); };
  let net = null;
  try { await geminiProvider.translate(input, settings); } catch (err) { net = err; }
  check('provider network error is a Google fallback', isGeminiFallbackError(net) && net.reason === 'network');

  const t0 = Date.now();
  let aborted = false;
  globalThis.fetch = (_url, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      lateBody = 'LATE-BODY';
      resolve(new Response(JSON.stringify({ t: ['LATE'] }), { status: 200 }));
    }, 20_000);
    init.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      aborted = true;
      reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
    }, { once: true });
  });
  let lateBody = '';
  let timed = null;
  try { await geminiProvider.translate(input, settings); } catch (err) { timed = err; }
  const elapsed = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 50));
  check('provider aborts near 8s', aborted && isGeminiFallbackError(timed) && timed.reason === 'timeout');
  check('provider timeout elapsed', elapsed >= 7500 && elapsed < 12000);
  check('provider ignores a late body', lateBody === '');
  geminiGuard.reset();
  globalThis.fetch = original;
}

console.log(failures ? `${failures} FAILURES` : 'all gemini fallback tests passed');
process.exit(failures ? 1 : 0);
