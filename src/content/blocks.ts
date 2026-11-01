import { hasTranslatableText, isAlreadyTargetLang } from '../core/segmentation';
import { isLinkedInCommentaryControl } from './linkedin';
import { X_PLAYER_SELECTOR, matchSiteRule } from './selectors';

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

// Click targets and form chrome. A wrapper div around <button>Debug</button> is not
// itself a button, so callers must walk ancestors — otherwise the wrapper's
// textContent is "Debug" and we insert a translation beside the control.
const CONTROL_SEL = [
  'button', 'summary', 'label', 'time', 'kbd',
  'input', 'textarea', 'select',
  '[role="button"]', '[role="tab"]', '[role="switch"]', '[role="checkbox"]',
  '[role="menuitem"]', '[role="option"]', '[role="menu"]', '[role="menubar"]',
  '[role="tablist"]', '[role="tooltip"]', '[role="search"]',
  '[translate="no"]', '.notranslate',
].join(',');

// Landmarks. A README that actually lives in the article is allowed through
// even when a landmark wraps the page.
const CHROME_SEL = [
  'header', 'footer', 'nav', 'aside',
  '[role="banner"]', '[role="navigation"]', '[role="contentinfo"]', '[role="complementary"]',
  '[role="toolbar"]',
  '[data-testid="User-Name"]',
].join(',');

// Where real writing lives. Short strings here (an issue title, a one-line
// comment) are still content. The same string in a toolbar is a label.
const PROSE_HOME_SEL = [
  'article',
  '.markdown-body', '.prose', '.mw-parser-output',
  '.js-issue-title', '.gh-header-title', '.markdown-title',
  '.comment-body', '.js-comment-body', '.review-comment',
  '.commit-title', '.commit-desc', '.commit-message',
  '[itemprop="description"]',
  '.update-components-text', '.feed-shared-update-v2__description',
  '.feed-shared-inline-show-more-text',
  '[data-test-id="main-feed-activity-card__commentary"]',
  '.attributed-text-segment-list__content',
].join(',');

const HIDDEN_SEL = [
  '[hidden]',
  '.sr-only', '.visually-hidden', '.visuallyHidden',
  '.screen-reader-text', '.screenreader', '.screen-reader-only',
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
    // inline-block / inline-flex still form their own box (a PR title link).
    // Only a true inline phrasing element is transparent.
    else if (d === 'inline' && PHRASING.has(el.tagName)) kind = 'inline';
    else kind = 'block';
    const s = { kind, visible: cs.visibility !== 'hidden' && cs.visibility !== 'collapse' };
    scache.set(el, s);
    return s;
  };
  const display = (el: Element): DisplayKind => styleOf(el).kind;

  // An element actually paints a box. 1×1 clip-rect "sr-only" nodes used to pass
  // (width >= 1) and we translated screen-reader shortcut hints in the header.
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
    if (HARD_SKIP.has(el.tagName)) {
      // LinkedIn sometimes wraps the whole commentary in the see-more button.
      // A short toggle stays skipped; the long post body does not.
      if (el.tagName === 'BUTTON' && isLinkedInCommentaryControl(el as HTMLElement)) return false;
      return true;
    }
    if (el.isContentEditable) return true;
    if (el.classList.contains('ibt-block') || el.dataset.ibtOut === '1') return true; // our own output
    // Threads marks the visible feed aria-hidden. A painted box is still on screen.
    if (el.getAttribute('aria-hidden') === 'true' && !paintedBox(el)) return true;
    // Video-player overlay (source chip, captions, controls). Never a post body.
    if (el.closest(X_PLAYER_SELECTOR)) return true;
    return false;
  };

  // Does `el` contain a BLOCK descendant that holds visible text? If so, `el` is a
  // container and we descend; otherwise it is a leaf block (a unit boundary).
  // innerText already aggregates nested text, so for a block child we only need to
  // read it; transparent boxes (inline / display:contents) are recursed past.
  const hasChildBlockWithText = (el: Element): boolean => {
    for (const ch of Array.from(el.children)) {
      if (skip(ch)) continue;
      // An inline chrome widget (Facebook「顯示較少」, Threads「翻譯」, a 1/3 counter)
      // is often a div, so it looks like a child block. The sentence in the
      // sibling span would then never become a unit. The widget is not a block.
      if (isInlinePostChrome(ch) || isEmbeddedChip(ch, el)) continue;
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
      // a person can see, so "Debug" inside a button is not a paragraph.
      const text = visibleText(el as HTMLElement);
      if (text && rendered(el) && passesGate(el as HTMLElement, text)) units.push({ element: el as HTMLElement, text });
    }
  };

  visit(root);
  const lang = typeof document === 'undefined'
    ? 'zh-TW'
    : (document.documentElement.getAttribute('data-ibt-target') || 'zh-TW');
  // A leaf can hold several lines separated by <br>. Drop it only when every
  // line is already the target language, so one English line in a Chinese post
  // is still translated and the Chinese lines are not.
  return units.filter((unit) => payloadForUnit(unit.element, unit.text, lang) !== null);
}

