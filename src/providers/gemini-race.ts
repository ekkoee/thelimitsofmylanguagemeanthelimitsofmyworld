// Hedged Gemini call. The user's model (often gemini-3.5-flash) is sent
// immediately. If it has not answered within delayMs, the same batch is also
// sent to a fast model. Whichever succeeds first is shown. When the fast
// model was shown and the primary later succeeds, `upgrade` resolves with
// the primary text so the UI can swap in place.
//
// The fast result must not be cached as the primary. Callers cache only
// when `cache` is true, or when `upgrade` resolves with text.

export interface RaceOutcome {
  texts: string[];
  winner: 'primary' | 'hedge';
  hedgeSent: boolean;
  /** True when the primary failed with 400/404 and should not be tried again. */
  primaryDead: boolean;
  /** False when the texts are the hedge and must not be stored as the primary. */
  cache: boolean;
  /** Primary texts if they arrive after a hedge was shown; null if primary fails. */
  upgrade: Promise<string[] | null>;
}

export function isPrimaryFatal(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message ?? err);
  return /\bGemini (400|404)\b/.test(msg);
}

export function isBothFailed(err: unknown): boolean {
  return /Gemini both failed/i.test(String((err as { message?: unknown })?.message ?? err));
}

export const DEFAULT_HEDGE_MODEL = 'gemini-2.5-flash-lite';
export const DEFAULT_HEDGE_DELAY_MS = 1500;

export function hedgeRace(opts: {
  delayMs: number;
  primaryModel: string;
  hedgeModel: string;
  primary: () => Promise<string[]>;
  hedge: () => Promise<string[]>;
  log?: (line: string) => void;
}): Promise<RaceOutcome> {
  const log = opts.log ?? (() => {});
  const t0 = Date.now();
  let hedgeSent = false;
  let hedgeStart = 0;
  let primaryMs: number | null = null;
  let hedgeMs: number | null = null;
  let primaryTexts: string[] | null = null;
  let primaryErr: unknown = null;
  let hedgeTexts: string[] | null = null;
  let hedgeErr: unknown = null;
  let hedgePromise: Promise<void> | null = null;
  let done = false;
  let shownAt = 0;
  let winner: 'primary' | 'hedge' = 'primary';

  const line = (tail: '' | ' upgraded' | ' upgrade-failed'): string => {
    const p = primaryMs == null ? 'pending' : `${primaryMs}ms`;
    const h = !hedgeSent ? 'not-sent' : (hedgeMs == null ? 'pending' : `${opts.hedgeModel} ${hedgeMs}ms`);
    const hedgePart = hedgeSent ? h : 'not-sent';
    return `[IBT] race primary=${opts.primaryModel} ${p} hedge=${hedgePart} shown=${winner}@${shownAt}ms${tail}`;
  };

  return new Promise((resolve, reject) => {
    const finish = (w: 'primary' | 'hedge', texts: string[], upgrade: Promise<string[] | null>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      winner = w;
      shownAt = Date.now() - t0;
      if (w === 'primary') log(line(''));
      else if (upgrade === noUpgrade) log(line(''));
      else log(line('')); // provisional; upgrade promise logs the final line
      resolve({
        texts,
        winner: w,
        hedgeSent,
        primaryDead: !!primaryErr && isPrimaryFatal(primaryErr),
        cache: w === 'primary',
        upgrade,
      });
    };

    const noUpgrade = Promise.resolve(null);

    const consider = () => {
      if (done) return;
      if (primaryTexts) {
        finish('primary', primaryTexts, noUpgrade);
        return;
      }
      if (hedgeTexts && primaryErr) {
        finish('hedge', hedgeTexts, noUpgrade);
        return;
      }
      if (hedgeTexts && !primaryErr) {
        const at = Date.now() - t0;
        const upgrade = new Promise<string[] | null>((res) => {
          const settle = () => {
            if (primaryTexts) {
              primaryMs = primaryMs ?? (Date.now() - t0);
              shownAt = at;
              winner = 'hedge';
              log(line(' upgraded'));
              res(primaryTexts);
            } else if (primaryErr) {
              shownAt = at;
              winner = 'hedge';
              log(line(' upgrade-failed'));
              res(null);
            }
          };
          primarySettled.then(settle, settle);
        });
        finish('hedge', hedgeTexts, upgrade);
        return;
      }
      if (primaryErr && hedgeErr) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const why = String((primaryErr as { message?: unknown })?.message ?? primaryErr);
        reject(new Error(`Gemini both failed: ${why}`));
      }
    };

    const startHedge = () => {
      if (hedgePromise || done) return;
      hedgeSent = true;
      hedgeStart = Date.now();
      hedgePromise = opts.hedge().then(
        (texts) => { hedgeTexts = texts; hedgeMs = Date.now() - hedgeStart; },
        (err) => { hedgeErr = err; hedgeMs = Date.now() - hedgeStart; },
      ).then(consider, consider);
    };

    const primarySettled = opts.primary().then(
      (texts) => { primaryTexts = texts; primaryMs = Date.now() - t0; },
      (err) => { primaryErr = err; primaryMs = Date.now() - t0; },
    ).then(() => {
      if (primaryErr) startHedge();
      consider();
    });

    const timer = setTimeout(() => {
      if (!done && !primaryTexts && !primaryErr) startHedge();
    }, Math.max(0, opts.delayMs));
  });
}
