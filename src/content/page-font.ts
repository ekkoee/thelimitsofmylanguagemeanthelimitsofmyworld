// Page-translation size. Video subtitles do not use this.
//
// The Chinese line uses the source element's own computed font-size. A short
// reply is often one line tall; scaling that down (the old "dense row" 85%)
// made it smaller than the multi-line post next to it. Headings keep the
// heading's size and are never drawn smaller than the surrounding body.

const GH_TITLE = '.js-issue-title, .gh-header-title, .markdown-title, .commit-title';

function weightOf(el: HTMLElement): number {
  const w = getComputedStyle(el).fontWeight;
  const n = Number(w);
  if (n) return n;
  if (w === 'bold') return 700;
  return 400;
}

/** A non-heading sibling, else the parent's own size. 0 if nothing is readable. */
export function nearbyBodyPx(el: HTMLElement): number {
  const root = el.parentElement;
  if (!root) return 0;
  for (const sib of Array.from(root.children)) {
    if (sib === el || !(sib instanceof HTMLElement)) continue;
    if (sib.classList.contains('ibt-block')) continue;
    if (/^H[1-6]$/.test(sib.tagName) || sib.getAttribute('role') === 'heading') continue;
    if (weightOf(sib) >= 600) continue;
    const px = parseFloat(getComputedStyle(sib).fontSize) || 0;
    if (px >= 8) return px;
  }
  return parseFloat(getComputedStyle(root).fontSize) || 0;
}

/** h1–h6, role=heading, or bold text that is larger than the surrounding body. */
export function isHeadingElement(el: HTMLElement): boolean {
  if (/^H[1-6]$/.test(el.tagName)) return true;
  if ((el.getAttribute('role') || '') === 'heading') return true;
  if (weightOf(el) < 600) return false;
  const own = parseFloat(getComputedStyle(el).fontSize) || 0;
  const body = nearbyBodyPx(el);
  return body > 0 && own > body + 0.4;
}

/** Pixel size for the translation of `el`. Exact source size, except a heading
 *  that computed smaller than the body is raised to the body size. */
export function pageFontPx(el: HTMLElement): number {
  const own = parseFloat(getComputedStyle(el).fontSize) || 16;
  if (!isHeadingElement(el)) return own;
  const body = nearbyBodyPx(el);
  return body > 0 ? Math.max(own, body) : own;
}

/** GitHub list-row titles only. A one-line Threads reply is not a row title. */
export function isRowFit(el: HTMLElement, host: string): boolean {
  if (!/(^|\.)github\.com$/i.test(host)) return false;
  return el.matches(`a, ${GH_TITLE}`) || !!el.closest(GH_TITLE);
}
