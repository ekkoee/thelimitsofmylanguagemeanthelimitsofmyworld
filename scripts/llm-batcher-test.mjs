// Unit tests for the LLM request batcher (src/core/llm-batcher.ts).
// Run: node scripts/llm-batcher-test.mjs  (bundles the module with esbuild)
import { execSync } from 'node:child_process';

execSync(
  'npx esbuild src/core/llm-batcher.ts --bundle --platform=node --format=esm --outfile=/tmp/llm-batcher.test.mjs --log-level=error',
  { cwd: new URL('..', import.meta.url).pathname, stdio: 'inherit' },
);
const { LlmBatcher, isQuotaError } = await import('/tmp/llm-batcher.test.mjs');

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}

// --- isQuotaError ---
check('429 detected', isQuotaError(new Error('Gemini 429: quota exceeded')));
check('403 detected', isQuotaError(new Error('HTTP 403')));
check('RESOURCE_EXHAUSTED detected', isQuotaError(new Error('RESOURCE_EXHAUSTED')));
check('rate limit text detected', isQuotaError(new Error('Rate limit reached')));
check('bad key NOT quota', !isQuotaError(new Error('NO_API_KEY: set your Gemini key')));
check('generic error NOT quota', !isQuotaError(new Error('network timeout')));

function makeSettings() {
  return {
    provider: 'gemini', model: 'gemini-3.5-flash-lite',
    targetLang: 'Traditional Chinese', targetLangCode: 'zh-TW',
    sourceLang: 'auto', apiKeys: {},
  };
}
function makeProvider(log) {
  return {
    id: 'gemini',
    translate: async (input) => {
      log.push([...input.sentences]);
      return input.sentences.map((s) => `ZH:${s}`);
    },
  };
}

// --- burst of 5 blocks → 1 provider call, results fanned out ---
{
  const log = [];
  const batcher = new LlmBatcher(
    { pace: async () => {}, run: (fn) => fn(), onBatchFallback: async () => { throw new Error('no fallback'); } },
    { windowMs: 30 },
  );
  const settings = makeSettings();
  const provider = makeProvider(log);
  const texts = ['Hello world.', 'Second tweet here.', 'Third one.', 'Fourth.', 'Fifth tweet.'];
  const results = await Promise.all(texts.map((t) =>
    batcher.submit({ text: t, settings, provider, mode: 'prose', pageTitle: 'Test' })));
  check('burst coalesced into 1 request', log.length === 1);
  check('all sentences in one call', log[0]?.length === 5);
  check('fan-out aligned', results.every((pairs, i) => pairs[0]?.t === `ZH:${texts[i]}`));
  check('originals preserved', results.every((pairs, i) => pairs[0]?.o === texts[i]));
}

// --- different modes don't mix ---
{
  const log = [];
  const batcher = new LlmBatcher(
    { pace: async () => {}, run: (fn) => fn(), onBatchFallback: async () => { throw new Error('no fallback'); } },
    { windowMs: 30 },
  );
  const settings = makeSettings();
  const provider = makeProvider(log);
  const [a, b] = await Promise.all([
    batcher.submit({ text: 'Prose text.', settings, provider, mode: 'prose' }),
    batcher.submit({ text: 'Subtitle text.', settings, provider, mode: 'subtitle' }),
  ]);
  check('different modes → 2 requests', log.length === 2);
  check('mode groups correct', a[0].t === 'ZH:Prose text.' && b[0].t === 'ZH:Subtitle text.');
}

// --- quota error → onBatchFallback fallback, no manual retry ---
{
  const log = [];
  const batcher = new LlmBatcher(
    {
      pace: async () => {},
      run: (fn) => fn(),
      onBatchFallback: async (reqs) => {
        log.push(reqs.length);
        return reqs.map((r) => [{ o: r.text, t: `FREE:${r.text}` }]);
      },
    },
    { windowMs: 30 },
  );
  const settings = makeSettings();
  const badProvider = { id: 'gemini', translate: async () => { throw new Error('Gemini 429: quota exceeded'); } };
  const results = await Promise.all([
    batcher.submit({ text: 'One.', settings, provider: badProvider, mode: 'prose' }),
    batcher.submit({ text: 'Two.', settings, provider: badProvider, mode: 'prose' }),
  ]);
  check('quota → fallback invoked once', log.length === 1 && log[0] === 2);
  check('fallback results delivered', results[0][0].t === 'FREE:One.' && results[1][0].t === 'FREE:Two.');
}

