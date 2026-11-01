// Paint each translated region on top of the English it replaces.
// box is [x, y, w, h] in source-image fractions. object-fit may letterbox
// or crop that image inside the <img> element.

import { ImageRegion } from '../providers/gemini-image';

export interface ContentRect { x: number; y: number; w: number; h: number }

function axis(pos: string, free: number): number {
  const part = pos.trim();
  if (part.endsWith('%')) return (parseFloat(part) / 100) * free;
  if (part.endsWith('px')) return parseFloat(part);
  if (part === 'left' || part === 'top') return 0;
  if (part === 'right' || part === 'bottom') return free;
  if (part === 'center') return free / 2;
  return free / 2;
}

/** Where the image pixels sit inside the element, in element pixels. */
export function contentRect(img: HTMLImageElement): ContentRect {
  const ew = img.clientWidth || img.width;
  const eh = img.clientHeight || img.height;
  const nw = img.naturalWidth || ew;
  const nh = img.naturalHeight || eh;
  const fit = getComputedStyle(img).objectFit || 'fill';
  if (!ew || !eh || fit === 'fill' || !nw || !nh) return { x: 0, y: 0, w: ew, h: eh };
  let scale = Math.min(ew / nw, eh / nh);
  if (fit === 'cover') scale = Math.max(ew / nw, eh / nh);
  else if (fit === 'none') scale = 1;
  else if (fit === 'scale-down') scale = Math.min(1, Math.min(ew / nw, eh / nh));
  const w = nw * scale;
  const h = nh * scale;
  const freeX = ew - w;
  const freeY = eh - h;
  const [px, py] = (getComputedStyle(img).objectPosition || '50% 50%').split(/\s+/);
  return { x: axis(px || '50%', freeX), y: axis(py || px || '50%', freeY), w, h };
}

/**
 * Grow a box by ~12% of its own height on every side.
 * `imgW` / `imgH` are the pixel size of the space the fractions are in
 * (the displayed image, or the element when the picture is a tab crop),
 * so a wide photo still gets the same pixel pad on the left as on the top.
 */
export function padBox(
  box: [number, number, number, number],
  imgW = 1,
  imgH = 1,
): [number, number, number, number] {
  const padPx = Math.max(1, box[3] * imgH * 0.12);
  const x = Math.max(0, box[0] * imgW - padPx);
  const y = Math.max(0, box[1] * imgH - padPx);
  const r = Math.min(imgW, (box[0] + box[2]) * imgW + padPx);
  const b = Math.min(imgH, (box[1] + box[3]) * imgH + padPx);
  return [x / imgW, y / imgH, (r - x) / imgW, (b - y) / imgH];
}

export interface Rgb { r: number; g: number; b: number }

const PAPER = { r: 245, g: 242, b: 234 };

