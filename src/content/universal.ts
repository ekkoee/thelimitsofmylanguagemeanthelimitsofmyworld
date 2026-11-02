import { Settings } from '../core/types';
import { chineseShare, isAlreadyTargetLang, stripNoise } from '../core/segmentation';
import { renderTranslationAfter } from './engine';
import { collectUnits } from './blocks';
import { matchSiteRule } from './selectors';
import { findPlacedBlock, unanchor } from './place';
import { ensureIbtCss } from './page-css';

const UNI_ATTR = 'data-ibt-uni'; // cheap hint we've handled a source (teardown aid)

// Content fingerprint: a node whose text is unchanged isn't re-translated; a node
// whose text changed (recycled/virtualized, or edited in place) IS — and its stale
// block is removed first (see render()).
function fingerprint(text: string): string {
  const s = text.trim();
  return `${s.length}|${s.slice(0, 24)}|${s.slice(-12)}`;
}

// Is this passage part of a Chinese article / post / page? English words, names and headings inside Chinese
// writing are left alone. Decided per article (a feed post is a [role="article"]), so an English post in a
// mostly Chinese feed is still translated.
const ARTICLE_SELECTOR = 'article, [role="article"], main, [role="main"]';
const contextCache = new WeakMap<Element, { at: number; cn: boolean }>();
function inChineseContext(node: Element, targetLangCode: string): boolean {
  if (!(targetLangCode || '').toLowerCase().startsWith('zh')) return false;
  const box = node.closest(ARTICLE_SELECTOR) || document.body;
  const now = Date.now();
  const hit = contextCache.get(box);
  if (hit && now - hit.at < 3000) return hit.cn;
  const text = ((box as HTMLElement).innerText || box.textContent || '').slice(0, 8000);
  const han = (stripNoise(text).match(/\p{Script=Han}/gu) || []).length;
  const cn = han >= 12 && chineseShare(text) >= 0.5;
  contextCache.set(box, { at: now, cn });
  return cn;
}

// Is this one of OUR inserted nodes? Keeps the MutationObserver from reacting to its
// own block insertions / loading→filled transitions (which would loop).
function isOwnNode(n: Node): boolean {
  return n.nodeType === 1 &&
    (((n as Element).classList?.contains('ibt-block')) || (n as HTMLElement).dataset?.ibtOut === '1');
}

export class UniversalTranslator {
  private active = false;
  private io?: IntersectionObserver;
  private mo?: MutationObserver;
  private rescan?: number;
  private firstScanReported = false;
  private readonly blocks = new Set<HTMLElement>();       // inserted translation blocks
  private readonly sources = new Set<HTMLElement>();      // source elements we marked
  private readonly dirty = new Set<HTMLElement>();        // subtrees changed since last scan
  // Idempotency that survives SPA churn: blockBySource maps a source to the block we
  // placed for it (so we can remove a STALE one when its text changes); processed/fp
  // are a fast identity+content guard; and a forward sibling scan catches a node React
  // REPLACED (new identity, our block still nearby).
  private blockBySource = new WeakMap<HTMLElement, HTMLElement>();
  private processed = new WeakSet<HTMLElement>();
  private fp = new WeakMap<HTMLElement, string>();
  // Optional per-site exclude (chrome only) — generic detection still does the work.
  private readonly excludeSel = matchSiteRule(location.hostname)?.exclude || '';
  private settings: Settings;

  constructor(getSettings: () => Settings) { this.settings = getSettings(); }
  setSettings(s: Settings): void {
    this.settings = s;
    if (this.active && !s.enabled) this.deactivate();
  }

  isActive(): boolean { return this.active; }

  toggle(): boolean { this.active ? this.deactivate() : this.activate(); return this.active; }

  activate(): void {
    if (this.active) return;
    this.active = true;
    ensureIbtCss();
    toast('整頁雙語已開啟（再按 Alt+A 關閉）'); // immediate feedback — scan() can
    this.scan(); // initial full pass (dirty empty → whole document.body)      // take a moment on heavy pages
    this.mo = new MutationObserver((records) => {
      let sawReal = false;
      for (const r of records) {
        const t = r.target;
        // Ignore anything happening inside our own output (loading→filled, retry, …).
        if (t.nodeType === 1 && (t as Element).closest?.('.ibt-block,[data-ibt-out="1"]')) continue;
        // New element subtree(s) → scan exactly those, so a feed append costs the size
        // of the new post, not the whole (and growing) document.
        const realAdded = Array.from(r.addedNodes).filter((n) => n.nodeType === 1 && !isOwnNode(n)) as HTMLElement[];
        if (realAdded.length) { realAdded.forEach((n) => this.dirty.add(n)); sawReal = true; continue; }
        // No new elements: a text node added/removed on a real element is an in-place
        // text change → re-evaluate that element. Pure removals / our churn → ignore.
        const textChanged = Array.from(r.addedNodes).some((n) => n.nodeType === 3)
          || Array.from(r.removedNodes).some((n) => n.nodeType === 3);
        if (textChanged && t.nodeType === 1) { this.dirty.add(t as HTMLElement); sawReal = true; }
      }
      if (sawReal) this.scheduleScan();
    });
    this.mo.observe(document.body, { childList: true, subtree: true });
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.mo?.disconnect(); this.mo = undefined;
    this.io?.disconnect(); this.io = undefined;
    if (this.rescan) { clearTimeout(this.rescan); this.rescan = undefined; }
    this.dirty.clear();
    this.blocks.forEach((b) => { unanchor(b); b.remove(); });
    this.blocks.clear();
    this.sources.forEach((s) => s.removeAttribute(UNI_ATTR));
    this.sources.clear();
    // Weak collections can't be .clear()'d — replace them so a later re-activate
    // (Alt+A off→on) starts clean and re-translates instead of treating nodes as
    // still-processed.
    this.blockBySource = new WeakMap();
    this.processed = new WeakSet();
    this.fp = new WeakMap();
    this.firstScanReported = false;
    toast('整頁雙語已關閉');
  }

