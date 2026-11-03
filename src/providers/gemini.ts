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
