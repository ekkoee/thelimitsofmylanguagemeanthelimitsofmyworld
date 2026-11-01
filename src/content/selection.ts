// 劃詞翻譯. A round control sits at the end of a finished selection. The card
// shows the source, the translation, and copy. Speaking reads the original.
// Inputs and editable fields are left alone.

import { t } from '../core/i18n';
import { langTag } from '../core/lang-tag';
import { loadSettings } from '../core/storage';
import { DictEntry } from '../core/types';
import { findVocab, removeVocab, saveVocab } from '../core/vocab';

const NS = 'http://www.w3.org/2000/svg';

let listening = false;
let button: HTMLButtonElement | null = null;
let card: HTMLDivElement | null = null;
let current = '';
let req = 0;
let anchor: DOMRect | null = null;

export function startSelectionTranslate(): void {
  const w = window as unknown as { __ibtSelection?: boolean };
  if (w.__ibtSelection) return;
  w.__ibtSelection = true;
  if (listening) return;
  listening = true;
  document.addEventListener('mouseup', onMouseUp, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKey, true);
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
    dot.setAttribute('r', '1.35');
    dot.setAttribute('fill', 'currentColor');
    svg.appendChild(dot);
  }
  return svg;
}

const ICONS = {
  mark: ['M4 7.5h7', 'M7.5 7.5c.1 3.6-1.7 5.6-4.4 7', 'M4.8 11h5.2', 'M13.5 16h6.2', 'M16.6 12.4v7'],
  star: ['M12 3.4l2.2 4.6 5 .7-3.6 3.5.9 5L12 15.2 7.5 17.2l.9-5L4.8 8.7l5-.7z'],
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

let downX = 0;
let downY = 0;
let downText = '';

function onPointerDown(event: PointerEvent): void {
  downX = event.clientX;
  downY = event.clientY;
  downText = (window.getSelection()?.toString() || '').replace(/\s+/g, ' ').trim();
  if (ours(event.target)) return;
  hideButton();
  hideCard();
}

async function onMouseUp(event: MouseEvent): Promise<void> {
  if (event.button !== 0 || ours(event.target)) return;
  const settings = await loadSettings().catch(() => null);
  if (settings && settings.selectionTranslate === false) { hideAll(); return; }
  const hit = selectedText();
  if (!hit) { hideButton(); return; }
  const moved = Math.hypot(event.clientX - downX, event.clientY - downY) > 5;
  // A click that leaves the same selection up (X's left rail, blank page) must not reopen.
  if (!moved && hit.text === downText) { hideButton(); return; }
  current = hit.text;
  anchor = hit.rect;
  if (settings?.selectionInstant) {
    hideButton();
    showCard(hit.rect, hit.text);
    return;
  }
  showButton(hit.rect);
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') hideAll();
}

function onScroll(): void {
  hideAll();
}

function showButton(rect: DOMRect): void {
  const btn = button ?? document.createElement('button');
  button = btn;
  btn.type = 'button';
  btn.className = 'ibt-sel-btn';
  btn.dataset.i18nAria = 'selTranslate';
  btn.setAttribute('aria-label', t('selTranslate'));
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
  showCard(anchor || new DOMRect(8, 8, 0, 0), current);
}

function iconButton(className: string, key: 'copy' | 'saveWord' | 'close' | 'speakOrig', paths: string[]): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.dataset.i18nAria = key;
  btn.setAttribute('aria-label', t(key));
  btn.append(icon(paths, 15), document.createTextNode(t(key)));
  return btn;
}

