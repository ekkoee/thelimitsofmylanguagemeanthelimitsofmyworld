import { DEFAULT_TRANS_COLOR } from '../core/types';

export const NS = 'ibt'; // injected-node class/attribute namespace

export const PROCESSED_ATTR = 'data-ibt-done';

export function isProcessed(el: Element): boolean {
  return el.getAttribute(PROCESSED_ATTR) === '1';
}
export function markProcessed(el: Element): void {
  el.setAttribute(PROCESSED_ATTR, '1');
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// --- 3-state display view (Alt+A cycles; popup mirrors). Pure CSS, no re-translate.
//  both → original + Chinese   |   orig → original only   |   zh → Chinese only
export type ViewMode = 'both' | 'zh' | 'orig';
const VIEW_ATTR = 'data-ibt-view';
const VIEW_NEXT: Record<ViewMode, ViewMode> = { both: 'orig', orig: 'zh', zh: 'both' };
export const VIEW_LABEL: Record<ViewMode, string> = {
  both: '原文 + 中文', orig: '只顯示原文', zh: '只顯示中文',
};

export function getView(): ViewMode {
  const v = document.documentElement.getAttribute(VIEW_ATTR);
  return v === 'zh' || v === 'orig' ? v : 'both';
}
export function setView(v: ViewMode): void {
  document.documentElement.setAttribute(VIEW_ATTR, v);
}
/** Advance to the next view in the cycle and return it. */
export function cycleView(): ViewMode {
  const next = VIEW_NEXT[getView()];
  setView(next);
  return next;
}

let rootApplied = false;
/** Mirror visual settings onto <html> so CSS handles all toggles without re-translation. */
function parseBg(bg: string): { r: number; g: number; b: number; a: number } | null {
  const m = bg.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] == null ? 1 : Number(m[4]) };
}

/** Walk up until a painted background shows whether the page is dark. */
export function darkSurface(el: Element): boolean {
  let node: Element | null = el.parentElement;
  while (node) {
    const parsed = parseBg(getComputedStyle(node).backgroundColor || '');
    if (parsed && parsed.a > 0.45) {
      const y = 0.2126 * parsed.r + 0.7152 * parsed.g + 0.0722 * parsed.b;
      return y < 150;
    }
    node = node.parentElement;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function refreshTransSurfaces(): void {
  document.querySelectorAll('.ibt-trans').forEach((el) => {
    if (el instanceof HTMLElement) el.setAttribute('data-ibt-on', darkSurface(el) ? 'dark' : 'light');
  });
}

/** Tag each translation once, including ones inserted later. */
function tagTrans(el: Element): void {
  if (el instanceof HTMLElement && el.classList.contains('ibt-trans')) {
    el.setAttribute('data-ibt-on', darkSurface(el) ? 'dark' : 'light');
  }
  if (el instanceof HTMLElement) el.querySelectorAll('.ibt-trans').forEach(tagTrans);
}

export function watchTransSurfaces(): void {
  const w = window as unknown as { __ibtSurface?: boolean };
  if (w.__ibtSurface) return;
  w.__ibtSurface = true;
  refreshTransSurfaces();
  new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach((node) => { if (node instanceof Element) tagTrans(node); });
  }).observe(document.documentElement, { childList: true, subtree: true });
}

export function applyRootState(s: {
  enabled: boolean; showOriginal: boolean; layout: string; fontScale: number;
  targetLangCode?: string; transStyle?: string; transColor?: string;
  barStyle?: string; barColor?: string;
  transHighlight?: boolean; highlightColor?: string;
  viewMode?: string;
}): void {
  const r = document.documentElement;
  // An explicit choice (chrome.storage) wins. With no choice, pages and YouTube
  // stay bilingual — but only fill the attribute when it is missing, so a live
  // Alt+A cycle is not overwritten before the save comes back.
  const chosen = s.viewMode === 'zh' || s.viewMode === 'both' || s.viewMode === 'orig' ? s.viewMode : '';
  if (chosen) r.setAttribute(VIEW_ATTR, chosen);
  else if (!r.hasAttribute(VIEW_ATTR)) r.setAttribute(VIEW_ATTR, 'both');
  r.setAttribute('data-ibt-enabled', String(s.enabled));
  r.setAttribute('data-ibt-show-original', String(s.showOriginal));
  r.setAttribute('data-ibt-layout', s.layout);
  r.style.setProperty('--ibt-font-scale', String(s.fontScale));
  // lang on each translation node. The face itself is --ibt-zh-font for both.
  r.setAttribute('data-ibt-lang', s.targetLangCode === 'zh-CN' ? 'zh-CN' : 'zh-TW');
  // translated-text visual style
  r.setAttribute('data-ibt-style', s.transStyle || 'plain');
  // Empty means the translation inherits the page text. A saved hex is deliberate.
  if (s.transColor && s.transColor.toLowerCase() !== DEFAULT_TRANS_COLOR) {
    r.setAttribute('data-ibt-custom-color', 'on');
    r.style.setProperty('--ibt-trans-color', s.transColor);
    r.style.setProperty('--ibt-sub-color', s.transColor);
  } else {
    r.removeAttribute('data-ibt-custom-color');
    r.style.removeProperty('--ibt-trans-color');
    r.style.removeProperty('--ibt-sub-color');
  }
  const bar = s.barStyle === 'bar' || s.barStyle === 'thick' || s.barStyle === 'dashed' || s.barStyle === 'none' ? s.barStyle : 'none';
  r.setAttribute('data-ibt-bar', bar);
  if (s.barColor) r.style.setProperty('--ibt-bar-color', s.barColor);
  else r.style.removeProperty('--ibt-bar-color');
  r.setAttribute('data-ibt-highlight', s.transHighlight ? 'on' : 'off');
  if (s.highlightColor) r.style.setProperty('--ibt-highlight', s.highlightColor);
  else r.style.removeProperty('--ibt-highlight');
  refreshTransSurfaces();
  rootApplied = true;
}
export function rootStateApplied(): boolean { return rootApplied; }
