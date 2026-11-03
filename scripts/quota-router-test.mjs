// node scripts/quota-router-test.mjs
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
execSync(
  'npx esbuild scripts/quota-sim.ts --bundle --platform=node --format=esm --outfile=/tmp/ibt-quota-sim.mjs --log-level=error',
  { cwd: root, stdio: 'inherit' },
);
await import(pathToFileURL('/tmp/ibt-quota-sim.mjs').href);
