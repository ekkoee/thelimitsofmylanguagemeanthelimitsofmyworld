// Hostile-page check: host `div` rules must not move a translation, and a
// caption overlay must stick to the caption box. Needs Chrome/Chromium.
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'ibt-layout-'));
const bundle = join(dir, 'ibt-place.js');
execSync(
  `npx esbuild src/content/place.ts --bundle --format=iife --global-name=IBT --outfile=${bundle} --log-level=error`,
  { cwd: root, stdio: 'inherit' },
);

const htmlPath = join(dir, 'page.html');
const lib = readFileSync(bundle, 'utf8').replace(/<\/script/gi, '<\\/script');
writeFileSync(htmlPath, `<!doctype html>
<meta charset="utf-8" />
<style>
  div { position: absolute !important; left: 400px !important; width: 30px !important; height: 10px !important; }
  div div { float: left !important; width: 20px !important; color: red !important; }
  #row { display: flex !important; flex-wrap: nowrap !important; position: static !important; left: 0 !important; width: 640px !important; height: auto !important; }
  #row > p { position: static !important; left: 0 !important; width: 220px !important; height: auto !important; top: auto !important; }
  #capwrap { position: relative !important; left: 20px !important; top: 20px !important; width: 640px !important; height: 360px !important; }
  #cap { position: absolute !important; left: 80px !important; top: 300px !important; width: 240px !important; height: 32px !important; }
</style>
<div id="row"><p id="src">Hello from a flex row. The translation has to sit inside this paragraph, full width, not at x=400.</p></div>
<div id="capwrap"><video></video><div id="cap" class="subtitle">Caption on the video</div></div>
<pre id="out"></pre>
<script>window.onerror = function (m) { document.getElementById('out').textContent = 'ERR ' + m; };</script>
<script>${lib}</script>
<script>
  const flow = document.createElement('div');
  flow.className = 'ibt-block ibt-uni';
  flow.dataset.ibtOut = '1';
  IBT.placeBlock(document.getElementById('src'), flow, true);
  const body = IBT.shadowBody(flow);
  const line = document.createElement('div');
  line.className = 'ibt-trans';
  line.textContent = '譯文應該跟原文同寬，不要被宿主拉去左邊。';
  body.appendChild(line);

  const cap = document.createElement('div');
  cap.className = 'ibt-block ibt-uni';
  cap.dataset.ibtOut = '1';
  IBT.placeBlock(document.getElementById('cap'), cap, true);
  IBT.shadowBody(cap).appendChild(document.createTextNode('字幕譯文'));

  function report() {
    const src = document.getElementById('src').getBoundingClientRect();
    const fr = flow.getBoundingClientRect();
    const cr = document.getElementById('cap').getBoundingClientRect();
    const tr = cap.getBoundingClientRect();
    const lineCs = getComputedStyle(line);
    const result = {
      flowInside: flow.parentElement && flow.parentElement.id === 'src',
      flowPos: getComputedStyle(flow).position,
      flowWidth: Math.round(fr.width),
      srcWidth: Math.round(src.width),
      flowLeft: Math.round(fr.left),
      srcLeft: Math.round(src.left),
      shadowFloat: lineCs.float,
      shadowColor: lineCs.color,
      capPos: getComputedStyle(cap).position,
      capCenter: Math.round(tr.left + tr.width / 2),
      srcCapCenter: Math.round(cr.left + cr.width / 2),
      capTop: Math.round(tr.top),
      srcCapBottom: Math.round(cr.bottom),
    };
    document.getElementById('out').textContent = JSON.stringify(result);
  }
  IBT.flushAnchors();
  report();
</script>
`);

function findChrome() {
  const candidates = [
    'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ];
  for (const c of candidates) {
    try {
      execSync(`command -v ${c}`, { stdio: 'ignore' });
      return c;
    } catch { /* next */ }
  }
  return '';
}

const chrome = findChrome();
if (!chrome) {
  console.log('SKIP DOM layout test — Chrome/Chromium not installed');
  process.exit(0);
}

// Headless Chrome prints the DOM then sometimes never exits in this environment.
// Kill it after the dump; stdout already has the result.
const out = await new Promise((resolve, reject) => {
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--virtual-time-budget=2000', '--allow-file-access-from-files',
    '--dump-dom', htmlPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  let err = '';
  let done = false;
  const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve({ buf, err }); };
  const timer = setTimeout(() => { child.kill('SIGKILL'); finish(); }, 15000);
  child.stdout.on('data', (d) => {
    buf += d;
    if (buf.includes('</html>')) { child.kill('SIGKILL'); finish(); }
  });
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', reject);
});
const m = out.buf.match(/<pre id="out">([^<]*)<\/pre>/);
if (!m || !m[1]) {
  writeFileSync('/tmp/ibt-dom-fail.html', out.buf);
  console.error('FAIL could not read layout result', {
    stdout: out.buf.length,
    tail: out.buf.slice(-400),
    stderr: out.err.slice(-400),
  });
  process.exit(1);
}
const r = JSON.parse(m[1].replace(/&quot;/g, '"'));
console.log(r);
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}
check('flex-row translation is inside the source', r.flowInside === true);
check('host absolute !important did not win', r.flowPos === 'static');
check('translation keeps the source width', Math.abs(r.flowWidth - r.srcWidth) <= 4);
check('translation is not parked at left:400', Math.abs(r.flowLeft - r.srcLeft) <= 4);
check('shadow root blocks host float', r.shadowFloat === 'none');
check('caption overlay is fixed', r.capPos === 'fixed');
check('caption overlay stays centered on the caption', Math.abs(r.capCenter - r.srcCapCenter) < 90);
check('caption overlay sits just under the caption', Math.abs(r.capTop - (r.srcCapBottom + 2)) <= 8);
if (failures) process.exit(1);
console.log('\nDOM layout test passed');
