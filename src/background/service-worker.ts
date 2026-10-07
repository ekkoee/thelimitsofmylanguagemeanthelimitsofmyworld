import { loadSettings, saveSettings } from '../core/storage';
import { cacheKey, getCached, putCached } from '../core/cache';
import { paraphraseForMT } from '../core/paraphrase';
import { TaskQueue } from '../core/queue';
import { getProvider, TranslationProvider } from '../providers/index';
import { segment } from '../core/segmentation';
import { findTermMatches, lookupGlossary, TermMatch } from '../core/glossary';
import { toTraditional } from '../core/st2t';
import { LlmBatcher } from '../core/llm-batcher';
import { hasAllUrls, registerDblClick, unregisterDblClick } from '../core/dblclick';
import { AlignedPair, LookupResponse, RuntimeMessage, Settings, TranslateBatchResponse, TranslateResponse, WordLookup } from '../core/types';

const queue = new TaskQueue(3);

// --- LLM request pacing ------------------------------------------------------
// Free-tier LLM keys (Gemini/OpenAI) enforce strict per-minute request caps.
// TaskQueue limits concurrency, but fast LLM responses still let a long X
// thread burn through the per-minute budget → 429 halfway down the page (top
// translates, bottom shows retry buttons). This gate spaces LLM request
// *starts* by at least LLM_SPACING_MS so a burst becomes a steady trickle.
// Free Google/Microsoft endpoints are unmetered for our purposes and skip it.
const LLM_SPACING_MS = 1200;
let lastLLMStart = 0;
/** Space LLM request starts (free-tier RPM protection). Only waits when the
 *  previous request started less than LLM_SPACING_MS ago — the first batch
 *  after idle goes immediately instead of paying a gratuitous 1.2s. */
function paceLLM(): Promise<void> {
  const wait = LLM_SPACING_MS - (Date.now() - lastLLMStart);
  lastLLMStart = Date.now() + Math.max(0, wait);
  return wait > 0 ? new Promise<void>((r) => setTimeout(r, wait)) : Promise.resolve();
}
/** True for metered LLM providers (everything except the free MT endpoints). */
function isMetered(p: { id: string }): boolean {
  return p.id !== 'google' && p.id !== 'microsoft';
}

// --- LLM request batching ----------------------------------------------------
// A long X thread fires one `translate` message per tweet in a burst. Without
// batching, each becomes its own LLM request: with per-minute caps on free
// keys that's both slow (paced 1.2s apart) and quota-hungry (429 halfway down
// → manual retry buttons). LlmBatcher (src/core/llm-batcher.ts) gathers
// messages arriving within a short window and serves them with as few
// provider.translate calls as possible, then fans results back to each caller.
const llmBatcher = new LlmBatcher({
  pace: paceLLM,
  run: (fn) => queue.run(fn),
  // Free-tier minute quota exhausted mid-thread: don't leave the rest of the
  // page on manual retry buttons — finish the batch on the free engine.
  // withFreeFallback already retries a throttled Google block on Microsoft.
  // Batch failed (LLM quota 429 OR unusable response like malformed JSON):
  // don't leave the rest of the page on manual retry buttons — finish the
  // batch on the free engine. withFreeFallback retries a throttled Google
  // block on Microsoft. The user's chosen engine is unchanged; this only
  // covers the failed batch.
  // NOTE: start from the FREE engine explicitly. req.settings.provider is the
  // LLM that just failed (e.g. gemini) — withFreeFallback would otherwise retry
  // the same exhausted LLM instead of falling back (it only Google→Microsoft).
  onBatchFallback: (reqs) => Promise.all(reqs.map((req) => queue.run(async () => {
    const freeSettings = { ...req.settings, provider: 'google' as const };
    const pairs = await withFreeFallback(freeSettings, async (p) => {
      const raw = await translateWith(p, paraphraseForMT(req.text), req.settings, {
        mode: req.mode, pageTitle: req.pageTitle,
      });
      return correctTerminology(req.text, raw, req.settings, p, req.pageTitle);
    });
    return pairs;
  }))),
});

