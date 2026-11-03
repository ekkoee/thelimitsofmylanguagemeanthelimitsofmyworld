// One Gemini vision call per image. The router skips a model whose free-tier
// quota is already spent instead of waiting on it.

import { friendlyTranslateError } from '../core/errors';
import { normalizeGeminiKey } from '../core/gemini-key';
import { executeGeminiRoute } from '../core/gemini-route';
import { QuotaState, emptyQuotaState, imageModelChain as routedImageChain } from '../core/quota-router';

export { friendlyTranslateError };

export const IMAGE_PRIMARY_DEFAULT = 'gemini-2.5-flash-lite';
export const IMAGE_FALLBACKS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
export const IMAGE_MAX_EDGE = 1600;
export const IMAGE_JPEG_QUALITY = 0.85;

export interface ImageRegion {
  textEn: string;
  textZh: string;
  /** [x, y, w, h] as fractions of the source image (0–1). */
  box?: [number, number, number, number];
  /** Source line height as a fraction of the image. Body type uses the median of these. */
  glyph?: number;
  kind?: 'line' | 'paragraph' | 'heading' | 'bullet';
  /** Bullet or number drawn once, outside the wrapped text. */
  marker?: string;
  /** Leading date/label was bold in the source. */
  labelBold?: boolean;
}

export interface ImageTranslation {
  text: string;
  regions: ImageRegion[];
  model: string;
}

const IMAGE_PROMPT = [
  'Read this image as a document and return one region per logical block, never one region per visual line.',
  'A block is a title, or one bullet, or one paragraph. A bullet that wraps onto several lines is still ONE block.',
  'box_2d must be the union of every line in that block: from the list marker (• or 1.) through the last word, including inline code such as pyenv.',
  'block is "heading", "bullet", or "paragraph".',
  'marker is the bullet character or list number, or "" for a heading or plain paragraph. Do not also put that marker inside text_zh.',
  'label_bold is true when the leading label (June:, September:, Oct 20:) is bold.',
  'text_zh is Traditional Chinese as used in Taiwan (軟體、文件、訊息、資料、程式; not 文檔、信息、數據、軟件). Keep product names. Write a bold date label once, like 6月： or 10月20日：.',
  'Do NOT return regions that are only axis numbers, years, dates, URLs, @handles, or code/model ids.',
  'Do NOT return empty boxes. text_zh must be Chinese, never a copy of the English.',
  'If the image has no meaningful text, return {"regions":[]}.',
].join('\n');

const IMAGE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    regions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } },
          text_en: { type: 'STRING' },
          text_zh: { type: 'STRING' },
          block: { type: 'STRING' },
          marker: { type: 'STRING' },
          label_bold: { type: 'BOOLEAN' },
        },
        required: ['box_2d', 'text_en', 'text_zh', 'block'],
      },
    },
  },
  required: ['regions'],
};

export function imageModelChain(_model?: string, imageModel?: string): string[] {
  return routedImageChain({ imageModel: imageModel || 'auto' });
}

export function buildImageBody(opts: { mime: string; data: string; model: string }): Record<string, unknown> {
  return {
    contents: [{
      role: 'user',
      parts: [
        { text: IMAGE_PROMPT },
        { inline_data: { mime_type: opts.mime || 'image/jpeg', data: opts.data } },
      ],
    }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: IMAGE_SCHEMA,
      ...( /gemini-3/i.test(opts.model) ? { thinkingConfig: { thinkingLevel: 'minimal' } } : {}),
    },
  };
}

export function isMostlyLatin(s: string): boolean {
  const t = (s || '').replace(/\s+/g, '');
  if (t.length < 2) return false;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  const han = (t.match(/\p{Script=Han}/gu) || []).length;
  return latin > han && latin / t.length > 0.45;
}

export function echoesEnglish(en: string, zh: string): boolean {
  const a = (en || '').replace(/\s+/g, '').toLowerCase();
  const b = (zh || '').replace(/\s+/g, '').toLowerCase();
  if (!b) return true;
  if (a && a === b) return true;
  return isMostlyLatin(zh);
}

