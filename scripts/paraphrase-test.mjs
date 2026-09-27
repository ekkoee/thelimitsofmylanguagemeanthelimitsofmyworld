// Regression tests for the paraphrase/idiom layer (free-engine EN->plain-EN).
// Run: node scripts/paraphrase-test.mjs  (bundles src/core/paraphrase.ts)
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

execSync(
  'npx esbuild src/core/paraphrase.ts --bundle --platform=node --format=esm --outfile=/tmp/paraphrase.test.mjs --log-level=error',
  { cwd: new URL('..', import.meta.url).pathname, stdio: 'inherit' },
);
const { paraphraseForMT } = await import('/tmp/paraphrase.test.mjs');

const cases = [
  // tense agreement: base / past / third-person / progressive / irregular
  ['He kicked the bucket yesterday.', 'He died yesterday.'],
  ['He kicks the bucket.', 'He dies.'],
  ['He is kicking the bucket.', 'He is dying.'],
  ['They burn the midnight oil.', 'They work late.'],
  ['He burned the midnight oil.', 'He worked late.'],
  ['They are burning the midnight oil.', 'They are working late.'],
  ['He flew off the handle.', 'He exploded in anger.'],
  ['She sat on the fence.', 'She was undecided.'],
  ['It fell off the back of a lorry.', 'It was stolen.'],
  ['He hit the sack early.', 'He went to bed early.'],
  ['He is hitting the sack.', 'He is going to bed.'],
  ['He hit the nail on the head.', 'He was exactly right.'],
  // curated overrides (must not emit broken English)
  ['It costs an arm and a leg to live here.', 'It costs a lot to live here.'],
  ['She pulled his leg about the party.', 'She teased about the party.'],
  ['He turned a blind eye to the problem.', 'He ignored the problem.'],
  ['He raised the white flag.', 'He surrendered.'],
  ['He spilled the beans.', 'He revealed a secret.'],
  ['Take it with a grain of salt.', 'Be skeptical.'],
  ['He took it with a grain of salt.', 'He was skeptical.'],
  ['It is raining cats and dogs.', 'It is raining heavily.'],
  ["She is the bee's knees.", 'She is excellent.'],
  ['He closed the door on talks.', 'He ended talks.'],
  // interjections / fixed phrases
  ['Break a leg!', 'Good luck!'],
  ['Stop beating around the bush and tell me.', 'Stop avoiding the main topic and tell me.'],
  // must NOT rewrite literal / non-idiom usage
  ['The naval base is closed today.', 'The naval base is closed today.'],
  ['They are on the same page now.', 'They are agreeing with each other now.'],
  ['This is a piece of cake for you.', 'This is very easy for you.'],
  ['Do not count your chickens before they hatch.', "Do not assume success before it's certain."],
];

let pass = 0;
for (const [input, expected] of cases) {
  const got = paraphraseForMT(input);
  if (got === expected) {
    pass++;
  } else {
    console.log('FAIL', JSON.stringify(input));
    console.log('  got:     ', JSON.stringify(got));
    console.log('  expected:', JSON.stringify(expected));
    process.exitCode = 1;
  }
}
console.log(`paraphrase regression: ${pass}/${cases.length} passed`);
