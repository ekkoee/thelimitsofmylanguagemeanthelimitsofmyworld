// Per-unit language skip. Run: node scripts/lang-skip-150.mjs
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
execSync(
  'npx esbuild src/core/segmentation.ts --bundle --format=esm --platform=node --outfile=/tmp/ibt-seg-150.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const { isAlreadyTargetLang, sameMeaning } = await import(pathToFileURL('/tmp/ibt-seg-150.mjs').href);

const zh = 'zh-TW';
let failed = 0;
function check(name, got, want) {
  if (got !== want) {
    failed++;
    console.error('FAIL', name, 'got', got, 'want', want);
  } else console.log('ok', name);
}

const chineseLines = [
  '進步不一定要更快',
  '人類經常用速度、產量與效率衡量進步。',
  '然而，更快不一定代表更好，更多也不一定代表更幸福。',
  '一個成熟的文明，不只是持續突破極限，也應該讓普通人有能力選擇自己的生活節奏。',
  '科技的價值，不應只是要求人類完成更多工作，而是讓人類能夠用更少的負擔，創造更多可能。',
  '真正的進步，也許不是讓每個人跑得更快，而是讓每個人都有自由決定自己的速度。',
];
for (const line of chineseLines) check('zh line ' + line.slice(0, 8), isAlreadyTargetLang(line, zh), true);

check('english heading', isAlreadyTargetLang("Progress Doesn't Always Mean Going Faster", zh), false);
check('curly apostrophe', isAlreadyTargetLang('Progress Doesn’t Always Mean Going Faster', zh), false);
check('english plus one han', isAlreadyTargetLang('I love 進步 in this design and I want the whole sentence translated.', zh), false);
check('short brand in chinese', isAlreadyTargetLang('這是一個完整的中文句子，中間只有 AI。', zh), true);
check('url ignored', isAlreadyTargetLang('看這篇 https://example.com/path 就好，其他都是中文。', zh), true);
check('mention ignored', isAlreadyTargetLang('大家好 @someone 早安，今天也是中文。', zh), true);
check('hashtag ignored', isAlreadyTargetLang('今天的筆記 #進步 還是用中文寫的。', zh), true);
check('digits ignored', isAlreadyTargetLang('2026 年我們繼續把這件事做完。', zh), true);
check('emoji ignored', isAlreadyTargetLang('今天天氣很好 🌤️ 我們照原定的節奏走。', zh), true);
check('no han', isAlreadyTargetLang('Shipping a small fix is better than rewriting the pipeline.', zh), false);
check('target english', isAlreadyTargetLang('進步不一定要更快', 'en'), false);
check('japanese not chinese', isAlreadyTargetLang('進捗はいつも速いとは限らない。', zh), false);
check('x chinese tweet', isAlreadyTargetLang('今天把這段中文寫完，就不需要再翻譯一次。', zh), true);
check('x chinese with domain', isAlreadyTargetLang('今天把 kyc 和 FTX.com 留在原文裡，這則中文推文不該被拆開再翻一次。', zh), true);
check('x english tweet', isAlreadyTargetLang('Shipping a small fix is better than rewriting the pipeline.', zh), false);

check('echo', sameMeaning('進步不一定要更快', '進步不一定要更快', zh), true);
check('punct', sameMeaning('你好。', '你好', zh), true);
check('simplified echo', sameMeaning('進步不一定要更快', '进步不一定要更快', zh), true);
check('real translation', sameMeaning("Progress Doesn't Always Mean Going Faster", '進步不一定總是要更快', zh), false);
check('digits kept', sameMeaning('see 1', 'see 2', zh), false);
check('zh-CN keeps script change', sameMeaning('進步', '进步', 'zh-CN'), false);

if (failed) {
  console.error(failed, 'failed');
  process.exit(1);
}
console.log('PASS');
