// Which strings count as prose (buttons and labels must not).
import { execSync } from 'node:child_process';

execSync(
  'npx esbuild src/content/blocks.ts --bundle --platform=node --format=esm --outfile=/tmp/prose-gate.test.mjs --log-level=error',
  { cwd: new URL('..', import.meta.url).pathname, stdio: 'inherit' },
);
const { looksLikeProse } = await import('/tmp/prose-gate.test.mjs');

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}

const labels = [
  'Watch', 'Fork', 'Star', 'About', 'Code', 'Issues',
  'Open global navigation menu (g then d)',
  'No description, website, or topics provided.',
  'Pin', 'Add file',
];
for (const s of labels) check(`label skipped: ${s}`, looksLikeProse(s) === false);

check('paragraph kept', looksLikeProse(
  'This repository explains how the player reports an error when the caller does not know the type in advance.',
));
check('cjk sentence kept', looksLikeProse('這個儲存庫說明播放器在不知道錯誤型別時要怎麼回報。'));
check('short cjk label skipped', looksLikeProse('關於') === false);

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nprose gate tests passed');
