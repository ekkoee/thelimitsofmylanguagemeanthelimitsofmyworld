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

const { geminiProvider } = await import('/tmp/gemini-thinking.test.mjs');

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

// Explicit 3.x models → minimal thinking.
for (const m of ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.6-flash']) {
  body = await lastBodyFor(m);
  check(`${m} sends thinkingLevel minimal`,
    body.generationConfig?.thinkingConfig?.thinkingLevel === 'minimal');
}

// Non-3.x model ids → thinkingConfig omitted (v3-only API shape).
body = await lastBodyFor('gemini-2.0-flash');
check('non-3.x model omits thinkingConfig',
  body.generationConfig?.thinkingConfig === undefined);

// thinkingBudget must never be combined with thinkingLevel (API 400s on that).
body = await lastBodyFor('gemini-3.5-flash-lite');
check('no thinkingBudget alongside thinkingLevel',
  body.generationConfig?.thinkingConfig?.thinkingBudget === undefined);

// Existing fields untouched.
check('temperature preserved', body.generationConfig?.temperature === 0.2);
check('responseMimeType preserved', body.generationConfig?.responseMimeType === 'application/json');

// Translation still parses through coerceTranslations.
check('translation result passthrough',
  (await geminiProvider.translate(input, { ...baseSettings, model: '' }))[0] === '\u6e2c\u8a66');

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll gemini thinking tests passed');
