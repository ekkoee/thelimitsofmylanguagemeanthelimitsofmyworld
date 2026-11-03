// X tweet text is a mix of prose and live links (@handle, #tag, truncated URL).
// The visible text of those links used to be sent to the model as ordinary
// words, so @JuroOsawa came back as a made-up Chinese name and the URL path
// was translated. Soft wraps inside the tweet also became extra lines.
//
// Chips are replaced with private tokens before translation and restored as
// the original anchors afterwards. The model never sees the handle, tag, or URL.

export interface TextChip {
  token: string;
  /** Raw href attribute. Site-relative on X (/user, /hashtag/…). */
  href: string;
  /** Visible label, including a truncated URL. */
  label: string;
}

const TOKEN = (i: number) => `⟦${i}⟧`;

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function isProtectedLink(el: HTMLElement): boolean {
  if (el.tagName !== 'A' && el.getAttribute('role') !== 'link') return false;
  const label = norm(el.textContent || '');
  if (!label || label.length > 180) return false;
  const href = el.getAttribute('href') || '';
  if (/^@[\w.]{1,50}$/.test(label) || /^#[\w.]{1,80}$/.test(label)) return true;
  if (/^https?:\/\//i.test(href) || /(^|\/\/)t\.co\//i.test(href)) return true;
  if (/^[\w.-]+\.[a-z]{2,}(\/\S*)?[.…]*$/i.test(label)) return true;
  return false;
}

/** One flowing string plus the chips that were lifted out of it. */
export function protectFlow(root: HTMLElement): { text: string; chips: TextChip[] } {
  const chips: TextChip[] = [];
  let text = '';
  let pendingBreaks = 0;

  const gap = () => {
    if (pendingBreaks >= 2) text += '\n';
    else if (pendingBreaks === 1 && text && !text.endsWith(' ') && !text.endsWith('\n')) text += ' ';
    pendingBreaks = 0;
  };
  const addText = (raw: string) => {
    const parts = raw.split(/\n/);
    parts.forEach((part, i) => {
      if (i > 0) pendingBreaks += 1;
      if (!part) return;
      gap();
      text += part.replace(/[ \t]+/g, ' ');
    });
  };
  const addChip = (el: HTMLElement) => {
    gap();
    const token = TOKEN(chips.length);
    chips.push({
      token,
      href: el.getAttribute('href') || '',
      label: norm(el.textContent || ''),
    });
    text += token;
  };
  const shieldPlain = (raw: string) => {
    const re = /https?:\/\/\S+|[@#][\w.]{1,80}/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      addText(raw.slice(last, m.index));
      gap();
      const token = TOKEN(chips.length);
      const label = m[0];
      chips.push({ token, href: label.startsWith('http') ? label : '', label });
      text += token;
      last = m.index + label.length;
    }
    addText(raw.slice(last));
  };

  const walk = (node: Node) => {
    if (node.nodeType === 1) {
      const el = node as HTMLElement;
      if (el.classList?.contains('ibt-block') || el.dataset?.ibtOut === '1') return;
      if (el.tagName === 'BR') { pendingBreaks += 1; return; }
      if (isProtectedLink(el)) { addChip(el); return; }
      for (const child of Array.from(node.childNodes)) walk(child);
      return;
    }
    if (node.nodeType === 3) shieldPlain(node.nodeValue || '');
  };
  walk(root);
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  return { text, chips };
}

/** Drop newlines the model inserted beside a restored chip. Keep real paragraph breaks. */
export function tidyChipText(translated: string): string {
  return translated
    .replace(/[ \t]*\n+[ \t]*(?=⟦)/g, ' ')
    .replace(/(?<=⟧)[ \t]*\n+[ \t]*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function chipElement(chip: TextChip): HTMLElement {
  if (!chip.href) {
    const span = document.createElement('span');
    span.className = 'ibt-chip';
    span.textContent = chip.label;
    return span;
  }
  const a = document.createElement('a');
  a.className = 'ibt-chip';
  a.setAttribute('href', chip.href);
  a.textContent = chip.label;
  a.rel = 'noopener noreferrer';
  if (/^https?:/i.test(chip.href)) a.target = '_blank';
  return a;
}

/** Rebuild a translation into text nodes and the original anchors. */
export function expandChips(translated: string, chips: TextChip[]): Node[] {
  const tidy = tidyChipText(translated);
  const re = /⟦(\d+)⟧/g;
  const nodes: Node[] = [];
  const used = new Set<number>();
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tidy))) {
    const chunk = tidy.slice(last, m.index);
    if (chunk) nodes.push(document.createTextNode(chunk));
    const idx = Number(m[1]);
    const chip = chips[idx];
    if (chip) {
      nodes.push(chipElement(chip));
      used.add(idx);
    }
    last = m.index + m[0].length;
  }
  const tail = tidy.slice(last);
  if (tail) nodes.push(document.createTextNode(tail));
  for (let i = 0; i < chips.length; i++) {
    if (used.has(i)) continue;
    if (nodes.length) nodes.push(document.createTextNode(' '));
    nodes.push(chipElement(chips[i]));
  }
  return nodes;
}
