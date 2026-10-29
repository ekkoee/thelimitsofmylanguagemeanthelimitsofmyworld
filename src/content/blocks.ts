import { hasTranslatableText } from '../core/segmentation';

// Generic, layout-aware block detection for the "translate any page" engine.
//
// The old universal scanner matched a FIXED tag whitelist (p,li,h1..h6,blockquote,…)
// and excluded div/span. That misses prose on modern SPA sites — Facebook and
// Mastodon/Truth Social render post bodies inside <div dir="auto"> / <span>, so the
// whitelist found nothing (or translated stray UI chrome instead).
//
// Instead we classify EVERY element by its computed `display` (block vs inline, the
// same signal the browser uses) and pick the LOWEST block element that directly
// holds text — the "leaf block". That is one translation unit. This is the approach
// Mozilla Readability / kiss-translator use, and it works without a per-site rule on
// most sites. A relevance gate then drops UI chrome (author names, Follow/Like
// buttons, nav, timestamps) so we translate the post body, not the furniture.
//
// KNOWN GAP: a "mixed" container — a block that holds BOTH a child block with text
// AND its own loose inline/text run — translates the child block but skips the loose
// run (it has no element anchor our dedup can key on). That needs text-node "run"
// anchors (a later phase). The old tag-whitelist engine missed such structures
// entirely, so this is a residual gap, not a regression.

export interface Unit {
  /** Source block whose translation we insert right after. */
  element: HTMLElement;
  /** Its visible text. */
  text: string;
}

// Canonical inline (phrasing) tags. We treat an element as inline ONLY when its
// computed display is inline AND it is phrasing — so a <span>/<a> that CSS has turned
// into display:block is correctly treated as a block boundary, not folded into a run.
const PHRASING = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'DFN', 'EM', 'I',
  'IMG', 'KBD', 'LABEL', 'MARK', 'Q', 'RUBY', 'RT', 'RP', 'S', 'SAMP', 'SMALL',
  'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR', 'FONT', 'OUTPUT',
]);

// Subtrees we never read or translate (code, controls, media, editors, our output).
const HARD_SKIP = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'SELECT', 'OPTION', 'SVG', 'CANVAS',
  'IFRAME', 'INPUT', 'CODE', 'PRE', 'KBD', 'SAMP', 'VIDEO', 'AUDIO', 'OBJECT',
  'EMBED', 'MATH', 'BUTTON',
]);

// Click targets. A wrapper div around <button>Watch</button> is NOT a button,
// so the tag check has to walk ancestors — otherwise the wrapper's textContent
// is "Watch" and we insert a block beside the button.
const CONTROL_SEL = [
  'button', 'summary', 'label', 'time',
  '[role="button"]', '[role="tab"]', '[role="switch"]', '[role="checkbox"]',
  '[role="menuitem"]', '[role="option"]', '[role="menu"]', '[role="menubar"]',
  '[role="toolbar"]', '[role="tablist"]', '[role="tooltip"]',
  '[translate="no"]', '.notranslate',
].join(',');

// Page furniture. Prose that actually lives in the article (a README, a post)
// is allowed through even if a landmark wraps the whole page.
const CHROME_SEL = [
  'header', 'footer', 'nav', 'aside',
  '[role="banner"]', '[role="navigation"]', '[role="contentinfo"]', '[role="complementary"]',
  '[data-testid="User-Name"]',
].join(',');

const PROSE_HOME_SEL = 'article, main, [role="main"], .markdown-body, .prose, .mw-parser-output';

const HIDDEN_SEL = [
  '[hidden]', '[aria-hidden="true"]',
  '.sr-only', '.visually-hidden', '.visuallyHidden', '.screen-reader-text', '.screenreader',
].join(',');

type DisplayKind = 'block' | 'inline' | 'none' | 'contents';

/**
 * Find the lowest block-level elements that directly hold readable text — the
 * translation "units" — at/under `root` (the root itself IS considered, so a single
 * leaf element can be passed when only its subtree changed). Computed-display based,
 * so it works on sites that render prose inside <div dir="auto"> / <span>.
 */
