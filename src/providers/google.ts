import { AlignedPair, DictEntry, Settings, WordLookup } from '../core/types';
import { TranslationProvider } from './base';
import { segment } from '../core/segmentation';

// FREE translation via Google's public gtx endpoint. No API key required.
// The endpoint auto-segments text and returns [translated, original] chunks,
// which gives us per-sentence bilingual alignment for free.
//
// NOTE: this is an unofficial endpoint. It can rate-limit (HTTP 429) or change.
// If that ever happens, switch the engine to Gemini (free tier key) in options.
const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MAX_CHUNK = 1000; // keep each request's text short to avoid endpoint limits

export const googleProvider: TranslationProvider = {
  id: 'google',
  async translateBlock(text: string, settings: Settings): Promise<AlignedPair[]> {
    const tl = settings.targetLangCode || 'zh-TW';
    const sl = settings.sourceLang || 'auto'; // 'auto' → Google detects the source language
    const chunks = chunkText(text, MAX_CHUNK, sl);
    const out: AlignedPair[] = [];
    for (const chunk of chunks) {
      const pairs = await fetchChunk(chunk, sl, tl);
      out.push(...pairs);
    }
    return out;
  },

  // Double-click popup lookup. Same free gtx endpoint as translateBlock, but we also
  // ask for the detected source language (data[2], used to pick a TTS voice) and — for
  // a single short token — dictionary data via dt=bd (part of speech + meanings).
  async lookup(text: string, settings: Settings): Promise<WordLookup> {
    const tl = settings.targetLangCode || 'zh-TW';
    const sl = settings.sourceLang || 'auto';
    const withDict = wantsDict(text);
    const dt = withDict ? 'dt=t&dt=bd' : 'dt=t';
    const url = `${ENDPOINT}?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&${dt}&q=${encodeURIComponent(text)}`;
    const data = await gtxGet(url);
    const segs: any[] = Array.isArray(data?.[0]) ? data[0] : [];
    const translation = segs.map((s) => String(s?.[0] ?? '')).join('').trim();
    // data[2] is Google's detected source language (e.g. 'en', 'ja'); fall back to an
    // explicit non-auto source if the user pinned one.
    const detected = typeof data?.[2] === 'string' ? data[2] : '';
    const sourceLang = detected || (sl !== 'auto' ? sl : '');
    return { translation, sourceLang, dict: parseDict(data?.[1]) };
  },
};

async function fetchChunk(text: string, sl: string, tl: string): Promise<AlignedPair[]> {
  const url = `${ENDPOINT}?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
  const data = await gtxGet(url);
  const segs: any[] = Array.isArray(data?.[0]) ? data[0] : [];
  const pairs = segs
    .map((s) => ({ t: String(s?.[0] ?? '').trim(), o: String(s?.[1] ?? '').trim() }))
    .filter((p) => p.o);
  // fallback: if the endpoint returned nothing useful, keep original as a single pair
  return pairs.length ? pairs : [{ o: text.trim(), t: '' }];
}

// Shared GET against the gtx endpoint with the same gentle 429 back-off retry.
async function gtxGet(url: string, attempt = 0): Promise<any> {
  const res = await fetch(url, { method: 'GET' });
  if (res.status === 429 && attempt < 2) {
    await sleep(400 * (attempt + 1));
    return gtxGet(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Google ${res.status}`);
  return res.json();
}

// Only ask for dictionary data on a single token: no internal whitespace and short.
// Phrases/sentences (which contain spaces) get a plain translation, no card.
function wantsDict(text: string): boolean {
  return !/\s/.test(text) && text.length <= 30;
}

// Parse the dt=bd block (data[1]) into [{ pos, terms }]. Shape per entry is roughly
// [partOfSpeech, [term, term, …], …]. Returns undefined when there's nothing usable
// (e.g. language pairs Google has no dictionary for — that's expected, not an error).
function parseDict(raw: any): DictEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const entries: DictEntry[] = [];
  for (const e of raw) {
    const pos = String(e?.[0] ?? '').trim();
    const terms = Array.isArray(e?.[1])
      ? e[1].map((x: any) => String(x ?? '').trim()).filter(Boolean)
      : [];
    if (terms.length) entries.push({ pos, terms });
  }
  return entries.length ? entries : undefined;
}

function chunkText(text: string, limit: number, locale?: string): string[] {
  if (text.length <= limit) return [text];
  const sentences = segment(text, locale);
  const chunks: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + ' ' + s).length > limit && buf) { chunks.push(buf); buf = s; }
    else buf = buf ? `${buf} ${s}` : s;
  }
  if (buf) chunks.push(buf);
  return chunks;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
