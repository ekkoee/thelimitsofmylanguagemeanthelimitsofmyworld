// Double-click / selection word popup.
//
// Watches the page for a finished text selection (double-click a word, or drag to
// highlight a phrase), then floats a small Shadow-DOM card near the selection with:
//   • the original text + a 🔊 read-aloud button (free browser speechSynthesis)
//   • the translation (loading → result)
//   • a dictionary card (part of speech + meanings) when the engine has data
//
// Translation/dictionary reuse the existing background → provider → cache pipeline
// via a single `lookup` message — no separate translation logic lives here.

import { sendMessage, isContextGoneError } from '../utils/runtime';
import { DictEntry, LookupResponse, WordLookup } from '../core/types';

let started = false;

// DOM handles (built lazily on first show, then reused).
let host: HTMLDivElement | null = null;       // shadow host attached to the page
let root: ShadowRoot | null = null;
let origEl: HTMLSpanElement | null = null;
let transEl: HTMLDivElement | null = null;
let dictEl: HTMLDivElement | null = null;

let visible = false;
let anchorRect: DOMRect | null = null;        // viewport-relative rect of the selection
let currentText = '';                         // the original text we're showing / will speak
let currentLang = '';                         // detected source language for TTS (filled after lookup)
let reqId = 0;                                // guards against stale async lookups
let checkTimer: number | undefined;           // debounce for selection evaluation

export function startWordPopup(): void {
  if (started) return;
  started = true;
  document.addEventListener('dblclick', onUserSelect, true);
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide, true);
  // Prime the (async-loading) voice list so 🔊 picks a good voice on first click.
  try { window.speechSynthesis?.getVoices(); } catch { /* not supported — fine */ }
}

export function stopWordPopup(): void {
  if (!started) return;
  started = false;
  document.removeEventListener('dblclick', onUserSelect, true);
  document.removeEventListener('mouseup', onMouseUp, true);
  document.removeEventListener('mousedown', onMouseDown, true);
  document.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('scroll', hide, true);
  window.removeEventListener('resize', hide, true);
  hide();
}

// ---- event handlers -------------------------------------------------------

function onMouseUp(e: MouseEvent): void {
  if (e.button !== 0 || isInsidePopup(e)) return; // left button only; ignore clicks in our card
  scheduleCheck();
}

function onUserSelect(e: MouseEvent): void {
  if (isInsidePopup(e)) return;
  scheduleCheck();
}

// A press that starts OUTSIDE the card dismisses it (before a new selection forms).
function onMouseDown(e: MouseEvent): void {
  if (visible && !isInsidePopup(e)) hide();
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && visible) hide();
}

// Debounce so a double-click (which also fires mouseup) only evaluates once, and so
// the browser has finished updating window.getSelection().
function scheduleCheck(): void {
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = window.setTimeout(evaluateSelection, 10);
}

function evaluateSelection(): void {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  const text = sel.toString().trim();
  if (!text) return;                       // empty selection never triggers
  if (isEditableSelection(sel)) return;    // skip input/textarea/contenteditable
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return;
  show(text, rect);
}

// ---- editable detection ---------------------------------------------------

function isEditableSelection(sel: Selection): boolean {
  return isEditableNode(sel.anchorNode) || isEditableNode(sel.focusNode);
}

function isEditableNode(node: Node | null): boolean {
  const el = node && (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement);
  if (!el) return false;
  if (el.isContentEditable) return true;             // contenteditable (incl. inherited)
  return !!el.closest('input, textarea, select');     // form fields
}

// ---- popup lifecycle ------------------------------------------------------

function show(text: string, rect: DOMRect): void {
  ensureDom();
  const id = ++reqId;
  currentText = text;
  currentLang = '';
  anchorRect = rect;
  visible = true;

  origEl!.textContent = text;
  transEl!.textContent = '翻譯中…';
  transEl!.className = 'trans loading';
  dictEl!.textContent = '';
  dictEl!.style.display = 'none';
  host!.style.display = 'block';
  position();

  lookup(text)
    .then((res) => {
      if (id !== reqId) return;            // a newer popup opened / we were dismissed
      currentLang = res.sourceLang || '';
      transEl!.textContent = res.translation || '（無翻譯結果）';
      transEl!.className = 'trans';
      renderDict(res.dict);
      position();                          // content grew → re-place & re-clamp
    })
    .catch((err) => {
      if (id !== reqId) return;
      transEl!.className = 'trans err';
      transEl!.textContent = isContextGoneError(err)
        ? '擴充功能已更新，請重新整理此頁。'
        : '翻譯失敗，請再試一次。';
      position();
    });
}

function hide(): void {
  reqId++;               // invalidate any in-flight lookup
  visible = false;
  anchorRect = null;
  if (host) host.style.display = 'none';
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}

async function lookup(text: string): Promise<WordLookup> {
  const resp = await sendMessage<LookupResponse>({ type: 'lookup', text });
  if (!resp?.ok || !resp.lookup) throw new Error(resp?.error || 'lookup failed');
  return resp.lookup;
}

// ---- rendering ------------------------------------------------------------

