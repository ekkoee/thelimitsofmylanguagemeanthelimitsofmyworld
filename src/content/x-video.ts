// Bilingual captions for videos inside X tweets.
//
// Preferred path: the page bridge (x-main.ts) hands us the whole WebVTT track
// as soon as X fetches it. We translate every line up front, then draw Chinese
// over English in time with video.currentTime — inline, expanded, and fullscreen.
//
// Fallback: if no track arrives, watch the caption line X paints at the bottom
// of the player and translate that line as it changes.
//
// Burned-in captions (pixels in the video) have no track and no DOM text.
// Those cannot be translated.
import { Settings, TranslateBatchResponse, TranslateResponse } from '../core/types';
import { sendMessage } from '../utils/runtime';
import { el } from '../utils/dom';
import { Rect, XCue, X_CAPTION_GAP, mediaIdFromUrl, overlayBottomAbove, overlayUsedWidth, xCaptionBox, xCaptionFontPx } from './x-vtt';

const CHUNK = 12;
let settingsRef: () => Settings = () => ({} as Settings);
const tracks = new Map<string, XCue[]>();
const translated = new Map<string, string>();
const inflight = new Set<string>();
const attached = new Set<HTMLVideoElement>();
let raf = 0;

export function startXVideo(getSettings: () => Settings): void {
  settingsRef = getSettings;
  window.addEventListener('message', onCues);
  window.postMessage({ source: 'ibt-x-iso', type: 'getCues' }, '*');
  const mo = new MutationObserver(() => scan());
  const root = document.body || document.documentElement;
  if (root) mo.observe(root, { childList: true, subtree: true });
  scan();
  document.addEventListener('fullscreenchange', () => placeAll());
  window.addEventListener('resize', () => placeAll());
  if (!raf) raf = requestAnimationFrame(tick);
}

export function updateXVideoSettings(s: Settings): void {
  settingsRef = () => s;
  if (!s.enabled || !s.sites.x) hideAll();
}

function onCues(e: MessageEvent): void {
  if (e.source !== window) return;
  const d = e.data;
  if (!d || d.source !== 'ibt-x-main' || d.type !== 'cues' || !d.ok || !d.cues?.length) return;
  const id = String(d.mediaId || '');
  if (!id) return;
  if (!tracks.has(id)) console.log('[IBT] X 字幕就緒', id, d.cues.length, '句');
  tracks.set(id, d.cues as XCue[]);
  void translateMissing((d.cues as XCue[]).map((c) => c.text));
  scan();
}

function enabled(): boolean {
  const s = settingsRef();
  return !!s?.enabled && !!s?.sites?.x;
}

function playerOf(video: HTMLVideoElement): HTMLElement {
  return (video.closest('[data-testid="videoPlayer"]') as HTMLElement)
    || (video.closest('[data-testid="videoComponent"]') as HTMLElement)
    || video.parentElement
    || video;
}

function idOf(video: HTMLVideoElement): string {
  const roots = [
    playerOf(video),
    video.closest('[data-testid="videoComponent"]'),
    video.closest('article'),
  ].filter((n): n is HTMLElement => !!n);
  const blob = [
    video.poster || '',
    video.currentSrc || '',
    ...roots.flatMap((root) => Array.from(root.querySelectorAll('img')).map((img) => img.currentSrc || img.src || '')),
  ].join(' ');
  return mediaIdFromUrl(blob);
}

function scan(): void {
  document.querySelectorAll('video').forEach((node) => {
    const video = node as HTMLVideoElement;
    if (attached.has(video)) return;
    attached.add(video);
    bind(video);
  });
}

interface Bound {
  video: HTMLVideoElement;
  overlay: HTMLDivElement;
  zh: HTMLDivElement;
  en: HTMLDivElement;
  hiddenNative: HTMLElement | null;
  lastText: string;
  lastDomText: string;
  layoutKey: string;
  resize: ResizeObserver;
}

