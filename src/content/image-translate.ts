// Right-click 「翻譯這張圖片」. The service worker fetches the bytes (or we draw
// them here, or crop a tab screenshot) and Gemini reads the picture. The block
// sits under the image when the layout can grow, and on top of it when it cannot.

import { applyRootState } from '../utils/dom';
import { loadSettings } from '../core/storage';
import { pageFontPx } from './page-font';
import { belowAnchor, imageDecision, overlayHost } from './image-place';
import type { ImageRegion } from '../providers/gemini';

const EMPTY = '圖片中沒有可翻譯的文字';
const LOADING = '圖片翻譯中…';

type ImgHit = HTMLImageElement | HTMLElement;

let lastTarget: Element | null = null;
let listening = false;

export function startImageTranslate(): void {
  const w = window as unknown as { __ibtImage?: boolean };
  if (w.__ibtImage) return;
  w.__ibtImage = true;
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

  const decision = imageDecision(img as HTMLElement);
  console.log('[IBT] image mode', decision.mode, decision.reason);
  const shell = mount(img, decision.mode, LOADING);
  try {
    const settings = await loadSettings();
    applyRootState(settings);
    const bytes = await acquire(img, srcUrl);
    if (!bytes) throw new Error('無法讀取這張圖片');
    console.log('[IBT] image encoded', bytes.via, bytes.mime, bytes.data.length);
    const resp = await chrome.runtime.sendMessage({
      type: 'ibt-translate-image', mime: bytes.mime, data: bytes.data,
    }) as { ok?: boolean; text?: string; regions?: ImageRegion[]; error?: string };
    if (!resp?.ok) throw new Error(resp?.error || '圖片翻譯失敗');
    paint(shell, img, decision.mode, resp.text || '', resp.regions || []);
  } catch (err) {
    paint(shell, img, decision.mode, String((err as Error)?.message || err), []);
  }
}

function mount(img: ImgHit, mode: 'below' | 'overlay', text: string): HTMLElement {
  const id = tag(img);
  if (mode === 'below') {
    const block = document.createElement('div');
    block.className = 'ibt-block ibt-uni ibt-img';
    block.dataset.ibtOut = '1';
    block.dataset.ibtImgFor = id;
    const host = img.parentElement || document.body;
    block.style.fontSize = `${pageFontPx(host)}px`;
    block.style.lineHeight = '1.5';
    const line = document.createElement('div');
    line.className = 'ibt-trans';
    line.textContent = text;
    block.appendChild(line);
    const anchor = belowAnchor(img as HTMLElement);
    anchor.parentElement?.insertBefore(block, anchor.nextSibling);
    return block;
  }
  const overlay = document.createElement('div');
  overlay.className = 'ibt-img-overlay';
  overlay.dataset.ibtOut = '1';
  overlay.dataset.ibtImgFor = id;
  const panel = document.createElement('div');
  panel.className = 'ibt-img-panel';
  panel.textContent = text;
  overlay.appendChild(controls(overlay));
  overlay.appendChild(panel);
  placeOverlay(img as HTMLElement, overlay);
  fitOverlay(overlay, panel);
  wirePeek(overlay);
  return overlay;
}

function paint(shell: HTMLElement, img: ImgHit, mode: 'below' | 'overlay', text: string, regions: ImageRegion[]): void {
  const body = text.trim();
  const empty = !body;
  const shown = empty ? EMPTY : body;
  if (mode === 'below' || !regions.length || empty) {
    const line = shell.querySelector('.ibt-trans, .ibt-img-panel') as HTMLElement | null;
    if (line) line.textContent = shown;
    if (mode === 'overlay') {
      const panel = shell.querySelector('.ibt-img-panel') as HTMLElement | null;
      if (panel) fitOverlay(shell, panel);
    }
    return;
  }
  shell.querySelector('.ibt-img-panel')?.remove();
  for (const region of regions) {
    const box = document.createElement('div');
    box.className = 'ibt-img-region';
    const [x, y, w, h] = region.box;
    box.style.left = `${x * 100}%`;
    box.style.top = `${y * 100}%`;
    box.style.width = `${w * 100}%`;
    box.style.height = `${h * 100}%`;
    box.textContent = region.text;
    shell.appendChild(box);
    fitOverlay(box, box);
  }
  void img;
}

function controls(overlay: HTMLElement): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'ibt-img-bar';
  const peek = document.createElement('button');
  peek.type = 'button';
  peek.className = 'ibt-img-peek';
  peek.textContent = '原文';
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
  const host = overlayHost(img);
  const hr = host.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  overlay.style.left = `${ir.left - hr.left + host.scrollLeft}px`;
  overlay.style.top = `${ir.top - hr.top + host.scrollTop}px`;
  overlay.style.width = `${ir.width}px`;
  overlay.style.height = `${ir.height}px`;
  host.appendChild(overlay);
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
      if (fetched?.ok && fetched.data) return { mime: fetched.mime || 'image/jpeg', data: fetched.data, via: 'fetch' };
    } catch { /* content script can still draw it */ }
  }
  if (url?.startsWith('data:')) {
    const m = /^data:([^;,]+);base64,(.+)$/i.exec(url);
    if (m) return { mime: m[1], data: m[2], via: 'data-url' };
  }
  if (img instanceof HTMLImageElement) {
    const drawn = drawImage(img);
    if (drawn) return drawn;
  }
  const rect = img.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return null;
  try {
    const shot = await chrome.runtime.sendMessage({ type: 'ibt-capture-tab' }) as { ok?: boolean; dataUrl?: string };
    if (shot?.ok && shot.dataUrl) {
      const cropped = await cropShot(shot.dataUrl, rect, window.devicePixelRatio || 1);
      if (cropped) return { mime: 'image/png', data: cropped, via: 'capture' };
    }
  } catch { /* no tab capture */ }
  return null;
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
