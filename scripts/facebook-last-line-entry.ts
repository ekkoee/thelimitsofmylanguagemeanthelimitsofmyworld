import { collectUnits } from '../src/content/blocks';

const post = document.getElementById('post') as HTMLElement;
const out = document.getElementById('out') as HTMLElement;

function texts(): string[] {
  return collectUnits(post).map((u) => u.text);
}

const expanded = texts();
const last = post.querySelector('[data-last]') as HTMLElement;
last.innerHTML = 'Luka Doncic has the Lakers off to a 4-1 start… <div role="button" style="display:inline">查看更多</div>';
const collapsed = texts();
last.innerHTML = 'Luka Doncic has the Lakers off to a 4-1 start while putting up huge numbers. <div role="button" style="display:inline">顯示較少</div>';
const reexpanded = texts();
out.textContent = JSON.stringify({ expanded, collapsed, reexpanded });
