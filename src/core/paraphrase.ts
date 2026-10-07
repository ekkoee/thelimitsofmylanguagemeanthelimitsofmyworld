// English → English pre-edits for the free machine-translation path.
//
// Free MT renders plain, literal English far more naturally than idiom-heavy
// social copy ("with zero proof" → 在零證明方面, "paycheck talking" → 薪水說話).
// Before a paragraph goes to Google/Microsoft we rewrite idioms into plain
// equivalents. Every rewrite is meaning-preserving and NEVER injects Chinese
// (that would flip Google's auto language detection — a lesson learned the
// hard way). The displayed original and the glossary correction both keep
// using the untouched source text.
//
// Two layers, stacked:
//  1. Hand-written rules below — precisely tuned for the user's real
//     screenshots. These run first and win on overlap.
//  2. Community idiom list (idioms.generated.ts, ~1000 entries from
//     baiango/english_idioms, public domain) — built by
//     scripts/build-idioms.mjs with placeholder + verb-inflection handling,
//     combined into ONE regex for a single scan per paragraph.
//
// Keep entries tight and safe — a wrong paraphrase degrades faithful
// translations, so when in doubt, leave the idiom alone and let MT handle it.
import { IDIOM_HEAD_BASE, IDIOM_PATTERNS, IDIOM_REPLACEMENTS } from './idioms.generated';
import { COMMON_VERBS } from './verbs';

