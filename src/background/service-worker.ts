import { loadSettings } from '../core/storage';
import { cacheKey, getCached, putCached } from '../core/cache';
import { TaskQueue } from '../core/queue';
import { getProvider } from '../providers/index';
import { segment } from '../core/segmentation';
import { AlignedPair, RuntimeMessage, Settings, TranslateBatchResponse, TranslateResponse } from '../core/types';

const queue = new TaskQueue(3);

chrome.runtime.onInstalled.addListener(() => { loadSettings(); });

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
  return false;
});

async function handleTranslate(text: string): Promise<AlignedPair[]> {
  const clean = text.trim();
  if (!clean) return [];
  const settings = await loadSettings();
  const provider = getProvider(settings.provider);

  const target = cacheTarget(settings);
  const key = cacheKey(settings.provider, settings.model, target, clean);

  if (settings.cacheEnabled) {
    const hit = await getCached([key], true);
    const cached = hit.get(key);
    if (cached) { try { return JSON.parse(cached) as AlignedPair[]; } catch { /* ignore */ } }
  }

  const pairs = await queue.run(() => translateWith(provider, clean, settings));

  if (settings.cacheEnabled && pairs.length) {
    await putCached(new Map([[key, JSON.stringify(pairs)]]), true);
  }
  return pairs;
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
  const tgt = settings.provider === 'google' ? settings.targetLangCode : settings.targetLang;
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
    // block engines (Google): translate each missing line, but in parallel via the queue
    await Promise.all(need.map((idx) => queue.run(async () => {
      const pairs = await translateWith(provider, texts[idx].trim(), settings);
      const t = pairs.map((p) => p.t).join(' ').trim();
      out[idx] = t;
      if (settings.cacheEnabled && t) writeBack.set(keys[idx], JSON.stringify(pairs));
    })));
  }

  if (writeBack.size) await putCached(writeBack, true);
  return out;
}
