import { Settings } from '../core/types';
import { TranslateInput, TranslationProvider, buildSystemPrompt, coerceTranslations } from './base';
import { executeGeminiRoute } from '../core/gemini-route';
import { pageModelChain, quotaBindingReady, alignQuotaKey, consumeGeminiRetry } from '../core/quota-router';

/** Gemini 3 family model ids support thinkingLevel (v3 API shape). */
function isGemini3(model: string): boolean {
  return /gemini-3/i.test(model);
}

export const geminiProvider: TranslationProvider = {
  id: 'gemini',
  async translate(input: TranslateInput, settings: Settings): Promise<string[]> {
    const key = settings.apiKeys.gemini?.trim();
    if (!key) throw new Error('NO_API_KEY:gemini');
    await alignQuotaKey(key);
    const bound = await quotaBindingReady();
    if (bound?.waitForImage) await bound.waitForImage();
    const state = bound?.state ?? { keyId: '', models: {}, switchedFrom: '', switchedTo: '' };
    const prompt = buildSystemPrompt(input.targetLang, input.sourceLang, { pageTitle: input.pageTitle, mode: input.mode });
    const t0 = performance.now();
    const routed = await executeGeminiRoute({
      key,
      chain: pageModelChain(settings.model),
      purpose: 'page',
      state,
      onState: () => bound?.persist(),
      force: consumeGeminiRetry(),
      buildBody: (model) => ({
        systemInstruction: { parts: [{ text: prompt }] },
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
    });
    const data = routed.json as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
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