chrome.runtime.onInstalled.addListener(() => { loadSettings(); reconcileDblClick(); });
chrome.runtime.onStartup.addListener(() => { reconcileDblClick(); });

// If the user revokes <all_urls> from chrome://extensions, drop the dynamic
// registration and flip the setting off so state stays consistent (least privilege).
chrome.permissions.onRemoved.addListener((p) => {
  if (p.origins?.includes('<all_urls>')) {
    unregisterDblClick();
    saveSettings({ dblClickTranslate: false });
  }
});

// On install/startup, make the dynamic registration match the saved setting + the
// permission we actually still hold (the permission persists across restarts, but
// re-asserting registration is cheap insurance).
async function reconcileDblClick(): Promise<void> {
  const s = await loadSettings();
  if (!s.dblClickTranslate) return;
  if (await hasAllUrls()) await registerDblClick();
  else await saveSettings({ dblClickTranslate: false }); // permission gone → setting can't be on
}

// Alt+A command. Granted activeTab for the tab where it was pressed, so we can
// inject the whole-page translator into THAT tab only — no broad host access.
const AUTO_SITE = /^https?:\/\/([^/]*\.)?(x\.com|twitter\.com|reddit\.com|youtube\.com)\//i;
// Shared Alt+A logic: used by chrome.commands.onCommand AND by the
// alt-a-global content script (which forwards keypresses from non-auto sites
// when the command binding is missing, e.g. after reinstall with a new ID).
async function handleAltA(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (!tab?.id) return;
  if (tab.url && AUTO_SITE.test(tab.url)) {
    // these sites already auto-translate → toggle show/hide of the translations
    chrome.tabs.sendMessage(tab.id, { type: 'ibt-toggle-visibility' }).catch(() => {});
    return;
  }
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['bilingual.css'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['universal-inject.js'] });
  } catch (e) {
    console.log('[IBT] inject skipped:', e);
  }
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  console.log('[IBT] command:', command, '→', tab?.url);
  if (command !== 'toggle-page-translation') return;
  await handleAltA(tab);
});

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  if (msg?.type === 'translate') {
    handleTranslate(msg.text, { title: msg.title, mode: msg.mode })
      .then((pairs) => sendResponse({ ok: true, pairs } satisfies TranslateResponse))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) } satisfies TranslateResponse));
    return true; // async response
  }
  if (msg?.type === 'translateBatch') {
    handleTranslateBatch(msg.texts)
      .then((translations) => sendResponse({ ok: true, translations } satisfies TranslateBatchResponse))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) } satisfies TranslateBatchResponse));
    return true; // async response
  }
  if (msg?.type === 'lookup') {
    handleLookup(msg.text)
      .then((lookup) => sendResponse({ ok: true, lookup } satisfies LookupResponse))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) } satisfies LookupResponse));
    return true; // async response
  }
  return false;
});

