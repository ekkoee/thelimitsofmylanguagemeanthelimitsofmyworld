import { DEFAULT_SETTINGS, LEGACY_DEFAULT_COLOR, Settings } from './types';

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

function normalizeSettings(s: Settings & { linkedinExpandTranslate?: unknown; dblClickTranslate?: unknown; transHighlightSet?: unknown }): Settings {
  const isGemini = s.provider === 'gemini';
  // The LinkedIn expand toggle was removed. A stored false must not survive on the object.
  const rest = { ...s };
  delete rest.linkedinExpandTranslate;
  delete rest.dblClickTranslate;
  return {
    ...rest,
    provider: isGemini ? 'gemini' : 'google',
    model: isGemini && !/^gemini/i.test(s.model || '') ? 'gemini-3.5-flash-lite' : s.model || '',
    imageModel: s.imageModel === 'gemini' || (s.imageModel || '').startsWith('gemini-') ? 'gemini' : 'local',
    selectionTranslate: s.selectionTranslate !== false,
    selectionInstant: s.selectionInstant === true,
    sourceLang: 'auto',
    translateOnVisible: true,
    cacheEnabled: true,
    sites: { x: true, reddit: true, youtube: true, netflix: true },
    // '' is "never chosen". Do not coerce it to 'both' — X video treats unset as Chinese-only.
    viewMode: s.viewMode === 'zh' || s.viewMode === 'both' || s.viewMode === 'orig' ? s.viewMode : '',
    barStyle: 'none',
    barColor: '',
    transHighlight: highlightChosen(s) ? s.transHighlight === true : true,
    highlightColor: /^#[0-9a-fA-F]{6}$/.test(s.highlightColor || '') ? s.highlightColor : '',
    transColor: migrateDefaultColor(s.transColor),
  };
}

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.sync.get(SETTINGS_KEY);
  const stored = (raw?.[SETTINGS_KEY] ?? {}) as Partial<Settings> & { linkedinExpandTranslate?: unknown; transHighlightSet?: boolean };
  const dropLinkedIn = Object.prototype.hasOwnProperty.call(stored, 'linkedinExpandTranslate');
  const hadLegacy = isLegacyDefaultColor(stored.transColor) || isLegacyDefaultColor(stored.barColor);
  const hadBar = stored.barStyle !== 'none' || !!(stored.barColor && stored.barColor !== '');
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
  if (hadLegacy || hadBar || needTint || dropLinkedIn) {
    const patched = { ...stored } as Partial<Settings> & { transHighlightSet?: boolean; linkedinExpandTranslate?: unknown };
    delete patched.linkedinExpandTranslate;
    if (isLegacyDefaultColor(stored.transColor)) patched.transColor = '';
    patched.barStyle = 'none';
    patched.barColor = '';
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