const bounds = new Map<HTMLVideoElement, Bound>();

function bind(video: HTMLVideoElement): void {
  const overlay = el('div', 'ibt-x-overlay');
  const zh = el('div', 'ibt-yt-zh');
  const en = el('div', 'ibt-yt-en');
  overlay.append(zh, en);
  overlay.style.display = 'none';
  const player = playerOf(video);
  if (getComputedStyle(player).position === 'static') player.style.position = 'relative';
  player.appendChild(overlay);
  const bound: Bound = { video, overlay, zh, en, hiddenNative: null, lastText: '', lastDomText: '', layoutKey: '', resize: undefined as unknown as ResizeObserver };
  bound.resize = new ResizeObserver(() => place(bound));
  bound.resize.observe(player);
  bound.resize.observe(video);
  bounds.set(video, bound);
  const id = idOf(video);
  if (id && tracks.has(id)) void translateMissing(tracks.get(id)!.map((c) => c.text));
}

function tick(): void {
  raf = requestAnimationFrame(tick);
  if (!enabled()) { hideAll(); return; }
  for (const b of bounds) paint(b[1]);
}

function paint(b: Bound): void {
  const { video } = b;
  if (!video.isConnected) {
    b.resize.disconnect();
    b.overlay.remove();
    bounds.delete(video);
    attached.delete(video);
    return;
  }
  if (document.documentElement.getAttribute('data-ibt-view') === 'orig') {
    clearNative(b);
    hide(b);
    return;
  }
  const cues = cuesFor(video);
  const player = playerOf(video);
  const cc = ccState(player);
  const trackOn = textTrackOn(video);
  const domNow = cc === false ? null : findCaptionNode(player, video);
  // A fetched track is shown while CC is on. If we cannot see the CC button,
  // a visible native caption (or a showing TextTrack) means the viewer turned it on.
  if (cues && cc !== false && (cc === true || trackOn || domNow)) {
    const ms = video.currentTime * 1000;
    const cue = cues.find((c) => ms >= c.start && ms < c.end) || null;
    showCue(b, cue?.text || '', translated.get(cue?.text || '') || '');
    syncNative(b, cue?.text || '', domNow);
    place(b, domNow);
    return;
  }
  // No track. Fall back only while X is actually painting a caption line.
  const dom = domNow;
  if (!dom) { clearNative(b); hide(b); return; }
  const text = (dom.textContent || '').replace(/\s+/g, ' ').trim();
  if (text && text !== b.lastDomText) {
    b.lastDomText = text;
    void translateOne(text);
  }
  showCue(b, text, translated.get(text) || '');
  syncNative(b, text, dom);
  place(b, dom);
}

function cuesFor(video: HTMLVideoElement): XCue[] | null {
  const id = idOf(video);
  if (id && tracks.has(id)) return tracks.get(id)!;
  const fromTrack = cuesFromTextTrack(video);
  if (fromTrack.length) return fromTrack;
  // A single playing video and a single intercepted track, before the poster id is in the DOM.
  if (tracks.size === 1 && !video.paused) {
    const playing = Array.from(document.querySelectorAll('video')).filter((v) => !(v as HTMLVideoElement).paused);
    if (playing.length === 1 && playing[0] === video) return [...tracks.values()][0];
  }
  return null;
}

