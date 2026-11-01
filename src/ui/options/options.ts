import { loadSettings, saveSettings } from '../../core/storage';
import { clearPersistentCache } from '../../core/cache';
import { disableDblClick, registerDblClick, requestAllUrls } from '../../core/dblclick';
import { DEFAULT_BAR_COLOR, DEFAULT_MODELS, DEFAULT_TRANS_COLOR, ProviderId, Settings } from '../../core/types';
import { normalizeQuotaState, quotaStatusText } from '../../core/quota-router';

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

  const imageModel = $<HTMLSelectElement>('imageModel');
  const known = ['auto', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  imageModel.value = known.includes(s.imageModel) ? s.imageModel : 'auto';
  imageModel.addEventListener('change', () => save({ imageModel: imageModel.value }));
  void renderQuota();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.ibt_quota) void renderQuota();
  });

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
    r.style.setProperty('--ibt-trans-color', appliedColor || DEFAULT_TRANS_COLOR);
    r.style.setProperty('--ibt-bar-color', appliedBarColor || DEFAULT_BAR_COLOR);
  };

  transStyle.value = s.transStyle || 'plain';
  transStyle.addEventListener('change', () => { save({ transStyle: transStyle.value }); syncPreview(); });

  if (s.transColor) transColor.value = s.transColor;
  transColor.addEventListener('change', () => { appliedColor = transColor.value; save({ transColor: appliedColor }); syncPreview(); });
  $('transColorReset').addEventListener('click', () => {
    appliedColor = '';
    transColor.value = DEFAULT_TRANS_COLOR;
    save({ transColor: '' });
    syncPreview();
  });

  barStyle.value = s.barStyle || 'bar';
  barStyle.addEventListener('change', () => { save({ barStyle: barStyle.value }); syncPreview(); });

  if (s.barColor) barColor.value = s.barColor;
  else barColor.value = DEFAULT_BAR_COLOR;
  barColor.addEventListener('change', () => { appliedBarColor = barColor.value; save({ barColor: appliedBarColor }); syncPreview(); });
  $('barColorReset').addEventListener('click', () => {
    appliedBarColor = '';
    barColor.value = DEFAULT_BAR_COLOR;
    save({ barColor: '' });
    syncPreview();
  });

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

async function renderQuota(): Promise<void> {
  const raw = await chrome.storage.local.get('ibt_quota');
  const el = $('quotaStatus');
  if (!el) return;
  el.textContent = quotaStatusText(normalizeQuotaState(raw?.ibt_quota), Date.now());
}

async function save(patch: Partial<Settings>) {
  await saveSettings(patch);
  toast('已儲存');
}

init();
