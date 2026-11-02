// Pure layout decisions for "translate any page". Kept DOM-free so the
// misplacement cases (flex row, grid, absolute captions) can be unit-tested.

export type Placement = 'sibling' | 'inside' | 'overlay';

export interface LayoutSnap {
  /** False for text-node anchors (X line splits). Those stay siblings. */
  anchorIsElement: boolean;
  /** Absolutely positioned caption / player overlay. */
  caption: boolean;
  /** Source uses line-clamp; a child would be clipped, so don't append inside. */
  clamped: boolean;
  parentDisplay: string;
  parentFlexDirection: string;
  parentFlexWrap: string;
  selfDisplay: string;
  selfFlexDirection: string;
  selfFlexWrap: string;
}

function isRowNowrap(display: string, dir: string, wrap: string): boolean {
  if (display !== 'flex' && display !== 'inline-flex') return false;
  const d = dir || 'row';
  if (d !== 'row' && d !== 'row-reverse') return false;
  // nowrap is the initial value; an empty string means the same thing.
  return !wrap || wrap === 'nowrap';
}

/**
 * Where a translation block has to go so it sits with the source instead of
 * becoming a stray flex/grid track or a normal-flow sibling of an absolute caption.
 *
 * - caption / nowrap row source → fixed overlay glued to the source box
 * - row-nowrap or grid parent → last child of the source (still inside that cell)
 * - everything else → next sibling, the historical X/Reddit placement
 */
export function choosePlacement(s: LayoutSnap): Placement {
  if (!s.anchorIsElement) return 'sibling';
  if (s.caption) return 'overlay';
  if (isRowNowrap(s.selfDisplay, s.selfFlexDirection, s.selfFlexWrap)) return 'overlay';
  const parentRow = isRowNowrap(s.parentDisplay, s.parentFlexDirection, s.parentFlexWrap);
  const parentGrid = s.parentDisplay === 'grid' || s.parentDisplay === 'inline-grid';
  if (s.clamped) return parentRow || parentGrid ? 'overlay' : 'sibling';
  if (parentRow || parentGrid) return 'inside';
  return 'sibling';
}

/** In-flow overlays (a row-flex paragraph) need a margin gap so the line doesn't cover the next paragraph.
 *  Caption overlays sit on the video and must not push layout. */
export function reserveSpace(s: LayoutSnap): boolean {
  return choosePlacement(s) === 'overlay' && !s.caption;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

/** How far YouTube's control bar covers the bottom of the video picture, in px. */
export function controlOverlap(
  videoBottom: number,
  controlsTop: number,
  controlsHeight: number,
  opacity: number,
): number {
  if (!(opacity > 0.05) || !(controlsHeight > 0)) return 0;
  if (controlsTop >= videoBottom) return 0;
  return Math.max(0, videoBottom - controlsTop);
}

/**
 * Movie-mode caption box, in the player's coordinate space.
 * `center` is the horizontal center of the video picture (so side letterboxing
 * doesn't shove the line to the player's left edge). `bottom` is the distance
 * from the player's bottom edge up to the caption, clearing bottom letterboxing
 * and the control bar.
 */
export function youtubeCaptionOffset(
  video: Rect,
  player: Rect,
  controls?: { top: number; height: number; opacity: number } | null,
): { center: number; bottom: number; maxWidth: number } {
  const overlap = controls
    ? controlOverlap(video.bottom, controls.top, controls.height, controls.opacity)
    : 0;
  const letterbox = Math.max(0, player.bottom - video.bottom);
  const margin = Math.round(Math.max(10, video.height * 0.06));
  const bottom = Math.round(letterbox + margin + overlap);
  const center = Math.round((video.left - player.left) + video.width / 2);
  const maxWidth = Math.max(80, Math.round(video.width * 0.92));
  return { center, bottom, maxWidth };
}