/** Gemini box_2d is [ymin, xmin, ymax, xmax] in 0–1000. Older replies used [x, y, w, h] in 0–1. */
export function boxToFractions(raw: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined;
  const nums = raw.map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n))) return undefined;
  const max = Math.max(...nums);
  let x: number; let y: number; let w: number; let h: number;
  if (max > 1) {
    const [ymin, xmin, ymax, xmax] = nums;
    if (ymax <= ymin || xmax <= xmin) return undefined;
    x = xmin / 1000; y = ymin / 1000; w = (xmax - xmin) / 1000; h = (ymax - ymin) / 1000;
  } else {
    const [a, b, c, d] = nums;
    // [ymin,xmin,ymax,xmax] in 0–1 if the third and fourth exceed the first two.
    if (c > a && d > b && c <= 1 && d <= 1 && (c - a) < 0.95) {
      y = a; x = b; h = c - a; w = d - b;
    } else {
      x = a; y = b; w = c; h = d;
    }
  }
  if (w < 0.004 || h < 0.004) return undefined;
  if (x < -0.02 || y < -0.02 || x + w > 1.05 || y + h > 1.05) return undefined;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return [clamp(x), clamp(y), Math.min(1 - clamp(x), w), Math.min(1 - clamp(y), h)];
}

/** Axis numbers, years, URLs, handles, model ids, and source-acronym tickers stay as pixels. */
export function shouldSkipImageText(en: string): boolean {
  const t = (en || '').replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (/^[\d\s.,:%+\-/=]+$/.test(t)) return true;
  if (/^(19|20)\d{2}(\s*[–\-—]\s*(19|20)?\d{2})?$/.test(t)) return true;
  if (/^q[1-4]\s+(19|20)\d{2}$/i.test(t)) return true;
  if (/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+(?:19|20)\d{2}$/i.test(t)) return true;
  if (/^\d{1,2}[/-]\d{1,2}[/-](?:\d{2}|(?:19|20)\d{2})$/.test(t)) return true;
  if (/^@[\w.]+$/.test(t)) return true;
  if (/^https?:\/\/\S+$/i.test(t) || /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(t)) return true;
  if (/^(grok|gpt|claude|gemini|qwen)[-\d.a-z]*$/i.test(t)) return true;
  if (/^\d+(\.\d+)?\s*[BMK]\b/i.test(t) && t.length < 14) return true;
  if (/^[A-Z]{2,5}$/.test(t)) return true;
  if (/^(us|tx|fl|ny|ca|uk|oh|mi|il|pa|nc|ga)$/i.test(t)) return true;
  return false;
}

function isProse(en: string): boolean {
  const t = en.trim();
  return t.length > 48 || t.split(/\s+/).filter(Boolean).length >= 8;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function isShortLabel(en: string): boolean {
  const t = en.trim();
  return wordCount(t) <= 4 && t.length <= 28;
}

function isBlankText(s: string): boolean {
  return !/[\p{L}\p{N}]/u.test(s || '');
}

function blockKind(raw: unknown, en: string): ImageRegion['kind'] {
  const name = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (name === 'heading' || name === 'title') return 'heading';
  if (name === 'bullet' || name === 'list') return 'bullet';
  if (name === 'paragraph') return 'paragraph';
  if (/^[•·▪◦]\s*/.test(en) || /^(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i.test(en)) return 'bullet';
  if (/^\d{1,3}[.)]\s+\S/.test(en)) return 'bullet';
  return undefined;
}

/** A new bullet or heading, not the next wrapped line of the block above. */
function startsBlock(en: string, kind: ImageRegion['kind']): boolean {
  if (kind === 'heading') return true;
  const t = en.trim();
  if (/^[•·▪◦]\s+/.test(t)) return true;
  if (/^\d{1,3}[.)]\s+\S/.test(t)) return true;
  if (/^(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b[^.\n]{0,16}:/i.test(t)) return true;
  return false;
}

/** Same column, or an indented wrap, with only a line-gap between them. */
function sameBlock(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  const overlapY = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  const overlapX = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const smaller = Math.min(a[2] * a[3], b[2] * b[3]);
  if (overlapX > 0 && overlapY > 0 && overlapX * overlapY > smaller * 0.4) return true;
  const gap = b[1] - (a[1] + a[3]);
  const lineH = Math.max(Math.min(a[3], b[3]), 0.012);
  if (gap > lineH * 1.25 || gap < -lineH * 0.55) return false;
  const sameLeft = Math.abs(a[0] - b[0]) < 0.09;
  const indented = b[0] >= a[0] - 0.015 && b[0] <= a[0] + Math.max(0.1, a[2] * 0.28);
  const minw = Math.min(a[2], b[2]);
  return sameLeft || indented || overlapX > minw * 0.3;
}

/** The source list marker is written once at the start of the translation. */
export function withSingleListNumber(en: string, zh: string): string {
  const mark = en.trim().match(/^(\d{1,3}[.)])/);
  const body = zh.trim().replace(/^(?:\d{1,3}[.)]\s*)+/, '').trim();
  if (!mark) return zh.trim();
  return body ? `${mark[1]} ${body}` : mark[1];
}

