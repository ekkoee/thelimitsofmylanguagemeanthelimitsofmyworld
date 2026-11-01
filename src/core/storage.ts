import { DEFAULT_SETTINGS, LEGACY_DEFAULT_COLOR, Settings } from './types';

const SETTINGS_KEY = 'ibt_settings';

/** True only for the pre-1.4.18 default blue. Empty and any other color are left alone. */
export function isLegacyDefaultColor(value: string | undefined): boolean {
  return (value || '').trim().toLowerCase() === LEGACY_DEFAULT_COLOR;
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
function normalizeSettings(s: Settings): Settings {
  const isGemini = s.provider === 'gemini';
  return {
    ...s,
    provider: isGemini ? 'gemini' : 'google',
    model: isGemini && !/^gemini/i.test(s.model || '') ? 'gemini-3.5-flash-lite' : s.model || '',
    sourceLang: 'auto',
    translateOnVisible: true,
    cacheEnabled: true,
    sites: { x: true, reddit: true, youtube: true },
    // '' is "never chosen". Do not coerce it to 'both' — X video treats unset as Chinese-only.
    viewMode: s.viewMode === 'zh' || s.viewMode === 'both' || s.viewMode === 'orig' ? s.viewMode : '',
    // Missing means on. Only an explicit false turns LinkedIn expand-translation off.
    linkedinExpandTranslate: s.linkedinExpandTranslate !== false,
    transColor: migrateDefaultColor(s.transColor),
    barColor: migrateDefaultColor(s.barColor),
  };
}

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.sync.get(SETTINGS_KEY);
  const stored = (raw?.[SETTINGS_KEY] ?? {}) as Partial<Settings>;
  const hadLegacy = isLegacyDefaultColor(stored.transColor) || isLegacyDefaultColor(stored.barColor);
  // deep-ish merge so new default keys appear after upgrades
  const next = normalizeSettings({
    ...DEFAULT_SETTINGS,
    ...stored,
    sites: { ...DEFAULT_SETTINGS.sites, ...(stored.sites ?? {}) },
    apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...(stored.apiKeys ?? {}) },
  });
  // Drop a stored #6c7aff so the new default shows up, without rewriting other fields.
  if (hadLegacy) {
    const patched = { ...stored };
    if (isLegacyDefaultColor(stored.transColor)) patched.transColor = '';
    if (isLegacyDefaultColor(stored.barColor)) patched.barColor = '';
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
