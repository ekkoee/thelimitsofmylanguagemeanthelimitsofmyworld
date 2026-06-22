import { AlignedPair, Settings, WordLookup } from '../core/types';
import { TranslationProvider } from './base';
import { segment } from '../core/segmentation';

// FREE translation via Microsoft's keyless "Edge browser" endpoint — the same flow
// Edge's built-in page translator uses. Two steps, no API key:
//   1) GET  https://edge.microsoft.com/translate/auth        → a short-lived JWT
//   2) POST https://api-edge.cognitive.microsofttranslator.com/translate
//          ?api-version=3.0&to=<lang>   body: [{ "Text": "…" }]   header Bearer <jwt>
//
// We use this as the Tier-1 FREE fallback for Google's gtx endpoint: when Google
// rate-limits (403/429), the service worker retries the same text here so "always
// free, no key" keeps holding. It can also be picked directly in options.
//
// Unlike Google's gtx endpoint (which auto-segments and returns original/translation
// chunks), this endpoint translates each array element as one unit. So we segment the
// block ourselves and send one element per sentence — that reproduces the same
// per-line bilingual alignment, in order, 1:1.
//
// NOTE: like the Google one this is an unofficial endpoint and can change/throttle.
const AUTH_ENDPOINT = 'https://edge.microsoft.com/translate/auth';
const API_ENDPOINT = 'https://api-edge.cognitive.microsofttranslator.com/translate';

// Keep each request modest: the endpoint accepts an array, but huge bodies are more
// likely to be throttled. Batch sentences up to these soft limits per request.
const MAX_ELEMENTS = 25;
const MAX_CHARS = 5000;

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
    const translation = String(item?.translations?.[0]?.text ?? '').trim();
    const detected = String(item?.detectedLanguage?.language ?? '');
    const sourceLang = detected || from;
    return { translation, sourceLang };
  },
};

// --- HTTP ---

// POST an array of strings, return the translated strings in the SAME order.
async function translateArray(texts: string[], from: string, to: string): Promise<string[]> {
  const data = await translateRaw(texts, from, to);
  return texts.map((_, i) => String(data?.[i]?.translations?.[0]?.text ?? ''));
}

// Raw call → the endpoint's array of { translations:[{text}], detectedLanguage? }.
// Retries once on a stale/forbidden token (401/403) by forcing a fresh token, and
// backs off once on 429 — the same gentle policy as the Google engine.
async function translateRaw(texts: string[], from: string, to: string, attempt = 0): Promise<any[]> {
  const token = await getAuthToken(attempt > 0); // force a fresh token on retry
  const qs = new URLSearchParams({ 'api-version': '3.0', to });
  if (from) qs.set('from', from);
  const res = await fetch(`${API_ENDPOINT}?${qs.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(texts.map((t) => ({ Text: t }))),
  });
  if ((res.status === 401 || res.status === 403) && attempt < 1) {
    return translateRaw(texts, from, to, attempt + 1);
  }
  if (res.status === 429 && attempt < 2) {
    await sleep(400 * (attempt + 1));
    return translateRaw(texts, from, to, attempt + 1);
  }
  if (!res.ok) throw new Error(`Microsoft ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

// --- auth token (cached in memory, refreshed before expiry) ---

let cachedToken = '';
let tokenExp = 0;                       // epoch ms when the cached JWT expires
let tokenInFlight: Promise<string> | null = null; // dedupe concurrent first fetches

async function getAuthToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  // reuse while still valid, with a 30s safety margin
  if (!forceRefresh && cachedToken && now < tokenExp - 30_000) return cachedToken;
  if (!forceRefresh && tokenInFlight) return tokenInFlight;
  tokenInFlight = (async () => {
    const res = await fetch(AUTH_ENDPOINT);
    if (!res.ok) throw new Error(`Microsoft auth ${res.status}`);
    const token = (await res.text()).trim();
    cachedToken = token;
    tokenExp = jwtExpiryMs(token) || Date.now() + 8 * 60_000; // 8 min fallback if undecodable
    return token;
  })();
  try {
    return await tokenInFlight;
  } finally {
    tokenInFlight = null;
  }
}

// Decode a JWT's `exp` claim (seconds) → epoch ms. Returns 0 if it can't be parsed.
function jwtExpiryMs(token: string): number {
  try {
    const payload = token.split('.')[1];
    if (!payload) return 0;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp * 1000 : 0;
  } catch {
    return 0;
  }
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
