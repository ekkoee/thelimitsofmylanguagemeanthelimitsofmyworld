import { belowAnchor, imageDecision, overlayHost } from '../src/content/image-place';

function place(img: HTMLImageElement): { mode: string; reason: string; shifted: number } {
  const marker = img.closest('section')?.querySelector('[data-after]') as HTMLElement;
  const before = marker ? marker.getBoundingClientRect().top : 0;
  const decision = imageDecision(img);
  if (decision.mode === 'below') {
    const block = document.createElement('div');
    block.className = 'ibt-block';
    block.textContent = '譯文';
    block.style.fontSize = '15px';
    const anchor = belowAnchor(img);
    anchor.parentElement?.insertBefore(block, anchor.nextSibling);
  } else {
    const host = overlayHost(img);
    const overlay = document.createElement('div');
    overlay.className = 'ibt-img-overlay';
    overlay.style.position = 'absolute';
    const hr = host.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    overlay.style.left = `${ir.left - hr.left}px`;
    overlay.style.top = `${ir.top - hr.top}px`;
    overlay.style.width = `${ir.width}px`;
    overlay.style.height = `${ir.height}px`;
    overlay.textContent = '譯文';
    host.appendChild(overlay);
  }
  const after = marker ? marker.getBoundingClientRect().top : 0;
  return { mode: decision.mode, reason: decision.reason, shifted: Math.round(after - before) };
}

const rows = ['article', 'card', 'hero'].map((id) => {
  const img = document.getElementById(id) as HTMLImageElement;
  return { id, ...place(img) };
});
(document.getElementById('out') as HTMLElement).textContent = JSON.stringify(rows);
