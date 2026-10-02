// Smoke: Groq uses the compact prompt contract (JSON {"t":[...]} + Traditional Chinese).
// Optional live call if GROQ_API_KEY is set (never printed).
// Run: node scripts/groq-prompt-test.mjs
import { execSync } from 'node:child_process';

execSync(
  'npx esbuild src/providers/base.ts --bundle --platform=node --format=esm --outfile=/tmp/base-prompt.groq.mjs --log-level=error',
  { cwd: new URL('..', import.meta.url).pathname, stdio: 'inherit' },
);
const { buildSystemPrompt, coerceTranslations } = await import('/tmp/base-prompt.groq.mjs');

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}

const compact = buildSystemPrompt('Traditional Chinese (zh-TW)', 'en', {
  mode: 'subtitle', compact: true,
});
check('compact has Traditional hard rule', /Traditional Chinese|繁體/.test(compact) && /Simplified|简体/.test(compact));
check('compact JSON contract {"t":', /\{"t":\[/.test(compact));
check('compact sentences input', /\{"sentences":/.test(compact));

const parsed = coerceTranslations('{"t":["你好","世界"]}', 2);
check('coerce {"t":[...]}', parsed[0] === '你好' && parsed[1] === '世界');

const key = (process.env.GROQ_API_KEY || '').trim();
if (!key) {
  console.log('SKIP live Groq (set GROQ_API_KEY to run a short EN→zh-TW call)');
} else {
  const t0 = Date.now();
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 256,
      messages: [
        { role: 'system', content: compact },
        { role: 'user', content: JSON.stringify({ sentences: ['The limits of my language mean the limits of my world.'] }) },
      ],
    }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    console.log(`FAIL live Groq HTTP ${res.status} in ${ms}ms: ${body}`);
    failures++;
  } else {
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    const out = coerceTranslations(content, 1);
    const zh = out[0] || '';
    console.log(`PASS live Groq ${ms}ms → ${zh}`);
    check('live non-empty', zh.length > 0);
    check('live looks Traditional-ish (has CJK)', /[\u4e00-\u9fff]/.test(zh));
  }
}

console.log(failures ? `${failures} FAILURES` : 'all groq prompt tests passed');
process.exit(failures ? 1 : 0);
