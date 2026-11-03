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
import { langTag } from '../core/lang-tag';
import { el } from '../utils/dom';
import { Rect, XCue, captionVariant, hidesNativeCaption, isXCaptionText, mediaIdFromUrl, overlayUsedWidth, xCaptionBox, xCaptionFontPx, xVideoView } from './x-vtt';

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
  for (const v of attached) if (!v.isConnected) attached.delete(v);
  document.querySelectorAll('video').forEach((node) => {
    const video = node as HTMLVideoElement;
    if (attached.has(video)) return;
    attached.add(video);
    bind(video);
  });
}

interface Bound {
  video: HTMLVideoElement;
  player: HTMLElement;
  overlay: HTMLDivElement;
  zh: HTMLDivElement;
  en: HTMLDivElement;
  hiddenNodes: HTMLElement[];
  heldTracks: TextTrack[];
  variant: string;
  lastText: string;
  lastDomText: string;
  layoutKey: string;
  resize: ResizeObserver;
}

const bounds = new Map<HTMLVideoElement, Bound>();

function bind(video: HTMLVideoElement): void {
  const player = playerOf(video);
  const existing = boundFor(player);
  if (existing) {
    adoptVideo(existing, video);
    keepOneOverlay(player, existing.overlay);
    return;
  }
  // A box left behind by a previous injection has no live owner. Drop it so
  // this pass attaches exactly one.
  player.querySelectorAll('.ibt-x-overlay').forEach((n) => n.remove());
  const overlay = el('div', 'ibt-x-overlay');
  const zh = el('div', 'ibt-yt-zh');
  const en = el('div', 'ibt-yt-en');
  overlay.append(zh, en);
  overlay.style.display = 'none';
  if (getComputedStyle(player).position === 'static') player.style.position = 'relative';
  player.appendChild(overlay);
  const bound: Bound = { video, player, overlay, zh, en, hiddenNodes: [], heldTracks: [], variant: '', lastText: '', lastDomText: '', layoutKey: '', resize: undefined as unknown as ResizeObserver };
  bound.resize = new ResizeObserver(() => place(bound));
  bound.resize.observe(player);
  bound.resize.observe(video);
  bounds.set(video, bound);
  const id = idOf(video);
  if (id && tracks.has(id)) void translateMissing(tracks.get(id)!.map((c) => c.text));
}

function boundFor(player: HTMLElement): Bound | undefined {
  for (const b of bounds.values()) {
    if (b.player === player || b.overlay.parentElement === player) return b;
  }
  return undefined;
}

/** One player, one overlay. A second <video> in the same player reuses the box. */
function adoptVideo(b: Bound, video: HTMLVideoElement): void {
  if (b.video === video) return;
  const next = area(video);
  const prev = b.video.isConnected ? area(b.video) : 0;
  if (next < prev) return;
  releaseTextTracks(b, true);
  b.video.classList.remove('ibt-x-hide-cue');
  b.variant = '';
  b.resize.unobserve(b.video);
  bounds.delete(b.video);
  b.video = video;
  bounds.set(video, b);
  b.resize.observe(video);
}

function area(video: HTMLVideoElement): number {
  const r = video.getBoundingClientRect();
  return Math.max(0, r.width) * Math.max(0, r.height);
}

function keepOneOverlay(player: HTMLElement, keep: HTMLElement): void {
  player.querySelectorAll('.ibt-x-overlay').forEach((n) => {
    if (n !== keep) n.remove();
  });
}

function tick(): void {
  raf = requestAnimationFrame(tick);
  if (!enabled()) { hideAll(); return; }
  for (const b of bounds) paint(b[1]);
}

