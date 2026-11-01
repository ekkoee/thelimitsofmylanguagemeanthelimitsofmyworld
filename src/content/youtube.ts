import { AlignedPair, Settings, TranslateBatchResponse, TranslateResponse } from '../core/types';
import { SELECTORS, queryFirst } from './selectors';
import { onUrlChange } from '../utils/observer';
import { el } from '../utils/dom';
import { extensionAlive, isContextGoneError, sendMessage } from '../utils/runtime';

const ROOT_FLAG = 'data-ibt-yt';
const SETTLE_MS = 180;
const POLL_MS = 100;
const EMPTY_GRACE_MS = 400;
const LOOKAHEAD = 64;           // max window to look ahead (not the batch size)
const CHUNK = 16;               // normal refill: at most this many cues per request
const URGENT_CHUNK = 4;         // the cue on screen right now: tiny request so it shows fast
const REFILL_BELOW = 12;        // only ask for more once the translated runway drops below this
const AHEAD_THROTTLE_MS = 400;
// Faces after YouTube's Latin stack. Must stay in this order: JhengHei is the
// Windows zh-TW face the caption actually draws; Noto is only a later fallback.
const ZH_CJK_TAIL = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", sans-serif';

export function withCjkTail(specified: string): string {
  const ff = specified.trim().replace(/;$/, '');
  if (/Microsoft JhengHei/i.test(ff)) return ff;
  if (/sans-serif\s*$/i.test(ff)) return ff.replace(/sans-serif\s*$/i, ZH_CJK_TAIL);
  return `${ff}, ${ZH_CJK_TAIL}`;
}

interface Word { t: number; w: string }
interface Cue {
  start: number; end: number; text: string;
  speechEnd?: number;          // ASR only: when the speech in this cue actually ends
  words?: Word[];              // ASR only: per-word start times
  rawEnd?: number;             // set by cleanCues: the cue's original end before the speech cut
  brk?: boolean;               // set by cleanCues: an annotation-only cue preceded this one
}

let controller: Controller | null = null;

export function startYouTube(getSettings: () => Settings): void {
  const boot = () => { controller?.destroy(); controller = new Controller(getSettings); void controller.start(); };
  boot();
  onUrlChange(() => boot());
}
export function updateYouTubeSettings(s: Settings): void { controller?.setSettings(s); }

// ---------------------------------------------------------------------------
// Controller: starts in the safe "DOM mode" (inject Chinese beside YouTube's own
// caption) and UPGRADES to "movie mode" the instant the page bridge intercepts
// the real subtitle track (which happens when the viewer turns captions on).
// ---------------------------------------------------------------------------
class Controller {
  private settings: Settings;
  private track?: TrackCaptions;
  private dom?: DomCaptions;
  private player: HTMLElement | null = null;
  private cancelled = false;
  private loadedToken = '';
  private onCues = (e: MessageEvent): void => this.handleCues(e);

  constructor(getSettings: () => Settings) { this.settings = getSettings(); }
  setSettings(s: Settings) { this.settings = s; this.track?.setSettings(s); this.dom?.setSettings(s); }

  async start(): Promise<void> {
    this.cancelled = false;
    window.addEventListener('message', this.onCues);

    this.player = await this.waitForPlayer();
    if (!this.player || this.cancelled) return;

    // Safe default: show the injected line beside YouTube's caption right away.
    this.dom = new DomCaptions(() => this.settings, this.player);
    this.dom.start();

    // Prompt the bridge in case captions were already on before we attached.
    window.postMessage({ source: 'ibt-iso', type: 'getCues' }, '*');
  }

  private handleCues(e: MessageEvent): void {
    if (this.cancelled || e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'ibt-main' || d.type !== 'cues' || !d.ok || !d.cues?.length) return;
    if (d.videoId && d.videoId !== currentVideoId()) return; // stale (previous video)

    const token = (d.videoId || '') + ':' + d.cues.length;
    if (token === this.loadedToken && this.track) return; // already showing this track
    this.loadedToken = token;

    const merged = mergeCues(cleanCues(d.cues as Cue[]), d.kind);
    console.log('[IBT] 字幕軌載入成功 →「電影模式」，', d.lang, '/', d.kind, '— 原始', d.cues.length, '句，合併為', merged.length, '句');
    this.dom?.destroy(); this.dom = undefined;            // hand off from fallback
    this.track?.destroy();
    if (this.player) { this.track = new TrackCaptions(() => this.settings, this.player, merged); this.track.start(); }
  }

