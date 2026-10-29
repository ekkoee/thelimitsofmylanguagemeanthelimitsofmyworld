// X WebVTT parser and caption placement. Run: node scripts/x-vtt-test.mjs
import { execSync } from 'node:child_process';

execSync(
  'npx esbuild src/content/x-vtt.ts --bundle --platform=node --format=esm --outfile=/tmp/x-vtt.test.mjs --log-level=error',
  { cwd: new URL('..', import.meta.url).pathname, stdio: 'inherit' },
);
const { parseXVtt, stripXTags, mediaIdFromUrl, subtitleUris, xCaptionBox } = await import('/tmp/x-vtt.test.mjs');

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}

const sample = `WEBVTT

00:00:01.840 --> 00:00:03.399
<X-word-ms ms=539,120 index=1 character_ranges=0-5,6-9>Cursor now has a mobile app.</X-word-ms>

00:00:03.580 --> 00:00:04.980
<X-word-ms ms=439 index=2>I want to show you three ways</X-word-ms>
`;
const cues = parseXVtt(sample);
check('two cues', cues.length === 2);
check('tags stripped', cues[0].text === 'Cursor now has a mobile app.');
check('start ms', cues[0].start === 1840);
check('second cue', cues[1].text === 'I want to show you three ways');
check('strip helper', stripXTags('<X-word-ms ms=1>Hello there</X-word-ms>') === 'Hello there');

const url = 'https://video.twimg.com/subtitles/amplify_video/2071638346145923072/0/Z4JgfHwpD4CVrlNL.vtt';
check('media id', mediaIdFromUrl(url) === '2071638346145923072');
check('thumb id matches', mediaIdFromUrl('https://pbs.twimg.com/amplify_video_thumb/2071638346145923072/img/x.jpg') === '2071638346145923072');

const playlist = `#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="subs/en.vtt"
#EXT-X-STREAM-INF:BANDWIDTH=800000,SUBTITLES="subs"
v.m3u8
`;
const uris = subtitleUris(playlist, 'https://video.twimg.com/ext_tw_video/1/pl.m3u8');
check('subtitle uri resolved', uris[0] === 'https://video.twimg.com/ext_tw_video/1/subs/en.vtt');

const video = { left: 100, top: 80, width: 640, height: 360, bottom: 440, right: 740 };
const player = { left: 80, top: 60, width: 680, height: 420, bottom: 480, right: 760 };
const box = xCaptionBox(video, player, 36);
check('centered on the picture', box.center === (100 - 80) + 320);
check('clears letterbox and controls', box.bottom === (480 - 440) + Math.round(Math.max(8, 360 * 0.06)) + 36);
check('width follows the video', box.maxWidth === Math.round(640 * 0.92));

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nx vtt tests passed');