/** Median color of the ring just outside the box, so glyphs inside it do not tint the fill. */
export function medianEdgeColor(canvas: HTMLCanvasElement, box: [number, number, number, number]): Rgb {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) return PAPER;
  const W = canvas.width;
  const H = canvas.height;
  const pad = Math.max(2, Math.round(box[3] * H * 0.12));
  const x0 = Math.max(0, Math.floor(box[0] * W) - pad);
  const y0 = Math.max(0, Math.floor(box[1] * H) - pad);
  const x1 = Math.min(W, Math.ceil((box[0] + box[2]) * W) + pad);
  const y1 = Math.min(H, Math.ceil((box[1] + box[3]) * H) + pad);
  const iw = x1 - x0;
  const ih = y1 - y0;
  if (iw < 2 || ih < 2) return PAPER;
  const data = ctx.getImageData(x0, y0, iw, ih).data;
  const ix0 = Math.max(0, Math.floor(box[0] * W) - x0);
  const iy0 = Math.max(0, Math.floor(box[1] * H) - y0);
  const ix1 = Math.min(iw, Math.ceil((box[0] + box[2]) * W) - x0);
  const iy1 = Math.min(ih, Math.ceil((box[1] + box[3]) * H) - y0);
  const samples: number[] = [];
  const step = Math.max(1, Math.floor(Math.max(iw, ih) / 48));
  const take = (x: number, y: number) => {
    const i = (y * iw + x) * 4;
    samples.push((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  };
  for (let y = 0; y < ih; y += step) {
    for (let x = 0; x < iw; x += step) {
      if (x >= ix0 && x < ix1 && y >= iy0 && y < iy1) continue;
      take(x, y);
    }
  }
  if (samples.length < 4) {
    for (let x = ix0; x < ix1; x += step) { take(x, iy0); take(x, Math.max(iy0, iy1 - 1)); }
  }
  if (!samples.length) return PAPER;
  samples.sort((a, b) => a - b);
  const mid = samples[Math.floor(samples.length / 2)];
  return { r: (mid >> 16) & 255, g: (mid >> 8) & 255, b: mid & 255 };
}

/**
 * Vertical span of the letters inside a word box.
 * A narrow blob outside that span (a scatter dot the box happened to include) is left out.
 */
export function textBand(
  canvas: HTMLCanvasElement,
  box: [number, number, number, number],
): [number, number, number, number] {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) return box;
  const W = canvas.width;
  const H = canvas.height;
  const x0 = Math.max(0, Math.floor(box[0] * W));
  const y0 = Math.max(0, Math.floor(box[1] * H));
  const x1 = Math.min(W, Math.ceil((box[0] + box[2]) * W));
  const y1 = Math.min(H, Math.ceil((box[1] + box[3]) * H));
  const iw = x1 - x0;
  const ih = y1 - y0;
  if (iw < 8 || ih < 6) return box;
  const data = ctx.getImageData(x0, y0, iw, ih).data;
  const lum = (x: number, y: number) => {
    const i = (y * iw + x) * 4;
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  };
  const step = Math.max(1, Math.floor(iw / 80));
  let first = -1;
  let last = -1;
  const wide = Math.max(8, iw * 0.35);
  for (let y = 0; y < ih; y++) {
    let minX = iw;
    let maxX = -1;
    for (let x = 0; x < iw; x += step) {
      if (lum(x, y) < 175) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
    if (maxX - minX >= wide) {
      if (first < 0) first = y;
      last = y;
    }
  }
  if (first < 0 || last - first < 4) return box;
  const pad = 2;
  const ny = y0 + Math.max(0, first - pad);
  const nb = y0 + Math.min(ih, last + 1 + pad);
  return [box[0], ny / H, box[2], Math.max(1, nb - ny) / H];
}

/** Vertical span of pixels that are not the background, inside an OCR box. */
export function inkBox(
  canvas: HTMLCanvasElement,
  box: [number, number, number, number],
): [number, number, number, number] {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) return box;
  const W = canvas.width;
  const H = canvas.height;
  const x0 = Math.max(0, Math.floor(box[0] * W));
  const y0 = Math.max(0, Math.floor(box[1] * H));
  const x1 = Math.min(W, Math.ceil((box[0] + box[2]) * W));
  const y1 = Math.min(H, Math.ceil((box[1] + box[3]) * H));
  const iw = x1 - x0;
  const ih = y1 - y0;
  if (iw < 2 || ih < 4) return box;
  const data = ctx.getImageData(x0, y0, iw, ih).data;
  const lum = (i: number) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  const corners = [0, (iw - 1) * 4, (ih - 1) * iw * 4, ((ih - 1) * iw + (iw - 1)) * 4].map(lum).sort((a, b) => a - b);
  const bg = corners[1];
  const step = Math.max(1, Math.floor(iw / 48));
  const ink: boolean[] = [];
  for (let y = 0; y < ih; y++) {
    let dark = 0;
    let n = 0;
    for (let x = 0; x < iw; x += step) {
      n += 1;
      if (Math.abs(lum((y * iw + x) * 4) - bg) > 40) dark += 1;
    }
    ink.push(dark >= 2 && dark / n > 0.12);
  }
  let bestA = -1;
  let bestB = -1;
  let runA = -1;
  for (let y = 0; y <= ih; y++) {
    if (y < ih && ink[y]) {
      if (runA < 0) runA = y;
    } else if (runA >= 0) {
      if (bestA < 0 || y - runA > bestB - bestA) { bestA = runA; bestB = y; }
      runA = -1;
    }
  }
  if (bestA < 0 || bestB - bestA < 4) return box;
  return [box[0], (y0 + bestA) / H, box[2], (bestB - bestA) / H];
}

export function contrastColor(rgb: Rgb): string {
  const y = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
  return y > 160 ? '#1a1a1a' : '#f4f1ea';
}