// Lines inside one leaf, split the same way LinkedIn splits a commentary:
// a <br> or a blank line starts a new line; a single soft wrap does not.
function breakSeparatedLines(el: HTMLElement): string[] {
  const lines: string[] = [];
  let buf = '';
  const flush = () => {
    const text = buf.replace(/\s+/g, ' ').trim();
    buf = '';
    if (text) lines.push(text);
  };
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(n) {
      if (n.nodeType === 1) {
        const e = n as HTMLElement;
        if (e.classList?.contains('ibt-block') || e.dataset?.ibtOut === '1') return NodeFilter.FILTER_REJECT;
        return e.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Node | null;
  while ((node = tw.nextNode())) {
    if (node.nodeName === 'BR') {
      flush();
      continue;
    }
    const raw = node.nodeValue || '';
    const parts = raw.split(/\n\s*\n/);
    for (let i = 0; i < parts.length; i++) {
      buf += parts[i];
      if (i < parts.length - 1) flush();
    }
  }
  flush();
  return lines;
}

/** What to send for this leaf. null: every line is already in the target language.
 *  A single run keeps `joined` so sentence splitting is unchanged. A mixed
 *  <br> post sends only the lines that are not already the target language. */
export function payloadForUnit(el: HTMLElement, joined: string, lang: string): string | null {
  const lines = breakSeparatedLines(el);
  if (lines.length <= 1) return isAlreadyTargetLang(joined, lang) ? null : joined;
  const foreign = lines.filter((line) => hasTranslatableText(line) && !isAlreadyTargetLang(line, lang));
  if (!foreign.length) return null;
  if (foreign.length === lines.length) return joined;
  return foreign.join('\n');
}

// Fraction of an element's text that sits inside links.
function linkDensity(el: HTMLElement): number {
  const total = (el.textContent || '').replace(/\s+/g, ' ').trim().length || 1;
  let linked = 0;
  el.querySelectorAll('a').forEach((a) => { linked += ((a as HTMLElement).textContent || '').replace(/\s+/g, ' ').trim().length; });
  return linked / total;
}

function wordCount(t: string): number {
  return t.split(/\s+/).filter(Boolean).length;
}

/** Under about three words and not a sentence. Button labels, not paragraphs. */
export function isShortLabel(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  const sentence = /[.!?]["'”’)\]]*$/.test(t) || /[。！？]$/.test(t);
  const words = wordCount(t);
  // "Good morning, ekkoee!" is a greeting, not a paragraph. A 4-word sentence is.
  if (sentence) return words <= 3 && t.length < 32;
  if (words <= 3) return true;
  return words <= 4 && t.length < 22;
}

/** Keyboard-shortcut hints ("g then d", "g 然後 d") are chrome, not prose. */
export function isShortcutHint(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length > 90) return false;
  return (/\bthen\b/i.test(t) || t.includes('然後')) && /\b[a-zA-Z]\b/.test(t);
}

function classBlob(el: Element): string {
  return typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : '';
}

/** On screen and large enough to read. aria-hidden alone is not enough: Threads
 *  puts aria-hidden on #scrollview while the feed is the thing you are looking at. */
function paintedBox(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.visibility === 'collapse' || cs.display === 'none') return false;
  if (Number(cs.opacity) === 0) return false;
  const r = el.getBoundingClientRect();
  return r.width >= 8 && r.height >= 8 && r.bottom > 0 && r.right > 0;
}

/** Screen-reader-only, clipped, or zero-size. Not "scrolled off screen". */
export function isHiddenFromView(el: HTMLElement): boolean {
  if (el.closest(HIDDEN_SEL)) return true;
  if (el.getAttribute('aria-hidden') === 'true' && !paintedBox(el)) return true;
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

const SEE_MORE_LESS = /^(?:[…⋯.]{1,3}\s*)?(?:see\s*more|see\s*less|show\s*more|show\s*less|more|less|更多|更少|查看更多|查看較少|顯示更多|顯示較少|顯示更少|繼續閱讀|收合|收起)$/i;

/**
 * A widget painted inside the post body: see-more, Threads' own「翻譯」, or a
 * carousel counter like 1/3. The whole element is that widget, not a sentence
 * that merely mentions the word.
 */
export function isInlinePostChrome(el: Element): boolean {
  if (isSeeMoreLessControl(el)) return true;
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 24) return false;
  const compact = text.replace(/\s+/g, '');
  if (/^\d+\/\d+$/.test(compact)) return true;
  return /^(?:翻譯|翻译|translate|see\s*translation|view\s*translation|顯示原文|查看翻譯|see\s*original)$/i.test(text);
}

/** Inline "see more / 顯示較少" control. Not the paragraph that contains it. */
export function isSeeMoreLessControl(el: Element): boolean {
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 32) return false;
  const compact = text.replace(/\s+/g, '');
  if (!SEE_MORE_LESS.test(text) && !SEE_MORE_LESS.test(compact)) return false;
  const role = el.getAttribute('role') || '';
  if (el.tagName === 'BUTTON' || role === 'button') return true;
  const cls = classBlob(el);
  return /see[_-]?more|see[_-]?less/i.test(`${cls} ${el.getAttribute('aria-label') || ''}`);
}

