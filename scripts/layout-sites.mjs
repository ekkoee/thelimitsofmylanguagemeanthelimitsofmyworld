// Headless check: Alt+A's block picker on a GitHub-like page and on live sites.
// Screenshots land in /opt/cursor/artifacts. No extension API key required —
// chosen blocks are stamped with a visible 【譯】 line so the layout change shows.
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const outDir = '/opt/cursor/artifacts';
mkdirSync(outDir, { recursive: true });
const bundle = join(tmpdir(), 'ibt-units.js');
execSync(
  `npx esbuild src/content/blocks.ts --bundle --format=iife --global-name=IBT --outfile=${bundle} --log-level=error`,
  { cwd: root, stdio: 'inherit' },
);

const dir = mkdtempSync(join(tmpdir(), 'ibt-sites-'));
const fixture = join(dir, 'github-like.html');
writeFileSync(fixture, `<!doctype html>
<meta charset="utf-8" />
<title>fixture</title>
<style>
  body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: #0d1117; color: #e6edf3; }
  header { display: flex; gap: 12px; align-items: center; padding: 12px 16px; border-bottom: 1px solid #30363d; }
  header a, header button { color: #e6edf3; background: #21262d; border: 1px solid #30363d; border-radius: 6px; padding: 4px 10px; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); }
  nav a { margin-right: 12px; color: #8b949e; text-decoration: none; }
  .layout { display: grid; grid-template-columns: 1fr 280px; gap: 24px; padding: 16px 24px; }
  aside h2 { font-size: 14px; margin: 0 0 8px; }
  .commit { display: flex; gap: 8px; align-items: center; padding: 8px 0; border-top: 1px solid #30363d; }
  .markdown-body p { font-size: 16px; line-height: 1.6; max-width: 720px; }
</style>
<header>
  <span class="sr-only">Open global navigation menu (g then d)</span>
  <nav><a>Code</a><a>Issues</a><a>Pull requests</a></nav>
  <button>Watch</button><button>Fork</button><button>Star</button>
</header>
<div class="layout">
  <main>
    <h1>magicstoneapp</h1>
    <div class="commit"><span>Fic Explicit any type for player error handler</span></div>
    <article class="markdown-body">
      <h2>How the handler works</h2>
      <p>This repository explains how the player reports an error when the caller does not know the type in advance and still needs a message a person can read.</p>
    </article>
  </main>
  <aside>
    <h2>About</h2>
    <p>No description, website, or topics provided.</p>
  </aside>
</div>
`);

const lib = (await import('node:fs')).readFileSync(bundle, 'utf8');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  `--user-data-dir=${join(dir, 'profile')}`,
  '--remote-debugging-port=9334',
  '--window-size=1400,900',
  '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' });

async function waitJson() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await fetch('http://127.0.0.1:9334/json/list').then((r) => r.json());
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch { /* booting */ }
    await sleep(100);
  }
  throw new Error('chrome debug port did not open');
}

const page = await waitJson();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});
function cdp(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', {
  width: 1400, height: 900, deviceScaleFactor: 1, mobile: false,
});

const STAMP = lib + `
;(() => {
  document.querySelectorAll('.ibt-block').forEach((n) => n.remove());
  const units = IBT.collectUnits(document.body);
  const texts = units.map((u) => (u.text || '').replace(/\\s+/g, ' ').trim());
  for (const u of units) {
    const d = document.createElement('div');
    d.className = 'ibt-block';
    d.textContent = '【譯】' + u.text.slice(0, 90);
    d.style.cssText = 'display:block;border-left:3px solid #7aa2ff;color:#9ec1ff;margin:4px 0 8px;padding:2px 0 2px 8px;font:13px/1.45 system-ui,sans-serif;';
    u.element.insertAdjacentElement('afterend', d);
  }
  return texts;
})()
`;

async function shoot(name) {
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  const file = join(outDir, name);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('shot', file);
}

async function open(url) {
  await cdp('Page.navigate', { url });
  for (let i = 0; i < 40; i++) {
    const state = await cdp('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (state.result?.value === 'complete') break;
    await sleep(250);
  }
  await sleep(1200);
}

async function stamp() {
  const res = await cdp('Runtime.evaluate', { expression: STAMP, returnByValue: true });
  if (res.exceptionDetails) {
    console.error('inject failed', JSON.stringify(res.exceptionDetails).slice(0, 400));
    return [];
  }
  return res.result?.value || [];
}

const bad = /^(watch|fork|star|about|code|issues|pull requests|pin|add file)$/i;
let failed = 0;
function expectClean(label, texts) {
  const hits = texts.filter((t) => bad.test(t) || /global navigation/i.test(t) || /No description, website/i.test(t));
  console.log(`\n${label} units (${texts.length}):`);
  for (const t of texts.slice(0, 12)) console.log('  -', t.slice(0, 110));
  if (hits.length) {
    console.log('FAIL chrome leaked:', hits);
    failed++;
  } else console.log('PASS no button/nav/about/sr-only labels');
  const prose = texts.some((t) => t.length > 70);
  if (!prose) {
    console.log('FAIL no prose block was selected');
    failed++;
  } else console.log('PASS a prose block was selected');
}

// Local stand-in for the GitHub screenshot.
await open('file://' + fixture);
await shoot('layout-fixture-before.png');
expectClean('fixture', await stamp());
await shoot('layout-fixture-after.png');

const sites = [
  ['https://github.com/github/docs', 'layout-github'],
  ['https://en.wikipedia.org/wiki/Translation', 'layout-wikipedia'],
  ['https://developer.mozilla.org/en-US/docs/Web/HTML/Element/p', 'layout-mdn'],
  ['https://www.bbc.com/news', 'layout-bbc'],
];
for (const [url, name] of sites) {
  try {
    await open(url);
    await shoot(`${name}-before.png`);
    const texts = await stamp();
    const hits = texts.filter((t) => bad.test(t.trim()) || /global navigation menu/i.test(t));
    console.log(`\n${name} units ${texts.length}, chrome hits ${hits.length}`);
    for (const t of texts.slice(0, 8)) console.log('  -', t.slice(0, 110));
    if (hits.length) { console.log('FAIL', hits.slice(0, 6)); failed++; }
    else console.log('PASS no Watch/Fork/Star/nav-label units');
    const prose = texts.some((t) => t.length > 80);
    console.log(prose ? 'PASS prose present' : 'WARN no long prose in the first units (page may be a shell)');
    await shoot(`${name}-after.png`);
  } catch (e) {
    console.log('SKIP', name, e.message);
  }
}

chrome.kill('SIGKILL');
ws.close();
if (failed) {
  console.error(`\n${failed} layout check(s) failed`);
  process.exit(1);
}
console.log('\nlayout site checks passed');
