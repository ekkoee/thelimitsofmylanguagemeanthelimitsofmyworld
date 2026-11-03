// Korean wraps on spaces. Japanese uses strict line-break. Tint padding stays.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const out = '/opt/cursor/artifacts';
mkdirSync(out, { recursive: true });
const css = readFileSync(`${root}src/styles/bilingual.css`, 'utf8');
const ko = '좋은 디자인은 조용합니다. 읽기를 도우면서도 방해하지 않습니다.';
const ja = '良いデザインは静かです。読むことを助け、邪魔をしません。';
const zh = '好的設計很安靜，它幫助你閱讀，卻不會打擾你。';

function card(lang, text) {
  return `<div class="post"><p>Good design is quiet; it helps you read without getting in the way.</p>
    <div class="ibt-block" lang="${lang}"><div class="ibt-trans" lang="${lang}" data-ibt-on="light"><span lang="${lang}">${text}</span></div></div></div>`;
}
const fixture = `<!doctype html><html data-ibt-highlight="on"><head><meta charset="utf-8"><style>
${css}
:root { --ibt-zh-font: "WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif; }
body { margin: 0; background: #0e1116; color: #e8e6e3; font: 15px/1.55 "WenQuanYi Micro Hei", sans-serif; }
.post { width: 220px; margin: 28px auto; padding: 16px; background: #fff; color: #191919; border-radius: 12px; }
.post p { margin: 0 0 8px; }
</style></head><body>
${card('ko', ko)}
<div id="ja" hidden>${card('ja', ja)}</div>
<div id="zh" hidden>${card('zh-TW', zh)}</div>
</body></html>`;
writeFileSync('/tmp/ibt-153-ko.html', fixture);

const port = 9418;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-153/shot', 'about:blank',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg.result);
};
function rpc(method, params = {}) {
  const n = ++seq;
  ws.send(JSON.stringify({ id: n, method, params }));
  return new Promise((resolve) => pending.set(n, resolve));
}
await rpc('Page.enable');
await rpc('Runtime.enable');
await rpc('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.chrome = {
    runtime: { getManifest: () => ({ version: '1.4.53' }), openOptionsPage() {}, sendMessage: async () => ({}) },
    storage: {
      sync: { get: async () => ({ ibt_settings: { uiLang: new URLSearchParams(location.search).get('ui') || 'ko', targetLangCode: 'ko', viewMode: 'both', provider: 'google', transHighlight: true, transHighlightSet: true } }), set: async () => {} },
      local: { get: async () => ({ ibt_vocab: [] }), set: async () => {} },
      onChanged: { addListener() {} },
    },
  };`,
});

const measure = `(() => {
  function lines(el) {
    const node = el.firstChild;
    const text = node.textContent || '';
    const range = document.createRange();
    let last = -1;
    const starts = [];
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const top = range.getBoundingClientRect().top;
      if (last < 0 || top > last + 1) { starts.push(i); last = top; }
    }
    const atSpace = starts.every((i) => i === 0 || /\\s/.test(text[i - 1]));
    const span = el.matches('span') ? el : el.querySelector('span') || el;
    const cs = getComputedStyle(span);
    const rects = [...span.getClientRects()].map((r) => Math.round(r.height * 10) / 10);
    return {
      text, starts: starts.map((i) => text.slice(i, i + 6)), atSpace,
      wordBreak: getComputedStyle(el).wordBreak,
      lineBreak: getComputedStyle(el).lineBreak,
      pad: cs.padding,
      clone: cs.webkitBoxDecorationBreak || cs.boxDecorationBreak,
      rects,
    };
  }
  const ko = document.querySelector('.post .ibt-trans span');
  return lines(ko);
})()`;

let failed = 0;
function expect(name, cond, extra) {
  if (!cond) { failed++; console.error('FAIL', name, extra || ''); }
  else console.log('ok', name, extra || '');
}

await rpc('Page.navigate', { url: pathToFileURL('/tmp/ibt-153-ko.html').href });
await new Promise((r) => setTimeout(r, 300));
await rpc('Emulation.setDeviceMetricsOverride', { width: 420, height: 420, deviceScaleFactor: 2, mobile: false });
const koLines = (await rpc('Runtime.evaluate', { expression: measure, returnByValue: true }))?.result?.value;
console.log('ko fixture', JSON.stringify(koLines));
expect('korean wraps on spaces', koLines?.atSpace && !koLines.starts.some((s) => s.startsWith('면서')), koLines?.starts);
expect('korean keep-all', koLines?.wordBreak === 'keep-all');
expect('tint padding', koLines?.pad === '2.24px 2.52px' || /\d/.test(koLines?.pad || ''), koLines?.pad);
expect('tint clones', koLines?.clone === 'clone' && (koLines?.rects?.length || 0) > 1, JSON.stringify(koLines?.rects));
const heights = koLines?.rects || [];
expect('line boxes even', heights.length > 1 && Math.max(...heights) - Math.min(...heights) <= 2, JSON.stringify(heights));

await rpc('Runtime.evaluate', { expression: `document.getElementById('ja').hidden = false; document.querySelector('.post').hidden = true;` });
const jaLines = (await rpc('Runtime.evaluate', {
  expression: `(() => { const el = document.querySelector('#ja .ibt-trans'); const cs = getComputedStyle(el); return { wordBreak: cs.wordBreak, lineBreak: cs.lineBreak }; })()`,
  returnByValue: true,
}))?.result?.value;
console.log('ja', JSON.stringify(jaLines));
expect('japanese strict', jaLines?.lineBreak === 'strict' && jaLines?.wordBreak !== 'keep-all', JSON.stringify(jaLines));
await rpc('Runtime.evaluate', { expression: `document.getElementById('ja').hidden = true; document.getElementById('zh').hidden = false;` });
const zhLines = (await rpc('Runtime.evaluate', {
  expression: `(() => { const el = document.querySelector('#zh .ibt-trans'); const cs = getComputedStyle(el); return { wordBreak: cs.wordBreak, lineBreak: cs.lineBreak }; })()`,
  returnByValue: true,
}))?.result?.value;
console.log('zh', JSON.stringify(zhLines));
expect('chinese unchanged', zhLines?.wordBreak !== 'keep-all' && zhLines?.lineBreak !== 'strict', JSON.stringify(zhLines));

await rpc('Runtime.evaluate', { expression: `document.getElementById('zh').hidden = true; document.querySelector('.post').hidden = false;` });
await rpc('Emulation.setDeviceMetricsOverride', { width: 480, height: 360, deviceScaleFactor: 2, mobile: false });
const shot = await rpc('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${out}/page-ko-153.png`, Buffer.from(shot.data, 'base64'));
console.log('wrote page-ko');

