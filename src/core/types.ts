export type ProviderId = 'google' | 'microsoft' | 'openai' | 'gemini' | 'ollama';
export type Layout = 'origTop' | 'transTop';
export type SubtitleOrder = 'zhTop' | 'enTop';   // YouTube movie-mode line order
export type SiteId = 'x' | 'reddit' | 'youtube' | 'netflix';
/** Page display. Empty string means the user has not chosen — each surface keeps its own default. */
export type ViewModeSetting = '' | 'both' | 'zh' | 'orig';

export interface Settings {
  enabled: boolean;
  sites: Record<SiteId, boolean>;
  showOriginal: boolean;        // also repeat the original inside our block (default false → no duplication)
  viewMode: ViewModeSetting;    // explicit 譯文呈現; '' = never chosen (not the same as 'both')
  layout: Layout;
  subtitleOrder: SubtitleOrder; // YouTube subtitle order (both languages shown); default Chinese on top
  transStyle: string;           // visual style of the translated text (underline / box / blur / …)
  transColor: string;           // '' = inherit the page text. A saved hex is a deliberate custom color.
  /** Set once the user picks a text color or 「跟頁面顏色」, so a later gold pick is kept. */
  transColorSet?: boolean;
  barStyle: string;             // none | bar | thick | dashed. Default none.
  barColor: string;             // '' uses the mark's fallback color when a bar is shown.
  /** Translucent chip behind the translated words. On unless the user turned it off. */
  transHighlight: boolean;
  /** Set once the user toggles 淡底色, so the 1.4.36 default-on migration does not undo them. */
  transHighlightSet?: boolean;
  /** Light-page chip color. '' uses the pale cream. Dark pages stay a white wash. */
  highlightColor: string;
  fontScale: number;            // 0.8 – 1.6
  sourceLang: string;           // BCP-47 source-language code, or 'auto' to detect (default)
  targetLang: string;           // natural-language name, used by LLM prompts
  targetLangCode: string;       // BCP-47 code, used by the free Google engine (e.g. zh-TW)
  translateOnVisible: boolean;  // only translate elements scrolled into view
  provider: ProviderId;
  model: string;                // ignored by the free Google engine
  /** 'local' reads the image on-device. 'gemini' sends it to a vision model. */
  imageModel: string;
  /** Show a 「譯」 button beside a text selection. Default on. */
  selectionTranslate: boolean;
  /** Open the selection card immediately, without the button. On unless the user turned it off. */
  selectionInstant: boolean;
  /** Set once the user toggles 選取後立即顯示. */
  selectionInstantSet?: boolean;
  apiKeys: Record<ProviderId, string>;
  ollamaEndpoint: string;
  cacheEnabled: boolean;
}

/** Retired page-text default. Stored copies migrate back to inherit. Video subtitles stay white until a custom color is saved. */
export const DEFAULT_TRANS_COLOR = '#f2d492';
/** Retired with the left bar. */
export const DEFAULT_BAR_COLOR = '#f2d492';
/** Stored before 1.4.18 when the picker saved the old blue default. Treated as "never customized". */
export const LEGACY_DEFAULT_COLOR = '#6c7aff';

export const TINT_HUES = ['blue', 'green', 'amber', 'orange', 'red', 'violet'] as const;

export function normalizeTint(value: string | undefined): string {
  const raw = (value || '').trim();
  const name = raw.toLowerCase();
  if ((TINT_HUES as readonly string[]).includes(name)) return name;
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  return '';
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  sites: { x: true, reddit: true, youtube: true, netflix: true },
  showOriginal: false,
  viewMode: '',
  layout: 'transTop',
  subtitleOrder: 'zhTop',
  transStyle: 'plain',
  transColor: '',
  barStyle: 'none',
  barColor: '',
  transHighlight: true,
  highlightColor: '',
  fontScale: 1,
  sourceLang: 'auto',          // ← detect any source language (Korean/Japanese/…)
  targetLang: 'Traditional Chinese (zh-TW)',
  targetLangCode: 'zh-TW',
  translateOnVisible: true,
  provider: 'google',          // ← FREE by default, no API key required
  model: '',
  imageModel: 'local',
  selectionTranslate: true,
  selectionInstant: true,
  apiKeys: { google: '', microsoft: '', openai: '', gemini: '', ollama: '' },
  ollamaEndpoint: 'http://localhost:11434',
  cacheEnabled: true,
};

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  google: '',
  microsoft: '',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-3.5-flash-lite',
  ollama: 'qwen2.5:7b',
};

// ---- messaging between content <-> background ----
export interface AlignedPair { o: string; t: string; }

export interface TranslateMessage {
  type: 'translate';
  text: string;
  title?: string;                // page title, sent by the content script as LLM context (prose path)
  mode?: 'prose' | 'subtitle';   // translation register; service worker treats a missing mode as 'subtitle'
  retry?: boolean;               // the user clicked 重試: try a spent Gemini model once
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

/** One dictionary sense for a single word (free Google dt=bd data). */
export interface DictEntry { pos: string; terms: string[]; }

/** Result of a single-word/phrase lookup for the double-click popup. */
export interface WordLookup {
  translation: string;   // full translated text of the selection
  sourceLang: string;    // detected source language (BCP-47, '' if unknown) — used to pick a TTS voice
  dict?: DictEntry[];     // only present when the engine returned dictionary data
}

/** Look up a short selection: translation + detected source language (+ dictionary when available). */
export interface LookupMessage {
  type: 'lookup';
  text: string;
}

export interface LookupResponse {
  ok: boolean;
  lookup?: WordLookup;
  error?: string;
}

export interface FetchImageMessage {
  type: 'ibt-fetch-image';
  url: string;
}
export interface CaptureTabMessage { type: 'ibt-capture-tab' }
export interface TranslateImageMessage {
  type: 'ibt-translate-image';
  mime: string;
  data: string;
}
export interface OcrTranslateMessage {
  type: 'ibt-ocr-translate';
  mime: string;
  data: string;
}

export type RuntimeMessage = TranslateMessage | TranslateBatchMessage | LookupMessage | FetchImageMessage | CaptureTabMessage | TranslateImageMessage | OcrTranslateMessage;
