import { AlignedPair, Settings } from '../core/types';
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
    const chunks = chunkText(text, MAX_CHUNK);
    const out: AlignedPair[] = [];
    for (const chunk of chunks) {
      const pairs = await fetchChunk(chunk, tl);
      out.push(...pairs);
    }
    return out;
  },
};

async function fetchChunk(text: string, tl: string, attempt = 0): Promise<AlignedPair[]> {
  const url = `${ENDPOINT}?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, { method: 'GET' });
  if (res.status === 429 && attempt < 2) {
    await sleep(400 * (attempt + 1));
    return fetchChunk(text, tl, attempt + 1);
  }
  if (!res.ok) throw new Error(`Google ${res.status}`);
  const data = await res.json();
  const segs: any[] = Array.isArray(data?.[0]) ? data[0] : [];
  const pairs = segs
    .map((s) => ({ t: String(s?.[0] ?? '').trim(), o: String(s?.[1] ?? '').trim() }))
    .filter((p) => p.o);
  // fallback: if the endpoint returned nothing useful, keep original as a single pair
  return pairs.length ? pairs : [{ o: text.trim(), t: '' }];
}

function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const sentences = segment(text);
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
