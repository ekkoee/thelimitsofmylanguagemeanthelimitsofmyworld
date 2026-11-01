/** Short text for the page. The raw API body stays in the console. */

import { t } from './i18n';
import { allExhaustedMessage, nextPacificMidnight, parseQuotaFailure } from './quota-router';

export function retrySeconds(message: string): number | null {
  const msg = message || '';
  const delay = /retryDelay["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)\s*s/i.exec(msg)
    || /retry in ([\d.]+)\s*s/i.exec(msg)
    || /retry=(\d+)/i.exec(msg);
  if (!delay) return null;
  const n = Math.ceil(Number(delay[1]));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function friendlyTranslateError(err: unknown, kind: 'page' | 'image' = 'page'): string {
  const msg = String((err as { message?: unknown })?.message ?? err ?? '');
  console.log('[IBT] error', kind, msg.slice(0, 500));
  const raw = /[{"]|\b(429|401|403|400|500|502|503|504)\b|NO_API_KEY|API_KEY|IMAGE_ECHO|timeout|timed out|abort|failed to fetch|networkerror|quota|rate.?limit|resource.exhausted|too many requests/i.test(msg);
  if (!raw && msg.length > 0 && msg.length < 220) return msg;
  if (/IMAGE_ECHO/.test(msg)) return t('imageFailed');
  if (/NO_API_KEY:image/i.test(msg) || (kind === 'image' && /NO_API_KEY/i.test(msg))) return t('imageNeedsKey');
  if (/NO_API_KEY/i.test(msg)) return t('needsKey');
  if (/api[_ ]?key|API_KEY_INVALID|unregistered|permission denied/i.test(msg) && /\b(400|401|403)\b/.test(msg)) {
    return t('geminiInvalid');
  }
  if (kind === 'image' && /\b401\b/.test(msg)) return t('geminiInvalid');
  if (/timeout|timed out|abort|逾時/i.test(msg)) {
    const model = /（([^）]+)）/.exec(msg)?.[1] || /model=([\w.\-]+)/.exec(msg)?.[1] || '';
    return model ? t('geminiTimeoutModel', { model }) : t('geminiTimeout');
  }
  if (/failed to fetch|networkerror|network request failed|econn|enotfound|連不到/i.test(msg)) return t('geminiNetwork');
  if (/\b(Google|Microsoft)\b/.test(msg) && /\b(429|403)\b/.test(msg)) return t('freeBusy');
  if (/\b429\b|quota|rate.?limit|resource.exhausted|too many requests/i.test(msg)) {
    const parsed = parseQuotaFailure(msg, '');
    if (parsed?.perDay || /PerDay/i.test(msg)) return allExhaustedMessage(nextPacificMidnight(Date.now()));
    const wait = parsed?.retrySec || retrySeconds(msg) || 1;
    return t('rateLimit', { sec: wait });
  }
  if (/\b(500|502|503|504)\b/.test(msg)) return t('geminiServer');
  return kind === 'image' ? t('geminiNoImage') : t('geminiNoText');
}
