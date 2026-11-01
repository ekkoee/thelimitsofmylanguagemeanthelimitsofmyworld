// 劃詞翻譯. A round control sits at the end of a finished selection. The card
// shows the source, the translation, copy and speak, the engine name, and can
// be pinned or dragged. Inputs and editable fields are left alone.

import { loadSettings } from '../core/storage';
import { DictEntry } from '../core/types';

const NS = 'http://www.w3.org/2000/svg';

let listening = false;
let button: HTMLButtonElement | null = null;
let card: HTMLDivElement | null = null;
let current = '';
let req = 0;
let pinned = false;
let anchor: DOMRect | null = null;

export function startSelectionTranslate(): void {
  const w = window as unknown as { __ibtSelection?: boolean };
  if (w.__ibtSelection) return;
  w.__ibtSelection = true;
  if (listening) return;
  listening = true;
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScroll, true);
}

function icon(paths: string[], size = 16): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.7');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  }
  return svg;
}

function grip(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  for (const [x, y] of [[9, 7], [15, 7], [9, 12], [15, 12], [9, 17], [15, 17]]) {
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
    dot.setAttribute('r', '1.15');
    dot.setAttribute('fill', 'currentColor');
    svg.appendChild(dot);
  }
  return svg;
}

const ICONS = {
  mark: ['M4 7.5h7', 'M7.5 7.5c.1 3.6-1.7 5.6-4.4 7', 'M4.8 11h5.2', 'M13.5 16h6.2', 'M16.6 12.4v7'],
  pin: ['M9 4.5h6l-1 5.5 2.8 2v2H7.2v-2l2.8-2z', 'M12 14v6'],
  close: ['M7 7l10 10', 'M17 7L7 17'],
  copy: ['M9 9h10v10H9z', 'M5 15V5h10'],
  speak: ['M4 9.5v5h3.2L12 19V5L7.2 9.5z', 'M15.4 9.2a3.8 3.8 0 0 1 0 5.6', 'M17.6 7a6.5 6.5 0 0 1 0 10'],
};

function editable(node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el) return false;
  const host = el.closest('input, textarea, select, [contenteditable]');
  if (!host) return false;
  if (host instanceof HTMLInputElement || host instanceof HTMLTextAreaElement || host instanceof HTMLSelectElement) return true;
  const flag = host.getAttribute('contenteditable');
  return flag == null || flag.toLowerCase() !== 'false';
}

function ours(node: EventTarget | null): boolean {
  return node instanceof Element && Boolean(node.closest('.ibt-sel-btn, .ibt-sel-card'));
}

function endRect(range: Range): DOMRect {
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1 || r.height > 1);
  return rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
}

function selectedText(): { text: string; rect: DOMRect } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount < 1) return null;
  const text = sel.toString().replace(/\s+/g, ' ').trim();
  if (text.length < 1 || text.length > 800) return null;
  const range = sel.getRangeAt(0);
  if (editable(range.commonAncestorContainer) || ours(range.commonAncestorContainer)) return null;
  const rect = endRect(range);
  if (rect.width < 1 && rect.height < 1) return null;
  return { text, rect };
}

function isWord(text: string): boolean {
  return text.length <= 32 && !/\s/.test(text);
}

function pageIsDark(): boolean {
  const probe = document.body || document.documentElement;
  const bg = getComputedStyle(probe).backgroundColor || '';
  const m = bg.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
  if (!m || (m[4] != null && Number(m[4]) < 0.35)) return window.matchMedia('(prefers-color-scheme: dark)').matches;
  const y = 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3]);
  return y < 150;
}

async function onMouseUp(event: MouseEvent): Promise<void> {
  if (event.button !== 0 || ours(event.target)) return;
  const settings = await loadSettings().catch(() => null);
  if (settings && settings.selectionTranslate === false) { hideAll(); return; }
  const hit = selectedText();
  if (!hit) { hideButton(); return; }
  current = hit.text;
  anchor = hit.rect;
  if (settings?.selectionInstant && !pinned) {
    hideButton();
    showCard(hit.rect, hit.text, engineName(settings?.provider));
    return;
  }
  showButton(hit.rect);
}

function onMouseDown(event: MouseEvent): void {
  if (ours(event.target)) {
    event.preventDefault();
    return;
  }
  hideButton();
  if (!pinned) hideCard();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') hideAll();
}

function onScroll(): void {
  if (pinned) return;
  hideAll();
}

function engineName(provider: string | undefined): string {
  return provider === 'gemini' ? 'Gemini' : 'Google 翻譯';
}

function showButton(rect: DOMRect): void {
  const btn = button ?? document.createElement('button');
  button = btn;
  btn.type = 'button';
  btn.className = 'ibt-sel-btn';
  btn.setAttribute('aria-label', '翻譯選取文字');
  btn.replaceChildren(icon(ICONS.mark, 15));
  const left = Math.min(window.innerWidth - 40, Math.max(8, rect.right + 4));
  const top = Math.min(window.innerHeight - 40, Math.max(8, rect.bottom + 2));
  btn.style.left = `${left}px`;
  btn.style.top = `${top}px`;
  btn.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openFromButton();
  };
  if (!btn.isConnected) document.documentElement.appendChild(btn);
}

async function openFromButton(): Promise<void> {
  const settings = await loadSettings().catch(() => null);
  showCard(anchor || new DOMRect(8, 8, 0, 0), current, engineName(settings?.provider));
}

function iconButton(className: string, label: string, paths: string[]): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.setAttribute('aria-label', label);
  btn.append(icon(paths, 15), document.createTextNode(label));
  return btn;
}

