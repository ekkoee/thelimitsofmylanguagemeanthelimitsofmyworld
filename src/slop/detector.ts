// AI-slop heuristic detector — pure, synchronous, dependency-free, no network.
// Weights calibrated on 203 slop-list posts vs 203 human-developer posts (2026-11-01);
// see README. Scores are hints, never proof.

export interface PostData {
  text: string;
  isReply?: boolean;
}

export interface AccountData {
  handle?: string;
  createdAt?: string | number | Date; // account creation
  tweetCount?: number;
  followers?: number;
  following?: number;
  bio?: string;
  /** Other texts by the same author seen on this page (for near-duplicate check). */
  recentTexts?: string[];
  /** Seconds between this author's consecutive posts seen on the page. */
  gapsSec?: number[];
}

export type SlopLevel = 'low' | 'suspicious' | 'high';

export interface SlopResult {
  score: number; // 0–100
  level: SlopLevel;
  reasons: string[];
  features: Record<string, number>;
}

interface TextRule { id: string; re: RegExp; w: number; label: string; cap?: number }

// `w` = points per hit. Rules with `cap` count repeated matches (regex must be /g).
export const TEXT_RULES: TextRule[] = [
  { id: 'template_praise', re: /^(super interesting approach|huge congratulations on shipping|congrats on the launch|great breakdown|great catch|totally on point|completely agree with this perspective|this hit home)/i, w: 25, label: '罐頭讚美開頭' },
  { id: 'the_x_is_the', re: /^the [\w\s-]{2,40} is (the|where) (key |real |right |actual |interesting |practical |structural )?(shift|move|bottleneck|filter|part|value|win)/i, w: 20, label: '「The X is the key shift / real bottleneck」句型' },
  { id: 'abstract_jargon', re: /\b(shift from|forcing function|structural move|decision boundary|load-bearing|stigmergy|compute profile|real bottleneck)\b/gi, w: 6, cap: 3, label: '抽象術語' },
  { id: 'not_x_its_y', re: /\b(isn'?t|is not)\b[^.\n]{1,40}[.,;—]\s*(it'?s|it is)\b/i, w: 8, label: '「不是X，是Y」' },
  { id: 'the_real', re: /\bthe real (problem|question|bottleneck|work|gains?|win|lesson|cost)\b/i, w: 6, label: '「the real」句型' },
  { id: 'most_people', re: /\bmost (people|teams|founders|apps)\b/i, w: 4, label: '「Most people」開頭' },
  { id: 'lecture_hook', re: /^(want to |if you want to |stop |nobody knows|you'?re probably|your [\w ]{3,30} (is|might be) )/i, w: 10, label: '說教式勾子開頭' },
  { id: 'em_dash', re: /(?<!—)—(?!—)/g, w: 3, cap: 2, label: '破折號' },
  { id: 'arrow_cta', re: /[↓👇]|full guide|bookmark this/iu, w: 8, label: '向下箭頭或收藏呼籲' },
  { id: 'md_bold', re: /\*\*[^*\n]+\*\*/, w: 15, label: 'Markdown **粗體** 外洩' },
  { id: 'two_things', re: /^(two|three) (things|realities|mistakes|lessons) /im, w: 8, label: '「兩件事」清單開頭' },
  { id: 'caps_hook', re: /^[A-Z0-9 ,.'’]{25,}$/m, w: 6, label: '全大寫勾子' },
  { id: 'promo_goto', re: /\bmy go-to\b|\bgo-to (accounts?|reads?)\b/i, w: 12, label: '置入「my go-to」帳號' },
  { id: 'zh_judgement', re: /判断：|判斷：/, w: 20, label: '「判斷：X 的人值得試」模板' },
  { id: 'zh_praise_then_q', re: /(确实|確實|挺实用|挺實用|这个思路|這個思路)[\s\S]*(我更好奇|我更关心|我更關心|我一般|我习惯|我習慣)[\s\S]*[?？]/, w: 20, label: '中文「肯定→我的做法→提問」模板' },
  { id: 'zh_persona', re: /【[^】]{2,12}·[^】]{1,6}】/, w: 8, label: '【系列·欄目】標籤' },
];

const AGENT_BIO = /agent-run|bot (does|runs) the posting|a bot runs this|automated account|ai-run account/i;
const SLOGAN_BIO = /what (actually )?works|what breaks|with receipts|for humans & agents|agents write our code|ai build in public|posting the proof/i;

function stripMentions(t: string): string {
  return t.trim().replace(/^(@\w+\s+)+/, '');
}

function norm(s: string): string {
  return stripMentions(s).toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 80);
}

function toTime(v: AccountData['createdAt']): number | null {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

export const LEVELS = { suspicious: 15, high: 35 } as const;

export function scorePost(post: PostData, account: AccountData = {}, now: number = Date.now()): SlopResult {
  const reasons: string[] = [];
  const features: Record<string, number> = {};
  let score = 0;
  const add = (id: string, pts: number, label: string) => {
    if (!pts) return;
    features[id] = pts;
    score += pts;
    reasons.push(`${label}（+${pts}）`);
  };

  const t = stripMentions(post.text || '');
  for (const r of TEXT_RULES) {
    if (r.cap) {
      const n = (t.match(r.re) || []).length;
      if (n) add(r.id, Math.min(n, r.cap) * r.w, n > 1 ? `${r.label} ×${n}` : r.label);
    } else if (r.re.test(t)) add(r.id, r.w, r.label);
  }

  // account-level
  const created = toTime(account.createdAt);
  if (created != null && account.tweetCount != null) {
    const days = Math.max(1, (now - created) / 864e5);
    const perDay = account.tweetCount / days;
    if (days < 180) add('young_account', 10, `帳號僅 ${Math.round(days)} 天`);
    if (perDay >= 50) add('rate_50', 25, `平均 ${Math.round(perDay)} 則/天`);
    else if (perDay >= 20 && days < 730) add('rate_20', 12, `平均 ${Math.round(perDay)} 則/天`);
  }
  if (account.bio && AGENT_BIO.test(account.bio)) add('agent_bio', 60, '簡介自承由 bot/agent 營運');
  if (account.bio && SLOGAN_BIO.test(account.bio)) add('slogan_bio', 10, '簡介含 AI 帳號常見口號');

  // page-level behaviour (not calibrated: datasets lacked comparable timelines)
  if (account.recentTexts?.length) {
    const me = norm(t);
    const dups = me.length > 20 ? account.recentTexts.filter((s) => norm(s) === me).length : 0;
    if (dups) add('near_duplicate', Math.min(dups * 20, 40), `同作者重複貼文 ×${dups}`);
  }
  const gaps = account.gapsSec ?? [];
  if (gaps.length >= 5 && gaps.filter((g) => g < 180).length / gaps.length > 0.7) add('burst', 15, '連續發文間隔 <3 分鐘');

  score = Math.min(100, score);
  const level: SlopLevel = score >= LEVELS.high ? 'high' : score >= LEVELS.suspicious ? 'suspicious' : 'low';
  return { score, level, reasons, features };
}
