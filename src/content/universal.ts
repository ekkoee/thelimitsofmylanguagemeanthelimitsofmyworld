import { Settings } from '../core/types';
import { chineseShare, isAlreadyTargetLang, stripNoise } from '../core/segmentation';
import { renderTranslationAfter } from './engine';
import { collectUnits, isInlinePostChrome, isSeeMoreLessControl } from './blocks';
import { matchSiteRule } from './selectors';
import { linkedInCollapsed, linkedInHost } from './linkedin';

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
// mostly Chinese feed is still translated — except when the only box we can see is <main> or <body>.
// That fallback stays for GitHub and other sites. LinkedIn's Traditional Chinese shell lives in <main>
// and was making Alt+A skip every English post; LinkedIn uses the unit's own text instead (see scan).
const ARTICLE_SELECTOR = 'article, [role="article"], main, [role="main"]';
const contextCache = new WeakMap<Element, { at: number; text: string }>();

export function shellIsChinese(text: string, targetLangCode: string): boolean {
  if (!(targetLangCode || '').toLowerCase().startsWith('zh')) return false;
  const han = (stripNoise(text).match(/\p{Script=Han}/gu) || []).length;
  return han >= 12 && chineseShare(text) >= 0.5;
}

/** LinkedIn and Threads have no reliable per-post article box, so a zh-TW shell must not skip the post. */
function judgesByUnitText(host: string): boolean {
  return linkedInHost(host) || /(^|\.)threads\.(com|net)$/i.test(host);
}

/** LinkedIn and Threads judge the post text. Other sites still skip English inside a Chinese shell (GitHub included). */
export function chineseSkipReason(
  host: string, unitText: string, shellText: string, targetLangCode: string,
): '' | 'target' | 'shell' {
  if (isAlreadyTargetLang(unitText, targetLangCode)) return 'target';
  if (judgesByUnitText(host)) return '';
  if (shellIsChinese(shellText, targetLangCode)) return 'shell';
  return '';
}

