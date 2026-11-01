// Bilingual captions for Netflix watch pages.
//
// Netflix draws the current cue as DOM under .player-timedtext. There is no
// subtitle file to intercept. We watch that layer, translate the cue through
// the same pipeline as X, and draw Chinese just above the native line.
//
// The real player was not available (no account). Selectors are the long-lived
// public ones, with class/data fallbacks. Set localStorage ibt-nf-debug=1 for
// [IBT nf-cap] logs.
import { Settings, TranslateResponse } from '../core/types';
import { sendMessage } from '../utils/runtime';
import { el } from '../utils/dom';
import { onUrlChange } from '../utils/observer';
import { Rect, overlayUsedWidth, xCaptionFontPx } from './x-vtt';
import {
  NF_CUE_SELECTOR, NF_PLAYER_SELECTOR, NF_TIMED_SELECTOR,
  isNetflixWatch, nfHidesNative, nfOverlayBottom, nfVideoView, readNetflixCue,
} from './netflix-cap';

const DEBOUNCE_MS = 140;
let settingsRef: () => Settings = () => ({} as Settings);
const cache = new Map<string, string>();
const inflight = new Set<string>();

let player: HTMLElement | null = null;
let video: HTMLVideoElement | null = null;
let overlay: HTMLDivElement | null = null;
let zhEl: HTMLDivElement | null = null;
let enEl: HTMLDivElement | null = null;
let hidden: HTMLElement[] = [];
let playerObs: MutationObserver | null = null;
let readTimer = 0;
let translateTimer = 0;
let generation = 0;
let lastCue = '';
let layoutKey = '';

export function startNetflix(getSettings: () => Settings): void {
  settingsRef = getSettings;
  nfLog('content script ready', location.href);
  const root = document.documentElement;
  const docObs = new MutationObserver(() => scheduleRead());
  docObs.observe(root, { childList: true, subtree: true });
  onUrlChange((url) => {
    nfLog('navigation', url);
    lastCue = '';
    generation++;
    layoutKey = '';
    if (!isNetflixWatch(url)) teardown();
    else scheduleRead();
  });
  document.addEventListener('fullscreenchange', () => place());
  window.addEventListener('resize', () => place());
  scheduleRead();
}

export function updateNetflixSettings(s: Settings): void {
  settingsRef = () => s;
  if (!enabled()) {
    showNative();
    if (overlay) overlay.style.setProperty('display', 'none', 'important');
    return;
  }
  if (lastCue) show(lastCue, cache.get(norm(lastCue)) || '');
}

function enabled(): boolean {
  const s = settingsRef();
  return !!s?.enabled && s?.sites?.netflix !== false && isNetflixWatch(location.href);
}

function scheduleRead(): void {
  if (readTimer) clearTimeout(readTimer);
  readTimer = window.setTimeout(read, 60);
}

function read(): void {
  readTimer = 0;
  if (!enabled()) {
    teardown();
    return;
  }
  const nextVideo = mainVideo();
  if (!nextVideo) {
    nfLog('no video');
    return;
  }
  ensure(nextVideo);
  const cue = readNetflixCue(player || document);
  if (cue === lastCue) {
    place();
    return;
  }
  lastCue = cue;
  generation++;
  const gen = generation;
  nfLog('cue', cue.slice(0, 120) || '(empty)');
  if (!cue) {
    clearTimer();
    hide();
    showNative();
    return;
  }
  const hit = cache.get(norm(cue));
  if (hit) {
    show(cue, hit);
    return;
  }
  // Don't keep the previous episode's Chinese on the new line.
  show(cue, '');
  clearTimer();
  translateTimer = window.setTimeout(() => { void translate(cue, gen); }, DEBOUNCE_MS);
}

function clearTimer(): void {
  if (translateTimer) { clearTimeout(translateTimer); translateTimer = 0; }
}

