// Build script: converts scripts/data/idioms.csv
// ({idiom}>>{meaning} per line, from baiango/english_idioms, The Unlicense)
// into src/core/idioms.generated.ts — regex sources + plain-English replacements
// stacked into the free-engine pre-paraphrase defaults.
//
// Usage: node scripts/build-idioms.mjs
//
// Transformations:
// - strip CSV quoting artifacts, leading "To ", trailing . / ! on meanings
// - dedupe by lowercase idiom (first wins = shortest definition, per upstream)
// - skip idioms already covered by hand-written rules in paraphrase.ts
// - placeholders: someone/something/somebody (+ possessives) -> \w+ / \w+'s
//   so "pull someone's leg" also matches "pull his leg"
// - first-word inflection: kick -> kick(?:s|es|ed|ing)? so "kicked the bucket"
//   matches too (irregulars like "broke"/"drove" are an accepted miss)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const IN = join(root, 'scripts', 'data', 'idioms.csv');
const OUT = join(root, 'src', 'core', 'idioms.generated.ts');

// Common verbs, single source of truth in src/core/verbs.ts (backtick string).
const VERBS = new Set(
  readFileSync(join(root, 'src', 'core', 'verbs.ts'), 'utf-8')
    .match(/`([^`]+)`/)[1]
    .split(/\s+/),
);

// Idioms already handled by hand-written rules in paraphrase.ts (keep those,
// they are more precisely tuned). Compared after the same normalization.
const HAND_COVERED = new Set([
  "that's his business paycheck talking",
  'with zero proof',
  'with zero runs',
  'with zero runs between the two of you',
  'co-signed it with one word',
  'fuck around and find out',
  'fafo',
  'touch grass',
  'skill issue',
  'serve one model well',
]);


// Manual quality overrides, keyed by normalized lowercase idiom.
// meaning: replace the upstream gloss. patternSuffix: extra regex appended
// to the pattern. disable: drop the entry (gloss cannot be made safe).
const OVERRIDES = new Map(Object.entries({
  'cost an arm and a leg': { meaning: 'Cost a lot' },
  'turn a blind eye': { meaning: 'Ignore', patternSuffix: '(?: to)?' },
  "pull someone's leg": { meaning: 'Tease' },
  'raise the white flag': { meaning: 'Surrender' },
  'hit the nail on the head': { meaning: 'Be exactly right' },
  'spill the beans': { meaning: 'Reveal a secret' },
  'shine like a star': { meaning: 'Excel' },
  'shine bright': { meaning: 'Excel' },
  'close the door on': { meaning: 'End' },
  'put on a show': { meaning: 'Perform' },
  'handle the door with care': { meaning: 'Handle gently' },
  'fall off the back of a lorry': { meaning: 'Be stolen' },
  'shoot yourself in the foot': { disable: true },
  'achieve the goal': { meaning: 'Attain the objective' },
  'be glad to see the back of': { disable: true },
  'grain of salt': { disable: true },
  'raining cats and dogs': { meaning: 'Raining heavily' },
  "the bee's knees": { meaning: 'Excellent', keep: true },
  'cry wolf': { meaning: 'Raise a false alarm' },
  'sit on the fence': { meaning: 'Be undecided' },
  'cost a pretty penny': { meaning: 'Cost a lot' },
  'fall on deaf ears': { meaning: 'Be ignored' },
  'close but no cigar': { meaning: 'Almost succeeded', keep: true },
  'fly off the handle': { meaning: 'Explode in anger' },
  "hear something straight from the horse's mouth": { meaning: 'Hear directly from the source' },
  'cook the books': { meaning: 'Alter accounts dishonestly' },
  'stop at the red light': { meaning: 'Exercise caution' },
  'taste of your own medicine': { meaning: 'Retribution', keep: true },
  // keep: non-verb gloss is safe here (noun phrase / interjection / copular /
  // adverbial idiom) — skip the verb-led validation.
  'act of god': { keep: true },
  'break a leg': { keep: true },
  'break in the clouds': { keep: true },
  'break of dawn': { keep: true },
  'break of day': { keep: true },
  'be a long shot': { keep: true },
  'be in hot water': { keep: true },
  'be there or be square': { keep: true },
  'change in the wind': { keep: true },
  'come hell or high water': { keep: true },
  'come rain or shine': { keep: true },
  'cut from the same cloth': { keep: true },
  'drop in the bucket': { keep: true },
  'drop in the ocean': { keep: true },
  'end of the road': { keep: true },
  'fit as a fiddle': { keep: true },
  'fit for a king': { keep: true },
  'fly on the wall': { keep: true },
  'mind over matter': { keep: true },
  'rule of thumb': { keep: true },
  'set in stone': { keep: true },
  'speak of the devil': { keep: true },
  'start of a new day': { keep: true },
  'twist of fate': { keep: true },
  'finish line in sight': { keep: true },
}));

const SENT_W = '⟦W⟧'; // sentinel for \w+
const SENT_WPOS = '⟦P⟧'; // sentinel for \w+(?:'s)?

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function cleanIdiom(raw) {
  let s = raw.replace(/"+/g, '').trim(); // CSV quoting artifacts
  s = s.replace(/^to\s+/i, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function cleanMeaning(raw) {
  let s = raw.replace(/\s+/g, ' ').trim();
  s = s.replace(/^to\s+/i, ''); // "To keep doing..." -> "Keep doing..."
  // fix "X or Y" coordinations to the first verb ("Tease or joke" -> "Tease")
  // when the whole gloss is just that coordination.
  const startsWithSomething = /^something\b/i.test(s);
  // "someone"-family leftovers would otherwise leak into the output
  // ("They are on the same page" -> "They are agreeing with someone").
  s = s.replace(/\bwith\s+(someone|somebody)\b/gi, 'with each other');
  s = s.replace(/\b(someone|somebody|one)'s\b/gi, 'their');
  s = s.replace(/\b(someone|somebody)\b/gi, '');
  // "something": keep as subject ("Something excellent"), drop as object
  // ("Ignore something" -> "Ignore").
  if (!startsWithSomething) s = s.replace(/\bsomething\b/gi, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\b(of|to|for|with|about|on|in|at|from|by)\s*[.!\s]*$/i, '');
  s = s.replace(/[.!\s]+$/, '');
  return s;
}

// Head-word pattern with regular inflection, verb-gated:
//   kick -> kick(?:s|es|ed|ing)?      ("kicked the bucket")
//   drive -> driv(?:e?s|ed|ing)       ("driving someone up the wall")
// Non-verb heads ("The", "An") stay literal: "The bee's knees".
// Gerund heads ("Kicking") match the -ing form only, so a gerund-led
// meaning ("Dying", "Overworking") is only ever used in -ing position.
// Irregular past forms that verb-headed idioms actually use
// ("flew off the handle", "sat on the fence", "fell off...").
const IRREG_PAST = {
  fly: 'flew', drive: 'drove', break: 'broke', speak: 'spoke', steal: 'stole',
  write: 'wrote', ride: 'rode', ring: 'rang', drink: 'drank', swim: 'swam',
  run: 'ran', come: 'came', sit: 'sat', fall: 'fell', get: 'got',
  forget: 'forgot', eat: 'ate', see: 'saw', go: 'went', do: 'did',
  make: 'made', take: 'took', give: 'gave', bite: 'bit', hide: 'hid',
};

function headPattern(rawHead, literal) {
  if (literal || !/^[A-Za-z]+$/.test(rawHead)) return escRe(rawHead);
  const hb = headBase(rawHead);
  if (!hb || !VERBS.has(hb)) return escRe(rawHead); // not a verb -> literal
  if (/ing$/i.test(rawHead) && rawHead.length > 5) {
    return escRe(rawHead); // gerund head: -ing form only (gi flag covers case)
  }
  let pat;
  if (rawHead.length > 2) {
    // NOTE: (?:e|es|ed|ing) — the base form "Take" itself must match
    // (the old (?:e?s|ed|ing) matched "Takes"/"Taked" but not "Take").
    pat = /e$/i.test(rawHead)
      ? escRe(rawHead.slice(0, -1)) + '(?:e|es|ed|ing)'
      : escRe(rawHead) + '(?:s|es|ed|ing)?';
  } else {
    pat = escRe(rawHead);
  }
  const ip = IRREG_PAST[hb];
  if (ip) pat = `(?:${ip}|${pat})`;
  return pat;
}

// base verb -> gerund ("die" -> "dying"), mirrors runtime inflectVerb prog.
function toGerund(base) {
  if (/[^aeiou]ie$/i.test(base)) return base.slice(0, -2) + 'ying';
  if (/e$/i.test(base) && !/(ee|ye|oe)$/i.test(base)) return base.slice(0, -1) + 'ing';
  if (/[^aeiou][aeiou][^aeiouwx]$/i.test(base)) return base + base.slice(-1) + 'ing';
  return base + 'ing';
}

function toPattern(idiom, opts = {}) {
  // 1. placeholders -> sentinels (word-boundary aware, case-insensitive).
  // "someone's" also matches the bare possessive-less form ("pull his leg").
  const withSent = idiom
    .replace(/\bsomeone's\b/gi, SENT_WPOS)
    .replace(/\bsomething's\b/gi, SENT_WPOS)
    .replace(/\bsomebody's\b/gi, SENT_WPOS)
    .replace(/\bsomeone\b/gi, SENT_W)
    .replace(/\bsomething\b/gi, SENT_W)
    .replace(/\bsomebody\b/gi, SENT_W)
    .replace(/\bone's\b/gi, SENT_WPOS);

  // 2. split head / tail on the first space (sentinels contain no spaces)
  const sp = withSent.indexOf(' ');
  const rawHead = sp === -1 ? withSent : withSent.slice(0, sp);
  const rawTail = sp === -1 ? '' : withSent.slice(sp);

  // 3. escape the tail, then restore the sentinels as regex
  const tailPat = escRe(rawTail)
    .replaceAll(SENT_W, '\\w+')
    .replaceAll(SENT_WPOS, "\\w+(?:'s)?");
  // Simile guard: "Like a kid in a candy store" — "like" is a preposition.
  const literal = opts.literal || (/^like$/i.test(rawHead) && /^ a(n)? /i.test(rawTail));
  return headPattern(rawHead, literal) + tailPat + (opts.patternSuffix || '');
}

// Lowercase base head word for runtime tense agreement ("kicked" vs "kick").
// Empty when the head is not a plain word (no inflection possible).
// Gerund heads resolve to the verb stem: "Burning" -> "burn".
function headBase(rawHead) {
  if (!/^[A-Za-z]+$/.test(rawHead)) return '';
  const low = rawHead.toLowerCase();
  if (/ing$/.test(low)) {
    const stem = verbStem(low);
    if (stem && VERBS.has(stem)) return stem;
  }
  return low;
}

// Strip a gerund to its verb base: "working" -> "work", "chasing" -> "chase",
// "running" -> "run", "dying" -> "die". Null when no candidate is a known verb
// (this doubles as the guard against non-gerunds like "king" or "sing").
function verbStem(ingWord) {
  const low = ingWord.toLowerCase();
  if (!/ing$/.test(low) || low.length < 5) return null;
  const stemA = low.slice(0, -3);
  const cands = [stemA, stemA + 'e'];
  const dbl = stemA.match(/(.)\1$/);
  if (dbl && /^[^aeiou]$/.test(dbl[1])) cands.push(stemA.slice(0, -1));
  if (/[^aeiou]y$/.test(stemA)) cands.push(stemA.slice(0, -1) + 'ie');
  return cands.find((c) => VERBS.has(c)) ?? null;
}

const raw = readFileSync(IN, 'utf-8');
const seen = new Set();
const patterns = [];
const replacements = [];
const heads = [];
let skipped = 0;

for (const line of raw.split('\n')) {
  const t = line.trim().replace(/^"|"$/g, '');
  const m = t.match(/^\{(.+?)\}>>\{(.+?)\}$/);
  if (!m) { if (t) { console.warn('unparsed:', t.slice(0, 60)); skipped++; } continue; }
  const idiom = cleanIdiom(m[1]);
  let meaning = cleanMeaning(m[2]);
  if (!idiom || !meaning || meaning.length > 120) { skipped++; continue; }
  const key = idiom.toLowerCase();
  if (seen.has(key) || HAND_COVERED.has(key)) { skipped++; continue; }
  seen.add(key);
  const ov = OVERRIDES.get(key);
  if (ov && ov.disable) { skipped++; continue; }
  if (ov && ov.meaning) meaning = ov.meaning;
  const sp0 = idiom.indexOf(' ');
  const rawHead0 = sp0 === -1 ? idiom : idiom.slice(0, sp0);
  const hb = headBase(rawHead0);
  const isVerbHead = hb !== '' && VERBS.has(hb);
  const isGerundHead = isVerbHead && /ing$/i.test(rawHead0) && rawHead0.toLowerCase() !== hb;
  if (isVerbHead && !isGerundHead) {
    // Base head: store the base verb form ("Dying" -> "Die"); the runtime
    // re-inflects to the source tense.
    const wm = meaning.match(/^([A-Za-z]+)/);
    const bv = wm && verbStem(wm[1]);
    if (wm && bv) {
      const capped = /^[A-Z]/.test(wm[1]) ? bv[0].toUpperCase() + bv.slice(1) : bv;
      meaning = capped + meaning.slice(wm[1].length);
    }
    // Safety: a base verb head must have a verb-led meaning, otherwise the
    // replacement cannot sit in the verb slot ("It costs..." -> "It very expensive").
    // Skipped for similes ("Like a ...", literal head) and explicit keep:true.
    const isSimile = /^like$/i.test(rawHead0);
    const w0 = (meaning.match(/^([A-Za-z]+)/) || [])[1];
    if (!isSimile && !(ov && ov.keep) && (!w0 || !VERBS.has(w0.toLowerCase()))) {
      console.warn('disabled (meaning not verb-led):', idiom, '->', meaning);
      skipped++;
      continue;
    }
  } else if (isGerundHead) {
    // Gerund head matches -ing position only: meaning should be gerund-led.
    const wm = meaning.match(/^([A-Za-z]+)/);
    const w0 = wm && wm[1].toLowerCase();
    if (w0 && VERBS.has(w0) && !/ing$/i.test(w0)) {
      const g = toGerund(wm[1]);
      const capped = /^[A-Z]/.test(wm[1]) ? g[0].toUpperCase() + g.slice(1) : g;
      meaning = capped + meaning.slice(wm[1].length);
    }
  }
  heads.push(isGerundHead ? '' : hb);
  patterns.push(toPattern(idiom, ov || {}));
  replacements.push(meaning);
}

// Longest-first so "break a leg" wins over any shorter overlap.
const order = patterns.map((_, i) => i).sort((a, b) => patterns[b].length - patterns[a].length);

const esc = (s) => JSON.stringify(s);
const out =
  `// GENERATED — do not edit by hand.\n` +
  `// Built by scripts/build-idioms.mjs from scripts/data/idioms.csv\n` +
  `// (baiango/english_idioms, The Unlicense — public domain).\n` +
  `// Idiom -> plain-English paraphrase pairs stacked into the free-MT\n` +
  `// pre-edit defaults. IDIOM_PATTERNS[i] is a regex source matched with\n` +
  `// the 'gi' flags inside (?<!\\w)...(?!\\w); IDIOM_REPLACEMENTS[i] is its\n` +
  `// plain substitute. Order is longest-pattern-first. IDIOM_HEAD_BASE[i] is\n` +
  `// the lowercase base head word ("" when not inflectable), used for tense\n` +
  `// agreement at runtime.\n` +
  `export const IDIOM_PATTERNS: string[] = [\n` +
  order.map((i) => `  ${esc(patterns[i])},`).join('\n') +
  `\n];\n\nexport const IDIOM_REPLACEMENTS: string[] = [\n` +
  order.map((i) => `  ${esc(replacements[i])},`).join('\n') +
  `\n];\n\nexport const IDIOM_HEAD_BASE: string[] = [\n` +
  order.map((i) => `  ${esc(heads[i])},`).join('\n') +
  `\n];\n`;

writeFileSync(OUT, out);
console.log(`wrote ${OUT}: ${order.length} idioms (skipped ${skipped})`);
