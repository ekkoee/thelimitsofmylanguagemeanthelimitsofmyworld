import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
execSync(
  'npx esbuild scripts/ocr-lib-entry.ts --bundle --platform=node --format=esm --outfile=/tmp/ibt-ocr-lib.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const lib = await import(pathToFileURL('/tmp/ibt-ocr-lib.mjs').href);

let failed = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failed += 1;
}

const back = lib.rotatedCWBox({ x: 80, y: 0, w: 20, h: 10 }, 100);
check('clockwise box maps back to the top left', back.x === 0 && back.y === 0 && back.w === 10 && back.h === 20);

const regions = lib.tokensToRegions([
  { text: 'The', x: 10, y: 10, w: 30, h: 16 },
  { text: 'model', x: 44, y: 10, w: 50, h: 16 },
  { text: 'writes', x: 10, y: 30, w: 50, h: 16 },
  { text: 'code', x: 64, y: 30, w: 40, h: 16 },
  { text: 'US', x: 10, y: 120, w: 24, h: 16 },
], 400, 200);
check('two stacked lines become one paragraph', regions.some((r) => r.text === 'The model writes code'));
check('a later label stays separate', regions.some((r) => r.text === 'US'));

if (failed) process.exit(1);
console.log('ocr grouping checks passed');
