// Coalescing batcher for metered LLM translation requests.
//
// A long X thread fires one `translate` message per tweet in a burst. Without
// batching, each becomes its own LLM request: with per-minute caps on free
// keys that's both slow (paced apart) and quota-hungry (429 halfway down).
// This gathers requests arriving within a short window and serves them with
// as few provider.translate calls as possible, then fans the aligned results
// back out to each caller.
//
// Side effects (pacing, queueing, quota fallback) are injected so the
// mechanics stay unit-testable without chrome APIs.
import { segment } from './segmentation';
import { AlignedPair, Settings } from './types';
import { TranslateInput, TranslationProvider } from '../providers/base';

export interface BatchRequest {
  text: string;
  settings: Settings;
  provider: TranslationProvider;
  mode: 'prose' | 'subtitle';
  pageTitle?: string;
  /** On-screen text ships in a tiny first request. Below-the-fold waits for that. */
  priority?: 'visible' | 'near';
}

interface Item {
  key: string;
  text: string;
  sentences: string[];
  req: BatchRequest;
  resolve: (pairs: AlignedPair[]) => void;
  reject: (err: unknown) => void;
}

export interface BatcherDeps {
  /** Space LLM request starts (free-tier RPM protection). */
  pace: () => Promise<void>;
  /** Run the provider call through the concurrency queue. */
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Quota, unusable output, or timeout: translate the batch another way, or rethrow.
   *  `timeout` should not tighten the pacing penalty — the model was slow, not rate-limited. */
  onBatchFallback: (items: BatchRequest[], sentences: string[][], reason: 'quota' | 'unusable' | 'timeout') => Promise<AlignedPair[][]>;
}

export function isQuotaError(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message ?? err);
  return /\b(403|429)\b/.test(msg) || /quota|rate.?limit|resource.exhausted|too many requests/i.test(msg);
}

// The LLM returned something we can't use (malformed JSON, safety block with no
// usable text, …). Like a quota error, the user shouldn't get a manual retry
// button for this — the free engine can finish the batch.
export function isUnusableResponse(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message ?? err);
  return /could not parse translations|empty response|no translations returned/i.test(msg);
}

/** Our own abort (Gemini timeout). A generic "network timeout" is NOT this —
 *  only the explicit error the Gemini provider throws when its deadline fires. */
export function isTimeoutError(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message ?? err);
  return /^Gemini timeout\b/.test(msg);
}

export class LlmBatcher {
  private items: Item[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sentences = 0;
  private chars = 0;
  /** The next flush is the first of a burst: keep it tiny so the first tweet paints fast. */
  private cold = true;
  private coldTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly deps: BatcherDeps,
    private readonly opts: {
      windowMs?: number; maxSentences?: number; maxChars?: number;
      firstSentences?: number; firstChars?: number;
    } = {},
  ) {}

  get windowMs(): number { return this.opts.windowMs ?? 250; }
  get maxSentences(): number { return this.opts.maxSentences ?? 80; }
  get maxChars(): number { return this.opts.maxChars ?? 8000; }
  get firstSentences(): number { return this.opts.firstSentences ?? 2; }
  get firstChars(): number { return this.opts.firstChars ?? 380; }

  /** For tests: how many requests are currently waiting to be flushed. */
  get pending(): number { return this.items.length; }

