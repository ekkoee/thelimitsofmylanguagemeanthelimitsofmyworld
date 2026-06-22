import { Settings } from '../core/types';
import { TranslateInput, TranslationProvider, buildSystemPrompt, coerceTranslations } from './base';

export const geminiProvider: TranslationProvider = {
  id: 'gemini',
  async translate(input: TranslateInput, settings: Settings): Promise<string[]> {
    const key = settings.apiKeys.gemini?.trim();
    if (!key) throw new Error('NO_API_KEY:gemini');
    const model = settings.model || 'gemini-2.5-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemPrompt(input.targetLang) }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify({ sentences: input.sentences }) }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await safeBody(res)}`);
    const data = await res.json();
    const content: string = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
    return coerceTranslations(content, input.sentences.length);
  },
};

async function safeBody(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}
