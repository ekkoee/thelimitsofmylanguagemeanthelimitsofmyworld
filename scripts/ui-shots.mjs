// Screenshots of the popup, options page, and selection card.
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
mkdirSync('/tmp/ibt-ui', { recursive: true });
mkdirSync('/opt/cursor/artifacts', { recursive: true });
execSync(
  'npx esbuild scripts/selection-entry.ts --bundle --format=iife --platform=browser --outfile=/tmp/ibt-ui/selection.js --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const css = readFileSync(`${root}src/styles/bilingual.css`, 'utf8');
function selectionPage(dark) {
  const bg = dark ? '#141311' : '#f7f4ee';
  const fg = dark ? '#f4f1ea' : '#241f18';
  return `<!doctype html><meta charset="utf-8"><style>${css}
    body { margin: 48px; background: ${bg}; color: ${fg}; font: 18px/1.6 Georgia, serif; }
    p { max-width: 520px; }
  </style><body>
  <p id="story">The city opened a new library beside the river this morning.</p>
  <script>
  window.chrome = { runtime: { sendMessage: async (msg) => {
    if (msg.type === 'lookup') return { ok: true, lookup: { translation: '圖書館', sourceLang: 'en', dict: [{ pos: '名詞', terms: ['圖書館', '藏書樓'] }] } };
    return { ok: true, pairs: [{ o: msg.text, t: '這座城市今早在河邊開了一座新圖書館。' }] };
  }}};
  </script>
  <script src="file:///tmp/ibt-ui/selection.js"></script>
  </body>`;
}
writeFileSync('/tmp/ibt-ui/light.html', selectionPage(false));
writeFileSync('/tmp/ibt-ui/dark.html', selectionPage(true));

const port = 9366;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-ui/profile', '--window-size=900,800', 'about:blank',
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
await rpc('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.chrome = {
    storage: { sync: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
    tabs: { query: async () => [{ id: 1, url: 'https://example.com/story' }] },
    runtime: { openOptionsPage() {}, sendMessage: async () => ({ ok: true, pairs: [] }) },
    scripting: { executeScript: async () => {}, insertCSS: async () => {} },
  };`,
});

async function shot(file, width, height) {
  await rpc('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  const res = await rpc('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('wrote', file);
}

async function scheme(value) {
  await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
}

async function openSelection(file) {
  await rpc('Page.navigate', { url: pathToFileURL(file).href });
  await new Promise((r) => setTimeout(r, 400));
  await rpc('Runtime.evaluate', { expression: `
    const p = document.getElementById('story');
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
  ` });
  await new Promise((r) => setTimeout(r, 400));
  await rpc('Runtime.evaluate', { expression: `document.querySelector('.ibt-sel-btn')?.click()` });
  await new Promise((r) => setTimeout(r, 300));
}

await scheme('light');
await openSelection('/tmp/ibt-ui/light.html');
await shot('/opt/cursor/artifacts/selection-popup-light.png', 860, 420);
await scheme('dark');
await openSelection('/tmp/ibt-ui/dark.html');
await shot('/opt/cursor/artifacts/selection-popup-dark.png', 860, 420);

const dist = pathToFileURL(`${root}dist/`).href;
async function openExt(name) {
  await rpc('Page.navigate', { url: `${dist}${name}` });
  await new Promise((r) => setTimeout(r, 400));
}
await scheme('light');
await openExt('popup.html');
await shot('/opt/cursor/artifacts/after-popup-light.png', 360, 560);
await scheme('dark');
await openExt('popup.html');
await shot('/opt/cursor/artifacts/after-popup-dark.png', 360, 560);
await scheme('light');
await openExt('options.html');
await shot('/opt/cursor/artifacts/after-options-light.png', 760, 980);
await rpc('Runtime.evaluate', { expression: `document.querySelector('input[name="marker"][value="tint"]').click()` });
await new Promise((r) => setTimeout(r, 150));
await shot('/opt/cursor/artifacts/after-options-tint.png', 760, 980);
await scheme('dark');
await openExt('options.html');
await shot('/opt/cursor/artifacts/after-options-dark.png', 760, 980);
ws.close();
proc.kill();
console.log('ui shots done');