function paint(b: Bound): void {
  const { video } = b;
  if (!video.isConnected) {
    clearNative(b, false);
    b.resize.disconnect();
    b.overlay.remove();
    bounds.delete(video);
    attached.delete(video);
    return;
  }
  const cues = cuesFor(video);
  const player = b.player.isConnected ? b.player : playerOf(video);
  b.player = player;
  const cc = ccState(player);
  const trackOn = textTrackOn(video) || b.heldTracks.length > 0;
  // CC explicitly off: nothing, even if the "From @account" chip is on screen.
  // Don't force the track back to showing — the player already turned it off.
  if (cc === false) { clearNative(b, false); hide(b); return; }
  const domNow = findCaptionNode(player, video);
  // A fetched track is shown while CC is on. If the CC button is not in the DOM
  // (controls hidden), a real caption line or a showing TextTrack means it is on.
  if (cues && (cc === true || trackOn || domNow)) {
    const ms = video.currentTime * 1000;
    const cue = cues.find((c) => ms >= c.start && ms < c.end) || null;
    showCue(b, cue?.text || '', translated.get(cue?.text || '') || '');
    syncNative(b, true);
    place(b, b.hiddenNodes[0] || null, cue?.text || '');
    return;
  }
  // No track. Fall back only while X is actually painting a caption line.
  const dom = domNow;
  if (!dom) { clearNative(b, true); hide(b); return; }
  const text = (dom.textContent || '').replace(/\s+/g, ' ').trim();
  if (text && text !== b.lastDomText) {
    b.lastDomText = text;
    void translateOne(text);
  }
  showCue(b, text, translated.get(text) || '');
  syncNative(b, true);
  place(b, b.hiddenNodes[0] || null, text);
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

function captionSearchRoots(video: HTMLVideoElement, player: HTMLElement): ParentNode[] {
  const roots: ParentNode[] = [];
  const add = (n: ParentNode | null | undefined) => {
    if (n && !roots.includes(n)) roots.push(n);
  };
  add(player);
  add(video.closest('[data-testid="videoComponent"]'));
  add(video.closest('[data-testid="quoteTweet"], [data-testid="card.wrapper"]'));
  add(video.closest('article'));
  return roots;
}

function walkElements(root: ParentNode, visit: (el: HTMLElement) => void, depth = 0): void {
  if (depth > 4) return;
  root.querySelectorAll('span, div, p').forEach((node) => visit(node as HTMLElement));
  root.querySelectorAll('*').forEach((node) => {
    const sr = (node as HTMLElement).shadowRoot;
    if (sr) walkElements(sr, visit, depth + 1);
  });
}

/** Caption-sized lines on the picture. Not matched by cue string — X's line is often longer. */
function nativeCaptionNodes(video: HTMLVideoElement, player: HTMLElement): HTMLElement[] {
  const vr = video.getBoundingClientRect();
  if (vr.width < 40 || vr.height < 40) return [];
  const videoRect = toRect(vr);
  const found: HTMLElement[] = [];
  const visit = (n: HTMLElement) => {
    if (found.includes(n)) return;
    if (n.closest('.ibt-x-overlay, .ibt-block, button, [role="button"], a')) return;
    if (n.querySelector('.ibt-x-overlay, .ibt-block, button, [role="button"]')) return;
    const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
    const r = n.getBoundingClientRect();
    if (!isXCaptionText(t, toRect(r), videoRect)) return;
    found.push(n);
  };
  for (const root of captionSearchRoots(video, player)) walkElements(root, visit);
  // A word span and its line both match. Keep the outer line.
  return found.filter((n) => !found.some((other) => other !== n && other.contains(n)));
}

function findCaptionNode(player: HTMLElement, video: HTMLVideoElement): HTMLElement | null {
  const nodes = nativeCaptionNodes(video, player);
  let best: HTMLElement | null = null;
  let bestLen = 0;
  for (const n of nodes) {
    const w = n.getBoundingClientRect().width;
    if (w > bestLen) { best = n; bestLen = w; }
  }
  return best;
}

function showCue(b: Bound, en: string, zh: string): void {
  const order = settingsRef().subtitleOrder !== 'enTop';
  const mode = xVideoView(settingsRef().viewMode);
  b.zh.style.order = order ? '0' : '1';
  b.en.style.order = order ? '1' : '0';
  b.zh.lang = langTag(settingsRef().targetLangCode);
  if (b.en.textContent !== en) b.en.textContent = en;
  if (b.zh.textContent !== zh) b.zh.textContent = zh;
  // 對照 shows both lines. 只顯示譯文 / 只顯示原文 keep a single line in this box.
  // Inline !important beats the page view, which stays bilingual for tweets.
  const showZh = mode !== 'orig' && !!zh;
  const showEn = mode !== 'zh' && !!en;
  if (showZh) b.zh.style.removeProperty('display');
  else b.zh.style.setProperty('display', 'none', 'important');
  if (showEn) b.en.style.removeProperty('display');
  else b.en.style.setProperty('display', 'none', 'important');
  const on = showZh || showEn;
  b.overlay.style.setProperty('display', on ? 'flex' : 'none', 'important');
  b.lastText = en;
}

function hide(b: Bound): void {
  b.overlay.style.setProperty('display', 'none', 'important');
}

function hideAll(): void {
  for (const [, b] of bounds) { clearNative(b, true); hide(b); }
}

function cueTracks(video: HTMLVideoElement): TextTrack[] {
  const list = video.textTracks;
  if (!list) return [];
  const out: TextTrack[] = [];
  for (let i = 0; i < list.length; i++) {
    const tr = list[i];
    if (tr.kind === 'subtitles' || tr.kind === 'captions') out.push(tr);
  }
  return out;
}

/**
 * Browser ::cue paints from a text track in mode "showing". "hidden" keeps the
 * cues readable and stops that paint. Tracks the player sets to "disabled"
 * (CC off) are left alone.
 */
function suppressTextTracks(b: Bound): boolean {
  const still: TextTrack[] = [];
  for (const tr of cueTracks(b.video)) {
    if (tr.mode === 'disabled') continue;
    if (tr.mode !== 'showing' && !b.heldTracks.includes(tr)) continue;
    try { if (tr.mode !== 'hidden') tr.mode = 'hidden'; } catch { continue; }
    still.push(tr);
  }
  b.heldTracks = still;
  return still.length > 0;
}

function releaseTextTracks(b: Bound, restore: boolean): void {
  for (const tr of b.heldTracks) {
    try { if (restore && tr.mode === 'hidden') tr.mode = 'showing'; } catch { /* detached */ }
  }
  b.heldTracks = [];
}

/**
 * Hide X's own line while our box is up. DOM overlays (uploader captions) are
 * the node on the picture. ASR / browser cues are the video text track. Both
 * can be active on the same player. The track is not removed.
 */
function syncNative(b: Bound, active: boolean): void {
  if (!active || !hidesNativeCaption(settingsRef().viewMode)) {
    clearNative(b, true);
    return;
  }
  b.video.classList.add('ibt-x-hide-cue');
  const cue = suppressTextTracks(b);
  const player = b.player?.isConnected ? b.player : playerOf(b.video);
  const hosts = nativeCaptionNodes(b.video, player);
  for (const n of b.hiddenNodes) {
    if (hosts.includes(n)) continue;
    n.classList.remove('ibt-x-native-cap');
    n.style.removeProperty('visibility');
    n.style.removeProperty('opacity');
  }
  for (const host of hosts) {
    host.classList.add('ibt-x-native-cap');
    host.style.setProperty('visibility', 'hidden', 'important');
    host.style.setProperty('opacity', '0', 'important');
  }
  b.hiddenNodes = hosts;
  const kind = captionVariant(hosts.length > 0, cue);
  if (kind !== b.variant) {
    b.variant = kind;
    console.log('[IBT] X 字幕原生層', kind);
  }
}

function clearNative(b: Bound, restore: boolean): void {
  for (const n of b.hiddenNodes) {
    n.classList.remove('ibt-x-native-cap');
    n.style.removeProperty('visibility');
    n.style.removeProperty('opacity');
  }
  b.hiddenNodes = [];
  releaseTextTracks(b, restore);
  b.video.classList.remove('ibt-x-hide-cue');
  b.variant = '';
}

function place(b: Bound, native?: HTMLElement | null, cueText?: string): void {
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
  const capVisible = !!cr && usableCaptionRect(cr, vr);
  const cue = (cueText ?? b.lastText ?? '').trim();
  let bottom: number;
  let center: number;
  if (capVisible && cr) {
    // One box occupies the native caption's own slot. The native line is hidden.
    bottom = fixed ? (window.innerHeight - cr.bottom) : (pr.bottom - cr.bottom);
    center = (cr.left + cr.width / 2) - (fixed ? 0 : pr.left);
  } else {
    const controls = controlOverlap(player, video);
    const ref = fixed ? toRect(vr) : toRect(pr);
    const box = xCaptionBox(toRect(vr), ref, controls);
    bottom = box.bottom;
    center = fixed ? vr.left + vr.width / 2 : box.center;
    xCapLog({ bottom: Math.round(bottom), cue: cue.slice(0, 80), fixed });
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
  s.setProperty('padding', '0.15em 0.55em', 'important');
  s.setProperty('max-width', `${maxW}px`, 'important');
  applyCaptionWidth(b, maxW, size);
}

/** Definite width from the rendered line, capped at 90% of the video. */
function applyCaptionWidth(b: Bound, maxW: number, size: number): void {
  if (getComputedStyle(b.overlay).display === 'none') return;
  const view = xVideoView(settingsRef().viewMode);
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

function xCapLog(info: unknown): void {
  try {
    if (localStorage.getItem('ibt-x-debug') !== '1') return;
  } catch { return; }
  console.log('[IBT x-cap]', info);
}

function usableCaptionRect(r: DOMRect, video: DOMRect): boolean {
  return r.width > 8 && r.height > 4 && r.height < video.height * 0.45
    && r.bottom > video.top && r.top < video.bottom + 24
    && r.top > video.top + video.height * 0.35;
}

function placeAll(): void {
  for (const [, b] of bounds) place(b, undefined, b.lastText);
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
