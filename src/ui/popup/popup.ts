import { loadSettings, saveSettings } from '../../core/storage';
import { Settings } from '../../core/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function init() {
  const s = await loadSettings();

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
  const chosen = s.viewMode === 'zh' || s.viewMode === 'both' || s.viewMode === 'orig' ? s.viewMode : '';
  viewMode.value = chosen || (onX ? 'zh' : 'both');
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

  // language: keep the free-engine code and the LLM-prompt name in sync
  const lang = $<HTMLSelectElement>('lang');
  lang.value = s.targetLangCode === 'zh-CN' ? 'zh-CN' : 'zh-TW';
  lang.addEventListener('change', () => {
    const code = lang.value;
    const name = code === 'zh-CN' ? 'Simplified Chinese (zh-CN)' : 'Traditional Chinese (zh-TW)';
    saveSettings({ targetLangCode: code, targetLang: name });
  });

  bindSelect('order', s.subtitleOrder, (v) => ({
    subtitleOrder: v as Settings['subtitleOrder'],
    // keep the Twitter/Reddit side-by-side order in sync with the same choice
    layout: (v === 'enTop' ? 'origTop' : 'transTop') as Settings['layout'],
  }));
  const provider = $<HTMLSelectElement>('provider');
  const keyHint = $<HTMLButtonElement>('keyHint');
  const refreshKeyHint = async (): Promise<void> => {
    const cur = await loadSettings();
    keyHint.hidden = !(cur.provider === 'gemini' && !(cur.apiKeys.gemini || '').trim());
  };
  provider.value = s.provider;
  provider.addEventListener('change', async () => {
    await saveSettings({ provider: provider.value as Settings['provider'] });
    await refreshKeyHint();
  });
  keyHint.addEventListener('click', () => chrome.runtime.openOptionsPage());
  await refreshKeyHint();

  const font = $<HTMLInputElement>('fontScale');
  const fontVal = $('fontScaleVal');
  font.value = String(s.fontScale);
  fontVal.textContent = `${s.fontScale.toFixed(2)}×`;
  font.addEventListener('input', () => { fontVal.textContent = `${Number(font.value).toFixed(2)}×`; });
  font.addEventListener('change', () => saveSettings({ fontScale: Number(font.value) }));

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
      hint.textContent = '這個頁面無法翻譯（例如 chrome:// 或商店頁）';
      (hint as HTMLElement).style.color = '#e06c6c';
    }
  });
}

function bindSelect(id: string, value: string, patch: (v: string) => Partial<Settings>) {
  const sel = $<HTMLSelectElement>(id);
  sel.value = value;
  sel.addEventListener('change', () => saveSettings(patch(sel.value)));
}

init();
