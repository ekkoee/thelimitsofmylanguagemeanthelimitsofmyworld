// X serves closed captions as WebVTT from video.twimg.com/subtitles/...
// Each cue is wrapped in <X-word-ms ms=... character_ranges=...>text</X-word-ms>.
// The visible line is the text; the tag is only word timing.

export interface XCue {
  start: number; // ms
  end: number;
  text: string;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.](\d{1,3})/;

export function stripXTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function toMs(h: string | undefined, m: string, s: string, frac: string): number {
  const hours = h ? Number(h) : 0;
  const ms = Number((frac + '000').slice(0, 3));
  return ((hours * 60 + Number(m)) * 60 + Number(s)) * 1000 + ms;
}

/** Pull timed lines out of an X WebVTT file. Empty and tag-only cues are dropped. */
export function parseXVtt(vtt: string): XCue[] {
  const src = vtt.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const blocks = src.split(/\n{2,}/);
  const cues: XCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx === -1) continue;
    const parts = lines[timeIdx].split(/\s+-->\s+/);
    if (parts.length < 2) continue;
    const a = TIME.exec(parts[0]);
    const b = TIME.exec(parts[1]);
    if (!a || !b) continue;
    const text = stripXTags(lines.slice(timeIdx + 1).join(' '));
    if (!text) continue;
    const start = toMs(a[1], a[2], a[3], a[4]);
    let end = toMs(b[1], b[2], b[3], b[4]);
    if (end <= start) end = start + 1200;
    cues.push({ start, end, text });
  }
  cues.sort((x, y) => x.start - y.start);
  return cues;
}

/** Numeric media id inside an X subtitle or thumbnail URL, or ''. */
export function mediaIdFromUrl(url: string): string {
  const m = url.match(/\/(?:subtitles|amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb|amplify_video|ext_tw_video)\/(?:amplify_video|ext_tw_video|tweet_video)?\/?(\d{6,})/);
  if (m) return m[1];
  const m2 = url.match(/\/(\d{10,})\//);
  return m2 ? m2[1] : '';
}

/** Subtitle file or playlist URLs mentioned by an HLS manifest. */
export function subtitleUris(playlist: string, baseUrl: string): string[] {
  const out: string[] = [];
  const lines = playlist.split(/\r?\n/);
  for (const line of lines) {
    const tagged = /TYPE=SUBTITLES/i.test(line) ? line.match(/URI="([^"]+)"/) : null;
    const raw = tagged?.[1] || (/^[^#].+\.vtt(\?|$)/i.test(line.trim()) ? line.trim() : '');
    if (!raw) continue;
    try { out.push(new URL(raw, baseUrl).href); } catch { /* bad uri */ }
  }
  return out;
}

/**
 * Player chrome that is painted on the video but is not a caption:
 * the "From @account" source chip, a duration, a view count, GIF/ALT badges.
 * A spoken line that merely starts with "From" and runs past a short name is kept.
 */
export function isPlayerChromeText(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (/^(gif|alt)$/i.test(t)) return true;
  if (/^\d+:\d{2}(:\d{2})?(\s*\/\s*\d+:\d{2}(:\d{2})?)?$/.test(t)) return true;
  if (/^[\d.,]+\s*[kmbt]?\s*(views?|次觀看|次观看)?$/i.test(t)) return true;
  if (/^(play|pause|mute|unmute|fullscreen|exit fullscreen|settings|closed captions?|subtitles?|cc|replay|volume)$/i.test(t)) return true;
  // "From AmericaAmerica", "From @name", "來自 AmericaAmerica" — a name, not a sentence.
  // CJK has no word boundary after 來自, so that prefix is matched on its own.
  if (/[.?!。！？]/.test(t)) return false;
  if (/^from\b/i.test(t) || /^(?:來自|来自)(?:\s|$)/u.test(t)) {
    const words = t.split(/\s+/).length;
    if (words <= 4 && t.length <= 48) return true;
  }
  return false;
}

/**
 * X draws captions across the middle of the picture. The source chip, the
 * clock, and GIF/ALT badges sit in a corner and do not cross the center.
 */
export function isCenteredCaption(node: Rect, video: Rect): boolean {
  if (video.width < 40 || node.width < 24 || node.height < 8) return false;
  const videoCenter = video.left + video.width / 2;
  const crossesCenter = node.left <= videoCenter && node.right >= videoCenter;
  if (crossesCenter) return true;
  const mid = node.left + node.width / 2;
  return Math.abs(mid - videoCenter) <= Math.max(24, video.width * 0.12);
}

/** Lower-half, on-picture line that is a caption rather than player chrome. */
export function isXCaptionText(text: string, node: Rect, video: Rect): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 8 || t.length > 240) return false;
  if (isPlayerChromeText(t)) return false;
  if (node.height > video.height * 0.45) return false;
  const midY = node.top + node.height / 2;
  if (midY < video.top + video.height * 0.5 || midY > video.bottom + 4) return false;
  if (node.left < video.left - 12 || node.right > video.right + 12) return false;
  return isCenteredCaption(node, video);
}

