// Label vs prose, and Alt+A key detection. Run: node scripts/page-translate-test.mjs
import { execSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
execSync(
  'npx esbuild src/content/blocks.ts --bundle --platform=node --format=esm --outfile=/tmp/blocks.test.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
execSync(
  'npx esbuild src/content/alt-a-key.ts --bundle --platform=node --format=esm --outfile=/tmp/alt-a-key.test.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
execSync(
  'npx esbuild src/content/linkedin.ts --bundle --platform=node --format=esm --outfile=/tmp/linkedin.test.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
execSync(
  'npx esbuild src/content/universal.ts --bundle --platform=node --format=esm --outfile=/tmp/universal.test.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const { isShortLabel, isShortcutHint } = await import('/tmp/blocks.test.mjs');
const { isAltA } = await import('/tmp/alt-a-key.test.mjs');
const { controlFromElement, linkedInCollapsed, commentaryText } = await import('/tmp/linkedin.test.mjs');
const { chineseSkipReason } = await import('/tmp/universal.test.mjs');

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}

check('debug is a label', isShortLabel('Debug'));
check('create issue is a label', isShortLabel('Create issue'));
check('search placeholder is a label', isShortLabel('Type / to search'));
check('optimized for balance is a label', isShortLabel('Optimized for: Balance'));
check('greeting is a short label', isShortLabel('Good morning, ekkoee!'));
check('four-word title is a label by length', isShortLabel('Fix the login bug'));
check('sentence is not a label', !isShortLabel('The inline player overlapped the English caption.'));
check('readme sentence is not a label', !isShortLabel('This release adds bilingual subtitles for videos inside posts on X.'));
check('shortcut hint', isShortcutHint('Open menu home (g then d)'));
check('chinese shortcut hint', isShortcutHint('開啟選單首頁 (g 然後 d)'));
check('prose is not a shortcut', !isShortcutHint('The inline player overlapped the English caption and needs a gap.'));

const base = { altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false };
check('physical KeyA', isAltA({ ...base, code: 'KeyA', key: 'å' }));
check('letter a', isAltA({ ...base, code: '', key: 'a' }));
check('shift is not alt-a', !isAltA({ ...base, shiftKey: true, code: 'KeyA', key: 'A' }));
check('repeat ignored', !isAltA({ ...base, repeat: true, code: 'KeyA', key: 'a' }));
check('key b ignored', !isAltA({ ...base, code: 'KeyB', key: 'b' }));

const post = 'Leading aerospace manufacturers have proven that larger, more complex aluminum aerostructures can be produced with shorter cycle times and greater efficiency using Makino machining solutions.';
const zhShell = `首頁 人脈 職缺 訊息 通知 顯示翻譯 讚 留言 轉發 傳送 推薦給你 加為好友 關注 排序依據 最相關 `.repeat(8) + `\n${post}`;
check('english post is not skipped on linkedin zh shell', chineseSkipReason('www.linkedin.com', post, zhShell, 'zh-TW') === '');
check('same english post is skipped on github zh shell', chineseSkipReason('github.com', post, zhShell, 'zh-TW') === 'shell');
check('chinese unit is skipped on linkedin', chineseSkipReason('www.linkedin.com', '牧野這次展示大型航太鋁件的加工節拍可以再縮短，而且精度維持得住。', zhShell, 'zh-TW') === 'target');

let parseHTML = null;
try {
  ({ parseHTML } = await import(process.env.LINKEDOM || 'linkedom'));
} catch {
  console.log('SKIP linkedin DOM fixtures (install linkedom or set LINKEDOM)');
}
if (parseHTML) {
const { document } = parseHTML('<!doctype html><html><body></body></html>');

function mount(html) {
  document.body.innerHTML = html;
  return document.body;
}

const truncated = mount(`
  <div class="feed-shared-update-v2" role="article">
    <div class="update-components-text">
      <span>${post}<button class="feed-shared-inline-show-more-text__see-more-less-toggle see-more" aria-expanded="false" type="button"><span aria-hidden="true">…更多</span></button></span>
      <button class="feed-shared-see-translation-button" type="button">顯示翻譯</button>
    </div>
  </div>`);
const body = truncated.querySelector('.update-components-text');
const more = truncated.querySelector('.see-more');
const showTr = truncated.querySelector('.feed-shared-see-translation-button');
check('see-more is expand', controlFromElement(more) === 'expand');
check('顯示翻譯 is not a more button', controlFromElement(showTr) === 'translation');
check('truncated post is collapsed', linkedInCollapsed(body, 'www.linkedin.com'));
check('collapsed is ignored off linkedin', !linkedInCollapsed(body, 'github.com'));
check('commentary drops the more label', commentaryText(body).includes('Makino') && !commentaryText(body).includes('更多'));

more.setAttribute('aria-expanded', 'true');
more.className = 'feed-shared-inline-show-more-text__see-more-less-toggle see-less';
check('expanded toggle is not collapsed', !linkedInCollapsed(body, 'www.linkedin.com'));

const labelOnly = mount(`
  <div class="feed-shared-inline-show-more-text">
    <p>${post}</p>
    <button type="button" aria-expanded="false">… 更多</button>
  </div>`);
check('localized 更多 label expands', controlFromElement(labelOnly.querySelector('button')) === 'expand');
check('label-only clamp is collapsed', linkedInCollapsed(labelOnly.querySelector('p'), 'www.linkedin.com'));

const publicPost = mount(`
  <main>
    <p class="attributed-text-segment-list__content" data-test-id="main-feed-activity-card__commentary">${post}</p>
    <button class="show-more-less__more-button" aria-expanded="false">Show more</button>
  </main>`);
const para = publicPost.querySelector('p');
check('public commentary without a clamp is not collapsed', !linkedInCollapsed(para, 'www.linkedin.com'));
check('footer show-more is not a post toggle', controlFromElement(publicPost.querySelector('button')) === 'ignore');
}

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('\npage translate tests passed');
