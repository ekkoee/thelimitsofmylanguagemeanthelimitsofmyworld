import { loadSettings, saveSettings } from '../core/storage';
import { cacheKey, getCached, putCached } from '../core/cache';
import { TaskQueue } from '../core/queue';
import { getProvider, TranslationProvider } from '../providers/index';
import { segment } from '../core/segmentation';
import { hasAllUrls, registerDblClick, unregisterDblClick } from '../core/dblclick';
import { AlignedPair, LookupResponse, RuntimeMessage, Settings, TranslateBatchResponse, TranslateResponse, WordLookup } from '../core/types';

const queue = new TaskQueue(3);

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
chrome.commands.onCommand.addListener(async (command, tab) => {
  console.log('[IBT] command:', command, '→', tab?.url);
  if (command !== 'toggle-page-translation' || !tab?.id) return;
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
});

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  if (msg?.type === 'translate') {
    handleTranslate(msg.text)
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

async function handleTranslate(text: string): Promise<AlignedPair[]> {
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

  const pairs = await queue.run(() => withFreeFallback(settings, (p) => translateWith(p, clean, settings)));

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
    if (settings.provider === 'google' && isRateLimited(err)) {
      console.warn('[IBT] Google free endpoint throttled → falling back to Microsoft');
      return run(getProvider('microsoft'));
    }
    throw err;
  }
}

async function translateWith(
  provider: ReturnType<typeof getProvider>,
  text: string,
  settings: Settings,
): Promise<AlignedPair[]> {
  // Preferred: provider aligns the whole block itself (free Google engine).
  if (provider.translateBlock) return provider.translateBlock(text, settings);

  // Fallback: segment here, then run the sentence-aligned LLM translate.
  if (provider.translate) {
    const sentences = segment(text, settings.sourceLang);
    const translations = await provider.translate(
      { sentences, targetLang: settings.targetLang, sourceLang: settings.sourceLang },
      settings,
    );
    return sentences.map((o, i) => ({ o, t: translations[i] ?? '' }));
  }
  throw new Error('provider has no translate capability');
}

// Cache identity must include the source language too: changing it (e.g. auto → ja)
// changes the LLM prompt, so cached results under the old source would be stale.
function cacheTarget(settings: Settings): string {
  // Free engines (Google/Microsoft) key off the BCP-47 code; LLM engines off the name.
  const usesLangCode = settings.provider === 'google' || settings.provider === 'microsoft';
  const tgt = usesLangCode ? settings.targetLangCode : settings.targetLang;
  return `${settings.sourceLang || 'auto'}>${tgt}`;
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
    // one request for all missing lines
    const sentences = need.map((i) => texts[i].trim());
    const translations = await queue.run(() => provider.translate!(
      { sentences, targetLang: settings.targetLang, sourceLang: settings.sourceLang },
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
      const pairs = await withFreeFallback(settings, (p) => translateWith(p, texts[idx].trim(), settings));
      const t = pairs.map((p) => p.t).join(' ').trim();
      out[idx] = t;
      if (settings.cacheEnabled && t) writeBack.set(keys[idx], JSON.stringify(pairs));
    })));
  }

  if (writeBack.size) await putCached(writeBack, true);
  return out;
}
