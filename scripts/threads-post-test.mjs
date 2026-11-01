// Threads: aria-hidden feed,「翻譯」, @mention link, short replies.
// Served as www.threads.com so the Threads short-reply rule applies.
// Run: node scripts/threads-post-test.mjs
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
mkdirSync('/tmp/threads-mock', { recursive: true });
execSync(
  'npx esbuild scripts/threads-post-entry.ts --bundle --format=iife --platform=browser --outfile=/tmp/threads-mock/threads-collect.js --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
mkdirSync('/tmp/threads-mock', { recursive: true });
const html = `<!doctype html>
<html data-ibt-host="www.threads.com"><head><meta charset="utf-8"></head>
<body>
<div id="post" aria-hidden="true" style="width:560px;font:16px/1.4 sans-serif">
  <div>串文</div>
  <span dir="auto" style="display:block">
    <span style="display:inline">Hey </span>
    <div style="display:inline-block"><span style="display:contents"><div style="display:block"><a href="/@meta" role="link" tabindex="0" style="display:inline"><span translate="no">@<!-- -->meta</span></a></div></span></div>
    <span style="display:inline"> corposlops, keep all mentions of </span>
    <div style="display:inline-block"><span style="display:contents"><div style="display:block"><a href="/@alexandr" role="link" tabindex="0" style="display:inline"><span translate="no">@<!-- -->alexandr</span></a></div></span></div>
    <span style="display:inline"> including Twitter screenshots out of my feed</span>
    <div style="display:inline-block"><div role="button"><span>翻譯</span></div></div>
  </span>
  <span dir="auto" style="display:block">
    <span style="display:inline">bro clearly lacks self awareness </span>
    <div style="display:inline-block"><a href="/@alexandr" role="link" tabindex="0" style="display:inline"><span translate="no">@<!-- -->alexandr</span></a></div>
    <div style="display:inline-block"><div role="button"><span>翻譯</span></div></div>
  </span>
  <span style="display:block"><span style="display:inline">Cool tweet bruh</span></span>
  <span style="display:block"><span style="display:inline">Me too.</span></span>
  <span style="display:block"><span style="display:inline">Nice 🔥🔥</span><div style="display:inline-block">翻譯</div></span>
  <span style="display:block"><span style="display:inline">🔥🔥</span></span>
  <a href="/@zuck" style="display:inline-block">zuck</a>
  <span style="display:block"><span style="display:inline">1/3</span></span>
</div>
<pre id="out"></pre>
<script src="file:///tmp/threads-mock/threads-collect.js"></script>
</body></html>`;
writeFileSync('/tmp/threads-mock/index.html', html);
const dom = execSync(
  '/opt/google/chrome/chrome --headless --disable-gpu --no-sandbox --virtual-time-budget=3000 --user-data-dir=/tmp/chrome-threads-host --dump-dom file:///tmp/threads-mock/index.html',
  { encoding: 'utf8' },
);
const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
if (!m) {
  console.error(dom.slice(-1000));
  process.exit(1);
}
const units = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}
const hey = units.find((t) => t.includes('keep all mentions'));
const bro = units.find((t) => t.includes('self awareness'));
check('mention post is one unit', !!hey);
check('both mentions stay as @name', !!hey && hey.includes('@meta') && hey.includes('@alexandr') && !hey.includes('@ meta') && !hey.includes('@ alexandr'));
check('short @ reply is one unit', !!bro && bro.includes('@alexandr') && !bro.includes('@ alexandr'));
check('翻譯 is not in the source', !units.some((t) => t.includes('翻譯')));
check('short reply Cool tweet bruh', units.some((t) => t === 'Cool tweet bruh'));
check('short reply Me too.', units.some((t) => t.startsWith('Me too')));
check('Nice with emoji', units.some((t) => t.startsWith('Nice')));
check('pure emoji skipped', !units.some((t) => t.includes('🔥') && !t.includes('Nice')));
check('username skipped', !units.some((t) => t === 'zuck'));
check('counter skipped', !units.some((t) => t.includes('1/3')));
check('nav label skipped', !units.some((t) => t === '串文'));
if (failures) {
  console.error(JSON.stringify(units, null, 2));
  process.exit(1);
}
console.log('\nthreads post tests passed');
