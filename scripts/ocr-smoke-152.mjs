// One local OCR pass. Confirms text still comes back, and that a fixed DPI
// does not print "Estimating resolution".
import { createWorker } from 'tesseract.js';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCanvas } = await import('canvas').catch(() => ({ createCanvas: null }));

let png;
if (createCanvas) {
  const canvas = createCanvas(480, 120);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 480, 120);
  ctx.fillStyle = '#111';
  ctx.font = '48px sans-serif';
  ctx.fillText('HELLO', 40, 78);
  png = canvas.toBuffer('image/png');
} else {
  const { execSync } = await import('node:child_process');
  execSync(`python3 - <<'PY'
from PIL import Image, ImageDraw, ImageFont
im = Image.new('RGB', (480, 120), 'white')
draw = ImageDraw.Draw(im)
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 48)
draw.text((40, 30), 'HELLO', fill='black', font=font)
im.save('/tmp/ibt-ocr-152.png')
PY`);
  png = null;
}

const notes = [];
const origWarn = console.warn;
console.warn = (...args) => { notes.push(args.map(String).join(' ')); origWarn(...args); };

const worker = await createWorker('eng', 1, {
  logger: () => {},
  errorHandler: () => {},
});
await worker.setParameters({
  tessedit_pageseg_mode: '7',
  user_defined_dpi: '300',
  debug_file: '/dev/null',
});
const image = png || '/tmp/ibt-ocr-152.png';
const { data } = await worker.recognize(image);
await worker.terminate();
const text = (data.text || '').replace(/\s+/g, ' ').trim();
const noisy = notes.filter((line) => /Estimating resolution|Invalid resolution|diacritics/i.test(line));
console.log('OCR text:', JSON.stringify(text));
console.log('noise lines:', noisy.length);
if (!/HELLO/i.test(text)) {
  console.error('OCR did not read HELLO');
  process.exit(1);
}
if (noisy.length) {
  console.error('Tesseract noise still logged', noisy);
  process.exit(1);
}
console.log('PASS');