  private async waitForPlayer(): Promise<HTMLElement | null> {
    for (let i = 0; i < 60 && !this.cancelled; i++) {
      const p = queryFirst(SELECTORS.youtube.player)[0] as HTMLElement | undefined;
      if (p) return p;
      await delay(500);
    }
    return null;
  }

  destroy(): void {
    this.cancelled = true;
    window.removeEventListener('message', this.onCues);
    this.track?.destroy(); this.dom?.destroy();
    this.track = undefined; this.dom = undefined;
  }
}

function currentVideoId(): string | null {
  try { return new URL(location.href).searchParams.get('v'); } catch { return null; }
}

// Keep the subtitle on what is being SAID: drop environment-sound annotations such as [Music], [Applause],
// (thunder rumbling), （呼嘯聲）, 【音楽】 and bare music-note marks. A cue that is nothing but annotation
// disappears; a cue like "[Music] Hello there" keeps "Hello there".
function stripSoundTags(t: string): string {
  let s = t.replace(/\[[^\]]*\]|［[^\］]*］|【[^】]*】/g, ' ').replace(/\([^()]{0,40}\)|（[^（）]{0,40}）/g, ' ').replace(/[♪♫♬]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s\-–—:;,]+/, '').replace(/[\s\-–—]+$/, '');
  return /[\p{L}\p{N}]/u.test(s) ? s : '';
}

function cleanCues(raw: Cue[]): Cue[] {
  const out: Cue[] = [];
  let brk = false;
  for (const c of raw) {
    const text = stripSoundTags(c.text);
    if (!text) {
      brk = true;
      continue;
    }
    // cut the cue where the speech ends (auto-generated tracks only; never earlier than 0.9 s after the start)
    const end = c.speechEnd ? Math.min(c.end, Math.max(c.speechEnd, c.start + 900)) : c.end;
    out.push({ start: c.start, end, rawEnd: c.end, text, words: text === c.text ? c.words : undefined, brk });
    brk = false;
  }
  return out;
}

// ONE unit = ONE complete sentence. It is the translation unit (the whole sentence is translated at once,
// so the Chinese reads naturally), the display unit (the whole Chinese sentence and the whole English
// sentence appear together) and the time window (from the first word of the sentence to its last word, so
// nothing from the previous sentence lingers and nothing shows in the pauses between sentences).
//
// Sentences are found on a word timeline: auto-generated tracks carry the start time of every word; for
// human-made tracks the words of a cue are spread evenly over the cue. A sentence may therefore start or
// end in the middle of a cue ("...two men. In the speech...") and still gets accurate boundaries.
const SENTENCE_END = /[.!?。！？]["'”’)\]]*$/;
const ELLIPSIS_END = /(?:\.\.\.|…)[\"'"”’)\]]*$/;
const ABBREVIATION = /^(?:(?:[A-Za-z]\.){1,4}|(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|mt)\.)$/i;
const FUNCTION_WORD = /^(?:a|an|the|and|or|but|so|to|of|in|on|at|for|with|that|which|who|as|if|than|because|from|by|is|are|was|were)$/i;

function isSentenceEnd(w: string): boolean {
  return SENTENCE_END.test(w) && !ELLIPSIS_END.test(w) && !ABBREVIATION.test(w);
}

interface Token { w: string; t: number; e: number; cue: number; brk?: boolean }

function cueTokens(c: Cue, cueNo: number): Token[] {
  let toks: { w: string; t: number }[];
  if (c.words && c.words.length) {
    toks = [];
    for (const x of c.words) for (const w of String(x.w).split(/\s+/)) if (w) toks.push({ w, t: x.t });
  } else {
    const words = c.text.split(/\s+/).filter(Boolean);
    const total = words.reduce((n, w) => n + w.length + 1, 0) || 1;
    const span = Math.max(1, c.end - c.start);
    let acc = 0;
    toks = words.map((w) => {
      const t = c.start + span * (acc / total);
      acc += w.length + 1;
      return { w, t };
    });
  }
  const out = toks as Token[];
  if (out.length && c.brk) out[0].brk = true;
  out.forEach((tk, i) => {
    tk.cue = cueNo;
    tk.e = i + 1 < out.length ? out[i + 1].t : c.end;
    if (tk.e < tk.t) tk.e = tk.t;
  });
  return out;
}

