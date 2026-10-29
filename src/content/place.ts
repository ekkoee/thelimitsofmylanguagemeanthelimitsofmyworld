// Put a translation block where the reader expects it, and keep it there.
//
// Host pages style every `div` (flex tracks, grid cells, absolute captions,
// height/position !important). Our old code inserted a sibling once and hoped
// `.ibt-uni` would win — but that class was wiped when the translation arrived,
// and Alt+A on non-auto sites never injected bilingual.css at all. Inline
// !important locks beat host stylesheets; a shadow root stops rules like
// `div div { float:left; width:30% }` from reshaping the translated lines;
// captions are glued to the source box and follow scroll, resize, and fullscreen.

import { choosePlacement, LayoutSnap, reserveSpace } from './layout';

const PLAYER_SEL = [
  '.html5-video-player', '.plyr', '.video-js', '.jwplayer', '.shaka-video-container',
  '.ytp-caption-window-container', '[class*="plyr"]', '[class*="vjs-text-track"]',
].join(',');

const SHADOW_CSS = `
:host { color: inherit; }
.ibt-body {
  display: block;
  font-size: inherit;
  line-height: 1.5;
  font-weight: inherit;
  white-space: pre-wrap;
  letter-spacing: normal;
  word-spacing: normal;
  text-transform: none;
  text-indent: 0;
  writing-mode: horizontal-tb;
  text-orientation: mixed;
  direction: ltr;
  unicode-bidi: isolate;
}
:host(.ibt-pass) .ibt-body { pointer-events: none; }
:host-context([data-ibt-style="blur"]) .ibt-body { pointer-events: auto; }
.ibt-trans {
  color: var(--ibt-trans-color, #7188f5);
  font-family: "Microsoft JhengHei", "PingFang TC", "Noto Sans CJK TC", "Source Han Sans TC", "Segoe UI", sans-serif;
}
:host-context([data-ibt-lang="zh-CN"]) .ibt-trans {
  font-family: "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Segoe UI", sans-serif;
}
.ibt-loading-dot { font-size: 0.85em; opacity: 0.7; }
.ibt-error-msg { font-size: 0.85em; opacity: 0.85; }
.ibt-retry {
  margin-left: 8px; font-size: 0.8em; padding: 1px 8px; cursor: pointer;
  pointer-events: auto;
  border-radius: 6px; border: 1px solid currentColor; background: transparent; color: inherit;
}
:host-context([data-ibt-style="underline"]) .ibt-trans { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
:host-context([data-ibt-style="dashed"]) .ibt-trans { text-decoration: underline dashed; text-underline-offset: 3px; }
:host-context([data-ibt-style="dotted"]) .ibt-trans { text-decoration: underline dotted; text-decoration-thickness: 2px; text-underline-offset: 3px; }
:host-context([data-ibt-style="wavy"]) .ibt-trans { text-decoration: underline wavy; text-decoration-color: rgba(108,122,255,0.9); text-underline-offset: 3px; }
:host-context([data-ibt-style="solidBox"]) .ibt-trans { border: 1px solid currentColor; border-radius: 4px; padding: 0 5px; }
:host-context([data-ibt-style="dashedBox"]) .ibt-trans { border: 1px dashed currentColor; border-radius: 4px; padding: 0 5px; }
:host-context([data-ibt-style="highlight"]) .ibt-trans { background: rgba(255, 214, 10, 0.30); border-radius: 3px; padding: 0 3px; }
:host-context([data-ibt-style="dim"]) .ibt-trans { opacity: 0.6; }
:host-context([data-ibt-style="italic"]) .ibt-trans { font-style: italic; }
:host-context([data-ibt-style="bold"]) .ibt-trans { font-weight: 700; }
:host-context([data-ibt-style="blur"]) .ibt-trans { filter: blur(5px); transition: filter 0.12s ease; cursor: help; }
:host-context([data-ibt-style="blur"]) .ibt-trans:hover { filter: none; }
`;

function setImp(el: HTMLElement, prop: string, value: string): void {
  el.style.setProperty(prop, value, 'important');
}

/** Shadow body that holds the actual translation. Light DOM stays a single
 *  hidden span so `div:empty { display:none }` on the host page can't hide us. */
export function shadowBody(block: HTMLElement): HTMLElement {
  let root = block.shadowRoot;
  if (!root) {
    root = block.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    const body = document.createElement('div');
    body.className = 'ibt-body';
    root.append(style, body);
  }
  if (!block.querySelector(':scope > .ibt-keep')) {
    const keep = document.createElement('span');
    keep.className = 'ibt-keep';
    keep.hidden = true;
    block.appendChild(keep);
  }
  return root.querySelector('.ibt-body') as HTMLElement;
}

