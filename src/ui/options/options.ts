import { loadSettings, saveSettings } from '../../core/storage';
import { DEFAULT_BAR_COLOR, DEFAULT_MODELS, DEFAULT_TRANS_COLOR, ProviderId, Settings } from '../../core/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const CREAM = '#ffecaa';

function toast(msg: string) {
  const s = $('status');
  s.textContent = msg;
  s.classList.add('show');
  setTimeout(() => s.classList.remove('show'), 1200);
}

async function init() {
  const s = await loadSettings();
  const version = $('version');
  try { version.textContent = chrome.runtime.getManifest().version; } catch { version.textContent = ''; }

  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b === btn));
      document.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.panel !== id;
      });
    });
  });

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

  bindKey('key_gemini', s.apiKeys.gemini, 'gemini');
  bindAppearance(s);
}

function bindAppearance(s: Settings) {
  let textColor = s.transColor || '';
  let barColor = s.barColor || '';
  let chip = s.highlightColor || '';
  const transColor = $<HTMLInputElement>('transColor');
  const barColorInput = $<HTMLInputElement>('barColor');
  const barStyle = $<HTMLSelectElement>('barStyle');
  const highlight = $<HTMLSelectElement>('transHighlight');
  const highlightColor = $<HTMLInputElement>('highlightColor');

  const syncPreview = () => {
    const root = document.documentElement;
    root.setAttribute('data-ibt-style', 'plain');
    root.setAttribute('data-ibt-bar', barStyle.value || 'bar');
    root.setAttribute('data-ibt-highlight', highlight.value === 'on' ? 'on' : 'off');
    root.setAttribute('data-ibt-lang', 'zh-TW');
    root.style.setProperty('--ibt-trans-color', textColor || DEFAULT_TRANS_COLOR);
    root.style.setProperty('--ibt-bar-color', barColor || DEFAULT_BAR_COLOR);
    if (chip) root.style.setProperty('--ibt-highlight', chip);
    else root.style.setProperty('--ibt-highlight', CREAM);
  };

  transColor.value = textColor || DEFAULT_TRANS_COLOR;
  transColor.addEventListener('input', () => { textColor = transColor.value; syncPreview(); });
  transColor.addEventListener('change', () => save({ transColor: textColor }));
  $('transColorReset').addEventListener('click', () => {
    textColor = '';
    transColor.value = DEFAULT_TRANS_COLOR;
    save({ transColor: '' });
    syncPreview();
  });

  barStyle.value = s.barStyle === 'thick' || s.barStyle === 'dashed' || s.barStyle === 'none' ? s.barStyle : 'bar';
  barStyle.addEventListener('change', () => { save({ barStyle: barStyle.value }); syncPreview(); });

  barColorInput.value = barColor || DEFAULT_BAR_COLOR;
  barColorInput.addEventListener('input', () => { barColor = barColorInput.value; syncPreview(); });
  barColorInput.addEventListener('change', () => save({ barColor }));
  $('barColorReset').addEventListener('click', () => {
    barColor = '';
    barColorInput.value = DEFAULT_BAR_COLOR;
    save({ barColor: '' });
    syncPreview();
  });

  highlight.value = s.transHighlight ? 'on' : 'off';
  highlight.addEventListener('change', () => { save({ transHighlight: highlight.value === 'on' }); syncPreview(); });

  highlightColor.value = chip || CREAM;
  highlightColor.addEventListener('input', () => { chip = highlightColor.value; syncPreview(); });
  highlightColor.addEventListener('change', () => save({ highlightColor: chip }));
  $('highlightColorReset').addEventListener('click', () => {
    chip = '';
    highlightColor.value = CREAM;
    save({ highlightColor: '' });
    syncPreview();
  });

  syncPreview();
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
