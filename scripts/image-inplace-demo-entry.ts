import { selectInPlace } from '../src/providers/gemini-image';
import { renderRegions } from '../src/content/image-inplace';

/** Pixel rect on a canvas → [x, y, w, h] fractions, the form selectInPlace stores. */
function px(x: number, y: number, w: number, h: number, W: number, H: number): [number, number, number, number] {
  return [x / W, y / H, w / W, h / H];
}

const scenes: Record<string, { title: string; draw: (c: HTMLCanvasElement) => void; regions: { textEn: string; textZh: string; box: [number, number, number, number] }[] }> = {
  ft: {
    title: 'ft',
    draw(c) {
      const g = c.getContext('2d')!;
      c.width = 960; c.height = 640;
      g.fillStyle = '#f6f1e7'; g.fillRect(0, 0, 960, 640);
      g.fillStyle = '#222'; g.font = '28px sans-serif';
      g.fillText('Productivity is surging in AI-adopting sectors in the US, but not elsewhere', 28, 48);
      g.font = '16px sans-serif'; g.fillStyle = '#9a3030';
      g.fillText('Real output per worker in AI-adopting sectors (index, Q1 2012 = 100), vs 2012-19 trend', 28, 78);
      const names = ['US', 'UK', 'Canada', 'Australia', 'EU27', 'France', 'Germany', 'Sweden'];
      names.forEach((name, i) => {
        const col = i % 4; const row = Math.floor(i / 4);
        const x = 40 + col * 230; const y = 130 + row * 240;
        g.fillStyle = '#333'; g.font = '18px sans-serif'; g.fillText(name, x, y);
        g.strokeStyle = '#c23b3b'; g.beginPath(); g.moveTo(x, y + 150); g.lineTo(x + 180, y + 40); g.stroke();
        g.fillStyle = '#888'; g.font = '12px sans-serif';
        g.fillText('140', x - 8, y + 30); g.fillText('100', x - 8, y + 150);
        g.fillText('2014', x, y + 175); g.fillText('2026', x + 140, y + 175);
      });
      g.fillStyle = '#333'; g.font = '13px sans-serif';
      g.fillText('AI-adopting sectors: tech, finance, professional services. Sources: BEA, BLS, ONS', 28, 590);
      g.fillText('FT graphic: John Burn-Murdoch / @jburnmurdoch', 28, 612);
    },
    regions: [
      { textEn: 'Productivity is surging in AI-adopting sectors in the US, but not elsewhere', textZh: '美國採用 AI 的產業生產力激增，但其他地區則否', box: px(24, 22, 910, 34, 960, 640) },
      { textEn: 'Real output per worker in AI-adopting sectors (index, Q1 2012 = 100), vs 2012-19 trend', textZh: '採用 AI 的產業中每位工人的實際產出（指數，2012年第一季＝100），對比 2012-19 年趨勢', box: px(24, 58, 910, 26, 960, 640) },
      { textEn: 'US', textZh: '美國', box: px(40, 112, 48, 24, 960, 640) },
      { textEn: 'UK', textZh: '英國', box: px(270, 112, 48, 24, 960, 640) },
      { textEn: 'Canada', textZh: '加拿大', box: px(500, 112, 80, 24, 960, 640) },
      { textEn: 'Australia', textZh: '澳洲', box: px(730, 112, 100, 24, 960, 640) },
      { textEn: 'EU27', textZh: '歐盟27國', box: px(40, 352, 70, 24, 960, 640) },
      { textEn: 'France', textZh: '法國', box: px(270, 352, 70, 24, 960, 640) },
      { textEn: 'Germany', textZh: '德國', box: px(500, 352, 70, 24, 960, 640) },
      { textEn: 'Sweden', textZh: '瑞典', box: px(730, 352, 70, 24, 960, 640) },
      { textEn: '140', textZh: '140', box: px(28, 145, 28, 16, 960, 640) },
      { textEn: '2014', textZh: '2014', box: px(40, 300, 40, 16, 960, 640) },
      { textEn: 'AI-adopting sectors: tech, finance, professional services. Sources: BEA, BLS, ONS', textZh: '採用 AI 的產業：科技、金融、專業服務。資料來源：BEA、BLS、ONS', box: px(24, 574, 760, 20, 960, 640) },
      { textEn: 'FT graphic: John Burn-Murdoch / @jburnmurdoch', textZh: '金融時報圖表：John Burn-Murdoch / @jburnmurdoch', box: px(24, 596, 480, 22, 960, 640) },
    ],
  },
  article: {
    title: 'article',
    draw(c) {
      const g = c.getContext('2d')!;
      c.width = 880; c.height = 520;
      g.fillStyle = '#1c1c1c'; g.fillRect(0, 0, 880, 520);
      g.fillStyle = '#d0d0d0'; g.font = '18px sans-serif';
      const lines = [
        'Bret had a Windows app that was the mapping thing. It was not even web based.',
        'So they converted it to be a web based thing. And then the story I always',
        'remember with Bret is that he rewrote their entire JavaScript for Google',
        'Maps over a weekend. He is like a 100x, or 1,000x engineer.',
      ];
      lines.forEach((line, i) => g.fillText(line, 24, 80 + i * 32));
      const more = [
        'They show up on Monday and he has completely replaced all of the code.',
        'That is the kind of engineer Bret is, and the thing is, it is not bad code.',
      ];
      more.forEach((line, i) => g.fillText(line, 24, 280 + i * 32));
    },
    regions: [
      { textEn: 'Bret had a Windows app that was the mapping thing. It was not even web based. So they converted it to be a web based thing. And then the story I always remember with Bret is that he rewrote their entire JavaScript for Google Maps over a weekend. He is like a 100x, or 1,000x engineer.', textZh: '布雷特原本有一個 Windows 地圖應用程式，甚至不是網頁版。他們把它改成網頁版。我一直記得的是，他在一個週末內重寫了 Google 地圖的整份 JavaScript。他就像 100 倍、甚至 1,000 倍的工程師。', box: px(20, 58, 840, 140, 880, 520) },
      { textEn: 'They show up on Monday and he has completely replaced all of the code. That is the kind of engineer Bret is, and the thing is, it is not bad code.', textZh: '他們星期一出現時，他已經把所有程式碼換掉了。他就是那種工程師，而且重點是，那並不是爛程式碼。', box: px(20, 258, 840, 80, 880, 520) },
    ],
  },
  email: {
    title: 'email',
    draw(c) {
      const g = c.getContext('2d')!;
      c.width = 820; c.height = 640;
      g.fillStyle = '#f7f7f5'; g.fillRect(0, 0, 820, 640);
      g.fillStyle = '#222'; g.font = '20px sans-serif';
      g.fillText('Hi Scott,', 36, 48);
      g.font = '16px sans-serif';
      const lines = [
        "We've added support for text watermarking to SpaceXSI API outputs.",
        'Text outputs from the following models will include a watermark:',
        'grok-4.7', 'grok-4.6', 'grok-4.5',
        'Watermarking is on by default for all teams and will be enabled',
        'on November 7, 2026. If you believe an exception applies, you can',
        'opt out per model from the SpaceXSI Console. If you do not plan to',
        'opt out, no action is needed.',
      ];
      lines.forEach((line, i) => g.fillText(line, 36, 100 + i * 28));
    },
    regions: [
      { textEn: 'Hi Scott,', textZh: '斯科特你好，', box: px(36, 26, 160, 30, 820, 640) },
      { textEn: "We've added support for text watermarking to SpaceXSI API outputs. Text outputs from the following models will include a watermark:", textZh: '我們已新增對文字浮水印的支援，將預設包含浮水印：SpaceXSI API 的文字輸出將包含浮水印，適用模型如下。', box: px(36, 78, 740, 58, 820, 640) },
      { textEn: 'grok-4.7', textZh: 'grok-4.7', box: px(36, 156, 120, 26, 820, 640) },
      { textEn: 'Watermarking is on by default for all teams and will be enabled on November 7, 2026. If you believe an exception applies, you can opt out per model from the SpaceXSI Console. If you do not plan to opt out, no action is needed.', textZh: '浮水印預設為所有團隊開啟，並將於 2026 年 11 月 7 日啟用。如果您認為法律上的例外適用於您的使用，您可以在 SpaceXSI 控制台選擇退出。如果您不打算選擇退出，則無需採取任何行動。', box: px(36, 236, 740, 120, 820, 640) },
    ],
  },
};