/** Beat host `div { position/width/height !important }` for in-flow blocks. */
export function lockFlow(block: HTMLElement): void {
  const props: [string, string][] = [
    ['display', 'block'],
    ['position', 'static'],
    ['float', 'none'],
    ['clear', 'both'],
    ['width', '100%'],
    ['max-width', '100%'],
    ['min-width', '0'],
    ['height', 'auto'],
    ['max-height', 'none'],
    ['box-sizing', 'border-box'],
    ['transform', 'none'],
    ['inset', 'auto'],
    ['margin-left', '0'],
    ['margin-right', '0'],
    ['top', 'auto'],
    ['right', 'auto'],
    ['bottom', 'auto'],
    ['left', 'auto'],
    ['overflow', 'visible'],
    ['line-height', '1.5'],
    ['white-space', 'pre-wrap'],
    ['flex', '0 0 auto'],
    ['align-self', 'stretch'],
    ['justify-self', 'stretch'],
    ['grid-column', '1 / -1'],
    ['z-index', 'auto'],
  ];
  for (const [k, v] of props) setImp(block, k, v);
  if (!block.style.getPropertyValue('font-size')) {
    setImp(block, 'font-size', 'calc(0.98rem * var(--ibt-font-scale, 1))');
  }
}

function readSnap(el: HTMLElement): LayoutSnap {
  const cs = getComputedStyle(el);
  const parent = el.parentElement;
  const pcs = parent ? getComputedStyle(parent) : null;
  const clamp = cs.getPropertyValue('-webkit-line-clamp').trim();
  return {
    anchorIsElement: true,
    caption: looksLikeCaption(el, cs.position),
    clamped: !!clamp && clamp !== 'none' && clamp !== '0',
    parentDisplay: pcs?.display || 'block',
    parentFlexDirection: pcs?.flexDirection || 'row',
    parentFlexWrap: pcs?.flexWrap || 'nowrap',
    selfDisplay: cs.display,
    selfFlexDirection: cs.flexDirection || 'row',
    selfFlexWrap: cs.flexWrap || 'nowrap',
  };
}

