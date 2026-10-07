// Regression tests for the simplified→traditional safety net (free engines).
// Run: node scripts/st2t-test.mjs  (bundles src/core/st2t.ts)
import { execSync } from 'node:child_process';

execSync(
  'npx esbuild src/core/st2t.ts --bundle --platform=node --format=esm --outfile=/tmp/st2t.test.mjs --log-level=error',
  { cwd: new URL('..', import.meta.url).pathname, stdio: 'inherit' },
);
const { toTraditional } = await import('/tmp/st2t.test.mjs');

const cases = [
  // phrase disambiguation
  ['头发很长', '頭髮很長'],
  ['开发了一个新功能', '開發了一個新功能'],
  ['日历上标记了会议', '日曆上標記了會議'],
  ['已经很干净了', '已經很乾淨了'],
  ['软件已经发布', '軟體已經發布'],
  ['硬件加速', '硬體加速'],
  // protected words (must NOT be mangled by char layer)
  ['征服了市场', '征服了市場'],
  ['皇后驾到', '皇后駕到'],
  ['长征胜利', '長征勝利'],
  ['远征军出发', '遠征軍出發'],
  ['伙食不错', '伙食不錯'],
  ['开伙做饭', '開伙做飯'],
  // plain char conversion
  ['门后有人', '門後有人'],
  ['对于这个问题', '對於這個問題'],
  ['实时更新时间', '實時更新時間'],
  ['断点调试', '斷點調試'],
  ['绿色的织物', '綠色的織物'],
  ['胜利属于我们', '勝利屬於我們'],
  ['特征很重要', '特徵很重要'],
  // 圖一回報：介面/裡面/面對的面是合法繁體，不可轉成麵
  ['擁有大量的發現介面', '擁有大量的發現介面'],
  ['他在裡面對著鏡子', '他在裡面對著鏡子'],
  ['面對面溝通', '面對面溝通'],
  ['泡面很好吃', '泡麵很好吃'],
  ['來一碗牛肉面', '來一碗牛肉麵'],
  ['界面設計', '介面設計'],
  // 钟: 時鐘用鐘，鍾情用鍾
  ['鬧钟響了', '鬧鐘響了'],
  ['一见钟情', '一見鍾情'],
  // 系: 系統/體系 keeps 系，只有關係用係
  ['操作系统', '操作系統'],
  ['人際关系', '人際關係'],
  // 复/郁：無預設，詞組解決
  ['情况很复杂', '情況很複雜'],
  ['他很忧郁', '他很憂鬱'],
  // 采：神采/文采保持
  ['他神采飛揚', '他神采飛揚'],
  // idempotency on traditional text
  ['這是繁體中文', '這是繁體中文'],
  ['軟體已經發布', '軟體已經發布'],
  // empty
  ['', ''],
];

let fail = 0;
for (const [inp, exp] of cases) {
  const got = toTraditional(inp);
  if (got !== exp) {
    fail++;
    console.error(`FAIL ${JSON.stringify(inp)} -> ${JSON.stringify(got)} (want ${JSON.stringify(exp)})`);
  }
}
console.log(`${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
