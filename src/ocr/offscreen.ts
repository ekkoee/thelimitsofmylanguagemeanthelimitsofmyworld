// Local OCR for image translation. Runs in the extension offscreen document so
// the page stays responsive. Language data is downloaded once, hashed, and cached.

import { acceptOcrWord, OcrToken, tokensToRegions } from './paragraphs';
import { ENG_TRAINEDDATA_SHA256, ENG_TRAINEDDATA_URL, OCR_CACHE_KEY, gunzipBytes, sha256Hex } from './traineddata';

interface TessWord {
  text?: string;
  confidence?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}
interface TessWorker {
  recognize(image: Blob | HTMLCanvasElement): Promise<{ data: { words?: TessWord[] } }>;
  setParameters(params: Record<string, string>): Promise<void>;
}
interface TessApi {
  createWorker(lang: string, oem: number, opts: Record<string, unknown>): Promise<TessWorker>;
}

let workerPromise: Promise<TessWorker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function idbPut(key: string, value: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('keyval-store', 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('keyval'); };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('keyval', 'readwrite');
      tx.objectStore('keyval').put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

function idbHas(key: string): Promise<boolean> {
  return new Promise((resolve) => {
    const open = indexedDB.open('keyval-store', 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('keyval'); };
    open.onerror = () => resolve(false);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('keyval', 'readonly');
      const req = tx.objectStore('keyval').get(key);
      req.onsuccess = () => { db.close(); resolve(req.result != null); };
      req.onerror = () => { db.close(); resolve(false); };
    };
  });
}

async function ensureTraineddata(): Promise<void> {
  if (await idbHas(OCR_CACHE_KEY)) return;
  const res = await fetch(ENG_TRAINEDDATA_URL);
  if (!res.ok) throw new Error('語言包下載失敗，請檢查網路');
  const gzip = new Uint8Array(await res.arrayBuffer());
  const hash = await sha256Hex(gzip);
  if (hash !== ENG_TRAINEDDATA_SHA256) throw new Error('語言包校驗失敗');
  const raw = await gunzipBytes(gzip);
  await idbPut(OCR_CACHE_KEY, raw);
}

async function getWorker(): Promise<TessWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      await ensureTraineddata();
      const api = (globalThis as unknown as { Tesseract?: TessApi }).Tesseract;
      if (!api) throw new Error('本機文字辨識沒有載入');
      const worker = await api.createWorker('eng', 1, {
        workerPath: chrome.runtime.getURL('ocr/worker.min.js'),
        corePath: chrome.runtime.getURL('ocr/core'),
        cachePath: 'ibt-ocr',
        workerBlobURL: false,
        gzip: false,
      });
      await worker.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });
      return worker;
    })();
  }
  return workerPromise;
}

function tokensFromWords(words: TessWord[]): OcrToken[] {
  const out: OcrToken[] = [];
  for (const word of words) {
    const text = (word.text || '').trim();
    const box = word.bbox;
    if (!text || !box || !acceptOcrWord(text, word.confidence ?? 0)) continue;
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    if (w < 2 || h < 2) continue;
    out.push({ text, x: box.x0, y: box.y0, w, h });
  }
  return out;
}

async function recognize(mime: string, data: string): Promise<{ regions: { text: string; box: [number, number, number, number] }[]; ms: number }> {
  const t0 = Date.now();
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mime || 'image/jpeg' });
  const bitmap = await createImageBitmap(blob);
  const width = bitmap.width;
  const height = bitmap.height;
  const worker = await getWorker();
  const tokens = tokensFromWords((await worker.recognize(blob)).data.words || []);
  bitmap.close();
  return { regions: tokensToRegions(tokens, width, height), ms: Date.now() - t0 };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'ibt-offscreen-ocr') return;
  enqueue(() => recognize(String(msg.mime || 'image/jpeg'), String(msg.data || '')))
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => {
      const message = String((err as Error)?.message || err);
      console.log('[IBT] ocr failed', message.slice(0, 300));
      sendResponse({ ok: false, error: /[\u4e00-\u9fff]/.test(message) ? message : '本機文字辨識失敗' });
    });
  return true;
});