async function handleTranslate(
  text: string,
  opts?: { title?: string; mode?: 'prose' | 'subtitle' },
): Promise<AlignedPair[]> {
  const clean = text.trim();
  if (!clean) return [];
  const settings = await loadSettings();

  const target = cacheTarget(settings);
  const key = cacheKey(settings.provider, settings.model, target, clean);

  if (settings.cacheEnabled) {
    const hit = await getCached([key], true);
    const cached = hit.get(key);
    if (cached) { try { return JSON.parse(cached) as AlignedPair[]; } catch { /* ignore */ } }
  }

  // Carry the caller's register + page title to the LLM prompt. A missing mode
  // defaults to 'subtitle' (preserves prior behavior); pageTitle is prose-only.
  const llmOpts = { mode: opts?.mode ?? 'subtitle', pageTitle: opts?.title } as const;
  const provider = getProvider(settings.provider);
  let pairs: AlignedPair[];
  if (isMetered(provider)) {
    // Metered LLM: coalesce burst requests (X threads etc.) into shared
    // provider calls — far fewer requests, no per-tweet pacing delay.
    pairs = await llmBatcher.submit({
      text: clean, settings, provider, mode: llmOpts.mode, pageTitle: llmOpts.pageTitle,
    });
  } else {
    pairs = await queue.run(() => withFreeFallback(settings, async (p) => {
      // Free MT renders plain English far more naturally than idiom-heavy social
      // copy, so paraphrase idioms into plain equivalents before the request.
      // English→English only (injected Chinese would flip Google's language
      // detection). Glossary correction below still uses the ORIGINAL source.
      const raw = await translateWith(p, paraphraseForMT(clean), settings, llmOpts);
      // Free engines mistranslate AI/tech terms; correct against the glossary with
      // the provider that actually translated (Google may have fallen back to MS).
      const corrected = await correctTerminology(clean, raw, settings, p, opts?.title);
      // Echo guard (圖二): a free engine occasionally returns the source text as
      // its own "translation" (seen with Korean). Any language should come back
      // as Chinese — an echo means this engine failed, so throw to trigger the
      // other free engine via withFreeFallback instead of showing the echo.
      if (isEcho(clean, corrected)) throw new Error('IBT_ECHO');
      return corrected;
    }));
  }

  if (settings.cacheEnabled && pairs.length) {
    await putCached(new Map([[key, JSON.stringify(pairs)]]), true);
  }
  return pairs;
}

// Word/selection lookup for the double-click popup. Reuses the same provider, queue
// and cache as translation — just a different value shape (translation + detected
// source language + optional dictionary). Providers without a dedicated lookup()
// (the LLM engines) fall back to a plain translation.
async function handleLookup(text: string): Promise<WordLookup> {
  const clean = text.trim();
  if (!clean) return { translation: '', sourceLang: '' };
  const settings = await loadSettings();

  // Glossary short-circuit: a whole-selection term hit answers instantly,
  // no API call, no quota burned.
  const glossaryHit = lookupGlossary(clean);
  if (glossaryHit !== null) {
    return {
      translation: glossaryHit,
      sourceLang: settings.sourceLang && settings.sourceLang !== 'auto' ? settings.sourceLang : '',
    };
  }

  // Separate cache namespace ('wl') so a lookup's richer value never collides with a
  // plain translation of the same text.
  const key = cacheKey(settings.provider, settings.model, `${cacheTarget(settings)}|wl`, clean);
  if (settings.cacheEnabled) {
    const hit = await getCached([key], true);
    const cached = hit.get(key);
    if (cached) { try { return JSON.parse(cached) as WordLookup; } catch { /* ignore */ } }
  }

  const result = await queue.run(() => withFreeFallback(settings, async (provider): Promise<WordLookup> => {
    if (provider.lookup) return provider.lookup(clean, settings);
    // Fallback: no dictionary / language detection, just a translation.
    const pairs = await translateWith(provider, clean, settings);
    const translation = pairs.map((p) => p.t).filter(Boolean).join(' ').trim();
    const sourceLang = settings.sourceLang && settings.sourceLang !== 'auto' ? settings.sourceLang : '';
    return { translation, sourceLang };
  }));

  if (settings.cacheEnabled && result.translation) {
    await putCached(new Map([[key, JSON.stringify(result)]]), true);
  }
  return result;
}

// The free Google gtx endpoint is unofficial and occasionally returns 403/429. When the
// active engine is that free Google one and it gets throttled, transparently retry the
// SAME operation once with the free Microsoft engine, so "always free, no key" keeps
// working. The user's chosen engine is unchanged — this only kicks in for google, only
// on a rate-limit/forbidden, and only once. Other engines (LLMs) surface their error.
function isRateLimited(err: unknown): boolean {
  return /\b(403|429)\b/.test(String((err as { message?: unknown })?.message ?? err));
}

