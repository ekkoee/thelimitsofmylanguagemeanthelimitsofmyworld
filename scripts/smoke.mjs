// Self-test for the free translation engine. Run: node scripts/smoke.mjs
// 1) offline: verifies we parse Google's response into aligned pairs
// 2) live:    actually calls the free endpoint and prints a bilingual sample
// Exit code is non-zero if the live test fails, so CI / Claude Code can detect it.

function parsePairs(data) {
  const segs = Array.isArray(data?.[0]) ? data[0] : [];
  return segs
    .map((s) => ({ t: String(s?.[0] ?? '').trim(), o: String(s?.[1] ?? '').trim() }))
    .filter((p) => p.o);
}

// --- 1) offline parser check ---
const sample = [[['你好。', 'Hello. ', null, null, 1], ['今天過得如何？', 'How are you today?', null, null, 1]], null, 'en'];
const pairs = parsePairs(sample);
const okOffline = pairs.length === 2 && pairs[0].t === '你好。' && pairs[1].o === 'How are you today?';
console.log(`[offline] parser: ${okOffline ? 'PASS' : 'FAIL'}`, pairs);
if (!okOffline) process.exit(1);

// --- 2) live endpoint check ---
const text = 'The quick brown fox jumps over the lazy dog. This is a second sentence.';
const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-TW&dt=t&q=${encodeURIComponent(text)}`;
try {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const live = parsePairs(data);
  console.log('[live] endpoint: PASS  (sentence pairs returned:', live.length + ')');
  for (const p of live) console.log('  EN:', p.o, '\n  ZH:', p.t);
  if (!live.length || !live[0].t) { console.log('[live] WARN: empty translation'); process.exit(2); }
  console.log('\n✅ Free engine works — no API key needed.');
} catch (e) {
  console.log('[live] endpoint: FAIL —', e.message);
  console.log('If this fails on your machine, the free Google endpoint may be blocked/rate-limited.');
  console.log('Workaround: open the extension options and switch engine to Gemini (free key from https://aistudio.google.com/apikey).');
  process.exit(3);
}