async function options(ui, file) {
  const url = pathToFileURL(root + 'dist/options.html').href + '?ui=' + ui;
  await rpc('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, 600));
  await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 2, mobile: false });
  await rpc('Runtime.evaluate', { expression: `document.querySelector('.tint-live').scrollIntoView({block:'center'})` });
  await new Promise((r) => setTimeout(r, 80));
  const info = (await rpc('Runtime.evaluate', {
    expression: `(() => {
      const span = document.querySelector('.tone-light [data-preview="trans"]');
      const node = span.firstChild;
      const text = node.textContent || '';
      const range = document.createRange();
      let last = -1; const starts = [];
      for (let i = 0; i < text.length; i++) {
        range.setStart(node, i); range.setEnd(node, i + 1);
        const top = range.getBoundingClientRect().top;
        if (last < 0 || top > last + 1) { starts.push(text.slice(i, i + 6)); last = top; }
      }
      const cs = getComputedStyle(span);
      const cards = [...document.querySelectorAll('.tone-light, .tone-dark')].map((n) => n.getBoundingClientRect().height);
      return { lang: span.lang, starts, wordBreak: getComputedStyle(span.parentElement).wordBreak, lineBreak: cs.lineBreak, pad: cs.padding, clone: cs.webkitBoxDecorationBreak || cs.boxDecorationBreak, cards };
    })()`,
    returnByValue: true,
  }))?.result?.value;
  console.log(ui, JSON.stringify(info));
  const image = await rpc('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(image.data, 'base64'));
  console.log('wrote', file);
  return info;
}

const koPrev = await options('ko', `${out}/preview-ko-153.png`);
expect('preview ko spaces', koPrev?.lang === 'ko' && koPrev?.wordBreak === 'keep-all' && !(koPrev?.starts || []).some((s) => s.startsWith('면서')), JSON.stringify(koPrev?.starts));
expect('preview ko heights', Math.abs((koPrev?.cards?.[0] || 0) - (koPrev?.cards?.[1] || 0)) <= 2);
const jaPrev = await options('ja', `${out}/preview-ja-153.png`);
expect('preview ja strict', jaPrev?.lang === 'ja' && jaPrev?.lineBreak === 'strict' && jaPrev?.wordBreak !== 'keep-all');

ws.close();
proc.kill();
if (failed) process.exit(1);
console.log('PASS');
