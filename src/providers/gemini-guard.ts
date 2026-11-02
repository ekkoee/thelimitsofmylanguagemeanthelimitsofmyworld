// Soft deadline for one Gemini text request. A slow or dead call is abandoned
// so the caller can translate that same batch with the free engine. The aborted
// fetch is never read: a late body cannot win the race.

export const GEMINI_SOFT_TIMEOUT_MS = 8000;
export const GEMINI_TIMEOUT_STREAK = 3;
export const GEMINI_COOLDOWN_MS = 60_000;

export type GeminiFallbackReason = 'timeout' | 'cooldown' | 'http' | 'network';

export class GeminiFallbackError extends Error {
  readonly reason: GeminiFallbackReason;
  constructor(reason: GeminiFallbackReason, message?: string) {
    super(message || reason);
    this.name = 'GeminiFallbackError';
    this.reason = reason;
  }
}

export function isGeminiFallbackError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'GeminiFallbackError';
}

export interface GeminiGuardOptions {
  timeoutMs?: number;
  streak?: number;
  cooldownMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}

export function createGeminiGuard(opts: GeminiGuardOptions = {}) {
  const timeoutMs = opts.timeoutMs ?? GEMINI_SOFT_TIMEOUT_MS;
  const streakLimit = opts.streak ?? GEMINI_TIMEOUT_STREAK;
  const cooldownMs = opts.cooldownMs ?? GEMINI_COOLDOWN_MS;
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? ((line: string) => console.warn(line));
  let streak = 0;
  let coolUntil = 0;

  function noteTimeout(): void {
    streak += 1;
    log(`[IBT] gemini timeout ${timeoutMs}ms → google`);
    if (streak >= streakLimit) {
      streak = 0;
      coolUntil = now() + cooldownMs;
      log(`[IBT] gemini cooldown ${cooldownMs}ms → google`);
    }
  }

  function noteSuccess(): void {
    streak = 0;
  }

  async function run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (now() < coolUntil) {
      log('[IBT] gemini cooldown → google');
      throw new GeminiFallbackError('cooldown');
    }
    const ctrl = new AbortController();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        ctrl.abort();
        noteTimeout();
        reject(new GeminiFallbackError('timeout'));
      }, timeoutMs);
    });
    // After the deadline, a late resolve or abort rejection must not surface
    // and must not be returned as the translation.
    const work = task(ctrl.signal).then(
      (value) => (settled ? new Promise<T>(() => {}) : value),
      (err) => (settled ? new Promise<T>(() => {}) : Promise.reject(err)),
    );
    try {
      const value = await Promise.race([work, timeout]);
      if (settled) throw new GeminiFallbackError('timeout');
      settled = true;
      noteSuccess();
      return value;
    } catch (err) {
      settled = true;
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    run,
    noteSuccess,
    reset(): void {
      streak = 0;
      coolUntil = 0;
    },
  };
}

export const geminiGuard = createGeminiGuard();
