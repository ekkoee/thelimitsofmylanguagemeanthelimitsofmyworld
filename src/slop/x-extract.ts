// X DOM → PostData/AccountData, plus a quiet detect button on each action bar.
// Additive only: reads a clone of the tweet text and never edits .ibt-block.
import { SELECTORS, insideXVideo } from '../content/selectors';
import { loadSettings } from '../core/storage';
import { blend } from './slop-check';
import { LEVELS, scorePost, type AccountData, type PostData, type SlopLevel, type SlopResult } from './detector';

const BTN_ATTR = 'data-ibt-slop';
const LEVEL_LABEL: Record<SlopLevel, string> = {
  low: '低可能為 AI 生成',
  suspicious: '中可能為 AI 生成',
  high: '高可能為 AI 生成',
};

const ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="6.25" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 16.5 20 20.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

/** Original tweet text only: excludes our .ibt-block translation lines. */
export function tweetText(article: HTMLElement): string {
  const tt = article.querySelector<HTMLElement>(SELECTORS.x.text[0]);
  if (!tt) return '';
  const clone = tt.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.ibt-block').forEach((n) => n.remove());
  clone.querySelectorAll('img[alt]').forEach((img) => img.replaceWith((img as HTMLImageElement).alt));
  return (clone.innerText || clone.textContent || '').trim();
}

export function tweetHandle(article: HTMLElement): string | undefined {
  const a = article.querySelector<HTMLAnchorElement>('[data-testid="User-Name"] a[href^="/"]');
  const m = a?.getAttribute('href')?.match(/^\/(\w{1,15})/);
  return m?.[1];
}

export function tweetTime(article: HTMLElement): number | undefined {
  const dt = article.querySelector('time')?.getAttribute('datetime');
  const t = dt ? Date.parse(dt) : NaN;
  return Number.isFinite(t) ? t : undefined;
}

export function extractPost(article: HTMLElement): PostData {
  return {
    text: tweetText(article),
    isReply: !!article.querySelector('[data-testid="socialContext"]') || /Replying to|回覆|回复/.test(article.innerText.slice(0, 200)),
  };
}

export const profileCache = new Map<string, Partial<AccountData>>();

export function extractAccount(article: HTMLElement, cache: Map<string, Partial<AccountData>> = profileCache): AccountData {
  const handle = tweetHandle(article);
  const acc: AccountData = { handle, ...(handle ? cache.get(handle.toLowerCase()) : {}) };
  if (!handle) return acc;
  const mine = Array.from(document.querySelectorAll<HTMLElement>('article')).filter((a) => a !== article && tweetHandle(a)?.toLowerCase() === handle.toLowerCase());
  acc.recentTexts = mine.map(tweetText).filter(Boolean);
  const times = [article, ...mine].map(tweetTime).filter((t): t is number => t != null).sort((a, b) => a - b);
  acc.gapsSec = times.slice(1).map((t, i) => (t - times[i]) / 1000);
  return acc;
}

export function harvestProfile(): void {
  const m = location.pathname.match(/^\/(\w{1,15})\/?$/);
  if (!m) return;
  const bio = document.querySelector<HTMLElement>(SELECTORS.x.bio[0])?.innerText;
  const num = (sel: string) => {
    const raw = document.querySelector<HTMLElement>(sel)?.innerText.replace(/,/g, '') || '';
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return undefined;
    return /K/i.test(raw) ? n * 1e3 : /M/i.test(raw) ? n * 1e6 : /萬|万/.test(raw) ? n * 1e4 : n;
  };
  const joined = document.querySelector<HTMLElement>('[data-testid="UserJoinDate"]')?.innerText;
  const prev = profileCache.get(m[1].toLowerCase()) ?? {};
  profileCache.set(m[1].toLowerCase(), {
    ...prev,
    bio: bio ?? prev.bio,
    following: num(`a[href="/${m[1]}/following"] span`) ?? prev.following,
    followers: num(`a[href="/${m[1]}/verified_followers"] span`) ?? num(`a[href="/${m[1]}/followers"] span`) ?? prev.followers,
    createdAt: joined ? Date.parse(joined.replace(/^.*?(Joined|加入)\s*/, '')) || prev.createdAt : prev.createdAt,
  });
}