function mainVideo(): HTMLVideoElement | null {
  const vids = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
  let best: HTMLVideoElement | null = null;
  let area = 0;
  for (const v of vids) {
    if (v.closest('.ibt-nf-overlay')) continue;
    const r = v.getBoundingClientRect();
    const a = Math.max(0, r.width) * Math.max(0, r.height);
    if (a > area) { area = a; best = v; }
  }
  return best;
}

function ensure(v: HTMLVideoElement): void {
  const shell = (v.closest(NF_PLAYER_SELECTOR) as HTMLElement) || v.parentElement || v;
  if (player === shell && video === v && overlay?.isConnected) return;
  if (player !== shell) {
    playerObs?.disconnect();
    playerObs = new MutationObserver(() => scheduleRead());
    playerObs.observe(shell, { subtree: true, childList: true, characterData: true });
    nfLog('player', shell.className || shell.tagName);
  }
  video = v;
  player = shell;
  if (!overlay) {
    overlay = el('div', 'ibt-nf-overlay');
    zhEl = el('div', 'ibt-yt-zh');
    enEl = el('div', 'ibt-yt-en');
    overlay.append(zhEl, enEl);
    overlay.style.display = 'none';
  }
  shell.querySelectorAll('.ibt-nf-overlay').forEach((n) => { if (n !== overlay) n.remove(); });
  if (overlay.parentElement !== shell) {
    if (getComputedStyle(shell).position === 'static') shell.style.position = 'relative';
    shell.appendChild(overlay);
  }
}

function teardown(): void {
  showNative();
  playerObs?.disconnect();
  playerObs = null;
  overlay?.remove();
  player = null;
  video = null;
  lastCue = '';
}

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

async function translate(cue: string, gen: number): Promise<void> {
  const t = cue.trim();
  const key = norm(t);
  if (!t || !enabled()) return;
  if (cache.has(key)) {
    if (gen === generation) show(cue, cache.get(key) || '');
    return;
  }
  if (inflight.has(key)) return;
  inflight.add(key);
  nfLog('request sent', t.slice(0, 80));
  try {
    const resp = await sendMessage<TranslateResponse>({ type: 'translate', text: t, mode: 'subtitle' });
    const zh = (resp?.pairs || []).map((p) => p.t).filter(Boolean).join('\n');
    if (zh) cache.set(key, zh);
    if (gen === generation) show(cue, zh || '');
  } catch (err) {
    nfLog('request failed', err);
  }
  inflight.delete(key);
}

function show(en: string, zh: string): void {
  if (!overlay || !zhEl || !enEl) return;
  const mode = nfVideoView(settingsRef().viewMode);
  const order = settingsRef().subtitleOrder !== 'enTop';
  zhEl.style.order = order ? '0' : '1';
  enEl.style.order = order ? '1' : '0';
  zhEl.lang = settingsRef().targetLangCode || 'zh-TW';
  zhEl.textContent = zh;
  enEl.textContent = en;
  zhEl.style.display = zh ? '' : 'none';
  if (mode === 'both' && en) enEl.style.removeProperty('display');
  else enEl.style.setProperty('display', 'none', 'important');
  const on = mode !== 'orig' && !!zh;
  overlay.style.setProperty('display', on ? 'flex' : 'none', 'important');
  if (nfHidesNative(settingsRef().viewMode) && en) hideNative();
  else showNative();
  place();
}

function hide(): void {
  overlay?.style.setProperty('display', 'none', 'important');
  showNative();
}

function cueBox(): HTMLElement | null {
  if (!player) return null;
  const timed = player.querySelector(NF_TIMED_SELECTOR);
  if (!timed) return null;
  const hosts = timed.querySelectorAll(NF_CUE_SELECTOR);
  const host = (hosts.length ? hosts[hosts.length - 1] : timed) as HTMLElement;
  const r = host.getBoundingClientRect();
  if (r.width < 8 || r.height < 4) return null;
  return host;
}

