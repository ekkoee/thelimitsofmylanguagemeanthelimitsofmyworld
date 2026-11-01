import { loadSettings, saveSettings } from '../../core/storage';
import { DEFAULT_BAR_COLOR, DEFAULT_MODELS, DEFAULT_TRANS_COLOR, ProviderId, Settings } from '../../core/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SWATCHES = ['#f2d492', '#7aa2ff', '#5cbf8a', '#e0a15a', '#e06a6a', '#b07adf', '#e08ab0'];

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
  const marker = s.barStyle === 'tint' || s.barStyle === 'wavy' || s.barStyle === 'none' || s.barStyle === 'bar'
    ? s.barStyle
    : 'bar';
  const radios = document.querySelectorAll<HTMLInputElement>('input[name="marker"]');
  const hex = $<HTMLInputElement>('accentHex');
  const swatches = $('swatches');

  const activeColor = () => (textColor || barColor || DEFAULT_TRANS_COLOR).toLowerCase();
  const syncPreview = () => {
    const root = document.documentElement;
    const picked = document.querySelector<HTMLInputElement>('input[name="marker"]:checked');
    root.setAttribute('data-ibt-bar', picked?.value || 'bar');
    root.setAttribute('data-ibt-style', 'plain');
    root.setAttribute('data-ibt-lang', 'zh-TW');
    root.style.setProperty('--ibt-trans-color', textColor || DEFAULT_TRANS_COLOR);
    root.style.setProperty('--ibt-bar-color', barColor || DEFAULT_BAR_COLOR);
  };

  for (const radio of radios) {
    radio.checked = radio.value === marker;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      save({ barStyle: radio.value });
      syncPreview();
    });
  }

  const paintSwatches = () => {
    swatches.replaceChildren();
    for (const color of SWATCHES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.style.background = color;
      button.setAttribute('aria-label', color);
      button.setAttribute('aria-checked', color === activeColor() && !hex.value ? 'true' : 'false');
      button.addEventListener('click', () => {
        hex.value = '';
        const stored = color === DEFAULT_TRANS_COLOR ? '' : color;
        textColor = stored;
        barColor = stored;
        save({ transColor: stored, barColor: stored });
        paintSwatches();
        syncPreview();
      });
      swatches.appendChild(button);
    }
  };

  if (activeColor() !== DEFAULT_TRANS_COLOR && !SWATCHES.includes(activeColor())) hex.value = activeColor();
  hex.addEventListener('change', () => {
    const next = hex.value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(next)) {
      hex.value = activeColor() === DEFAULT_TRANS_COLOR || SWATCHES.includes(activeColor()) ? '' : activeColor();
      return;
    }
    const stored = next.toLowerCase() === DEFAULT_TRANS_COLOR ? '' : next.toLowerCase();
    textColor = stored;
    barColor = stored;
    save({ transColor: stored, barColor: stored });
    paintSwatches();
    syncPreview();
  });

  paintSwatches();
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
