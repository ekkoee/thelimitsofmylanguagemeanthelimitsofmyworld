// Free-tier Gemini quotas are per model. A 429 tells us which bucket ran out.
// PerDay: skip that model until the next Pacific midnight (Google's reset).
// PerMinute: remember the cap, and use another model that still has room.

export interface ModelQuota {
  rpm: number;
  recent: number[];
  exhaustedUntil: number;
  retryAt: number;
  hungUntil: number;
  /** Set when this id only appeared as quotaDimensions.model for another id. */
  aliasOnly?: boolean;
}

export interface QuotaState {
  /** First 16 hex chars of SHA-256(api key). A different key starts empty. */
  keyId: string;
  models: Record<string, ModelQuota>;
  switchedFrom: string;
  switchedTo: string;
}

export interface QuotaFailure {
  perDay: boolean;
  perMinute: boolean;
  quotaValue: number;
  retrySec: number | null;
  dimensionModel: string;
  calledModel: string;
}

export type PickResult =
  | { kind: 'ready'; model: string }
  | { kind: 'wait'; model: string; waitMs: number }
  | { kind: 'day'; resetAt: number }
  | { kind: 'none' };

export const IMAGE_CHAIN_BUDGET_MS = 20_000;
export const IMAGE_HEADER_TIMEOUT_MS = 15_000;
export const IMAGE_BODY_TIMEOUT_MS = 45_000;

const DAY_ID = /PerDay/i;
const MINUTE_ID = /PerMinute/i;

export function emptyQuotaState(): QuotaState {
  return { keyId: '', models: {}, switchedFrom: '', switchedTo: '' };
}

/** Stable id for an API key. The key itself is never stored. */
export async function fingerprintKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key.trim()));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Drop another key's exhausted models. The same key keeps its hint. */
export function quotaForKey(state: QuotaState, keyId: string): QuotaState {
  if (state.keyId === keyId) return state;
  return { ...emptyQuotaState(), keyId };
}

export function emptyModel(): ModelQuota {
  return { rpm: 0, recent: [], exhaustedUntil: 0, retryAt: 0, hungUntil: 0 };
}

export function normalizeQuotaState(raw: unknown): QuotaState {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<QuotaState>;
  const models: Record<string, ModelQuota> = {};
  const input = src.models && typeof src.models === 'object' ? src.models : {};
  for (const [id, value] of Object.entries(input)) {
    const m = value as Partial<ModelQuota> | null;
    if (!m || typeof m !== 'object') continue;
    models[id] = {
      rpm: Number(m.rpm) || 0,
      recent: Array.isArray(m.recent) ? m.recent.map(Number).filter((n) => Number.isFinite(n)) : [],
      exhaustedUntil: Number(m.exhaustedUntil) || 0,
      retryAt: Number(m.retryAt) || 0,
      hungUntil: Number(m.hungUntil) || 0,
      aliasOnly: Boolean(m.aliasOnly),
    };
  }
  return {
    keyId: typeof src.keyId === 'string' ? src.keyId : '',
    models,
    switchedFrom: typeof src.switchedFrom === 'string' ? src.switchedFrom : '',
    switchedTo: typeof src.switchedTo === 'string' ? src.switchedTo : '',
  };
}

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Page text: the saved model, then flash-lite so a spent daily cap still returns quickly. */
export function pageModelChain(model?: string): string[] {
  const primary = model && /^gemini/i.test(model) ? model : 'gemini-3.5-flash-lite';
  return dedupe([primary, 'gemini-2.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.5-flash']);
}

/**
 * Images default to gemini-2.5-flash-lite so gemini-3.5-flash's 20/day stays
 * available for page translation. 2.5-flash is only the next free-tier choice.
 * 3.5-flash is included only when the user picks it.
 */
export function imageModelChain(opts?: { model?: string; imageModel?: string }): string[] {
  const chosen = (opts?.imageModel || '').trim();
  const lite = 'gemini-2.5-flash-lite';
  const flash = 'gemini-2.5-flash';
  if (!chosen || chosen.toLowerCase() === 'auto') return [lite, flash];
  return dedupe([chosen, lite, flash]);
}

export function modelQuota(state: QuotaState, id: string): ModelQuota {
  const found = Object.keys(state.models).find((k) => k.toLowerCase() === id.toLowerCase());
  if (found) return state.models[found];
  const created = emptyModel();
  state.models[id] = created;
  return created;
}

