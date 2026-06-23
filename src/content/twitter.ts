import { renderTranslationAfter } from './engine';
import { SELECTORS, queryFirst } from './selectors';
import { isProcessed, markProcessed } from '../utils/dom';
import { isAlreadyTargetLang } from '../core/segmentation';
import { Settings } from '../core/types';

// X / Twitter. A tweet's text lives in one [data-testid="tweetText"], but the
// line breaks inside it can be <br> elements (often nested) OR '\n' inside text
// nodes. We walk the WHOLE subtree and split it into PARAGRAPHS (a blank line
// separates them; a single break is a soft wrap that stays in one paragraph),
// then insert each paragraph's translation right after it. Translating a whole
// paragraph keeps context (a sentence soft-wrapped across two lines is sent as
// one); the endpoint still returns per-sentence pairs, so sentence-level
// "original / Chinese" interleaving is preserved. The original stays intact.
//
// "Only-Chinese" view can't CSS-hide the interleaved original (text nodes aren't
// selectable), so it's handled with a scoped zh-view rule in bilingual.css that
// collapses the tweet's own text while keeping our .ibt-block lines visible.
//
// Articles (X long-form): title + rich-text body live OUTSIDE tweetText, so they
// get a separate prose pass scoped to the article reader / primary column.

const SPLIT = 'data-ibt-split';
// X Articles render paragraphs as <div> (not <p>), so we include div and rely on
// innermost-leaf + skip filtering. Skips cover UI chrome, links, the engagement
// bar, timestamps, comments (tweetText) and our own output.
const ARTICLE_LEAF = 'h1,h2,h3,h4,p,li,blockquote,div';
// NOTE: skip only TRULY editable areas. X Articles render in a read-only Draft.js
// editor with contenteditable="false" — a bare [contenteditable] selector would
// (wrongly) match that and skip the whole article body.
const ARTICLE_SKIP = 'script,style,noscript,nav,aside,header,button,textarea,a,time,[role="group"],[contenteditable="true"],[data-testid="tweetText"],.ibt-block';

interface Line { anchor: Node; text: string }

function isIbt(n: Node): boolean {
  return n.nodeType === 1 && (((n as Element).className as any)?.toString?.() || '').startsWith('ibt-');
}

