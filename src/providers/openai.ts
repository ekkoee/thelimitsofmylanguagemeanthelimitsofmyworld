import { Settings } from '../core/types';
import { TranslateInput, TranslationProvider, buildSystemPrompt, coerceTranslations } from './base';

export const openaiProvider: TranslationProvider = {
  id: 'openai',
  async translate(input: TranslateInput, settings: Settings): Promise<string[]> {
    const key = settings.apiKeys.openai?.trim();
    if (!key) throw new Error('NO_API_KEY:openai');
    const model = settings.model || 'gpt-4o-mini';

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildSystemPrompt(input.targetLang, input.sourceLang) },
          { role: 'user', content: JSON.stringify({ sentences: input.sentences }) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await safeBody(res)}`);
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? '';
    return coerceTranslations(content, input.sentences.length);
  },
};

async function safeBody(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}
