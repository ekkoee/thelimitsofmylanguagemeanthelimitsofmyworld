// Image translation placement: below in normal flow, overlay on a fixed card
// and on an absolutely positioned hero. Run: node scripts/image-place-test.mjs
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
mkdirSync('/tmp/image-place', { recursive: true });
execSync(
  'npx esbuild scripts/image-place-entry.ts --bundle --format=iife --platform=browser --outfile=/tmp/image-place/image-place.js --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const png = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const html = `<!doctype html><meta charset="utf-8"><style>
body { margin: 0; font: 15px/1.4 sans-serif; }
.ibt-img-overlay { position: absolute; background: rgba(0,0,0,.75); color: #f2d492; }
</style><body>
<section id="sec-article">
  <img id="article" src="${png}" width="320" height="180" alt="">
  <p data-after>The caption and the following paragraph stay in normal flow.</p>
</section>
<section id="sec-card">
  <div style="height:160px;overflow:hidden;position:relative;width:280px">
    <img id="card" src="${png}" width="280" height="160" alt="">
  </div>
  <p data-after>This paragraph sits under the card and must not move.</p>
</section>
<section id="sec-hero" style="position:relative;height:140px">
  <div style="position:absolute;left:20px;top:10px;width:200px;height:100px;overflow:hidden">
    <img id="hero" src="${png}" width="200" height="100" alt="">
  </div>
  <p data-after style="margin:0">Hero neighbour.</p>
</section>
<pre id="out"></pre>
<script src="file:///tmp/image-place/image-place.js"></script>
</body>`;
writeFileSync('/tmp/image-place/index.html', html);
const dom = execSync(
  '/opt/google/chrome/chrome --headless --disable-gpu --no-sandbox --virtual-time-budget=2000 --user-data-dir=/tmp/chrome-image-place --dump-dom file:///tmp/image-place/index.html',
  { encoding: 'utf8' },
);
const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
if (!m) { console.error(dom.slice(-800)); process.exit(1); }
const rows = JSON.parse(m[1].replace(/&quot;/g, '"'));
const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(byId)}`);
  if (!cond) failures++;
}
check('article image goes below', byId.article.mode === 'below' && byId.article.reason === 'normal-flow');
check('article insert moves the following paragraph', byId.article.shifted > 8);
check('fixed card overlays', byId.card.mode === 'overlay' && byId.card.reason === 'fixed-or-clipped-box');
check('card neighbour does not move', Math.abs(byId.card.shifted) < 2);
check('absolute hero overlays', byId.hero.mode === 'overlay' && byId.hero.reason === 'absolute-container');
check('hero neighbour does not move', Math.abs(byId.hero.shifted) < 2);
if (failures) process.exit(1);
console.log('\nimage place tests passed');
