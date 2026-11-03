import { isHeadingElement, isRowFit, pageFontPx } from '../src/content/page-font';

const host = document.documentElement.getAttribute('data-ibt-host') || location.hostname;
const rows = [...document.querySelectorAll('[data-src]')].map((node) => {
  const el = node as HTMLElement;
  const px = pageFontPx(el);
  const block = document.createElement('div');
  block.className = 'ibt-block ibt-uni';
  if (isHeadingElement(el)) block.classList.add('ibt-heading');
  if (isRowFit(el, host)) block.classList.add('ibt-fit');
  block.style.fontSize = `${px}px`;
  block.style.lineHeight = '1.5';
  const trans = document.createElement('div');
  trans.className = 'ibt-trans';
  trans.textContent = '譯文';
  block.appendChild(trans);
  el.insertAdjacentElement('afterend', block);
  const src = getComputedStyle(el);
  const zh = getComputedStyle(trans);
  return {
    id: el.id,
    src: src.fontSize,
    trans: zh.fontSize,
    srcLine: src.lineHeight,
    line: zh.lineHeight,
    weight: zh.fontWeight,
    heading: isHeadingElement(el),
    fit: block.classList.contains('ibt-fit'),
  };
});
(document.getElementById('out') as HTMLElement).textContent = JSON.stringify(rows);
