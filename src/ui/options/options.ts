import { loadSettings, saveSettings } from '../../core/storage';
import { clearPersistentCache } from '../../core/cache';
import { disableDblClick, registerDblClick, requestAllUrls } from '../../core/dblclick';
import { DEFAULT_MODELS, ProviderId, Settings, SiteId } from '../../core/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function toast(msg: string) {
  const s = $('status');
  s.textContent = msg;
  s.classList.add('show');
  setTimeout(() => s.classList.remove('show'), 1200);
}

async function init() {
  const s = await loadSettings();

  const provider = $<HTMLSelectElement>('provider');
  const model = $<HTMLInputElement>('model');
  const sourceLang = $<HTMLInputElement>('sourceLang');
  const targetLang = $<HTMLInputElement>('targetLang');
  const targetLangCode = $<HTMLInputElement>('targetLangCode');
  provider.value = s.provider;
  model.value = s.model;
  sourceLang.value = s.sourceLang;
  targetLang.value = s.targetLang;
  targetLangCode.value = s.targetLangCode;

  provider.addEventListener('change', async () => {
    const id = provider.value as ProviderId;
    // suggest the default model for the newly chosen provider
    model.value = DEFAULT_MODELS[id];
    await save({ provider: id, model: model.value });
  });
  model.addEventListener('change', () => save({ model: model.value.trim() }));
  sourceLang.addEventListener('change', () => save({ sourceLang: sourceLang.value.trim() || 'auto' }));
  targetLang.addEventListener('change', () => save({ targetLang: targetLang.value.trim() }));
  targetLangCode.addEventListener('change', () => save({ targetLangCode: targetLangCode.value.trim() }));

  bindKey('key_openai', s.apiKeys.openai, 'openai');
  bindKey('key_gemini', s.apiKeys.gemini, 'gemini');

  const ollama = $<HTMLInputElement>('ollamaEndpoint');
  ollama.value = s.ollamaEndpoint;
  ollama.addEventListener('change', () => save({ ollamaEndpoint: ollama.value.trim() }));

  document.querySelectorAll<HTMLInputElement>('input[data-site]').forEach((cb) => {
    const site = cb.dataset.site as SiteId;
    cb.checked = s.sites[site];
    cb.addEventListener('change', async () => {
      const cur = await loadSettings();
      await save({ sites: { ...cur.sites, [site]: cb.checked } });
    });
  });

  bindCheck('translateOnVisible', s.translateOnVisible, (v) => ({ translateOnVisible: v }));
  bindCheck('cacheEnabled', s.cacheEnabled, (v) => ({ cacheEnabled: v }));

  // appearance: translated-text style + custom color + left marker bar, live preview
  const transStyle = $<HTMLSelectElement>('transStyle');
  const transColor = $<HTMLInputElement>('transColor');
  const barStyle = $<HTMLSelectElement>('barStyle');
  const barColor = $<HTMLInputElement>('barColor');
  let appliedColor = s.transColor;
  let appliedBarColor = s.barColor;

  const syncPreview = () => {
    const r = document.documentElement;
    r.setAttribute('data-ibt-style', transStyle.value || 'plain');
    r.setAttribute('data-ibt-bar', barStyle.value || 'bar');
    const code = (targetLangCode.value || '').trim();
    r.setAttribute('data-ibt-lang', code === 'zh-CN' ? 'zh-CN' : 'zh-TW');
    if (appliedColor) r.style.setProperty('--ibt-trans-color', appliedColor);
    else r.style.removeProperty('--ibt-trans-color');
    if (appliedBarColor) r.style.setProperty('--ibt-bar-color', appliedBarColor);
    else r.style.removeProperty('--ibt-bar-color');
  };

  transStyle.value = s.transStyle || 'plain';
  transStyle.addEventListener('change', () => { save({ transStyle: transStyle.value }); syncPreview(); });

  if (s.transColor) transColor.value = s.transColor;
  transColor.addEventListener('change', () => { appliedColor = transColor.value; save({ transColor: appliedColor }); syncPreview(); });
  $('transColorReset').addEventListener('click', () => { appliedColor = ''; save({ transColor: '' }); syncPreview(); });

  barStyle.value = s.barStyle || 'bar';
  barStyle.addEventListener('change', () => { save({ barStyle: barStyle.value }); syncPreview(); });

  if (s.barColor) barColor.value = s.barColor;
  barColor.addEventListener('change', () => { appliedBarColor = barColor.value; save({ barColor: appliedBarColor }); syncPreview(); });
  $('barColorReset').addEventListener('click', () => { appliedBarColor = ''; save({ barColor: '' }); syncPreview(); });

  // keep the preview font in sync if the language code is edited
  targetLangCode.addEventListener('input', syncPreview);
  syncPreview();

  $('clearCache').addEventListener('click', async () => {
    await clearPersistentCache();
    $('cacheMsg').textContent = '已清除';
    setTimeout(() => ($('cacheMsg').textContent = ''), 1500);
  });

  bindDblClickToggle(s.dblClickTranslate);
}

// The double-click popup needs broad host access, so enabling it requests <all_urls>
// from a user gesture (this checkbox). If the user declines, we revert the toggle and
// save nothing. Disabling unregisters the script and hands the permission back.
function bindDblClickToggle(initial: boolean) {
  const cb = $<HTMLInputElement>('dblClickTranslate');
  cb.checked = initial;
  cb.addEventListener('change', async () => {
    if (cb.checked) {
      const granted = await requestAllUrls();
      if (!granted) { cb.checked = false; toast('需要授權才能啟用'); return; }
      await registerDblClick();
      await save({ dblClickTranslate: true });
    } else {
      await save({ dblClickTranslate: false });
      await disableDblClick();
    }
  });
}

function bindKey(id: string, value: string, provider: ProviderId) {
  const input = $<HTMLInputElement>(id);
  input.value = value;
  input.addEventListener('change', async () => {
    const cur = await loadSettings();
    await save({ apiKeys: { ...cur.apiKeys, [provider]: input.value.trim() } });
  });
}

function bindCheck(id: string, value: boolean, patch: (v: boolean) => Partial<Settings>) {
  const cb = $<HTMLInputElement>(id);
  cb.checked = value;
  cb.addEventListener('change', () => save(patch(cb.checked)));
}

async function save(patch: Partial<Settings>) {
  await saveSettings(patch);
  toast('已儲存');
}

init();
