// 劃詞翻譯. A small 「譯」 sits beside a finished selection. Clicking it opens a
// compact card. An optional setting shows the card immediately.

import { loadSettings } from '../core/storage';
import { DictEntry } from '../core/types';

let listening = false;
let button: HTMLButtonElement | null = null;
let card: HTMLDivElement | null = null;
let current = '';
let req = 0;

export function startSelectionTranslate(): void {
  const w = window as unknown as { __ibtSelection?: boolean };
  if (w.__ibtSelection) return;
  w.__ibtSelection = true;
  if (listening) return;
  listening = true;
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', hideAll, true);
}

function editable(node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement;
  return Boolean(el?.closest('input, textarea, select, [contenteditable="true"]'));
}

function ours(node: EventTarget | null): boolean {
  return node instanceof Element && Boolean(node.closest('.ibt-sel-btn, .ibt-sel-card'));
}

function selectedText(): { text: string; rect: DOMRect } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount < 1) return null;
  const text = sel.toString().replace(/\s+/g, ' ').trim();
  if (text.length < 1 || text.length > 800) return null;
  const range = sel.getRangeAt(0);
  if (editable(range.startContainer)) return null;
  const rect = range.getBoundingClientRect();
  if (rect.width < 1 && rect.height < 1) return null;
  return { text, rect };
}

async function onMouseUp(event: MouseEvent): Promise<void> {
  if (event.button !== 0 || ours(event.target)) return;
  const settings = await loadSettings().catch(() => null);
  if (settings && settings.selectionTranslate === false) { hideAll(); return; }
  const hit = selectedText();
  if (!hit) { hideButton(); return; }
  current = hit.text;
  if (settings?.selectionInstant) {
    hideButton();
    showCard(hit.rect, hit.text);
    return;
  }
  showButton(hit.rect);
}

function onMouseDown(event: MouseEvent): void {
  if (ours(event.target)) {
    event.preventDefault();
    return;
  }
  hideAll();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') hideAll();
}

function showButton(rect: DOMRect): void {
  hideCard();
  const btn = button ?? document.createElement('button');
  button = btn;
  btn.type = 'button';
  btn.className = 'ibt-sel-btn';
  btn.textContent = '譯';
  btn.style.left = `${Math.min(window.innerWidth - 36, rect.right + 4)}px`;
  btn.style.top = `${Math.max(8, rect.top - 4)}px`;
  btn.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    showCard(rect, current);
  };
  if (!btn.isConnected) document.documentElement.appendChild(btn);
}

function showCard(rect: DOMRect, text: string): void {
  hideButton();
  const host = card ?? document.createElement('div');
  card = host;
  host.className = 'ibt-sel-card';
  host.replaceChildren();
  const head = document.createElement('div');
  head.className = 'ibt-sel-head';
  const original = document.createElement('div');
  original.className = 'ibt-sel-orig';
  original.textContent = text;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ibt-sel-x';
  close.textContent = '✕';
  close.onclick = (event) => { event.preventDefault(); hideCard(); };
  head.append(original, close);
  const body = document.createElement('div');
  body.className = 'ibt-sel-body';
  body.textContent = '翻譯中…';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'ibt-sel-copy';
  copy.textContent = '複製';
  copy.disabled = true;
  host.append(head, body, copy);
  host.style.left = `${Math.min(window.innerWidth - 280, Math.max(8, rect.left))}px`;
  host.style.top = `${Math.min(window.innerHeight - 40, rect.bottom + 8)}px`;
  if (!host.isConnected) document.documentElement.appendChild(host);
  const id = ++req;
  void fillCard(id, text, body, copy);
}

async function fillCard(id: number, text: string, body: HTMLDivElement, copy: HTMLButtonElement): Promise<void> {
  try {
    const short = text.length <= 32 && !/\s/.test(text);
    const msg = short ? { type: 'lookup', text } : { type: 'translate', text, mode: 'prose' as const };
    const resp = await chrome.runtime.sendMessage(msg) as {
      ok?: boolean;
      error?: string;
      pairs?: { t?: string }[];
      lookup?: { translation?: string; dict?: DictEntry[] };
    };
    if (id !== req || !body.isConnected) return;
    if (!resp?.ok) {
      body.textContent = resp?.error || '無法取得譯文';
      return;
    }
    const translation = short
      ? (resp.lookup?.translation || '').trim()
      : (resp.pairs || []).map((p) => p.t || '').join('').trim();
    body.textContent = translation || '沒有譯文';
    const dict = short ? resp.lookup?.dict : undefined;
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
    copy.onclick = () => writeClipboard(translation);
  } catch (err) {
    if (id !== req || !body.isConnected) return;
    body.textContent = '無法取得譯文';
    console.log('[IBT] selection failed', err);
  }
}

function writeClipboard(text: string): void {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  try { document.execCommand('copy'); } catch { /* the selection card still shows the text */ }
  area.remove();
}

function hideButton(): void {
  button?.remove();
}

function hideCard(): void {
  req += 1;
  card?.remove();
}

function hideAll(): void {
  hideButton();
  hideCard();
}
