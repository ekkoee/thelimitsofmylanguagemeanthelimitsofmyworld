import { expandChips, protectFlow } from '../src/content/x-chips';

function mangle(src: string): string {
  if (/@\w|#\w|https?:|theinformation\.com/.test(src)) {
    return src
      .replace(/@JuroOsawa/g, '@大澤十郎')
      .replace(/@QianerLiu/g, '@劉倩兒')
      .replace(/@theinformation/g, '@訊息')
      .replace(/#OpenAI/g, '#標籤')
      .replace(/theinformation\.com\S*/g, 'theinformation.com/模型');
  }
  return `譯 ${src}`;
}

const tweet = document.getElementById('tweet') as HTMLElement;
const raw = (tweet.innerText || '').replace(/\s+/g, ' ').trim();
const flow = protectFlow(tweet);
const host = document.getElementById('out') as HTMLElement;
const line = document.createElement('div');
line.className = 'ibt-trans ibt-flow';
for (const node of expandChips(mangle(flow.text), flow.chips)) line.appendChild(node);
host.appendChild(line);
const links = [...line.querySelectorAll('a')].map((a) => ({
  label: a.textContent,
  href: a.getAttribute('href'),
}));
const broken = document.getElementById('br') as HTMLElement;
const brFlow = protectFlow(broken);
(document.getElementById('result') as HTMLElement).textContent = JSON.stringify({
  raw,
  protected: flow.text,
  sentHasAt: /@\w/.test(flow.text),
  sentHasUrl: /theinformation\.com/.test(flow.text),
  mangledRaw: mangle(raw),
  rendered: (line.innerText || '').replace(/\s+/g, ' ').trim(),
  links,
  br: brFlow.text,
});
