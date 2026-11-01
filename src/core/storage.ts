import { DEFAULT_SETTINGS, LEGACY_DEFAULT_COLOR, Settings, normalizeTint } from './types';

const SETTINGS_KEY = 'ibt_settings';

/** Retired defaults (old blue, then gold). Empty and any other color stay as the user set them. */
const RETIRED_TEXT_COLORS = new Set([LEGACY_DEFAULT_COLOR, '#f2d492']);

export function isLegacyDefaultColor(value: string | undefined): boolean {
  return RETIRED_TEXT_COLORS.has((value || '').trim().toLowerCase());
}

/** '' stays ''. The old default blue becomes '' so the new default is used and video subtitles stay white. */
export function migrateDefaultColor(value: string | undefined): string {
  const v = (value || '').trim();
  if (!v || isLegacyDefaultColor(v)) return '';
  return v;
}

/**
 * UI simplification: the site toggles, source/target-language text fields, cache and
 * visible-only toggles, and the OpenAI / Ollama / Microsoft engine choices were removed
 * from the settings UI. Force their values on read so stale stored settings can never
 * leave the extension in a state the user can no longer see or change.
 */
function highlightChosen(stored: object): boolean {
  return Object.prototype.hasOwnProperty.call(stored, 'transHighlightSet');
}

function colorChosen(stored: object): boolean {
  return Object.prototype.hasOwnProperty.call(stored, 'transColorSet');
}

function barChoice(value: string | undefined): string {
  return value === 'bar' || value === 'thick' || value === 'dashed' || value === 'none' ? value : 'none';
}

function instantChosen(stored: object): boolean {
  return Object.prototype.hasOwnProperty.call(stored, 'selectionInstantSet');
}

const UI_LANGS = new Set(['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'de', 'fr', 'es']);

function normalizeSettings(s: Settings & { linkedinExpandTranslate?: unknown; dblClickTranslate?: unknown; transHighlightSet?: unknown; transColorSet?: unknown; selectionInstantSet?: unknown }): Settings {
  const isGemini = s.provider === 'gemini';
  // The LinkedIn expand toggle was removed. A stored false must not survive on the object.
  const rest = { ...s } as typeof s & { slopButton?: unknown; slopApi?: unknown; slopApiKey?: unknown };
  delete rest.linkedinExpandTranslate;
  delete rest.dblClickTranslate;
  delete rest.slopButton;
  delete rest.slopApi;
  delete rest.slopApiKey;
  return {
    ...rest,
    provider: isGemini ? 'gemini' : 'google',
    model: isGemini && !/^gemini/i.test(s.model || '') ? 'gemini-3.5-flash-lite' : s.model || '',
    imageModel: s.imageModel === 'gemini' || (s.imageModel || '').startsWith('gemini-') ? 'gemini' : 'local',
    selectionTranslate: s.selectionTranslate !== false,
    selectionInstant: instantChosen(s) ? s.selectionInstant === true : true,
    sourceLang: 'auto',
    uiLang: UI_LANGS.has(String(s.uiLang || '')) ? String(s.uiLang) : '',
    translateOnVisible: true,
    cacheEnabled: true,
    sites: { x: true, reddit: true, youtube: true, netflix: true },
    // '' is "never chosen". Do not coerce it to 'both' — X video treats unset as Chinese-only.
    viewMode: s.viewMode === 'zh' || s.viewMode === 'both' || s.viewMode === 'orig' ? s.viewMode : '',
    barStyle: barChoice(s.barStyle),
    barColor: /^#[0-9a-fA-F]{6}$/.test(s.barColor || '') ? s.barColor : '',
    transHighlight: highlightChosen(s) ? s.transHighlight === true : true,
    highlightColor: normalizeTint(s.highlightColor),
    transColor: colorChosen(s)
      ? (/^#[0-9a-fA-F]{6}$/.test(s.transColor || '') ? s.transColor : '')
      : migrateDefaultColor(s.transColor),
  };
}

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.sync.get(SETTINGS_KEY);
  const stored = (raw?.[SETTINGS_KEY] ?? {}) as Partial<Settings> & { linkedinExpandTranslate?: unknown; transHighlightSet?: boolean; transColorSet?: boolean; slopButton?: unknown; slopApi?: unknown; slopApiKey?: unknown };
  const dropLinkedIn = Object.prototype.hasOwnProperty.call(stored, 'linkedinExpandTranslate');
  const dropSlop = 'slopButton' in stored || 'slopApi' in stored || 'slopApiKey' in stored;
  const needColor = !colorChosen(stored) && isLegacyDefaultColor(stored.transColor);
  const needTint = !highlightChosen(stored);
  // deep-ish merge so new default keys appear after upgrades
  const merged = {
    ...DEFAULT_SETTINGS,
    ...stored,
    sites: { ...DEFAULT_SETTINGS.sites, ...(stored.sites ?? {}) },
    apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...(stored.apiKeys ?? {}) },
  } as Settings & { transHighlightSet?: boolean; linkedinExpandTranslate?: unknown };
  if (needTint) {
    merged.transHighlight = true;
    merged.transHighlightSet = true;
  }
  const next = normalizeSettings(merged);
  // Drop a stored #6c7aff so the new default shows up, without rewriting other fields.
  if (needColor || needTint || dropLinkedIn || dropSlop) {
    const patched = { ...stored } as Partial<Settings> & { transHighlightSet?: boolean; transColorSet?: boolean; linkedinExpandTranslate?: unknown; slopButton?: unknown; slopApi?: unknown; slopApiKey?: unknown };
    delete patched.linkedinExpandTranslate;
    delete patched.slopButton;
    delete patched.slopApi;
    delete patched.slopApiKey;
    if (needColor) {
      patched.transColor = '';
      patched.transColorSet = true;
    }
    if (needTint) {
      patched.transHighlight = true;
      patched.transHighlightSet = true;
    }
    await chrome.storage.sync.set({ [SETTINGS_KEY]: patched });
  }
  return next;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = {
    ...current,
    ...patch,
    sites: { ...current.sites, ...(patch.sites ?? {}) },
    apiKeys: { ...current.apiKeys, ...(patch.apiKeys ?? {}) },
  };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[SETTINGS_KEY]) {
      cb(normalizeSettings({ ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue as Settings) }));
    }
  });
}
