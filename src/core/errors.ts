/** Short Chinese for the page. The raw API body stays in the console. */

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
  if (/[\u4e00-\u9fff]/.test(msg) && !/[{"]/.test(msg) && msg.length < 160) return msg;
  if (/IMAGE_ECHO/.test(msg)) return '無法把圖片裡的文字翻成中文，請再試一次';
  if (/NO_API_KEY:image/i.test(msg) || (kind === 'image' && /NO_API_KEY/i.test(msg))) {
    return '右鍵圖片翻譯需要 Gemini 金鑰。請到選項頁填入。';
  }
  if (/NO_API_KEY/i.test(msg)) {
    return '此引擎需要 API key — 點擊擴充功能圖示 → 選項頁填入（或切回免費引擎）。';
  }
  if (/api[_ ]?key|API_KEY_INVALID|unregistered|permission denied/i.test(msg) && /\b(400|401|403)\b/.test(msg)) {
    return 'Gemini 金鑰無效';
  }
  if (kind === 'image' && /\b401\b/.test(msg)) return 'Gemini 金鑰無效';
  if (/timeout|timed out|abort|逾時/i.test(msg)) {
    const model = /（([^）]+)）/.exec(msg)?.[1] || /model=([\w.\-]+)/.exec(msg)?.[1] || '';
    return model ? `Gemini 回應逾時（${model}）` : 'Gemini 回應逾時';
  }
  if (/failed to fetch|networkerror|network request failed|econn|enotfound|連不到/i.test(msg)) {
    return '連不到 Gemini，請檢查網路';
  }
  if (/\b429\b|quota|rate.?limit|resource.exhausted|too many requests/i.test(msg)) {
    const parsed = parseQuotaFailure(msg, '');
    if (parsed?.perDay || /PerDay/i.test(msg)) return allExhaustedMessage(nextPacificMidnight(Date.now()));
    const wait = parsed?.retrySec || retrySeconds(msg) || 1;
    return `請求太頻繁，${wait} 秒後自動重試`;
  }
  if (/\b(500|502|503|504)\b/.test(msg)) return 'Gemini 服務暫時錯誤';
  return kind === 'image' ? 'Gemini 沒有回傳圖片譯文' : 'Gemini 沒有回傳譯文';
}