function visibleText(el: HTMLElement): string {
  let s = '';
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n === el) return NodeFilter.FILTER_SKIP;
      if (n.nodeType === 1) {
        const e = n as HTMLElement;
        if (HARD_SKIP.has(e.tagName)) return NodeFilter.FILTER_REJECT;
        if (isInlinePostChrome(e)) return NodeFilter.FILTER_REJECT;
        if (e.getAttribute('aria-hidden') === 'true' && !paintedBox(e)) return NodeFilter.FILTER_REJECT;
        // A control inside the block is chrome. When the block itself is that
        // control (LinkedIn's commentary button), its own text is the post.
        // Threads stamps translate="no" on the @mention span. That is the
        // handle, not a button — rejecting it deleted @name from the source.
        const control = e.closest(CONTROL_SEL);
        if (control && control !== el && !isMentionChipText(control.textContent || '')) return NodeFilter.FILTER_REJECT;
        if (e.classList.contains('ibt-block') || e.dataset.ibtOut === '1') return NodeFilter.FILTER_REJECT;
        if (e.closest(HIDDEN_SEL) || /\b(sr-only|visually-hidden)\b/i.test(classBlob(e))) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let c: Node | null;
  while ((c = tw.nextNode())) {
    const v = c.nodeValue || '';
    // React splits the handle into "@" + comment + "name". A space there
    // would ship "@ name". Every other boundary still gets a space.
    const glueMention = /[@#]$/.test(s) && /^[\w.]/.test(v);
    if (!glueMention) s += ' ';
    s += v;
  }
  return stripTrailingWidgets(s);
}

/** The whole string is one @name or #tag. Not a sentence that contains one. */
function isMentionChipText(text: string): boolean {
  const t = text.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, '');
  return t.length > 1 && t.length <= 50 && /^[@#][\w.]+$/.test(t);
}

const WIDGET_TAIL = /(?:\s|^)(?:[…⋯]|\.{3})?\s*(?:see more|see less|show more|show less|查看更多|查看較少|顯示更多|顯示較少|顯示更少|翻譯|翻译|translate|\d+\s*\/\s*\d+)\s*$/i;

function stripTrailingWidgets(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4 && WIDGET_TAIL.test(t); i++) t = t.replace(WIDGET_TAIL, '').trim();
  return t;
}

