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
    return out.length ? out : blocks;
  }

  return legacySegment(blocks);
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

export function hasTranslatableText(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length < 2) return false;
  // Must contain at least one letter in ANY script (skips pure emoji / numbers
  // / @handles). \p{L} covers Latin, Han, Hiragana/Katakana, Hangul, Cyrillic,
  // etc., so Korean/Japanese/… are no longer wrongly skipped. The source
  // language is auto-detected downstream; if it happens to equal the target,
  // the engine simply returns the text unchanged.
  return /\p{L}/u.test(trimmed);
}
