import { AlignedPair, Settings } from '../core/types';

export interface TranslateInput {
  sentences: string[];
  targetLang: string;
}

export interface TranslationProvider {
  id: string;
  /** Sentence-aligned translation (LLM providers). Returns SAME length & order. */
  translate?(input: TranslateInput, settings: Settings): Promise<string[]>;
  /** Whole-block translation that returns its own aligned original/translation pairs.
   *  Free machine-translation engines (Google) use this — one request, perfect alignment. */
  translateBlock?(text: string, settings: Settings): Promise<AlignedPair[]>;
}

export function buildSystemPrompt(targetLang: string): string {
  return [
    `You are a professional subtitle translator.`,
    `Translate each input line into ${targetLang}.`,
    `Rules:`,
    `- Produce natural, fluent ${targetLang} the way a native speaker would actually say it; convey the meaning rather than translating word-for-word.`,
    `- Get proper nouns right: keep brand/product/person names accurate, and render well-known film, show, song and book titles using their official ${targetLang} name when one exists (otherwise keep the original).`,
    `- Input often comes from speech-to-text, so it may lack punctuation or contain small recognition errors — infer the intended meaning and translate that.`,
    `- Keep it concise and readable as an on-screen subtitle.`,
    `- Do NOT merge or split lines. Output count MUST equal input count.`,
    `- Preserve @mentions, #hashtags, URLs and code verbatim.`,
    `- Return ONLY a JSON object of the form {"t": ["...", "..."]} with no extra text.`,
  ].join('\n');
}

// Robustly pull a string[] of length n out of a model's JSON-ish response.
export function coerceTranslations(rawText: string, n: number): string[] {
  const json = extractJson(rawText);
  let arr: unknown;
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    arr = obj.t ?? obj.translations ?? obj.result ?? obj.results ?? (Array.isArray(json) ? json : undefined);
  }
  if (Array.isArray(arr)) {
    const list = arr.map((x) => (typeof x === 'string' ? x : String(x ?? '')));
    if (list.length === n) return list;
    if (list.length > n) return list.slice(0, n);
    return [...list, ...Array(n - list.length).fill('')];
  }
  throw new Error('Could not parse translations from provider response');
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const start = trimmed.indexOf('{');
  const startArr = trimmed.indexOf('[');
  const from = start === -1 ? startArr : startArr === -1 ? start : Math.min(start, startArr);
  if (from === -1) return undefined;
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (end <= from) return undefined;
  try { return JSON.parse(trimmed.slice(from, end + 1)); } catch { return undefined; }
}
