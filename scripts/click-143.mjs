import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
mkdirSync('/tmp/ibt-143', { recursive: true });
mkdirSync('/opt/cursor/artifacts', { recursive: true });
const port = 9387;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-143/profile', '--window-size=1100,900', 'about:blank',
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
  runtime: { getManifest: () => ({ version: '1.4.43' }), openOptionsPage() {}, sendMessage: async () => ({}) },
  storage: { sync: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
  tabs: { query: async () => [{ id: 1, url: 'https://example.com' }] },
  scripting: { executeScript: async () => {}, insertCSS: async () => {} },
};` });
await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await rpc('Page.navigate', { url: pathToFileURL(`${root}dist/options.html`).href });
await new Promise((r) => setTimeout(r, 500));
await rpc('Emulation.setDeviceMetricsOverride', { width: 980, height: 900, deviceScaleFactor: 2, mobile: false });

const clicks = await rpc('Runtime.evaluate', { expression: `(() => {
  const hit = (el) => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return document.elementFromPoint(r.left + Math.min(r.width / 2, 12), r.top + r.height / 2);
  };
  const click = (el) => {
    const target = hit(el);
    if (!target) return null;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return target;
  };
  const results = [];
  const checkToggle = (id, labelId) => {
    const input = document.getElementById(id);
    const label = document.getElementById(labelId);
    const row = label.parentElement;
    const before = input.checked;
    click(label);
    const afterLabel = input.checked;
    const r = row.getBoundingClientRect();
    const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    mid.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const afterMid = input.checked;
    const sw = input.closest('.switch');
    sw.scrollIntoView({ block: 'center' });
    sw.click();
    const afterSwitch = input.checked;
    results.push({ id, afterLabel: afterLabel === before, afterMid: afterMid === before, switchFlipped: afterSwitch !== before, midTag: mid.tagName + '.' + (mid.id || mid.className) });
    input.checked = before;
  };
  checkToggle('transHighlight', 'highlightLabel');
  checkToggle('selectionTranslate', 'selectionLabel');
  checkToggle('selectionInstant', 'instantLabel');
  const color = (id, labelId) => {
    const input = document.getElementById(id);
    const label = document.getElementById(labelId);
    input.blur();
    click(label);
    const labelFocused = document.activeElement === input;
    const line = label.nextElementSibling;
    const lr = line.getBoundingClientRect();
    const empty = document.elementFromPoint(lr.left + lr.width * 0.55, lr.top + lr.height / 2);
    empty.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const emptyFocused = document.activeElement === input;
    const wrap = input.parentElement;
    wrap.scrollIntoView({ block: 'center' });
    const wr = wrap.getBoundingClientRect();
    const boxHit = document.elementFromPoint(wr.left + wr.width / 2, wr.top + wr.height / 2);
    input.click();
    const boxFocused = document.activeElement === input;
    results.push({ id, labelFocused, emptyFocused, boxFocused, boxHit: boxHit && (boxHit.id || boxHit.className), emptyTag: empty.tagName + '.' + (empty.id || empty.className) });
    input.blur();
  };
  color('transColor', 'transColorLabel');
  color('barColor', 'barColorLabel');
  return results;
})()`, returnByValue: true });
console.log(JSON.stringify(clicks, null, 2));
const rows = clicks?.result?.value || [];
const bad = rows.some((row) => row.afterLabel === false || row.afterMid === false || row.switchFlipped === false || row.labelFocused || row.emptyFocused || (row.boxHit && row.boxHit !== row.id));
if (bad || rows.length < 5) {
  console.error('click target test failed');
  process.exitCode = 1;
} else console.log('CLICK PASS');
const gaps = await rpc('Runtime.evaluate', { expression: `(() => {
  const p = document.getElementById('provider');
  p.value = 'gemini';
  p.dispatchEvent(new Event('change'));
  const note = document.getElementById('keyNote');
  note.textContent = '已儲存';
  note.dataset.state = 'ok';
  const model = document.getElementById('model').getBoundingClientRect();
  const image = document.getElementById('imageModel').closest('.field').getBoundingClientRect();
  const lang = document.getElementById('lang').closest('.field').getBoundingClientRect();
  const order = document.getElementById('order').closest('.field').getBoundingClientRect();
  return {
    modelToImage: Math.round(image.top - model.bottom),
    imageToLang: Math.round(lang.top - document.getElementById('imageModel').getBoundingClientRect().bottom),
    langToOrder: Math.round(order.top - document.getElementById('lang').getBoundingClientRect().bottom),
  };
})()`, returnByValue: true });
console.log('gaps', JSON.stringify(gaps?.result?.value));

async function shotPanel(sel, file) {
  const box = await rpc('Runtime.evaluate', { expression: `(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    window.scrollTo(0, Math.max(0, el.offsetTop - 16));
    return el.offsetHeight + 40;
  })()`, returnByValue: true });
  await rpc('Emulation.setDeviceMetricsOverride', { width: 860, height: box?.result?.value || 700, deviceScaleFactor: 2, mobile: false });
  await rpc('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'start'})` });
  await new Promise((r) => setTimeout(r, 60));
  const res = await rpc('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log('wrote', file);
}
await rpc('Runtime.evaluate', { expression: `(() => {
  const p = document.getElementById('provider');
  p.value = 'gemini';
  p.dispatchEvent(new Event('change'));
  const note = document.getElementById('keyNote');
  note.textContent = '已儲存';
  note.dataset.state = 'ok';
})()` });
await shotPanel('[data-panel="general"]', '/opt/cursor/artifacts/options-translate-key.png');
await rpc('Runtime.evaluate', { expression: `document.getElementById('resetDefaults').click()` });
await shotPanel('[data-panel="look"]', '/opt/cursor/artifacts/options-reset-confirm.png');
await shotPanel('[data-panel="advanced"]', '/opt/cursor/artifacts/options-highlight-section.png');
await rpc('Page.navigate', { url: pathToFileURL(`${root}dist/popup.html`).href });
await new Promise((r) => setTimeout(r, 400));
await rpc('Emulation.setDeviceMetricsOverride', { width: 320, height: 400, deviceScaleFactor: 2, mobile: false });
const popupClick = await rpc('Runtime.evaluate', { expression: `(() => {
  const input = document.getElementById('enabled');
  const before = input.checked;
  document.querySelector('h1').click();
  const afterTitle = input.checked;
  document.querySelector('label.switch').click();
  const afterSwitch = input.checked;
  return { titleIgnored: afterTitle === before, switchFlipped: afterSwitch !== before };
})()`, returnByValue: true });
console.log('popup', JSON.stringify(popupClick?.result?.value));
if (!popupClick?.result?.value?.titleIgnored || !popupClick?.result?.value?.switchFlipped) process.exitCode = 1;
ws.close();
proc.kill();