function sameLine(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  const overlapY = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  const minH = Math.min(a[3], b[3]);
  if (overlapY < minH * 0.45) return false;
  const gapX = b[0] - (a[0] + a[2]);
  return gapX < Math.max(a[3], b[3]) * 2.2 && gapX > -minH;
}

function continues(prev: ImageRegion, next: ImageRegion): boolean {
  if (!prev.box || !next.box) return false;
  if (startsBlock(next.textEn, next.kind)) return false;
  if ((prev.kind === 'heading' || next.kind === 'heading') && sameLine(prev.box, next.box)) return true;
  if (prev.kind === 'heading' || next.kind === 'heading') return false;
  if (isShortLabel(prev.textEn) && isShortLabel(next.textEn)) return false;
  return sameBlock(prev.box, next.box);
}

function joinText(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return /\p{Script=Han}/u.test(a) || /\p{Script=Han}/u.test(b) ? `${a}${b}` : `${a} ${b}`;
}

function union(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  const r = Math.max(a[0] + a[2], b[0] + b[2]);
  const bot = Math.max(a[1] + a[3], b[1] + b[3]);
  return [x, y, r - x, bot - y];
}

/** Merge line fragments of one bullet or paragraph. A heading stays on its own. */
export function groupImageRegions(regions: ImageRegion[]): ImageRegion[] {
  const items = regions
    .filter((r) => r.box && !(isBlankText(r.textEn) && isBlankText(r.textZh)))
    .slice()
    .sort((a, b) => a.box![1] - b.box![1] || a.box![0] - b.box![0]);
  const out: ImageRegion[] = [];
  for (const region of items) {
    const prev = out[out.length - 1];
    const lineH = region.box![3];
    if (prev && continues(prev, region)) {
      prev.box = union(prev.box!, region.box!);
      prev.textEn = `${prev.textEn} ${region.textEn}`.replace(/\s+/g, ' ').trim();
      prev.textZh = joinText(prev.textZh, region.textZh);
      const lines = [prev.glyph, region.glyph, lineH].filter((n): n is number => !!n && n > 0 && n < 0.12);
      prev.glyph = lines.length ? lines.sort((a, b) => a - b)[Math.floor((lines.length - 1) / 2)] : prev.glyph;
      if (prev.kind !== 'bullet' && prev.kind !== 'heading') prev.kind = 'paragraph';
      prev.labelBold = prev.labelBold || region.labelBold;
      continue;
    }
    const kind = region.kind || (isProse(region.textEn) ? 'paragraph' : 'line');
    out.push({ ...region, kind, glyph: region.glyph && region.glyph < 0.12 ? region.glyph : (lineH < 0.12 ? lineH : region.glyph) });
  }
  return out
    .filter((region) => !isBlankText(region.textZh))
    .map((region) => ({ ...region, textZh: withSingleListNumber(region.textEn, region.textZh) }));
}

function boxAcceptable(region: ImageRegion): boolean {
  const box = region.box;
  if (!box) return false;
  const [x, y, w, h] = box;
  if (w < 0.008 || h < 0.006) return false;
  if (x < -0.01 || y < -0.01 || x + w > 1.04 || y + h > 1.04) return false;
  const label = (region.textEn || region.textZh || '').trim();
  if (label.length < 24 && w * h > 0.6) return false;
  return true;
}

