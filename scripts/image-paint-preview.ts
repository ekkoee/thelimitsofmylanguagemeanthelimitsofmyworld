// Browser half of scripts/test-image-translate.mjs. Paints the extension's
// in-place regions (pad, edge color, contrast, font fit) over the image.
import { renderRegions } from '../src/content/image-inplace';
import { ImageRegion } from '../src/providers/gemini-image';

interface Payload { mode: 'inplace' | 'panel'; regions: ImageRegion[]; text: string }

const payload = (window as unknown as { __ibtPaint?: Payload }).__ibtPaint
  || { mode: 'panel' as const, regions: [], text: '' };

function paint(): void {
  const img = document.getElementById('pic') as HTMLImageElement | null;
  const overlay = document.getElementById('overlay');
  if (!img || !overlay) return;
  overlay.style.width = `${img.clientWidth}px`;
  overlay.style.height = `${img.clientHeight}px`;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx && canvas.width) ctx.drawImage(img, 0, 0);
  if (payload.mode === 'inplace') {
    renderRegions(overlay, img, canvas, payload.regions);
  } else {
    const panel = document.createElement('div');
    panel.className = 'ibt-img-panel';
    panel.textContent = payload.text || payload.regions.map((r) => r.textZh).filter(Boolean).join('\n');
    overlay.appendChild(panel);
  }
  document.documentElement.dataset.ibtMode = payload.mode;
  document.documentElement.dataset.ibtCount = String(payload.regions.length);
}

const img = document.getElementById('pic') as HTMLImageElement | null;
if (img && !img.complete) img.onload = () => paint();
else paint();
