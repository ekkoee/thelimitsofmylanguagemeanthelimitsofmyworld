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

/**
 * fetch() that rides out rate limits. LLM APIs (esp. free-tier keys) 429 when a
 * page fires a burst of requests (e.g. a social feed translating dozens of posts
 * at once). Retries with exponential backoff + jitter, honoring Retry-After when
 * the server sends one. Only 429/503 are retried — anything else returns as-is.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts?: { label?: string; maxRetries?: number },
): Promise<Response> {
  const maxRetries = opts?.maxRetries ?? 3;
  let last: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429 && res.status !== 503) return res;
    last = res;
    if (attempt === maxRetries) return res;
    const retryAfter = Number(res.headers.get('retry-after'));
    const base = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(8000, 1000 * 2 ** attempt); // 1s, 2s, 4s, cap 8s
    await new Promise((r) => setTimeout(r, base * (0.8 + Math.random() * 0.4)));
  }
  return last as Response;
}

export function buildSystemPrompt(
  targetLang: string,
  sourceLang?: string,
  opts?: { pageTitle?: string; mode?: 'prose' | 'subtitle'; compact?: boolean },
): string {
  const src = sourceLang && sourceLang !== 'auto' ? sourceLang : '';
  const translateLine = src
    ? `Translate each input line from ${src} into ${targetLang}.`
    : `Detect the source language of each input line and translate it into ${targetLang}.`;
  const prose = opts?.mode === 'prose'; // anything else (incl. missing) → subtitle register
  const title = opts?.pageTitle?.trim();

  // Compact prompt for latency-sensitive providers (Gemini): keep Traditional/
  // Simplified script fidelity + the JSON 1:1 alignment contract, drop verbosity.
  if (opts?.compact) {
    return buildCompactSystemPrompt(targetLang, translateLine, prose, title);
  }

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
  // Script fidelity: LLMs sometimes leak the wrong Han script (e.g. Simplified
  // chars when asked for Traditional). State the script as a hard rule.
  if (/traditional/i.test(targetLang)) {
    lines.push(`- Write ENTIRELY in Traditional Chinese (繁體中文, as used in Taiwan). NEVER output Simplified Chinese characters (简体字) — every single character must be Traditional.`);
  } else if (/simplified/i.test(targetLang)) {
    lines.push(`- Write ENTIRELY in Simplified Chinese (简体字). NEVER output Traditional Chinese characters (繁體字) — every single character must be Simplified.`);
  }
  if (prose) {
    lines.push(`- Produce fluent, idiomatic ${targetLang} as a native writer would phrase it, while keeping each numbered element's meaning and staying aligned 1:1.`);
  }
  lines.push(`- Get proper nouns right: keep brand/product/person names accurate, and render well-known film, show, song and book titles using their official ${targetLang} name when one exists (otherwise keep the original).`);
  if (!prose) {
    // Subtitle-only register.
    lines.push(`- Input often comes from speech-to-text, so it may lack punctuation or contain small recognition errors — infer the intended meaning and translate that.`);
    lines.push(`- The input lines are CONSECUTIVE subtitle lines from one video, in playback order. Use the surrounding lines (both earlier AND later) as context: resolve pronouns (he/she/it/this), disambiguate words with several meanings, and keep names and terms consistent across lines. A line that looks odd on its own usually makes sense with its neighbors — translate the intended meaning, never word-for-word.`);
    lines.push(`- Never translate sound-effect / non-speech annotations in brackets or parentheses — e.g. [music], [applause], (laughing), ♪. If a line consists ONLY of such annotations, output that line unchanged.`);
    lines.push(`- Keep it concise and readable as an on-screen subtitle.`);
  }
  lines.push(`- Preserve @mentions, #hashtags, URLs and code verbatim.`);

  // Hardened 1:1 alignment contract (both modes).
  lines.push(`- You will receive a JSON object {"sentences": [...]}. Translate EACH element in order, using the neighboring elements as context per the rules above — but keep each translation aligned to its own element.`);
  lines.push(`- Output array length MUST EXACTLY equal input array length. Do NOT merge, split, reorder, add, or drop any element.`);
  lines.push(`- If an element is impossible to translate, output the original element unchanged at that index — never omit it.`);
  lines.push(`- Return ONLY {"t": [...]} with the same number of items, no extra text.`);

  return lines.join('\n');
}

/** Shorter system prompt for Gemini (and similar) — fewer prefill tokens, same contract. */
function buildCompactSystemPrompt(
  targetLang: string,
  translateLine: string,
  prose: boolean,
  title: string | undefined,
): string {
  const lines: string[] = [];
  lines.push(prose
    ? `Professional translator for web/social text → ${targetLang}.`
    : `Professional subtitle translator → ${targetLang}.`);
  lines.push(translateLine);
  if (title) {
    lines.push(`Page title context (do not translate/echo): "${title}".`);
  }
  if (/traditional/i.test(targetLang)) {
    lines.push(`Output ENTIRELY Traditional Chinese (繁體中文). Never Simplified (简体).`);
  } else if (/simplified/i.test(targetLang)) {
    lines.push(`Output ENTIRELY Simplified Chinese (简体). Never Traditional (繁體).`);
  }
  lines.push(`Natural fluent ${targetLang}; meaning over word-for-word.`);
  lines.push(`Keep proper nouns / official titles accurate; preserve @mentions #hashtags URLs code.`);
  if (!prose) {
    lines.push(`Speech-to-text may lack punctuation — infer meaning. Use neighboring lines for context; keep 1:1 alignment.`);
    lines.push(`Leave sound-effect annotations like [music] / (laughing) unchanged if a line is only that.`);
  }
  lines.push(`Input JSON {"sentences":[...]}. Return ONLY {"t":[...]} same length/order. Never merge/split/drop; if untranslatable keep original at that index.`);
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
