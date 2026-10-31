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
const { isShortLabel, isShortcutHint } = await import('/tmp/blocks.test.mjs');
const { isAltA } = await import('/tmp/alt-a-key.test.mjs');

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

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('\npage translate tests passed');
