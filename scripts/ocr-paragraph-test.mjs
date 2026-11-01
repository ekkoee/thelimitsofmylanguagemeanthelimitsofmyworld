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
check('stacked lines stay on their own rows', regions.some((r) => r.text === 'The model') && regions.some((r) => r.text === 'writes code'));
check('a later label stays separate', regions.some((r) => r.text === 'US'));

const chart = lib.tokensToRegions([
  { text: 'Sweden', x: 400, y: 40, w: 70, h: 16 },
  { text: '@', x: 490, y: 42, w: 12, h: 12 },
  { text: 'Netherlands', x: 560, y: 42, w: 110, h: 16 },
  { text: '[J]', x: 700, y: 40, w: 18, h: 14 },
  { text: 'Switzerland', x: 820, y: 38, w: 100, h: 16 },
  { text: 'France', x: 200, y: 80, w: 54, h: 14 },
  { text: 'Belgium', x: 198, y: 100, w: 62, h: 14 },
  { text: 'US', x: 100, y: 200, w: 22, h: 14 },
  { text: 'average', x: 126, y: 200, w: 64, h: 14 },
], 1000, 600);
const names = chart.map((r) => r.text);
check('same-line labels stay apart', names.includes('Sweden') && names.includes('Netherlands') && names.includes('Switzerland'));
check('noise tokens are dropped', !names.some((t) => t === '@' || t.includes('[J]')));
check('stacked chart labels are not one box', names.includes('France') && names.includes('Belgium'));
check('a normal space stays one label', names.includes('US average'));

if (failed) process.exit(1);
console.log('ocr grouping checks passed');
