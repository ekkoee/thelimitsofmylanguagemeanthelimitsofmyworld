import { AlignedPair, Settings, WordLookup } from '../core/types';
import { TranslationProvider } from './base';
import { segment } from '../core/segmentation';

// FREE translation via Microsoft Edge's keyless endpoint — the same one Edge's
// built-in translator uses. One step, no API key, no JWT:
//   POST https://edge.microsoft.com/translate/translatetext
//        ?from=<src>&to=<tgt>&isEnterpriseClient=false
//        Content-Type: application/json   body: ["sentence one", "sentence two"]
//
// (The old two-step flow — GET edge.microsoft.com/translate/auth for a JWT, then
// POST api-edge.cognitive.microsofttranslator.com/translate — died in 2026 when
// the auth endpoint started returning HTTP 404.)
//
// We use this as the Tier-1 FREE fallback for Google's gtx endpoint: when Google
// rate-limits (403/429), the service worker retries the same text here so "always
// free, no key" keeps holding. It can also be picked directly in options.
//
// The endpoint translates each array element as one unit, so we segment the block
// ourselves and send one element per sentence — reproducing per-line bilingual
// alignment, in order, 1:1.
//
// NOTE: like the Google one this is an unofficial endpoint and can change/throttle.
const ENDPOINT = 'https://edge.microsoft.com/translate/translatetext';

// Keep each request modest: huge bodies are more likely to be throttled.
const MAX_ELEMENTS = 25;
const MAX_CHARS = 5000;
const TIMEOUT_MS = 30_000;

export const microsoftProvider: TranslationProvider = {
  id: 'microsoft',

  async translateBlock(text: string, settings: Settings): Promise<AlignedPair[]> {
    const to = toMsTarget(settings.targetLangCode || 'zh-TW');
    const from = toMsSource(settings.sourceLang);
    const sentences = segment(text, settings.sourceLang);
    if (!sentences.length) return [];

    const out: AlignedPair[] = [];
    for (const batch of batchSentences(sentences, MAX_ELEMENTS, MAX_CHARS)) {
      const translations = await translateArray(batch, from, to);
      batch.forEach((o, i) => out.push({ o, t: (translations[i] ?? '').trim() }));
    }
    return out;
  },

  // Double-click popup lookup: one short selection → translation + detected source
  // language (used to pick a TTS voice). This endpoint returns no dictionary data, so
  // the popup shows the translation + 🔊 but no dictionary card — that's expected.
  async lookup(text: string, settings: Settings): Promise<WordLookup> {
    const to = toMsTarget(settings.targetLangCode || 'zh-TW');
    const from = toMsSource(settings.sourceLang);
    const [item] = await translateRaw([text], from, to);
    const translation = decodeEntities(String(item?.translations?.[0]?.text ?? '')).trim();
    const detected = String(item?.detectedLanguage?.language ?? '');
    const sourceLang = detected || from;
    return { translation, sourceLang };
  },
};

// --- HTTP ---

// POST an array of strings, return the translated strings in the SAME order.
async function translateArray(texts: string[], from: string, to: string): Promise<string[]> {
  const data = await translateRaw(texts, from, to);
  return texts.map((_, i) => decodeEntities(String(data?.[i]?.translations?.[0]?.text ?? '')));
}

// Raw call → the endpoint's array of { translations:[{text}], detectedLanguage? }.
// Backs off twice on 429 — the same gentle policy as the Google engine.
async function translateRaw(texts: string[], from: string, to: string, attempt = 0): Promise<any[]> {
  const qs = new URLSearchParams({ from, to, isEnterpriseClient: 'false' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}?${qs.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Escape HTML-significant chars: the endpoint's tag-aligner otherwise
      // misparses stray < > & as markup. Decoded single-level on the way back.
      body: JSON.stringify(texts.map(escapeHtml)),
      signal: ctrl.signal,
    });
    if (res.status === 429 && attempt < 2) {
      await sleep(400 * (attempt + 1));
      return translateRaw(texts, from, to, attempt + 1);
    }
    if (!res.ok) throw new Error(`Microsoft ${res.status}`);
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } finally {
    clearTimeout(timer);
  }
}

// --- HTML entity handling ---

// Escape before sending so the endpoint doesn't treat < > & as markup.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Decode exactly one level on the way back: original "&lt;" was sent as
// "&amp;lt;" and must come back as "&lt;", not "<".
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// --- language code mapping ---

// This extension stores Google/BCP-47 codes (zh-TW, zh-CN). Microsoft uses script
// subtags for Chinese (zh-Hant / zh-Hans); every other code passes through unchanged.
function toMsTarget(code: string): string {
  const c = (code || '').trim();
  const lower = c.toLowerCase();
  if (lower === 'zh-tw' || lower === 'zh-hant' || lower === 'zh') return 'zh-Hant';
  if (lower === 'zh-cn' || lower === 'zh-hans') return 'zh-Hans';
  return c;
}

// Source language: 'auto'/'' → '' (let the endpoint detect). Same zh mapping otherwise.
function toMsSource(code: string): string {
  const c = (code || '').trim();
  if (!c || c.toLowerCase() === 'auto') return '';
  return toMsTarget(c);
}

// --- helpers ---

// Group sentences into request batches under both a count and a character budget.
function batchSentences(sentences: string[], maxElems: number, maxChars: number): string[][] {
  const batches: string[][] = [];
  let buf: string[] = [];
  let chars = 0;
  for (const s of sentences) {
    if (buf.length && (buf.length >= maxElems || chars + s.length > maxChars)) {
      batches.push(buf);
      buf = [];
      chars = 0;
    }
    buf.push(s);
    chars += s.length;
  }
  if (buf.length) batches.push(buf);
  return batches;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
