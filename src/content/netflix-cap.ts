// Netflix paints timed text in the player DOM (not a WebVTT track we can intercept).
// These selectors are the ones that have stayed on www.netflix.com/watch for years,
// plus a few attribute/class fallbacks. The live player was not available here.
import { Rect, X_CAPTION_GAP, cueLineCount, nativeCueFontPx, nativeCueReservePx, overlayBottomAbove, overlayBottomClearingCue, xCaptionFontPx, xVideoView } from './x-vtt';

/** Player shell on a watch page. Captions and controls live under this. */
export const NF_PLAYER_SELECTOR = [
  '[data-uia="watch-video"]',
  '.watch-video',
  '.watch-video--player-view',
  '.nf-player-container',
  '.NFPlayer',
  '.AkiraPlayer',
  '[data-uia="player"]',
].join(',');

/** The layer Netflix uses for burned-in-style DOM captions. */
export const NF_TIMED_SELECTOR = [
  '.player-timedtext',
  '[data-uia="player-timedtext"]',
  '[class*="player-timedtext"]',
  '[class*="PlayerTimedtext"]',
  '[data-uia*="timedtext"]',
  '[data-uia*="timed-text"]',
].join(',');

/** The positioned box that holds the current cue's lines. */
export const NF_CUE_SELECTOR = [
  '.player-timedtext-text-container',
  '[class*="timedtext-text-container"]',
  '[class*="timed-text-container"]',
  '[class*="player-timedtext-text"]',
].join(',');

export function isNetflixWatch(url: string): boolean {
  try {
    const u = new URL(url, 'https://www.netflix.com');
    return /(^|\.)netflix\.com$/i.test(u.hostname) && /^\/watch\/\d+/.test(u.pathname);
  } catch {
    return /netflix\.com\/watch\/\d+/i.test(url);
  }
}

/** Same rule as X: one stacked caption unless the viewer picked original-only. */
export function nfVideoView(explicit: string | undefined | null): 'zh' | 'both' | 'orig' {
  return xVideoView(explicit);
}

/** Our box replaces the native line in every view except 只顯示原文. */
export function nfHidesNative(explicit: string | undefined | null): boolean {
  return nfVideoView(explicit) !== 'orig';
}

/** Player chrome that sometimes sits near the picture but is not a caption line. */
export function isNetflixChromeCue(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (/^(skip intro|skip recap|next episode|subtitles?|audio|audio & subtitles|pause|play|mute|unmute)$/i.test(t)) return true;
  if (/^\d+:\d{2}(:\d{2})?$/.test(t)) return true;
  return false;
}

function leafLines(host: Element): string[] {
  const spans = Array.from(host.querySelectorAll('span'));
  const leaves = spans.filter((s) => !s.querySelector('span'));
  const lines = leaves
    .map((s) => (s.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (lines.length) return lines;
  const whole = (host.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n').trim();
  return whole ? [whole.replace(/\s*\n\s*/g, '\n')] : [];
}

/** Cue boxes that are not nested inside another cue box. */
function topCueHosts(timed: Element): Element[] {
  const all = Array.from(timed.querySelectorAll(NF_CUE_SELECTOR));
  if (!all.length) return [timed];
  return all.filter((h) => !all.some((other) => other !== h && other.contains(h)));
}

/** Current cue inside a player or a timed-text node. Empty when captions are off. */
export function readNetflixCue(root: ParentNode): string {
  const el = root as Element;
  const timed = (typeof el.matches === 'function' && el.matches(NF_TIMED_SELECTOR) ? el : null)
    || root.querySelector(NF_TIMED_SELECTOR);
  if (!timed) return '';
  const lines = topCueHosts(timed).flatMap((host) => leafLines(host));
  const text = lines.join('\n').trim();
  if (isNetflixChromeCue(text)) return '';
  return text;
}

export interface NfLayout {
  bottom: number;
  fontPx: number;
  reserve: number;
  lines: number;
  branch: 'measured' | 'reserve';
}

/**
 * CSS `bottom` for the Chinese box. A measured caption top lifts the box
 * (6px gap, same as X). The line-count reserve is a floor so a short rect
 * cannot pull the Chinese down onto the English.
 */
export function nfOverlayBottom(args: {
  video: Rect;
  parentBottom: number;
  captionTop: number | null;
  captionHeight?: number;
  cue: string;
  textWidth: number;
  fontScale?: number;
  fixed?: boolean;
  viewportHeight?: number;
}): NfLayout {
  const font = Math.max(
    nativeCueFontPx(args.video.height),
    xCaptionFontPx(args.video.width, args.video.height, args.fontScale || 1),
  );
  const maxW = Math.max(40, args.video.width * 0.9);
  let lines = cueLineCount(args.cue || ' ', args.textWidth, maxW);
  if (args.captionHeight && args.captionHeight > font) {
    lines = Math.max(lines, Math.round(args.captionHeight / font));
  }
  const reserve = nativeCueReservePx(font, lines);
  const letterbox = args.fixed
    ? Math.max(0, (args.viewportHeight || 0) - args.video.bottom)
    : Math.max(0, args.parentBottom - args.video.bottom);
  let bottom = overlayBottomClearingCue(letterbox, 0, reserve);
  let branch: NfLayout['branch'] = 'reserve';
  if (args.captionTop != null && args.captionTop < args.video.bottom - 4) {
    const fromRect = args.fixed
      ? ((args.viewportHeight || 0) - args.captionTop + X_CAPTION_GAP)
      : overlayBottomAbove(args.parentBottom, args.captionTop);
    if (fromRect > bottom) {
      bottom = fromRect;
      branch = 'measured';
    }
  }
  return { bottom: Math.round(bottom), fontPx: font, reserve, lines, branch };
}
