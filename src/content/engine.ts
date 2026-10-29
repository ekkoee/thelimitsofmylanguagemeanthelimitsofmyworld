import { AlignedPair, Settings, TranslateResponse } from '../core/types';
import { hasTranslatableText, isAlreadyTargetLang } from '../core/segmentation';
import { el, isProcessed, markProcessed } from '../utils/dom';
import { sendMessage, isContextGoneError } from '../utils/runtime';
import { findPlacedBlock, placeBlock, shadowBody, unanchor } from './place';

export interface TextUnit { source: HTMLElement; text: string; }
export interface SiteAdapter { id: string; collect(): TextUnit[]; }

// Content fingerprint (copied from universal.ts): identifies "this exact text
// already has a translation here" even after the framework swaps the source
// node. Reddit (shreddit) re-renders / re-slots post nodes, so a re-scanned
// source loses its data-ibt-done and looks unprocessed → would translate again.
function sigOf(text: string): string {
  const s = text.trim();
  return `${s.length}|${s.slice(0, 24)}|${s.slice(-12)}`;
}

// Inside the source, just after it, or a fixed overlay glued to it.
function findAdjacentBlock(anchor: HTMLElement): HTMLElement | null {
  return findPlacedBlock(anchor);
}

// POST-scan cleanup. Reddit (shreddit) re-renders asynchronously: when a second
// block is inserted the old one hasn't yet been moved next to the new source, so
// the pre-insert guard (findAdjacentBlock) sees nothing and lets it through. By
// the time layout settles the two duplicates ARE adjacent — so we sweep them here.
function sameSig(a: HTMLElement, b: HTMLElement): boolean {
  const sa = a.dataset.ibtSig; const sb = b.dataset.ibtSig;
  return !!sa && sa === sb;            // both stamped (sig is written at insert time, so reliable even while loading) and equal
}
function dedupeAdjacentBlocks(root: ParentNode): void {
  const blocks = root.querySelectorAll<HTMLElement>('.ibt-block[data-ibt-out="1"]');
  blocks.forEach((b) => {
    if (!b.isConnected) return;
    let next = b.nextElementSibling as HTMLElement | null;
    // Drop the duplicate block(s) sitting right after with the same signature.
    while (next && next.classList.contains('ibt-block') && next.dataset.ibtOut === '1' && sameSig(b, next)) {
      const toRemove = next;
      next = next.nextElementSibling as HTMLElement | null;
      toRemove.remove();
    }
  });
}

// A pair whose ORIGINAL is just a URL or bare domain (e.g. ui.hindsight.vectorize.io):
// translating it yields a meaningless second copy of the link, so skip it. Only
// matches when the WHOLE string is a URL — a sentence that merely contains a link
// is a different pair and is unaffected.
function isPureUrl(s: string): boolean {
  const t = s.trim();
  return /^(https?:\/\/|www\.)\S+$/i.test(t) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(t);
}

let firstSendAt = 0;
let loggedFirstPaint = false;
let reqSeq = 0;

/** Replace hedge lines with the primary model's text. Same nodes, so layout stays. */
function installUpgradeListener(): void {
  const rt = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
  if (!rt?.onMessage) return;
  rt.onMessage.addListener((msg) => {
    if (msg?.type !== 'ibt-upgrade' || !msg.reqId) return;
    const block = document.querySelector(`[data-ibt-req="${msg.reqId}"]`);
    const root = block?.shadowRoot;
    if (!root) return;
    const lines = root.querySelectorAll('.ibt-trans');
    const pairs = (msg.pairs || []) as { t?: string }[];
    for (let i = 0; i < lines.length && i < pairs.length; i++) {
      const t = pairs[i].t || '';
      if (t && lines[i].textContent !== t) lines[i].textContent = t;
    }
  });
}
installUpgradeListener();

async function translateBlock(text: string, priority?: 'visible' | 'near', reqId?: string): Promise<AlignedPair[]> {
  // Reddit / X / universal are prose; carry the page title as background context.
  const t0 = performance.now();
  if (!firstSendAt) firstSendAt = t0;
  const resp = await sendMessage<TranslateResponse>({
    type: 'translate', text, title: document.title, mode: 'prose', priority, reqId,
  });
  const ms = Math.round(performance.now() - t0);
  console.log(`[IBT] block ${ms}ms chars=${text.length} priority=${priority ?? 'visible'}`);
  if (!loggedFirstPaint && resp?.ok) {
    loggedFirstPaint = true;
    const view = (window as unknown as { __ibtXView?: number }).__ibtXView;
    const sinceSend = Math.round(performance.now() - firstSendAt);
    const sinceView = view ? Math.round(performance.now() - view) : sinceSend;
    console.log(`[IBT] first translation ${sinceView}ms (request ${sinceSend}ms)`);
  }
  if (!resp?.ok) throw new Error(resp?.error || 'translate failed');
  return resp.pairs || [];
}

