// Last Facebook paragraph includes an inline div[role=button]「顯示較少」.
// Run: node scripts/facebook-last-line-test.mjs
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
execSync(
  'npx esbuild scripts/facebook-last-line-entry.ts --bundle --format=iife --platform=browser --outfile=/tmp/fb-collect.js --log-level=error',
  { cwd: root, stdio: 'inherit' },
);

const html = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body>
<div id="post" role="article" style="width:560px;font:16px sans-serif">
  <div dir="auto" style="display:block">No LeBron, no problem.</div>
  <div dir="auto" style="display:block">I flunked out of aerospace engineering because I memorized physics formulas instead of understanding the concepts behind them.</div>
  <div dir="auto" style="display:block">My teenage daughter is learning physics now. On long drives we've been using Claude in CarPlay.</div>
  <div dir="auto" data-last style="display:block">If I'd had anything close to this in school, I think I'd still be working in aerospace. <div role="button" style="display:inline">顯示較少</div></div>
</div>
<pre id="out"></pre>
<script src="file:///tmp/fb-collect.js"></script>
</body></html>`;
writeFileSync('/tmp/fb-last-line.html', html);

const dom = execSync(
  '/opt/google/chrome/chrome --headless --disable-gpu --no-sandbox --virtual-time-budget=3000 --user-data-dir=/tmp/chrome-fb-last --dump-dom file:///tmp/fb-last-line.html',
  { encoding: 'utf8' },
);
const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
if (!m) {
  console.error(dom.slice(-1500));
  process.exit(1);
}
const data = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}
const last = "If I'd had anything close to this in school, I think I'd still be working in aerospace.";
check('four paragraphs including the see-less line', data.expanded.length === 4);
check('last paragraph text has no 顯示較少', data.expanded[3] === last);
check('button label is not its own unit', !data.expanded.some((t) => t === '顯示較少' || t.includes('顯示較少')));
check('collapsed preview is still a unit', data.collapsed.some((t) => t.includes('Luka Doncic') && !t.includes('查看更多')));
check('expand replaces the last line without dropping it', data.reexpanded.some((t) => t.startsWith('Luka Doncic has the Lakers off to a 4-1 start while') && !t.includes('顯示較少')));
check('earlier paragraphs stay', data.reexpanded[0] === 'No LeBron, no problem.');
if (failures) {
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}
console.log('\nfacebook last-line tests passed');
