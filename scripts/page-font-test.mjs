// Page translation size: short lines match the source, headings match the
// heading, GitHub row-fit does not shrink. Run: node scripts/page-font-test.mjs
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
mkdirSync('/tmp/page-font', { recursive: true });
execSync(
  'npx esbuild scripts/page-font-entry.ts --bundle --format=iife --platform=browser --outfile=/tmp/page-font/page-font.js --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const css = readFileSync(`${root}src/styles/bilingual.css`, 'utf8');
const html = `<!doctype html>
<html data-ibt-host="github.com"><head><meta charset="utf-8"><style>
${css}
body { margin: 0; font-size: 15px; }
</style></head>
<body>
<div id="fb" style="width:420px; font-size:15px; font-weight:400">
  <div id="title" data-src style="font-size:22px; font-weight:700">How can I make Hermes Agent behave more like ChatGPT DOT?</div>
  <div id="body1" data-src style="font-size:15px">This is a normal body paragraph that explains the question in more than one sentence so it wraps onto a second line inside the post card.</div>
  <div id="body2" data-src style="font-size:15px">Short body.</div>
</div>
<div id="threads" style="width:320px; font-size:15px">
  <span id="short" data-src style="display:block; font-size:15px">Degen jedi.</span>
  <span id="long" data-src style="display:block; font-size:15px">I actually respect Wang more and more as time goes on. The feeling keeps growing every week that I read another note.</span>
  <span id="mention" data-src style="display:block; font-size:15px">Hey @meta corpposts, keep all mentions of @alexandr including Twitter screenshots out of my feed</span>
</div>
<div id="x" style="font-size:20px">
  <div id="tweet" data-src data-testid="tweetText" style="font-size:20px">A tweet that is one line and must not be shrunk.</div>
</div>
<div id="gh" style="display:flex; font-size:14px">
  <a id="pr" data-src class="js-issue-title" style="display:inline-block; font-size:16px">Fix the login timeout when the session expires</a>
</div>
<h6 id="smallhead" data-src style="font-size:12px; margin:0">Tiny heading</h6>
<pre id="out"></pre>
<script src="file:///tmp/page-font/page-font.js"></script>
</body></html>`;
writeFileSync('/tmp/page-font/index.html', html);
const dom = execSync(
  '/opt/google/chrome/chrome --headless --disable-gpu --no-sandbox --virtual-time-budget=3000 --user-data-dir=/tmp/chrome-page-font --dump-dom file:///tmp/page-font/index.html',
  { encoding: 'utf8' },
);
const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
if (!m) {
  console.error(dom.slice(-800));
  process.exit(1);
}
const rows = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}
function same(id) {
  const r = byId[id];
  check(`${id} translation matches source (${r && r.src} vs ${r && r.trans})`, !!r && r.src === r.trans);
}
for (const id of ['title', 'body1', 'body2', 'short', 'long', 'mention', 'tweet', 'pr']) same(id);
check('short and long are the same size', byId.short.trans === byId.long.trans);
check('title is larger than body', parseFloat(byId.title.trans) > parseFloat(byId.body1.trans));
check('title is a heading', byId.title.heading === true && byId.title.weight === '600');
check('body is not a heading', byId.body1.heading === false && byId.body1.weight === '400');
check('short reply is not a heading', byId.short.heading === false);
check('tweet is not row-fit', byId.tweet.fit === false);
check('github title is row-fit', byId.pr.fit === true);
check('github title is not shrunk', byId.pr.trans === '16px');
check('threads lines are not row-fit', byId.short.fit === false && byId.long.fit === false);
check('short and long share line-height', byId.short.line === byId.long.line);
const head = byId.smallhead;
check('small heading is not below body', !!head && parseFloat(head.trans) >= 15);
if (failures) {
  console.error(JSON.stringify(rows, null, 2));
  process.exit(1);
}
console.log('\npage font tests passed');
