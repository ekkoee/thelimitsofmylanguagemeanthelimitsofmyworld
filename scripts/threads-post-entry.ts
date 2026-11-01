import { collectUnits } from '../src/content/blocks';

const post = document.getElementById('post') as HTMLElement;
const units = collectUnits(post).map((u) => u.text);
(document.getElementById('out') as HTMLElement).textContent = JSON.stringify(units);
