// Speech bubbles are large, nearly-white blobs. This finds their boxes from pixels.
// It is not a copy of any OCR project's detector.

export interface BubbleRect { x: number; y: number; w: number; h: number }

export function findSpeechBubbles(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  step = 2,
): BubbleRect[] {
  if (width < 8 || height < 8) return [];
  const cols = Math.ceil(width / step);
  const rows = Math.ceil(height / step);
  const light = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.min(width - 1, col * step);
      const y = Math.min(height - 1, row * step);
      const i = (y * width + x) * 4;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (r + g + b > 640 && max - min < 40) light[row * cols + col] = 1;
    }
  }
  const seen = new Uint8Array(light.length);
  const bubbles: BubbleRect[] = [];
  const imageArea = width * height;
  for (let start = 0; start < light.length; start++) {
    if (!light[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let minC = cols;
    let minR = rows;
    let maxC = 0;
    let maxR = 0;
    let count = 0;
    while (stack.length) {
      const idx = stack.pop() as number;
      const col = idx % cols;
      const row = (idx / cols) | 0;
      count += 1;
      if (col < minC) minC = col;
      if (row < minR) minR = row;
      if (col > maxC) maxC = col;
      if (row > maxR) maxR = row;
      const neighbors = [idx - 1, idx + 1, idx - cols, idx + cols];
      for (const next of neighbors) {
        if (next < 0 || next >= light.length || seen[next] || !light[next]) continue;
        if (next === idx - 1 && col === 0) continue;
        if (next === idx + 1 && col === cols - 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    const bw = (maxC - minC + 1) * step;
    const bh = (maxR - minR + 1) * step;
    const area = count * step * step;
    if (area < imageArea * 0.012 || area > imageArea * 0.45) continue;
    if (bw < 36 || bh < 28) continue;
    bubbles.push({ x: minC * step, y: minR * step, w: bw, h: bh });
  }
  bubbles.sort((a, b) => a.y - b.y || a.x - b.x);
  return bubbles;
}
