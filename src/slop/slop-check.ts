// OPTIONAL external detector, called only from the service worker for {type:'slopCheck'}.
// Off by default; uses Sapling's free tier (50k chars/day) with the user's own key.
export interface SlopCheckMessage { type: 'slopCheck'; text: string }
export interface SlopCheckResponse { ok: boolean; prob?: number; lowConfidence?: boolean; error?: string }

export async function handleSlopCheck(text: string, apiKey: string): Promise<SlopCheckResponse> {
  if (!apiKey) return { ok: false, error: '未設定 Sapling API key' };
  const res = await fetch('https://api.sapling.ai/api/v1/aidetect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: apiKey, text: text.slice(0, 4000), sent_scores: false, zero_retention: true }),
  });
  if (!res.ok) return { ok: false, error: `Sapling HTTP ${res.status}` };
  const j = (await res.json()) as { score?: number; low_confidence?: boolean };
  return { ok: true, prob: j.score, lowConfidence: j.low_confidence };
}

/** Blend local score (0–100) with API probability; short text gets less API weight. */
export function blend(local: number, prob: number | undefined, textLen: number): number {
  if (prob == null) return local;
  const w = textLen < 300 ? 0.3 : 0.6;
  return Math.round((1 - w) * local + w * prob * 100);
}
