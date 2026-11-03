// LinkedIn feed. Posts are often clamped behind a "see more" / "更多" control.
// Translating the clamped preview spends a request and then goes stale when the
// reader expands the post, so expansion itself is what translates that card.
import { isAlreadyTargetLang } from '../core/segmentation';
import { renderTranslationAfter } from './engine';
import { pageFontPx } from './page-font';

const POST = [
  '.feed-shared-update-v2',
  '.main-feed-activity-card',
  '[data-activity-urn]',
  '[data-id^="urn:li:activity"]',
  '[data-urn^="urn:li:activity"]',
  '[data-test-id="main-feed-activity-card"]',
].join(',');

export const LI_BODY = [
  '.update-components-text',
  '.feed-shared-update-v2__description',
  '.feed-shared-update-v2__commentary',
  '.feed-shared-inline-show-more-text',
  '.update-components-update-v2__commentary',
  '[data-testid="expandable-text-box"]',
  '[data-test-id="main-feed-activity-card__commentary"]',
  '.attributed-text-segment-list__content',
].join(',');

const LI_TRANSLATION = [
  '.feed-shared-translation',
  '.update-components-text--translation',
  '[data-test-id*="translated"]',
  '[data-testid*="translated"]',
  '[class*="translated-text"]',
  '[class*="see-translation-text"]',
].join(',');

export type LiControl = 'expand' | 'collapse' | 'translation' | 'ignore';

const TRANSLATION_RE = /translat|翻譯|see-translation|show-translation|hide-translation/i;
const COLLAPSE_CLASS_RE = /\bsee-less\b|\bless-button\b|\bshow-less\b/i;
// "see-more-less-toggle" contains the letters see-more. \b still matches there,
// so collapse classes are tested first.
const EXPAND_CLASS_RE = /see-more-less-toggle|\bsee-more\b|\bmore-button\b|\bshow-more\b/i;
const EXPAND_LABEL_RE = /^(?:…|\.\.\.|⋯)?(?:seemore|more|更多|查看更多|顯示更多)$/i;
const COLLAPSE_LABEL_RE = /^(?:seeless|less|更少|收合|收起)$/i;

export function linkedInHost(host = location.hostname): boolean {
  return /(^|\.)linkedin\.com$/i.test(host);
}

function classNameOf(el: Element): string {
  const c = (el as HTMLElement).className;
  return typeof c === 'string' ? c : '';
}

function labelOf(el: HTMLElement): string {
  return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
}

/** Language-independent: class, aria, and data first. The visible label is only a fallback. */
export function controlFromElement(el: Element | null): LiControl {
  if (!el || typeof (el as Element).closest !== 'function') return 'ignore';
  const btn = el.closest('button, [role="button"]') as HTMLElement | null;
  if (!btn) return 'ignore';
  const blob = [
    classNameOf(btn),
    btn.getAttribute('aria-label') || '',
    btn.getAttribute('data-test-id') || '',
    btn.getAttribute('data-testid') || '',
    btn.getAttribute('data-tracking-control-name') || '',
  ].join(' ');
  const text = labelOf(btn);
  const compact = text.replace(/\s+/g, '');
  if (TRANSLATION_RE.test(blob) || (/翻譯|原文/.test(compact) && compact.length < 16)) return 'translation';
  const inCommentary = btn.matches(LI_BODY) || !!btn.closest(LI_BODY);
  if (!inCommentary) return 'ignore';
  if (btn.getAttribute('aria-expanded') === 'true') return 'collapse';
  if (COLLAPSE_CLASS_RE.test(blob) || (compact.length <= 16 && COLLAPSE_LABEL_RE.test(compact))) return 'collapse';
  if (EXPAND_CLASS_RE.test(blob)) return 'expand';
  if (compact.length <= 24 && EXPAND_LABEL_RE.test(compact)) return 'expand';
  return 'ignore';
}

export function commentaryRoot(el: Element): HTMLElement | null {
  return (el.closest(LI_BODY) as HTMLElement) || (el.matches(LI_BODY) ? el as HTMLElement : null);
}

