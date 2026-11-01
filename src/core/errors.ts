/** Short Chinese for the page. The raw API body stays in the console. */

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
  if (/[\u4e00-\u9fff]/.test(msg) && !/[{"]/.test(msg) && msg.length < 90) return msg;
  const wait = retrySeconds(msg);
  const waitText = wait ? `（約 ${wait} 秒後再試）` : '';
  if (/IMAGE_ECHO/.test(msg)) return '無法把圖片裡的文字翻成中文，請再試一次';
  if (/NO_API_KEY:image/i.test(msg) || (kind === 'image' && /NO_API_KEY/i.test(msg))) {
    return '圖片翻譯需要 Gemini 金鑰。請到選項頁填入。';
  }
  if (/NO_API_KEY/i.test(msg)) {
    return '此引擎需要 API key — 點擊擴充功能圖示 → 選項頁填入（或切回免費引擎）。';
  }
  if (/\b429\b|quota|rate.?limit|resource.exhausted|too many requests/i.test(msg)) {
    return `Gemini 請求太頻繁或額度不足，請稍後再試${waitText}`;
  }
  if (/api[_ ]?key|API_KEY_INVALID|unregistered|permission denied/i.test(msg) && /\b(400|401|403)\b/.test(msg)) {
    return 'Gemini 金鑰無效';
  }
  if (kind === 'image' && /\b401\b/.test(msg)) return 'Gemini 金鑰無效';
  return kind === 'image' ? '圖片翻譯失敗，請稍後再試' : '翻譯失敗，請稍後再試';
}