// Never assign `className` — that wiped `ibt-uni` the moment a translation
// arrived, so the full-width / anti-flex rules only applied during "翻譯中…".
function setPhase(block: HTMLElement, phase: 'loading' | 'ready' | 'error'): void {
  block.classList.add('ibt-block');
  block.classList.toggle('ibt-loading', phase === 'loading');
  block.classList.toggle('ibt-error', phase === 'error');
}

function fillPairs(block: HTMLElement, pairs: AlignedPair[]): void {
  setPhase(block, 'ready');
  const body = shadowBody(block);
  body.textContent = '';
  // Our block holds ONLY the translation. The original stays as the page's own
  // text (rich: links/mentions/media intact); the 3-state view shows/hides that
  // original via `.ibt-orig-src`. No `.ibt-orig` duplicate → no double original.
  for (const p of pairs) {
    if (isPureUrl(p.o) || !hasTranslatableText(p.o)) continue;   // just a URL / @mention → no useful translation
    body.appendChild(el('div', 'ibt-trans', p.t));
  }
}

// Shown when the extension context is gone (reload/update): a refresh reloads
// the fresh content script and translation resumes.
function showReloadHint(block: HTMLElement): void {
  setPhase(block, 'ready');
  const body = shadowBody(block);
  body.textContent = '';
  body.appendChild(el('span', 'ibt-error-msg', '擴充功能已更新，請重新整理此頁面以繼續翻譯。'));
}

function showError(block: HTMLElement, message: string, retry: () => void): void {
  setPhase(block, 'error');
  const body = shadowBody(block);
  body.textContent = '';
  // 429 = rate/quota limit: retries with backoff already happened inside the
  // provider, so this only shows when the quota is genuinely exhausted.
  const isQuota = /(^|\W)429(\W|$)|quota|rate.?limit/i.test(message);
  const friendly = message.startsWith('NO_API_KEY')
    ? '此引擎需要 API key — 點擊擴充功能圖示 → 選項頁填入（或切回免費引擎）。'
    : isQuota
      ? '翻譯額度暫時用盡（請求太頻繁或配額已滿），已自動重試多次。請稍後按「重試」，或到選項頁切換免費引擎。'
      : `翻譯失敗：${message.replace(/\{[\s\S]*$/, '').trim().slice(0, 120) || message.slice(0, 120)}`;
  body.appendChild(el('span', 'ibt-error-msg', friendly));
  const btn = el('button', 'ibt-retry', '重試');
  btn.addEventListener('click', retry);
  body.appendChild(btn);
}

/** Insert a translation block right AFTER `anchor` (element or text node).
 *  `opts.sig` stamps a content fingerprint on the block (data-ibt-sig) so a re-scan
 *  can detect "this exact translation already sits here" even after the framework
 *  swaps the source node — see universal.ts. Every block is also tagged
 *  data-ibt-out so the universal MutationObserver ignores its own insertions. */
