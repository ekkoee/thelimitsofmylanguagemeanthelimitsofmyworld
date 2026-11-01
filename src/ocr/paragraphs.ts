// Group OCR word boxes into lines, then into paragraphs.
// Coordinates are pixels of the image that was recognized.

export interface OcrToken {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrRegion {
  text: string;
  /** [x, y, w, h] as fractions of the source image. */
  box: [number, number, number, number];
}

export interface PixelRect { x: number; y: number; w: number; h: number }

function bounds(tokens: OcrToken[]): PixelRect {
  const x = Math.min(...tokens.map((t) => t.x));
  const y = Math.min(...tokens.map((t) => t.y));
  const r = Math.max(...tokens.map((t) => t.x + t.w));
  const b = Math.max(...tokens.map((t) => t.y + t.h));
  return { x, y, w: Math.max(1, r - x), h: Math.max(1, b - y) };
}

function joinTokens(tokens: OcrToken[]): string {
  const parts = tokens.map((t) => t.text.trim()).filter(Boolean);
  if (!parts.length) return '';
  if (parts.every((p) => p.length <= 3 && !/[A-Za-z]{2,}/.test(p))) return parts.join('');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function toRegion(tokens: OcrToken[], width: number, height: number): OcrRegion | null {
  const text = joinTokens(tokens);
  if (!text || width < 1 || height < 1) return null;
  const box = bounds(tokens);
  return {
    text,
    box: [box.x / width, box.y / height, box.w / width, box.h / height],
  };
}

function clusterLines(tokens: OcrToken[]): OcrToken[][] {
  const sorted = tokens.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: OcrToken[][] = [];
  for (const token of sorted) {
    const line = lines[lines.length - 1];
    if (!line) { lines.push([token]); continue; }
    const mid = token.y + token.h / 2;
    const lineMid = line.reduce((s, t) => s + t.y + t.h / 2, 0) / line.length;
    const lh = Math.max(token.h, ...line.map((t) => t.h));
    if (Math.abs(mid - lineMid) < lh * 0.65) line.push(token);
    else lines.push([token]);
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

function sameParagraph(a: OcrToken[], b: OcrToken[]): boolean {
  const ab = bounds(a);
  const bb = bounds(b);
  const gap = bb.y - (ab.y + ab.h);
  const lh = Math.max(ab.h, bb.h);
  if (gap > lh * 0.9 || gap < -lh * 0.35) return false;
  const left = Math.abs(ab.x - bb.x);
  if (left > 28 && left > Math.max(ab.w, bb.w) * 0.4) return false;
  const overlap = Math.min(ab.x + ab.w, bb.x + bb.w) - Math.max(ab.x, bb.x);
  return overlap > Math.min(ab.w, bb.w) * 0.35;
}

/** A box measured on a canvas rotated 90° clockwise, mapped back to the original image. */
export function rotatedCWBox(box: PixelRect, origH: number): PixelRect {
  return {
    x: box.y,
    y: origH - (box.x + box.w),
    w: box.h,
    h: box.w,
  };
}

function inside(token: OcrToken, rect: PixelRect): boolean {
  const cx = token.x + token.w / 2;
  const cy = token.y + token.h / 2;
  return cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h;
}

function overlapRatio(a: PixelRect, b: PixelRect): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = x * y;
  return inter / Math.max(1, Math.min(a.w * a.h, b.w * b.h));
}

/**
 * Lines that share a left edge and a small gap become one paragraph.
 * Optional `bubbles` each become one region covering that rectangle.
 */
export function tokensToRegions(
  tokens: OcrToken[],
  width: number,
  height: number,
  bubbles: PixelRect[] = [],
): OcrRegion[] {
  const usable = tokens.filter((t) => t.text.trim() && t.w > 1 && t.h > 1);
  const claimed = new Set<OcrToken>();
  const regions: OcrRegion[] = [];
  for (const bubble of bubbles) {
    const insideTokens = usable.filter((t) => !claimed.has(t) && inside(t, bubble));
    if (insideTokens.length < 1) continue;
    insideTokens.sort((a, b) => a.y - b.y || a.x - b.x);
    const text = joinTokens(insideTokens);
    if (!text) continue;
    for (const token of insideTokens) claimed.add(token);
    regions.push({
      text,
      box: [bubble.x / width, bubble.y / height, bubble.w / width, bubble.h / height],
    });
  }
  const rest = usable.filter((t) => !claimed.has(t));
  const lines = clusterLines(rest);
  let current: OcrToken[] = [];
  let prev: OcrToken[] | null = null;
  const paras: OcrToken[][] = [];
  for (const line of lines) {
    if (prev && sameParagraph(prev, line)) current.push(...line);
    else {
      if (current.length) paras.push(current);
      current = [...line];
    }
    prev = line;
  }
  if (current.length) paras.push(current);
  for (const para of paras) {
    const region = toRegion(para, width, height);
    if (!region) continue;
    const rect = { x: region.box[0] * width, y: region.box[1] * height, w: region.box[2] * width, h: region.box[3] * height };
    if (regions.some((r) => overlapRatio(rect, { x: r.box[0] * width, y: r.box[1] * height, w: r.box[2] * width, h: r.box[3] * height }) > 0.55)) continue;
    regions.push(region);
  }
  return regions;
}
