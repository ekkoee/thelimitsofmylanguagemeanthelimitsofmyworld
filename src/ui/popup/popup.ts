import { normalizeGeminiKey } from '../../core/gemini-key';
import { loadSettings, saveSettings } from '../../core/storage';

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

  const open = $('openOptions');
  const needsKey = s.provider === 'gemini' && !normalizeGeminiKey(s.apiKeys.gemini);
  open.textContent = needsKey ? '貼上 Gemini 金鑰' : '設定';
  open.addEventListener('click', () => chrome.runtime.openOptionsPage());

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

init();
