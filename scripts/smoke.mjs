// Self-test for the FREE translation engines. Run: node scripts/smoke.mjs
//   1) Google offline: verifies we parse Google's response into aligned pairs
//   2) Google live:    calls the free gtx endpoint, prints a bilingual sample
//   3) Microsoft live: gets a keyless Edge auth token, translates via the free
//                      api-edge endpoint — this is the Tier-1 fallback engine.
// Exit code is non-zero if a live test fails, so CI / Claude Code can detect it.

const SAMPLE = 'The quick brown fox jumps over the lazy dog. This is a second sentence.';
let failures = 0;

// ---------- 1) Google: offline parser check ----------
function parsePairs(data) {
  const segs = Array.isArray(data?.[0]) ? data[0] : [];
  return segs
    .map((s) => ({ t: String(s?.[0] ?? '').trim(), o: String(s?.[1] ?? '').trim() }))
    .filter((p) => p.o);
}

const sample = [[['你好。', 'Hello. ', null, null, 1], ['今天過得如何？', 'How are you today?', null, null, 1]], null, 'en'];
const pairs = parsePairs(sample);
const okOffline = pairs.length === 2 && pairs[0].t === '你好。' && pairs[1].o === 'How are you today?';
console.log(`[offline] Google parser: ${okOffline ? 'PASS' : 'FAIL'}`, pairs);
if (!okOffline) process.exit(1); // pure logic — must never fail

// ---------- 2) Google: live endpoint ----------
async function googleLive() {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-TW&dt=t&q=${encodeURIComponent(SAMPLE)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const live = parsePairs(await res.json());
    if (!live.length || !live[0].t) throw new Error('empty translation');
    console.log(`[live] Google endpoint: PASS (${live.length} sentence pairs)`);
    for (const p of live) console.log('  EN:', p.o, '\n  ZH:', p.t);
  } catch (e) {
    console.log('[live] Google endpoint: FAIL —', e.message);
    console.log('  (the free Google endpoint may be blocked/rate-limited — the Microsoft fallback below covers this)');
    failures++;
  }
}

// ---------- 3) Microsoft: live keyless Edge endpoint ----------
async function microsoftLive() {
  try {
    // a) auth token (JWT, no API key)
    const authRes = await fetch('https://edge.microsoft.com/translate/auth');
    if (!authRes.ok) throw new Error('auth HTTP ' + authRes.status);
    const token = (await authRes.text()).trim();
    if (token.split('.').length !== 3) throw new Error('auth did not return a JWT');

    // b) translate (array of {Text}); Microsoft uses zh-Hant for Traditional Chinese
    const url = 'https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-Hant';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify([{ Text: SAMPLE }]),
    });
    if (!res.ok) throw new Error('translate HTTP ' + res.status);
    const data = await res.json();
    const zh = String(data?.[0]?.translations?.[0]?.text ?? '').trim();
    const detected = data?.[0]?.detectedLanguage?.language ?? '?';
    if (!zh) throw new Error('empty translation');
    console.log(`[live] Microsoft endpoint: PASS (detected ${detected})`);
    console.log('  EN:', SAMPLE, '\n  ZH:', zh);
  } catch (e) {
    console.log('[live] Microsoft endpoint: FAIL —', e.message);
    failures++;
  }
}

await googleLive();
await microsoftLive();

if (failures === 0) {
  console.log('\n✅ Both free engines work — no API key needed.');
} else if (failures === 1) {
  console.log('\n⚠️  One free engine failed; the other still works (this is exactly what the fallback is for).');
  process.exit(2);
} else {
  console.log('\n❌ Both free engines failed — likely a network/blocking issue on this machine.');
  process.exit(3);
}
