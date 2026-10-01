// Smoke: compact Gemini system prompt stays shorter but keeps TC + JSON contract.
// Run: node scripts/gemini-prompt-test.mjs
import { execSync } from 'node:child_process';

execSync(
  'npx esbuild src/providers/base.ts --bundle --platform=node --format=esm --outfile=/tmp/base-prompt.test.mjs --log-level=error',
  { cwd: new URL('..', import.meta.url).pathname, stdio: 'inherit' },
);
const { buildSystemPrompt } = await import('/tmp/base-prompt.test.mjs');

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}

const full = buildSystemPrompt('Traditional Chinese (zh-TW)', 'en', { mode: 'prose', pageTitle: 'Hello World' });
const compact = buildSystemPrompt('Traditional Chinese (zh-TW)', 'en', {
  mode: 'prose', pageTitle: 'Hello World', compact: true,
});
const compactSub = buildSystemPrompt('Traditional Chinese (zh-TW)', 'auto', { mode: 'subtitle', compact: true });

check('compact shorter than full', compact.length < full.length * 0.7);
check('compact mentions Traditional Chinese', /Traditional Chinese|繁體/.test(compact));
check('compact forbids Simplified', /Simplified|简体/.test(compact));
check('compact keeps JSON t contract', /\{"t":/.test(compact) || /"t":\[/.test(compact));
check('compact keeps sentences contract', /sentences/.test(compact));
check('compact subtitle has STT hint', /Speech-to-text|neighbor/i.test(compactSub));
check('full still has long subtitle neighbor rule when not compact', /CONSECUTIVE subtitle/.test(
  buildSystemPrompt('Traditional Chinese (zh-TW)', 'auto', { mode: 'subtitle' }),
));

console.log(failures ? `${failures} FAILURES` : 'all gemini prompt tests passed');
process.exit(failures ? 1 : 0);
