// Where an image translation goes.
// Below: the image is in normal flow and its box can grow, so a block under
// the image does not clip or cover a neighbour.
// Overlay: a tile, a fixed-height card, or anything taken out of flow. The
// translation sits on the image and does not change sibling positions.

export type ImageMode = 'below' | 'overlay';

export interface ImageDecision {
  mode: ImageMode;
  reason: string;
}

function classBlob(el: Element): string {
  const cls = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : '';
  return `${cls} ${el.getAttribute('data-testid') || ''} ${el.getAttribute('role') || ''}`;
}

function clipsOrFixed(el: HTMLElement, cs: CSSStyleDeclaration): boolean {
  // Computed height is always a used pixel length, even for height:auto.
  // Only an inline fixed height, a max-height, or clipping means the box cannot grow.
  if (/hidden|clip/.test(`${cs.overflow} ${cs.overflowY}`)) return true;
  if (cs.maxHeight !== 'none' && parseFloat(cs.maxHeight) > 0) return true;
  const inlineH = el.style?.height || '';
  return /px|%|vh|vw/.test(inlineH);
}

/** Decide from layout, not from the site name. `x-media` is only a fast path for X's photo tile. */
export function imageDecision(img: HTMLElement): ImageDecision {
  if (img.closest('[data-testid="tweetPhoto"], [data-testid="videoPlayer"]')) {
    return { mode: 'overlay', reason: 'x-media' };
  }
  let el: HTMLElement | null = img;
  for (let depth = 0; el && el !== document.body && depth < 12; depth++, el = el.parentElement) {
    const cs = getComputedStyle(el);
    const blob = classBlob(el);
    if (/carousel|swiper|lightbox/i.test(blob) || el.getAttribute('aria-modal') === 'true' || el.getAttribute('role') === 'dialog') {
      return { mode: 'overlay', reason: 'carousel-or-dialog' };
    }
    if (depth > 0 && (cs.position === 'absolute' || cs.position === 'fixed' || cs.position === 'sticky')) {
      return { mode: 'overlay', reason: 'absolute-container' };
    }
    if (depth === 0) continue;
    if (!clipsOrFixed(el, cs)) continue;
    const box = el.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    const roomBelow = box.bottom - ir.bottom;
    if (ir.height > 40 && roomBelow < 36 && ir.height > box.height * 0.62) {
      return { mode: 'overlay', reason: 'fixed-or-clipped-box' };
    }
  }
  return { mode: 'below', reason: 'normal-flow' };
}

/** Element the below-block is inserted after. Skips inline wrappers such as picture. */
export function belowAnchor(img: HTMLElement): HTMLElement {
  let node: HTMLElement = img;
  while (node.parentElement && node.parentElement !== document.body) {
    const parent = node.parentElement;
    const cs = getComputedStyle(parent);
    const inlineWrap = /^(P|A|SPAN|H[1-6]|PICTURE)$/.test(parent.tagName)
      || cs.display === 'inline'
      || cs.display === 'contents';
    if (!inlineWrap) break;
    node = parent;
  }
  return node;
}

/**
 * Right-click on tweet text, an avatar, or an emoji must not start image
 * translation. A real photo tile is large and is not inside the text node.
 */
export function shouldSkipImageTarget(info: { width: number; height: number; inTweetText: boolean; inTweetPhoto: boolean }): boolean {
  if (info.inTweetPhoto && info.width >= 80 && info.height >= 80) return false;
  if (info.inTweetText) return true;
  if (info.width < 80 || info.height < 80) return true;
  return false;
}

/** Positioned box the overlay is attached to, so it scrolls with the image. */
export function overlayHost(img: HTMLElement): HTMLElement {
  let el: HTMLElement | null = img.parentElement;
  while (el && el !== document.body) {
    const pos = getComputedStyle(el).position;
    if (pos === 'relative' || pos === 'absolute' || pos === 'fixed' || pos === 'sticky') return el;
    el = el.parentElement;
  }
  const parent = img.parentElement || img;
  if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
  return parent;
}
