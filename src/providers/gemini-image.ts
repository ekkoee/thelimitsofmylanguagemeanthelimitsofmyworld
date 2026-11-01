// One Gemini vision call per image. No parallel model race.
// Primary model, one delayed retry on 429/5xx/timeout, then the next model.

import { friendlyTranslateError, retrySeconds } from '../core/errors';

export { friendlyTranslateError };

export const IMAGE_PRIMARY_DEFAULT = 'gemini-3.5-flash';
export const IMAGE_FALLBACKS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
export const IMAGE_MAX_EDGE = 1600;
export const IMAGE_JPEG_QUALITY = 0.85;
const IMAGE_TIMEOUT_MS = 20000;

export interface ImageRegion {
  textEn: string;
  textZh: string;
  /** [x, y, w, h] as fractions of the source image (0–1). */
  box?: [number, number, number, number];
  kind?: 'line' | 'paragraph';
}

export interface ImageTranslation {
  text: string;
  regions: ImageRegion[];
  model: string;
}

const IMAGE_PROMPT = [
  'Detect every piece of text in this image.',
  'Group body text into natural paragraphs: a multi-line paragraph is ONE region whose box covers all of its lines. Translate that paragraph as a whole so the Chinese reads fluently.',
  'Keep titles, chart labels, country names, buttons and other short UI text as separate line regions.',
  'Do NOT return regions that are only axis numbers, years, dates, URLs, @handles, or code/model ids.',
  'For each region return:',
  '- box_2d: [ymin, xmin, ymax, xmax], integers normalized 0-1000, origin at the top left. The box must cover the entire text, including the ends of the line.',
  '- text_en: the original wording.',
  '- text_zh: Traditional Chinese as used in Taiwan. Use 軟體、文件、訊息、資料、程式. Do NOT use 文檔、信息、數據、軟件. Keep numbers, years, and product names.',
  'text_zh MUST be Chinese. Never copy English into text_zh.',
  'If the image has no meaningful text, return {"regions":[]}.',
  'Return ONLY JSON: {"regions":[{"box_2d":[0,0,40,1000],"text_en":"...","text_zh":"..."}]}',
].join('\n');

