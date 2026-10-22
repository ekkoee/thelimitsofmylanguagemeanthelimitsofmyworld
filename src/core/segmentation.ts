// Locale-aware sentence segmentation.
// Goal: split a paragraph into sentences so each can be aligned 1:1 with its
// translation. Primary path uses the browser's built-in Intl.Segmenter
// (ICU-backed), which segments ANY language — including CJK (Chinese / Japanese
// / Korean) — not just English. Falls back to a conservative English-first
// heuristic on the rare runtime without Intl.Segmenter.

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'eg', 'e.g',
  'ie', 'i.e', 'no', 'fig', 'al', 'inc', 'ltd', 'co', 'dept', 'univ', 'gov',
  'u.s', 'u.k', 'a.m', 'p.m', 'approx', 'gen', 'sen', 'rep',
]);

/**
 * Split text into sentences for 1:1 bilingual alignment.
 * @param input  source text (may contain hard line breaks)
 * @param locale BCP-47 source-language hint; 'auto'/undefined → engine default.
 */
export function segment(input: string, locale?: string): string[] {
  // Hard line breaks in the source are meaningful — split on them first so a
  // multi-line post keeps its own line boundaries, then sentence-split each.
  const blocks = input
    .split(/\n{1,}/)
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!blocks.length) return [];

  // Intl.Segmenter is available in every Chrome that runs MV3; the guard keeps
  // us safe in any odd runtime and lets TS compile without the ES2022.Intl lib.
  const SegmenterCtor = (Intl as any).Segmenter;
  if (typeof SegmenterCtor === 'function') {
    const loc = locale && locale !== 'auto' ? locale : undefined;
    const seg = new SegmenterCtor(loc, { granularity: 'sentence' });
    const out: string[] = [];
    for (const block of blocks) {
      for (const part of seg.segment(block)) {
        const s = String(part.segment).trim();
        if (s) out.push(s);
      }
    }
    return mergeListMarkers(out.length ? out : blocks);
  }

  return mergeListMarkers(legacySegment(blocks));
}

// A segment that's ONLY a list marker ("1.", "2)", "-") is useless alone —
// Intl.Segmenter often splits it off ("1. Physical." → ["1.", "Physical."]).
// Glue it to the following segment so the item translates (and renders) as
// one line instead of stranding a bare "1.".
const LONE_MARKER_RE = /^(?:\d{1,3}[.)、]|[-•*·])$/;
function mergeListMarkers(segs: string[]): string[] {
  const merged: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (LONE_MARKER_RE.test(s) && i + 1 < segs.length && !LONE_MARKER_RE.test(segs[i + 1])) {
      merged.push(`${s} ${segs[i + 1]}`);
      i++;
    } else {
      merged.push(s);
    }
  }
  return merged;
}

// Conservative English-first heuristic. Only used when Intl.Segmenter is absent.
function legacySegment(blocks: string[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    let buf = '';
    const tokens = block.split(/(\s+)/); // keep whitespace tokens
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      buf += tok;
      const m = /([.!?。！？…])(["'”’)\]]*)$/.exec(tok.trim());
      if (m) {
        const word = tok.trim().toLowerCase().replace(/[.!?。！？…"'”’)\]]+$/, '');
        const isAbbrev = ABBREVIATIONS.has(word) || /^[a-z]$/.test(word);
        const next = tokens[i + 2]; // skip the whitespace token
        const startsUpperOrEnd = !next || /^[“"'(\[A-Z0-9一-鿿]/.test(next);
        if (!isAbbrev && startsUpperOrEnd) {
          const s = buf.trim();
          if (s) out.push(s);
          buf = '';
        }
      }
    }
    const tail = buf.trim();
    if (tail) out.push(tail);
  }
  return out.length ? out : blocks;
}

// Web addresses, @mentions and #hashtags are links, not prose: they never decide which language a passage
// is in, and a line made of nothing else has nothing to translate.
const NOISE_URL = /(?:https?:\/\/|www\.)\S+/gi;
const NOISE_DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|tw|cn|jp|kr|app|dev|ai|xyz|info|me|tv|gg|ly|to|us|uk|de|fr|edu|gov)\b(?:\/\S*)?/gi;
const NOISE_MENTION = /(^|[^\w@])@[A-Za-z0-9_]{1,30}/g;
const NOISE_HASHTAG = /(^|[^\w#&])#[\p{L}\p{N}_]+/gu;

export function stripNoise(t: string): string {
  return t.replace(NOISE_URL, ' ').replace(NOISE_DOMAIN, ' ').replace(NOISE_MENTION, '$1 ').replace(NOISE_HASHTAG, '$1 ');
}

// Share of Chinese in a passage, 0..1, counted in "words" (about 1.6 Han characters per word) against the
// foreign words around them. Japanese / Korean text is never Chinese.
export function chineseShare(text: string): number {
  const s = stripNoise(text);
  const han = (s.match(/\p{Script=Han}/gu) || []).length;
  if (!han || /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(s)) return 0;
  const foreign = (s.replace(/\p{Script=Han}/gu, ' ').match(/\p{L}[\p{L}'’-]*/gu) || []).length;
  const units = han / 1.6;
  return units / (units + foreign);
}

// True when the text is ALREADY in the target language (only meaningful for a
// Chinese target). Chinese writing is not translated into Chinese, however many
// English words, names or links it contains: the reader understands them. Only
// passages that are mostly foreign are translated. Used to skip pointless
// 中文→中文 (incl. Simplified→Traditional) re-translation across every surface
// (X / Reddit / whole-page). Cheap — a few regex over one node.
export function isAlreadyTargetLang(text: string, targetLangCode: string): boolean {
  if (!(targetLangCode || '').toLowerCase().startsWith('zh')) return false;
  return chineseShare(text) >= 0.3;
}

export function hasTranslatableText(s: string): boolean {
  const t = stripNoise(s).trim();
  if (t.length < 2) return false;
  // Must contain at least one letter in ANY script (skips pure emoji / numbers
  // / @handles). \p{L} covers Latin, Han, Hiragana/Katakana, Hangul, Cyrillic,
  // etc., so Korean/Japanese/… are no longer wrongly skipped. The source
  // language is auto-detected downstream; if it happens to equal the target,
  // the engine simply returns the text unchanged.
  return /\p{L}/u.test(t);
}
