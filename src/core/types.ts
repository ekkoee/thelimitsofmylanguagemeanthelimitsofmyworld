export type ProviderId = 'google' | 'openai' | 'gemini' | 'ollama';
export type Layout = 'origTop' | 'transTop';
export type SubtitleOrder = 'zhTop' | 'enTop';   // YouTube movie-mode line order
export type SiteId = 'x' | 'reddit' | 'youtube';

export interface Settings {
  enabled: boolean;
  sites: Record<SiteId, boolean>;
  showOriginal: boolean;        // also repeat the original inside our block (default false → no duplication)
  layout: Layout;
  subtitleOrder: SubtitleOrder; // YouTube subtitle order (both languages shown); default Chinese on top
  transStyle: string;           // visual style of the translated text (underline / box / blur / …)
  transColor: string;           // custom color for translated text ('' = use default)
  fontScale: number;            // 0.8 – 1.6
  sourceLang: string;           // BCP-47 source-language code, or 'auto' to detect (default)
  targetLang: string;           // natural-language name, used by LLM prompts
  targetLangCode: string;       // BCP-47 code, used by the free Google engine (e.g. zh-TW)
  translateOnVisible: boolean;  // only translate elements scrolled into view
  provider: ProviderId;
  model: string;                // ignored by the free Google engine
  apiKeys: Record<ProviderId, string>;
  ollamaEndpoint: string;
  cacheEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  sites: { x: true, reddit: true, youtube: true },
  showOriginal: false,
  layout: 'transTop',
  subtitleOrder: 'zhTop',
  transStyle: 'plain',
  transColor: '',
  fontScale: 1,
  sourceLang: 'auto',          // ← detect any source language (Korean/Japanese/…)
  targetLang: 'Traditional Chinese (zh-TW)',
  targetLangCode: 'zh-TW',
  translateOnVisible: true,
  provider: 'google',          // ← FREE by default, no API key required
  model: '',
  apiKeys: { google: '', openai: '', gemini: '', ollama: '' },
  ollamaEndpoint: 'http://localhost:11434',
  cacheEnabled: true,
};

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  google: '',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash-lite',
  ollama: 'qwen2.5:7b',
};

// ---- messaging between content <-> background ----
export interface AlignedPair { o: string; t: string; }

export interface TranslateMessage {
  type: 'translate';
  text: string;
}

export interface TranslateResponse {
  ok: boolean;
  pairs?: AlignedPair[];
  error?: string;
}

/** Translate several independent lines in ONE request (keeps LLM calls low so
 *  free-tier rate limits aren't exhausted). Order of `translations` matches `texts`. */
export interface TranslateBatchMessage {
  type: 'translateBatch';
  texts: string[];
}

export interface TranslateBatchResponse {
  ok: boolean;
  translations?: string[];
  error?: string;
}

export type RuntimeMessage = TranslateMessage | TranslateBatchMessage;
