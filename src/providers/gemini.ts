import { Settings } from '../core/types';
import { TranslateInput, TranslationProvider, buildSystemPrompt, coerceTranslations, fetchWithRetry } from './base';

/**
 * Gemini 3+ model ids. `thinkingLevel` is the v3 shape — never send it together
 * with `thinkingBudget` (the API returns 400).
 */
function isGemini3Plus(model: string): boolean {
  return /gemini-(?:[3-9]|[1-9]\d)/i.test(model);
}

/** Official replacement when Google aliases a retired id onto a slower default. */
export function resolveGeminiModel(model: string | undefined): string {
  const raw = (model || '').trim();
  const m = raw || 'gemini-3.5-flash-lite';
  // Oct 2026: gemini-3.5-flash is deprecated and silently routed to gemini-3.6-flash,
  // whose default thinking level is `medium`. Calling the retired id lets that
  // redirect drop or ignore the caller's thinkingConfig. Hit 3.6 directly and
  // pin the level ourselves. 3.7-flash is the same story → 3.8-flash.
  if (/^gemini-3\.5-flash$/i.test(m)) return 'gemini-3.6-flash';
  if (/^gemini-3\.7-flash$/i.test(m)) return 'gemini-3.8-flash';
  return m;
}

/**
 * Fastest thinking setting the model actually accepts.
 * 3.8 Flash and Gemini 4 reject `minimal` (HTTP 400). 2.5 has no thinkingLevel;
 * `thinkingBudget: 0` is the off switch. Anything older omits the field.
 */
export function geminiThinking(model: string): { thinkingLevel: string; includeThoughts: boolean } | { thinkingBudget: number; includeThoughts: boolean } | undefined {
  const m = model.toLowerCase();
  if (/gemini-4(?:[.\-]|$)/.test(m) || /gemini-3\.8(?:[.\-]|$)/.test(m)) {
    return { thinkingLevel: 'low', includeThoughts: false };
  }
  if (/gemini-3/.test(m)) return { thinkingLevel: 'minimal', includeThoughts: false };
  if (/gemini-2\.5/.test(m)) return { thinkingBudget: 0, includeThoughts: false };
  return undefined;
}

/** Cap output (thinking tokens count toward it on current Gemini models) so a
 *  translation can't sit in a 64k default budget before the first answer token. */
export function geminiOutputCap(sentences: string[]): number {
  const chars = sentences.reduce((n, s) => n + s.length, 0);
  return Math.min(4096, Math.max(384, chars * 3 + 128));
}

export function geminiTimeoutMs(sentenceCount: number): number {
  return Math.min(18_000, 5_000 + Math.max(1, sentenceCount) * 600);
}

/** Answer text only. Thought parts (`thought: true`) are not the translation;
 *  concatenating them makes the JSON unparseable and forces a second, slow path. */
export function geminiAnswerText(data: unknown): string {
  const parts = (data as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] })
    ?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.filter((p) => p && p.thought !== true && typeof p.text === 'string').map((p) => p.text).join('');
}

export function asGeminiError(err: unknown, aborted: boolean): Error {
  if (aborted) return new Error('Gemini timeout');
  return err instanceof Error ? err : new Error(String(err));
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: { t: { type: 'array', items: { type: 'string' } } },
  required: ['t'],
};

export const geminiProvider: TranslationProvider = {
  id: 'gemini',
  async translate(input: TranslateInput, settings: Settings): Promise<string[]> {
    const key = settings.apiKeys.gemini?.trim();
    if (!key) throw new Error('NO_API_KEY:gemini');
    const requested = (settings.model || '').trim();
    const model = resolveGeminiModel(requested);
    if (model !== (requested || 'gemini-3.5-flash-lite')) {
      console.log(`[IBT] gemini model ${requested || '(default)'} → ${model}`);
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const thinking = geminiThinking(model);
    const cap = geminiOutputCap(input.sentences);
    const timeoutMs = geminiTimeoutMs(input.sentences.length);

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: cap,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    };
    // temperature/topP/topK are ignored since Gemini 3.6 / 3.5 Flash-Lite and
    // upcoming models reject them with 400. Keeping 0.2 only for older ids,
    // which still honor it. Gemini 3's reasoning is tuned for the default.
    if (!isGemini3Plus(model)) generationConfig.temperature = 0.2;
    if (thinking) generationConfig.thinkingConfig = thinking;

    const body: Record<string, unknown> = {
      // Oct 26 2026: paid-tier generateContent stores requests by default.
      // Logging is extra work on the critical path and we don't need it.
      store: false,
      systemInstruction: { parts: [{ text: buildSystemPrompt(input.targetLang, input.sourceLang, { pageTitle: input.pageTitle, mode: input.mode }) }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify({ sentences: input.sentences }) }] }],
      generationConfig,
    };

    const t0 = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const post = (thinkingConfig: typeof thinking) => {
      const generation = { ...generationConfig };
      if (thinkingConfig) generation.thinkingConfig = thinkingConfig;
      else delete generation.thinkingConfig;
      return fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, generationConfig: generation }),
        signal: ctrl.signal,
      }, { label: 'gemini', maxRetries: 1, noRetry429: true });
    };

    let res: Response;
    try {
      res = await post(thinking);
      // 3.8 / Gemini 4 (and any future id) 400 on `minimal`. One retry at `low`.
      if (res.status === 400 && thinking && 'thinkingLevel' in thinking && thinking.thinkingLevel === 'minimal') {
        const errText = await res.clone().text();
        if (/thinking/i.test(errText)) {
          console.warn('[IBT] gemini rejected thinkingLevel minimal → retry at low');
          res = await post({ thinkingLevel: 'low', includeThoughts: false });
        }
      }
    } catch (err) {
      throw asGeminiError(err, ctrl.signal.aborted);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await safeBody(res)}`);
    const data = await res.json();
    // Timing log for diagnosing latency: ms/sent/tokens. `think` > 0 means the
    // model still reasoned. A timeout never reaches this line — the caller
    // falls back to the free engine.
    {
      const u = (data as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } })?.usageMetadata ?? {};
      const think = u.thoughtsTokenCount ?? 0;
      console.log(`[IBT] gemini ${Math.round(performance.now() - t0)}ms model=${model} sent=${input.sentences.length} in=${u.promptTokenCount} out=${u.candidatesTokenCount} think=${think} cap=${cap}`);
      if (think > 0) console.warn(`[IBT] gemini spent ${think} thinking tokens (level was ${thinking && 'thinkingLevel' in thinking ? thinking.thinkingLevel : 'budget'})`);
    }
    const content = geminiAnswerText(data);
    if (!content.trim()) throw new Error('empty response');
    return coerceTranslations(content, input.sentences.length);
  },
};

async function safeBody(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}