function looksLikeCaption(el: HTMLElement, position: string): boolean {
  if (position !== 'absolute' && position !== 'fixed') return false;
  const idClass = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`;
  if (/caption|subtitle|vjs-text-track|plyr__captions/i.test(idClass)) return true;
  if (el.closest(PLAYER_SEL)) return true;
  return overlapsVideo(el);
}

function overlapsVideo(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8 || r.height > 180) return false;
  const parent = el.parentElement;
  if (!parent) return false;
  const videos = parent.querySelectorAll('video');
  for (let i = 0; i < videos.length && i < 6; i++) {
    const vr = videos[i].getBoundingClientRect();
    if (vr.width < 40 || vr.height < 40) continue;
    const x = Math.min(r.right, vr.right) - Math.max(r.left, vr.left);
    const y = Math.min(r.bottom, vr.bottom) - Math.max(r.top, vr.top);
    if (x > 8 && y > 8) return true;
  }
  return false;
}

function insertSibling(anchor: Node, block: HTMLElement): void {
  if (anchor.parentNode) anchor.parentNode.insertBefore(block, anchor.nextSibling);
}

interface AnchorRec {
  block: HTMLElement;
  target: HTMLElement;
  reserve: boolean;
}

const anchors = new Map<HTMLElement, AnchorRec>();
let raf = 0;

function overlayParent(target: HTMLElement): HTMLElement {
  const fs = document.fullscreenElement as HTMLElement | null;
  if (fs && (fs === target || fs.contains(target))) return fs;
  return document.documentElement;
}

function restoreReserve(rec: AnchorRec): void {
  if (!rec.reserve) return;
  const prev = rec.target.dataset.ibtMbPrev ?? '';
  rec.target.style.removeProperty('margin-bottom');
  if (prev) rec.target.style.marginBottom = prev;
  delete rec.target.dataset.ibtMbPrev;
  delete rec.target.dataset.ibtMb;
  delete rec.target.dataset.ibtMbOrigin;
}

function syncReserve(target: HTMLElement, extra: number): void {
  if (extra < 8) return;
  // Remember the margin from before we touched it. Computed margin is read
  // once, before our own inline value would be included in it.
  if (target.dataset.ibtMbOrigin === undefined) {
    target.dataset.ibtMbPrev = target.style.marginBottom || '';
    target.dataset.ibtMbOrigin = String(parseFloat(getComputedStyle(target).marginBottom) || 0);
  }
  const next = Math.round(parseFloat(target.dataset.ibtMbOrigin) + extra);
  if (target.dataset.ibtMb === String(next)) return;
  target.dataset.ibtMb = String(next);
  setImp(target, 'margin-bottom', `${next}px`);
}

function tick(): void {
  raf = 0;
  for (const [block, rec] of anchors) {
    if (!rec.target.isConnected || !block.isConnected) {
      restoreReserve(rec);
      anchors.delete(block);
      if (!rec.target.isConnected) block.remove();
      continue;
    }
    const parent = overlayParent(rec.target);
    if (block.parentElement !== parent) parent.appendChild(block);
    const r = rec.target.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) {
      setImp(block, 'visibility', 'hidden');
      continue;
    }
    block.style.removeProperty('visibility');
    const width = Math.round(Math.min(Math.max(r.width, 160), Math.max(160, window.innerWidth - 16)));
    let left = r.left + r.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    const h = block.offsetHeight || 24;
    let top = r.bottom + 2;
    if (top + h > window.innerHeight - 8 && r.top - h - 2 > 8) top = r.top - h - 2;
    setImp(block, 'left', `${Math.round(left)}px`);
    setImp(block, 'top', `${Math.round(top)}px`);
    setImp(block, 'width', `${width}px`);
    if (rec.reserve) syncReserve(rec.target, h + 6);
  }
  if (anchors.size) raf = requestAnimationFrame(tick);
}

function schedule(): void {
  if (!raf && anchors.size) raf = requestAnimationFrame(tick);
}

/** Run one positioning pass now. Tests use this; the page loop is rAF. */
export function flushAnchors(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  tick();
}

function anchorOverlay(block: HTMLElement, target: HTMLElement, reserve: boolean): void {
  const fs = parseFloat(getComputedStyle(target).fontSize) || 0;
  if (fs >= 10) setImp(block, 'font-size', `calc(${fs}px * var(--ibt-font-scale, 1))`);
  else setImp(block, 'font-size', 'calc(0.98rem * var(--ibt-font-scale, 1))');
  setImp(block, 'line-height', '1.5');
  setImp(block, 'position', 'fixed');
  setImp(block, 'margin', '0');
  setImp(block, 'float', 'none');
  setImp(block, 'flex', 'none');
  setImp(block, 'height', 'auto');
  setImp(block, 'max-height', 'none');
  setImp(block, 'right', 'auto');
  setImp(block, 'bottom', 'auto');
  setImp(block, 'transform', 'none');
  setImp(block, 'box-sizing', 'border-box');
  setImp(block, 'z-index', '2147483000');
  // Captions pass clicks through to the player. In-flow overlays stay selectable.
  block.classList.toggle('ibt-pass', !reserve);
  setImp(block, 'pointer-events', reserve ? 'auto' : 'none');
  anchors.set(block, { block, target, reserve });
  const parent = overlayParent(target);
  parent.appendChild(block);
  schedule();
}

/** Drop a fixed overlay and any margin we added under its source. */
export function unanchor(block: HTMLElement): void {
  const rec = anchors.get(block);
  if (!rec) return;
  restoreReserve(rec);
  anchors.delete(block);
}

/** Block we already placed for this source: inside it, just after it, or a fixed overlay. */
export function findPlacedBlock(node: HTMLElement): HTMLElement | null {
  const inside = node.querySelector(':scope > .ibt-block[data-ibt-out="1"]') as HTMLElement | null;
  if (inside) return inside;
  let sib = node.nextElementSibling as HTMLElement | null;
  for (let hops = 0; sib && hops < 4; hops++) {
    if (sib.classList.contains('ibt-block') && sib.dataset.ibtOut === '1') return sib;
    sib = sib.nextElementSibling as HTMLElement | null;
  }
  for (const rec of anchors.values()) {
    if (rec.target === node && rec.block.isConnected) return rec.block;
  }
  return null;
}

/**
 * `adaptive` (Alt+A on arbitrary pages) picks inside / overlay / sibling.
 * X and Reddit pass adaptive=false and keep the historical "next sibling" spot,
 * still with the inline lock and shadow root so host CSS can't restyle them.
 */
export function placeBlock(anchor: Node, block: HTMLElement, adaptive: boolean): void {
  shadowBody(block);
  if (!adaptive || anchor.nodeType !== 1) {
    insertSibling(anchor, block);
    lockFlow(block);
    return;
  }
  const el = anchor as HTMLElement;
  const snap = readSnap(el);
  const placement = choosePlacement(snap);
  if (placement === 'inside') {
    el.appendChild(block);
    lockFlow(block);
    return;
  }
  if (placement === 'overlay') {
    anchorOverlay(block, el, reserveSpace(snap));
    return;
  }
  insertSibling(anchor, block);
  lockFlow(block);
}
