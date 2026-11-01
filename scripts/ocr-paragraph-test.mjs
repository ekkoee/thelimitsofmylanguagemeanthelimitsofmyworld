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

const legend = lib.tokensToRegions([
  { text: 'US', x: 44, y: 157, w: 25, h: 16 },
  { text: 'states', x: 77, y: 158, w: 59, h: 15 },
  { text: '@EU27', x: 153, y: 155, w: 78, h: 23 },
  { text: 'Non-EU', x: 277, y: 157, w: 70, h: 16 },
  { text: 'Europe', x: 356, y: 157, w: 67, h: 21 },
], 957, 857);
const legendText = legend.map((r) => r.text);
check('legend items stay apart', legendText.includes('US states') && legendText.includes('EU27') && legendText.includes('Non-EU Europe'));
const eu = legend.find((r) => r.text === 'EU27');
check('a glued legend dot is not part of the text box', eu && eu.box[0] * 957 > 165);

const stacked = lib.tokensToRegions([
  { text: 'us', x: 564, y: 538, w: 25, h: 16 },
  { text: 'FL', x: 727, y: 559, w: 30, h: 16 },
  { text: 'average', x: 539, y: 570, w: 75, h: 16 },
], 957, 857);
check('US over average is one label', stacked.some((r) => r.text === 'us average'));
check('a neighboring abbreviation stays out of that label', stacked.some((r) => r.text === 'FL'));

const title = lib.tokensToRegions([
  { text: 'Consumer', x: 16, y: 21, w: 146, h: 24 },
  { text: 'adoption', x: 170, y: 20, w: 123, h: 31 },
], 957, 857);
const titleBox = title.find((r) => /Consumer/.test(r.text));
check('a line covers every word box', titleBox && Math.round(titleBox.box[3] * 857) >= 31);
check('title type follows the tall glyphs', titleBox && Math.round(titleBox.glyph * 857) >= 30);
check('a low-confidence word is still a word', lib.acceptOcrWord('average', 0) && !lib.acceptOcrWord('@', 90) && !lib.acceptOcrWord('®Econ', 14));

if (failed) process.exit(1);
console.log('ocr grouping checks passed');