async function withFreeFallback<T>(
  settings: Settings,
  run: (provider: TranslationProvider) => Promise<T>,
): Promise<T> {
  try {
    return await run(getProvider(settings.provider));
  } catch (err) {
    const echo = err instanceof Error && err.message === 'IBT_ECHO';
    if (settings.provider === 'google' && (isRateLimited(err) || echo)) {
      console.warn('[IBT] Google free endpoint throttled/echo → falling back to Microsoft');
      return run(getProvider('microsoft'));
    }
    throw err;
  }
}

// True when the "translation" is just the source text echoed back (punctuation /
// whitespace / quote-style differences ignored). Only fires when the source is
// clearly NOT already the target language (has Hangul/Kana/Latin/…) and is long
// enough that an identical round-trip can't be a legit proper-noun keep.
function isEcho(source: string, pairs: AlignedPair[]): boolean {
  const norm = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
  const src = norm(source);
  if (src.length < 8) return false;
  // Source must contain a non-Han letter (Hangul/Kana/Latin/…) — otherwise an
  // identical round-trip is expected (already-target-language text).
  if (!/[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/u.test(source)) return false;
  const out = norm(pairs.map((p) => p.t).join(''));
  return out.length > 0 && out === src;
}

async function translateWith(
  provider: ReturnType<typeof getProvider>,
  text: string,
  settings: Settings,
  opts?: { mode?: 'prose' | 'subtitle'; pageTitle?: string },
): Promise<AlignedPair[]> {
  // Preferred: provider aligns the whole block itself (free Google engine).
  if (provider.translateBlock) return provider.translateBlock(text, settings);

  // Fallback: segment here, then run the sentence-aligned LLM translate.
  if (provider.translate) {
    const sentences = segment(text, settings.sourceLang);
    const translations = await provider.translate(
      {
        sentences, targetLang: settings.targetLang, sourceLang: settings.sourceLang,
        mode: opts?.mode, pageTitle: opts?.pageTitle,
      },
      settings,
    );
    return sentences.map((o, i) => ({ o, t: translations[i] ?? '' }));
  }
  throw new Error('provider has no translate capability');
}

// Post-translation terminology correction for the free engines (google/microsoft).
//
// Free endpoints mistranslate AI/tech terms that LLM engines get right
// ("open-weights" → 開放重量機型, "chain-of-thought" → 思路連鎖). After the normal
// translation completes, glossary terms found in the source are corrected:
//
//   L1 — isolated-rendering swap: translate the term ALONE through the same
//        engine; if that rendering appears in the full translation, swap it for
//        the canonical form. Isolated renderings are persistently cached, so each
//        term costs one tiny request, ever.
//   L2 — known-bad list: empirically observed wrong renderings per entry,
//        replaced whenever the source contains the English term (covers cases
//        where the isolated rendering is already canonical but the in-context
//        one isn't, e.g. MS renders "knowledge distillation" as 知識提煉 alone
//        but 知識萃取 in a sentence).
//
// L2 and CJK-canonical L1 replacements only apply to Traditional targets; we
// never inject Traditional spans into Simplified output (no mixed-script text).
// Pre-translation substitution was tried and rejected: injected Chinese flips
// Google's auto language detection (text comes back untranslated).
const MAX_TERM_PROBES = 8; // extra per-paragraph requests, first-seen terms only
const TRAD_TARGET_RE = /tw|hant|hk/i;
const CJK_RE = /[\u4e00-\u9fff]/;
// Free MT engines (no key) — the simplified-leak safety net applies to these.
const FREE_ENGINE_IDS = new Set(['google', 'microsoft']);

async function correctTerminology(
  source: string,
  pairs: AlignedPair[],
  settings: Settings,
  provider: TranslationProvider,
  pageTitle?: string,
): Promise<AlignedPair[]> {
  const tradTarget = TRAD_TARGET_RE.test(settings.targetLangCode || '');
  const matches = findTermMatches(source, [pageTitle ?? '', source].join('\n'));
  const terms = matches.filter((m) => m.en.length <= 60);
  // Simplified-leak safety net: free engines occasionally emit simplified chars
  // for a Traditional target. Runs even when no glossary terms matched.
  const useSt2t = tradTarget && FREE_ENGINE_IDS.has(provider.id);
  if (!terms.length) {
    return useSt2t ? applySt2t(pairs) : pairs;
  }

  // Isolated renderings, persistently cached. NOTE: called directly, NOT through
  // the TaskQueue — correctTerminology already runs inside a queued task and
  // re-entering the queue can deadlock when all slots are held by waiters.
  const renderings = new Map<string, string>();
  const keys = terms.map((m) => termCacheKey(provider.id, settings, m.en));
  const hit = settings.cacheEnabled ? await getCached(keys, true) : new Map<string, string>();
  const missing: TermMatch[] = [];
  terms.forEach((m, i) => {
    const c = hit.get(keys[i]);
    if (c) renderings.set(m.en.toLowerCase(), c);
    else missing.push(m);
  });
  await Promise.all(missing.slice(0, MAX_TERM_PROBES).map(async (m) => {
    try {
      const t = await translateTermAlone(provider, m.en, settings);
      if (t) {
        renderings.set(m.en.toLowerCase(), t);
        if (settings.cacheEnabled) {
          await putCached(new Map([[termCacheKey(provider.id, settings, m.en), t]]), true);
        }
      }
    } catch { /* probe failed → skip L1 for this term, L2 may still fire */ }
  }));

  let changed = false;
  const out = pairs.map((pair) => {
    let t = pair.t;
    for (const m of terms) {
      // L1: engine's own isolated rendering → canonical form
      const r = renderings.get(m.en.toLowerCase());
      if (r && r.trim().length >= 2 && r !== m.zh && !m.zh.includes(r) && t.includes(r)) {
        // never inject Traditional into Simplified output
        if (tradTarget || !CJK_RE.test(m.zh)) {
          t = t.split(r).join(m.zh);
          changed = true;
        }
      }
      // L2: known-bad renderings → canonical (Traditional targets only)
      if (tradTarget && m.bad.length) {
        for (const b of m.bad) {
          const [span, fix] = Array.isArray(b) ? b : [b, m.zh];
          if (span.length >= 2 && !fix.includes(span) && t.includes(span)) {
            t = t.split(span).join(fix);
            changed = true;
          }
        }
      }
    }
    // Social register (Traditional targets only, source-aware): "account" on
    // social media is 帳號 — 帳戶 is bank-style. Skipped when the source is
    // actually about banking/finance.
    if (tradTarget && /\baccounts?\b/i.test(source) && !/bank|banking|financial|finance|accounting/i.test(source)) {
      if (t.includes('帳戶')) {
        t = t.split('帳戶').join('帳號');
        changed = true;
      }
    }
    return t === pair.t ? pair : { ...pair, t };
  });
  const corrected = changed ? out : pairs;
  // Simplified-leak safety net (free engines, Traditional target only).
  return useSt2t ? applySt2t(corrected) : corrected;
}

// Simplified → Traditional safety net for free-engine output.
function applySt2t(pairs: AlignedPair[]): AlignedPair[] {
  let changed = false;
  const out = pairs.map((pair) => {
    const t = toTraditional(pair.t);
    if (t !== pair.t) changed = true;
    return t === pair.t ? pair : { ...pair, t };
  });
  return changed ? out : pairs;
}

// Translate one glossary term alone through the same free engine.
async function translateTermAlone(
  provider: TranslationProvider,
  term: string,
  settings: Settings,
): Promise<string> {
  if (provider.lookup) {
    return ((await provider.lookup(term, settings)).translation || '').trim();
  }
  if (provider.translateBlock) {
    const pairs = await provider.translateBlock(term, settings);
    return pairs.map((p) => p.t).join(' ').trim();
  }
  return '';
}

// Persistent cache key for isolated term renderings (versioned with the glossary).
function termCacheKey(providerId: string, settings: Settings, term: string): string {
  return cacheKey(providerId, settings.model, `${cacheTarget(settings)}|glossary`, term.toLowerCase());
}

// Cache identity must include the source language too: changing it (e.g. auto → ja)
// changes the LLM prompt, so cached results under the old source would be stale.
function cacheTarget(settings: Settings): string {
  // Free engines (Google/Microsoft) key off the BCP-47 code; LLM engines off the name.
  const usesLangCode = settings.provider === 'google' || settings.provider === 'microsoft';
  const tgt = usesLangCode ? settings.targetLangCode : settings.targetLang;
  // Bump the namespace when post-translation behavior / the LLM prompt changes so
  // stale cached translations are re-fetched instead of served forever.
  const v = usesLangCode ? '#glossary-v1' : '#prompt-v2';
  return `${settings.sourceLang || 'auto'}>${tgt}${v}`;
}

// Translate many independent lines while making as few provider calls as possible.
// LLM providers (Gemini/OpenAI) translate every uncached line in ONE request,
// which is what keeps us under the free-tier per-minute request limit.
async function handleTranslateBatch(texts: string[]): Promise<string[]> {
  const settings = await loadSettings();
  const provider = getProvider(settings.provider);
  const target = cacheTarget(settings);

  const out: string[] = new Array(texts.length).fill('');
  const keys = texts.map((t) => cacheKey(settings.provider, settings.model, target, t.trim()));

  // 1) serve whatever is already cached
  const need: number[] = [];
  if (settings.cacheEnabled) {
    const hit = await getCached(keys, true);
    texts.forEach((_, i) => {
      const c = hit.get(keys[i]);
      if (c) { try { out[i] = (JSON.parse(c) as AlignedPair[]).map((p) => p.t).join(' ').trim(); return; } catch { /* */ } }
      need.push(i);
    });
  } else {
    texts.forEach((_, i) => need.push(i));
  }
  if (!need.length) return out;

  const writeBack = new Map<string, string>();

  if (provider.translate) {
    // one request for all missing lines. Batch is YouTube movie-mode subtitles →
    // subtitle register, no page-title context.
    const sentences = need.map((i) => texts[i].trim());
    if (isMetered(provider)) await paceLLM();
    const translations = await queue.run(() => provider.translate!(
      { sentences, targetLang: settings.targetLang, sourceLang: settings.sourceLang, mode: 'subtitle' },
      settings,
    ));
    need.forEach((idx, k) => {
      const t = translations[k] ?? '';
      out[idx] = t;
      if (settings.cacheEnabled && t) writeBack.set(keys[idx], JSON.stringify([{ o: texts[idx].trim(), t }] satisfies AlignedPair[]));
    });
  } else {
    // block engines (Google/Microsoft): translate each missing line, but in parallel via
    // the queue. withFreeFallback retries a throttled Google line on Microsoft.
    await Promise.all(need.map((idx) => queue.run(async () => {
      const text = texts[idx].trim();
      const pairs = await withFreeFallback(settings, async (p) => {
        const raw = await translateWith(p, text, settings);
        if (p.id === 'google' || p.id === 'microsoft') {
          return correctTerminology(text, raw, settings, p);
        }
        return raw;
      });
      const t = pairs.map((p) => p.t).join(' ').trim();
      out[idx] = t;
      if (settings.cacheEnabled && t) writeBack.set(keys[idx], JSON.stringify(pairs));
    })));
  }

  if (writeBack.size) await putCached(writeBack, true);
  return out;
}
