// LinkedIn already-Chinese skip, English post, and an X-style fixture.
// Run: node scripts/shot-150.mjs
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const out = '/opt/cursor/artifacts';
mkdirSync('/tmp/ibt-150', { recursive: true });
mkdirSync(out, { recursive: true });
execSync(
  'npx esbuild scripts/lang-skip-entry.ts --bundle --format=iife --platform=browser --outfile=/tmp/ibt-150/skip.js --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const css = readFileSync(`${root}src/styles/bilingual.css`, 'utf8');

const mixed = `
  <span dir="ltr">進步不一定要更快<br><br>
  Progress Doesn't Always Mean Going Faster<br><br>
  人類經常用速度、產量與效率衡量進步。<br><br>
  然而，更快不一定代表更好，更多也不一定代表更幸福。<br><br>
  一個成熟的文明，不只是持續突破極限，也應該讓普通人有能力選擇自己的生活節奏。<br><br>
  科技的價值，不應只是要求人類完成更多工作，而是讓人類能夠用更少的負擔，創造更多可能。<br><br>
  真正的進步，也許不是讓每個人跑得更快，而是讓每個人都有自由決定自己的速度。
  </span>`;

const english = `
  <span dir="ltr">One month to go until Inspiration Through Innovation 2026.<br><br>
  Across two days at the Seco Innovation Hub, manufacturing leaders will come together.<br><br>
  From live machining demonstrations to an open partner showcase, the event is open.<br><br>
  Whether you are looking to improve productivity, we look forward to welcoming you.
  </span>`;

function shell(theme, body) {
  const dark = theme === 'dark';
  return `<!doctype html><html data-ibt-highlight="on" data-ibt-target="zh-TW" data-ibt-lang="zh-TW"><head><meta charset="utf-8"><style>
${css}
body { margin: 0; background: ${dark ? '#0e1116' : '#f3f2ef'}; color: ${dark ? '#e8e6e3' : '#191919'}; font: 15px/1.55 "Noto Sans CJK TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif; }
.card { width: 552px; margin: 28px auto; padding: 16px 20px 12px; background: ${dark ? '#1b1f23' : '#fff'}; border-radius: 12px; }
.name { font-weight: 650; font-size: 15px; }
.meta { color: ${dark ? '#b0b3b8' : '#666666'}; font-size: 12px; margin: 2px 0 12px; }
.post { font-size: 15px; }
h2 { font: 600 13px/1.4 sans-serif; margin: 22px auto 0; width: 552px; color: ${dark ? '#9aa0a6' : '#666'}; }
</style></head><body>${body}</body></html>`;
}

function card(id, inner) {
  return `<div class="card"><div class="name">Wen Daniel</div><div class="meta">AI Strategy &amp; Business Builder · 1 週</div><div class="update-components-text post" id="${id}">${inner}</div></div>`;
}

function chip(text, theme) {
  const on = theme === 'light' ? ' data-ibt-on="light"' : '';
  return `<div class="ibt-block ibt-uni" data-ibt-out="1" style="display:block;width:100%;font-size:15px;line-height:1.5"><div class="ibt-trans"${on}><span>${text}</span></div></div>`;
}

const dupLines = [
  ['進步不一定要更快', '進步不一定要更快'],
  ["Progress Doesn't Always Mean Going Faster", '進步不一定總是要更快'],
  ['人類經常用速度、產量與效率衡量進步。', '人類經常用速度、產量與效率衡量進步。'],
  ['然而，更快不一定代表更好，更多也不一定代表更幸福。', '然而，更快不一定代表更好，更多也不一定代表更幸福。'],
  ['一個成熟的文明，不只是持續突破極限，也應該讓普通人有能力選擇自己的生活節奏。', '一個成熟的文明，不只是持續突破極限，也應該讓普通人有能力選擇自己的生活節奏。'],
  ['科技的價值，不應只是要求人類完成更多工作，而是讓人類能夠用更少的負擔，創造更多可能。', '科技的價值，不應只是要求人類完成更多工作，而是讓人類能夠用更少的負擔，創造更多可能。'],
  ['真正的進步，也許不是讓每個人跑得更快，而是讓每個人都有自由決定自己的速度。', '真正的進步，也許不是讓每個人跑得更快，而是讓每個人都有自由決定自己的速度。'],
];

function beforeBody(theme) {
  const lines = dupLines.map(([src, tr]) => `${src}<br>${chip(tr, theme)}`).join('<br>');
  return card('before', `<span dir="ltr">${lines}</span>`);
}

const xPosts = [
  ['zh', '今天把這段中文寫完，就不需要再翻譯一次。'],
  ['en', 'Shipping a small fix is better than rewriting the pipeline.'],
  ['mix', 'I still translate this sentence even with the word 進步 in it.'],
];

function xBody() {
  return xPosts.map(([id, text]) => `<div class="card"><div class="name">Example</div><div class="meta">@example</div><div class="post" id="x-${id}" data-testid="tweetText">${text}</div></div>`).join('');
}

writeFileSync('/tmp/ibt-150/before-light.html', shell('light', beforeBody('light')));
writeFileSync('/tmp/ibt-150/before-dark.html', shell('dark', beforeBody('dark')));
writeFileSync('/tmp/ibt-150/after-light.html', shell('light', card('body', mixed) + '<h2>英文貼文，每一行仍翻譯</h2>' + card('en', english)));
writeFileSync('/tmp/ibt-150/after-dark.html', shell('dark', card('body', mixed) + '<h2>英文貼文，每一行仍翻譯</h2>' + card('en', english)));
writeFileSync('/tmp/ibt-150/x-light.html', shell('light', xBody()));
writeFileSync('/tmp/ibt-150/x-dark.html', shell('dark', xBody()));
writeFileSync('/tmp/ibt-150/pure.html', shell('light', card('pure', '<span dir="ltr">這整則都是中文，不應該再翻譯一次。<br><br>第二行也是中文。</span>') + card('body', mixed)));

const port = 9415;
const proc = spawn('/opt/google/chrome/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`,
  '--user-data-dir=/tmp/ibt-150/profile', 'about:blank',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const tab = list.find((t) => t.type === 'page');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
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
const src = pathToFileURL('/tmp/ibt-150/skip.js').href;

async function open(file) {
  await rpc('Page.navigate', { url: pathToFileURL(`/tmp/ibt-150/${file}`).href });
  await new Promise((r) => setTimeout(r, 250));
  await rpc('Runtime.evaluate', {
    expression: `new Promise((resolve) => { const s = document.createElement('script'); s.src = ${JSON.stringify(src)}; s.onload = () => resolve(true); document.documentElement.appendChild(s); })`,
    awaitPromise: true,
  });
}
async function shot(file, width) {
  const h = await rpc('Runtime.evaluate', { expression: 'Math.ceil(document.documentElement.scrollHeight)', returnByValue: true });
  await rpc('Emulation.setDeviceMetricsOverride', {
    width, height: Math.max(200, h?.result?.value || 800), deviceScaleFactor: 2, mobile: false,
  });
  await new Promise((r) => setTimeout(r, 80));
  const image = await rpc('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(image.data, 'base64'));
  console.log('wrote', file);
}

let failed = 0;
function expect(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error('FAIL', name, JSON.stringify(got), 'want', JSON.stringify(want)); }
  else console.log('ok', name);
}

await open('pure.html');
const kept = await rpc('Runtime.evaluate', {
  expression: `(() => {
    const lang = 'zh-TW';
    const pure = document.getElementById('pure');
    const body = document.getElementById('body');
    const units = window.__ibt.units(document.body).map((u) => u.element.id);
    return {
      units,
      pure: window.__ibt.payload(pure, pure.innerText, lang),
      mixed: window.__ibt.payload(body, body.innerText, lang),
    };
  })()`,
  returnByValue: true,
});
const keep = kept?.result?.value;
console.log('units', JSON.stringify(keep));
expect('pure dropped', keep?.pure, null);
expect('mixed payload is the heading', keep?.mixed, "Progress Doesn't Always Mean Going Faster");
if (!keep?.units?.includes('body')) { failed++; console.error('FAIL mixed unit dropped', keep?.units); }
else console.log('ok mixed unit kept');
if (keep?.units?.includes('pure')) { failed++; console.error('FAIL pure unit kept'); }
else console.log('ok pure unit absent');

async function translate(file) {
  await open(file);
  await rpc('Runtime.evaluate', {
    expression: `new Promise((r) => { window.__ibt.go(document.getElementById('body')); window.__ibt.go(document.getElementById('en')); setTimeout(() => { window.__ibt.refresh(); r(true); }, 80); })`,
    awaitPromise: true,
  });
  return rpc('Runtime.evaluate', {
    expression: `(() => ({
      mixed: [...document.getElementById('body').querySelectorAll('.ibt-trans')].map((n) => n.textContent),
      english: [...document.querySelectorAll('#en .ibt-trans, #en + .ibt-block .ibt-trans')].map((n) => n.textContent),
      enLines: window.__ibt.lines(document.getElementById('en')).length,
    }))()`,
    returnByValue: true,
  });
}

const light = (await translate('after-light.html'))?.result?.value;
console.log('after light', JSON.stringify(light));
expect('only the heading', light?.mixed, ['進步不一定總是要更快']);
expect('english line count', light?.english?.length, light?.enLines);
if (!light?.english?.length || light.english.length < 4) { failed++; console.error('FAIL english post', light); }
else console.log('ok english lines', light.english.length);

await open('before-light.html');
await shot(`${out}/linkedin-before-light-150.png`, 640);
await open('before-dark.html');
await shot(`${out}/linkedin-before-dark-150.png`, 640);
await translate('after-light.html');
await shot(`${out}/linkedin-after-light-150.png`, 640);
await translate('after-dark.html');
await shot(`${out}/linkedin-after-dark-150.png`, 640);

await open('x-light.html');
await rpc('Runtime.evaluate', {
  expression: `(() => {
    const lang = 'zh-TW';
    for (const id of ['zh', 'en', 'mix']) {
      const el = document.getElementById('x-' + id);
      const text = el.innerText.trim();
      if (window.__ibt.skip(text, lang)) continue;
      const block = document.createElement('div');
      block.className = 'ibt-block';
      block.innerHTML = '<div class="ibt-trans" data-ibt-on="light"><span>' + (id === 'en' ? '小修比重寫整條管線更好。' : '這句話裡即使有一個中文詞，也應該翻譯。') + '</span></div>';
      el.insertAdjacentElement('afterend', block);
    }
    window.__ibt.refresh();
    return {
      zh: window.__ibt.skip(document.getElementById('x-zh').innerText, lang),
      en: window.__ibt.skip(document.getElementById('x-en').innerText, lang),
      mix: window.__ibt.skip(document.getElementById('x-mix').innerText, lang),
      chips: document.querySelectorAll('.ibt-trans').length,
    };
  })()`,
  returnByValue: true,
});
const xlight = (await rpc('Runtime.evaluate', {
  expression: `({ zh: window.__ibt.skip(document.getElementById('x-zh').innerText, 'zh-TW'), en: window.__ibt.skip(document.getElementById('x-en').innerText, 'zh-TW'), mix: window.__ibt.skip(document.getElementById('x-mix').innerText, 'zh-TW'), chips: document.querySelectorAll('.ibt-trans').length })`,
  returnByValue: true,
}))?.result?.value;
console.log('x', JSON.stringify(xlight));
expect('x chinese skipped', xlight?.zh, true);
expect('x english translated', xlight?.en, false);
expect('x mixed translated', xlight?.mix, false);
expect('x chip count', xlight?.chips, 2);
await shot(`${out}/x-fixture-light-150.png`, 640);

await open('x-dark.html');
await rpc('Runtime.evaluate', {
  expression: `(() => {
    const lang = 'zh-TW';
    for (const id of ['zh', 'en', 'mix']) {
      const el = document.getElementById('x-' + id);
      if (window.__ibt.skip(el.innerText.trim(), lang)) continue;
      const block = document.createElement('div');
      block.className = 'ibt-block';
      block.innerHTML = '<div class="ibt-trans"><span>' + (id === 'en' ? '小修比重寫整條管線更好。' : '這句話裡即使有一個中文詞，也應該翻譯。') + '</span></div>';
      el.insertAdjacentElement('afterend', block);
    }
    window.__ibt.refresh();
    return true;
  })()`,
  returnByValue: true,
});
await shot(`${out}/x-fixture-dark-150.png`, 640);

ws.close();
proc.kill();
if (failed) {
  console.error(failed, 'failed');
  process.exit(1);
}
console.log('PASS');
