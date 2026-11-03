import { DEFAULT_SETTINGS, LEGACY_DEFAULT_COLOR, Settings, normalizeTint } from './types';

const SETTINGS_KEY = 'ibt_settings';
/** Gemini key stays on this computer. It is never written to chrome.storage.sync. */
export const GEMINI_KEY_STORAGE = 'ibt_gemini_key';

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

function blankGemini(keys: Partial<Settings['apiKeys']> | undefined): Settings['apiKeys'] {
  return { ...DEFAULT_SETTINGS.apiKeys, ...(keys ?? {}), gemini: '' };
}

async function readLocalGemini(): Promise<string> {
  const raw = await chrome.storage.local.get(GEMINI_KEY_STORAGE);
  const value = raw?.[GEMINI_KEY_STORAGE];
  return typeof value === 'string' ? value : '';
}

async function writeLocalGemini(value: string): Promise<void> {
  if (value) await chrome.storage.local.set({ [GEMINI_KEY_STORAGE]: value });
  else await chrome.storage.local.remove(GEMINI_KEY_STORAGE);
}

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.sync.get(SETTINGS_KEY);
  const stored = (raw?.[SETTINGS_KEY] ?? {}) as Partial<Settings> & { linkedinExpandTranslate?: unknown; transHighlightSet?: boolean; transColorSet?: boolean; slopButton?: unknown; slopApi?: unknown; slopApiKey?: unknown };
  const dropLinkedIn = Object.prototype.hasOwnProperty.call(stored, 'linkedinExpandTranslate');
  const dropSlop = 'slopButton' in stored || 'slopApi' in stored || 'slopApiKey' in stored;
  const needColor = !colorChosen(stored) && isLegacyDefaultColor(stored.transColor);
  const needTint = !highlightChosen(stored);
  const syncKey = typeof stored.apiKeys?.gemini === 'string' ? stored.apiKeys.gemini : '';
  let gemini = await readLocalGemini();
  if (!gemini && syncKey) {
    gemini = syncKey;
    await writeLocalGemini(syncKey);
  }
  // deep-ish merge so new default keys appear after upgrades. The sync copy never supplies the key.
  const merged = {
    ...DEFAULT_SETTINGS,
    ...stored,
    sites: { ...DEFAULT_SETTINGS.sites, ...(stored.sites ?? {}) },
    apiKeys: blankGemini(stored.apiKeys),
  } as Settings & { transHighlightSet?: boolean; linkedinExpandTranslate?: unknown };
  if (needTint) {
    merged.transHighlight = true;
    merged.transHighlightSet = true;
  }
  const next = normalizeSettings(merged);
  next.apiKeys = { ...next.apiKeys, gemini };
  // Drop a stored #6c7aff so the new default shows up, and pull any leftover key out of sync.
  if (needColor || needTint || dropLinkedIn || dropSlop || syncKey) {
    const patched = { ...stored } as Partial<Settings> & { transHighlightSet?: boolean; transColorSet?: boolean; linkedinExpandTranslate?: unknown; slopButton?: unknown; slopApi?: unknown; slopApiKey?: unknown };
    delete patched.linkedinExpandTranslate;
    delete patched.slopButton;
    delete patched.slopApi;
    delete patched.slopApiKey;
    patched.apiKeys = blankGemini(stored.apiKeys);
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
  await writeLocalGemini(next.apiKeys.gemini || '');
  await chrome.storage.sync.set({
    [SETTINGS_KEY]: { ...next, apiKeys: blankGemini(next.apiKeys) },
  });
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    const syncChanged = area === 'sync' && !!changes[SETTINGS_KEY];
    const keyChanged = area === 'local' && !!changes[GEMINI_KEY_STORAGE];
    if (!syncChanged && !keyChanged) return;
    // Re-read so a sync write (which stores an empty key) cannot clobber the local key.
    void loadSettings().then(cb).catch(() => {});
  });
}