function hideNative(): void {
  showNative();
  const box = cueBox();
  if (!box) return;
  box.classList.add('ibt-nf-native');
  box.style.setProperty('visibility', 'hidden', 'important');
  hidden = [box];
}

function showNative(): void {
  for (const n of hidden) {
    n.classList.remove('ibt-nf-native');
    n.style.removeProperty('visibility');
  }
  hidden = [];
}

function place(): void {
  if (!overlay || !video || !player) return;
  if (getComputedStyle(overlay).display === 'none') return;
  const fs = document.fullscreenElement as HTMLElement | null;
  const parent = fs && fs.contains(video) ? fs : player;
  if (overlay.parentElement !== parent) {
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.appendChild(overlay);
  }
  const vr = video.getBoundingClientRect();
  if (vr.width < 20 || vr.height < 20) return;
  const fixed = fs === video;
  const pr = parent.getBoundingClientRect();
  const cap = cueBox();
  const cr = cap?.getBoundingClientRect();
  const cue = lastCue;
  const font = xCaptionFontPx(vr.width, vr.height, settingsRef().fontScale || 1);
  const textWidth = measureWidth(cue.replace(/\n/g, ' '), font);
  const videoRect: Rect = { left: vr.left, top: vr.top, width: vr.width, height: vr.height, bottom: vr.bottom, right: vr.right };
  const layout = nfOverlayBottom({
    video: videoRect,
    parentBottom: fixed ? window.innerHeight : pr.bottom,
    captionTop: cr && cr.height > 4 ? cr.top : null,
    captionHeight: cr?.height,
    cue,
    textWidth,
    fontScale: settingsRef().fontScale || 1,
    fixed,
    viewportHeight: window.innerHeight,
  });
  const center = (vr.left + vr.width / 2) - (fixed ? 0 : pr.left);
  const maxW = Math.max(80, Math.round(vr.width * 0.9));
  const s = overlay.style;
  s.setProperty('position', fixed ? 'fixed' : 'absolute', 'important');
  s.setProperty('left', `${Math.round(center)}px`, 'important');
  s.setProperty('bottom', `${layout.bottom}px`, 'important');
  s.setProperty('transform', 'translateX(-50%)', 'important');
  s.setProperty('margin', '0', 'important');
  s.setProperty('right', 'auto', 'important');
  s.setProperty('top', 'auto', 'important');
  s.setProperty('z-index', '4', 'important');
  s.setProperty('font-size', `${layout.fontPx}px`, 'important');
  s.setProperty('max-width', `${maxW}px`, 'important');
  const key = `${cue}\n${zhEl?.textContent}\n${layout.fontPx}\n${maxW}`;
  if (key !== layoutKey && zhEl && enEl) {
    layoutKey = key;
    const textW = Math.max(measureWidth(zhEl.textContent || '', layout.fontPx), measureWidth(enEl.textContent || '', layout.fontPx));
    const used = textW > 0 ? overlayUsedWidth(textW, 20, maxW) : maxW;
    s.setProperty('width', `${used}px`, 'important');
  }
  nfLog({
    branch: layout.branch, bottom: layout.bottom, lines: layout.lines,
    font: layout.fontPx, reserve: layout.reserve, fixed, cue: cue.slice(0, 80),
  });
}

function measureWidth(text: string, fontPx: number): number {
  if (!text) return 0;
  const probe = document.createElement('div');
  probe.textContent = text;
  probe.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap;font-size:${fontPx}px;font-family:var(--ibt-zh-font),sans-serif`;
  (document.body || document.documentElement).appendChild(probe);
  const w = probe.offsetWidth;
  probe.remove();
  return w;
}

function nfLog(info: unknown, extra?: unknown): void {
  try {
    if (localStorage.getItem('ibt-nf-debug') !== '1') return;
  } catch { return; }
  if (extra === undefined) console.log('[IBT nf-cap]', info);
  else console.log('[IBT nf-cap]', info, extra);
}