function renderDict(entries?: DictEntry[]): void {
  dictEl!.textContent = '';
  if (!entries || !entries.length) { dictEl!.style.display = 'none'; return; }
  dictEl!.style.display = 'block';
  for (const e of entries) {
    const row = document.createElement('div');
    row.className = 'd-row';
    if (e.pos) {
      const pos = document.createElement('span');
      pos.className = 'd-pos';
      pos.textContent = e.pos;
      row.appendChild(pos);
    }
    const terms = document.createElement('span');
    terms.className = 'd-terms';
    terms.textContent = e.terms.join('、');
    row.appendChild(terms);
    dictEl!.appendChild(row);
  }
}

// ---- positioning (flip near edges, clamp into the viewport) ---------------

const GAP = 8;
const MARGIN = 8;

function position(): void {
  if (!host || !anchorRect) return;
  const card = root!.querySelector('.card') as HTMLElement;
  const w = card.offsetWidth || 280;
  const h = card.offsetHeight || 80;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // horizontal: align to selection start, clamp into the viewport
  let left = anchorRect.left;
  if (left + w > vw - MARGIN) left = vw - w - MARGIN;
  if (left < MARGIN) left = MARGIN;

  // vertical: below the selection, flip above if it would overflow the bottom
  let top = anchorRect.bottom + GAP;
  if (top + h > vh - MARGIN && anchorRect.top - GAP - h > MARGIN) {
    top = anchorRect.top - GAP - h;
  }
  if (top < MARGIN) top = MARGIN;

  host.style.left = `${Math.round(left)}px`;
  host.style.top = `${Math.round(top)}px`;
}

// ---- text-to-speech (free, browser speechSynthesis) -----------------------

function speak(): void {
  const synth = window.speechSynthesis;
  if (!synth || !currentText) return;
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(currentText);
    const voice = pickVoice(currentLang);
    if (voice) u.voice = voice;
    if (voice?.lang) u.lang = voice.lang;
    else if (currentLang) u.lang = currentLang;       // let the browser choose a default voice
    synth.speak(u);
  } catch { /* ignore — TTS is best-effort */ }
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (!lang) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const want = lang.toLowerCase();
  const base = want.split(/[-_]/)[0];
  return (
    voices.find((v) => v.lang.toLowerCase() === want) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(base + '-')) ||
    voices.find((v) => v.lang.toLowerCase().split(/[-_]/)[0] === base) ||
    null
  );
}

// ---- shadow DOM construction ----------------------------------------------

function isInsidePopup(e: Event): boolean {
  if (!host) return false;
  const path = e.composedPath ? e.composedPath() : [];
  return path.includes(host);
}

function ensureDom(): void {
  if (host) return;
  host = document.createElement('div');
  host.setAttribute('data-ibt-word-popup', '');
  // Only positioning + stacking live on the host; the rest is sealed in the shadow
  // so page CSS can't reach in and our CSS can't leak out.
  host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;display:none;';
  root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      .card {
        all: initial;
        box-sizing: border-box;
        display: block;
        max-width: 320px;
        min-width: 160px;
        padding: 10px 12px;
        border-radius: 10px;
        background: #ffffff;
        color: #1a1a1a;
        font: 14px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif;
        box-shadow: 0 6px 24px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06);
        cursor: default;
        -webkit-user-select: none;
        user-select: none;
      }
      .top { display: flex; align-items: flex-start; gap: 8px; }
      .orig { flex: 1; font-weight: 600; word-break: break-word; }
      .speak {
        all: unset;
        flex: none;
        cursor: pointer;
        font-size: 15px;
        line-height: 1;
        padding: 3px 5px;
        border-radius: 6px;
      }
      .speak:hover { background: rgba(0,0,0,0.07); }
      .trans { margin-top: 6px; color: #2456c8; word-break: break-word; }
      .trans.loading { color: #8a8f98; }
      .trans.err { color: #c0392b; }
      .dict {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid rgba(0,0,0,0.10);
      }
      .d-row { margin: 3px 0; word-break: break-word; }
      .d-pos {
        display: inline-block;
        margin-right: 6px;
        padding: 0 6px;
        border-radius: 4px;
        background: rgba(0,0,0,0.06);
        color: #6a6f78;
        font-size: 12px;
        font-style: italic;
      }
      .d-terms { color: #333; }
      @media (prefers-color-scheme: dark) {
        .card { background: #26282c; color: #e8e8e8;
          box-shadow: 0 6px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08); }
        .speak:hover { background: rgba(255,255,255,0.12); }
        .trans { color: #8ab4f8; }
        .dict { border-top-color: rgba(255,255,255,0.14); }
        .d-pos { background: rgba(255,255,255,0.10); color: #b6bcc6; }
        .d-terms { color: #d7d7d7; }
      }
    </style>
    <div class="card">
      <div class="top">
        <span class="orig"></span>
        <button class="speak" title="朗讀" aria-label="朗讀">🔊</button>
      </div>
      <div class="trans"></div>
      <div class="dict" style="display:none"></div>
    </div>
  `;
  origEl = root.querySelector('.orig');
  transEl = root.querySelector('.trans');
  dictEl = root.querySelector('.dict');
  const speakBtn = root.querySelector('.speak') as HTMLButtonElement;
  speakBtn.addEventListener('click', (e) => { e.stopPropagation(); speak(); });

  (document.body || document.documentElement).appendChild(host);
}
