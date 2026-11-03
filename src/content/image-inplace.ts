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
    if (x < 0 || y < 0 || x >= iw || y >= ih) return;
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
  // The most common coarse color is the paper. A few light glyphs must not turn a dark page white.
  const buckets = new Map<number, number[]>();
  for (const color of samples) {
    const key = ((color >> 16) & 0xf0) << 8 | ((color >> 8) & 0xf0) | ((color & 0xf0) >> 4);
    const list = buckets.get(key);
    if (list) list.push(color);
    else buckets.set(key, [color]);
  }
  let best: number[] = [];
  for (const list of buckets.values()) if (list.length > best.length) best = list;
  best.sort((a, b) => a - b);
  const mid = best[Math.floor(best.length / 2)];
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

/** A saturated red fill reads as an error. Image patches stay on the neutral panel. */
export function neutralFill(rgb: Rgb): Rgb {
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const y = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
  if (rgb.r > rgb.g + 28 && rgb.r > rgb.b + 28 && sat > 0.22) {
    return y > 150 ? { r: 244, g: 246, b: 251 } : { r: 21, g: 24, b: 36 };
  }
  return rgb;
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
  const spaceW = content.w || ew;
  const spaceH = content.h || eh;
  const placed = separateCovers(regions.map((region) => {
    if (!region.box || !region.textZh.trim()) return { ...region, box: undefined };
    const full = coverSourceBox(region.box, region.textEn || '', canvas);
    const lineFrac = region.glyph && region.glyph < full[3] ? region.glyph : Math.min(full[3], 0.045);
    return { ...region, box: padCover(full, spaceW, spaceH, lineFrac) };
  })).filter((region) => region.box && region.textZh.trim());
  const bodyGlyphs = placed
    .filter((region) => region.kind !== 'heading' && region.glyph && region.glyph < 0.12)
    .map((region) => region.glyph as number)
    .sort((a, b) => a - b);
  const medianGlyph = bodyGlyphs.length ? bodyGlyphs[Math.floor((bodyGlyphs.length - 1) / 2)] : 0;
  const bodyPx = Math.max(12, Math.round((medianGlyph || 0.028) * spaceH));
  const headingPx = Math.round(bodyPx * 1.18);
  const built: { node: HTMLElement; heading: boolean }[] = [];
  for (const region of placed) {
    const padded = region.box!;
    const left = content.x + padded[0] * content.w;
    const top = content.y + padded[1] * content.h;
    const width = Math.max(8, padded[2] * content.w);
    const height = Math.max(8, padded[3] * content.h);
    const bg = neutralFill(canvas ? medianEdgeColor(canvas, padded) : { r: 244, g: 241, b: 234 });
    const heading = region.kind === 'heading';
    const node = document.createElement('div');
    node.className = heading ? 'ibt-img-region ibt-img-heading' : (region.kind === 'bullet' ? 'ibt-img-region ibt-img-bullet' : 'ibt-img-region ibt-img-paragraph');
    node.style.left = `${(left / ew) * 100}%`;
    node.style.top = `${(top / eh) * 100}%`;
    node.style.width = `${(width / ew) * 100}%`;
    node.style.height = `${(height / eh) * 100}%`;
    node.style.background = cssColor(bg);
    node.style.color = contrastColor(bg);
    node.style.lineHeight = '1.45';
    node.style.textAlign = 'left';
    node.style.padding = '3px 6px';
    node.style.boxSizing = 'border-box';
    fillRegion(node, region);
    overlay.appendChild(node);
    node.style.fontSize = `${heading ? headingPx : bodyPx}px`;
    built.push({ node, heading });
  }
  const bodies = built.filter((item) => !item.heading).map((item) => item.node);
  const fitted = globalBodySize(bodies, bodyPx);
  for (const node of bodies) node.style.fontSize = `${fitted}px`;
  const headPx = Math.max(fitted, Math.round(fitted * 1.18));
  for (const item of built) {
    if (!item.heading) continue;
    item.node.style.fontSize = `${headPx}px`;
    item.node.style.lineHeight = LINE;
    if (item.node.scrollHeight > item.node.clientHeight + 1) {
      item.node.style.height = `${item.node.scrollHeight + 2}px`;
    }
  }
}

const LINE = '1.45';

function fillRegion(node: HTMLElement, region: ImageRegion): void {
  const en = region.textEn.trim();
  let zh = region.textZh.trim().replace(/^[•·▪◦]\s*/, '');
  let marker = (region.marker || '').trim();
  if (!marker) {
    if (/^[•·▪◦]\s*/.test(en)) marker = '•';
    else {
      const num = en.match(/^(\d{1,3}[.)])\s*/);
      if (num) marker = num[1];
    }
  }
  if (/^\d{1,3}[.)]/.test(marker)) zh = zh.replace(/^\d{1,3}[.)]\s*/, '');
  const labelMatch = zh.match(/^(\d{1,2}月(?:\d{1,2}日)?[：:])\s*/);
  const bold = region.labelBold !== false && !!labelMatch;
  const label = bold && labelMatch ? labelMatch[1] : '';
  if (label) zh = zh.slice(labelMatch![0].length).trim();
  node.replaceChildren();
  if (marker) {
    const mark = document.createElement('span');
    mark.className = 'ibt-img-mark';
    mark.textContent = marker;
    const body = document.createElement('span');
    body.className = 'ibt-img-body';
    if (label) {
      const strong = document.createElement('b');
      strong.className = 'ibt-img-label';
      strong.textContent = label;
      body.append(strong, document.createTextNode(zh ? ` ${zh}` : ''));
    } else body.textContent = zh;
    node.append(mark, body);
    return;
  }
  if (label) {
    const strong = document.createElement('b');
    strong.className = 'ibt-img-label';
    strong.textContent = label;
    node.append(strong, document.createTextNode(zh ? ` ${zh}` : ''));
    return;
  }
  node.textContent = zh;
}