interface SegParams { pause: number; maxChars: number; maxSpan: number; terminators: boolean }

function segmentTokens(tokens: Token[], p: SegParams): Cue[] {
  const units: Cue[] = [];
  let cur: Token[] = [];
  const textOf = (ts: Token[]) => ts.map((x) => x.w).join(' ');
  const flush = (ts: Token[]) => {
    if (ts.length) units.push({ start: ts[0].t, end: ts[ts.length - 1].e, text: textOf(ts) });
  };
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (cur.length) {
      const gap = tk.t - cur[cur.length - 1].e;
      const len = textOf(cur).length + 1 + tk.w.length;
      const span = tk.e - cur[0].t;
      // subtitle convention: do not strand the last one to three words of a sentence as a unit of their own;
      // when the sentence ends within three words, let the unit run up to 25% over the limit instead
      let tail = 0;
      if (p.terminators) {
        for (let j = i; j < tokens.length && j < i + 3; j++) {
          if (isSentenceEnd(tokens[j].w)) {
            tail = j - i + 1;
            break;
          }
        }
      }
      const nearEnd = tail > 0 && len <= p.maxChars * 1.25 && span <= p.maxSpan * 1.25;
      if (gap > p.pause || tk.brk) {
        flush(cur);
        cur = [];
      } else if ((len > p.maxChars || span > p.maxSpan) && !nearEnd) {
        // too long for one box: cut at the last clause boundary (, ; : dash) past a third of the text,
        // otherwise right here
        let cut = -1;
        const need = textOf(cur).length * 0.35;
        for (let j = cur.length - 1; j > 0; j--) {
          if (/[,;:–—]$/.test(cur[j].w) && textOf(cur.slice(0, j + 1)).length >= need) {
            cut = j + 1;
            break;
          }
        }
        if (cut > 0) {
          flush(cur.slice(0, cut));
          cur = cur.slice(cut);
        } else {
          // subtitle convention: never leave a line ending on "the", "and", "to"...; carry up to two such
          // words over to the next unit
          let k = cur.length;
          while (k > 2 && cur.length - k < 2 && FUNCTION_WORD.test(cur[k - 1].w)) k--;
          flush(cur.slice(0, k));
          cur = cur.slice(k);
        }
      }
    }
    cur.push(tk);
    if (p.terminators && isSentenceEnd(tk.w)) {
      flush(cur);
      cur = [];
    }
  }
  flush(cur);
  return units;
}

function mergeCues(cues: Cue[], kind: string): Cue[] {
  const asr = kind === 'asr';
  let tokens: Token[] = [];
  cues.forEach((c, i) => {
    tokens = tokens.concat(cueTokens(c, i));
  });
  if (!tokens.length) return [];
  const ends = tokens.filter((t) => isSentenceEnd(t.w)).length;
  const punctuated = ends / tokens.length >= 0.015;
  let units: Cue[];
  if (punctuated) {
    units = segmentTokens(tokens, asr ? { pause: 2000, maxChars: 84, maxSpan: 7000, terminators: true } : { pause: 2500, maxChars: 100, maxSpan: 9000, terminators: true });
  } else if (!asr) {
    // human-made track with hardly any sentence punctuation (lyrics, short one-line captions): the author's
    // own cuts are the best unit there is
    units = cues.map((c) => ({ start: c.start, end: c.end, text: c.text }));
  } else {
    // auto-generated track WITHOUT punctuation: sentence ends cannot be known, so cut where the speaker
    // pauses or at about one and a half subtitle lines
    units = segmentTokens(tokens, { pause: 600, maxChars: 70, maxSpan: 6000, terminators: false });
  }
  units.sort((x, y) => x.start - y.start);
  const MIN_ON_SCREEN_MS = 1100;
  for (let i = 0; i < units.length; i++) {
    const nx = units[i + 1];
    if (units[i].end - units[i].start < MIN_ON_SCREEN_MS) {
      const want = units[i].start + MIN_ON_SCREEN_MS;
      units[i].end = nx ? Math.min(want, nx.start) : want;
    }
    if (nx && units[i].end > nx.start) units[i].end = nx.start;
    if (units[i].end <= units[i].start) units[i].end = units[i].start + 1;
  }
  return units;
}

