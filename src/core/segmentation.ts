// Lightweight English-first sentence segmentation.
// Goal: split a paragraph into sentences so each can be aligned 1:1 with its
// translation. Deliberately conservative — over-splitting hurts translation
// quality more than under-splitting.

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'eg', 'e.g',
  'ie', 'i.e', 'no', 'fig', 'al', 'inc', 'ltd', 'co', 'dept', 'univ', 'gov',
  'u.s', 'u.k', 'a.m', 'p.m', 'approx', 'gen', 'sen', 'rep',
]);

export function segment(input: string): string[] {
  const text = input.replace(/\s+/g, ' ').trim();
  if (!text) return [];

  // First split on hard line breaks from the source, then sentence-split each.
  const blocks = input.split(/\n{1,}/).map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean);
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
        const startsUpperOrEnd = !next || /^[“"'(\[A-Z0-9\u4e00-\u9fff]/.test(next);
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

  return out.length ? out : [text];
}

export function hasTranslatableText(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length < 2) return false;
  // must contain at least one letter (skip pure emoji / numbers / @handles)
  return /[A-Za-z\u00C0-\u024F]/.test(trimmed);
}
