import { renderTranslationAfter } from './engine';
import { protectFlow } from './x-chips';
import { SELECTORS, insideXVideo, queryFirst } from './selectors';
import { isProcessed, markProcessed } from '../utils/dom';
import { hasTranslatableText, isAlreadyTargetLang } from '../core/segmentation';
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

// We split X's own text nodes at line breaks so a translation can sit under each line. X is a React
// app and keeps a reference to the ORIGINAL text node. When it later rewrites that node (a long post
// growing from its truncated preview to the full text, an edit, ...) React writes the whole new text
// into the first fragment and the fragments we split off are left behind after it, so the tail of the
// tweet shows up twice, joined by a single line break. Remember the fragments we created and drop them
// as soon as the page touches the node they were split from.
interface SplitRec { tt: HTMLElement; node: Text; created: Text[]; value: string }
type SplitHost = HTMLElement & { __ibtSplits?: SplitRec[] };
type SplitText = Text & { __ibtRec?: SplitRec };

function healSplits(tt: HTMLElement): void {
  const host = tt as SplitHost;
  const recs = host.__ibtSplits;
  if (!recs || !recs.length) return;
  host.__ibtSplits = recs.filter((r) => {
    if (r.node.isConnected && r.node.nodeValue === r.value) return true;
    for (const n of r.created) n.remove();
    (r.node as SplitText).__ibtRec = undefined;
    return false;
  });
}

let splitWatcher: MutationObserver | null = null;
function ensureSplitWatcher(): void {
  if (splitWatcher || !document.body) return;
  splitWatcher = new MutationObserver((muts) => {
    for (const m of muts) {
      const rec = (m.target as SplitText).__ibtRec;
      if (rec && rec.node === m.target && m.target.nodeValue !== rec.value) healSplits(rec.tt);
    }
  });
  splitWatcher.observe(document.body, { characterData: true, subtree: true });
}

// Viewport gating for X: observe the tweetText element (anchors can be Text/BR nodes,
// which IntersectionObserver cannot observe) and run its translation jobs on first sight.
type JobbedElement = HTMLElement & { __ibtJobs?: (() => void)[] };
const xIO = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    xIO.unobserve(e.target);
    const el = e.target as JobbedElement;
    const jobs = el.__ibtJobs;
    el.__ibtJobs = undefined;
    if (jobs) for (const j of jobs) j();
  }
}, { rootMargin: '500px 0px 1000px 0px' });

function deferX(tt: HTMLElement, s: Settings, job: () => void): void {
  if (!s.translateOnVisible) {
    job();
    return;
  }
  const el = tt as JobbedElement;
  (el.__ibtJobs ??= []).push(job);
  xIO.observe(tt);
}

export function scanTwitter(s: Settings): void {
  if (!s.enabled || !s.sites.x) return;
  ensureSplitWatcher();

  // 1) Tweets / replies / quotes — interleave a translation after each line.
  for (const node of queryFirst(SELECTORS.x.text)) {
    const tt = node as HTMLElement;
    if (insideXVideo(tt)) continue;
    healSplits(tt);
    // A Chinese tweet is left COMPLETELY alone — judged as a whole tweet, not per
    // paragraph, so its FTX.com / kyc / @mentions are never "translated", and its
    // text nodes are never even split. (Simplified tweets aren't converted either.)
    if (isAlreadyTargetLang(origText(tt), s.targetLangCode)) continue;
    // Signature = length of the tweet's ORIGINAL text. When a long tweet is
    // expanded via "Show more", X re-renders it with more text → signature
    // changes → we drop the stale blocks and re-translate the now-full tweet.
    const sig = String(origText(tt).length);
    if (tt.getAttribute(SPLIT) === sig) continue;
    clearTweetBlocks(tt);
    (tt as JobbedElement).__ibtJobs = [];
    tt.setAttribute(SPLIT, sig);
    try {
      // One flowing paragraph. @ # and URLs are tokens here, restored as the
      // original anchors after translation. Soft wraps are spaces, not lines.
      const flow = protectFlow(tt);
      const prose = flow.text.replace(/⟦\d+⟧/g, ' ');
      if (!hasTranslatableText(prose) && !flow.chips.length) continue;
      if (isAlreadyTargetLang(prose, s.targetLangCode) && !flow.chips.length) continue;
      deferX(tt, s, () => renderTranslationAfter(tt, flow.text, { chips: flow.chips }));
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
    if (insideXVideo(b) || isProcessed(b)) continue;
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
    if (isProcessed(e) || insideXVideo(e) || e.closest(ARTICLE_SKIP)) return false;
    const t = e.innerText?.trim() ?? '';
    return !!t && t.length >= 2;
  });
}