/** In-place boxes, or a panel when too many boxes are missing or nonsense. */
export function selectInPlace(regions: ImageRegion[]): { mode: 'inplace' | 'panel'; regions: ImageRegion[] } {
  const candidates = regions.filter((r) => (r.textZh || r.textEn) && !shouldSkipImageText(r.textEn));
  if (!candidates.length) return { mode: 'panel', regions: [] };
  let invalid = 0;
  const good: ImageRegion[] = [];
  for (const region of candidates) {
    if (!boxAcceptable(region)) { invalid += 1; continue; }
    good.push(region);
  }
  const considered = good.length + invalid;
  if (!good.length || invalid / considered > 0.3) return { mode: 'panel', regions: [] };
  return { mode: 'inplace', regions: groupImageRegions(good) };
}

export function parseImageTranslation(raw: string): { text: string; regions: ImageRegion[] } {
  const trimmed = raw.trim();
  const start = trimmed.startsWith('[') ? 0 : raw.indexOf('{');
  const end = trimmed.startsWith('[') ? raw.lastIndexOf(']') : raw.lastIndexOf('}');
  if (start < 0 || end <= start) return { text: '', regions: [] };
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { regions?: unknown; text?: unknown; text_zh?: unknown } | unknown[];
    const obj = Array.isArray(parsed) ? { regions: parsed } : parsed;
    const regions: ImageRegion[] = [];
    if (Array.isArray(obj.regions)) {
      for (const item of obj.regions) {
        const r = item as { text_en?: unknown; text_zh?: unknown; text?: unknown; box?: unknown };
        const textEn = typeof r.text_en === 'string' ? r.text_en.trim() : '';
        const textZh = typeof r.text_zh === 'string' ? r.text_zh.trim()
          : (typeof r.text === 'string' ? r.text.trim() : '');
        if (isBlankText(textEn) && isBlankText(textZh)) continue;
        const boxRaw = (r as { box_2d?: unknown }).box_2d ?? r.box;
        const marker = typeof (r as { marker?: unknown }).marker === 'string' ? (r as { marker: string }).marker.trim() : '';
        const bold = (r as { label_bold?: unknown }).label_bold;
        regions.push({
          textEn,
          textZh,
          box: boxToFractions(boxRaw),
          kind: blockKind((r as { block?: unknown }).block, textEn),
          marker,
          labelBold: typeof bold === 'boolean' ? bold : undefined,
        });
      }
    }
    const text = regions.map((r) => r.textZh).filter(Boolean).join('\n')
      || (typeof obj.text_zh === 'string' ? obj.text_zh.trim() : '')
      || (typeof obj.text === 'string' ? obj.text.trim() : '');
    return { text, regions };
  } catch {
    return { text: '', regions: [] };
  }
}

export class GeminiStatusError extends Error {
  constructor(message: string, readonly status: number, readonly retrySec: number | null) {
    super(message);
  }
}

/**
 * Best available model, one call at a time. A daily-exhausted model is skipped.
 * A silent socket is aborted after 15s. The chain stops within 20s.
 */
export async function translateImageSequential(opts: {
  key: string;
  model?: string;
  imageModel?: string;
  mime: string;
  data: string;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
  quotaState?: QuotaState;
  onQuota?: (state: QuotaState) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  budgetMs?: number;
  headerTimeoutMs?: number;
}): Promise<ImageTranslation> {
  const key = normalizeGeminiKey(opts.key);
  if (!key) throw new Error('NO_API_KEY:image');
  const log = opts.log ?? ((line: string) => console.log(line));
  const state = opts.quotaState ?? emptyQuotaState();
  const chain = imageModelChain(opts.model, opts.imageModel);
  try {
    const routed = await executeGeminiRoute({
      key,
      chain,
      purpose: 'image',
      state,
      onState: (next) => opts.onQuota?.(next),
      now: opts.now,
      sleep: opts.sleep,
      fetchImpl: opts.fetchImpl,
      budgetMs: opts.budgetMs,
      headerTimeoutMs: opts.headerTimeoutMs,
      log: (line) => log(line.includes('model=') ? line.replace('model=', `bytes=${opts.data.length} mime=${opts.mime} model=`) : line),
      buildBody: (model) => buildImageBody({ mime: opts.mime, data: opts.data, model }),
    });
    const json = routed.json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const content = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ?? '';
    const got = parseImageTranslation(content);
    return { ...got, model: routed.model };
  } catch (err) {
    throw new Error(friendlyTranslateError(err, 'image'));
  }
}
