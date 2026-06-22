import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

// Static assets copied verbatim into dist/
const copies = [
  ['public/manifest.json', 'dist/manifest.json'],
  ['public/popup.html', 'dist/popup.html'],
  ['public/options.html', 'dist/options.html'],
  ['src/ui/popup/popup.css', 'dist/popup.css'],
  ['src/ui/options/options.css', 'dist/options.css'],
  ['src/styles/bilingual.css', 'dist/bilingual.css'],
  ['public/icons', 'dist/icons'],
];
function copyAll() {
  for (const [from, to] of copies) {
    if (!existsSync(from)) continue;
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  }
}

const shared = {
  bundle: true,
  sourcemap: watch ? 'inline' : false,
  target: ['chrome114'],
  logLevel: 'info',
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
};

// Content scripts MUST be IIFE (no ESM in injected context).
const iifeEntries = {
  'content': 'src/content/index.ts',
  'yt-main': 'src/content/yt-main.ts',
  'universal-inject': 'src/content/universal-inject.ts',
  'popup': 'src/ui/popup/popup.ts',
  'options': 'src/ui/options/options.ts',
};
// Service worker can be an ES module.
const esmEntries = {
  'background': 'src/background/service-worker.ts',
};

const configs = [
  { ...shared, format: 'iife', entryPoints: iifeEntries, outdir, write: true },
  { ...shared, format: 'esm', entryPoints: esmEntries, outdir, write: true },
];

if (watch) {
  copyAll();
  for (const cfg of configs) {
    const ctx = await context(cfg);
    await ctx.watch();
  }
  console.log('watching…');
} else {
  for (const cfg of configs) await build(cfg);
  copyAll();
  console.log('build complete -> dist/');
}