const PRE_EDITS: Array<[RegExp, string]> = [
  // "that's his business paycheck talking" → 那只是他的商業偏見
  [/\bthat's his business paycheck talking\b/gi, 'that just shows his business bias'],
  [/\b(\w+) paycheck talking\b/gi, '$1 bias talking'],
  // "with zero proof" → 沒有任何證據 (not 在零證明方面)
  [/\bwith zero proof\b/gi, 'without any evidence'],
  // "with zero runs between the two of you" → 你們兩個連一次都沒跑過
  [/\bwith zero runs between the two of you\b/gi, 'when neither of you has run a single test'],
  [/\bwith zero runs\b/gi, 'without running a single test'],
  // "co-signed it with one word" → 用一個詞表示贊同 (not 連署)
  [/\bco-signed it with one word\b/gi, 'agreed with it in one word'],
  // "fuck around and find out" → 自己試試看就知道了
  [/\bfuck around and find out\b/gi, 'try it yourself and find out'],
  [/\bfafo\b/gi, 'try it yourself and find out'],
  // "touch grass" → 出門走走
  [/\btouch grass\b/gi, 'go outside'],
  // "skill issue" → 技術不足
  [/\bskill issue\b/gi, 'lack of skill'],
  // "serve one model well" → 先把一個模型跑好
  [/\bserve one model well\b/gi, 'get one model working well'],
  // "a fresh coat of paint" → 表面功夫 (not 重新粉刷)
  [/\bmore than a fresh coat of paint\b/gi, 'more than a superficial change'],
  [/\ba fresh coat of paint\b/gi, 'a superficial change'],
  // "killing myself 14 hours a day" → 拚命工作 (not 自殺)
  [/\bkilling\s+(myself|yourself|himself|herself|itself|ourselves|themselves)\b/gi, 'overworking $1'],
];

type Suffix = 'past' | 'third' | 'prog' | 'base';



// Which inflection the matched head word carries relative to the base head,
// e.g. base "kick", matched "kicked" -> "past". Unrecognized -> null (no change).
// Irregular verbs that appear as idiom heads or as leading verbs of replacements.
const IRREG_VERBS: Record<string, { past: string; third: string; prog: string }> = {
  be: { past: 'was', third: 'is', prog: 'being' },
  go: { past: 'went', third: 'goes', prog: 'going' },
  do: { past: 'did', third: 'does', prog: 'doing' },
  make: { past: 'made', third: 'makes', prog: 'making' },
  take: { past: 'took', third: 'takes', prog: 'taking' },
  come: { past: 'came', third: 'comes', prog: 'coming' },
  run: { past: 'ran', third: 'runs', prog: 'running' },
  get: { past: 'got', third: 'gets', prog: 'getting' },
  forget: { past: 'forgot', third: 'forgets', prog: 'forgetting' },
  give: { past: 'gave', third: 'gives', prog: 'giving' },
  speak: { past: 'spoke', third: 'speaks', prog: 'speaking' },
  drink: { past: 'drank', third: 'drinks', prog: 'drinking' },
  write: { past: 'wrote', third: 'writes', prog: 'writing' },
  fly: { past: 'flew', third: 'flies', prog: 'flying' },
  drive: { past: 'drove', third: 'drives', prog: 'driving' },
  break: { past: 'broke', third: 'breaks', prog: 'breaking' },
  eat: { past: 'ate', third: 'eats', prog: 'eating' },
  see: { past: 'saw', third: 'sees', prog: 'seeing' },
  sit: { past: 'sat', third: 'sits', prog: 'sitting' },
  fall: { past: 'fell', third: 'falls', prog: 'falling' },
  swim: { past: 'swam', third: 'swims', prog: 'swimming' },
  steal: { past: 'stole', third: 'steals', prog: 'stealing' },
  ride: { past: 'rode', third: 'rides', prog: 'riding' },
  ring: { past: 'rang', third: 'rings', prog: 'ringing' },
  bite: { past: 'bit', third: 'bites', prog: 'biting' },
  hide: { past: 'hid', third: 'hides', prog: 'hiding' },
};

function detectSuffix(matchedHead: string, baseHead: string): Suffix | null {
  const m = matchedHead.toLowerCase();
  const b = baseHead.toLowerCase();
  if (m === b) return null;
  const irr = IRREG_VERBS[b];
  if (irr) {
    if (m === irr.past) return 'past';
    if (m === irr.third) return 'third';
    if (m === irr.prog) return 'prog';
    return null;
  }
  if (b.endsWith('e')) {
    const stem = b.slice(0, -1);
    if (m === b + 'd') return 'past';
    if (m === b + 's') return 'third';
    if (m === stem + 'ing') return 'prog';
  } else {
    // consonant doubling: hit -> hitting, run -> running, stop -> stopped
    const dbl = /[^aeiou][aeiou][^aeiouwx]$/i.test(b) ? b + b.slice(-1) : null;
    // y -> ie/ies: try -> tried/tries, cry -> cried/cries
    const yStem = /[^aeiou]y$/i.test(b) ? b.slice(0, -1) : null;
    if (m === b + 'ed' || m === b + 'd' || (dbl && m === dbl + 'ed') || (yStem && m === yStem + 'ied')) return 'past';
    if (m === b + 's' || m === b + 'es' || (yStem && m === yStem + 'ies')) return 'third';
    if (m === b + 'ing' || (dbl && m === dbl + 'ing')) return 'prog';
  }
  return null;
}

// Consonant doubling only for (likely) monosyllables: "stop" -> "stopped" but
// "surrender" -> "surrendered" (not "surrenderrred"). Polysyllabic doublers
// ("forget" -> "forgetting") are covered by IRREG_VERBS above.
function shouldDouble(word: string): boolean {
  if (!/[^aeiou][aeiou][^aeiouwx]$/i.test(word)) return false;
  return (word.match(/[aeiou]+/gi) || []).length === 1;
}

function inflectVerb(word: string, suffix: Suffix): string {
  if (suffix === 'base') return word;
  const irr = IRREG_VERBS[word];
  if (irr) return irr[suffix];
  if (suffix === 'past') {
    if (word.endsWith('e')) return word + 'd';
    if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ied';
    if (shouldDouble(word)) return word + word.slice(-1) + 'ed';
    return word + 'ed';
  }
  if (suffix === 'third') {
    if (/(s|x|z|ch|sh|o)$/i.test(word)) return word + 'es';
    if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';
    return word + 's';
  }
  if (/[^aeiou]ie$/i.test(word)) return word.slice(0, -2) + 'ying'; // die -> dying
  if (word.endsWith('e') && !/(ee|ye|oe)$/i.test(word)) return word.slice(0, -1) + 'ing';
  if (shouldDouble(word)) return word + word.slice(-1) + 'ing';
  return word + 'ing';
}

// Verbs whose past tense looks exactly like the base ("hit", "cut", "put"):
// "He hit the sack" must become "He went to bed", not "He go to bed".
// When the head is ambiguous we peek at the preceding word — a singular
// third-person subject ("he/she/it") means the base form cannot be present
// tense ("he hits" would have matched the -s form instead).
const SAME_FORM_PAST = new Set([
  'hit', 'cut', 'put', 'set', 'shut', 'split', 'spread', 'hurt', 'cost',
  'burst', 'quit', 'thrust',
]);

// "He kicked the bucket" -> "He died" (not "He die"): when the source used an
// inflected head, carry the tense onto a leading verb in the replacement.
// Meanings are stored base-form at build time ("Working late" -> "work late"),
// so a base-form source also normalizes ("They burn..." -> "They work late").
function agreeTense(hit: string, baseHead: string, fix: string, before: string): string {
  if (!baseHead) return fix;
  const sp = hit.search(/\s/);
  const matchedHead = sp === -1 ? hit : hit.slice(0, sp);
  let suffix: Suffix = detectSuffix(matchedHead, baseHead) ?? 'base';
  if (suffix === 'base' && SAME_FORM_PAST.has(baseHead.toLowerCase())) {
    const prev = before.match(/([A-Za-z]+)[^A-Za-z]*$/)?.[1]?.toLowerCase();
    if (prev === 'he' || prev === 'she' || prev === 'it' || prev === 'this' || prev === 'that') {
      suffix = 'past';
    }
  }
  const w = fix.match(/^[A-Za-z]+/);
  if (!w || !COMMON_VERBS.has(w[0].toLowerCase())) return fix;
  const inflected = inflectVerb(w[0].toLowerCase(), suffix);
  const capped = /^[A-Z]/.test(w[0]) ? inflected[0].toUpperCase() + inflected.slice(1) : inflected;
  return capped + fix.slice(w[0].length);
}
let idiomRe: RegExp | null = null;
function getIdiomRe(): RegExp {
  if (!idiomRe) {
    const alts = IDIOM_PATTERNS.map((p, i) => `(?<p${i}>${p})`).join('|');
    idiomRe = new RegExp(`(?<!\\w)(?:${alts})(?!\\w)`, 'gi');
  }
  return idiomRe;
}

function applyIdiomList(text: string): string {
  const re = getIdiomRe();
  re.lastIndex = 0;
  return text.replace(re, (...args: unknown[]) => {
    const groups = args[args.length - 1] as Record<string, string | undefined>;
    const offset = args[args.length - 3] as number;
    for (let i = 0; i < IDIOM_REPLACEMENTS.length; i++) {
      const hit = groups[`p${i}`];
      if (hit !== undefined) {
        let fix = IDIOM_REPLACEMENTS[i];
        fix = agreeTense(hit, IDIOM_HEAD_BASE[i], fix, text.slice(0, offset));
        // Match the sentence case of the original: lowercase the replacement
        // when the idiom appeared mid-sentence in lowercase.
        if (/^[a-z]/.test(hit) && /^[A-Z]/.test(fix)) {
          fix = fix[0].toLowerCase() + fix.slice(1);
        }
        return fix;
      }
    }
    return args[0] as string; // unreachable, but stay safe
  });
}

export function paraphraseForMT(text: string): string {
  let out = text;
  for (const [re, fix] of PRE_EDITS) {
    re.lastIndex = 0;
    out = out.replace(re, fix);
  }
  return applyIdiomList(out);
}