function showCard(rect: DOMRect, text: string, engine: string): void {
  hideButton();
  const host = card ?? document.createElement('div');
  card = host;
  host.className = pageIsDark() ? 'ibt-sel-card ibt-sel-dark' : 'ibt-sel-card';
  host.replaceChildren();
  pinned = false;

  const head = document.createElement('div');
  head.className = 'ibt-sel-head';
  const gripEl = document.createElement('span');
  gripEl.className = 'ibt-sel-grip';
  gripEl.appendChild(grip());
  const name = document.createElement('span');
  name.className = 'ibt-sel-engine';
  name.textContent = engine;
  const pin = iconButton('ibt-sel-pin', '釘選', ICONS.pin);
  pin.setAttribute('aria-pressed', 'false');
  pin.lastChild?.remove();
  pin.onclick = (event) => {
    event.preventDefault();
    pinned = !pinned;
    pin.setAttribute('aria-pressed', pinned ? 'true' : 'false');
  };
  const close = iconButton('ibt-sel-x', '關閉', ICONS.close);
  close.lastChild?.remove();
  close.onclick = (event) => { event.preventDefault(); hideCard(); };
  head.append(gripEl, name, pin, close);
  enableDrag(host, head);

  const original = document.createElement('div');
  original.className = 'ibt-sel-orig';
  original.textContent = text;
  const body = document.createElement('div');
  body.className = 'ibt-sel-body';
  body.textContent = '翻譯中…';
  const actions = document.createElement('div');
  actions.className = 'ibt-sel-actions';
  const copy = iconButton('ibt-sel-copy', '複製', ICONS.copy);
  const speak = iconButton('ibt-sel-speak', '朗讀', ICONS.speak);
  copy.disabled = true;
  speak.disabled = true;
  actions.append(copy, speak);
  host.append(head, original, body, actions);

  const width = Math.min(360, window.innerWidth - 16);
  host.style.width = `${width}px`;
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.left));
  const below = rect.bottom + 12;
  host.style.left = `${left}px`;
  host.style.top = `${below}px`;
  if (!host.isConnected) document.documentElement.appendChild(host);
  const height = host.offsetHeight || 180;
  if (below + height > window.innerHeight - 8 && rect.top - height - 8 > 8) {
    host.style.top = `${Math.max(8, rect.top - height - 8)}px`;
  }
  const id = ++req;
  void fillCard(id, text, body, copy, speak);
}

function enableDrag(host: HTMLDivElement, handle: HTMLElement): void {
  let dx = 0;
  let dy = 0;
  let active = false;
  handle.addEventListener('pointerdown', (event) => {
    if ((event.target as Element | null)?.closest('button')) return;
    active = true;
    host.classList.add('ibt-sel-drag');
    dx = event.clientX - host.getBoundingClientRect().left;
    dy = event.clientY - host.getBoundingClientRect().top;
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', (event) => {
    if (!active) return;
    host.style.left = `${Math.min(window.innerWidth - 80, Math.max(4, event.clientX - dx))}px`;
    host.style.top = `${Math.min(window.innerHeight - 40, Math.max(4, event.clientY - dy))}px`;
  });
  const stop = (): void => {
    active = false;
    host.classList.remove('ibt-sel-drag');
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}

async function fillCard(
  id: number,
  text: string,
  body: HTMLDivElement,
  copy: HTMLButtonElement,
  speak: HTMLButtonElement,
): Promise<void> {
  try {
    const word = isWord(text);
    const msg = word ? { type: 'lookup', text } : { type: 'translate', text, mode: 'prose' as const };
    const resp = await chrome.runtime.sendMessage(msg) as {
      ok?: boolean;
      error?: string;
      pairs?: { t?: string }[];
      lookup?: { translation?: string; dict?: DictEntry[]; sourceLang?: string };
    };
    if (id !== req || !body.isConnected) return;
    if (!resp?.ok) {
      body.textContent = resp?.error || '無法取得譯文';
      return;
    }
    const translation = word
      ? (resp.lookup?.translation || '').trim()
      : (resp.pairs || []).map((p) => p.t || '').join('').trim();
    body.textContent = translation || '沒有譯文';
    const dict = word ? resp.lookup?.dict : undefined;
    if (dict?.length) {
      const list = document.createElement('div');
      list.className = 'ibt-sel-dict';
      for (const entry of dict.slice(0, 3)) {
        const line = document.createElement('div');
        line.textContent = `${entry.pos ? entry.pos + ' ' : ''}${entry.terms.slice(0, 4).join('、')}`;
        list.appendChild(line);
      }
      body.appendChild(list);
    }
    copy.disabled = !translation;
    speak.disabled = !translation;
    copy.onclick = () => writeClipboard(translation);
    speak.onclick = () => speakText(translation, resp.lookup?.sourceLang);
  } catch (err) {
    if (id !== req || !body.isConnected) return;
    body.textContent = '無法取得譯文';
    console.log('[IBT] selection failed', err);
  }
}

function speakText(text: string, sourceLang?: string): void {
  const synth = window.speechSynthesis;
  if (!synth || !text) return;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = /[\u4e00-\u9fff]/.test(text) ? 'zh-TW' : (sourceLang || 'en-US');
  synth.speak(utter);
}

function writeClipboard(text: string): void {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  try { document.execCommand('copy'); } catch { /* the card still shows the text */ }
  area.remove();
}

function hideButton(): void {
  button?.remove();
}

function hideCard(): void {
  req += 1;
  pinned = false;
  card?.remove();
  card = null;
}

function hideAll(): void {
  hideButton();
  hideCard();
}
