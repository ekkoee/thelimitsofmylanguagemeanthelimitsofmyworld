// Eight paragraphs, mock 250ms. 1.4.53 serial gate vs 1.4.54 parallel requests.
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
execSync(
  'npx esbuild src/providers/google.ts --bundle --format=esm --platform=node --outfile=/tmp/ibt-google-154.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);

const lines = [
  'My main takeaways from Zcon 7 in Mexico:',
  'Nobody talked about price, nobody shilled the token and told the audience to buy.',
  'The virtue signaling was not about being superior to other forms of money, but about supporting humanitarian efforts with community grants.',
  'There were lots of technical discussions, especially about divisive development proposals such as Crosslink and ZSA.',
  'While Maxine and Tom Howard were engaged in launching attacks against ZCG via Twitter threads, everyone in the room was calm and respectful.',
  'By the end of the event, a compromise about the ZCG was drafted and most actors accepted it.',
  'Cypherpunks write code, they do not waste precious time with politics.',
  'Zcash is obviously more decentralized than last year, with different teams shipping in the open.',
];
const settings = { targetLangCode: 'zh-TW', sourceLang: 'auto' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realFetch = globalThis.fetch.bind(globalThis);

function mockFetch({ latency, statusFor }) {
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  globalThis.fetch = async (url) => {
    calls++;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await sleep(latency);
    inFlight--;
    const status = statusFor ? statusFor(calls, url) : 200;
    const q = new URL(url).searchParams.get('q') || '';
    return {
      status,
      ok: status === 200,
      json: async () => [[[`譯:${q.slice(0, 12)}`, q]]],
    };
  };
  return {
    get calls() { return calls; },
    get maxInFlight() { return maxInFlight; },
  };
}

async function timeAll(label, run) {
  const t0 = performance.now();
  await run();
  const ms = Math.round(performance.now() - t0);
  console.log(label, ms + 'ms');
  return ms;
}

// 1.4.53 gate, copied from src/providers/google.ts before this fix.
const GAP_MS = 280;
let gate = Promise.resolve();
let nextAt = 0;
function schedule(fn) {
  const run = gate.then(async () => {
    const wait = nextAt - Date.now();
    if (wait > 0) await sleep(wait);
    nextAt = Date.now() + GAP_MS;
    return fn();
  });
  gate = run.then(() => undefined, () => undefined);
  return run;
}

const oldNet = mockFetch({ latency: 250 });
const before = await timeAll('1.4.53 eight paragraphs', () => Promise.all(lines.map((line) => schedule(async () => {
  await fetch('https://example.test/?q=' + encodeURIComponent(line));
}))));
console.log('  max in flight', oldNet.maxInFlight, 'calls', oldNet.calls);

const { googleProvider } = await import(pathToFileURL('/tmp/ibt-google-154.mjs').href);
const neu = mockFetch({ latency: 250 });
const after = await timeAll('1.4.54 eight paragraphs', () => Promise.all(lines.map((line) => googleProvider.translateBlock(line, settings))));
console.log('  max in flight', neu.maxInFlight, 'calls', neu.calls);

let burstCalls = 0;
globalThis.fetch = async () => {
  burstCalls++;
  const n = burstCalls;
  await sleep(0);
  if (n <= 2) return { status: 429, ok: false, json: async () => ({}) };
  return { status: 200, ok: true, json: async () => [[['好', 'ok']]] };
};
const tRetry = performance.now();
const retried = await googleProvider.translateBlock('ok', settings);
const retryMs = Math.round(performance.now() - tRetry);
console.log('429 then success', JSON.stringify(retried), 'calls', burstCalls, 'ms', retryMs);
if (burstCalls !== 3) {
  console.error('expected 3 calls for two 429s then success, got', burstCalls);
  process.exitCode = 1;
}

let always = 0;
globalThis.fetch = async () => {
  always++;
  return { status: 403, ok: false, json: async () => ({}) };
};
const tFail = performance.now();
let threw = false;
try { await googleProvider.translateBlock('nope', settings); } catch (err) {
  threw = /Google 403/.test(String(err.message));
}
const failMs = Math.round(performance.now() - tFail);
console.log('403 stops', 'threw', threw, 'calls', always, 'ms', failMs);
if (!threw || always !== 3) {
  console.error('403 retry did not stop', always, threw);
  process.exitCode = 1;
}

let live = 'unreachable';
try {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  const res = await realFetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=hello', { signal: ac.signal });
  clearTimeout(timer);
  live = 'status ' + res.status;
  if (res.ok) {
    const t0 = performance.now();
    const results = await Promise.all(lines.map(async (line) => {
      const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=' + encodeURIComponent(line);
      const r = await realFetch(url);
      if (!r.ok) return r.status;
      const data = await r.json();
      return String(data?.[0]?.[0]?.[0] || '').slice(0, 24);
    }));
    live = Math.round(performance.now() - t0) + 'ms ' + results.map((s) => (typeof s === 'number' ? 'HTTP ' + s : 'ok')).join(',');
  }
} catch (err) {
  live = String(err.name || err.message || err);
}
console.log('live eight paragraphs', live);
console.log('delta', before + 'ms -> ' + after + 'ms');
