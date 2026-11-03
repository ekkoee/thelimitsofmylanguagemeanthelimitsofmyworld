// Compare b896255 and the working tree on the same X and LinkedIn posts.
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const out = '/tmp/ibt-layout';
rmSync(out, { recursive: true, force: true });
for (const name of ['base', 'now']) {
  mkdirSync(`${out}/${name}/scripts`, { recursive: true });
  cpSync(`${root}src`, `${out}/${name}/src`, { recursive: true });
  cpSync(`${root}scripts/layout-restore-entry.ts`, `${out}/${name}/scripts/layout-restore-entry.ts`);
}
execSync(`git show b896255:src/content/twitter.ts > ${out}/base/src/content/twitter.ts`, { cwd: root });
execSync(`git show b896255:src/content/engine.ts > ${out}/base/src/content/engine.ts`, { cwd: root });
execSync(`git show b896255:src/styles/bilingual.css > ${out}/old.css`, { cwd: root });
cpSync(`${root}src/styles/bilingual.css`, `${out}/new.css`);

function bundle(dir) {
  execSync(
    `npx esbuild ${dir}/scripts/layout-restore-entry.ts --bundle --format=iife --platform=browser --outfile=${dir}/layout.js --log-level=error`,
    { cwd: root, stdio: 'inherit' },
  );
}
bundle(`${out}/base`);
bundle(`${out}/now`);

const posts = `
<article class="card" id="xcard">
  <div class="who">X · 多段貼文</div>
  <div id="tweet" data-testid="tweetText">
    <span>The launch window opens at dawn. Nobody on the floor is speaking above a whisper.</span>
    <br><br>
    <span>Ada stayed through the night to watch the gauges. She sent the log to </span>
    <a href="/Ada">@Ada</a>
    <span> before sunrise.</span>
    <br>
    <span>That note is still the same paragraph, only wrapped.</span>
    <br><br>
    <span>We tagged the run </span>
    <a href="/hashtag/Launch">#Launch</a>
    <span> and filed it.</span>
  </div>
</article>
<article class="card" id="post">
  <div class="who">LinkedIn · 多行貼文</div>
  <div id="li" class="update-components-text">
    <span>The lab published the gauge notes this morning.</span><br>
    <span>The new bench handles the sample 🚀 without a second pass.</span><br>
    <span>Notes are tagged </span><a href="/hashtag/Standards">#Standards</a><span> and </span><a href="/hashtag/Metrology">#Metrology</a><span>.</span><br>
    <span>Read the writeup before Friday.</span>
  </div>
</article>
<pre id="report"></pre>`;

const frame = (css) => `<!doctype html><html data-ibt-highlight="on" data-ibt-bar="none"><meta charset="utf-8"><style>
${css}
body { margin: 0; background: #e8eaef; color: #1c1c1c; font: 15px/1.5 Georgia, serif; }
.card { max-width: 560px; margin: 16px; padding: 18px 20px 8px; background: #fff; border-radius: 12px; }
.who { margin: 0 0 10px; font: 600 12px/1 "Segoe UI", sans-serif; color: #6c7aff; }
#tweet, #li { white-space: normal; }
a { color: #1d4ed8; text-decoration: none; }
#report { display: none; }
</style><body>${posts}</body></html>`;

writeFileSync(`${out}/base/page.html`, frame(readFileSync(`${out}/old.css`, 'utf8')));
writeFileSync(`${out}/now/page.html`, frame(readFileSync(`${out}/new.css`, 'utf8')));

const port = 9379;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=${out}/profile', '--window-size=800,1100', 'about:blank',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg.result);
};
function rpc(method, params = {}) {
  const n = ++id;
  ws.send(JSON.stringify({ id: n, method, params }));
  return new Promise((resolve) => pending.set(n, resolve));
}
await rpc('Page.enable');
async function open(dir, file) {
  await rpc('Page.navigate', { url: pathToFileURL(`${dir}/page.html`).href });
  await new Promise((r) => setTimeout(r, 200));
  const src = pathToFileURL(`${dir}/layout.js`).href;
  await rpc('Runtime.evaluate', {
    expression: `new Promise((resolve) => { const s = document.createElement('script'); s.src = ${JSON.stringify(src)}; s.onload = () => setTimeout(resolve, 80); document.body.appendChild(s); })`,
    awaitPromise: true,
  });
  const got = await rpc('Runtime.evaluate', { expression: 'document.getElementById("report").textContent', returnByValue: true });
  const text = got?.result?.value || '';
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  await rpc('Emulation.setDeviceMetricsOverride', { width: 640, height: 900, deviceScaleFactor: 2, mobile: false });
  const sized = await rpc('Runtime.evaluate', { expression: 'Math.ceil(document.body.scrollHeight)', returnByValue: true });
  const h = sized?.result?.value || 900;
  await rpc('Emulation.setDeviceMetricsOverride', { width: 640, height: h, deviceScaleFactor: 2, mobile: false });
  const shot = await rpc('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('wrote', file);
  return JSON.parse(text);
}
const before = await open(`${out}/base`, '/opt/cursor/artifacts/x-li-b896255.png');
const after = await open(`${out}/now`, '/opt/cursor/artifacts/x-li-1.4.38.png');
console.log('b896255', JSON.stringify(before));
console.log('1.4.38', JSON.stringify(after));
const same = JSON.stringify(before) === JSON.stringify(after);
console.log(same ? 'LAYOUT MATCH' : 'LAYOUT DIFFER');
if (!same || !before.x || before.x.length < 2 || before.li.length !== 1 || before.li[0].lines.length < 3) {
  process.exitCode = 1;
}
ws.close();
proc.kill();