const root = document.getElementById('scenes') as HTMLElement;
const only = location.hash.replace('#', '');
const list = only && scenes[only] ? [scenes[only]] : Object.values(scenes);
for (const scene of list) {
  const wrap = document.createElement('section');
  wrap.id = scene.title;
  const canvas = document.createElement('canvas');
  scene.draw(canvas);
  const img = document.createElement('img');
  img.src = canvas.toDataURL('image/png');
  img.style.display = 'block';
  img.width = canvas.width;
  img.height = canvas.height;
  const stage = document.createElement('div');
  stage.style.position = 'relative';
  stage.style.display = 'inline-block';
  stage.appendChild(img);
  wrap.appendChild(stage);
  root.appendChild(wrap);
  const overlay = document.createElement('div');
  overlay.className = 'ibt-img-overlay';
  overlay.style.position = 'absolute';
  overlay.style.left = '0';
  overlay.style.top = '0';
  overlay.style.width = `${canvas.width}px`;
  overlay.style.height = `${canvas.height}px`;
  stage.appendChild(overlay);
  const picked = selectInPlace(scene.regions);
  const skipped = scene.regions.length - picked.regions.length;
  renderRegions(overlay, img, canvas, picked.regions);
  const note = document.createElement('p');
  note.textContent = `${scene.title} mode=${picked.mode} painted=${picked.regions.length} skipped=${skipped}`;
  wrap.appendChild(note);
}
(document.getElementById('out') as HTMLElement).textContent = 'ready';
