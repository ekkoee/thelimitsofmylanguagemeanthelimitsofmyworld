import { loadSettings, saveSettings } from '../../core/storage';
import { DEFAULT_MODELS, ProviderId, Settings } from '../../core/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function init() {
  const s = await loadSettings();
  const version = $('version');
  try { version.textContent = chrome.runtime.getManifest().version; } catch { version.textContent = ''; }

  const reader = $('reader');
  const readerZh = $('readerZh');
  const readerDark = $<HTMLInputElement>('readerDark');
  const themeDark = window.matchMedia('(prefers-color-scheme: dark)');
  const applyReader = (): void => {
    const dark = readerDark.checked || themeDark.matches;
    if (readerDark.checked) reader.dataset.tone = 'dark';
    else delete reader.dataset.tone;
    readerZh.dataset.ibtOn = dark ? 'dark' : 'light';
  };
  readerDark.addEventListener('change', applyReader);
  themeDark.addEventListener('change', applyReader);
  applyReader();

  const lang = $<HTMLSelectElement>('lang');
  lang.value = s.targetLangCode === 'zh-CN' ? 'zh-CN' : 'zh-TW';
  lang.addEventListener('change', () => {
    const code = lang.value;
    const name = code === 'zh-CN' ? 'Simplified Chinese (zh-CN)' : 'Traditional Chinese (zh-TW)';
    void save({ targetLangCode: code, targetLang: name });
  });

  const order = $<HTMLSelectElement>('order');
  order.value = s.subtitleOrder === 'enTop' ? 'enTop' : 'zhTop';
  order.addEventListener('change', () => {
    const v = order.value === 'enTop' ? 'enTop' : 'zhTop';
    void save({ subtitleOrder: v, layout: v === 'enTop' ? 'origTop' : 'transTop' });
  });

  const font = $<HTMLInputElement>('fontScale');
  const fontVal = $('fontScaleVal');
  font.value = String(s.fontScale);
  fontVal.textContent = `${Number(s.fontScale).toFixed(2)}×`;
  font.addEventListener('input', () => { fontVal.textContent = `${Number(font.value).toFixed(2)}×`; });
  font.addEventListener('change', () => { void save({ fontScale: Number(font.value) }); });

  const provider = $<HTMLSelectElement>('provider');
  const model = $<HTMLInputElement>('model');
  const geminiBlock = $('geminiBlock');
  provider.value = s.provider;
  model.value = s.model || '';
  const syncEngineUi = (): void => { geminiBlock.hidden = provider.value !== 'gemini'; };
  syncEngineUi();
  provider.addEventListener('change', async () => {
    syncEngineUi();
    if (provider.value === 'gemini' && !/^gemini/i.test(model.value.trim())) model.value = DEFAULT_MODELS.gemini;
    await save({ provider: provider.value as ProviderId, model: model.value.trim() });
  });
  model.addEventListener('change', () => save({ model: model.value.trim() }));

  const imageModel = $<HTMLSelectElement>('imageModel');
  imageModel.value = s.imageModel === 'gemini' ? 'gemini' : 'local';
  imageModel.addEventListener('change', () => save({ imageModel: imageModel.value }));

  const selectionTranslate = $<HTMLInputElement>('selectionTranslate');
  const selectionInstant = $<HTMLInputElement>('selectionInstant');
  selectionTranslate.checked = s.selectionTranslate !== false;
  selectionInstant.checked = s.selectionInstant === true;
  selectionTranslate.addEventListener('change', () => save({ selectionTranslate: selectionTranslate.checked }));
  selectionInstant.addEventListener('change', () => save({ selectionInstant: selectionInstant.checked }));

  bindGeminiKey(s.apiKeys.gemini);
  bindAppearance(s);
}

function bindAppearance(s: Settings) {
  const highlight = $<HTMLInputElement>('transHighlight');
  const syncPreview = () => {
    document.documentElement.setAttribute('data-ibt-highlight', highlight.checked ? 'on' : 'off');
    document.documentElement.setAttribute('data-ibt-lang', 'zh-TW');
  };
  highlight.checked = s.transHighlight === true;
  highlight.addEventListener('change', () => {
    save({ transHighlight: highlight.checked, transHighlightSet: true });
    syncPreview();
  });
  syncPreview();
}

const GEMINI_KEY = /^AIza[0-9A-Za-z_-]{20,}$/;

function bindGeminiKey(initial: string) {
  const input = $<HTMLInputElement>('key_gemini');
  const note = $('keyNote');
  input.value = initial;
  const apply = async () => {
    const value = input.value.trim();
    if (!value) {
      note.textContent = '';
      note.removeAttribute('data-state');
      await saveKey('');
      return;
    }
    if (!GEMINI_KEY.test(value)) {
      note.textContent = '應以 AIza 開頭';
      note.dataset.state = 'bad';
      return;
    }
    note.textContent = '已儲存';
    note.dataset.state = 'ok';
    await saveKey(value);
  };
  input.addEventListener('paste', () => { setTimeout(() => { void apply(); }, 0); });
  input.addEventListener('change', () => { void apply(); });
}

async function saveKey(value: string) {
  const cur = await loadSettings();
  if ((cur.apiKeys.gemini || '') === value) return;
  await save({ apiKeys: { ...cur.apiKeys, gemini: value } });
}

async function save(patch: Partial<Settings>) {
  await saveSettings(patch);
}

init();
