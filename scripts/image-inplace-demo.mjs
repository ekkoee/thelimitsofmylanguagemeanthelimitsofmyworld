// Render three in-place image translations with stubbed box_2d regions.
// Run: node scripts/image-inplace-demo.mjs
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
mkdirSync('/tmp/ibt-inplace', { recursive: true });
mkdirSync('/opt/cursor/artifacts', { recursive: true });
execSync(
  'npx esbuild scripts/image-inplace-demo-entry.ts --bundle --format=iife --platform=browser --outfile=/tmp/ibt-inplace/demo.js --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const css = readFileSync(`${root}src/styles/bilingual.css`, 'utf8');
const html = `<!doctype html><meta charset="utf-8"><style>${css}
body { margin: 16px; background: #fff; }
section { margin: 0 0 28px; }
</style><body><div id="scenes"></div><pre id="out"></pre>
<script src="file:///tmp/ibt-inplace/demo.js"></script></body>`;
writeFileSync('/tmp/ibt-inplace/index.html', html);
execSync(
  '/opt/google/chrome/chrome --headless --disable-gpu --no-sandbox --window-size=1100,2200 --virtual-time-budget=3000 --screenshot=/tmp/ibt-inplace/all.png file:///tmp/ibt-inplace/index.html',
  { stdio: 'inherit' },
);
const dom = execSync(
  '/opt/google/chrome/chrome --headless --disable-gpu --no-sandbox --virtual-time-budget=2500 --dump-dom file:///tmp/ibt-inplace/index.html',
  { encoding: 'utf8' },
);
if (!dom.includes('mode=inplace')) {
  console.error(dom.slice(-800));
  process.exit(1);
}
if (dom.includes('>140<') || dom.includes('>2014<')) {
  console.error('axis numbers were painted');
  process.exit(1);
}
for (const id of ['ft', 'article', 'email']) {
  execSync(
    `/opt/google/chrome/chrome --headless --disable-gpu --no-sandbox --virtual-time-budget=2500 --screenshot=/opt/cursor/artifacts/inplace-${id}.png --window-size=1100,800 file:///tmp/ibt-inplace/index.html#${id}`,
    { stdio: 'inherit' },
  );
}
console.log(dom.match(/ft mode=[\s\S]*?email mode=[^<]+/)?.[0] || 'notes missing');
console.log('wrote /opt/cursor/artifacts/inplace-ft.png inplace-article.png inplace-email.png');
