// Confirms harmless Tesseract lines are dropped and a real error is kept.
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
execSync(
  'npx esbuild src/ocr/quiet-log.ts --bundle --format=esm --platform=node --outfile=/tmp/ibt-quiet-152.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const { isTessNoise, hushTessConsole } = await import(pathToFileURL('/tmp/ibt-quiet-152.mjs').href);

let failed = 0;
function check(name, cond) {
  if (!cond) { failed++; console.error('FAIL', name); }
  else console.log('ok', name);
}

check('resolution', isTessNoise('Estimating resolution as 496'));
check('diacritics', isTessNoise('Detected 12 diacritics'));
check('dpi', isTessNoise('Warning: Invalid resolution 0 dpi. Using 70 instead.'));
check('real', !isTessNoise('Error opening data file eng.traineddata'));
check('empty', !isTessNoise(''));

const seen = [];
const fake = {
  error(...args) { seen.push(['error', args.join(' ')]); },
  warn(...args) { seen.push(['warn', args.join(' ')]); },
  log(...args) { seen.push(['log', args.join(' ')]); },
};
hushTessConsole(fake);
fake.warn('Estimating resolution as 300');
fake.error('Could not read the image');
check('dropped noise', seen.length === 1 && seen[0][0] === 'error' && seen[0][1].includes('Could not read'));
hushTessConsole(fake);
fake.warn('Detected 2 diacritics');
check('hush once', seen.length === 1);

if (failed) process.exit(1);
console.log('PASS');
