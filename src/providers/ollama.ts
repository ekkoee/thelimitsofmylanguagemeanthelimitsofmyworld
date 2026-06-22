import { Settings } from '../core/types';
import { TranslateInput, TranslationProvider, buildSystemPrompt, coerceTranslations } from './base';

// Local models via Ollama (https://ollama.com). No API key required.
export const ollamaProvider: TranslationProvider = {
  id: 'ollama',
  async translate(input: TranslateInput, settings: Settings): Promise<string[]> {
    const endpoint = (settings.ollamaEndpoint || 'http://localhost:11434').replace(/\/+$/, '');
    const model = settings.model || 'qwen2.5:7b';

    const res = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: { temperature: 0.2 },
        messages: [
          { role: 'system', content: buildSystemPrompt(input.targetLang, input.sourceLang) },
          { role: 'user', content: JSON.stringify({ sentences: input.sentences }) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await safeBody(res)}`);
    const data = await res.json();
    const content: string = data?.message?.content ?? '';
    return coerceTranslations(content, input.sentences.length);
  },
};

async function safeBody(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 300); } catch { return ''; }
}
