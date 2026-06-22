import { renderTranslationAfter } from './engine';
import { SELECTORS, queryFirst } from './selectors';
import { isProcessed, markProcessed } from '../utils/dom';
import { Settings } from '../core/types';

// X / Twitter.
// Tweets: insert ONE bilingual block right after the whole tweet-text element.
// We deliberately do NOT mutate the tweet's own DOM (no splitting text nodes),
// so links / @mentions / media stay intact AND the 3-state view can cleanly hide
// the original — `[data-testid="tweetText"]` is a real element (text nodes are
// not CSS-hideable, which is why per-line interleaving couldn't do "Chinese-only").
//
// Articles (X long-form): title + rich-text body live OUTSIDE tweetText, so they
// get a separate prose pass scoped to the article reader / primary column.

const DONE = 'data-ibt-split';
const ARTICLE_LEAF = 'h1,h2,h3,h4,p,li,blockquote';
// Never collect prose inside these during the Article pass.
const ARTICLE_SKIP = 'script,style,noscript,nav,aside,button,textarea,[contenteditable],[data-testid="tweetText"],.ibt-block';

export function scanTwitter(s: Settings): void {
  if (!s.enabled || !s.sites.x) return;

  // 1) Tweets / replies / quotes — one block after the tweet text.
  for (const node of queryFirst(SELECTORS.x.text)) {
    const tt = node as HTMLElement;
    if (tt.getAttribute(DONE) === '1') continue;
    tt.setAttribute(DONE, '1');
    const text = tt.innerText?.trim() ?? '';
    if (text) renderTranslationAfter(tt, text);
  }

  // 2) X Articles — only when a long-form reader is actually present.
  if (queryFirst(SELECTORS.x.article).length) {
    const col = (queryFirst(SELECTORS.x.primaryColumn)[0] as HTMLElement)
      || (queryFirst(SELECTORS.x.article)[0] as HTMLElement);
    for (const leaf of collectArticleLeaves(col)) {
      markProcessed(leaf);
      const text = leaf.innerText?.trim() ?? '';
      if (text) renderTranslationAfter(leaf, text);
    }
  }

  // 3) Profile bios.
  for (const node of queryFirst(SELECTORS.x.bio)) {
    const b = node as HTMLElement;
    if (isProcessed(b)) continue;
    markProcessed(b);
    const text = b.innerText?.trim() ?? '';
    if (text) renderTranslationAfter(b, text);
  }
}

// Innermost prose blocks within an article region (title + paragraphs + bullets),
// skipping tweets and UI chrome. De-dupes nesting like the universal scanner.
function collectArticleLeaves(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(ARTICLE_LEAF)).filter((e) => {
    if (isProcessed(e) || e.closest(ARTICLE_SKIP)) return false;
    const t = e.innerText?.trim() ?? '';
    return !!t && t.length >= 2;
  });
  // keep only leaves (drop any block that contains another candidate)
  return all.filter((c) => !all.some((o) => o !== c && c.contains(o)));
}