function articleText(node: Element): string {
  const box = (node.closest(ARTICLE_SELECTOR) || document.body) as HTMLElement;
  const now = Date.now();
  const hit = contextCache.get(box);
  if (hit && now - hit.at < 3000) return hit.text;
  const text = (box.innerText || box.textContent || '').slice(0, 8000);
  contextCache.set(box, { at: now, text });
  return text;
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
  private seeMoreTimer?: number;
  private readonly onSeeMoreClick = (e: Event) => {
    if (!this.active) return;
    if (!/(^|\.)facebook\.com$/i.test(location.hostname)) return;
    const btn = (e.target as Element | null)?.closest?.('button, [role="button"]');
    if (!btn || !isSeeMoreLessControl(btn)) return;
    const post = (btn.closest('article, [role="article"]') as HTMLElement) || (btn.parentElement as HTMLElement);
    const run = () => {
      if (!this.active || !post?.isConnected) return;
      this.dirty.add(post);
      this.scheduleScan();
    };
    if (this.seeMoreTimer) clearTimeout(this.seeMoreTimer);
    setTimeout(run, 60);
    this.seeMoreTimer = setTimeout(run, 400) as unknown as number;
  };
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
        if (realAdded.length) {
          realAdded.forEach((n) => {
            this.dirty.add(n);
            // Threads inserts「翻譯」into an existing post. Scan the post, not just the widget.
            if (n.parentElement && isInlinePostChrome(n)) this.dirty.add(n.parentElement);
          });
          sawReal = true;
          continue;
        }
        // No new elements: a text node added/removed on a real element is an in-place
        // text change → re-evaluate that element. Pure removals / our churn → ignore.
        const textChanged = Array.from(r.addedNodes).some((n) => n.nodeType === 3)
          || Array.from(r.removedNodes).some((n) => n.nodeType === 3);
        if (textChanged && t.nodeType === 1) { this.dirty.add(t as HTMLElement); sawReal = true; }
      }
      if (sawReal) this.scheduleScan();
    });
    this.mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', this.onSeeMoreClick, true);
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.mo?.disconnect(); this.mo = undefined;
    document.removeEventListener('click', this.onSeeMoreClick, true);
    if (this.seeMoreTimer) { clearTimeout(this.seeMoreTimer); this.seeMoreTimer = undefined; }
    this.io?.disconnect(); this.io = undefined;
    if (this.rescan) { clearTimeout(this.rescan); this.rescan = undefined; }
    this.dirty.clear();
    this.blocks.forEach((b) => b.remove());
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
    let skippedShell = 0;
    let skippedCollapsed = 0;
    let candidates = 0;
    const onLinkedIn = linkedInHost();

    for (const root of this.takeRoots()) {
      if (!root.isConnected) continue;
      for (const unit of collectUnits(root)) {
        const node = unit.element;
        candidates++;
        if (node.closest('.ibt-block')) continue;        // never our own output
        if (this.excludeSel && node.closest(this.excludeSel)) continue; // per-site chrome
        if (linkedInCollapsed(node)) { skippedCollapsed++; continue; }
        const sig = fingerprint(unit.text);

        // Skip text already in the target language, and (except on LinkedIn) English
        // inside a Chinese article. LinkedIn's zh-TW chrome sits in <main>; passing
        // an empty shell here means only the post's own text can skip it.
        const reason = chineseSkipReason(
          location.hostname,
          unit.text,
          onLinkedIn ? '' : articleText(node),
          this.settings.targetLangCode,
        );
        if (reason === 'target') { skippedTarget++; continue; }
        if (reason === 'shell') { skippedShell++; continue; }

        // Locate any block we already placed for this source — by identity first,
        // then by a short forward sibling scan (survives React swapping the node).
        let existing = this.blockBySource.get(node) ?? null;
        if (existing && !existing.isConnected) { this.blocks.delete(existing); existing = null; }
        if (!existing) existing = this.findAdjacentBlock(node);

        if (existing) {
          if (existing.dataset.ibtSig === sig) {        // already translated, unchanged
            this.blockBySource.set(node, existing);
            this.processed.add(node); this.fp.set(node, sig);
            continue;
          }
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

        // On LinkedIn, translate a post already on screen now. Waiting for
        // IntersectionObserver hid the request when the feed's scroll root
        // never notified us. Below-the-fold posts still wait for a scroll.
        const rect = node.getBoundingClientRect();
        const inView = rect.bottom > 0 && rect.top < (window.innerHeight || 800) + 200 && rect.height >= 8;
        if (this.settings.translateOnVisible && !(onLinkedIn && inView)) {
          if (onLinkedIn) console.log('[IBT] queued for view', unit.text.slice(0, 60));
          this.ensureIO().observe(node);
        } else this.render(node);
      }
    }

    if (!this.firstScanReported) {
      this.firstScanReported = true;
      console.log('[IBT] scan done', { candidates, rendered, skippedTarget, skippedShell, skippedCollapsed, host: location.hostname });
      if (!rendered && skippedCollapsed > 0 && !skippedTarget && !skippedShell) toast('貼文還摺著，點「更多」後會翻譯這則');
      else if (!rendered && (skippedTarget > 0 || skippedShell > 0) && !skippedCollapsed) toast('這頁看起來已經是中文，不需要翻譯');
    }
  }

  // First .ibt-block sitting just after `node`, tolerating a few framework-injected
  // siblings (engagement bars, spacers) between the source and our block.
  private findAdjacentBlock(node: HTMLElement): HTMLElement | null {
    let sib = node.nextElementSibling as HTMLElement | null;
    for (let hops = 0; sib && hops < 4; hops++) {
      if (sib.classList.contains('ibt-block') && sib.dataset.ibtOut === '1') return sib;
      sib = sib.nextElementSibling as HTMLElement | null;
    }
    return null;
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
    if (old) { old.remove(); this.blocks.delete(old); }
    const text = (node as any).__ibtText || (node.textContent || '').replace(/\s+/g, ' ').trim();
    const sig = (node as any).__ibtSig || fingerprint(text);
    console.log('[IBT] request sent', text.slice(0, 80));
    const block = renderTranslationAfter(node, text, { sig });
    if (block) {
      block.classList.add('ibt-uni');
      const srcFs = parseFloat(getComputedStyle(node).fontSize) || 14;
      const dense = isDenseRow(node);
      // Inherit the block's size. Dense rows (a PR title) scale down slightly so
      // the line fits under the title instead of blowing the row open.
      const px = dense ? Math.max(11, Math.round(srcFs * 0.85)) : Math.max(12, Math.round(srcFs));
      block.style.fontSize = `${px}px`;
      block.style.maxWidth = '100%';
      if (dense) {
        block.classList.add('ibt-fit');
        // Keep the line inside the title's own box (the row), not as a flex sibling.
        if (node.tagName === 'A' || /^H[1-6]$/.test(node.tagName)) node.appendChild(block);
      }
      this.blocks.add(block);
      this.blockBySource.set(node, block);
    }
  }
}

function isDenseRow(node: HTMLElement): boolean {
  if (/^(P|LI|BLOCKQUOTE|PRE|FIGCAPTION)$/.test(node.tagName)) return false;
  if (node.matches('a, .markdown-title, .js-issue-title, .commit-title, .gh-header-title')) return true;
  const fs = parseFloat(getComputedStyle(node).fontSize) || 16;
  const h = node.getBoundingClientRect().height;
  return h > 0 && h < fs * 2.4;
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