function cuesFromTextTrack(video: HTMLVideoElement): XCue[] {
  const out: XCue[] = [];
  const list = video.textTracks;
  if (!list) return out;
  for (let i = 0; i < list.length; i++) {
    const tr = list[i];
    if (tr.kind !== 'subtitles' && tr.kind !== 'captions') continue;
    const cues = tr.cues;
    if (!cues || !cues.length) continue;
    for (let k = 0; k < cues.length; k++) {
      const c = cues[k] as VTTCue;
      const text = (c.text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      out.push({ start: c.startTime * 1000, end: c.endTime * 1000, text });
    }
  }
  if (out.length) void translateMissing(out.map((c) => c.text));
  return out;
}

function textTrackOn(video: HTMLVideoElement): boolean {
  const list = video.textTracks;
  if (!list) return false;
  for (let i = 0; i < list.length; i++) {
    const tr = list[i];
    if ((tr.kind === 'subtitles' || tr.kind === 'captions') && tr.mode === 'showing') return true;
  }
  return false;
}

function ccState(player: HTMLElement): boolean | null {
  const buttons = player.querySelectorAll('button, [role="button"]');
  for (const b of buttons) {
    const label = `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`.toLowerCase();
    if (!/caption|subtitle|closed caption|\bcc\b/.test(label)) continue;
    const pressed = b.getAttribute('aria-pressed') ?? b.getAttribute('aria-checked');
    if (pressed === 'true') return true;
    if (pressed === 'false') return false;
  }
  return null;
}

function findCaptionNode(player: HTMLElement, video: HTMLVideoElement): HTMLElement | null {
  const vr = video.getBoundingClientRect();
  if (vr.width < 40 || vr.height < 40) return null;
  let best: HTMLElement | null = null;
  let bestLen = 0;
  player.querySelectorAll('span, div, p').forEach((node) => {
    const n = node as HTMLElement;
    if (n.closest('.ibt-x-overlay, button, [role="button"], a')) return;
    if (n.querySelector('.ibt-x-overlay, button')) return;
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
    if (t.length < 8 || t.length > 240) return;
    if (/^\d+:\d{2}/.test(t)) return;
    if (/^(play|pause|mute|unmute|fullscreen|settings|closed captions?)$/i.test(t)) return;
    const r = n.getBoundingClientRect();
    if (r.width < 24 || r.height < 8 || r.height > vr.height * 0.45) return;
    const midY = r.top + r.height / 2;
    if (midY < vr.top + vr.height * 0.5 || midY > vr.bottom + 4) return;
    if (r.left < vr.left - 12 || r.right > vr.right + 12) return;
    // The full caption line, not an inner word span. Width is what we anchor to.
    if (r.width > bestLen) { best = n; bestLen = r.width; }
  });
  return best;
}

function showCue(b: Bound, en: string, zh: string): void {
  const order = settingsRef().subtitleOrder !== 'enTop';
  b.zh.style.order = order ? '0' : '1';
  b.en.style.order = order ? '1' : '0';
  b.zh.lang = settingsRef().targetLangCode || 'zh-TW';
  if (b.en.textContent !== en) b.en.textContent = en;
  if (b.zh.textContent !== zh) b.zh.textContent = zh;
  b.zh.style.display = zh ? '' : 'none';
  b.en.style.display = en ? '' : 'none';
  const on = !!(en || zh);
  b.overlay.style.setProperty('display', on ? 'flex' : 'none', 'important');
  b.lastText = en;
}

function hide(b: Bound): void {
  b.overlay.style.setProperty('display', 'none', 'important');
}

function hideAll(): void {
  for (const [, b] of bounds) { clearNative(b); hide(b); }
}

function chineseOnly(): boolean {
  return document.documentElement.getAttribute('data-ibt-view') === 'zh';
}

/** Bilingual mode draws English itself, so X's line is hidden. Chinese-only leaves it up. */
function syncNative(b: Bound, text: string, node: HTMLElement | null): void {
  clearNative(b);
  if (chineseOnly() || !text || !node) return;
  const got = (node.textContent || '').replace(/\s+/g, ' ').trim();
  if (got && (got === text || text.startsWith(got.slice(0, 24)) || got.startsWith(text.slice(0, 24)))) {
    node.classList.add('ibt-x-native-cap');
    b.hiddenNative = node;
  }
}

function clearNative(b: Bound): void {
  b.hiddenNative?.classList.remove('ibt-x-native-cap');
  b.hiddenNative = null;
}

function place(b: Bound, native?: HTMLElement | null): void {
  const video = b.video;
  const player = playerOf(video);
  const parent = overlayParent(video, player);
  if (b.overlay.parentElement !== parent) {
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.appendChild(b.overlay);
    b.resize.observe(parent);
  }
  const fixed = document.fullscreenElement === video;
  const vr = video.getBoundingClientRect();
  const anchor = fixed ? video : parent;
  const pr = anchor.getBoundingClientRect();
  if (vr.width < 20 || vr.height < 20) return;
  // Omitted native means "look it up" (resize, fullscreen, player-mode).
  // An explicit null means this frame has no caption.
  let cap: HTMLElement | null = null;
  if (native === undefined) cap = ccState(player) === false ? null : findCaptionNode(player, video);
  else cap = native && native.isConnected ? native : null;
  const cr = cap ? cap.getBoundingClientRect() : null;
  const capVisible = !!cr && cr.width > 8 && cr.height > 4 && cr.bottom > vr.top && cr.top < vr.bottom + 24;
  let bottom: number;
  let center: number;
  if (capVisible && cr && chineseOnly()) {
    // Sit a fixed gap above X's English line, wherever that line currently is.
    bottom = fixed
      ? (window.innerHeight - cr.top + X_CAPTION_GAP)
      : overlayBottomAbove(pr.bottom, cr.top);
    center = (cr.left + cr.width / 2) - (fixed ? 0 : pr.left);
  } else if (capVisible && cr) {
    // Bilingual box replaces the native line, so its bottom matches that line.
    bottom = fixed ? (window.innerHeight - cr.bottom) : (pr.bottom - cr.bottom);
    center = (cr.left + cr.width / 2) - (fixed ? 0 : pr.left);
  } else {
    const controls = controlOverlap(player, video);
    const ref = fixed ? toRect(vr) : toRect(pr);
    const box = xCaptionBox(toRect(vr), ref, controls);
    bottom = box.bottom;
    center = fixed ? vr.left + vr.width / 2 : box.center;
  }
  const maxW = Math.max(80, Math.round(vr.width * 0.9));
  const size = xCaptionFontPx(vr.width, vr.height, settingsRef().fontScale || 1);
  const s = b.overlay.style;
  s.setProperty('position', fixed ? 'fixed' : 'absolute', 'important');
  s.setProperty('left', `${Math.round(center)}px`, 'important');
  s.setProperty('bottom', `${Math.round(bottom)}px`, 'important');
  s.setProperty('transform', 'translateX(-50%)', 'important');
  s.setProperty('margin', '0', 'important');
  s.setProperty('right', 'auto', 'important');
  s.setProperty('top', 'auto', 'important');
  s.setProperty('z-index', '5', 'important');
  s.setProperty('font-size', `${size}px`, 'important');
  applyCaptionWidth(b, maxW, size);
}

/** Definite width from the rendered line, capped at 90% of the video. */
function applyCaptionWidth(b: Bound, maxW: number, size: number): void {
  if (getComputedStyle(b.overlay).display === 'none') return;
  const view = document.documentElement.getAttribute('data-ibt-view') || '';
  const key = `${b.zh.textContent}\n${b.en.textContent}\n${size}\n${maxW}\n${view}`;
  if (key === b.layoutKey) return;
  b.layoutKey = key;
  const textW = Math.max(naturalLineWidth(b.zh, size), naturalLineWidth(b.en, size));
  const pad = horizontalPadding(b.overlay);
  const used = textW > 0 ? overlayUsedWidth(textW, pad, maxW) : maxW;
  b.overlay.style.setProperty('width', `${used}px`, 'important');
  b.overlay.style.setProperty('max-width', `${maxW}px`, 'important');
  for (const line of [b.zh, b.en]) {
    line.style.setProperty('width', '100%', 'important');
    line.style.setProperty('max-width', '100%', 'important');
    line.style.setProperty('min-width', '0', 'important');
    line.style.setProperty('white-space', 'pre-wrap', 'important');
    line.style.setProperty('font-size', `${size}px`, 'important');
  }
}

function naturalLineWidth(line: HTMLElement, fontPx: number): number {
  if (!line.textContent) return 0;
  if (line.style.display === 'none' || getComputedStyle(line).display === 'none') return 0;
  const body = document.body;
  if (!body) return 0;
  const cs = getComputedStyle(line);
  const probe = document.createElement('div');
  probe.textContent = line.textContent;
  probe.style.position = 'absolute';
  probe.style.left = '0';
  probe.style.top = '0';
  probe.style.visibility = 'hidden';
  probe.style.whiteSpace = 'nowrap';
  probe.style.width = 'auto';
  probe.style.maxWidth = 'none';
  probe.style.padding = '0';
  probe.style.margin = '0';
  probe.style.border = '0';
  probe.style.fontSize = `${fontPx}px`;
  probe.style.fontFamily = cs.fontFamily;
  probe.style.fontWeight = cs.fontWeight;
  probe.style.letterSpacing = cs.letterSpacing;
  body.appendChild(probe);
  const w = probe.offsetWidth;
  probe.remove();
  return w;
}

function horizontalPadding(node: HTMLElement): number {
  const cs = getComputedStyle(node);
  return (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
}

function placeAll(): void {
  for (const [, b] of bounds) place(b);
}

function overlayParent(video: HTMLVideoElement, player: HTMLElement): HTMLElement {
  const fs = document.fullscreenElement as HTMLElement | null;
  if (fs && fs !== video && fs.contains(video)) return fs;
  return player;
}

function controlOverlap(player: HTMLElement, video: HTMLVideoElement): number {
  const vr = video.getBoundingClientRect();
  let overlap = 0;
  player.querySelectorAll('div, nav').forEach((node) => {
    const n = node as HTMLElement;
    if (n.closest('.ibt-x-overlay')) return;
    if (!n.querySelector('button, [role="button"]')) return;
    const r = n.getBoundingClientRect();
    if (r.height < 16 || r.height > 80 || r.width < vr.width * 0.4) return;
    if (r.top < vr.bottom && r.bottom > vr.bottom - 8 && r.top > vr.top + vr.height * 0.5) {
      overlap = Math.max(overlap, vr.bottom - r.top);
    }
  });
  return overlap;
}

function toRect(r: DOMRect): Rect {
  return { left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
}

async function translateMissing(texts: string[]): Promise<void> {
  const need = [...new Set(texts.map((t) => t.trim()).filter((t) => t && !translated.has(t) && !inflight.has(t)))];
  if (!need.length || !enabled()) return;
  for (let i = 0; i < need.length; i += CHUNK) {
    const slice = need.slice(i, i + CHUNK);
    slice.forEach((t) => inflight.add(t));
    try {
      const resp = await sendMessage<TranslateBatchResponse>({ type: 'translateBatch', texts: slice });
      const arr = resp?.ok ? resp.translations || [] : [];
      slice.forEach((t, k) => { if (arr[k]) translated.set(t, arr[k]); });
    } catch { /* next tick retries via inflight delete */ }
    slice.forEach((t) => inflight.delete(t));
  }
}

async function translateOne(text: string): Promise<void> {
  const t = text.trim();
  if (!t || translated.has(t) || inflight.has(t) || !enabled()) return;
  inflight.add(t);
  try {
    const resp = await sendMessage<TranslateResponse>({ type: 'translate', text: t, mode: 'subtitle' });
    const zh = (resp?.pairs || []).map((p) => p.t).filter(Boolean).join(' ');
    if (zh) translated.set(t, zh);
  } catch { /* English caption stays */ }
  inflight.delete(t);
}