/** A mention or other short link inside a longer sentence. Not a title link that is the whole line. */
function isEmbeddedChip(el: Element, parent: Element): boolean {
  const child = (el.textContent || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  const all = (parent.textContent || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  if (!child) return false;
  // Threads paints @name as div.inline-block > span[display:contents] > div > a.
  // A div is a block even when its display is inline-block, so the sentence
  // stopped being a leaf and the words around the mention were never a unit.
  // A link that is the whole line (a GitHub title, a username) is not this:
  // the parent must still have words outside the handle.
  if (isMentionChipText(child)) {
    const rest = all.replace(child, ' ').replace(/\s+/g, ' ').trim();
    return rest.length >= 2 && /\p{L}/u.test(rest);
  }
  const role = el.getAttribute('role') || '';
  if (el.tagName !== 'A' && role !== 'link' && el.tagName !== 'SPAN') return false;
  if (child.length > 40) return false;
  if (all.length < child.length + 8) return false;
  return /^[@#]/.test(child) || el.tagName === 'A' || role === 'link';
}

export function threadsHostName(host: string): boolean {
  return /(^|\.)threads\.(com|net)$/i.test(host);
}

/** Real words left after mentions, URLs, emoji, and numbers. Not a bare chip. */
export function isThreadsReplyText(text: string): boolean {
  let t = text.replace(/\s+/g, ' ').trim();
  t = t.replace(/https?:\/\/\S+/gi, ' ').replace(/[@#]\w+/g, ' ');
  t = t.replace(/\p{Extended_Pictographic}/gu, ' ').replace(/[\uFE0F\u200D]/g, ' ');
  t = t.replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim();
  return /[A-Za-z]{2,}/.test(t);
}

function pageHost(): string {
  // file:// fixtures set this so a local mock can exercise the Threads rules.
  try {
    if (location.protocol === 'file:') {
      const hooked = document.documentElement?.getAttribute('data-ibt-host');
      if (hooked) return hooked;
    }
  } catch { /* no document yet */ }
  return location.hostname;
}

function threadsReply(el: HTMLElement, text: string): boolean {
  if (!threadsHostName(pageHost()) || !isThreadsReplyText(text)) return false;
  if (el.closest('header, nav, [role="navigation"], [role="banner"]')) return false;
  const link = el.closest('a, [role="link"]');
  if (link) {
    const lt = (link.textContent || '').replace(/\s+/g, ' ').trim();
    if (lt === text.trim()) return false;
  }
  return true;
}

function isContentHeading(el: HTMLElement, text: string): boolean {
  if (!/^H[1-6]$/.test(el.tagName) || text.trim().length < 2) return false;
  return !!el.closest(PROSE_HOME_SEL);
}

function isContentParagraph(el: HTMLElement): boolean {
  if (!/^(P|LI|BLOCKQUOTE|FIGCAPTION)$/.test(el.tagName)) return false;
  return !!el.closest(PROSE_HOME_SEL);
}

function siteAllows(el: HTMLElement): boolean {
  const rule = matchSiteRule(location.hostname);
  if (!rule?.include) return false;
  try { return el.matches(rule.include) || !!el.closest(rule.include); } catch { return false; }
}

// Keep real prose. Drop labels, controls, landmarks, and hidden a11y text.
// A short string is skipped rather than drawn as its own block — that block is
// what pushed Debug / Agent / Create issue apart and turned shortcut hints visible.
function passesGate(el: HTMLElement, text: string): boolean {
  const t = text.trim();
  if (!hasTranslatableText(t)) return false;
  if (el.closest(CONTROL_SEL) && !isLinkedInCommentaryControl(el)) return false;
  if (isHiddenFromView(el)) return false;
  if (isShortcutHint(t)) return false;
  const allowed = siteAllows(el);
  const heading = isContentHeading(el, t);
  const paragraph = isContentParagraph(el);
  const social = threadsReply(el, t);
  if (isShortLabel(t) && !heading && !paragraph && !allowed && !social) {
    // A PR/issue title is often only a few words and is still the row's content.
    const titleLink = !!el.closest('a') && !el.closest(CHROME_SEL) && t.length >= 12 && wordCount(t) >= 3;
    if (!titleLink) return false;
  }
  if (/^H[1-6]$/.test(el.tagName) && !heading && wordCount(t) < 8 && t.length < 60) return false;
  const inChrome = !!el.closest(CHROME_SEL) && !el.closest(PROSE_HOME_SEL) && !allowed;
  if (inChrome && t.length < 80) return false;
  if (el.closest('a,[role="link"]') && !el.closest(PROSE_HOME_SEL) && !allowed && !social) {
    const title = t.length >= 12 && wordCount(t) >= 3 && !el.closest(CHROME_SEL);
    if (!title && (isShortLabel(t) || t.length < 20)) return false;
  }
  // Toolbar leftovers ("Auto Optimized for: Balance") are several short labels
  // glued together. Outside a content block they are still chrome.
  const title = !!el.closest('a') && !el.closest(CHROME_SEL) && t.length >= 12 && wordCount(t) >= 3;
  if (!el.closest(PROSE_HOME_SEL) && !allowed && !heading && !paragraph && !title && !social) {
    if (wordCount(t) < 8 && t.length < 80 && !/[.!?。！？]/.test(t)) return false;
  }
  const density = linkDensity(el);
  if (density > 0.85 && t.length < 80 && !allowed && !social) return false;
  return true;
}
