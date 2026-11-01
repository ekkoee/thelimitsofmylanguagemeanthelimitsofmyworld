import { DEFAULT_SETTINGS } from '../src/core/types';
import { segment } from '../src/core/segmentation';
import { commentaryText } from '../src/content/linkedin';
import { renderTranslationAfter } from '../src/content/engine';
import { scanTwitter } from '../src/content/twitter';

function installChrome(): void {
  const chromeObj = {
    runtime: {
      id: 'fixture',
      lastError: undefined as { message?: string } | undefined,
      sendMessage(msg: { text?: string }, cb: (resp: unknown) => void) {
        const parts = segment(String(msg?.text || ''), 'en');
        cb({ ok: true, pairs: parts.map((s) => ({ o: s, t: `〔${s}〕` })) });
      },
    },
  };
  (globalThis as unknown as { chrome: typeof chromeObj }).chrome = chromeObj;
}

function shape(root: ParentNode) {
  return [...root.querySelectorAll('.ibt-block')].map((block) => ({
    lines: [...block.querySelectorAll('.ibt-trans')].map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()),
  }));
}

async function run(): Promise<void> {
  installChrome();
  const s = { ...DEFAULT_SETTINGS, enabled: true, translateOnVisible: false, targetLangCode: 'zh-TW' };
  scanTwitter(s);
  const li = document.getElementById('li');
  if (li) renderTranslationAfter(li, commentaryText(li), { sig: 'li' });
  await new Promise((r) => setTimeout(r, 30));
  const tweet = document.getElementById('tweet');
  const post = document.getElementById('post');
  const report = {
    x: tweet ? shape(tweet) : [],
    li: post ? shape(post) : [],
  };
  const slot = document.getElementById('report');
  if (slot) slot.textContent = JSON.stringify(report);
}

void run();
