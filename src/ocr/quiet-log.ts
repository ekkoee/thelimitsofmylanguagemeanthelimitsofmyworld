// Tesseract prints progress to stderr. Chrome lists that on the extension
// errors page. These lines are not failures.

const TESS_NOISE = /Estimating resolution|Detected \d+ diacritics|Invalid resolution/i;

export function isTessNoise(value: unknown): boolean {
  const text = Array.isArray(value)
    ? value.map((part) => String((part as { message?: unknown })?.message ?? part)).join(' ')
    : String((value as { message?: unknown })?.message ?? value ?? '');
  return TESS_NOISE.test(text);
}

type ConsoleMethod = 'error' | 'warn' | 'log';

/** Drop known Tesseract chatter. Real errors still go to the original method. */
export function hushTessConsole(target: Console = console): void {
  const flag = target as Console & { __ibtTessHushed?: boolean };
  if (flag.__ibtTessHushed) return;
  flag.__ibtTessHushed = true;
  for (const name of ['error', 'warn', 'log'] as ConsoleMethod[]) {
    const orig = target[name].bind(target);
    target[name] = ((...args: unknown[]) => {
      if (isTessNoise(args)) return;
      orig(...args);
    }) as Console[typeof name];
  }
}