export function cssColor(rgb: Rgb): string {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

/**
 * Place region divs inside an overlay that already matches the image element.
 * `space: 'image'` maps fractions through object-fit (the bytes are the file).
 * `space: 'element'` is a tab-screenshot crop: fractions already match the overlay.
 */
export function renderRegions(
  overlay: HTMLElement,
  img: HTMLImageElement,
  canvas: HTMLCanvasElement | null,
  regions: ImageRegion[],
  opts?: { space?: 'image' | 'element' },
): void {
  const content = opts?.space === 'element' || img.tagName !== 'IMG'
    ? { x: 0, y: 0, w: overlay.clientWidth, h: overlay.clientHeight }
    : contentRect(img);
  const ew = overlay.clientWidth || 1;
  const eh = overlay.clientHeight || 1;
  for (const region of regions) {
    if (!region.box || !region.textZh) continue;
    const band = canvas ? textBand(canvas, region.box) : region.box;
    // A stacked label (US over average) is much taller than one letter band.
    // Keep every word box. A single loose box keeps only the letter band, not a dot below it.
    const stacked = region.box[3] > band[3] * 2.2;
    const padded = coverBox(stacked ? region.box : band, content.w || ew, content.h || eh);
    const left = content.x + padded[0] * content.w;
    const top = content.y + padded[1] * content.h;
    let width = Math.max(8, padded[2] * content.w);
    const height = Math.max(8, padded[3] * content.h);
    const bg = canvas ? medianEdgeColor(canvas, region.box) : { r: 244, g: 241, b: 234 };
    const node = document.createElement('div');
    node.className = region.kind === 'paragraph' ? 'ibt-img-region ibt-img-paragraph' : 'ibt-img-region';
    node.style.left = `${(left / ew) * 100}%`;
    node.style.top = `${(top / eh) * 100}%`;
    node.style.width = `${(width / ew) * 100}%`;
    node.style.height = `${(height / eh) * 100}%`;
    node.style.background = cssColor(bg);
    node.style.color = contrastColor(bg);
    node.textContent = region.textZh;
    overlay.appendChild(node);
    const words = (region.textEn || region.textZh).trim().split(/\s+/).filter(Boolean).length;
    const lines = region.kind === 'paragraph' ? Math.max(1, Math.round(words / 8)) : 1;
    const glyphPx = region.glyph ? region.glyph * (content.h || eh) : 0;
    const bandPx = band[3] * (content.h || eh);
    const letterPx = bandPx >= 8 ? bandPx : (glyphPx || region.box[3] * (content.h || eh) / lines);
    const rawH = glyphPx > 0 ? Math.min(letterPx, glyphPx) : letterPx;
    const cap = Math.max(1, Math.round(rawH));
    node.style.fontSize = `${cap}px`;
    node.style.lineHeight = '1';
    const room = Math.max(0, (content.x + content.w) - left - 4);
    if (node.scrollWidth > node.clientWidth + 1 && room > width) {
      width = Math.min(room, Math.max(width, node.scrollWidth + 2));
      node.style.width = `${(width / ew) * 100}%`;
    }
    fitRegionFont(node, cap);
  }
}

/** A few pixels around the full word box. Not enough to swallow a neighboring dot. */
function coverBox(
  box: [number, number, number, number],
  imgW: number,
  imgH: number,
): [number, number, number, number] {
  const padPx = 2;
  const x = Math.max(0, box[0] * imgW - padPx);
  const y = Math.max(0, box[1] * imgH - padPx);
  const r = Math.min(imgW, (box[0] + box[2]) * imgW + padPx);
  const b = Math.min(imgH, (box[1] + box[3]) * imgH + padPx);
  return [x / imgW, y / imgH, (r - x) / imgW, (b - y) / imgH];
}

/** Start at the source glyph height and only shrink so the line fits the box. */
export function fitRegionFont(el: HTMLElement, capPx?: number): void {
  const cap = Math.max(1, Math.floor(capPx ?? el.clientHeight));
  let px = cap;
  el.style.fontSize = `${px}px`;
  el.style.lineHeight = '1';
  let steps = 0;
  while (px > 1 && steps < 240 && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
    px -= 1;
    el.style.fontSize = `${px}px`;
    steps += 1;
  }
}
