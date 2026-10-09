import { DEFAULT_SETTINGS, Settings } from './types';

const SETTINGS_KEY = 'ibt_settings';

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
  };
}

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.sync.get(SETTINGS_KEY);
  const stored = (raw?.[SETTINGS_KEY] ?? {}) as Partial<Settings>;
  // deep-ish merge so new default keys appear after upgrades
  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    ...stored,
    sites: { ...DEFAULT_SETTINGS.sites, ...(stored.sites ?? {}) },
    apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...(stored.apiKeys ?? {}) },
  });
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
