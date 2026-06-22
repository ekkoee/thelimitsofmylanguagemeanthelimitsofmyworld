import { renderTranslationAfter } from './engine';
import { SELECTORS, queryFirst } from './selectors';
import { isProcessed, markProcessed } from '../utils/dom';
import { Settings } from '../core/types';

// X / Twitter. A tweet's text lives in one [data-testid="tweetText"], but the
// line breaks inside it can be <br> elements (often nested) OR '\n' inside text
// nodes. We walk the WHOLE subtree, split at every break, and insert each
// line's translation right after it → true "English line / Chinese line"
// interleaving, like Immersive Translate. The original stays intact.

const SPLIT = 'data-ibt-split';

interface Line { anchor: Node; text: string }

function isIbt(n: Node): boolean {
  return n.nodeType === 1 && (((n as Element).className as any)?.toString?.() || '').startsWith('ibt-');
}

function splitLines(tt: HTMLElement): Line[] {
  const out: Line[] = [];
  let buf = '';
  const flush = (anchor: Node | null) => {
    const t = buf.replace(/\s+/g, ' ').trim();
    if (t && anchor) out.push({ anchor, text: t });
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
    if (node.nodeName === 'BR') { flush(node); continue; }
    let tn = node as Text;
    let val = tn.nodeValue || '';
    let nl = val.indexOf('\n');
    while (nl !== -1) {
      buf += val.slice(0, nl);
      const rest = tn.splitText(nl + 1);   // tn now ends with the '\n'
      flush(tn);
      tn = rest; val = rest.nodeValue || ''; nl = val.indexOf('\n');
    }
    buf += val;
  }
  flush(tt); // trailing line → insert after the whole tweet text
  return out;
}

export function scanTwitter(s: Settings): void {
  if (!s.enabled || !s.sites.x) return;

  for (const node of queryFirst(SELECTORS.x.text)) {
    const tt = node as HTMLElement;
    if (tt.getAttribute(SPLIT) === '1') continue;
    tt.setAttribute(SPLIT, '1');
    try {
      const lines = splitLines(tt);
      if (lines.length <= 1) {
        const text = tt.innerText?.trim() ?? '';
        if (text) renderTranslationAfter(tt, text);
      } else {
        for (const ln of lines) renderTranslationAfter(ln.anchor, ln.text);
      }
    } catch {
      // never let a DOM quirk break the page; leave this tweet untranslated
    }
  }

  for (const node of queryFirst(SELECTORS.x.bio)) {
    const b = node as HTMLElement;
    if (isProcessed(b)) continue;
    markProcessed(b);
    const text = b.innerText?.trim() ?? '';
    if (text) renderTranslationAfter(b, text);
  }
}
