import { Settings } from '../core/types';
import { TranslateInput, TranslationProvider, buildSystemPrompt, coerceTranslations, fetchWithRetry } from './base';

/** Groq OpenAI-compatible chat completions — fast free-tier Llama for short EN→zh-TW. */
const GROQ_BASE = 'https://api.groq.com/openai/v1';

export const groqProvider: TranslationProvider = {
  id: 'groq',
  async translate(input: TranslateInput, settings: Settings): Promise<string[]> {
    const key = settings.apiKeys.groq?.trim();
    if (!key) throw new Error('NO_API_KEY:groq');
    const model = settings.model || 'llama-3.1-8b-instant';

    const res = await fetchWithRetry(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        // Cap decode work for short subtitle/social batches (lower TTFT).
        max_tokens: Math.min(4096, Math.max(256, input.sentences.length * 96)),
        messages: [
          {
            role: 'system',
            content: buildSystemPrompt(input.targetLang, input.sourceLang, {
              pageTitle: input.pageTitle,
              mode: input.mode,
              compact: true,
            }),
          },
          { role: 'user', content: JSON.stringify({ sentences: input.sentences }) },
        ],
      }),
    }, { label: 'groq' });
    if (!res.ok) throw new Error(`Groq ${res.status}: ${await safeBody(res)}`);
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? '';
    return coerceTranslations(content, input.sentences.length);
  },
};

async function safeBody(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}
