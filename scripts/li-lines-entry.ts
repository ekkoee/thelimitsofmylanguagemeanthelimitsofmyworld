import { linkedInLines, translateLinkedInCommentary } from '../src/content/linkedin';
import { segment } from '../src/core/segmentation';

const chromeObj = {
  runtime: {
    id: 'fixture',
    lastError: undefined as { message?: string } | undefined,
    sendMessage(msg: { text?: string }, cb: (resp: unknown) => void) {
      const parts = segment(String(msg?.text || ''), 'en');
      cb({ ok: true, pairs: parts.map((s) => ({ o: s, t: `譯${s}` })) });
    },
  },
};
(globalThis as unknown as { chrome: typeof chromeObj }).chrome = chromeObj;
(window as unknown as { __lines: typeof linkedInLines; __go: typeof translateLinkedInCommentary }).__lines = linkedInLines;
(window as unknown as { __go: typeof translateLinkedInCommentary }).__go = translateLinkedInCommentary;