/** Visible commentary, without the more/less toggle or LinkedIn's own translation control. */
export function commentaryText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.ibt-block, [aria-hidden="true"], .visually-hidden, .sr-only').forEach((n) => n.remove());
  clone.querySelectorAll('button, [role="button"]').forEach((btn) => {
    if (btn === clone) return;
    const kind = controlFromElement(btn);
    if (kind === 'ignore') return;
    btn.remove();
  });
  return (clone.textContent || '').replace(/\s+/g, ' ').trim()
    .replace(/(?:…|\.\.\.|⋯)?\s*(?:see more|more|更多|查看更多|顯示更多)\s*$/i, '')
    .trim();
}

/**
 * True when this element is the post body wrapped in the see-more button.
 * A short "…更多" toggle is not commentary. Off LinkedIn this is always false,
 * so other sites keep ignoring buttons.
 */
export function isLinkedInCommentaryControl(el: HTMLElement): boolean {
  if (!linkedInHost()) return false;
  if (el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') return false;
  if (!commentaryRoot(el)) return false;
  if (controlFromElement(el) === 'translation') return false;
  return commentaryText(el).length >= 80;
}

/** True while this node's commentary is still clamped behind its more-button. */
export function linkedInCollapsed(el: HTMLElement, host = location.hostname): boolean {
  if (!linkedInHost(host)) return false;
  const box = commentaryRoot(el);
  if (!box) return false;
  const buttons = box.querySelectorAll<HTMLElement>('button, [role="button"]');
  for (const btn of buttons) {
    if (controlFromElement(btn) === 'expand') return true;
  }
  return false;
}

function postOf(node: Element): HTMLElement | null {
  return (node.closest(POST) as HTMLElement) || (node.closest(LI_BODY)?.parentElement as HTMLElement) || null;
}

function bodyOf(post: HTMLElement, from?: Element | null): HTMLElement | null {
  const near = from ? commentaryRoot(from) : null;
  if (near && post.contains(near)) return near;
  return post.querySelector<HTMLElement>(LI_BODY);
}

function linkedInOwnTranslation(scope: ParentNode): boolean {
  if (scope.querySelector(LI_TRANSLATION)) return true;
  const buttons = scope.querySelectorAll('button, [role="button"], a');
  for (const b of buttons) {
    const compact = (b.textContent || '').replace(/\s+/g, '');
    if (compact.length < 16 && /隱藏翻譯|顯示原文|Hidetranslation|Seeoriginal/i.test(compact)) return true;
  }
  return false;
}

const pending = new WeakMap<HTMLElement, number>();

export interface LiLine { anchor: Node; text: string }

/** One unit per <br> or blank line inside a LinkedIn commentary. */
export function linkedInLines(root: HTMLElement): LiLine[] {
  const items: Node[] = [];
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(n) {
      if (n.nodeType === 1) {
        const el = n as Element;
        if (el.classList.contains('ibt-block') || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
          return NodeFilter.FILTER_REJECT;
        }
        return el.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node: Node | null;
  while ((node = tw.nextNode())) items.push(node);

  const lines: LiLine[] = [];
  let buf = '';
  const flush = (anchor: Node) => {
    const text = buf.replace(/\s+/g, ' ').trim();
    buf = '';
    if (text) lines.push({ anchor, text });
  };
  for (const item of items) {
    if (item.nodeName === 'BR') {
      flush(item);
      continue;
    }
    const raw = item.nodeValue || '';
    const parts = raw.split(/\n\s*\n/);
    for (let i = 0; i < parts.length; i++) {
      buf += parts[i];
      if (i < parts.length - 1) flush(item);
    }
  }
  flush(root);
  return lines;
}

function clearLinkedInBlocks(body: HTMLElement): void {
  body.querySelectorAll('.ibt-block').forEach((n) => n.remove());
  let sib = body.nextElementSibling;
  while (sib && sib.classList.contains('ibt-block')) {
    const next = sib.nextElementSibling;
    sib.remove();
    sib = next;
  }
}

/** Auto-translate and the expand click both use this. One translation under each line. */
export function translateLinkedInCommentary(body: HTMLElement): void {
  const lines = linkedInLines(body);
  const sig = lines.map((l) => l.text).join('\n');
  if (!sig || sig.replace(/\s/g, '').length < 8) return;
  if (body.dataset.ibtLiSig === sig && (
    body.dataset.ibtLiIdle === '1'
    || !!body.querySelector('.ibt-block')
    || !!body.nextElementSibling?.classList.contains('ibt-block')
  )) return;
  clearLinkedInBlocks(body);
  delete body.dataset.ibtLiIdle;
  body.dataset.ibtLiSig = sig;
  const font = `${pageFontPx(body)}px`;
  const lang = document.documentElement.getAttribute('data-ibt-target') || 'zh-TW';
  let placed = false;
  for (const line of lines) {
    if (isAlreadyTargetLang(line.text, lang)) continue;
    const block = renderTranslationAfter(line.anchor, line.text);
    if (!block) continue;
    block.classList.add('ibt-uni');
    block.style.display = 'block';
    block.style.width = '100%';
    block.style.maxWidth = '100%';
    block.style.boxSizing = 'border-box';
    block.style.position = 'static';
    block.style.flex = '1 0 100%';
    block.style.fontSize = font;
    block.style.lineHeight = '1.5';
    placed = true;
  }
  if (!placed) body.dataset.ibtLiIdle = '1';
}

function translateBody(body: HTMLElement, why: string): void {
  const post = postOf(body) || body;
  if (linkedInOwnTranslation(post)) {
    clearLinkedInBlocks(body);
    delete body.dataset.ibtLiSig;
    console.log('[IBT] LinkedIn skip, own translation present');
    return;
  }
  console.log('[IBT] LinkedIn translate', why);
  translateLinkedInCommentary(body);
}

function clearBody(body: HTMLElement): void {
  clearLinkedInBlocks(body);
  delete body.dataset.ibtLiSig;
  delete body.dataset.ibtLiIdle;
}

function schedule(body: HTMLElement, why: string): void {
  const prev = pending.get(body);
  if (prev) clearTimeout(prev);
  // The clamp lifts on the next frame; read the full text after that.
  const timer = window.setTimeout(() => translateBody(body, why), 80);
  pending.set(body, timer);
}

function onControl(btn: HTMLElement, kind: LiControl): void {
  const post = postOf(btn);
  const body = (post && bodyOf(post, btn)) || commentaryRoot(btn);
  if (!body) {
    console.log('[IBT] LinkedIn expand, no commentary');
    return;
  }
  if (kind === 'collapse') {
    clearBody(body);
    return;
  }
  schedule(body, 'expand');
}

export function startLinkedIn(): void {
  if (!linkedInHost()) return;
  const w = window as unknown as { __ibtLiWatch?: boolean };
  if (w.__ibtLiWatch) return;
  w.__ibtLiWatch = true;
  console.log('[IBT] LinkedIn expand watcher ready', location.href);

  document.addEventListener('click', (e) => {
    const kind = controlFromElement(e.target as Element);
    if (kind !== 'expand' && kind !== 'collapse') return;
    const btn = (e.target as Element).closest('button, [role="button"]') as HTMLElement | null;
    if (!btn) return;
    console.log('[IBT] LinkedIn more clicked', kind, classNameOf(btn));
    onControl(btn, kind);
  }, true);

  const mo = new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.type === 'attributes' && r.attributeName === 'aria-expanded') {
        const el = r.target as HTMLElement;
        const kind = controlFromElement(el);
        if (kind === 'collapse' && el.getAttribute('aria-expanded') === 'true') onControl(el, 'expand');
        if (el.getAttribute('aria-expanded') === 'false' && kind === 'expand') onControl(el, 'collapse');
      }
      if (r.type === 'childList') {
        r.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          const el = n as HTMLElement;
          const post = (el.closest(POST) || (el.matches?.(POST) ? el : null)) as HTMLElement | null;
          if (post && linkedInOwnTranslation(post)) {
            const body = bodyOf(post, el);
            if (body) {
              clearBody(body);
              console.log('[IBT] LinkedIn own translation appeared, removed ours');
            }
          }
        });
      }
    }
  });
  mo.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-expanded'],
  });
}
