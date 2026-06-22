import { ProviderId } from '../core/types';
import { TranslationProvider } from './base';
import { googleProvider } from './google';
import { openaiProvider } from './openai';
import { geminiProvider } from './gemini';
import { ollamaProvider } from './ollama';

const registry: Record<ProviderId, TranslationProvider> = {
  google: googleProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
  ollama: ollamaProvider,
};

export function getProvider(id: ProviderId): TranslationProvider {
  return registry[id] ?? googleProvider;
}

export type { TranslationProvider } from './base';
