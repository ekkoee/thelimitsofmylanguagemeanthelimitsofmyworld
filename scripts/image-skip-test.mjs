import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
execSync(
  'npx esbuild src/content/image-place.ts --bundle --platform=node --format=esm --outfile=/tmp/ibt-image-place.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const { shouldSkipImageTarget } = await import(pathToFileURL('/tmp/ibt-image-place.mjs').href);
let failed = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failed += 1;
}
check('tweet text is not an image target', shouldSkipImageTarget({ width: 500, height: 120, inTweetText: true, inTweetPhoto: false }));
check('avatar is not an image target', shouldSkipImageTarget({ width: 40, height: 40, inTweetText: false, inTweetPhoto: false }));
check('photo tile is an image target', !shouldSkipImageTarget({ width: 480, height: 270, inTweetText: false, inTweetPhoto: true }));
check('a normal picture is an image target', !shouldSkipImageTarget({ width: 640, height: 400, inTweetText: false, inTweetPhoto: false }));
if (failed) process.exit(1);
console.log('image skip tests passed');
