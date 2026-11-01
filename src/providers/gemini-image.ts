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
  box?: [number, number, number, number];
}

export interface ImageTranslation {
  text: string;
  regions: ImageRegion[];
  model: string;
}

const IMAGE_PROMPT = [
  'OCR every distinct text line in the image.',
  'For each line return text_en (the original wording) and text_zh (Traditional Chinese as used in Taiwan, 繁體中文).',
  'text_zh MUST be written in Chinese characters. Never copy English into text_zh. Never return an API error.',
  'box is optional: [x, y, w, h] as fractions of the image width and height, origin top-left, each number from 0 to 1. The box must cover that whole line.',
  'If the image has no meaningful text, return {"regions":[]}.',
  'Return ONLY JSON: {"regions":[{"text_en":"...","text_zh":"...","box":[0,0,1,0.1]}]}',
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

function boxOf(raw: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined;
  const nums = raw.map((n) => Number(n));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 1)) return undefined;
  const [, , w, h] = nums as [number, number, number, number];
  if (w < 0.02 || h < 0.015 || w > 0.99 || h > 0.99) return undefined;
  return nums as [number, number, number, number];
}

export function parseImageTranslation(raw: string): { text: string; regions: ImageRegion[] } {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return { text: '', regions: [] };
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as { regions?: unknown; text?: unknown; text_zh?: unknown };
    const regions: ImageRegion[] = [];
    if (Array.isArray(obj.regions)) {
      for (const item of obj.regions) {
        const r = item as { text_en?: unknown; text_zh?: unknown; text?: unknown; box?: unknown };
        const textEn = typeof r.text_en === 'string' ? r.text_en.trim() : '';
        const textZh = typeof r.text_zh === 'string' ? r.text_zh.trim()
          : (typeof r.text === 'string' ? r.text.trim() : '');
        if (!textEn && !textZh) continue;
        regions.push({ textEn, textZh, box: boxOf(r.box) });
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