// ---------------------------------------------------------------------------
// MOVIE MODE — render our own clean bilingual subtitle from the subtitle track,
// synced to video.currentTime. One sentence at a time, Chinese on top.
// ---------------------------------------------------------------------------
class TrackCaptions {
  private settings: Settings;
  private overlay?: HTMLDivElement;
  private enEl?: HTMLDivElement;
  private zhEl?: HTMLDivElement;
  private nativeFont?: string;
  private raf = 0;
  private lastIdx = -2;
  private everShown = false;
  private readonly trans = new Map<number, string>();
  private readonly inflight = new Set<number>();
  private lastAhead = 0;
  private cooldownUntil = 0;
  private warned = false;

  constructor(getSettings: () => Settings, private player: HTMLElement, private cues: Cue[]) {
    this.settings = getSettings();
  }
  setSettings(s: Settings) { this.settings = s; }
  start(): void { this.ensureOverlay(); this.loop(); }

  private video(): HTMLVideoElement | null { return this.player.querySelector('video'); }

  private loop = (): void => {
    // Extension reloaded/updated → this content script is dead. Stop the loop
    // (don't reschedule) and tear down, so we don't spam sendMessage failures.
    if (!extensionAlive()) { this.destroy(); return; }
    this.raf = requestAnimationFrame(this.loop);
    const s = this.settings;
    if (!s.enabled || !s.sites.youtube) { this.hide(); this.flag(false); return; }

    // only show while the viewer has captions turned on
    const ccOn = !!queryFirst(SELECTORS.youtube.captionWindow, this.player)[0];
    if (!ccOn) { this.hide(); this.flag(false); return; }

    const v = this.video();
    if (!v) return;
    const ms = v.currentTime * 1000;
    const idx = this.findCue(ms);
    this.ensureAhead(idx, ms);

    if (idx !== this.lastIdx) {
      this.lastIdx = idx;
      if (idx < 0) { this.hide(); }
      else {
        this.ensureOverlay();
        this.applyFont();
        this.applyOrder();
        this.setEn(this.cues[idx].text);
        this.setZh(this.trans.get(idx) || '');
        this.show();
      }
    } else if (idx >= 0) {
      const t = this.trans.get(idx);
      if (t && this.zhEl && this.zhEl.textContent !== t) this.setZh(t);
    }
    this.flag(this.everShown); // hide native only once we've shown a cue
  };

