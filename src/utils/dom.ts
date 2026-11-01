import { DEFAULT_TRANS_COLOR, normalizeTint } from '../core/types';

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

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** 0–1 relative luminance. Light text on a dark page is above 0.6. */
function luminance(r: number, g: number, b: number): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function parseColor(value: string): { r: number; g: number; b: number; a: number } | null {
  return parseBg(value);
}

/** Page text color first. A painted ancestor background only when the ink is mid-grey. */
export function darkSurface(el: Element): boolean {
  const probe = el.closest('.ibt-block') || el.parentElement || el;
  const ink = parseColor(getComputedStyle(probe).color || '');
  if (ink && ink.a > 0.5) {
    const y = luminance(ink.r, ink.g, ink.b);
    if (y > 0.6) return true;
    if (y < 0.45) return false;
  }
  let node: Element | null = el;
  while (node) {
    const parsed = parseBg(getComputedStyle(node).backgroundColor || '');
    if (parsed && parsed.a > 0.45) return luminance(parsed.r, parsed.g, parsed.b) < 0.35;
    node = node.parentElement;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

const seen = new WeakSet<Element>();
let surfaceIo: IntersectionObserver | null = null;

function tagOne(el: HTMLElement): void {
  const next = darkSurface(el) ? 'dark' : 'light';
  if (el.getAttribute('data-ibt-on') !== next) el.setAttribute('data-ibt-on', next);
  if (!seen.has(el)) {
    seen.add(el);
    surfaceIo?.observe(el);
  }
}

export function refreshTransSurfaces(): void {
  document.querySelectorAll('.ibt-trans').forEach((el) => { if (el instanceof HTMLElement) tagOne(el); });
}

/** Tag each translation once, including ones inserted later. */
function tagTrans(el: Element): void {
  if (el instanceof HTMLElement && el.classList.contains('ibt-trans')) tagOne(el);
  if (el instanceof HTMLElement) el.querySelectorAll('.ibt-trans').forEach((node) => { if (node instanceof HTMLElement) tagOne(node); });
}

const THEME_ATTRS = ['class', 'style', 'data-theme', 'data-color-mode'];

export function watchTransSurfaces(): void {
  const w = window as unknown as { __ibtSurface?: boolean };
  if (w.__ibtSurface) return;
  w.__ibtSurface = true;
  surfaceIo = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.target instanceof HTMLElement) tagOne(entry.target);
    }
  }, { rootMargin: '400px 0px' });
  let themeFrame = 0;
  const onTheme = () => {
    if (themeFrame) return;
    themeFrame = requestAnimationFrame(() => { themeFrame = 0; refreshTransSurfaces(); });
  };
  const themeObserver = new MutationObserver(onTheme);
  const watchTheme = (node: Element) => themeObserver.observe(node, { attributes: true, attributeFilter: THEME_ATTRS });
  watchTheme(document.documentElement);
  const watchBody = () => { if (document.body) watchTheme(document.body); };
  if (document.body) watchBody();
  else document.addEventListener('DOMContentLoaded', watchBody, { once: true });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
  refreshTransSurfaces();
  new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node === document.body) watchBody();
        if (node instanceof Element) tagTrans(node);
      });
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

function hexAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
  const tint = normalizeTint(s.highlightColor);
  if (!tint) {
    r.removeAttribute('data-ibt-tint');
    r.style.removeProperty('--ibt-tint-light');
    r.style.removeProperty('--ibt-tint-dark');
  } else if (tint.startsWith('#')) {
    r.setAttribute('data-ibt-tint', 'custom');
    r.style.setProperty('--ibt-tint-light', hexAlpha(tint, 0.45));
    r.style.setProperty('--ibt-tint-dark', hexAlpha(tint, 0.42));
  } else {
    r.setAttribute('data-ibt-tint', tint);
    r.style.removeProperty('--ibt-tint-light');
    r.style.removeProperty('--ibt-tint-dark');
  }
  refreshTransSurfaces();
  rootApplied = true;
}
export function rootStateApplied(): boolean { return rootApplied; }
