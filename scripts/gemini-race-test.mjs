// Hedged Gemini race. Run: node scripts/gemini-race-test.mjs
import { execSync } from 'node:child_process';

execSync(
  'npx esbuild src/providers/gemini-race.ts --bundle --platform=node --format=esm --outfile=/tmp/gemini-race.test.mjs --log-level=error',
  { cwd: new URL('..', import.meta.url).pathname, stdio: 'inherit' },
);
const { hedgeRace, isBothFailed, isPrimaryFatal } = await import('/tmp/gemini-race.test.mjs');

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Primary answers inside the hedge delay: the fast model is never called.
{
  let hedgeCalls = 0;
  const logs = [];
  const race = await hedgeRace({
    delayMs: 250,
    primaryModel: 'gemini-3.5-flash',
    hedgeModel: 'gemini-2.5-flash-lite',
    primary: () => wait(30).then(() => ['PRIMARY']),
    hedge: () => { hedgeCalls++; return wait(10).then(() => ['HEDGE']); },
    log: (l) => logs.push(l),
  });
  await wait(40);
  check('primary fast: no hedge sent', hedgeCalls === 0 && race.hedgeSent === false);
  check('primary fast: winner is primary', race.winner === 'primary' && race.texts[0] === 'PRIMARY' && race.cache === true);
  check('primary fast: log names primary and not-sent', logs.some((l) => /primary=gemini-3\.5-flash \d+ms hedge=not-sent shown=primary@\d+ms/.test(l)));
  check('primary fast: no upgrade', (await race.upgrade) === null);
}

// Primary is slow: hedge is shown, then swapped for the primary text.
{
  let hedgeCalls = 0;
  const logs = [];
  const race = await hedgeRace({
    delayMs: 40,
    primaryModel: 'gemini-3.5-flash',
    hedgeModel: 'gemini-2.5-flash-lite',
    primary: () => wait(160).then(() => ['PRIMARY']),
    hedge: () => { hedgeCalls++; return wait(30).then(() => ['HEDGE']); },
    log: (l) => logs.push(l),
  });
  check('primary slow: hedge was sent once', hedgeCalls === 1 && race.hedgeSent === true);
  check('primary slow: first text is the hedge', race.winner === 'hedge' && race.texts[0] === 'HEDGE' && race.cache === false);
  check('primary slow: provisional log', logs.some((l) => /shown=hedge@\d+ms$/.test(l) && l.includes('hedge=gemini-2.5-flash-lite')));
  const upgraded = await race.upgrade;
  check('primary slow: upgrade is the primary text', upgraded?.[0] === 'PRIMARY');
  check('primary slow: final log says upgraded', logs.some((l) => /primary=gemini-3\.5-flash \d+ms hedge=gemini-2\.5-flash-lite \d+ms shown=hedge@\d+ms upgraded/.test(l)));
}

// Primary 400: don't wait out the delay; use the hedge and mark the primary dead.
{
  let hedgeCalls = 0;
  const t0 = Date.now();
  const race = await hedgeRace({
    delayMs: 500,
    primaryModel: 'gemini-3.7-flash',
    hedgeModel: 'gemini-2.5-flash-lite',
    primary: () => Promise.reject(new Error('Gemini 400: Thinking level MINIMAL is not supported')),
    hedge: () => { hedgeCalls++; return Promise.resolve(['HEDGE']); },
  });
  check('primary 400: hedge used immediately', hedgeCalls === 1 && Date.now() - t0 < 200);
  check('primary 400: marked dead', race.primaryDead === true && race.texts[0] === 'HEDGE' && race.cache === false);
  check('primary 400: no upgrade text', (await race.upgrade) === null);
  check('400 is fatal', isPrimaryFatal(new Error('Gemini 400: bad')) && !isPrimaryFatal(new Error('Gemini 429: quota')));
}

// Both calls fail → reject so the free engine can take the batch.
{
  let rejected = '';
  try {
    await hedgeRace({
      delayMs: 20,
      primaryModel: 'gemini-3.5-flash',
      hedgeModel: 'gemini-2.5-flash-lite',
      primary: () => Promise.reject(new Error('Gemini 503: busy')),
      hedge: () => Promise.reject(new Error('Gemini 503: also busy')),
    });
  } catch (e) {
    rejected = String(e?.message ?? e);
  }
  check('both fail: rejects', /Gemini both failed/.test(rejected));
  check('both fail: detected', isBothFailed(new Error(rejected)));
}

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nrace tests passed');