  private findCue(ms: number): number {
    const c = this.cues;
    let lo = 0, hi = c.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (ms < c[m].start) hi = m - 1;
      else if (ms >= c[m].end) lo = m + 1;
      else return m;
    }
    return -1;
  }

  private nextIdx(ms: number): number {
    const c = this.cues;
    let lo = 0, hi = c.length - 1, ans = c.length;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (c[m].start > ms) { ans = m; hi = m - 1; } else lo = m + 1; }
    return ans;
  }

  private ensureAhead(idx: number, ms: number): void {
    const now = Date.now();
    if (now - this.lastAhead < AHEAD_THROTTLE_MS) return;
    if (now < this.cooldownUntil) return;
    this.lastAhead = now;

    const base = Math.max(0, idx >= 0 ? idx : this.nextIdx(ms));
    const end = Math.min(this.cues.length - 1, base + LOOKAHEAD);
    const covered = (i: number) => this.trans.has(i) || this.inflight.has(i);
    // Refill with hysteresis: count the run of cues from the playhead that are already translated
    // or in flight, and only ask for more once that runway gets short. Sliding the window one cue
    // at a time meant one tiny request per cue, and a 64-sentence burst at start or after a seek,
    // which got the free engines and Gemini rate-limited (and then nothing showed at all).
    let runway = 0;
    for (let i = base; i <= end && covered(i); i++) runway++;
    if (runway >= REFILL_BELOW) return;
    const urgent = idx >= 0 && !covered(idx);
    const limit = urgent ? URGENT_CHUNK : CHUNK;
    const batch: number[] = [];
    for (let i = base; i <= end && batch.length < limit; i++) {
      if (!covered(i)) batch.push(i);
    }
    if (!batch.length) return;

    batch.forEach((i) => this.inflight.add(i));
    const texts = batch.map((i) => this.cues[i].text);
    translateBatch(texts)
      .then((arr) => {
        this.warned = false;
        let missing = 0;
        batch.forEach((i, k) => {
          const t = (arr[k] || '').trim();
          if (t) this.trans.set(i, t);
          else missing++;
        });
        if (missing) this.cooldownUntil = Date.now() + 3000;
      })
      .catch((err) => {
        if (isContextGoneError(err)) return; // extension reloaded → loop will stop itself
        const msg = String(err?.message ?? err);
        const quota = /\b429\b|quota|rate/i.test(msg);
        this.cooldownUntil = Date.now() + (quota ? 60000 : 4000); // quota: wait a minute; other: brief
        if (!this.warned) {
          this.warned = true;
          if (quota) console.warn('[IBT] 翻譯被限流（429），稍後自動重試。若使用 Gemini，請檢查 API key 的額度，或改用免費 Google 翻譯。');
          else console.warn('[IBT] 翻譯失敗：', msg, '（稍後重試）');
        }
      })
      .finally(() => batch.forEach((i) => this.inflight.delete(i)));
  }

  private ensureOverlay(): void {
    if (this.overlay && this.overlay.isConnected) return;
    if (getComputedStyle(this.player).position === 'static') this.player.style.position = 'relative';
    this.overlay = el('div', 'ibt-yt-overlay');
    this.nativeFont = undefined;
    this.zhEl = el('div', 'ibt-yt-zh');
    this.enEl = el('div', 'ibt-yt-en');
    this.overlay.append(this.zhEl, this.enEl); // Chinese on top
    this.overlay.style.display = 'none';
    this.player.appendChild(this.overlay);
  }

  private applyFont(): void {
    const base = Math.min(46, Math.max(16, this.player.clientHeight * 0.036));
    const size = Math.round(base * this.settings.fontScale);
    if (this.enEl) this.enEl.style.fontSize = `${size}px`;
    if (this.zhEl) {
      this.zhEl.style.fontSize = `${size}px`;
      this.zhEl.lang = this.settings.targetLangCode || 'zh-TW';
    }
    this.syncNativeFont();
  }

  private syncNativeFont(): void {
    // Use YouTube's own caption typeface (including any font the viewer picked in YouTube's caption
    // settings) by reading it from a live native caption segment. The native caption is hidden
    // while our overlay is up, but its computed style is still readable. Until one has been seen,
    // bilingual.css falls back to YouTube's default caption font stack.
    if (!this.overlay) return;
    const seg = this.player.querySelector('.ytp-caption-segment');
    if (!seg) return;
    const ff = getComputedStyle(seg).fontFamily;
    if (ff && ff !== this.nativeFont) {
      this.nativeFont = ff;
      // Page translations on this tab share the caption stack. Keep the CJK
      // tail so Han still resolves to Microsoft JhengHei after the Latin faces.
      document.documentElement.style.setProperty('--ibt-zh-font', withCjkTail(ff));
    }
  }

  private applyOrder(): void {
    const zhTop = this.settings.subtitleOrder !== 'enTop';
    if (this.zhEl) this.zhEl.style.order = zhTop ? '0' : '1';
    if (this.enEl) this.enEl.style.order = zhTop ? '1' : '0';
  }

  private setEn(t: string): void { if (this.enEl && this.enEl.textContent !== t) this.enEl.textContent = t; }
  private setZh(t: string): void {
    if (this.zhEl) { if (this.zhEl.textContent !== t) this.zhEl.textContent = t || ''; this.zhEl.style.display = t ? '' : 'none'; }
  }

  private flag(on: boolean): void {
    const r = document.documentElement;
    if (on) { if (r.getAttribute(ROOT_FLAG) !== 'on') r.setAttribute(ROOT_FLAG, 'on'); }
    else if (r.getAttribute(ROOT_FLAG) === 'on') r.removeAttribute(ROOT_FLAG);
  }

  private show(): void { if (this.overlay) { this.overlay.style.display = 'flex'; this.everShown = true; } }
  private hide(): void { if (this.overlay) this.overlay.style.display = 'none'; }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.flag(false);
    this.overlay?.remove();
    this.overlay = undefined; this.enEl = undefined; this.zhEl = undefined;
  }
}

// ---------------------------------------------------------------------------
// DOM MODE (fallback) — inject a Chinese line beside YouTube's on-screen
// caption. Native English is never hidden, so captions never vanish.
// ---------------------------------------------------------------------------
function stripCaptionHint(t: string): string {
  return t
    .replace(/\s*\S*\s*\((?:auto-generated|自動產生|自动生成)\).*$/i, '')
    .replace(/\s*(?:tap|click|按一下|輕觸)\s*(?:to\s*)?(?:進入設定|enter settings|view settings|設定).*$/i, '')
    .trim();
}

