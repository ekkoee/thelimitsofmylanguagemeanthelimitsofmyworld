import { normalizeGeminiKey } from '../../core/gemini-key';
import { UI_FIXED, applyI18n, setUiLang, t, watchUiLang } from '../../core/i18n';
import { GEMINI_KEY_STORAGE, loadSettings, saveSettings } from '../../core/storage';
import { DEFAULT_MODELS, ProviderId, Settings } from '../../core/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let afterI18n = (): void => {};

async function init() {
  const s = await loadSettings();
  setUiLang(s.uiLang || '');
  applyI18n();
  watchUiLang();
  bindUiLang(s.uiLang || '');

  const enabled = $<HTMLInputElement>('enabled');
  enabled.checked = s.enabled;
  enabled.addEventListener('change', () => saveSettings({ enabled: enabled.checked }));

  // 譯文呈現. The value lives in chrome.storage. Reading it off the page
  // showed "bilingual" after every reload, because nothing had saved the choice
  // and the page default is bilingual. An empty stored value is "never chosen":
  // on X the video default is Chinese-only (native CC already has the English).
  const viewMode = $<HTMLSelectElement>('viewMode');
  const activeTab = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  };
  const tab = await activeTab();
  const onX = !!tab?.url && /^https?:\/\/([^/]*\.)?(x\.com|twitter\.com)\//i.test(tab.url);
  // Unset view: X video and a Netflix watch page default to Chinese-only because
  // the native captions already show the original. Browse pages stay bilingual.
  const onNfWatch = !!tab?.url && /^https?:\/\/([^/]*\.)?netflix\.com\/watch\/\d+/i.test(tab.url);
  const chosen = s.viewMode === 'zh' || s.viewMode === 'both' || s.viewMode === 'orig' ? s.viewMode : '';
  viewMode.value = chosen || (onX || onNfWatch ? 'zh' : 'both');
  viewMode.addEventListener('change', async () => {
    const v = viewMode.value;
    if (v !== 'zh' && v !== 'both' && v !== 'orig') return;
    await saveSettings({ viewMode: v });
    const id = (await activeTab())?.id;
    if (id == null) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: id },
        func: (mode: string) => document.documentElement.setAttribute('data-ibt-view', mode),
        args: [v],
      });
    } catch { /* not scriptable */ }
  });

  const lang = $<HTMLSelectElement>('lang');
  const codes = [...lang.options].map((opt) => opt.value);
  lang.value = codes.includes(s.targetLangCode) ? s.targetLangCode : 'zh-TW';
  lang.addEventListener('change', () => {
    const names: Record<string, string> = {
      'zh-TW': 'Traditional Chinese (zh-TW)',
      'zh-CN': 'Simplified Chinese (zh-CN)',
      en: 'English',
      ja: 'Japanese',
      ko: 'Korean',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
    };
    void saveSettings({ targetLangCode: lang.value, targetLang: names[lang.value] || lang.value });
  });

  bindEngine(s);
  $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

  // "翻譯這個網頁" — works even if the Alt+A shortcut isn't bound.
  const AUTO_SITE = /^https?:\/\/([^/]*\.)?(x\.com|twitter\.com|reddit\.com|youtube\.com)\//i;
  const tBtn = $<HTMLButtonElement>('translatePage');
  const hint = $('ctaHint');
  tBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    if (tab.url && AUTO_SITE.test(tab.url)) {
      // these sites auto-translate → toggle show/hide
      chrome.tabs.sendMessage(tab.id, { type: 'ibt-toggle-visibility' }).catch(() => {});
      window.close();
      return;
    }
    // The content script is already on http(s) pages (including LinkedIn).
    // Ask it first. Inject only if that script is missing.
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'ibt-toggle-page' });
      window.close();
      return;
    } catch { /* no receiver — fall through to injection */ }
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['bilingual.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['universal-inject.js'] });
      window.close();
    } catch {
      hint.dataset.i18n = 'pageBlocked';
      hint.textContent = t('pageBlocked');
      (hint as HTMLElement).style.color = '#e06c6c';
    }
  });
}

function bindEngine(initial: Settings): void {
  const provider = $<HTMLSelectElement>('provider');
  const note = $('engineNote');
  const hint = $<HTMLButtonElement>('keyHint');
  let writing = false;

  const paint = (s: Settings): void => {
    provider.value = s.provider === 'gemini' ? 'gemini' : 'google';
    const gemini = provider.value === 'gemini';
    const hasKey = !!normalizeGeminiKey(s.apiKeys.gemini);
    if (!gemini) {
      note.hidden = true;
      hint.hidden = true;
      note.classList.remove('is-missing');
      note.textContent = '';
      return;
    }
    note.hidden = false;
    if (!hasKey) {
      note.classList.add('is-missing');
      note.textContent = t('geminiKeyMissing');
      hint.hidden = false;
      hint.textContent = t('openGeminiKey');
      return;
    }
    note.classList.remove('is-missing');
    hint.hidden = true;
    note.textContent = (s.model || '').trim() || DEFAULT_MODELS.gemini;
  };

  paint(initial);
  afterI18n = () => { void loadSettings().then(paint); };

  provider.addEventListener('change', async () => {
    const value: ProviderId = provider.value === 'gemini' ? 'gemini' : 'google';
    writing = true;
    try {
      const cur = await loadSettings();
      const patch: Partial<Settings> = { provider: value };
      if (value === 'gemini' && !/^gemini/i.test(cur.model || '')) patch.model = DEFAULT_MODELS.gemini;
      paint(await saveSettings(patch));
    } finally {
      writing = false;
    }
  });

  hint.addEventListener('click', async () => {
    try { await chrome.storage.session.set({ ibtOpen: 'gemini-key' }); } catch { /* still open settings */ }
    await chrome.runtime.openOptionsPage();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (writing) return;
    const syncChanged = area === 'sync' && !!changes.ibt_settings;
    const keyChanged = area === 'local' && !!changes[GEMINI_KEY_STORAGE];
    if (!syncChanged && !keyChanged) return;
    void loadSettings().then(paint);
  });
}

function bindUiLang(pref: string): void {
  const btn = $<HTMLButtonElement>('uiLangBtn');
  const pop = $('uiLangPop');
  let current = pref;
  const paint = () => {
    pop.replaceChildren();
    const choices: { id: string; name: string }[] = [{ id: '', name: t('uiLangAuto') }, ...UI_FIXED];
    for (const item of choices) {
      const row = document.createElement('button');
      row.type = 'button';
      row.role = 'option';
      row.textContent = item.name;
      row.setAttribute('aria-checked', item.id === current ? 'true' : 'false');
      row.addEventListener('click', () => {
        current = item.id;
        void saveSettings({ uiLang: item.id });
        setUiLang(item.id);
        applyI18n();
        afterI18n();
        paint();
        pop.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      });
      pop.appendChild(row);
    }
  };
  paint();
  btn.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    btn.setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
    if (!pop.hidden) paint();
  });
  document.addEventListener('pointerdown', (event) => {
    if (pop.hidden) return;
    if ((event.target as Node | null) && btn.parentElement?.contains(event.target as Node)) return;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || pop.hidden) return;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  });
}

init();
