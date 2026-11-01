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

/** Drop a legend dot that Tesseract glued to the next word (`@EU27`, `oNY`). */
export function cleanOcrText(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim();
  t = t.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9.%]+$/, '');
  if (/^[oO][A-Z]{2,5}$/.test(t)) t = t.slice(1);
  if (/^[A-Z]{2}e$/.test(t)) t = t.slice(0, 2);
  return t.trim();
}

/** Legend dots and bracket garbage Tesseract reads off scatter plots. */
export function isOcrNoise(text: string): boolean {
  const t = cleanOcrText(text);
  if (!t) return true;
  if (t.length === 1 && !/[0-9]/.test(t) && !/^[AI]$/i.test(t)) return true;
  if (/^[^0-9A-Za-z]+$/.test(t)) return true;
  if (/[\[\]{}()<>|@®©]/.test(t) && t.length <= 4 && !/[A-Za-z]{3,}/.test(t)) return true;
  return false;
}

function joinTokens(tokens: OcrToken[]): string {
  const parts = tokens.map((t) => t.text.trim()).filter((t) => t && !isOcrNoise(t));
  if (!parts.length) return '';
  if (parts.every((p) => p.length <= 3 && !/[A-Za-z]{2,}/.test(p))) return parts.join('');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function toRegion(tokens: OcrToken[], width: number, height: number): OcrRegion | null {
  const text = joinTokens(tokens);
  if (!text || width < 1 || height < 1) return null;
  const box = lineBounds(tokens);
  return {
    text,
    box: [box.x / width, box.y / height, box.w / width, box.h / height],
  };
}

/** A gap wider than a normal space splits one baseline into separate labels. */
function splitWideGaps(line: OcrToken[]): OcrToken[][] {
  const sorted = line.slice().sort((a, b) => a.x - b.x);
  const groups: OcrToken[][] = [];
  let current: OcrToken[] = [];
  for (const token of sorted) {
    const prev = current[current.length - 1];
    const h = Math.max(token.h, prev?.h || 0, 8);
    const gap = prev ? token.x - (prev.x + prev.w) : 0;
    if (prev && gap > Math.max(28, h * 1.7)) {
      groups.push(current);
      current = [token];
    } else current.push(token);
  }
  if (current.length) groups.push(current);
  return groups;
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
  return lines.flatMap(splitWideGaps);
}

/** One line's box follows the glyph height, not a taller union of jittered word boxes. */
function lineBounds(tokens: OcrToken[]): PixelRect {
  const x = Math.min(...tokens.map((t) => t.x));
  const r = Math.max(...tokens.map((t) => t.x + t.w));
  const hs = tokens.map((t) => t.h).sort((a, b) => a - b);
  const ys = tokens.map((t) => t.y).sort((a, b) => a - b);
  return {
    x,
    y: ys[Math.floor(ys.length / 2)],
    w: Math.max(1, r - x),
    h: Math.max(1, hs[Math.floor(hs.length / 2)]),
  };
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
 * Each baseline becomes its own region. A wide gap on that baseline stays two labels.
 * Optional `bubbles` each become one region covering that rectangle.
 */
export function tokensToRegions(
  tokens: OcrToken[],
  width: number,
  height: number,
  bubbles: PixelRect[] = [],
): OcrRegion[] {
  const usable: OcrToken[] = [];
  for (const token of tokens) {
    const text = cleanOcrText(token.text);
    if (!text || isOcrNoise(text) || token.w <= 1 || token.h <= 1) continue;
    usable.push({ ...token, text });
  }
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
  for (const line of clusterLines(rest)) {
    const region = toRegion(line, width, height);
    if (!region) continue;
    const rect = { x: region.box[0] * width, y: region.box[1] * height, w: region.box[2] * width, h: region.box[3] * height };
    if (regions.some((r) => overlapRatio(rect, { x: r.box[0] * width, y: r.box[1] * height, w: r.box[2] * width, h: r.box[3] * height }) > 0.55)) continue;
    regions.push(region);
  }
  return regions;
}
