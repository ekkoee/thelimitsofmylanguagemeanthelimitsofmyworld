// Netflix cue reading and placement. Run: node scripts/netflix-cap-test.mjs
import { execSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
execSync(
  'npx esbuild src/content/netflix-cap.ts --bundle --platform=node --format=esm --outfile=/tmp/netflix-cap.test.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
const cap = await import('/tmp/netflix-cap.test.mjs');
let parseHTML = null;
try {
  ({ parseHTML } = await import(process.env.LINKEDOM || 'linkedom'));
} catch { /* DOM cases skipped below */ }

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}

const video = { left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 };
const one = cap.nfOverlayBottom({
  video, parentBottom: 720, captionTop: 640, captionHeight: 36,
  cue: 'This is a long-term play that is', textWidth: 420,
});
check('measured cue sits 6px above the caption', one.branch === 'measured' && one.bottom === 720 - 640 + 6);
check('measured bottom clears the one-line reserve', one.bottom > one.reserve);

const missing = cap.nfOverlayBottom({
  video, parentBottom: 720, captionTop: null,
  cue: 'This is a long-term play that is', textWidth: 420,
});
check('missing rect uses the reserve floor', missing.branch === 'reserve' && missing.bottom === missing.reserve + 6);

const two = cap.nfOverlayBottom({
  video, parentBottom: 720, captionTop: null,
  cue: 'Line one of the cue\nand the second line', textWidth: 200,
});
check('two hard lines reserve more than one', two.reserve > missing.reserve && two.lines >= 2);

const small = cap.nfOverlayBottom({
  video: { left: 0, top: 80, width: 400, height: 225, right: 400, bottom: 305 },
  parentBottom: 320, captionTop: null, cue: 'Short cue line here', textWidth: 180,
});
check('small player font floors at 12', small.fontPx === 12);

const big = cap.nfOverlayBottom({
  video: { left: 0, top: 0, width: 1920, height: 1080, right: 1920, bottom: 1080 },
  parentBottom: 1080, captionTop: 980, captionHeight: 30,
  cue: 'Fullscreen cue', textWidth: 400, fixed: true, viewportHeight: 1080,
});
check('fullscreen font caps at 32', big.fontPx === 32);
check('fullscreen measured gap', big.branch === 'measured' && big.bottom === 1080 - 980 + 6);

const low = cap.nfOverlayBottom({
  video, parentBottom: 720, captionTop: 700, captionHeight: 8,
  cue: 'This is a long-term play that is', textWidth: 420,
});
check('a too-low rect does not pull onto the caption', low.branch === 'reserve' && low.bottom >= 720 - 700 + 6);

check('watch url', cap.isNetflixWatch('https://www.netflix.com/watch/81234567?trackId=1'));
check('browse is not watch', !cap.isNetflixWatch('https://www.netflix.com/browse'));
check('unset view is bilingual', cap.nfVideoView('') === 'both');
check('explicit bilingual hides native', cap.nfVideoView('both') === 'both' && cap.nfHidesNative('both'));
check('chinese only still hides the native track', cap.nfVideoView('zh') === 'zh' && cap.nfHidesNative('zh'));
check('original hides ours', cap.nfVideoView('orig') === 'orig');
check('skip intro is chrome', cap.isNetflixChromeCue('Skip Intro'));

if (parseHTML) {
  const { document } = parseHTML('<!doctype html><html><body></body></html>');
  document.body.innerHTML = `
    <div class="watch-video" data-uia="watch-video">
      <video></video>
      <div class="player-timedtext">
        <div class="player-timedtext-text-container">
          <span><span>This is a long-term play that is</span></span>
        </div>
      </div>
      <button class="button-nfplayerPlay">Pause</button>
    </div>`;
  check('single cue read', cap.readNetflixCue(document) === 'This is a long-term play that is');
  check('pause button is not the cue', !cap.readNetflixCue(document).includes('Pause'));

  const timed = document.querySelector('.player-timedtext');
  timed.innerHTML = `
    <div class="player-timedtext-text-container">
      <span>Line one of the cue</span><br><span>and the second line</span>
    </div>`;
  check('two spans become two lines', cap.readNetflixCue(document) === 'Line one of the cue\nand the second line');

  timed.innerHTML = `
    <div class="player-timedtext-text-container">
      <span>Next episode starts after this line of dialogue</span>
    </div>`;
  check('episode change reads the new cue', cap.readNetflixCue(document).startsWith('Next episode starts'));

  timed.innerHTML = '';
  check('captions off is empty', cap.readNetflixCue(document) === '');
} else {
  console.log('SKIP netflix DOM fixtures (install linkedom or set LINKEDOM)');
}

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nnetflix caption tests passed');
