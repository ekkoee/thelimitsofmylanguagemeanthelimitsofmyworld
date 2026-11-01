import { Settings } from '../core/types';
import { TranslateInput, TranslationProvider, buildSystemPrompt, coerceTranslations, fetchWithRetry } from './base';

/** Gemini 3 family model ids support thinkingLevel (v3 API shape). */
function isGemini3(model: string): boolean {
  return /gemini-3/i.test(model);
}

export const geminiProvider: TranslationProvider = {
  id: 'gemini',
  async translate(input: TranslateInput, settings: Settings): Promise<string[]> {
    const key = settings.apiKeys.gemini?.trim();
    if (!key) throw new Error('NO_API_KEY:gemini');
    const model = settings.model || 'gemini-3.5-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

    const t0 = performance.now();
    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemPrompt(input.targetLang, input.sourceLang, { pageTitle: input.pageTitle, mode: input.mode }) }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify({ sentences: input.sentences }) }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          // Gemini 3 defaults to `high` thinking: full reasoning depth before the
          // first token, which is pure latency on a translation task (TTFT suffers
          // most). `minimal` is Flash-only and documented as "matches no thinking
          // for most queries": same translation quality, far less waiting.
          // Only sent for Gemini 3 model ids — thinkingLevel is a v3 API shape,
          // and it must never be combined with thinkingBudget (API 400s on that).
          ...(isGemini3(model) ? { thinkingConfig: { thinkingLevel: 'minimal' } } : {}),
        },
      }),
    }, { label: 'gemini', maxRetries: 1, noRetry429: true });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await safeBody(res)}`);
    const data = await res.json();
    // Timing log for diagnosing latency: ms/sent/tokens. If `ms` is large but
    // `out` is small, time went to pacing/queue, not the model. `think` > 0
    // would mean thinking is not actually disabled.
    {
      const u = (data as any)?.usageMetadata ?? {};
      console.log(`[IBT] gemini ${Math.round(performance.now() - t0)}ms sent=${input.sentences.length} in=${u.promptTokenCount} out=${u.candidatesTokenCount} think=${u.thoughtsTokenCount ?? 0}`);
    }
    const content: string = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
    return coerceTranslations(content, input.sentences.length);
  },
};

async function safeBody(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}

/** Image OCR. Primary is the user's Gemini model, or 3.5 Flash. A slow primary
 *  is hedged with 2.5 Flash-Lite, same idea as the text hedge. */
export const IMAGE_PRIMARY_DEFAULT = 'gemini-3.5-flash';
export const IMAGE_HEDGE_MODEL = 'gemini-2.5-flash-lite';
const IMAGE_HEDGE_DELAY_MS = 1500;

export interface ImageRegion { text: string; box: [number, number, number, number] }
export interface ImageTranslation { text: string; regions: ImageRegion[] }

const IMAGE_PROMPT = [
  'Look at the image. OCR every piece of English or other non-Chinese text and translate it into Traditional Chinese as used in Taiwan (繁體中文).',
  'Preserve paragraph and line breaks in "text". Do not invent text that is not in the image.',
  'If the image has no meaningful text (a photo, a logo with no words, decoration), return {"text":"","regions":[]}.',
  'When you can locate a line, add a region. box is [x, y, w, h] as fractions of the image width and height, origin at the top left, each number from 0 to 1.',
  'Return ONLY JSON: {"text":"...","regions":[{"text":"...","box":[0,0,1,0.1]}]}',
].join('\n');

export function buildImageBody(opts: { mime: string; data: string; model: string }): Record<string, unknown> {
  return {
    contents: [{
      role: 'user',
      parts: [
        { text: IMAGE_PROMPT },
        { inline_data: { mime_type: opts.mime || 'image/png', data: opts.data } },
      ],
    }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      ...(isGemini3(opts.model) ? { thinkingConfig: { thinkingLevel: 'minimal' } } : {}),
    },
  };
}

export function parseImageTranslation(raw: string): ImageTranslation {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return { text: raw.trim(), regions: [] };
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as { text?: unknown; regions?: unknown };
    const text = typeof obj.text === 'string' ? obj.text.trim() : '';
    const regions: ImageRegion[] = [];
    if (Array.isArray(obj.regions)) {
      for (const r of obj.regions) {
        const box = (r as { box?: unknown })?.box;
        const t = (r as { text?: unknown })?.text;
        if (typeof t !== 'string' || !t.trim() || !Array.isArray(box) || box.length !== 4) continue;
        const nums = box.map((n) => Number(n));
        if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 1)) continue;
        const [, , w, h] = nums;
        if (w < 0.02 || h < 0.02 || w > 0.98 || h > 0.98) continue;
        regions.push({ text: t.trim(), box: nums as [number, number, number, number] });
      }
    }
    return { text, regions: regionsReliable(regions) ? regions : [] };
  } catch {
    return { text: '', regions: [] };
  }
}

function regionsReliable(regions: ImageRegion[]): boolean {
  if (regions.length < 1 || regions.length > 12) return false;
  const key = (r: ImageRegion) => r.box.map((n) => n.toFixed(2)).join(',');
  const uniq = new Set(regions.map(key));
  return uniq.size === regions.length;
}

async function callGeminiImage(key: string, model: string, mime: string, data: string): Promise<ImageTranslation> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = buildImageBody({ mime, data, model });
  console.log(`[IBT] image request model=${model} mime=${mime} bytes=${data.length}`);
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, { label: 'gemini-image', maxRetries: 0, noRetry429: true });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await safeBody(res)}`);
  const json = await res.json();
  const content: string = json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') ?? '';
  return parseImageTranslation(content);
}

export async function translateImage(opts: { mime: string; data: string; model?: string; key: string }): Promise<ImageTranslation> {
  const key = opts.key.trim();
  if (!key) throw new Error('NO_API_KEY:gemini');
  const primary = (opts.model && /^gemini/i.test(opts.model)) ? opts.model : IMAGE_PRIMARY_DEFAULT;
  const hedge = IMAGE_HEDGE_MODEL;
  if (primary.toLowerCase() === hedge.toLowerCase()) return callGeminiImage(key, primary, opts.mime, opts.data);
  const t0 = Date.now();
  return new Promise<ImageTranslation>((resolve, reject) => {
    let settled = false;
    let hedgeStarted = false;
    let primaryErr: unknown = null;
    let hedgeErr: unknown = null;
    const finish = (which: string, value: ImageTranslation) => {
      if (settled) return;
      settled = true;
      console.log(`[IBT] image race primary=${primary} hedge=${hedge} shown=${which}@${Date.now() - t0}ms`);
      resolve(value);
    };
    const fail = () => {
      if (settled || !primaryErr || !hedgeErr) return;
      settled = true;
      reject(primaryErr);
    };
    const startHedge = () => {
      if (settled || hedgeStarted) return;
      hedgeStarted = true;
      void callGeminiImage(key, hedge, opts.mime, opts.data).then((v) => finish('hedge', v)).catch((err) => { hedgeErr = err; fail(); });
    };
    void callGeminiImage(key, primary, opts.mime, opts.data).then((v) => finish('primary', v)).catch((err) => { primaryErr = err; startHedge(); fail(); });
    setTimeout(startHedge, IMAGE_HEDGE_DELAY_MS);
  });
}
