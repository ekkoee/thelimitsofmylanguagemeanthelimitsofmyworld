// Right-click 「翻譯這張圖片」. The service worker fetches the bytes (or we draw
// them here, or crop a tab screenshot) and Gemini reads the picture. The block
// sits under the image when the layout can grow, and on top of it when it cannot.

import { setUiLang, t, watchUiLang } from '../core/i18n';
import { langTag } from '../core/lang-tag';
import { applyRootState } from '../utils/dom';
import { loadSettings } from '../core/storage';
import { pageFontPx } from './page-font';
import { belowAnchor, imageDecision, shouldSkipImageTarget } from './image-place';
import { renderRegions } from './image-inplace';
import { friendlyTranslateError } from '../core/errors';
import { IMAGE_JPEG_QUALITY, IMAGE_MAX_EDGE, ImageRegion, isMostlyLatin, selectInPlace } from '../providers/gemini-image';

const inflight = new Map<string, Promise<void>>();

type ImgHit = HTMLImageElement | HTMLElement;

let lastTarget: Element | null = null;
let listening = false;

export function startImageTranslate(): void {
  const w = window as unknown as { __ibtImage?: boolean };
  if (w.__ibtImage) return;
  w.__ibtImage = true;
  watchUiLang();
  void loadSettings().then((s) => setUiLang(s.uiLang || '')).catch(() => {});
  document.addEventListener('contextmenu', (e) => {
    lastTarget = e.target as Element | null;
  }, true);
  if (listening) return;
  listening = true;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'ibt-image') return;
    void run(String(msg.srcUrl || ''))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.log('[IBT] image translate failed', err);
        sendResponse({ ok: false, error: String(err?.message ?? err) });
      });
    return true;
  });
}

function normUrl(raw: string): string {
  if (!raw) return '';
  try { return new URL(raw, location.href).href; } catch { return raw; }
}

function sameImage(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const na = normUrl(a);
  const nb = normUrl(b);
  return na === nb;
}

function backgroundUrl(el: Element): string {
  const bg = getComputedStyle(el).backgroundImage || '';
  const m = /url\(["']?([^"')]+)["']?\)/.exec(bg);
  return m?.[1] || '';
}

function findImage(srcUrl: string): ImgHit | null {
  const target = lastTarget;
  const eventImg = target?.closest?.('img') as HTMLImageElement | null;
  if (eventImg && (!srcUrl || sameImage(eventImg.currentSrc || eventImg.src, srcUrl))) return eventImg;
  if (srcUrl) {
    for (const img of Array.from(document.images)) {
      if (sameImage(img.currentSrc || '', srcUrl) || sameImage(img.src || '', srcUrl)) return img;
    }
    let el: Element | null = target;
    for (let i = 0; el && i < 6; i++, el = el.parentElement) {
      if (sameImage(backgroundUrl(el), srcUrl)) return el as HTMLElement;
    }
  }
  if (target && backgroundUrl(target)) return target as HTMLElement;
  return eventImg;
}

function existingFor(img: ImgHit): HTMLElement | null {
  const id = (img as HTMLElement).dataset.ibtImg;
  if (!id) return null;
  const node = document.querySelector<HTMLElement>(`[data-ibt-img-for="${id}"]`);
  return node;
}

