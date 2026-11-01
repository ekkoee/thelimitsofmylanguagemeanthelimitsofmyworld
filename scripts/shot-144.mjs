import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const out = '/opt/cursor/artifacts';
mkdirSync('/tmp/ibt-144', { recursive: true });
mkdirSync(out, { recursive: true });
const lines = JSON.parse(readFileSync('/tmp/ibt-free.json', 'utf8'));
const chip = (theme) => `<!doctype html><html data-ibt-highlight="on"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(root + 'dist/bilingual.css').href}"><style>
  body { margin: 0; padding: 28px; background: ${theme === 'dark' ? '#000' : '#fff'}; color: ${theme === 'dark' ? '#e7e9ea' : '#0f1419'}; font: 20px/1.5 "PingFang TC","Microsoft JhengHei",sans-serif; }
  .ibt-block { max-width: 280px; }
</style></head><body>
<div class="ibt-block"><div class="ibt-trans" data-ibt-on="${theme}"><span><span class="ibt-punct ibt-punct-lead">「</span>好的設計很安靜，它幫助你閱讀，卻不會打擾你<span class="ibt-punct ibt-punct-tail">。</span></span></div></div>
</body></html>`;
writeFileSync('/tmp/ibt-144/chip-dark.html', chip('dark'));
writeFileSync('/tmp/ibt-144/chip-light.html', chip('light'));
const sub = (w, h, label) => `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(root + 'dist/bilingual.css').href}"><style>
  body { margin: 0; background: #111; display: grid; place-items: center; height: 100vh; }
  .player { position: relative; width: ${w}px; height: ${h}px; background: #1c1c1c; }
  video, .frame { width: 100%; height: 100%; background: linear-gradient(#333,#111); display: block; }
  .burn { position: absolute; left: 0; right: 0; top: 42%; text-align: center; color: #fff; font: italic 18px Georgia, serif; text-shadow: 0 1px 2px #000; }
  .native { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); background: #111; color: #fff; padding: 2px 8px; visibility: hidden; }
</style></head><body>
<div class="player" id="player"><div class="frame"></div><div class="burn">the fu*k alone!</div>
<div class="native" id="native">Leave that man the fuck alone</div>
<div class="ibt-x-overlay" id="cap" style="display:flex; position:absolute; left:50%; bottom:18px; transform:translateX(-50%); width:auto; max-width:90%;">
  <div class="ibt-yt-zh">別去打擾那個男人</div>
  <div class="ibt-yt-en">Leave that man the fuck alone</div>
</div></div>
<script>
  const player = document.getElementById('player');
  const cap = document.getElementById('cap');
  const vr = player.getBoundingClientRect();
  const size = Math.round(Math.min(32, Math.max(12, Math.min(vr.width, vr.height) * 0.046)));
  cap.style.fontSize = size + 'px';
  cap.style.bottom = '18px';
  document.title = ${JSON.stringify(label)};
</script></body></html>`;
writeFileSync('/tmp/ibt-144/sub-portrait.html', sub(360, 640, 'portrait'));
writeFileSync('/tmp/ibt-144/sub-landscape.html', sub(640, 360, 'landscape'));
const free = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(root + 'dist/bilingual.css').href}"><style>
  body { margin: 0; background: #fff; color: #1a1d29; font: 18px/1.5 Georgia, "PingFang TC", sans-serif; }
  main { max-width: 640px; margin: 48px auto; padding: 0 24px; }
  h1 { font-family: system-ui, sans-serif; }
  .ibt-block { margin: 4px 0 16px; }
</style></head><body><main><h1>OpenAI</h1>
${lines.map((l) => `<p>${l.text}</p><div class="ibt-block"><div class="ibt-trans" data-ibt-on="light"><span>${l.zh}</span></div></div>`).join('\n')}
</main></body></html>`;
writeFileSync('/tmp/ibt-144/free.html', free);

const port = 9391;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-144/profile', '--window-size=1280,900', 'about:blank',
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
await rpc('Runtime.enable');
await rpc('Page.addScriptToEvaluateOnNewDocument', { source: `window.chrome = {
  runtime: { getManifest: () => ({ version: '1.4.44' }), openOptionsPage() {}, sendMessage: async () => ({}) },
  storage: { sync: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
  tabs: { query: async () => [{ id: 1, url: 'https://example.com' }] },
  scripting: { executeScript: async () => {}, insertCSS: async () => {} },
};` });

async function shot(file, width, height, scheme) {
  await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme || 'light' }] });
  await rpc('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  await new Promise((r) => setTimeout(r, 80));
  const res = await rpc('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('wrote', file);
}
async function go(url) {
  await rpc('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 450));
}
await go(pathToFileURL(`${root}dist/options.html`).href);
const tall = await rpc('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true });
await shot(`${out}/options-dark-144.png`, 1280, Math.min(tall?.result?.value || 1400, 2200), 'dark');
await shot(`${out}/options-light-144.png`, 1280, Math.min(tall?.result?.value || 1400, 2200), 'light');
await go(pathToFileURL('/tmp/ibt-144/chip-dark.html').href);
await shot(`${out}/chip-dark-144.png`, 420, 220, 'dark');
await go(pathToFileURL('/tmp/ibt-144/chip-light.html').href);
await shot(`${out}/chip-light-144.png`, 420, 220, 'light');
await go(pathToFileURL('/tmp/ibt-144/sub-portrait.html').href);
await shot(`${out}/subs-portrait-144.png`, 480, 820, 'dark');
await go(pathToFileURL('/tmp/ibt-144/sub-landscape.html').href);
await shot(`${out}/subs-landscape-144.png`, 860, 520, 'dark');
await go(pathToFileURL('/tmp/ibt-144/free.html').href);
const freeH = await rpc('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true });
await shot(`${out}/free-engine-144.png`, 800, Math.min(freeH?.result?.value || 900, 1400), 'light');
ws.close();
proc.kill();