export function scoreArticle(article: HTMLElement): SlopResult {
  return scorePost(extractPost(article), extractAccount(article));
}

function levelOf(score: number): SlopLevel {
  return score >= LEVELS.high ? 'high' : score >= LEVELS.suspicious ? 'suspicious' : 'low';
}

function pageIsDark(): boolean {
  const bg = getComputedStyle(document.body || document.documentElement).backgroundColor || '';
  const m = bg.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return window.matchMedia('(prefers-color-scheme: dark)').matches;
  const y = 0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3]);
  return y < 150;
}

let card: HTMLElement | null = null;
let dismissReady = false;

function closeCard(): void {
  card?.remove();
  card = null;
}

function ensureDismiss(): void {
  if (dismissReady) return;
  dismissReady = true;
  window.addEventListener('pointerdown', (event) => {
    if (!card) return;
    const target = event.target;
    if (target instanceof Node && card.contains(target)) return;
    if (target instanceof Element && target.closest('.ibt-slop-btn')) return;
    closeCard();
  }, true);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeCard();
  }, true);
}

function paintCard(host: HTMLElement, result: SlopResult): void {
  host.replaceChildren();
  const level = document.createElement('div');
  level.className = 'ibt-slop-level';
  level.textContent = LEVEL_LABEL[result.level];
  const score = document.createElement('div');
  score.className = 'ibt-slop-score';
  score.textContent = `分數 ${result.score}`;
  host.append(level, score);
  if (result.reasons.length) {
    const list = document.createElement('ul');
    list.className = 'ibt-slop-reasons';
    for (const reason of result.reasons) {
      const item = document.createElement('li');
      item.textContent = reason;
      list.appendChild(item);
    }
    host.appendChild(list);
  } else {
    const quiet = document.createElement('p');
    quiet.className = 'ibt-slop-score';
    quiet.textContent = '沒有明顯的生成痕跡。';
    host.appendChild(quiet);
  }
}

function placeCard(anchor: HTMLElement, result: SlopResult): HTMLElement {
  ensureDismiss();
  closeCard();
  const host = document.createElement('div');
  host.className = pageIsDark() ? 'ibt-slop-card ibt-slop-dark' : 'ibt-slop-card';
  paintCard(host, result);
  document.documentElement.appendChild(host);
  const rect = anchor.getBoundingClientRect();
  const width = host.offsetWidth || 280;
  const height = host.offsetHeight || 120;
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.left));
  const below = rect.bottom + 8;
  host.style.left = `${left}px`;
  host.style.top = `${below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 8) : below}px`;
  card = host;
  return host;
}

async function onDetect(article: HTMLElement, button: HTMLElement): Promise<void> {
  const local = scoreArticle(article);
  const host = placeCard(button, local);
  const text = tweetText(article);
  let settings;
  try { settings = await loadSettings(); } catch { return; }
  if (!settings.slopApi || !settings.slopApiKey || !host.isConnected) return;
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'slopCheck', text }) as { ok?: boolean; prob?: number };
    if (!resp?.ok || resp.prob == null || !host.isConnected) return;
    const score = blend(local.score, resp.prob, text.length);
    paintCard(host, { ...local, score, level: levelOf(score) });
  } catch { /* keep the local score */ }
}

/** One button per tweet action bar. Safe to call on every scan. */
export function ensureSlopButtons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('article').forEach((article) => {
    if (insideXVideo(article)) return;
    const bar = article.querySelector<HTMLElement>('[role="group"]');
    if (!bar || !article.querySelector(SELECTORS.x.text[0])) return;
    if (bar.querySelector('.ibt-slop-btn')) return;
    article.setAttribute(BTN_ATTR, '1');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ibt-slop-btn';
    btn.setAttribute('aria-label', '偵測是否像 AI 生成');
    btn.innerHTML = ICON;
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void onDetect(article, btn);
    });
    bar.appendChild(btn);
  });
}

export function clearSlopButtons(): void {
  closeCard();
  document.querySelectorAll('.ibt-slop-btn').forEach((node) => node.remove());
  document.querySelectorAll<HTMLElement>(`[${BTN_ATTR}]`).forEach((node) => node.removeAttribute(BTN_ATTR));
}
