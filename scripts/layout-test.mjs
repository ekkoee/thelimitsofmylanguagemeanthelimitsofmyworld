// Placement + YouTube caption geometry. Run: node scripts/layout-test.mjs
import { execSync } from 'node:child_process';

execSync(
  'npx esbuild src/content/layout.ts --bundle --platform=node --format=esm --outfile=/tmp/layout.test.mjs --log-level=error',
  { cwd: new URL('..', import.meta.url).pathname, stdio: 'inherit' },
);
const { choosePlacement, reserveSpace, youtubeCaptionOffset, controlOverlap } = await import('/tmp/layout.test.mjs');

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}

const base = {
  anchorIsElement: true,
  caption: false,
  clamped: false,
  parentDisplay: 'block',
  parentFlexDirection: 'row',
  parentFlexWrap: 'nowrap',
  selfDisplay: 'block',
  selfFlexDirection: 'row',
  selfFlexWrap: 'nowrap',
};

check('normal block → sibling', choosePlacement(base) === 'sibling');
check('text-node anchor stays sibling', choosePlacement({ ...base, anchorIsElement: false, caption: true }) === 'sibling');
check('row-nowrap parent → inside the source', choosePlacement({ ...base, parentDisplay: 'flex' }) === 'inside');
check('column flex parent → sibling', choosePlacement({
  ...base, parentDisplay: 'flex', parentFlexDirection: 'column',
}) === 'sibling');
check('wrapping row → sibling', choosePlacement({
  ...base, parentDisplay: 'flex', parentFlexWrap: 'wrap',
}) === 'sibling');
check('grid parent → inside', choosePlacement({ ...base, parentDisplay: 'grid' }) === 'inside');
check('caption → overlay', choosePlacement({ ...base, caption: true }) === 'overlay');
check('caption does not reserve margin', reserveSpace({ ...base, caption: true }) === false);
check('row-flex source → overlay that reserves space', (() => {
  const s = { ...base, selfDisplay: 'flex' };
  return choosePlacement(s) === 'overlay' && reserveSpace(s) === true;
})());
check('line-clamp in a grid → overlay', choosePlacement({
  ...base, clamped: true, parentDisplay: 'grid',
}) === 'overlay');
check('line-clamp in normal flow → sibling', choosePlacement({ ...base, clamped: true }) === 'sibling');

const video = { left: 100, top: 80, width: 640, height: 360, bottom: 440, right: 740 };
const player = { left: 100, top: 40, width: 640, height: 480, bottom: 520, right: 740 };
const letter = youtubeCaptionOffset(video, player, null);
check('letterbox lifts caption off the black bar', letter.bottom === 80 + Math.round(Math.max(10, 360 * 0.06)));
check('caption centers on the video, not the player edge', letter.center === 320);
check('max width tracks the picture', letter.maxWidth === Math.round(640 * 0.92));

const withBar = youtubeCaptionOffset(video, player, { top: 400, height: 48, opacity: 1 });
check('control bar adds overlap', withBar.bottom === letter.bottom + controlOverlap(440, 400, 48, 1));
check('hidden controls add nothing', controlOverlap(440, 400, 48, 0) === 0);
check('controls below the picture add nothing', controlOverlap(440, 440, 48, 1) === 0);

const full = { left: 0, top: 120, width: 1920, height: 800, bottom: 920, right: 1920 };
const screen = { left: 0, top: 0, width: 1920, height: 1080, bottom: 1080, right: 1920 };
const fs = youtubeCaptionOffset(full, screen, null);
check('fullscreen side-bars: center follows the picture', fs.center === 960);
check('fullscreen bottom letterbox is cleared', fs.bottom === (1080 - 920) + Math.round(Math.max(10, 800 * 0.06)));

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll layout tests passed');
