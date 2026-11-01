import { loadSettings, saveSettings } from '../../core/storage';
import { DEFAULT_BAR_COLOR, DEFAULT_MODELS, DEFAULT_TRANS_COLOR, ProviderId, Settings } from '../../core/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const CREAM = '#ffecaa';

async function init() {
  const s = await loadSettings();
  const version = $('version');
  try { version.textContent = chrome.runtime.getManifest().version; } catch { version.textContent = ''; }

  const reader = $('reader');
  const readerZh = $('readerZh');
  $<HTMLInputElement>('readerDark').addEventListener('change', (event) => {
    const dark = (event.target as HTMLInputElement).checked;
    reader.dataset.tone = dark ? 'dark' : 'light';
    readerZh.dataset.ibtOn = dark ? 'dark' : 'light';
  });

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
  let textColor = s.transColor || '';
  let barColor = s.barColor || '';
  let chip = s.highlightColor || '';
  const transColor = $<HTMLInputElement>('transColor');
  const barColorInput = $<HTMLInputElement>('barColor');
  const barStyle = $<HTMLSelectElement>('barStyle');
  const highlight = $<HTMLInputElement>('transHighlight');

  const syncPreview = () => {
    const root = document.documentElement;
    root.setAttribute('data-ibt-style', 'plain');
    root.setAttribute('data-ibt-bar', barStyle.value || 'bar');
    root.setAttribute('data-ibt-highlight', highlight.checked ? 'on' : 'off');
    root.setAttribute('data-ibt-lang', 'zh-TW');
    root.style.setProperty('--ibt-trans-color', textColor || DEFAULT_TRANS_COLOR);
    root.style.setProperty('--ibt-bar-color', barColor || DEFAULT_BAR_COLOR);
    if (chip) root.style.setProperty('--ibt-highlight', chip);
    else root.style.setProperty('--ibt-highlight', CREAM);
  };

  const asDefault = (value: string, fallback: string) => value.toLowerCase() === fallback.toLowerCase() ? '' : value;

  transColor.value = textColor || DEFAULT_TRANS_COLOR;
  transColor.addEventListener('input', () => {
    textColor = asDefault(transColor.value, DEFAULT_TRANS_COLOR);
    syncPreview();
  });
  transColor.addEventListener('change', () => save({ transColor: textColor }));

  barStyle.value = s.barStyle === 'thick' || s.barStyle === 'dashed' || s.barStyle === 'none' ? s.barStyle : 'bar';
  barStyle.addEventListener('change', () => { save({ barStyle: barStyle.value }); syncPreview(); });

  barColorInput.value = barColor || DEFAULT_BAR_COLOR;
  barColorInput.addEventListener('input', () => {
    barColor = asDefault(barColorInput.value, DEFAULT_BAR_COLOR);
    syncPreview();
  });
  barColorInput.addEventListener('change', () => save({ barColor }));

  highlight.checked = s.transHighlight === true;
  highlight.addEventListener('change', () => { save({ transHighlight: highlight.checked }); syncPreview(); });

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