// --- non-quota error → rejects (surfaces retry button as before) ---
{
  const batcher = new LlmBatcher(
    { pace: async () => {}, run: (fn) => fn(), onBatchFallback: async () => { throw new Error('no fallback'); } },
    { windowMs: 30 },
  );
  const settings = makeSettings();
  const badProvider = { id: 'gemini', translate: async () => { throw new Error('NO_API_KEY: nope'); } };
  let rejected = false;
  try {
    await batcher.submit({ text: 'One.', settings, provider: badProvider, mode: 'prose' });
  } catch (e) {
    rejected = /NO_API_KEY/.test(String(e?.message ?? e));
  }
  check('non-quota error rejects', rejected);
}

// --- unusable LLM response (malformed JSON) → fallback, no retry button ---
{
  const batcher = new LlmBatcher(
    { pace: async () => {}, run: (fn) => fn(), onBatchFallback: async (reqs) => {
      return reqs.map((r) => [{ o: r.text, t: 'FREE:' + r.text }]);
    } },
    { windowMs: 30 },
  );
  const settings = makeSettings();
  const badProvider = { id: 'gemini', translate: async () => { throw new Error('Could not parse translations from provider response'); } };
  const results = await batcher.submit({ text: 'Hello.', settings, provider: badProvider, mode: 'prose' });
  check('parse error → fallback invoked', results[0].t === 'FREE:Hello.');
}

// --- empty text resolves immediately, no provider call ---
{
  const log = [];
  const batcher = new LlmBatcher(
    { pace: async () => {}, run: (fn) => fn(), onBatchFallback: async () => { throw new Error('no fallback'); } },
    { windowMs: 30 },
  );
  const out = await batcher.submit({ text: '   ', settings: makeSettings(), provider: makeProvider(log), mode: 'prose' });
  check('empty → [] without request', Array.isArray(out) && out.length === 0 && log.length === 0);
}


// --- first-fire: few sentences flush on short window, not after a long wait ---
{
  const log = [];
  const batcher = new LlmBatcher(
    { pace: async () => {}, run: (fn) => fn(), onBatchFallback: async () => { throw new Error('no fallback'); } },
    { firstWindowMs: 25, windowMs: 200 },
  );
  const t0 = Date.now();
  const provider = makeProvider(log);
  const result = await batcher.submit({
    text: 'Only one sentence.', settings: makeSettings(), provider, mode: 'prose',
  });
  const elapsed = Date.now() - t0;
  check('first-fire under long windowMs', elapsed < 150 && log.length === 1);
  check('first-fire result ok', result[0]?.t === 'ZH:Only one sentence.');
}

// --- eagerFlushSentences: flush before window when enough sentences queued ---
{
  const log = [];
  const batcher = new LlmBatcher(
    { pace: async () => {}, run: (fn) => fn(), onBatchFallback: async () => { throw new Error('no fallback'); } },
    { windowMs: 500, firstWindowMs: 500, eagerFlushSentences: 3 },
  );
  const settings = makeSettings();
  const provider = makeProvider(log);
  const t0 = Date.now();
  const results = await Promise.all([
    batcher.submit({ text: 'One.', settings, provider, mode: 'prose' }),
    batcher.submit({ text: 'Two.', settings, provider, mode: 'prose' }),
    batcher.submit({ text: 'Three.', settings, provider, mode: 'prose' }),
  ]);
  const elapsed = Date.now() - t0;
  check('eager flush before long window', elapsed < 200 && log.length === 1 && log[0].length === 3);
  check('eager flush fan-out', results.every((pairs, i) => pairs[0]?.t === `ZH:${['One.', 'Two.', 'Three.'][i]}`));
}

// --- pace receives provider id ---
{
  const paced = [];
  const batcher = new LlmBatcher(
    {
      pace: async (id) => { paced.push(id); },
      run: (fn) => fn(),
      onBatchFallback: async () => { throw new Error('no fallback'); },
    },
    { windowMs: 20 },
  );
  await batcher.submit({ text: 'Hi.', settings: makeSettings(), provider: makeProvider([]), mode: 'prose' });
  check('pace gets provider id', paced[0] === 'gemini');
}

console.log(failures ? `${failures} FAILURES` : 'all batcher tests passed');
process.exit(failures ? 1 : 0);
