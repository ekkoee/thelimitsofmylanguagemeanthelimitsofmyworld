// X mentions, hashtags, and URLs stay out of the translator and come back as links.
// Run: node scripts/x-chip-test.mjs
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
mkdirSync('/tmp/x-chip', { recursive: true });
execSync(
  'npx esbuild scripts/x-chip-entry.ts --bundle --format=iife --platform=browser --outfile=/tmp/x-chip/x-chip.js --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const html = `<!doctype html><meta charset="utf-8"><body>
<div id="tweet" data-testid="tweetText">
  <span>SCOOP: Both Moonshot and DeepSeek distilled </span>
  <a href="/hashtag/OpenAI">#OpenAI</a>
  <span>'s Astra when developing their latest models. w/ </span>
  <a href="/JuroOsawa">@JuroOsawa</a>
  <span> </span>
  <a href="/QianerLiu">@QianerLiu</a>
  <span> via </span>
  <a href="/theinformation">@theinformation</a>
  <span> </span>
  <a href="https://www.theinformation.com/articles/openai-astra">theinformation.com/articles/opena…</a>
</div>
<div id="br"><span>line one</span><br><a href="/Ada">@Ada</a><br><span>line two still the same paragraph</span></div>
<div id="out"></div>
<pre id="result"></pre>
<script src="file:///tmp/x-chip/x-chip.js"></script>
</body>`;
writeFileSync('/tmp/x-chip/index.html', html);
const dom = execSync(
  '/opt/google/chrome/chrome --headless --disable-gpu --no-sandbox --virtual-time-budget=2000 --user-data-dir=/tmp/chrome-x-chip --dump-dom file:///tmp/x-chip/index.html',
  { encoding: 'utf8' },
);
const m = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/);
if (!m) { console.error(dom.slice(-600)); process.exit(1); }
const r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'"));
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}
check('raw text contains the handles', r.raw.includes('@JuroOsawa') && r.raw.includes('#OpenAI'));
check('unprotected text would be mangled', r.mangledRaw.includes('@大澤十郎') && r.mangledRaw.includes('@劉倩兒'));
check('protected text has no @handle', !r.sentHasAt);
check('protected text has no url label', !r.sentHasUrl);
check('protected text keeps w/', r.protected.includes('w/'));
check('rendered keeps original handles', r.rendered.includes('@JuroOsawa') && r.rendered.includes('@QianerLiu') && r.rendered.includes('@theinformation'));
check('rendered keeps hashtag and truncated url', r.rendered.includes('#OpenAI') && r.rendered.includes('theinformation.com/articles/opena'));
check('rendered is one line', !r.rendered.includes('\n') && !r.rendered.includes('@大澤'));
check('three mention links', r.links.filter((a) => a.label.startsWith('@')).length === 3);
check('hashtag href', r.links.some((a) => a.href === '/hashtag/OpenAI' && a.label === '#OpenAI'));
check('url href', r.links.some((a) => a.href.startsWith('https://www.theinformation.com/') && a.label.includes('opena')));
check('soft breaks stay one paragraph', r.br.includes('line one') && r.br.includes('line two') && !r.br.includes('\n'));
if (failures) { console.error(JSON.stringify(r, null, 2)); process.exit(1); }
console.log('\nx chip tests passed');