function showCard(rect: DOMRect, text: string): void {
  hideButton();
  const host = card ?? document.createElement('div');
  card = host;
  host.className = pageIsDark() ? 'ibt-sel-card ibt-sel-dark' : 'ibt-sel-card';
  host.replaceChildren();

  const head = document.createElement('div');
  head.className = 'ibt-sel-head';
  const gripEl = document.createElement('span');
  gripEl.className = 'ibt-sel-grip';
  gripEl.appendChild(grip());
  const copy = iconButton('ibt-sel-copy', 'copy', ICONS.copy);
  copy.lastChild?.remove();
  copy.disabled = true;
  const save = iconButton('ibt-sel-save', 'saveWord', ICONS.star);
  save.setAttribute('aria-pressed', 'false');
  save.lastChild?.remove();
  const close = iconButton('ibt-sel-x', 'close', ICONS.close);
  close.lastChild?.remove();
  close.onclick = (event) => { event.preventDefault(); hideCard(); };
  head.append(gripEl, copy, save, close);
  enableDrag(host, head);

  const original = document.createElement('div');
  original.className = 'ibt-sel-orig';
  const source = document.createElement('span');
  source.textContent = text;
  const speak = iconButton('ibt-sel-speak', 'speakOrig', ICONS.speak);
  speak.lastChild?.remove();
  let sourceLang = 'en-US';
  speak.onclick = (event) => { event.preventDefault(); speakText(text, sourceLang); };
  original.append(source, speak);
  const body = document.createElement('div');
  body.className = 'ibt-sel-body';
  const tag = langTag(document.documentElement.getAttribute('data-ibt-target'));
  body.lang = tag;
  body.dataset.i18n = 'translating';
  body.textContent = t('translating');
  const example = document.createElement('div');
  example.className = 'ibt-sel-ex';
  example.hidden = true;
  host.append(head, original, body, example);

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
  void fillCard(id, text, body, copy, save, example, (lang) => { sourceLang = lang; });
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

const sentenceCache = new Map<string, string>();

/** The sentence on the page that contains the selection. Empty inside inputs. */
function sourceSentence(word: string): string {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount < 1) return '';
  const range = sel.getRangeAt(0);
  if (editable(range.startContainer)) return '';
  const node = range.startContainer;
  const el = node instanceof Element ? node : node.parentElement;
  const block = (el?.closest('p, li, blockquote, h1, h2, h3, [data-testid="tweetText"]') || el) as HTMLElement | null | undefined;
  const blob = (block?.innerText || block?.textContent || '').replace(/\s+/g, ' ').trim();
  const needle = word.trim();
  if (!blob || !needle || blob.toLowerCase() === needle.toLowerCase()) return '';
  const at = blob.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return '';
  const parts = blob.match(/[^.!?。！？]*[.!?。！？]+(?:["”’)\]]+)?|[^.!?。！？]+$/g) || [blob];
  let cursor = 0;
  for (const part of parts) {
    const start = blob.indexOf(part, cursor);
    const from = start < 0 ? cursor : start;
    const end = from + part.length;
    cursor = end;
    if (at >= from && at < end) return part.trim();
  }
  return blob.trim();
}

function highlightWord(sentence: string, word: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const at = sentence.toLowerCase().indexOf(word.trim().toLowerCase());
  if (at < 0) {
    frag.append(document.createTextNode(sentence));
    return frag;
  }
  const mark = document.createElement('span');
  mark.className = 'ibt-sel-hit';
  mark.textContent = sentence.slice(at, at + word.trim().length);
  frag.append(document.createTextNode(sentence.slice(0, at)), mark, document.createTextNode(sentence.slice(at + word.trim().length)));
  return frag;
}

async function translateSentence(sentence: string): Promise<string> {
  const key = sentence.trim();
  const cached = sentenceCache.get(key);
  if (cached) return cached;
  const resp = await chrome.runtime.sendMessage({ type: 'translate', text: key, mode: 'prose' }) as {
    ok?: boolean;
    pairs?: { t?: string }[];
  };
  const zh = (resp?.ok ? resp.pairs || [] : []).map((p) => p.t || '').join('').trim();
  if (zh) sentenceCache.set(key, zh);
  return zh;
}

function paintSaved(btn: HTMLButtonElement, on: boolean): void {
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.dataset.i18nAria = on ? 'savedWord' : 'saveWord';
  btn.setAttribute('aria-label', t(on ? 'savedWord' : 'saveWord'));
  btn.querySelector('path')?.setAttribute('fill', on ? 'currentColor' : 'none');
}

async function fillCard(
  id: number,
  text: string,
  body: HTMLDivElement,
  copy: HTMLButtonElement,
  save: HTMLButtonElement,
  example: HTMLDivElement,
  setSourceLang: (lang: string) => void,
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
      delete body.dataset.i18n;
      body.textContent = resp?.error || t('translationFailed');
      return;
    }
    const translation = word
      ? (resp.lookup?.translation || '').trim()
      : (resp.pairs || []).map((p) => p.t || '').join('').trim();
    delete body.dataset.i18n;
    body.textContent = translation || t('noTranslation');
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
    if (resp.lookup?.sourceLang) setSourceLang(resp.lookup.sourceLang);
    copy.disabled = !translation;
    copy.onclick = (event) => { event.preventDefault(); writeClipboard(translation); };
    const sentence = sourceSentence(text);
    let sentenceZh = '';
    if (sentence) {
      example.hidden = false;
      example.replaceChildren();
      const label = document.createElement('div');
      label.className = 'ibt-sel-ex-label';
      label.dataset.i18n = 'example';
      label.textContent = t('example');
      const en = document.createElement('p');
      en.className = 'ibt-sel-ex-en';
      en.append(highlightWord(sentence, text));
      const sk = document.createElement('div');
      sk.className = 'ibt-sel-sk';
      example.append(label, en, sk);
      void translateSentence(sentence).then(async (zh) => {
        if (id !== req || !example.isConnected) return;
        sk.remove();
        sentenceZh = zh;
        if (zh) {
          const line = document.createElement('p');
          line.className = 'ibt-sel-ex-zh';
          line.lang = langTag(document.documentElement.getAttribute('data-ibt-target'));
          line.textContent = zh;
          example.append(line);
        }
        if (save.getAttribute('aria-pressed') === 'true') {
          const stored = await findVocab(text).catch(() => null);
          if (stored) await saveVocab({ ...stored, context: sentence, contextZh: zh });
        }
      }).catch(() => { if (example.isConnected) sk.remove(); });
    }
    const entries = (dict || []).slice(0, 4);
    const pos = entries.map((entry) => entry.pos).filter(Boolean).join('、');
    const meanings = entries.map((entry) => entry.terms.slice(0, 4).join('、')).filter(Boolean).join('；');
    const existing = await findVocab(text).catch(() => null);
    if (id !== req || !save.isConnected) return;
    paintSaved(save, !!existing);
    save.onclick = async (event) => {
      event.preventDefault();
      const on = save.getAttribute('aria-pressed') === 'true';
      if (on) {
        await removeVocab(text.trim().toLowerCase());
        paintSaved(save, false);
        return;
      }
      await saveVocab({
        word: text,
        translation,
        pos,
        meanings,
        dict: entries.map((entry) => ({ pos: entry.pos, terms: entry.terms.slice(0, 6) })),
        context: sentence,
        contextZh: sentenceZh,
        title: document.title || '',
        url: location.href,
      });
      paintSaved(save, true);
    };
  } catch (err) {
    if (id !== req || !body.isConnected) return;
    delete body.dataset.i18n;
    body.textContent = t('translationFailed');
    console.log('[IBT] selection failed', err);
  }
}

function speakText(text: string, sourceLang?: string): void {
  const synth = window.speechSynthesis;
  if (!synth || !text) return;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = sourceLang && sourceLang !== 'auto' ? sourceLang : 'en-US';
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
  card?.remove();
  card = null;
}

function hideAll(): void {
  hideButton();
  hideCard();
}
