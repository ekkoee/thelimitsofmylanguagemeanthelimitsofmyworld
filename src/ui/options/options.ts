import { loadSettings, saveSettings } from '../../core/storage';
import { clearPersistentCache } from '../../core/cache';
import { disableDblClick, registerDblClick, requestAllUrls } from '../../core/dblclick';
import { DEFAULT_MODELS, ProviderId, Settings } from '../../core/types';

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
  const geminiBlock = $('geminiBlock');
  provider.value = s.provider;
  model.value = s.model || '';
  const syncEngineUi = (): void => {
    geminiBlock.hidden = provider.value !== 'gemini';
  };
  syncEngineUi();
  provider.addEventListener('change', async () => {
    syncEngineUi();
    if (provider.value === 'gemini' && !/^gemini/i.test(model.value.trim())) model.value = DEFAULT_MODELS.gemini;
    await save({ provider: provider.value as ProviderId, model: model.value.trim() });
  });
  model.addEventListener('change', () => save({ model: model.value.trim() }));

  bindKey('key_gemini', s.apiKeys.gemini, 'gemini');

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
    const code = (s.targetLangCode || '').trim();
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

async function save(patch: Partial<Settings>) {
  await saveSettings(patch);
  toast('已儲存');
}

init();
