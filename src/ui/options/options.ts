import { loadSettings, saveSettings } from '../../core/storage';
import { clearPersistentCache } from '../../core/cache';
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
  const targetLang = $<HTMLInputElement>('targetLang');
  const targetLangCode = $<HTMLInputElement>('targetLangCode');
  provider.value = s.provider;
  model.value = s.model;
  targetLang.value = s.targetLang;
  targetLangCode.value = s.targetLangCode;

  provider.addEventListener('change', async () => {
    const id = provider.value as ProviderId;
    // suggest the default model for the newly chosen provider
    model.value = DEFAULT_MODELS[id];
    await save({ provider: id, model: model.value });
  });
  model.addEventListener('change', () => save({ model: model.value.trim() }));
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

  // appearance: translated-text style + custom color, with a live preview
  const transStyle = $<HTMLSelectElement>('transStyle');
  const transColor = $<HTMLInputElement>('transColor');
  let appliedColor = s.transColor;

  const syncPreview = () => {
    const r = document.documentElement;
    r.setAttribute('data-ibt-style', transStyle.value || 'plain');
    const code = (targetLangCode.value || '').trim();
    r.setAttribute('data-ibt-lang', code === 'zh-CN' ? 'zh-CN' : 'zh-TW');
    if (appliedColor) r.style.setProperty('--ibt-trans-color', appliedColor);
    else r.style.removeProperty('--ibt-trans-color');
  };

  transStyle.value = s.transStyle || 'plain';
  transStyle.addEventListener('change', () => { save({ transStyle: transStyle.value }); syncPreview(); });

  if (s.transColor) transColor.value = s.transColor;
  transColor.addEventListener('change', () => { appliedColor = transColor.value; save({ transColor: appliedColor }); syncPreview(); });
  $('transColorReset').addEventListener('click', () => { appliedColor = ''; save({ transColor: '' }); syncPreview(); });

  // keep the preview font in sync if the language code is edited
  targetLangCode.addEventListener('input', syncPreview);
  syncPreview();

  $('clearCache').addEventListener('click', async () => {
    await clearPersistentCache();
    $('cacheMsg').textContent = '已清除';
    setTimeout(() => ($('cacheMsg').textContent = ''), 1500);
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