export function imageModelChain(model?: string): string[] {
  const primary = model && /^gemini/i.test(model) ? model : IMAGE_PRIMARY_DEFAULT;
  const chain = [primary, ...IMAGE_FALLBACKS];
  const seen = new Set<string>();
  return chain.filter((m) => {
    const k = m.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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
  if (/^[A-Z]{3,5}$/.test(t)) return true;
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

/** Wrapped lines of one paragraph. A title sitting above a subtitle stays apart. */
function stacked(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  const gap = b[1] - (a[1] + a[3]);
  const overlap = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const minw = Math.min(a[2], b[2]);
  const taller = Math.max(a[3], b[3]);
  const shorter = Math.min(a[3], b[3]);
  return Math.abs(a[0] - b[0]) < 0.08
    && shorter >= taller * 0.62
    && gap < taller * 0.55
    && gap > -taller * 0.4
    && overlap > minw * 0.45;
}

function continues(prev: string, next: string): boolean {
  const a = prev.trim();
  const b = next.trim();
  if (!a || !b) return false;
  if (/[.!?。！？]$/.test(a)) return false;
  if (isShortLabel(a) && isShortLabel(b)) return false;
  // Only a wrapped line (it continues in lowercase). Two captions that each
  // start with a capital stay on their own line.
  return /^[a-z("']/.test(b);
}

function union(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  const r = Math.max(a[0] + a[2], b[0] + b[2]);
  const bot = Math.max(a[1] + a[3], b[1] + b[3]);
  return [x, y, r - x, bot - y];
}

/** Merge stacked body lines into one paragraph box. Labels stay on their own line. */
export function groupImageRegions(regions: ImageRegion[]): ImageRegion[] {
  const items = regions.filter((r) => r.box).slice().sort((a, b) => a.box![1] - b.box![1] || a.box![0] - b.box![0]);
  const out: ImageRegion[] = [];
  for (const region of items) {
    const prev = out[out.length - 1];
    if (prev?.box && region.box && continues(prev.textEn, region.textEn) && stacked(prev.box, region.box)) {
      prev.box = union(prev.box, region.box);
      prev.textEn = `${prev.textEn} ${region.textEn}`.replace(/\s+/g, ' ').trim();
      prev.textZh = `${prev.textZh}${region.textZh}`;
      prev.kind = 'paragraph';
      continue;
    }
    out.push({ ...region, kind: isProse(region.textEn) ? 'paragraph' : 'line' });
  }
  return out;
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
        if (!textEn && !textZh) continue;
        const boxRaw = (r as { box_2d?: unknown }).box_2d ?? r.box;
        regions.push({ textEn, textZh, box: boxToFractions(boxRaw) });
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

function isRetryable(err: unknown): boolean {
  if (err instanceof GeminiStatusError) return err.status === 429 || err.status >= 500;
  const msg = String((err as { message?: unknown })?.message ?? err);
  return /\b(429|500|502|503|504)\b/.test(msg) || /timeout|timed out|abort/i.test(msg);
}

async function callOnce(
  fetchImpl: typeof fetch,
  key: string,
  model: string,
  mime: string,
  data: string,
  log: (line: string) => void,
): Promise<{ text: string; regions: ImageRegion[] }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = buildImageBody({ mime, data, model });
  log(`[IBT] image gemini ${new Date().toISOString()} model=${model} bytes=${data.length} mime=${mime}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMAGE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new GeminiStatusError(`Gemini timeout ${String((err as Error)?.message || err)}`, 504, null);
  }
  clearTimeout(timer);
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const retryHeader = Number(res.headers.get('retry-after'));
    const retrySec = Number.isFinite(retryHeader) && retryHeader > 0
      ? Math.ceil(retryHeader)
      : retrySeconds(raw);
    log(`[IBT] image gemini fail model=${model} status=${res.status} retry=${retrySec ?? '-'} ${raw.slice(0, 300)}`);
    throw new GeminiStatusError(`Gemini ${res.status} retry=${retrySec ?? 0}`, res.status, retrySec);
  }
  const json = await res.json();
  const content: string = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') ?? '';
  return parseImageTranslation(content);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Primary model, then one wait-and-retry, then each fallback in order.
 * Never two models at once. `log` receives one line per HTTP call.
 */
export async function translateImageSequential(opts: {
  key: string;
  model?: string;
  mime: string;
  data: string;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}): Promise<ImageTranslation> {
  const key = opts.key.trim();
  if (!key) throw new Error('NO_API_KEY:image');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.log ?? ((line) => console.log(line));
  const chain = imageModelChain(opts.model);
  let last: unknown = new Error('圖片翻譯失敗');
  const t0 = Date.now();
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    try {
      const got = await callOnce(fetchImpl, key, model, opts.mime, opts.data, log);
      log(`[IBT] image gemini done model=${model} ${Date.now() - t0}ms`);
      return { ...got, model };
    } catch (err) {
      last = err;
      if (!isRetryable(err)) break;
      if (i === 0) {
        const sec = err instanceof GeminiStatusError ? err.retrySec : retrySeconds(String((err as Error)?.message || ''));
        const wait = Math.min(8, Math.max(1, sec || 2));
        log(`[IBT] image gemini retry model=${model} in ${wait}s`);
        await sleep(wait * 1000);
        try {
          const got = await callOnce(fetchImpl, key, model, opts.mime, opts.data, log);
          log(`[IBT] image gemini done model=${model} ${Date.now() - t0}ms`);
          return { ...got, model };
        } catch (again) {
          last = again;
          if (!isRetryable(again)) break;
        }
      }
    }
  }
  throw new Error(friendlyTranslateError(last, 'image'));
}
