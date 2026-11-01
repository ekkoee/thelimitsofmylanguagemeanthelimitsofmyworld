/** Stored and sent keys: trim surrounding whitespace and quotes. No prefix or shape check. */
const EDGE_QUOTES = /^['"`“”‘’]+|['"`“”‘’]+$/g;

export function normalizeGeminiKey(raw: string | undefined | null): string {
  let value = String(raw ?? '').trim();
  for (let i = 0; i < 4; i++) {
    const next = value.replace(EDGE_QUOTES, '').trim();
    if (next === value) return value;
    value = next;
  }
  return value;
}

export type GeminiKeyCheck = 'valid' | 'invalid' | 'unknown';

const MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Confirm a key without generateContent. 200 is valid, 400/401/403 is not.
 * Anything else (network, 429, 5xx) is unknown so a blip does not look like a bad key.
 */
export async function checkGeminiKey(key: string, fetchImpl: typeof fetch = fetch): Promise<GeminiKeyCheck> {
  const value = normalizeGeminiKey(key);
  if (!value) return 'invalid';
  try {
    const res = await fetchImpl(MODELS_URL, {
      method: 'GET',
      headers: { 'x-goog-api-key': value },
    });
    if (res.status === 200) return 'valid';
    if (res.status === 400 || res.status === 401 || res.status === 403) return 'invalid';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