  submit(req: BatchRequest): Promise<AlignedPair[]> {
    const sentences = segment(req.text, req.settings.sourceLang);
    if (!sentences.length) return Promise.resolve([]);
    if (!req.provider.translate) {
      return Promise.reject(new Error('provider has no translate capability'));
    }
    // Items with different prompts (mode/title/langs/model) can't share a request.
    const key = [
      req.provider.id, req.settings.model || '', req.settings.targetLang,
      req.settings.sourceLang || 'auto', req.mode, req.pageTitle || '',
    ].join('|');
    return new Promise<AlignedPair[]>((resolve, reject) => {
      this.items.push({ key, text: req.text, sentences, req, resolve, reject });
      this.sentences += sentences.length;
      this.chars += req.text.length;
      if (this.sentences >= this.maxSentences || this.chars >= this.maxChars) {
        void this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => void this.flush(), this.windowMs);
      }
    });
  }

  /** On-screen items only, and only enough for one short request. */
  private splitFirst(items: Item[]): { ship: Item[]; hold: Item[] } {
    const visible = items.filter((it) => it.req.priority !== 'near');
    const near = items.filter((it) => it.req.priority === 'near');
    const pool = visible.length ? visible : items;
    const aside = visible.length ? near : [];
    const ship: Item[] = [];
    const hold: Item[] = [];
    let s = 0;
    let c = 0;
    for (const it of pool) {
      const ns = s + it.sentences.length;
      const nc = c + it.text.length;
      if (ship.length && (ns > this.firstSentences || nc > this.firstChars)) hold.push(it);
      else { ship.push(it); s = ns; c = nc; }
    }
    return { ship, hold: [...hold, ...aside] };
  }

  private capItems(items: Item[]): { ship: Item[]; hold: Item[] } {
    const ship: Item[] = [];
    const hold: Item[] = [];
    let s = 0;
    let c = 0;
    for (const it of items) {
      const ns = s + it.sentences.length;
      const nc = c + it.text.length;
      if (ship.length && (ns > this.maxSentences || nc > this.maxChars)) hold.push(it);
      else { ship.push(it); s = ns; c = nc; }
    }
    return { ship, hold };
  }

  private requeue(items: Item[], delayMs: number): void {
    for (const it of items) {
      this.items.push(it);
      this.sentences += it.sentences.length;
      this.chars += it.text.length;
    }
    if (!this.items.length || this.timer) return;
    this.timer = setTimeout(() => void this.flush(), delayMs);
  }

  private markHot(): void {
    this.cold = false;
    if (this.coldTimer) clearTimeout(this.coldTimer);
    const t = setTimeout(() => { this.cold = true; this.coldTimer = null; }, 1500);
    this.coldTimer = t;
    const handle = t as unknown as { unref?: () => void };
    if (typeof handle.unref === 'function') handle.unref();
  }

  /** Flush immediately (also used by the timer). */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    let items = this.items;
    this.items = [];
    this.sentences = 0;
    this.chars = 0;
    if (!items.length) return;
    let kind: 'first' | 'next' = 'next';
    if (this.cold) {
      const split = this.splitFirst(items);
      kind = 'first';
      this.markHot();
      items = split.ship;
      this.requeue(split.hold, 0);
    } else {
      const capped = this.capItems(items);
      items = capped.ship;
      this.requeue(capped.hold, 0);
    }
    if (!items.length) return;
    const sentences = items.reduce((n, it) => n + it.sentences.length, 0);
    console.log(`[IBT] llm batch ${kind} items=${items.length} sentences=${sentences}`);
    const groups = new Map<string, Item[]>();
    for (const it of items) {
      const g = groups.get(it.key);
      if (g) g.push(it); else groups.set(it.key, [it]);
    }
    await Promise.all([...groups.values()].map((g) => this.runGroup(g)));
  }

  private async runGroup(items: Item[]): Promise<void> {
    const first = items[0];
    const offsets: number[] = [];
    const all: string[] = [];
    for (const it of items) {
      offsets.push(all.length);
      all.push(...it.sentences);
    }
    const input: TranslateInput = {
      sentences: all,
      targetLang: first.req.settings.targetLang,
      sourceLang: first.req.settings.sourceLang,
      mode: first.req.mode,
      pageTitle: first.req.pageTitle,
    };
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      // One paced request for the whole group — this is what keeps a long
      // thread under the free-tier per-minute limit. The queue still runs
      // several of these at once; pacing only spaces the starts.
      await this.deps.pace();
      const translations = await this.deps.run(() =>
        first.req.provider.translate!(input, first.req.settings));
      const dt = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
      console.log(`[IBT] llm batch done ${dt}ms sentences=${all.length}`);
      items.forEach((it, i) => {
        const slice = translations.slice(offsets[i], offsets[i] + it.sentences.length);
        it.resolve(it.sentences.map((o, k) => ({ o, t: slice[k] ?? '' })));
      });
    } catch (err) {
      if (isQuotaError(err) || isUnusableResponse(err) || isTimeoutError(err)) {
        // Free-tier minute quota exhausted mid-thread, the LLM returned an
        // unusable response, or Gemini blew its deadline: don't leave the rest
        // of the page on manual retry buttons — let the host finish the batch
        // another way (free engine).
        const reason = isTimeoutError(err) ? 'timeout' : isQuotaError(err) ? 'quota' : 'unusable';
        try {
          const results = await this.deps.onBatchFallback(
            items.map((it) => it.req), items.map((it) => it.sentences), reason);
          items.forEach((it, i) => it.resolve(results[i] ?? []));
        } catch (fallbackErr) {
          for (const it of items) it.reject(fallbackErr);
        }
        return;
      }
      for (const it of items) it.reject(err);
    }
  }
}
