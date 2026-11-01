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
  /** Quota/rate-limit failure: translate the batch another way, or rethrow. */
  onBatchFallback: (items: BatchRequest[], sentences: string[][]) => Promise<AlignedPair[][]>;
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

export class LlmBatcher {
  private items: Item[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sentences = 0;
  private chars = 0;

  constructor(
    private readonly deps: BatcherDeps,
    private readonly opts: { windowMs?: number; maxSentences?: number; maxChars?: number } = {},
  ) {}

  get windowMs(): number { return this.opts.windowMs ?? 250; }
  get maxSentences(): number { return this.opts.maxSentences ?? 80; }
  get maxChars(): number { return this.opts.maxChars ?? 8000; }

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

  /** Flush immediately (also used by the timer). */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const items = this.items;
    this.items = [];
    this.sentences = 0;
    this.chars = 0;
    if (!items.length) return;
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
    try {
      // One paced request for the whole group — this is what keeps a long
      // thread under the free-tier per-minute limit.
      await this.deps.pace();
      const translations = await this.deps.run(() =>
        first.req.provider.translate!(input, first.req.settings));
      items.forEach((it, i) => {
        const slice = translations.slice(offsets[i], offsets[i] + it.sentences.length);
        it.resolve(it.sentences.map((o, k) => ({ o, t: slice[k] ?? '' })));
      });
    } catch (err) {
      if (isQuotaError(err) || isUnusableResponse(err)) {
        // Free-tier minute quota exhausted mid-thread, or the LLM returned an
        // unusable response: don't leave the rest of the page on manual retry
        // buttons — let the host finish the batch another way (free engine).
        try {
          const results = await this.deps.onBatchFallback(
            items.map((it) => it.req), items.map((it) => it.sentences));
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
