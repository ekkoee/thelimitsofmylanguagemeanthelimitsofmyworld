import { execSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
mkdirSync('/tmp/ibt-li', { recursive: true });
mkdirSync('/opt/cursor/artifacts', { recursive: true });
execSync('npx esbuild scripts/li-lines-entry.ts --bundle --format=iife --platform=browser --outfile=/tmp/ibt-li/li.js --log-level=error', { cwd: root, stdio: 'inherit' });

const post = `
<div class="update-components-text" id="body">
  <span dir="ltr">One month to go until Inspiration Through Innovation 2026.<br><br>
  Across two days at the Seco Innovation Hub in Germany, manufacturing leaders will come together.<br><br>
  From live machining demonstrations to an open partner showcase, ITI offers the opportunity to explore solutions.<br><br>
  Whether you are looking to improve productivity, we look forward to welcoming you this November.<br><br>
  🗓️ 24 – 25 November 2026<br>
  📍 Seco Innovation Hub, Erkrath, Germany<br>
  👉 Don't miss: <a href="https://lnkd.in/eQua3pXy">https://lnkd.in/eQua3pXy</a>
  <button class="see-more" aria-expanded="true" type="button">see more</button>
  </span>
</div>`;

function page(theme) {
  const dark = theme === 'dark';
  return `<!doctype html><html data-ibt-highlight="on"><meta charset="utf-8"><style>
  body { margin: 0; background: ${dark ? '#1b1f23' : '#f3f2ef'}; color: ${dark ? '#e9e9e9' : '#191919'}; font: 15px/1.5 "Segoe UI", "Microsoft JhengHei", sans-serif; }
  .card { max-width: 560px; margin: 24px auto; padding: 16px 20px 8px; background: ${dark ? '#1b1f23' : '#fff'}; border-radius: 12px; }
  a { color: #0a66c2; }
  </style><div class="card">${post}</div><pre id="out"></pre></html>`;
}
writeFileSync('/tmp/ibt-li/light.html', page('light'));
writeFileSync('/tmp/ibt-li/dark.html', page('dark'));

const port = 9385;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-li/profile', 'about:blank',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const tab = list.find((t) => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
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
await rpc('Runtime.enable');
async function run(file, shot) {
  await rpc('Page.navigate', { url: pathToFileURL(`/tmp/ibt-li/${file}`).href });
  await new Promise((r) => setTimeout(r, 200));
  const src = pathToFileURL('/tmp/ibt-li/li.js').href;
  await rpc('Runtime.evaluate', {
    expression: `new Promise((resolve) => { const s = document.createElement('script'); s.src = ${JSON.stringify(src)}; s.onload = () => resolve(true); document.body.appendChild(s); })`,
    awaitPromise: true,
  });
  await rpc('Runtime.evaluate', { expression: `window.__go(document.getElementById('body')); window.__go(document.getElementById('body'));` });
  await new Promise((r) => setTimeout(r, 80));
  const got = await rpc('Runtime.evaluate', { expression: `(() => {
    const body = document.getElementById('body');
    const blocks = [...body.querySelectorAll('.ibt-block'), ...((body.nextElementSibling && body.nextElementSibling.classList.contains('ibt-block')) ? [body.nextElementSibling] : [])];
    const lines = window.__lines(body).map((l) => l.text);
    return { lines, blocks: blocks.length, texts: [...document.querySelectorAll('.ibt-trans')].map((n) => n.textContent) };
  })()`, returnByValue: true });
  console.log(file, JSON.stringify(got?.result?.value, null, 2));
  await rpc('Emulation.setDeviceMetricsOverride', { width: 640, height: 200, deviceScaleFactor: 2, mobile: false });
  const h = await rpc('Runtime.evaluate', { expression: 'Math.ceil(document.body.scrollHeight)', returnByValue: true });
  await rpc('Emulation.setDeviceMetricsOverride', { width: 640, height: h?.result?.value || 800, deviceScaleFactor: 2, mobile: false });
  const image = await rpc('Page.captureScreenshot', { format: 'png' });
  writeFileSync(shot, Buffer.from(image.data, 'base64'));
  return got?.result?.value;
}
const light = await run('light.html', '/opt/cursor/artifacts/linkedin-lines-light.png');
const dark = await run('dark.html', '/opt/cursor/artifacts/linkedin-lines-dark.png');
const ok = light && light.lines.length >= 6 && light.blocks >= 6 && light.texts.length >= 6
  && dark && dark.blocks === light.blocks;
if (!ok) {
  console.error('linkedin line split failed');
  process.exitCode = 1;
} else console.log('PASS', light.lines.length, 'lines');
ws.close();
proc.kill();