class DomCaptions {
  private settings: Settings;
  private timer?: number;
  private settle?: number;
  private lineEl?: HTMLDivElement;
  private spanEl?: HTMLSpanElement;
  private curText = '';
  private lastTrans = '';
  private lastSeen = 0;

  constructor(getSettings: () => Settings, private player: HTMLElement) { this.settings = getSettings(); }
  setSettings(s: Settings) { this.settings = s; if (!s.enabled || !s.sites.youtube) this.removeLine(); }
  start(): void { this.timer = setInterval(() => this.tick(), POLL_MS) as unknown as number; this.tick(); }

  private tick(): void {
    // Extension reloaded/updated → stop polling cleanly.
    if (!extensionAlive()) { this.removeLine(); if (this.timer) clearInterval(this.timer); return; }
    const p = this.player;
    const s = this.settings;
    if (!s.enabled || !s.sites.youtube) { this.removeLine(); return; }

    const container = queryFirst(SELECTORS.youtube.captionWindow, p)[0] as HTMLElement | undefined;
    const segs = container ? queryFirst(SELECTORS.youtube.captionSegment, container) : [];
    let text = segs.map((n) => (n as HTMLElement).innerText).join(' ').replace(/\s+/g, ' ').trim();
    text = stripSoundTags(stripCaptionHint(text));

    const now = Date.now();
    if (!text || !container) {
      if (now - this.lastSeen > EMPTY_GRACE_MS) { this.removeLine(); this.curText = ''; }
      return;
    }
    this.lastSeen = now;

    const win = (queryFirst(SELECTORS.youtube.captionWindowInner, container)[0] as HTMLElement) || container;
    this.ensureLine(win);
    this.applyFont();
    if (text !== this.curText) {
      this.curText = text;
      if (this.settle) clearTimeout(this.settle);
      this.settle = setTimeout(() => this.doTranslate(text), SETTLE_MS) as unknown as number;
    }
  }

  private async doTranslate(text: string): Promise<void> {
    if (text !== this.curText) return;
    try {
      const pairs = await translateBlock(text);
      const t = pairs.map((p) => p.t).filter(Boolean).join(' ');
      if (this.curText === text) { this.lastTrans = t; this.setText(t); }
    } catch { /* English stays visible */ }
  }

  private host(win: HTMLElement): HTMLElement {
    const tb = win.querySelector('.captions-text') as HTMLElement | null;
    return (tb?.parentElement as HTMLElement) || win;
  }
  private ensureLine(win: HTMLElement): void {
    if (!this.lineEl) {
      this.lineEl = el('div', 'ibt-yt-line');
      this.spanEl = el('span');
      this.spanEl.lang = this.settings.targetLangCode || 'zh-TW';
      this.lineEl.appendChild(this.spanEl);
    }
    const host = this.host(win);
    if (this.lineEl.isConnected && this.lineEl.parentElement === host) return;
    const tb = win.querySelector('.captions-text') as HTMLElement | null;
    host.insertBefore(this.lineEl, tb ?? host.firstChild); // Chinese on top
    this.setText(this.lastTrans);
  }
  private applyFont(): void {
    if (!this.spanEl) return;
    const base = Math.min(46, Math.max(16, this.player.clientHeight * 0.036));
    this.spanEl.style.fontSize = `${Math.round(base * this.settings.fontScale)}px`;
  }
  private setText(t: string): void {
    if (this.spanEl && this.spanEl.textContent !== t) this.spanEl.textContent = t || '';
    if (this.lineEl) this.lineEl.style.display = t ? '' : 'none';
  }
  private removeLine(): void { this.lineEl?.remove(); }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.settle) clearTimeout(this.settle);
    this.lineEl?.remove();
    this.lineEl = undefined; this.spanEl = undefined; this.curText = ''; this.lastTrans = '';
  }
}

// ---- helpers ----
async function translateBlock(text: string): Promise<AlignedPair[]> {
  // DOM-caption fallback → keep the subtitle register (no page-title context).
  const resp = await sendMessage<TranslateResponse>({ type: 'translate', text, mode: 'subtitle' });
  if (!resp?.ok) throw new Error(resp?.error || 'failed');
  return resp.pairs || [];
}

async function translateBatch(texts: string[]): Promise<string[]> {
  const resp = await sendMessage<TranslateBatchResponse>({ type: 'translateBatch', texts });
  if (!resp?.ok) throw new Error(resp?.error || 'failed');
  return resp.translations || [];
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
