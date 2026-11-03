import { collectUnits, payloadForUnit } from '../src/content/blocks';
import { linkedInLines, translateLinkedInCommentary } from '../src/content/linkedin';
import { isAlreadyTargetLang, sameMeaning, segment } from '../src/core/segmentation';
import { refreshTransSurfaces } from '../src/utils/dom';

const chromeObj = {
  runtime: {
    id: 'fixture',
    lastError: undefined as { message?: string } | undefined,
    sendMessage(msg: { text?: string }, cb: (resp: unknown) => void) {
      const parts = segment(String(msg?.text || ''), 'en');
      cb({
        ok: true,
        pairs: parts.map((s) => ({
          o: s,
          // Chinese echoes must be dropped. English becomes a real translation.
          t: isAlreadyTargetLang(s, 'zh-TW') ? s : canned(s),
        })),
      });
    },
  },
};
(globalThis as unknown as { chrome: typeof chromeObj }).chrome = chromeObj;

function canned(s: string): string {
  if (/Progress Doesn/i.test(s)) return '進步不一定總是要更快';
  if (/One month/i.test(s)) return '距離活動還有一個月。';
  if (/Across two days/i.test(s)) return '兩天的活動會把製造業者聚在一起。';
  if (/From live machining/i.test(s)) return '從現場加工演示到合作夥伴展示都有。';
  if (/Whether you are/i.test(s)) return '如果你想提高產能，我們十一月見。';
  if (/November/i.test(s)) return '十一月二十四日至二十五日。';
  if (/Seco Innovation/i.test(s)) return '地點在德國埃克拉特。';
  if (/Don.?t miss/i.test(s)) return '不要錯過報名。';
  if (/Shipping a small/i.test(s)) return '小修比重寫整條管線更好。';
  if (/I still translate/i.test(s)) return '這句話裡即使有一個中文詞，也應該翻譯。';
  return '這一行的中文翻譯。';
}

const api = {
  lines: linkedInLines,
  go: translateLinkedInCommentary,
  units: collectUnits,
  payload: payloadForUnit,
  skip: isAlreadyTargetLang,
  same: sameMeaning,
  refresh: refreshTransSurfaces,
};
(window as unknown as { __ibt: typeof api }).__ibt = api;