function tzParts(ts: number, timeZone: string): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(ts))) bag[part.type] = part.value;
  let hh = Number(bag.hour);
  if (hh === 24) hh = 0;
  return {
    y: Number(bag.year), m: Number(bag.month), d: Number(bag.day),
    hh, mm: Number(bag.minute), ss: Number(bag.second),
  };
}

/** Google free-tier daily quotas reset at midnight Pacific. */
export function nextPacificMidnight(now: number): number {
  const cur = tzParts(now, 'America/Los_Angeles');
  const guess = Date.UTC(cur.y, cur.m - 1, cur.d + 1, 8, 0, 0);
  for (let t = guess - 6 * 3600_000; t <= guess + 6 * 3600_000; t += 30_000) {
    const p = tzParts(t, 'America/Los_Angeles');
    if (p.hh !== 0 || p.mm !== 0 || p.ss >= 30) continue;
    const exact = t - p.ss * 1000;
    if (exact > now) return exact;
  }
  return now + 24 * 3600_000;
}

export function formatTaipeiHM(ts: number): string {
  const p = tzParts(ts, 'Asia/Taipei');
  return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
}

function retrySecondsIn(text: string): number | null {
  const delay = /retryDelay["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)\s*s/i.exec(text)
    || /retry in ([\d.]+)\s*s/i.exec(text);
  if (!delay) return null;
  const n = Math.ceil(Number(delay[1]));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseQuotaFailure(body: string, calledModel: string): QuotaFailure | null {
  const start = body.indexOf('{');
  if (start < 0 && !/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(body)) return null;
  let json: { error?: { details?: unknown[] }; details?: unknown[] } | null = null;
  if (start >= 0) {
    try { json = JSON.parse(body.slice(start)) as { error?: { details?: unknown[] }; details?: unknown[] }; } catch { json = null; }
  }
  const details = (json?.error?.details ?? json?.details ?? []) as Array<Record<string, unknown>>;
  let perDay = false;
  let perMinute = false;
  let quotaValue = 0;
  let dimensionModel = '';
  let retrySec = retrySecondsIn(body);
  for (const detail of details) {
    if (typeof detail?.retryDelay === 'string') {
      const n = retrySecondsIn(String(detail.retryDelay));
      if (n) retrySec = n;
    }
    const violations = Array.isArray(detail?.violations) ? detail.violations as Array<Record<string, unknown>> : [];
    for (const violation of violations) {
      const id = String(violation?.quotaId || violation?.quotaMetric || '');
      const value = Number(violation?.quotaValue);
      if (Number.isFinite(value) && value > 0) quotaValue = value;
      const dims = violation?.quotaDimensions as { model?: unknown } | undefined;
      if (typeof dims?.model === 'string' && dims.model) dimensionModel = dims.model;
      if (DAY_ID.test(id)) perDay = true;
      if (MINUTE_ID.test(id)) perMinute = true;
    }
  }
  if (perDay) perMinute = false;
  if (!perDay && !perMinute && /\b429\b|RESOURCE_EXHAUSTED|quota/i.test(body)) perMinute = true;
  if (!perDay && !perMinute) return null;
  return { perDay, perMinute, quotaValue, retrySec, dimensionModel, calledModel };
}

function paceCap(rpm: number): number {
  if (!rpm || rpm < 1) return Number.POSITIVE_INFINITY;
  return Math.max(1, rpm - 1);
}

function prune(m: ModelQuota, now: number): void {
  m.recent = m.recent.filter((t) => t > now - 60_000).sort((a, b) => a - b);
}

/** Milliseconds until this model can take another request. Day-exhausted and hung models are not "waiting". */
export function minuteWaitMs(m: ModelQuota, now: number): number {
  prune(m, now);
  const retry = Math.max(0, m.retryAt - now);
  const cap = paceCap(m.rpm);
  if (!Number.isFinite(cap) || m.recent.length < cap) return retry;
  const oldest = m.recent[0] ?? now;
  return Math.max(retry, oldest + 60_000 - now);
}

export function pickModel(
  chain: string[],
  state: QuotaState,
  now: number,
  opts?: { ignoreExhausted?: boolean },
): PickResult {
  let bestWait: { model: string; waitMs: number } | null = null;
  let resetAt = 0;
  let sawDay = false;
  for (const model of chain) {
    const m = modelQuota(state, model);
    if (m.exhaustedUntil > now && !opts?.ignoreExhausted) {
      sawDay = true;
      if (!resetAt || m.exhaustedUntil < resetAt) resetAt = m.exhaustedUntil;
      continue;
    }
    if (m.hungUntil > now) continue;
    const waitMs = minuteWaitMs(m, now);
    if (waitMs <= 0) return { kind: 'ready', model };
    if (!bestWait || waitMs < bestWait.waitMs) bestWait = { model, waitMs };
  }
  if (bestWait) return { kind: 'wait', model: bestWait.model, waitMs: bestWait.waitMs };
  if (sawDay) return { kind: 'day', resetAt: resetAt || nextPacificMidnight(now) };
  return { kind: 'none' };
}

export function noteSuccess(state: QuotaState, model: string, now: number): void {
  for (const quota of Object.values(state.models)) quota.exhaustedUntil = 0;
  const m = modelQuota(state, model);
  prune(m, now);
  m.recent.push(now);
  m.retryAt = 0;
  m.hungUntil = 0;
}

/** 1.4.29 saved one global quota blob with no key id. It must not block 1.4.30. */
export function migrateQuotaState(raw: unknown): QuotaState {
  const parsed = normalizeQuotaState(raw);
  if (!parsed.keyId) return emptyQuotaState();
  return parsed;
}

export function noteDay(state: QuotaState, called: string, parsed: QuotaFailure, now: number): void {
  const until = nextPacificMidnight(now);
  const m = modelQuota(state, called);
  m.exhaustedUntil = until;
  if (parsed.dimensionModel && parsed.dimensionModel.toLowerCase() !== called.toLowerCase()) {
    const alias = modelQuota(state, parsed.dimensionModel);
    alias.exhaustedUntil = until;
    alias.aliasOnly = true;
  }
}

export function noteMinute(state: QuotaState, called: string, parsed: QuotaFailure, now: number): void {
  const m = modelQuota(state, called);
  if (parsed.quotaValue > 0) m.rpm = parsed.quotaValue;
  const sec = parsed.retrySec && parsed.retrySec > 0 && parsed.retrySec < 120 ? parsed.retrySec : 10;
  m.retryAt = now + sec * 1000;
}

export function noteHung(state: QuotaState, model: string, now: number): void {
  const m = modelQuota(state, model);
  m.hungUntil = now + 60_000;
}

export function noteSwitch(state: QuotaState, chain: string[], chosen: string, now: number): void {
  const skipped = chain.find((model) => model.toLowerCase() !== chosen.toLowerCase() && modelQuota(state, model).exhaustedUntil > now);
  if (!skipped) return;
  state.switchedFrom = skipped;
  state.switchedTo = chosen;
}

export function switchedMessage(model: string, fallback: string): string {
  return `Gemini 免費額度今天已用完（${model}），已改用 ${fallback}`;
}

export function allExhaustedMessage(resetAt: number): string {
  return `Gemini 免費額度已用完，將於 ${formatTaipeiHM(resetAt)} 重置`;
}

export function minuteMessage(sec: number): string {
  return `請求太頻繁，${Math.max(1, Math.ceil(sec))} 秒後自動重試`;
}

export function quotaStatusText(state: QuotaState, now = Date.now()): string {
  const lines: string[] = [];
  for (const [model, quota] of Object.entries(state.models || {})) {
    if (quota.aliasOnly || quota.exhaustedUntil <= now) continue;
    const fallback = state.switchedTo && state.switchedTo.toLowerCase() !== model.toLowerCase()
      ? state.switchedTo
      : 'gemini-2.5-flash-lite';
    lines.push(`${switchedMessage(model, fallback)}。將於 ${formatTaipeiHM(quota.exhaustedUntil)} 重置。`);
  }
  if (!lines.length) return 'Gemini 額度：今日還沒有模型用完免費額度。';
  return lines.join('\n');
}

export interface QuotaBinding {
  state: QuotaState;
  persist: () => void;
}

let binding: QuotaBinding | null = null;
let ready: Promise<void> = Promise.resolve();
let align: (key: string) => Promise<void> = async () => {};
let forceOnce = false;

export function bindQuota(next: QuotaBinding | null): void {
  binding = next;
}

/** Service worker installs this so a new API key does not inherit another key's caps. */
export function setQuotaAlign(fn: (key: string) => Promise<void>): void {
  align = fn;
}

export function alignQuotaKey(key: string): Promise<void> {
  return align(key);
}

export function requestGeminiRetry(): void {
  forceOnce = true;
}

export function consumeGeminiRetry(): boolean {
  const force = forceOnce;
  forceOnce = false;
  return force;
}

export function setQuotaReady(pending: Promise<void>): void {
  ready = pending;
}

export async function quotaBindingReady(): Promise<QuotaBinding | null> {
  try { await ready; } catch { /* keep the empty binding */ }
  return binding;
}
