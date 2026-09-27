// Glossary post-correction harness — mirrors correctTerminology() in
// src/background/service-worker.ts (L1 isolated-rendering swap + L2 bad-list),
// but drives the real free endpoints directly. Imports the REAL glossary via
// esbuild so the entry list under test is the shipped one.
//
// Usage:
//   npx esbuild src/core/glossary.ts --format=esm --outfile=scripts/glossary.compiled.mjs
//   node scripts/glossary-test.mjs [google|microsoft|both]
//
// Env: GLOSSARY_SLEEP_MS (default 700) between isolated probes.
import { findTermMatches, lookupGlossary } from './glossary.compiled.mjs';

const PROVIDERS = (process.argv[2] || 'both').toLowerCase();
const SLEEP_MS = Number(process.env.GLOSSARY_SLEEP_MS || 700);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function gtx(text, sl = 'auto', tl = 'zh-TW') {
  const qs = new URLSearchParams({ client: 'gtx', sl, tl, dt: 't', q: text });
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?${qs}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`gtx ${res.status}`);
  const d = await res.json();
  return (d?.[0] || []).map((c) => c?.[0]).filter(Boolean).join('');
}

async function msTranslate(texts, to = 'zh-Hant') {
  const qs = new URLSearchParams({ from: '', to, isEnterpriseClient: 'false' });
  const res = await fetch(`https://edge.microsoft.com/translate/translatetext?${qs}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(texts),
  });
  if (!res.ok) throw new Error(`ms ${res.status}`);
  const d = await res.json();
  return d.map((x) => String(x?.translations?.[0]?.text ?? ''));
}

// --- correctTerminology mirror (keep in sync with service-worker.ts) ---
const TRAD_TARGET_RE = /tw|hant|hk/i;
const CJK_RE = /[\u4e00-\u9fff]/;
const renderCache = new Map(); // `${provider}|${term}` → rendering

async function isolatedTerm(provider, term) {
  const key = `${provider}|${term.toLowerCase()}`;
  if (renderCache.has(key)) return renderCache.get(key);
  try {
    const r = provider === 'google' ? await gtx(term) : (await msTranslate([term]))[0];
    renderCache.set(key, (r || '').trim());
  } catch { renderCache.set(key, ''); }
  return renderCache.get(key);
}

async function correct(source, base, provider) {
  const tradTarget = true; // harness targets zh-TW/zh-Hant
  const terms = findTermMatches(source, source).filter((m) => m.en.length <= 60);
  if (!terms.length) return { text: base, fired: [] };
  const fired = [];
  let t = base;
  for (const m of terms) {
    const r = await isolatedTerm(provider, m.en);
    await sleep(SLEEP_MS);
    // L1
    if (r && r.trim().length >= 2 && r !== m.zh && !m.zh.includes(r) && t.includes(r)) {
      if (tradTarget || !CJK_RE.test(m.zh)) { t = t.split(r).join(m.zh); fired.push(`L1 ${m.en}→${m.zh}`); }
    }
    // L2
    if (tradTarget && m.bad.length) {
      for (const b of m.bad) {
        const [span, fix] = Array.isArray(b) ? b : [b, m.zh];
        if (span.length >= 2 && !fix.includes(span) && t.includes(span)) {
          t = t.split(span).join(fix); fired.push(`L2 ${span}→${fix}`);
        }
      }
    }
  }
  return { text: t, fired };
}

// --- test corpus ---
const AI_SENTENCES = [
  'The new open-weights model uses mixture-of-experts and a 1M token context window.',
  'We distilled the teacher into a student model with chain-of-thought reasoning.',
  'Knowledge distillation and continuous batching make inference much cheaper.',
  'RAG with prompt caching beats few-shot prompting for long context tasks.',
  'Quantization and KV cache optimization are key for vLLM serving.',
];
const NON_AI = [
  'The plumber is training his apprentice to lift weights safely.',
  'She bought fresh produce at the farmers market this morning.',
  'The model walked down the runway in a stunning red dress.',
  'Token economies in board games reward strategic play.',
  'Visit https://openai.com/blog for details.',
];

async function runProvider(name) {
  console.log(`\n===== ${name} =====`);
  let l1 = 0, l2 = 0;
  for (const s of AI_SENTENCES) {
    let base;
    try {
      base = name === 'google' ? await gtx(s) : (await msTranslate([s]))[0];
    } catch (e) { console.log(`[skip] ${e.message}: ${s.slice(0, 50)}`); continue; }
    await sleep(SLEEP_MS);
    const { text, fired } = await correct(s, base, name);
    l1 += fired.filter((f) => f.startsWith('L1')).length;
    l2 += fired.filter((f) => f.startsWith('L2')).length;
    console.log(`\nSRC:  ${s}`);
    console.log(`BASE: ${base}`);
    console.log(`FIX:  ${text}`);
    if (fired.length) console.log(`FIRED: ${fired.join(' | ')}`);
  }
  console.log(`\n--- non-AI guard (must be unchanged) ---`);
  for (const s of NON_AI) {
    let base;
    try {
      base = name === 'google' ? await gtx(s) : (await msTranslate([s]))[0];
    } catch (e) { console.log(`[skip] ${e.message}`); continue; }
    await sleep(SLEEP_MS);
    const { text, fired } = await correct(s, base, name);
    const ok = text === base ? 'UNCHANGED ✓' : 'MODIFIED ✗';
    console.log(`${ok} | ${s.slice(0, 45)}`);
    if (fired.length) console.log(`  FIRED (unexpected): ${fired.join(' | ')} | ${text}`);
  }
  console.log(`\n${name}: L1 fired ${l1}x, L2 fired ${l2}x`);
}

console.log('--- glossary lookup (no API) ---');
for (const t of ['RAG', 'transformer', 'chain-of-thought', 'DeepSeek-V3', 'hello']) {
  console.log(`lookup(${t}) = ${JSON.stringify(lookupGlossary(t))}`);
}

if (PROVIDERS === 'both' || PROVIDERS === 'microsoft') await runProvider('microsoft');
if (PROVIDERS === 'both' || PROVIDERS === 'google') await runProvider('google');
