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
  /** [x, y, w, h] as fractions of the source image. The full word boxes, not the ink band. */
  box: [number, number, number, number];
  /** Glyph height as a fraction of the image. The cover may be taller than this. */
  glyph: number;
}

export interface PixelRect { x: number; y: number; w: number; h: number }

/** Drop a legend dot that Tesseract glued to the next word (`@EU27`, `oNY`). */
export function cleanOcrText(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim();
  t = t.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9.%]+$/, '');
  if (/^[A-Z]{2}e$/.test(t)) t = t.slice(0, 2);
  else if (/^[oO][A-Z]{2,4}$/.test(t) || /^[oO][A-Z][a-z]$/.test(t)) t = t.slice(1);
  return t.trim();
}

/** Legend dots and bracket garbage Tesseract reads off scatter plots. */
export function isOcrNoise(text: string): boolean {
  const raw = text.replace(/\s+/g, ' ').trim();
  if (!raw) return true;
  if (/[®©]/.test(raw) && cleanOcrText(raw).length <= 6) return true;
  const t = cleanOcrText(raw);
  if (!t) return true;
  if (t.length === 1 && !/[0-9]/.test(t) && !/^[AI]$/i.test(t)) return true;
  if (/^[^0-9A-Za-z]+$/.test(t)) return true;
  if (/[\[\]{}()<>|@®©]/.test(t) && t.length <= 4 && !/[A-Za-z]{3,}/.test(t)) return true;
  return false;
}

/** Keep a real word even when Tesseract is unsure. Dots and bracket junk still go. */
export function acceptOcrWord(text: string, confidence: number): boolean {
  if (isOcrNoise(text)) return false;
  const cleaned = cleanOcrText(text);
  if (!cleaned) return false;
  if (confidence >= 60) return true;
  return /[A-Za-z]{4,}/.test(cleaned);
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
  const box = unionBounds(tokens);
  return {
    text,
    box: [box.x / width, box.y / height, box.w / width, box.h / height],
    glyph: glyphHeight(tokens) / height,
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
    if (prev && gap > Math.max(13, h * 0.8)) {
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

/** Every word box on the line, so a short ink band cannot leave a letter behind. */
function unionBounds(tokens: OcrToken[]): PixelRect {
  const x = Math.min(...tokens.map((t) => t.x));
  const y = Math.min(...tokens.map((t) => t.y));
  const r = Math.max(...tokens.map((t) => t.x + t.w));
  const b = Math.max(...tokens.map((t) => t.y + t.h));
  return { x, y, w: Math.max(1, r - x), h: Math.max(1, b - y) };
}

/** Typical glyph height. One inflated word box does not enlarge the type. */
function glyphHeight(tokens: OcrToken[]): number {
  const hs = tokens.map((t) => t.h).sort((a, b) => a - b);
  const mid = hs[Math.floor((hs.length - 1) / 2)];
  const kept = hs.filter((h) => h <= mid * 1.4 + 0.5);
  return Math.max(1, kept.length ? kept[kept.length - 1] : mid);
}

function prepareToken(token: OcrToken): OcrToken | null {
  const raw = token.text.trim();
  const text = cleanOcrText(raw);
  if (!text || isOcrNoise(raw) || token.w <= 1 || token.h <= 1) return null;
  let { x, w } = token;
  if (/^[^A-Za-z0-9]/.test(raw)) {
    const cut = Math.min(w * 0.48, Math.max(8, token.h * 1.25));
    if (w - cut >= 6) { x += cut; w -= cut; }
  }
  return { text, x, y: token.y, w, h: token.h };
}

function isAbbrevLine(tokens: OcrToken[]): boolean {
  return /^[A-Za-z]{2,3}$/.test(joinTokens(tokens));
}

function isOneWord(tokens: OcrToken[]): boolean {
  return /^[A-Za-z][A-Za-z'-]{1,20}$/.test(joinTokens(tokens));
}

/** "US" sitting on "average" is one label. Two country names are not. */
function stackPair(upper: OcrToken[], lower: OcrToken[]): boolean {
  if (!isAbbrevLine(upper) || !isOneWord(lower)) return false;
  const a = unionBounds(upper);
  const b = unionBounds(lower);
  const gap = b.y - (a.y + a.h);
  const lh = Math.max(a.h, b.h, 8);
  if (gap > lh * 1.25 || gap < -lh * 0.35) return false;
  const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  return overlap > a.w * 0.55;
}

function mergeStacks(lines: OcrToken[][]): OcrToken[][] {
  const out: OcrToken[][] = [];
  for (const line of lines) {
    let merged = false;
    for (let i = out.length - 1; i >= 0 && i >= out.length - 4; i--) {
      if (stackPair(out[i], line)) { out[i].push(...line); merged = true; break; }
    }
    if (!merged) out.push(line.slice());
  }
  return out;
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
    const next = prepareToken(token);
    if (next) usable.push(next);
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
      glyph: glyphHeight(insideTokens) / height,
    });
  }
  const rest = usable.filter((t) => !claimed.has(t));
  for (const line of mergeStacks(clusterLines(rest))) {
    const region = toRegion(line, width, height);
    if (!region) continue;
    const rect = { x: region.box[0] * width, y: region.box[1] * height, w: region.box[2] * width, h: region.box[3] * height };
    if (regions.some((r) => overlapRatio(rect, { x: r.box[0] * width, y: r.box[1] * height, w: r.box[2] * width, h: r.box[3] * height }) > 0.55)) continue;
    regions.push(region);
  }
  return regions;
}