/**
 * What a video draws. Chinese and English share one caption box (order comes
 * from 影片字幕順序). An explicit 只顯示中文 / 只顯示原文 still wins.
 * Unset stays bilingual so the native line can be hidden instead of leaving
 * a second caption under ours.
 */
export function xVideoView(explicit: string | undefined | null): 'zh' | 'both' | 'orig' {
  if (explicit === 'zh' || explicit === 'both' || explicit === 'orig') return explicit;
  return 'both';
}

/** Our box is on screen, so the player's own text track must not also show. */
export function hidesNativeCaption(explicit: string | undefined | null): boolean {
  return xVideoView(explicit) !== 'orig';
}

/**
 * `nodeText` is the cue, or a piece of it (a word span). A container that
 * holds the cue plus other UI is longer than the cue and does not match.
 */
export function captionTextMatches(nodeText: string, cue: string): boolean {
  if (!nodeText || !cue) return false;
  if (nodeText === cue) return true;
  if (Math.abs(nodeText.length - cue.length) <= 2 && (nodeText.startsWith(cue.slice(0, 16)) || cue.startsWith(nodeText.slice(0, 16)))) return true;
  return nodeText.length >= 8 && nodeText.length < cue.length && cue.includes(nodeText);
}

/** Fixed gap between our Chinese line and X's native English caption, in px. */
export const X_CAPTION_GAP = 6;

/**
 * WebVTT's default cue font is 5% of the video height. Inline X players often
 * paint that cue with ::cue, which has no element rect, and the old bottom
 * margin (about 6% of height) lands inside the cue instead of above it.
 */
export function nativeCueFontPx(videoHeight: number): number {
  return Math.round(Math.min(32, Math.max(12, Math.max(0, videoHeight) * 0.05)));
}

/** How many rows the native cue occupies: hard breaks, or wrapping at maxWidth. */
export function cueLineCount(text: string, textWidth: number, maxWidth: number): number {
  const hard = text.split(/\n/).map((s) => s.trim()).filter(Boolean).length || 1;
  const inner = Math.max(40, maxWidth);
  const wrapped = Math.max(1, Math.ceil(Math.max(textWidth, 1) / inner));
  return Math.max(hard, wrapped);
}

/**
 * Pixel height of the native cue block (not including the 6px gap above it).
 * 1.7em plus padding is larger than Chrome's ::cue line box on purpose: a short
 * estimate is what put the Chinese line on top of the English in the timeline.
 */
export function nativeCueReservePx(fontPx: number, lineCount: number): number {
  const font = Math.max(12, fontPx);
  const lines = Math.max(1, Math.round(lineCount) || 1);
  return Math.round(lines * font * 1.7 + 8);
}

/**
 * CSS `bottom` when the cue has no box to measure: letterbox and the control
 * bar, then the cue block, then the same 6px gap used when the box is known.
 */
export function overlayBottomClearingCue(letterbox: number, controlsOverlap: number, reservePx: number, gap = X_CAPTION_GAP): number {
  return Math.round(Math.max(0, letterbox) + Math.max(0, controlsOverlap) + Math.max(0, reservePx) + gap);
}

/**
 * Font size from the rendered video box. A portrait clip is tall and narrow,
 * so the width drives the size; height only caps it. 310px-wide timeline
 * players stay near X's own caption size instead of covering the face.
 */
export function xCaptionFontPx(width: number, height: number, fontScale = 1): number {
  const basis = Math.min(Math.max(0, width), Math.max(0, height));
  const px = Math.min(32, Math.max(12, basis * 0.046));
  return Math.round(px * (fontScale || 1));
}

/**
 * Border-box width for the caption. Hugs the unwrapped line, but never exceeds
 * `maxWidth` (about 90% of the player) so a narrow column cannot collapse to
 * the longest token. The extra pixel avoids a rounding wrap on a line that fits.
 */
export function overlayUsedWidth(textWidth: number, paddingX: number, maxWidth: number): number {
  const cap = Math.round(Math.max(0, maxWidth));
  if (cap <= 0) return 0;
  const natural = Math.ceil(Math.max(0, textWidth) + Math.max(0, paddingX) + 1);
  return Math.min(natural, cap);
}

/**
 * CSS `bottom` for an overlay whose bottom edge sits `gap` px above `captionTop`,
 * inside a parent whose viewport bottom is `parentBottom`.
 * A taller native caption moves `captionTop` up, and this follows, so the gap stays put.
 */
export function overlayBottomAbove(parentBottom: number, captionTop: number, gap = X_CAPTION_GAP): number {
  return parentBottom - captionTop + gap;
}

/**
 * Caption box in the player's coordinate space, centered on the video picture
 * and lifted above the control bar and any bottom letterbox.
 * Used only when X is not showing its own caption element.
 */
export function xCaptionBox(video: Rect, player: Rect, controlsOverlap: number): { center: number; bottom: number; maxWidth: number } {
  const letterbox = Math.max(0, player.bottom - video.bottom);
  const margin = Math.round(Math.max(8, video.height * 0.06));
  const bottom = Math.round(letterbox + margin + Math.max(0, controlsOverlap));
  const center = Math.round((video.left - player.left) + video.width / 2);
  const maxWidth = Math.max(80, Math.round(video.width * 0.92));
  return { center, bottom, maxWidth };
}