function tag(img: ImgHit): string {
  if (!(img as HTMLElement).dataset.ibtImg) {
    (img as HTMLElement).dataset.ibtImg = `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }
  return (img as HTMLElement).dataset.ibtImg || '';
}

async function run(srcUrl: string): Promise<void> {
  const img = findImage(srcUrl);
  if (!img) {
    console.log('[IBT] image target not found', srcUrl);
    return;
  }
  const prior = existingFor(img);
  if (prior) { prior.remove(); delete (img as HTMLElement).dataset.ibtImg; return; }
  const key = srcUrl || (img instanceof HTMLImageElement ? (img.currentSrc || img.src) : '');
  const pending = inflight.get(key);
  if (pending) return pending;

  const job = runOne(img, srcUrl);
  if (key) inflight.set(key, job);
  try { await job; } finally { if (key) inflight.delete(key); }
}

async function runOne(img: ImgHit, srcUrl: string): Promise<void> {
  const el = img as HTMLElement;
  const rect = el.getBoundingClientRect();
  if (shouldSkipImageTarget({
    width: rect.width,
    height: rect.height,
    inTweetText: !!el.closest('[data-testid="tweetText"], [data-testid="UserDescription"]'),
    inTweetPhoto: !!el.closest('[data-testid="tweetPhoto"]'),
  })) {
    console.log('[IBT] image skipped, not a content picture');
    return;
  }
  const decision = imageDecision(el);
  console.log('[IBT] image mode', decision.mode, decision.reason);
  const shell = mountOverlay(img);
  try {
    const settings = await loadSettings();
    applyRootState(settings);
    const bytes = await acquire(img, srcUrl);
    if (!shell.isConnected) return;
    if (!bytes) throw new Error(t('imageUnreadable'));
    console.log('[IBT] image encoded', bytes.via, bytes.mime, bytes.data.length, new Date().toISOString());
    if (settings.imageModel === 'gemini') {
      const resp = await chrome.runtime.sendMessage({
        type: 'ibt-translate-image', mime: bytes.mime, data: bytes.data,
      }) as { ok?: boolean; text?: string; regions?: ImageRegion[]; error?: string };
      if (!shell.isConnected) return;
      if (resp?.ok) {
        const picked = selectInPlace(resp.regions || []);
        console.log('[IBT] image place', picked.mode, picked.regions.length);
        if (picked.mode === 'inplace') {
          await paintInPlace(shell, img, bytes, picked.regions);
          return;
        }
        const body = (resp.text || '').trim();
        const shown = !body ? t('imageEmpty') : (isMostlyLatin(body) ? t('imageFailed') : body);
        if (decision.mode === 'below' && !el.closest('article')) { shell.remove(); mountBelow(img, shown); return; }
        paintPanel(shell, shown);
        return;
      }
      console.log('[IBT] vision unavailable, local ocr', (resp?.error || '').slice(0, 120));
    }
    const ocr = await chrome.runtime.sendMessage({
      type: 'ibt-ocr-translate', mime: bytes.mime, data: bytes.data,
    }) as { ok?: boolean; regions?: ImageRegion[]; error?: string; ms?: number };
    if (!shell.isConnected) return;
    if (!ocr?.ok) throw new Error(ocr?.error || t('ocrFailed'));
    console.log('[IBT] ocr', ocr.ms, 'regions', (ocr.regions || []).length);
    const ocrPicked = selectInPlace(ocr.regions || []);
    if (ocrPicked.mode === 'inplace') {
      await paintInPlace(shell, img, bytes, ocrPicked.regions);
      return;
    }
    const ocrShown = (ocr.regions || []).map((r) => r.textZh).filter(Boolean).join('\n') || t('imageEmpty');
    if (decision.mode === 'below' && !el.closest('article')) { shell.remove(); mountBelow(img, ocrShown); return; }
    paintPanel(shell, ocrShown);
  } catch (err) {
    if (!shell.isConnected) return;
    const shown = friendlyTranslateError(err, 'image');
    if (decision.mode === 'below' && !el.closest('article')) {
      shell.remove();
      mountBelow(img, shown);
      return;
    }
    paintPanel(shell, shown);
  }
}

function mountBelow(img: ImgHit, text: string): HTMLElement {
  const block = document.createElement('div');
  block.className = 'ibt-img-block';
  block.dataset.ibtOut = '1';
  block.dataset.ibtImgFor = tag(img);
  const host = img.parentElement || document.body;
  block.style.fontSize = `${pageFontPx(host)}px`;
  block.style.lineHeight = '1.5';
  const lang = langTag(document.documentElement.getAttribute('data-ibt-target'));
  block.lang = lang;
  const line = document.createElement('div');
  line.className = 'ibt-img-caption';
  line.lang = lang;
  line.textContent = text;
  block.appendChild(line);
  const anchor = belowAnchor(img as HTMLElement);
  anchor.parentElement?.insertBefore(block, anchor.nextSibling);
  return block;
}

function mountOverlay(img: ImgHit): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'ibt-img-overlay';
  overlay.dataset.ibtOut = '1';
  overlay.dataset.ibtImgFor = tag(img);
  const loading = document.createElement('div');
  loading.className = 'ibt-img-loading';
  loading.dataset.i18n = 'imageLoading';
  loading.textContent = t('imageLoading');
  overlay.appendChild(controls(overlay));
  overlay.appendChild(loading);
  placeOverlay(img as HTMLElement, overlay);
  watchOverlay(img as HTMLElement, overlay);
  wirePeek(overlay);
  return overlay;
}

function paintPanel(shell: HTMLElement, text: string): void {
  shell.querySelector('.ibt-img-loading')?.remove();
  shell.querySelectorAll('.ibt-img-region').forEach((n) => n.remove());
  let panel = shell.querySelector('.ibt-img-panel') as HTMLElement | null;
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'ibt-img-panel';
    shell.appendChild(panel);
  }
  panel.textContent = text;
  fitOverlay(shell, panel);
}

async function paintInPlace(shell: HTMLElement, img: ImgHit, bytes: Bytes, regions: ImageRegion[]): Promise<void> {
  shell.querySelector('.ibt-img-loading')?.remove();
  shell.querySelector('.ibt-img-panel')?.remove();
  const canvas = await canvasFromBytes(bytes);
  const space = bytes.via === 'capture' || img.tagName !== 'IMG' ? 'element' : 'image';
  renderRegions(shell, img as HTMLImageElement, canvas, regions, { space });
}

function canvasFromBytes(bytes: Bytes): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx || !canvas.width) { resolve(null); return; }
      ctx.drawImage(image, 0, 0);
      resolve(canvas);
    };
    image.onerror = () => resolve(null);
    image.src = `data:${bytes.mime};base64,${bytes.data}`;
  });
}

function controls(overlay: HTMLElement): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'ibt-img-bar';
  const peek = document.createElement('button');
  peek.type = 'button';
  peek.className = 'ibt-img-peek';
  peek.dataset.i18n = 'original';
  peek.textContent = t('original');
  peek.addEventListener('mouseenter', () => overlay.classList.add('is-peek'));
  peek.addEventListener('mousedown', () => overlay.classList.add('is-peek'));
  peek.addEventListener('mouseup', () => overlay.classList.remove('is-peek'));
  peek.addEventListener('mouseleave', () => overlay.classList.remove('is-peek'));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ibt-img-x';
  close.textContent = '✕';
  close.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const id = overlay.dataset.ibtImgFor || '';
    overlay.remove();
    if (id) {
      const src = document.querySelector<HTMLElement>(`[data-ibt-img="${id}"]`);
      if (src) delete src.dataset.ibtImg;
    }
  });
  bar.appendChild(peek);
  bar.appendChild(close);
  return bar;
}

function wirePeek(overlay: HTMLElement): void {
  overlay.addEventListener('mousedown', (e) => {
    if ((e.target as Element).closest('.ibt-img-x, .ibt-img-peek')) return;
    overlay.classList.add('is-peek');
  });
  window.addEventListener('mouseup', () => overlay.classList.remove('is-peek'));
  overlay.addEventListener('mouseenter', () => { /* hover peeks only while holding */ });
}

function placeOverlay(img: HTMLElement, overlay: HTMLElement): void {
  // Fixed to the image's own rectangle. A positioned tweet article also holds
  // the text, and an overlay attached there paints a second translation on it.
  const ir = img.getBoundingClientRect();
  overlay.style.position = 'fixed';
  overlay.style.left = `${ir.left}px`;
  overlay.style.top = `${ir.top}px`;
  overlay.style.width = `${Math.max(0, ir.width)}px`;
  overlay.style.height = `${Math.max(0, ir.height)}px`;
  overlay.style.right = 'auto';
  overlay.style.bottom = 'auto';
  overlay.style.zIndex = '2147483000';
  if (!overlay.isConnected) document.documentElement.appendChild(overlay);
}

function watchOverlay(img: HTMLElement, overlay: HTMLElement): void {
  const place = () => { if (overlay.isConnected) placeOverlay(img, overlay); };
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(place);
    ro.observe(img);
    overlay.addEventListener('DOMNodeRemoved', () => ro.disconnect(), { once: true });
  }
  window.addEventListener('scroll', place, true);
}

function fitOverlay(box: HTMLElement, textEl: HTMLElement): void {
  const maxH = Math.max(24, box.clientHeight - 8);
  let px = Math.min(18, Math.max(12, Math.round(box.clientWidth / 22)));
  textEl.style.fontSize = `${px}px`;
  textEl.style.lineHeight = '1.4';
  textEl.style.maxHeight = `${maxH}px`;
  textEl.style.overflow = 'auto';
  while (px > 11 && textEl.scrollHeight > maxH + 2) {
    px -= 1;
    textEl.style.fontSize = `${px}px`;
  }
}

interface Bytes { mime: string; data: string; via: string }

async function acquire(img: ImgHit, srcUrl: string): Promise<Bytes | null> {
  const url = srcUrl || (img instanceof HTMLImageElement ? (img.currentSrc || img.src) : backgroundUrl(img));
  if (url && !url.startsWith('data:')) {
    try {
      const fetched = await chrome.runtime.sendMessage({ type: 'ibt-fetch-image', url }) as { ok?: boolean; mime?: string; data?: string };
      if (fetched?.ok && fetched.data) return shrink({ mime: fetched.mime || 'image/jpeg', data: fetched.data, via: 'fetch' });
    } catch { /* content script can still draw it */ }
  }
  if (url?.startsWith('data:')) {
    const m = /^data:([^;,]+);base64,(.+)$/i.exec(url);
    if (m) return shrink({ mime: m[1], data: m[2], via: 'data-url' });
  }
  if (img instanceof HTMLImageElement) {
    const drawn = drawImage(img);
    if (drawn) return shrink(drawn);
  }
  const rect = img.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return null;
  try {
    const shot = await chrome.runtime.sendMessage({ type: 'ibt-capture-tab' }) as { ok?: boolean; dataUrl?: string };
    if (shot?.ok && shot.dataUrl) {
      const cropped = await cropShot(shot.dataUrl, rect, window.devicePixelRatio || 1);
      if (cropped) return shrink({ mime: 'image/png', data: cropped, via: 'capture' });
    }
  } catch { /* no tab capture */ }
  return null;
}

async function shrink(bytes: Bytes): Promise<Bytes> {
  try {
    const img = new Image();
    img.src = `data:${bytes.mime};base64,${bytes.data}`;
    await img.decode();
    const edge = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    const scale = Math.min(1, IMAGE_MAX_EDGE / edge);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return bytes;
    ctx.drawImage(img, 0, 0, w, h);
    const url = canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY);
    const data = url.split(',')[1] || '';
    if (!data) return bytes;
    console.log('[IBT] image jpeg', w, h, data.length);
    return { mime: 'image/jpeg', data, via: bytes.via };
  } catch {
    return bytes;
  }
}

function drawImage(img: HTMLImageElement): Bytes | null {
  try {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const url = canvas.toDataURL('image/png');
    const data = url.split(',')[1] || '';
    if (!data) return null;
    return { mime: 'image/png', data, via: 'canvas' };
  } catch {
    return null;
  }
}

function cropShot(dataUrl: string, rect: DOMRect, dpr: number): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(image, rect.left * dpr, rect.top * dpr, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      resolve((canvas.toDataURL('image/png').split(',')[1]) || null);
    };
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}