// The tweet's ORIGINAL text only (excludes our inserted blocks). Used as a change
// signature: when a long tweet is expanded via "Show more", X re-renders it with
// more text → the length changes → we re-translate the now-full tweet.
function origText(tt: HTMLElement): string {
  let s = '';
  const tw = document.createTreeWalker(tt, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(n) {
      if (n.nodeType === 1) return isIbt(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let c: Node | null;
  while ((c = tw.nextNode())) s += c.nodeValue || '';
  return s.replace(/\s+/g, ' ').trim();
}

// Drop the translation blocks we previously inserted for this tweet (inside it
// and the trailing sibling), plus our markers, before re-translating.
function clearTweetBlocks(tt: HTMLElement): void {
  tt.querySelectorAll('.ibt-block').forEach((b) => b.remove());
  let sib = tt.nextElementSibling;
  while (sib && sib.classList.contains('ibt-block')) {
    const next = sib.nextElementSibling;
    sib.remove();
    sib = next;
  }
  tt.classList.remove('ibt-orig-src');
  tt.querySelectorAll('.ibt-orig-src').forEach((e) => e.classList.remove('ibt-orig-src'));
}

// Split a tweet into PARAGRAPHS (not single lines), so each block keeps its
// context when sent to translate. A single break (one <br> or one '\n') is a
// SOFT wrap → same paragraph; a blank line (<br><br>, '\n\n', or a mix of
// consecutive breaks) is a paragraph boundary. Each returned Line is one whole
// paragraph; the Google endpoint still returns per-sentence [zh, src] pairs, so
// fillPairs keeps sentence-level interleaving WITHIN the paragraph.
function splitParagraphs(tt: HTMLElement): Line[] {
  // Phase 1: build the sequence of PHYSICAL lines (same break logic as before),
  // but KEEP empty lines — they're what marks a paragraph boundary. Each line
  // records the anchor of its terminating break: the <br>, the text node ending
  // in '\n', or tt for the trailing line.
  interface Phys { text: string; anchor: Node }
  const phys: Phys[] = [];
  let buf = '';
  const pushLine = (anchor: Node) => {
    phys.push({ text: buf.replace(/\s+/g, ' ').trim(), anchor });
    buf = '';
  };

  // Snapshot text nodes + <br> in document order (we'll split text nodes after).
  const items: Node[] = [];
  const tw = document.createTreeWalker(tt, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(n) {
      if (n.nodeType === 1) {
        if (isIbt(n)) return NodeFilter.FILTER_REJECT;            // skip our own nodes
        return n.nodeName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;                            // text node
    },
  });
  let c: Node | null;
  while ((c = tw.nextNode())) items.push(c);

  for (const node of items) {
    if (node.nodeName === 'BR') { pushLine(node); continue; }
    let tn = node as Text;
    let val = tn.nodeValue || '';
    let nl = val.indexOf('\n');
    while (nl !== -1) {
      buf += val.slice(0, nl);
      const rest = tn.splitText(nl + 1);   // tn now ends with the '\n'
      pushLine(tn);
      tn = rest; val = rest.nodeValue || ''; nl = val.indexOf('\n');
    }
    buf += val;
  }
  pushLine(tt); // trailing physical line → maps to after the whole tweet text

  // Phase 2: coalesce runs of non-empty physical lines into one paragraph; a
  // blank line flushes the current paragraph. The paragraph's anchor is its
  // LAST non-empty line's anchor → its translation lands after the paragraph's
  // last line of text, before the blank line. Consecutive blanks collapse into
  // one boundary (an empty pbuf flush is a no-op), so no empty paragraphs.
  const out: Line[] = [];
  let pbuf: string[] = [];
  let panchor: Node | null = null;
  const flushPara = () => {
    if (pbuf.length && panchor) {
      const text = pbuf.join(' ').replace(/\s+/g, ' ').trim();
      if (text) out.push({ anchor: panchor, text });
    }
    pbuf = [];
    panchor = null;
  };
  for (const p of phys) {
    if (p.text) { pbuf.push(p.text); panchor = p.anchor; }
    else flushPara();
  }
  flushPara();
  return out;
}

export function scanTwitter(s: Settings): void {
  if (!s.enabled || !s.sites.x) return;

  // 1) Tweets / replies / quotes — interleave a translation after each line.
  for (const node of queryFirst(SELECTORS.x.text)) {
    const tt = node as HTMLElement;
    // Signature = length of the tweet's ORIGINAL text. When a long tweet is
    // expanded via "Show more", X re-renders it with more text → signature
    // changes → we drop the stale blocks and re-translate the now-full tweet.
    const sig = String(origText(tt).length);
    if (tt.getAttribute(SPLIT) === sig) continue;
    clearTweetBlocks(tt);
    tt.setAttribute(SPLIT, sig);
    try {
      const lines = splitParagraphs(tt);
      if (lines.length <= 1) {
        const text = tt.innerText?.trim() ?? '';
        if (text && !isAlreadyTargetLang(text, s.targetLangCode)) renderTranslationAfter(tt, text);
      } else {
        for (const ln of lines) {
          if (isAlreadyTargetLang(ln.text, s.targetLangCode)) continue; // already Chinese → skip
          renderTranslationAfter(ln.anchor, ln.text);
        }
      }
    } catch {
      // never let a DOM quirk break the page; leave this tweet untranslated
    }
  }

  // 2) X Articles (long-form) — title + body live OUTSIDE tweetText.
  const scope = findArticleScope();
  if (scope) {
    const leaves = collectArticleLeaves(scope);
    // Only act on a REAL article: needs a couple of substantial prose blocks.
    // Guards against translating UI on ordinary pages (X has nav <h1>s too).
    const substantial = leaves.filter((e) => (e.innerText || '').trim().length >= 40);
    if (substantial.length >= 2) {
      for (const leaf of leaves) {
        const text = leaf.innerText?.trim() ?? '';
        if (!text || isAlreadyTargetLang(text, s.targetLangCode)) continue; // skip empty / already-Chinese
        markProcessed(leaf);
        renderTranslationAfter(leaf, text);
      }
    }
  }

  // 3) Profile bios.
  for (const node of queryFirst(SELECTORS.x.bio)) {
    const b = node as HTMLElement;
    if (isProcessed(b)) continue;
    const text = b.innerText?.trim() ?? '';
    if (!text || isAlreadyTargetLang(text, s.targetLangCode)) continue; // skip empty / already-Chinese
    markProcessed(b);
    renderTranslationAfter(b, text);
  }
}

// Find the X Article content region, if this page is one. We don't rely on a
// specific (and unstable) testid: an Article shows a big <h1> title that normal
// tweets never have, so we locate that title and scope to the <article> it sits
// in. Explicit reader testids are tried first as a fast path.
function findArticleScope(): HTMLElement | null {
  const reader = queryFirst(SELECTORS.x.article)[0] as HTMLElement | undefined;
  if (reader) return reader;
  const col = (queryFirst(SELECTORS.x.primaryColumn)[0] as HTMLElement) || document.body;
  // A real article title is long; X's nav/page <h1>s ("Post", "Home") are short.
  const h1 = Array.from(col.querySelectorAll<HTMLElement>('h1')).find(
    (h) => !h.closest('[data-testid="tweetText"]') && !h.closest('.ibt-block') && (h.innerText || '').trim().length >= 12,
  );
  // Require the title to live inside an <article> (the post container). If not,
  // skip rather than risk scanning page chrome.
  return h1 ? (h1.closest('article') as HTMLElement | null) : null;
}

// Innermost prose blocks within an article region (title + paragraphs + bullets),
// skipping tweets and UI chrome. De-dupes nesting like the universal scanner.
function collectArticleLeaves(root: HTMLElement): HTMLElement[] {
  const matches = Array.from(root.querySelectorAll<HTMLElement>(ARTICLE_LEAF));
  // STRUCTURAL leaves: contain no other matched element. Computed against ALL
  // matches (including already-processed paragraphs and our own inserted divs),
  // so once a paragraph is processed we don't "climb" to its now-childless
  // ancestor and re-translate it — that was an infinite tree-walking loop.
  const leaves = matches.filter((c) => !matches.some((o) => o !== c && c.contains(o)));
  return leaves.filter((e) => {
    if (isProcessed(e) || e.closest(ARTICLE_SKIP)) return false;
    const t = e.innerText?.trim() ?? '';
    return !!t && t.length >= 2;
  });
}
