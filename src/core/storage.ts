import { DEFAULT_SETTINGS, Settings } from './types';

const SETTINGS_KEY = 'ibt_settings';

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.sync.get(SETTINGS_KEY);
  const stored = (raw?.[SETTINGS_KEY] ?? {}) as Partial<Settings>;
  // deep-ish merge so new default keys appear after upgrades
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    sites: { ...DEFAULT_SETTINGS.sites, ...(stored.sites ?? {}) },
    apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...(stored.apiKeys ?? {}) },
  };
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
      cb({ ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue as Settings) });
    }
  });
}
