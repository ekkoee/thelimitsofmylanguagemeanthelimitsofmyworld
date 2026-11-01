import { checkGeminiKey, normalizeGeminiKey } from '../../core/gemini-key';
import { loadSettings, saveSettings } from '../../core/storage';
import { DEFAULT_MODELS, ProviderId, Settings } from '../../core/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function init() {
  const s = await loadSettings();
  const version = $('version');
  try { version.textContent = chrome.runtime.getManifest().version; } catch { version.textContent = ''; }

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

const STYLE_VALUES = ['plain', 'underline', 'dashed', 'dotted', 'wavy', 'solidBox', 'dashedBox', 'highlight', 'dim', 'italic', 'bold', 'blur'];
const BAR_VALUES = ['none', 'bar', 'thick', 'dashed'];
const INHERIT_SWATCH = '#1c1c1c';
const BAR_SWATCH = '#6c7aff';

function bindAppearance(s: Settings) {
  const style = $<HTMLSelectElement>('transStyle');
  const transColor = $<HTMLInputElement>('transColor');
  const barStyle = $<HTMLSelectElement>('barStyle');
  const barColor = $<HTMLInputElement>('barColor');
  const highlight = $<HTMLInputElement>('transHighlight');
  let textColor = /^#[0-9a-fA-F]{6}$/.test(s.transColor || '') ? s.transColor : '';
  let markColor = /^#[0-9a-fA-F]{6}$/.test(s.barColor || '') ? s.barColor : '';

  const syncPreview = () => {
    const root = document.documentElement;
    root.setAttribute('data-ibt-style', style.value || 'plain');
    root.setAttribute('data-ibt-bar', barStyle.value || 'none');
    root.setAttribute('data-ibt-highlight', highlight.checked ? 'on' : 'off');
    root.setAttribute('data-ibt-lang', 'zh-TW');
    if (textColor) {
      root.setAttribute('data-ibt-custom-color', 'on');
      root.style.setProperty('--ibt-trans-color', textColor);
    } else {
      root.removeAttribute('data-ibt-custom-color');
      root.style.removeProperty('--ibt-trans-color');
    }
    if (markColor) root.style.setProperty('--ibt-bar-color', markColor);
    else root.style.removeProperty('--ibt-bar-color');
  };

  style.value = STYLE_VALUES.includes(s.transStyle) ? s.transStyle : 'plain';
  style.addEventListener('change', () => { save({ transStyle: style.value }); syncPreview(); });

  transColor.value = textColor || INHERIT_SWATCH;
  transColor.addEventListener('input', () => { textColor = transColor.value; syncPreview(); });
  transColor.addEventListener('change', () => save({ transColor: textColor, transColorSet: true }));
  $('transColorReset').addEventListener('click', () => {
    textColor = '';
    transColor.value = INHERIT_SWATCH;
    save({ transColor: '', transColorSet: true });
    syncPreview();
  });

  barStyle.value = BAR_VALUES.includes(s.barStyle) ? s.barStyle : 'none';
  barStyle.addEventListener('change', () => { save({ barStyle: barStyle.value }); syncPreview(); });

  barColor.value = markColor || BAR_SWATCH;
  barColor.addEventListener('input', () => { markColor = barColor.value; syncPreview(); });
  barColor.addEventListener('change', () => save({ barColor: markColor }));
  $('barColorReset').addEventListener('click', () => {
    markColor = '';
    barColor.value = BAR_SWATCH;
    save({ barColor: '' });
    syncPreview();
  });

  highlight.checked = s.transHighlight === true;
  highlight.addEventListener('change', () => {
    save({ transHighlight: highlight.checked, transHighlightSet: true });
    syncPreview();
  });
  syncPreview();
}

function bindGeminiKey(initial: string) {
  const input = $<HTMLInputElement>('key_gemini');
  const note = $('keyNote');
  input.value = normalizeGeminiKey(initial);
  let ticket = 0;
  const apply = async () => {
    const value = normalizeGeminiKey(input.value);
    if (input.value !== value) input.value = value;
    const mine = ++ticket;
    if (!value) {
      note.textContent = '';
      note.removeAttribute('data-state');
      await saveKey('');
      return;
    }
    note.textContent = '檢查中…';
    note.dataset.state = 'wait';
    const result = await checkGeminiKey(value);
    if (mine !== ticket) return;
    if (result === 'invalid') {
      note.textContent = '金鑰無效';
      note.dataset.state = 'bad';
      return;
    }
    note.textContent = result === 'valid' ? '已儲存' : '無法確認，已儲存';
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