export function collectUnits(root: HTMLElement): Unit[] {
  const units: Unit[] = [];
  // Per-scan caches: getComputedStyle and innerText are the expensive calls; cache
  // them so a subtree is styled/read once. Scoped to this scan (Maps GC'd on return)
  // so a node that toggles display/text between scans isn't stuck stale.
  const scache = new Map<Element, { kind: DisplayKind; visible: boolean }>();
  const itext = new Map<Element, string>();

  const styleOf = (el: Element): { kind: DisplayKind; visible: boolean } => {
    const hit = scache.get(el);
    if (hit) return hit;
    const cs = getComputedStyle(el);
    const d = cs.display;
    let kind: DisplayKind;
    if (d === 'none') kind = 'none';
    else if (d === 'contents') kind = 'contents';
    else if (d.startsWith('inline')) kind = PHRASING.has(el.tagName) ? 'inline' : 'block';
    else kind = 'block';
    const s = { kind, visible: cs.visibility !== 'hidden' && cs.visibility !== 'collapse' };
    scache.set(el, s);
    return s;
  };
  const display = (el: Element): DisplayKind => styleOf(el).kind;

  // An element actually paints a box. 1×1 clip-rect "sr-only" nodes used to pass
  // (width >= 1) and we translated screen-reader text in the header.
  const rendered = (el: Element): boolean => {
    if (!styleOf(el).visible) return false;
    if (isHiddenFromView(el as HTMLElement)) return false;
    const rects = (el as HTMLElement).getClientRects();
    return rects.length > 0 && rects[0].width >= 8 && rects[0].height >= 8;
  };

  // innerText forces a layout per call — on heavy pages (BBC, news sites) that
  // turns the first scan into seconds of silence while the user thinks Alt+A is
  // broken. textContent is layout-free; visibility was already verified via
  // getComputedStyle/getClientRects above, and <br> → space is fine for MT.
  const textOf = (el: Element): string => {
    let t = itext.get(el);
    if (t === undefined) {
      t = ((el as HTMLElement).textContent || '').replace(/\s+/g, ' ').trim();
      itext.set(el, t);
    }
    return t;
  };

  const skip = (el: Element): boolean => {
    if (!(el instanceof HTMLElement)) return true;          // SVG / MathML / foreign
    if (HARD_SKIP.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    if (el.classList.contains('ibt-block') || el.dataset.ibtOut === '1') return true; // our own output
    if (el.getAttribute('aria-hidden') === 'true') return true;
    return false;
  };

  // Does `el` contain a BLOCK descendant that holds visible text? If so, `el` is a
  // container and we descend; otherwise it is a leaf block (a unit boundary).
  // innerText already aggregates nested text, so for a block child we only need to
  // read it; transparent boxes (inline / display:contents) are recursed past.
  const hasChildBlockWithText = (el: Element): boolean => {
    for (const ch of Array.from(el.children)) {
      if (skip(ch)) continue;
      const dk = display(ch);
      if (dk === 'none') continue;
      if (dk === 'block') {
        if (textOf(ch)) return true;
      } else if (hasChildBlockWithText(ch)) {
        return true;
      }
    }
    return false;
  };

  // Evaluate `el` itself, then recurse as needed. Passing the root here (not just its
  // children) lets a single changed leaf be re-collected on an incremental rescan.
  const visit = (el: Element): void => {
    if (skip(el)) return;
    const dk = display(el);
    if (dk === 'none') return;
    if (dk === 'contents' || dk === 'inline') {
      for (const ch of Array.from(el.children)) visit(ch);
      return;
    }
    // el is a block
    if (hasChildBlockWithText(el)) {
      for (const ch of Array.from(el.children)) visit(ch);     // container → go deeper
    } else {
      // textContent includes buttons and sr-only descendants. Read only the text
      // a person can see, so a "Watch / Fork / Star" toolbar is not a paragraph.
      const text = visibleText(el as HTMLElement);
      if (text && rendered(el) && passesGate(el as HTMLElement, text)) units.push({ element: el as HTMLElement, text });
    }
  };

  visit(root);
  return units;
}

// Fraction of an element's text that sits inside links.
function linkDensity(el: HTMLElement): number {
  const total = (el.textContent || '').replace(/\s+/g, ' ').trim().length || 1;
  let linked = 0;
  el.querySelectorAll('a').forEach((a) => { linked += ((a as HTMLElement).textContent || '').replace(/\s+/g, ' ').trim().length; });
  return linked / total;
}

/** Prose, not a button label. Exported for tests. */
export function looksLikeProse(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!hasTranslatableText(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  const han = (t.match(/\p{Script=Han}/gu) || []).length;
  const kana = (t.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
  const hangul = (t.match(/\p{Script=Hangul}/gu) || []).length;
  if (han + kana + hangul >= 12) return true;
  if (han + kana + hangul >= 6 && t.length >= 24) return true;
  if (t.length >= 80) return true;
  if (words.length >= 8 && t.length >= 40) return true;
  if (/[.!?]["'”’)\]]*$/.test(t) && words.length >= 8 && t.length >= 48) return true;
  return false;
}

function classBlob(el: Element): string {
  return typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : '';
}

/** Screen-reader-only, clipped, or zero-size. Not "scrolled off screen". */
export function isHiddenFromView(el: HTMLElement): boolean {
  if (el.closest(HIDDEN_SEL)) return true;
  if (/\b(sr-only|visually-hidden|visuallyHidden|screen-reader|screenreader)\b/i.test(classBlob(el))) return true;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.visibility === 'collapse' || cs.display === 'none') return true;
  if (Number(cs.opacity) === 0) return true;
  if ((parseFloat(cs.fontSize) || 0) < 2) return true;
  if ((cs.position === 'absolute' || cs.position === 'fixed') && /rect\(\s*0/i.test(cs.clip || '')) return true;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return true;
  if (r.left < -2000 || r.top < -2000) return true;
  return false;
}

function visibleText(el: HTMLElement): string {
  let s = '';
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n === el) return NodeFilter.FILTER_SKIP;
      if (n.nodeType === 1) {
        const e = n as HTMLElement;
        if (HARD_SKIP.has(e.tagName) || e.closest(CONTROL_SEL)) return NodeFilter.FILTER_REJECT;
        if (e.closest(HIDDEN_SEL) || /\b(sr-only|visually-hidden)\b/i.test(classBlob(e))) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let c: Node | null;
  while ((c = tw.nextNode())) s += c.nodeValue || '';
  return s.replace(/\s+/g, ' ').trim();
}

function isOneLine(el: HTMLElement): boolean {
  const fs = parseFloat(getComputedStyle(el).fontSize) || 16;
  const h = el.getBoundingClientRect().height;
  return h > 0 && h < fs * 2.3;
}

function isContentHeading(el: HTMLElement, text: string): boolean {
  if (!/^H[1-3]$/.test(el.tagName) || text.trim().length < 16) return false;
  return !!el.closest(PROSE_HOME_SEL);
}

// Keep real prose. Drop labels, controls, landmarks, and hidden a11y text.
// A short string is skipped rather than drawn as its own bordered block —
// that block is what pushed Watch / Fork / Star apart on GitHub.
function passesGate(el: HTMLElement, text: string): boolean {
  const t = text.trim();
  if (el.closest(CONTROL_SEL)) return false;
  if (isHiddenFromView(el)) return false;
  const prose = looksLikeProse(t) || isContentHeading(el, t);
  if (!prose) return false;
  const inChrome = !!el.closest(CHROME_SEL) && !el.closest(PROSE_HOME_SEL);
  if (inChrome) {
    const fs = parseFloat(getComputedStyle(el).fontSize) || 16;
    const tall = el.getBoundingClientRect().height >= fs * 2.3;
    if (!(tall && t.length >= 80)) return false;
  }
  if (isOneLine(el)) {
    const structural = /^(P|LI|BLOCKQUOTE|H1|H2|H3|FIGCAPTION)$/.test(el.tagName);
    const inBody = !!el.closest(PROSE_HOME_SEL);
    if (!(structural && inBody)) return false;
  }
  if (t.length < 80 && el.closest('a,[role="link"]') && !el.closest(PROSE_HOME_SEL)) return false;
  const density = linkDensity(el);
  if (density > 0.85 && t.length < 120) return false;
  return true;
}
