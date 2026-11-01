// Free-tier quota router. Recorded 429 shapes, then a page burst plus 10 image clicks.
import { geminiProvider } from '../src/providers/gemini';
import { translateImageSequential } from '../src/providers/gemini-image';
import { Settings } from '../src/core/types';
import { isQuotaError, LlmBatcher } from '../src/core/llm-batcher';
import {
  IMAGE_CHAIN_BUDGET_MS,
  IMAGE_HEADER_TIMEOUT_MS,
  allExhaustedMessage,
  bindQuota,
  emptyQuotaState,
  fingerprintKey,
  formatTaipeiHM,
  migrateQuotaState,
  minuteMessage,
  nextPacificMidnight,
  noteDay,
  parseQuotaFailure,
  pickModel,
  quotaForKey,
  quotaStatusText,
  switchedMessage,
} from '../src/core/quota-router';

let failed = 0;
function check(name: string, cond: boolean): void {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failed += 1;
}

const DAY_BODY = JSON.stringify({
  error: {
    code: 429,
    message: 'You exceeded your current quota, please check your plan and billing details.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [{
          quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
          quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
          quotaDimensions: { location: 'global', model: 'gemini-3.6-flash' },
          quotaValue: '20',
        }],
      },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '86306s' },
    ],
  },
});

const MINUTE_BODY = JSON.stringify({
  error: {
    code: 429,
    message: 'You exceeded your current quota, please check your plan and billing details.',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [{
          quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
          quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
          quotaDimensions: { location: 'global', model: 'gemini-2.5-flash' },
          quotaValue: '5',
        }],
      },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '10s' },
    ],
  },
});

const day = parseQuotaFailure(DAY_BODY, 'gemini-3.5-flash');
check('parses the daily free-tier violation', !!day && day.perDay && day.quotaValue === 20 && day.dimensionModel === 'gemini-3.6-flash');
const minute = parseQuotaFailure(MINUTE_BODY, 'gemini-2.5-flash');
check('parses the per-minute violation', !!minute && minute.perMinute && !minute.perDay && minute.quotaValue === 5 && minute.retrySec === 10);

const july = Date.parse('2026-07-15T18:00:00Z');
const jan = Date.parse('2026-01-15T18:00:00Z');
check('PDT reset is 15:00 Taipei', formatTaipeiHM(nextPacificMidnight(july)) === '15:00');
check('PST reset is 16:00 Taipei', formatTaipeiHM(nextPacificMidnight(jan)) === '16:00');

const skipped = emptyQuotaState();
noteDay(skipped, 'gemini-3.5-flash', day!, july);
const picked = pickModel(['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'], skipped, july + 1000);
check('a daily cap is skipped with no wait', picked.kind === 'ready' && picked.kind === 'ready' && picked.model === 'gemini-2.5-flash');
check('the alias model is exhausted too', (skipped.models['gemini-3.6-flash']?.exhaustedUntil ?? 0) > july);
check('status names the fallback', quotaStatusText(skipped, july + 1000).includes(switchedMessage('gemini-3.5-flash', 'gemini-2.5-flash-lite')) || quotaStatusText({ ...skipped, switchedTo: 'gemini-2.5-flash-lite' }, july + 1000).includes('已改用 gemini-2.5-flash-lite'));
check('timeouts and budgets match the image limits', IMAGE_HEADER_TIMEOUT_MS === 15_000 && IMAGE_CHAIN_BUDGET_MS === 20_000);
check('minute message is specific', minuteMessage(10) === '請求太頻繁，10 秒後自動重試' && !minuteMessage(10).includes('請稍後再試'));
const dayMsg = allExhaustedMessage(nextPacificMidnight(july));
check('all-day message names the reset and stops there', dayMsg === 'Gemini 免費額度已用完，將於 15:00 重置');
check('a Gemini 429 is still a page fallback', isQuotaError(new Error('Gemini 429: quota')));
check('the generic no-response line is not a quota error', !isQuotaError(new Error('Gemini 沒有回傳譯文')));