export function renderTranslationAfter(
  anchor: Node, text: string, opts?: { sig?: string; adaptive?: boolean; priority?: 'visible' | 'near' },
): HTMLElement | null {
  if (!hasTranslatableText(text)) return null;
  const reqId = `r${(++reqSeq).toString(36)}`;
  const block = el('div', 'ibt-block ibt-loading');
  block.dataset.ibtOut = '1';
  block.dataset.ibtReq = reqId;
  if (opts?.sig) block.dataset.ibtSig = opts.sig;
  if (opts?.adaptive) block.classList.add('ibt-uni');
  // Tag the original element so "Chinese-only" view can hide it via CSS — but
  // ONLY when our block is a true sibling of a self-contained original
  // (Reddit / universal / single-line tweets & bios). Never tag a <br>, nor any
  // container that already holds our blocks (e.g. a multi-line tweet's text box,
  // whose interleaved originals are text nodes that CSS can't hide anyway).
  // Tag BEFORE insertion: appending inside the source would make the
  // ".ibt-block" check see ourselves and skip the tag.
  if (anchor.nodeType === 1) {
    const elAnchor = anchor as HTMLElement;
    // Reddit's <shreddit-post> projects light-DOM children into shadow <slot>s.
    // An unslotted block lands in the DEFAULT slot — rendered at the BOTTOM of
    // the post — which is why the title's translation showed up at the end.
    // Mirror the source's slot so the translation renders right where the
    // original is (e.g. directly under the title).
    const slot = elAnchor.getAttribute('slot');
    if (slot) block.setAttribute('slot', slot);
    if (elAnchor.tagName !== 'BR' && !elAnchor.querySelector(':scope > .ibt-block')) {
      elAnchor.classList.add('ibt-orig-src');
    }
  }
  placeBlock(anchor, block, !!opts?.adaptive);

  const run = async () => {
    setPhase(block, 'loading');
    const body = shadowBody(block);
    body.textContent = '';
    body.appendChild(el('span', 'ibt-loading-dot', '翻譯中…'));
    try {
      const pairs = await translateBlock(text, opts?.priority, reqId);
      fillPairs(block, pairs);
    } catch (err: any) {
      // Extension was reloaded/updated → quiet "refresh" hint, no retry spam.
      if (isContextGoneError(err)) { showReloadHint(block); return; }
      showError(block, String(err?.message ?? err), run);
    }
  };
  void run();
  return block;
}

/** Generic engine: one translation inserted after each collected element.
    Used for Reddit (real <p>/<li> paragraph nodes). */
export class Engine {
  private io?: IntersectionObserver;
  private readonly pending = new Set<HTMLElement>();

  constructor(private adapter: SiteAdapter, private settings: Settings) {}
  setSettings(s: Settings) { this.settings = s; }

  private siteEnabled(): boolean {
    const id = this.adapter.id as keyof Settings['sites'];
    return this.settings.enabled && (this.settings.sites[id] ?? true);
  }

  scan(): void {
    if (!this.siteEnabled()) return;
    for (const unit of this.adapter.collect()) {
      if (isProcessed(unit.source) || this.pending.has(unit.source)) continue;
      // Skip text already in the target language (e.g. a Chinese post when the
      // target is Chinese) — no 中文→中文 duplicate. Not marked processed, so it
      // re-evaluates if the target language is later changed.
      if (isAlreadyTargetLang(unit.text, this.settings.targetLangCode)) continue;

      // Re-render guard (Reddit re-slots nodes → source loses data-ibt-done).
      // If a block we placed still sits after this source, decide by fingerprint:
      // same text → already translated, just re-stamp the source and skip; changed
      // text → drop the stale block(s) and translate fresh. Protects BOTH the
      // immediate and the translateOnVisible (IO) paths, since it runs before either.
      const sig = sigOf(unit.text);
      const existing = findAdjacentBlock(unit.source);
      if (existing) {
        if (existing.dataset.ibtSig === sig) {
          markProcessed(unit.source);   // re-stamp the swapped-in node so we don't re-check it
          continue;
        }
        let b: Element | null = existing;   // text changed → remove this block + any consecutive ones
        while (b && b.classList.contains('ibt-block')) {
          const next: Element | null = b.nextElementSibling;
          unanchor(b as HTMLElement);
          b.remove();
          b = next;
        }
      }

      if (this.settings.translateOnVisible) {
        this.pending.add(unit.source);
        (unit.source as any).__ibtText = unit.text;
        (unit.source as any).__ibtSig = sig;
        this.ensureIO().observe(unit.source);
      } else {
        markProcessed(unit.source);
        renderTranslationAfter(unit.source, unit.text, { sig });
      }
    }
    // Async re-renders can slip a duplicate past the pre-insert guard; once both
    // copies are in the DOM (next debounced scan) they're adjacent → sweep them.
    dedupeAdjacentBlocks(document.body);
  }

  private ensureIO(): IntersectionObserver {
    if (this.io) return this.io;
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const src = e.target as HTMLElement;
        this.io!.unobserve(src);
        this.pending.delete(src);
        if (isProcessed(src)) continue;
        markProcessed(src);
        const text = (src as any).__ibtText || src.innerText || '';
        renderTranslationAfter(src, text, { sig: (src as any).__ibtSig || sigOf(text) });
      }
    }, { rootMargin: '300px' });
    return this.io;
  }
}