/** One size for every body block. Shrink only when a block cannot fit, and then shrink them all together. */
function globalBodySize(nodes: HTMLElement[], preferred: number): number {
  const floor = Math.max(11, Math.round(preferred * 0.72));
  const fitsAll = (px: number) => nodes.every((node) => {
    node.style.fontSize = `${px}px`;
    node.style.lineHeight = LINE;
    return node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1;
  });
  if (fitsAll(preferred)) return preferred;
  let lo = floor;
  let hi = preferred - 1;
  let best = floor;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fitsAll(mid)) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best;
}

type Box = [number, number, number, number];

/** Pull a list marker that sits just left of the words into the same cover. */
export function coverSourceBox(box: Box, textEn: string, canvas: HTMLCanvasElement | null): Box {
  let [x, y, w, h] = box;
  if (/^\d{1,3}[.)]/.test(textEn.trim())) {
    const extra = Math.min(0.14, Math.max(h * 1.8, 0.018));
    const nx = Math.max(0, x - extra);
    w += x - nx;
    x = nx;
  }
  if (!canvas?.width || !canvas.height) return [x, y, w, h];
  return includeLeftInk(canvas, [x, y, w, h]);
}

function includeLeftInk(canvas: HTMLCanvasElement, box: Box): Box {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return box;
  const W = canvas.width;
  const H = canvas.height;
  const x0 = Math.max(0, Math.floor(box[0] * W));
  const y0 = Math.max(0, Math.floor(box[1] * H));
  const y1 = Math.min(H, Math.ceil((box[1] + box[3]) * H));
  const reach = Math.min(x0, Math.max(8, Math.round(box[3] * H * 2.4)));
  if (reach < 2 || y1 - y0 < 4) return box;
  const data = ctx.getImageData(x0 - reach, y0, reach, y1 - y0).data;
  const iw = reach;
  const ih = y1 - y0;
  const lumAt = (x: number, y: number) => {
    const i = (y * iw + x) * 4;
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  };
  const bg = [lumAt(0, 0), lumAt(iw - 1, 0), lumAt(0, ih - 1), lumAt(iw - 1, ih - 1)].sort((a, b) => a - b)[1];
  const step = Math.max(1, Math.floor(ih / 24));
  let left = iw;
  for (let x = 0; x < iw; x++) {
    let ink = 0;
    for (let y = 0; y < ih; y += step) if (Math.abs(lumAt(x, y) - bg) > 42) ink += 1;
    if (ink >= 2) { left = x; break; }
  }
  if (left >= iw - 1) return box;
  const nx = (x0 - reach + left) / W;
  return [nx, box[1], box[0] + box[2] - nx, box[3]];
}

/** A few pixels around the full source box. Capped so the pad does not swallow the next paragraph. */
export function padCover(box: Box, imgW: number, imgH: number, lineFrac = box[3]): Box {
  const linePx = Math.max(8, Math.min(box[3], lineFrac) * imgH);
  const padX = Math.min(12, Math.max(3, linePx * 0.2));
  const padY = Math.min(8, Math.max(3, linePx * 0.18));
  const x = Math.max(0, box[0] * imgW - padX);
  const y = Math.max(0, box[1] * imgH - padY);
  const r = Math.min(imgW, (box[0] + box[2]) * imgW + padX);
  const b = Math.min(imgH, (box[1] + box[3]) * imgH + padY);
  return [x / imgW, y / imgH, (r - x) / imgW, (b - y) / imgH];
}

/** Padding may touch the next paragraph. Give the shared edge back so the boxes meet instead of stacking. */
export function separateCovers<T extends { box?: Box }>(regions: T[]): T[] {
  const items = regions.map((region) => ({ ...region, box: region.box ? [...region.box] as Box : undefined }));
  const boxes = items.filter((item) => item.box).sort((a, b) => a.box![1] - b.box![1]);
  for (let i = 0; i < boxes.length - 1; i++) {
    const a = boxes[i].box!;
    const b = boxes[i + 1].box!;
    const overlapX = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    if (overlapX <= Math.min(a[2], b[2]) * 0.3) continue;
    const overlapY = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    if (overlapY <= 0 || overlapY > Math.min(a[3], b[3]) * 0.35) continue;
    const cut = (Math.max(a[1], b[1]) + Math.min(a[1] + a[3], b[1] + b[3])) / 2;
    if (a[1] < cut && cut < a[1] + a[3]) a[3] = cut - a[1];
    if (b[1] < cut) {
      const bot = b[1] + b[3];
      b[1] = cut;
      b[3] = Math.max(0.004, bot - cut);
    }
  }
  return items;
}

/** Start near the source line height and shrink until the translation fits inside the cover. */
export function fitRegionFont(el: HTMLElement, capPx?: number): void {
  const cap = Math.max(1, Math.floor(capPx ?? el.clientHeight));
  const overflows = () => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
  el.style.fontSize = `${cap}px`;
  if (!overflows()) return;
  let lo = 1;
  let hi = cap - 1;
  let best = 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    el.style.fontSize = `${mid}px`;
    if (!overflows()) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  el.style.fontSize = `${best}px`;
}