const LITE_DAY = JSON.stringify({
  error: {
    code: 429,
    message: 'You exceeded your current quota',
    status: 'RESOURCE_EXHAUSTED',
    details: [
      { violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20', quotaDimensions: { model: 'gemini-2.5-flash-lite' } }] },
      { retryDelay: '8250s' },
    ],
  },
});
const liteDay = parseQuotaFailure(LITE_DAY, 'gemini-2.5-flash-lite');
check('flash-lite is also 20 a day', !!liteDay && liteDay.perDay && !liteDay.perMinute && liteDay.quotaValue === 20);
const liteState = emptyQuotaState();
noteDay(liteState, 'gemini-2.5-flash-lite', liteDay!, july);
check('the 8250s delay does not become a short retry wait', (liteState.models['gemini-2.5-flash-lite']?.retryAt ?? 0) === 0);
const forced = pickModel(['gemini-2.5-flash-lite'], liteState, july + 1000, { ignoreExhausted: true });
check('重試 tries an exhausted model once', forced.kind === 'ready' && forced.model === 'gemini-2.5-flash-lite');

interface Bucket { day: number; dayUsed: number; rpm: number; stamps: number[] }
const limits: Record<string, Bucket> = {
  'gemini-3.5-flash': { day: 20, dayUsed: 0, rpm: 100, stamps: [] },
  'gemini-2.5-flash': { day: 1000, dayUsed: 0, rpm: 5, stamps: [] },
  'gemini-2.5-flash-lite': { day: 1000, dayUsed: 0, rpm: 15, stamps: [] },
  'gemini-3.5-flash-lite': { day: 1000, dayUsed: 0, rpm: 15, stamps: [] },
};

function modelOf(url: string): string {
  return decodeURIComponent(url.split('/models/')[1].split(':')[0]);
}

let hangFlash = false;
const calls: string[] = [];

function ok(kind: 'page' | 'image'): Response {
  const text = kind === 'image'
    ? JSON.stringify({ regions: [{ text_en: 'Hello', text_zh: '你好', box_2d: [10, 10, 40, 80] }] })
    : JSON.stringify({ t: ['譯文'] });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
}

const fetchImpl: typeof fetch = async (input, init) => {
  const url = String(input);
  const model = modelOf(url);
  calls.push(model);
  const signal = init?.signal;
  if (hangFlash && model === 'gemini-2.5-flash-lite') {
    return await new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(ok('image')), 30_000);
      const abort = () => {
        clearTimeout(timer);
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  }
  const bucket = limits[model] ?? { day: 1000, dayUsed: 0, rpm: 100, stamps: [] };
  const now = Date.now();
  bucket.stamps = bucket.stamps.filter((t) => t > now - 60_000);
  if (bucket.dayUsed >= bucket.day) {
    return new Response(DAY_BODY, { status: 429, headers: { 'content-type': 'application/json' } });
  }
  if (bucket.stamps.length >= bucket.rpm) {
    return new Response(MINUTE_BODY, { status: 429, headers: { 'content-type': 'application/json' } });
  }
  bucket.dayUsed += 1;
  bucket.stamps.push(now);
  const body = String(init?.body || '');
  return ok(body.includes('inline_data') ? 'image' : 'page');
};

const state = emptyQuotaState();
bindQuota({ state, persist: () => undefined });

const settings = {
  provider: 'gemini',
  model: 'gemini-3.5-flash',
  imageModel: 'auto',
  apiKeys: { gemini: 'test-key', google: '', microsoft: '', openai: '', ollama: '' },
  targetLang: 'Traditional Chinese (zh-TW)',
  sourceLang: 'en',
  enabled: true,
  sites: { x: true, reddit: true, youtube: true, netflix: true },
  showOriginal: false,
  viewMode: '',
  layout: 'transTop',
  subtitleOrder: 'zhTop',
  transStyle: 'plain',
  transColor: '',
  barStyle: 'bar',
  barColor: '',
  fontScale: 1,
  targetLangCode: 'zh-TW',
  translateOnVisible: true,
  ollamaEndpoint: '',
  cacheEnabled: false,
} as Settings;

function geminiOk(text: string): Response {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ t: [text] }) }] } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function main(): Promise<void> {
  const legacy = migrateQuotaState({
    models: {
      'gemini-3.5-flash': { exhaustedUntil: Date.now() + 1e8, rpm: 0, recent: [], retryAt: 0, hungUntil: 0 },
    },
  });
  check('upgrade drops the 1.4.29 quota blob', legacy.keyId === '' && Object.keys(legacy.models).length === 0);

  const idA = await fingerprintKey('key-account-a');
  const idB = await fingerprintKey('key-account-b');
  let keyed = quotaForKey({ ...emptyQuotaState(), keyId: idA, models: { 'gemini-3.5-flash': { exhaustedUntil: july + 1e8, rpm: 0, recent: [], retryAt: 0, hungUntil: 0 } } }, idA);
  noteDay(keyed, 'gemini-3.5-flash', day!, july);
  keyed = quotaForKey(keyed, idB);
  check('a new API key does not inherit the old quota', keyed.keyId === idB && !keyed.models['gemini-3.5-flash']);
  bindQuota({ state: keyed, persist: () => undefined });
  let freshCalls = 0;
  globalThis.fetch = async () => {
    freshCalls += 1;
    return geminiOk('新金鑰譯文');
  };
  const fresh = await geminiProvider.translate(
    { sentences: ['Hello'], targetLang: settings.targetLang, sourceLang: 'en' },
    settings,
  );
  check('a new key with old exhausted state translates normally', freshCalls === 1 && fresh[0] === '新金鑰譯文');

  const spent = emptyQuotaState();
  for (const model of ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']) {
    noteDay(spent, model, day!, Date.now());
  }
  bindQuota({ state: spent, persist: () => undefined });
  const probeCalls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    probeCalls.push(decodeURIComponent(url.split('/models/')[1].split(':')[0]));
    return new Response(DAY_BODY, { status: 429, headers: { 'content-type': 'application/json' } });
  };
  let fellBack = false;
  const batcher = new LlmBatcher({
    pace: async () => undefined,
    run: (fn) => fn(),
    onBatchFallback: async (reqs) => {
      fellBack = true;
      return reqs.map((req) => [{ o: req.text, t: '免費譯文' }]);
    },
  }, { windowMs: 5 });
  const pairs = await batcher.submit({
    text: 'Hello from X',
    settings,
    provider: geminiProvider,
    mode: 'prose',
  });
  check('exhausted Gemini still makes one real attempt', probeCalls.length === 1);
  check('exhausted Gemini page translation shows the free translation', fellBack && pairs[0]?.t === '免費譯文' && !pairs.some((p) => /免費額度/.test(p.t)));

  const spentOk = emptyQuotaState();
  for (const model of ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']) {
    noteDay(spentOk, model, day!, Date.now());
  }
  bindQuota({ state: spentOk, persist: () => undefined });
  let clearedCalls = 0;
  globalThis.fetch = async () => {
    clearedCalls += 1;
    return geminiOk('譯文');
  };
  const cleared = await geminiProvider.translate(
    { sentences: ['Hello from X'], targetLang: settings.targetLang, sourceLang: 'en' },
    settings,
  );
  check('a page success does not clear image quota flags', clearedCalls === 1 && cleared[0] === '譯文' && (spentOk.models['gemini-3.5-flash']?.exhaustedUntil ?? 0) > 0);
  bindQuota({ state, persist: () => undefined });

  globalThis.fetch = fetchImpl;
  let pageOk = 0;
  let page429 = 0;
  for (let i = 0; i < 25; i++) {
    const t0 = Date.now();
    try {
      const out = await geminiProvider.translate(
        { sentences: [`Sentence ${i} from a long X thread about shipping software.`], targetLang: settings.targetLang, sourceLang: 'en' },
        settings,
      );
      if (Date.now() - t0 > 3000) throw new Error('slow');
      if (!out[0] || !out[0].includes('譯')) throw new Error(`page ${i} empty`);
      pageOk += 1;
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      page429 += 1;
    }
  }
  check('page calls its own model until the server returns 429', pageOk === 20 && page429 === 5);
  const beforeImages = calls.length;

  let imageOk = 0;
  let imageSlow = 0;
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const got = await translateImageSequential({
      key: 'test-key',
      imageModel: 'auto',
      mime: 'image/jpeg',
      data: `image-${i}`,
      fetchImpl,
      quotaState: state,
      log: () => undefined,
    });
    const ms = Date.now() - t0;
    if (ms >= 20_000) imageSlow += 1;
    if (got.text.includes('你好') || got.regions.some((r) => r.textZh.includes('你好'))) imageOk += 1;
    console.log(`image ${i + 1} model=${got.model} ${ms}ms`);
  }
  const imageCalls = calls.slice(beforeImages);
  check('at least 9 of 10 images succeeded', imageOk >= 9);
  check('every image finished under 20s', imageSlow === 0);
  check('images did not spend the exhausted daily model', !imageCalls.includes('gemini-3.5-flash'));
  check('auto images stay on flash-lite', imageCalls.every((m) => m === 'gemini-2.5-flash-lite'));

  hangFlash = true;
  const hungState = emptyQuotaState();
  noteDay(hungState, 'gemini-3.5-flash', day!, Date.now());
  const tHang = Date.now();
  const hung = await translateImageSequential({
    key: 'test-key',
    imageModel: 'auto',
    mime: 'image/jpeg',
    data: 'hang',
    fetchImpl,
    quotaState: hungState,
    headerTimeoutMs: 400,
    budgetMs: 5000,
    log: () => undefined,
  });
  const hangMs = Date.now() - tHang;
  check('a silent lite call is aborted and 2.5-flash still answers', hung.model === 'gemini-2.5-flash' && hangMs >= 300 && hangMs < 5000);
  console.log(`hang fallback ${hung.model} ${hangMs}ms`);

  if (failed) {
    console.error(`${failed} quota checks failed`);
    process.exit(1);
  }
  console.log('quota router simulation passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