  private scheduleScan(): void {
    if (!this.active) return;
    if (this.rescan) clearTimeout(this.rescan);
    this.rescan = setTimeout(() => this.scan(), 500) as unknown as number;
  }

  // The subtrees to (re)scan: the whole body on the first pass, otherwise only the
  // minimal set of changed roots (drop any contained by another).
  private takeRoots(): HTMLElement[] {
    if (!this.dirty.size) return [document.body];
    let roots = Array.from(this.dirty).filter((el) => el.isConnected);
    this.dirty.clear();
    if (!roots.length) return [];
    if (roots.length > 64) return [document.body]; // too churny → one bounded full pass
    roots = roots.filter((r) => !roots.some((o) => o !== r && o.contains(r)));
    return roots;
  }

  private scan(): void {
    if (!this.active || !this.settings.enabled) return;
    let rendered = 0;
    let skippedTarget = 0;

    for (const root of this.takeRoots()) {
      if (!root.isConnected) continue;
      for (const unit of collectUnits(root)) {
        const node = unit.element;
        if (node.closest('.ibt-block')) continue;        // never our own output
        if (this.excludeSel && node.closest(this.excludeSel)) continue; // per-site chrome
        const sig = fingerprint(unit.text);

        // Skip text already in the target language (e.g. Chinese on a zh page),
        // and anything inside a Chinese article/post (English headings/names there stay as-is).
        if (isAlreadyTargetLang(unit.text, this.settings.targetLangCode) || inChineseContext(node, this.settings.targetLangCode)) { skippedTarget++; continue; }

        // Locate any block we already placed for this source — by identity first,
        // then by a short forward sibling scan (survives React swapping the node).
        let existing = this.blockBySource.get(node) ?? null;
        if (existing && !existing.isConnected) { unanchor(existing); this.blocks.delete(existing); existing = null; }
        if (!existing) existing = findPlacedBlock(node);

        if (existing) {
          if (existing.dataset.ibtSig === sig) {        // already translated, unchanged
            this.blockBySource.set(node, existing);
            this.processed.add(node); this.fp.set(node, sig);
            continue;
          }
          unanchor(existing);
          existing.remove();                            // text changed → drop the stale block
          this.blocks.delete(existing);
          this.blockBySource.delete(node);
        } else if (this.processed.has(node) && this.fp.get(node) === sig) {
          continue;                                     // pending (translateOnVisible), unchanged
        }

        this.processed.add(node);
        this.fp.set(node, sig);
        this.sources.add(node);
        node.setAttribute(UNI_ATTR, '1');
        (node as any).__ibtText = unit.text;
        (node as any).__ibtSig = sig;
        rendered++;

        if (this.settings.translateOnVisible) this.ensureIO().observe(node);
        else this.render(node);
      }
    }

    if (!this.firstScanReported) {
      this.firstScanReported = true;
      if (!rendered && skippedTarget > 0) toast('這頁看起來已經是中文，不需要翻譯');
    }
  }

  private ensureIO(): IntersectionObserver {
    if (this.io) return this.io;
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const src = e.target as HTMLElement;
        this.io!.unobserve(src);
        this.render(src);
      }
    }, { rootMargin: '400px' });
    return this.io;
  }

  private render(node: HTMLElement): void {
    // Drop any prior block for this source before inserting (handles a re-render
    // whose text changed — no stale block left behind, no DOM leak).
    const old = this.blockBySource.get(node);
    if (old) { unanchor(old); old.remove(); this.blocks.delete(old); }
    const text = (node as any).__ibtText || (node.textContent || '').replace(/\s+/g, ' ').trim();
    const sig = (node as any).__ibtSig || fingerprint(text);
    const block = renderTranslationAfter(node, text, { sig, adaptive: true });
    if (block) {
      block.classList.add('ibt-uni');
      // Match the translation's size to the source element, so a big <h1> heading's
      // translation reads as a heading, not tiny body text (the block is a sibling, so
      // it can't inherit the heading's font-size on its own). Only ever grow: never
      // shrink below the default body size — a leaf block's computed font-size can be
      // smaller than the visible text (e.g. X's last-paragraph wrapper), which made
      // translations render tiny. Inline !important so a host `div { font-size:0 }`
      // can't squash the line.
      const srcFs = parseFloat(getComputedStyle(node).fontSize) || 0;
      const bodyFs = parseFloat(getComputedStyle(document.body).fontSize) || 16;
      const size = srcFs > bodyFs * 1.05
        ? `calc(${getComputedStyle(node).fontSize} * var(--ibt-font-scale, 1))`
        : 'calc(0.98rem * var(--ibt-font-scale, 1))';
      if (srcFs > bodyFs * 1.05) block.style.setProperty('--ibt-src-fs', getComputedStyle(node).fontSize);
      block.style.setProperty('font-size', size, 'important');
      this.blocks.add(block);
      this.blockBySource.set(node, block);
    }
  }
}

// --- tiny transient toast (bottom-center) ---
let toastEl: HTMLDivElement | null = null;
let toastTimer: number | undefined;
export function toast(msg: string): void {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'ibt-toast'; }
  toastEl.textContent = msg;
  if (!toastEl.isConnected) document.documentElement.appendChild(toastEl);
  toastEl.classList.add('ibt-toast-show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl?.classList.remove('ibt-toast-show'); }, 1800) as unknown as number;
}
