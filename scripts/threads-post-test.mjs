// Threads post body: block span + inline text + inline-block「翻譯」+ 1/3.
// Run: node scripts/threads-post-test.mjs
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
execSync(
  'npx esbuild scripts/threads-post-entry.ts --bundle --format=iife --platform=browser --outfile=/tmp/threads-collect.js --log-level=error',
  { cwd: root, stdio: 'inherit' },
);

const body = 'A tech skeptic friend tested OmniQuant AI and texted me: Dude, this is not an upgrade. If you are not using this today, you are already falling behind.';
const html = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body>
<div id="post" style="width:560px;font:16px sans-serif">
  <div>串文</div>
  <div>7,553次瀏覽</div>
  <span style="display:block">
    <span style="display:inline">${body}</span>
    <div style="display:inline-block"><div role="button"><span style="display:block">翻譯</span></div></div>
    <span>1/3</span>
  </span>
  <span style="display:block"><span style="display:inline">A short reply that should also be translated in full.</span></span>
</div>
<pre id="out"></pre>
<script src="file:///tmp/threads-collect.js"></script>
</body></html>`;
writeFileSync('/tmp/threads-post-mock.html', html);
const dom = execSync(
  '/opt/google/chrome/chrome --headless --disable-gpu --no-sandbox --virtual-time-budget=3000 --user-data-dir=/tmp/chrome-threads-mock --dump-dom file:///tmp/threads-post-mock.html',
  { encoding: 'utf8' },
);
const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
if (!m) {
  console.error(dom.slice(-800));
  process.exit(1);
}
const units = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}
check('post body is a unit', units.some((t) => t.startsWith('A tech skeptic friend')));
check('翻譯 is not in the source', !units.some((t) => t.includes('翻譯')));
check('1/3 counter is not in the source', !units.some((t) => t.includes('1/3')));
check('翻譯 is not its own unit', !units.some((t) => t === '翻譯'));
check('reply is translated too', units.some((t) => t.startsWith('A short reply')));
check('chrome labels are not units', !units.some((t) => t.includes('次瀏覽') || t === '串文'));
if (failures) {
  console.error(JSON.stringify(units, null, 2));
  process.exit(1);
}
console.log('\nthreads post tests passed');
