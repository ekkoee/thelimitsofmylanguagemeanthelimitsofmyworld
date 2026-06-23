import { AlignedPair, Settings, WordLookup } from '../core/types';

export interface TranslateInput {
  sentences: string[];
  targetLang: string;
  sourceLang?: string; // BCP-47 code or 'auto' (detect). Undefined/'auto' → detect.
  pageTitle?: string;  // page title used as background context (prose). Optional → omitted.
  mode?: 'prose' | 'subtitle'; // translation register. Optional → treated as 'subtitle' (current behavior).
}

export interface TranslationProvider {
  id: string;
  /** Sentence-aligned translation (LLM providers). Returns SAME length & order. */
  translate?(input: TranslateInput, settings: Settings): Promise<string[]>;
  /** Whole-block translation that returns its own aligned original/translation pairs.
   *  Free machine-translation engines (Google) use this — one request, perfect alignment. */
  translateBlock?(text: string, settings: Settings): Promise<AlignedPair[]>;
  /** Single-selection lookup for the double-click popup: translation + detected source
   *  language, plus dictionary data when the engine has it (free Google dt=bd). Optional —
   *  providers without it fall back to translate()/translateBlock() in the background. */
  lookup?(text: string, settings: Settings): Promise<WordLookup>;
}

export function buildSystemPrompt(
  targetLang: string,
  sourceLang?: string,
  opts?: { pageTitle?: string; mode?: 'prose' | 'subtitle' },
): string {
  const src = sourceLang && sourceLang !== 'auto' ? sourceLang : '';
  const translateLine = src
    ? `Translate each input line from ${src} into ${targetLang}.`
    : `Detect the source language of each input line and translate it into ${targetLang}.`;
  const prose = opts?.mode === 'prose'; // anything else (incl. missing) → subtitle register
  const title = opts?.pageTitle?.trim();

  const lines: string[] = [];

  // Role / register. Prose for web articles & social posts; subtitle otherwise.
  lines.push(prose
    ? `You are a professional translator localizing web article and social-media text into ${targetLang}.`
    : `You are a professional subtitle translator.`);
  lines.push(translateLine);

  // Optional page-title context — background only, never translated or echoed.
  if (title) {
    lines.push(`Context — the page being translated is titled: "${title}". Use this only to disambiguate terms (e.g. tell a product name from a common word); do NOT translate the title itself or mention it.`);
  }

  lines.push(`Rules:`);
  // Shared tone + proper-noun + preserve rules (both modes).
  lines.push(`- Produce natural, fluent ${targetLang} the way a native speaker would actually say it; convey the meaning rather than translating word-for-word.`);
  if (prose) {
    lines.push(`- Produce fluent, idiomatic ${targetLang} as a native writer would phrase it, while keeping each numbered element's meaning and staying aligned 1:1.`);
  }
  lines.push(`- Get proper nouns right: keep brand/product/person names accurate, and render well-known film, show, song and book titles using their official ${targetLang} name when one exists (otherwise keep the original).`);
  if (!prose) {
    // Subtitle-only register (wording unchanged from the original prompt).
    lines.push(`- Input often comes from speech-to-text, so it may lack punctuation or contain small recognition errors — infer the intended meaning and translate that.`);
    lines.push(`- Keep it concise and readable as an on-screen subtitle.`);
  }
  lines.push(`- Preserve @mentions, #hashtags, URLs and code verbatim.`);

  // Hardened 1:1 alignment contract (both modes).
  lines.push(`- You will receive a JSON object {"sentences": [...]}. Translate EACH element independently and in order.`);
  lines.push(`- Output array length MUST EXACTLY equal input array length. Do NOT merge, split, reorder, add, or drop any element.`);
  lines.push(`- If an element is impossible to translate, output the original element unchanged at that index — never omit it.`);
  lines.push(`- Return ONLY {"t": [...]} with the same number of items, no extra text.`);

  return lines.join('\n');
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
