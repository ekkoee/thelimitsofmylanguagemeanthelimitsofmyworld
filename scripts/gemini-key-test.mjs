// Key normalization and the models-list check. No real key is used or printed.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
execSync(
  'npx esbuild src/core/gemini-key.ts --bundle --platform=node --format=esm --outfile=/tmp/gemini-key.test.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const { normalizeGeminiKey, checkGeminiKey } = await import('/tmp/gemini-key.test.mjs');

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}

const sample = 'AQ.Ab8RN6example-not-a-real-key';
check('trims whitespace', normalizeGeminiKey(`  ${sample}  `) === sample);
check('strips wrapping quotes', normalizeGeminiKey(`"${sample}"`) === sample && normalizeGeminiKey(`'${sample}'`) === sample);
check('strips quotes around spaced text', normalizeGeminiKey(`  "${sample}"  `) === sample);
check('keeps an AQ key intact', normalizeGeminiKey(sample) === sample);
check('does not require an AIza prefix or a minimum length', normalizeGeminiKey('AQ') === 'AQ' && normalizeGeminiKey('x') === 'x');
check('empty stays empty', normalizeGeminiKey('   ') === '' && normalizeGeminiKey(undefined) === '');

function seen(status, headerName = 'x-goog-api-key') {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), method: init?.method, key: headers.get(headerName) });
    return new Response('{}', { status });
  };
  return { calls, fetchImpl };
}

{
  const { calls, fetchImpl } = seen(200);
  const result = await checkGeminiKey(` "${sample}" `, fetchImpl);
  check('200 from the models list is valid', result === 'valid');
  check('request is GET /v1beta/models', calls.length === 1 && calls[0].method === 'GET' && calls[0].url === 'https://generativelanguage.googleapis.com/v1beta/models');
  check('key travels in the header, not the url', calls[0].key === sample && !calls[0].url.includes(sample) && !calls[0].url.includes('key='));
}
for (const status of [400, 401, 403]) {
  const { fetchImpl } = seen(status);
  check(`${status} is invalid`, await checkGeminiKey(sample, fetchImpl) === 'invalid');
}
{
  const { fetchImpl } = seen(429);
  check('429 is not treated as an invalid key', await checkGeminiKey(sample, fetchImpl) === 'unknown');
}
check('a network failure is unknown', await checkGeminiKey(sample, async () => { throw new Error('offline'); }) === 'unknown');

const page = readFileSync(`${root}src/providers/gemini.ts`, 'utf8');
const route = readFileSync(`${root}src/core/gemini-route.ts`, 'utf8');
check('page translation still sends the key as a query parameter', page.includes('?key=${encodeURIComponent(key)}'));
check('image route sends x-goog-api-key and not a query key', route.includes("'x-goog-api-key': opts.key") && !route.includes('?key='));

if (failures) {
  console.error(`${failures} key checks failed`);
  process.exit(1);
}
console.log('gemini key checks passed');
