// Unit tests for the Gemini provider's thinking-level config
// (src/providers/gemini.ts). Verifies the request body sent to generateContent.
// Run: node scripts/gemini-thinking-test.mjs  (bundles the module with esbuild)
import { execSync } from 'node:child_process';

execSync(
  'npx esbuild src/providers/gemini.ts --bundle --platform=node --format=esm --outfile=/tmp/gemini-thinking.test.mjs --log-level=error',
  { cwd: new URL('..', import.meta.url).pathname, stdio: 'inherit' },
);

const bodies = [];
globalThis.fetch = async (url, init) => {
  bodies.push({ url, body: JSON.parse(init.body) });
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ t: ['\u6e2c\u8a66'] }) }] } }],
    }),
    text: async () => '',
  };
};

const { geminiProvider, geminiAnswerText, resolveGeminiModel, geminiThinking, geminiOutputCap } = await import('/tmp/gemini-thinking.test.mjs');

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}

const baseSettings = {
  provider: 'gemini',
  targetLang: 'Traditional Chinese (zh-TW)',
  targetLangCode: 'zh-TW',
  sourceLang: 'auto',
  apiKeys: { gemini: 'fake-key-for-test' },
};
const input = { sentences: ['Hello world'], targetLang: 'Traditional Chinese (zh-TW)', sourceLang: 'auto' };

async function lastBodyFor(model) {
  bodies.length = 0;
  await geminiProvider.translate(input, { ...baseSettings, model });
  return bodies[bodies.length - 1].body;
}

// Default model (blank) resolves to gemini-3.5-flash-lite → minimal thinking.
let body = await lastBodyFor('');
check('default model sends thinkingLevel minimal',
  body.generationConfig?.thinkingConfig?.thinkingLevel === 'minimal');
check('default model does not send temperature', body.generationConfig?.temperature === undefined);
check('store opt-out', body.store === false);
check('output cap set', typeof body.generationConfig?.maxOutputTokens === 'number');
check('includeThoughts false', body.generationConfig?.thinkingConfig?.includeThoughts === false);

// Flash-Lite and 3.6 accept minimal. 3.8 and Gemini 4 reject it — send low.
for (const m of ['gemini-3.5-flash-lite', 'gemini-3.6-flash']) {
  body = await lastBodyFor(m);
  check(`${m} sends thinkingLevel minimal`,
    body.generationConfig?.thinkingConfig?.thinkingLevel === 'minimal');
}
for (const m of ['gemini-3.8-flash', 'gemini-4-argon']) {
  body = await lastBodyFor(m);
  check(`${m} sends thinkingLevel low`,
    body.generationConfig?.thinkingConfig?.thinkingLevel === 'low');
  check(`${m} has no thinkingBudget`, body.generationConfig?.thinkingConfig?.thinkingBudget === undefined);
}

// Retired alias is called as 3.6 directly, still at minimal (not the medium default).
body = await lastBodyFor('gemini-3.5-flash');
check('retired 3.5-flash URL is 3.6', /models\/gemini-3\.6-flash:/.test(bodies[bodies.length - 1].url));
check('retired 3.5-flash still minimal', body.generationConfig?.thinkingConfig?.thinkingLevel === 'minimal');
check('resolveGeminiModel', resolveGeminiModel('gemini-3.5-flash') === 'gemini-3.6-flash');
check('resolve 3.7 → 3.8', resolveGeminiModel('gemini-3.7-flash') === 'gemini-3.8-flash');
check('lite is not remapped', resolveGeminiModel('gemini-3.5-flash-lite') === 'gemini-3.5-flash-lite');

// 2.5 can disable thinking with a budget. 2.0 has no thinking API.
body = await lastBodyFor('gemini-2.5-flash');
check('2.5 uses thinkingBudget 0', body.generationConfig?.thinkingConfig?.thinkingBudget === 0);
check('2.5 omits thinkingLevel', body.generationConfig?.thinkingConfig?.thinkingLevel === undefined);
check('2.5 keeps temperature', body.generationConfig?.temperature === 0.2);
body = await lastBodyFor('gemini-2.0-flash');
check('non-3.x model omits thinkingConfig', body.generationConfig?.thinkingConfig === undefined);
check('2.0 keeps temperature', body.generationConfig?.temperature === 0.2);

// thinkingBudget must never be combined with thinkingLevel (API 400s on that).
body = await lastBodyFor('gemini-3.5-flash-lite');
check('no thinkingBudget alongside thinkingLevel',
  body.generationConfig?.thinkingConfig?.thinkingBudget === undefined);
check('responseMimeType preserved', body.generationConfig?.responseMimeType === 'application/json');
check('output cap grows with input but stays bounded', geminiOutputCap(['a'.repeat(5000)]) === 4096);
check('thinking helper', geminiThinking('gemini-3.5-flash-lite')?.thinkingLevel === 'minimal');

// Thought parts must not be parsed as the translation.
check('thought parts dropped', geminiAnswerText({
  candidates: [{ content: { parts: [
    { thought: true, text: 'let me think about json' },
    { text: JSON.stringify({ t: ['\u6e2c\u8a66'] }) },
  ] } }],
}) === JSON.stringify({ t: ['\u6e2c\u8a66'] }));

// Translation still parses through coerceTranslations.
check('translation result passthrough',
  (await geminiProvider.translate(input, { ...baseSettings, model: '' }))[0] === '\u6e2c\u8a66');

// minimal rejected → one retry at low.
{
  let n = 0;
  globalThis.fetch = async (url, init) => {
    n++;
    const b = JSON.parse(init.body);
    bodies.push({ url, body: b });
    if (n === 1) {
      return {
        ok: false, status: 400,
        headers: { get: () => null },
        clone() { return this; },
        text: async () => 'Invalid thinkingLevel minimal',
        json: async () => ({}),
      };
    }
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ t: ['\u6e2c\u8a66'] }) }] } }],
      }),
      text: async () => '',
    };
  };
  const out = await geminiProvider.translate(input, { ...baseSettings, model: 'gemini-3.5-flash-lite' });
  check('400 minimal retries once', n === 2);
  check('retry uses low', bodies[bodies.length - 1].body.generationConfig.thinkingConfig.thinkingLevel === 'low');
  check('retry still translates', out[0] === '\u6e2c\u8a66');
}

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll gemini thinking tests passed');
