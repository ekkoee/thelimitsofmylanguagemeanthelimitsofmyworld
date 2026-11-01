// One Gemini generateContent call at a time, on the best model that still has quota.
// Image calls give up a silent socket after 15s and keep the whole chain under 20s.

import {
  IMAGE_BODY_TIMEOUT_MS,
  IMAGE_CHAIN_BUDGET_MS,
  IMAGE_HEADER_TIMEOUT_MS,
  QuotaFailure,
  QuotaState,
  allExhaustedMessage,
  minuteMessage,
  noteDay,
  noteHung,
  noteMinute,
  noteSuccess,
  noteSwitch,
  parseQuotaFailure,
  pickModel,
  nextPacificMidnight,
} from './quota-router';

export class RouteSignal extends Error {
  constructor(
    readonly code: 'day' | 'minute' | 'timeout' | 'network' | 'server' | 'auth',
    readonly retrySec: number | null,
    readonly status: number,
    readonly model: string,
  ) {
    super(code);
  }
}

export interface GeminiRouteOpts {
  key: string;
  chain: string[];
  purpose: 'page' | 'image';
  state: QuotaState;
  onState?: (state: QuotaState) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  buildBody: (model: string) => unknown;
  log?: (line: string) => void;
  budgetMs?: number;
  headerTimeoutMs?: number;
  bodyTimeoutMs?: number;
  /** User clicked 重試: try a model once even if it is marked exhausted. */
  force?: boolean;
}

function isAbort(err: unknown): boolean {
  const name = String((err as { name?: string })?.name || '');
  const msg = String((err as { message?: unknown })?.message ?? err ?? '');
  return name === 'AbortError' || /abort/i.test(msg);
}

async function readBody(res: Response, ctrl: AbortController, bodyMs: number): Promise<string> {
  const timer = setTimeout(() => ctrl.abort(), bodyMs);
  try {
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function callModel(
  opts: GeminiRouteOpts,
  model: string,
  headerMs: number,
  bodyMs: number,
): Promise<unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(opts.key)}`;
  const ctrl = new AbortController();
  const headerTimer = setTimeout(() => ctrl.abort(), headerMs);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.buildBody(model)),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(headerTimer);
    if (isAbort(err) || ctrl.signal.aborted) throw new RouteSignal('timeout', null, 504, model);
    throw new RouteSignal('network', null, 0, model);
  }
  clearTimeout(headerTimer);
  let raw = '';
  try {
    raw = await readBody(res, ctrl, bodyMs);
  } catch (err) {
    if (isAbort(err) || ctrl.signal.aborted) throw new RouteSignal('timeout', null, 504, model);
    throw new RouteSignal('network', null, 0, model);
  }
  if (!res.ok) {
    opts.log?.(`[IBT] ${opts.purpose} gemini fail model=${model} status=${res.status} ${raw.slice(0, 300)}`);
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      if (/api[_ ]?key|API_KEY_INVALID|unregistered|permission denied/i.test(raw)) {
        throw new RouteSignal('auth', null, res.status, model);
      }
    }
    if (res.status === 429) {
      const parsed: QuotaFailure | null = parseQuotaFailure(raw, model);
      const now = opts.now?.() ?? Date.now();
      if (parsed?.perDay) {
        noteDay(opts.state, model, parsed, now);
        opts.onState?.(opts.state);
        throw new RouteSignal('day', parsed.retrySec, 429, model);
      }
      const minute = parsed ?? {
        perDay: false, perMinute: true, quotaValue: 0, retrySec: null, dimensionModel: '', calledModel: model,
      };
      noteMinute(opts.state, model, minute, now);
      opts.onState?.(opts.state);
      throw new RouteSignal('minute', minute.retrySec, 429, model);
    }
    if (res.status >= 500) throw new RouteSignal('server', null, res.status, model);
    throw new Error(`Gemini ${res.status}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Gemini 沒有回傳譯文');
  }
}

/**
 * Try the chain. Daily-exhausted models are skipped. A per-minute block moves
 * to the next model; images wait and retry only when that still fits the budget.
 */
export async function executeGeminiRoute(opts: GeminiRouteOpts): Promise<{ model: string; json: unknown }> {
  const now = () => opts.now?.() ?? Date.now();
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? (() => {});
  const budget = opts.budgetMs ?? (opts.purpose === 'image' ? IMAGE_CHAIN_BUDGET_MS : 25_000);
  const deadline = now() + budget;
  const headerCap = opts.headerTimeoutMs ?? (opts.purpose === 'image' ? IMAGE_HEADER_TIMEOUT_MS : 25_000);
  const bodyCap = opts.bodyTimeoutMs ?? IMAGE_BODY_TIMEOUT_MS;
  const attempts = new Map<string, number>();
  let last: RouteSignal | null = null;
  let minuteSec = 0;
  let force = Boolean(opts.force);

  for (let step = 0; step < 8; step++) {
    const t = now();
    if (t >= deadline) break;
    const pick = pickModel(opts.chain, opts.state, t, { ignoreExhausted: force });
    force = false;
    if (pick.kind === 'day') throw new Error(allExhaustedMessage(pick.resetAt));
    if (pick.kind === 'none') break;
    if (pick.kind === 'wait') {
      const sec = Math.max(1, Math.ceil(pick.waitMs / 1000));
      minuteSec = sec;
      if (opts.purpose !== 'image' || t + pick.waitMs >= deadline - 400) break;
      log(`[IBT] ${opts.purpose} gemini retry model=${pick.model} in ${sec}s`);
      await sleep(pick.waitMs);
      continue;
    }
    const seen = attempts.get(pick.model) ?? 0;
    if (seen >= 2) break;
    attempts.set(pick.model, seen + 1);
    noteSwitch(opts.state, opts.chain, pick.model, t);
    const headerMs = Math.min(headerCap, Math.max(400, deadline - t));
    log(`[IBT] ${opts.purpose} gemini ${new Date(t).toISOString()} model=${pick.model}`);
    try {
      const json = await callModel(opts, pick.model, headerMs, bodyCap);
      noteSuccess(opts.state, pick.model, now());
      opts.onState?.(opts.state);
      log(`[IBT] ${opts.purpose} gemini done model=${pick.model} ${now() - (deadline - budget)}ms`);
      return { model: pick.model, json };
    } catch (err) {
      if (err instanceof RouteSignal) {
        last = err;
        if (err.code === 'timeout') noteHung(opts.state, pick.model, now());
        if (err.code === 'auth') throw new Error('Gemini 金鑰無效');
        if (err.code === 'day' || err.code === 'minute' || err.code === 'timeout' || err.code === 'server') {
          if (err.code === 'minute') minuteSec = Math.max(minuteSec, err.retrySec || 10);
          opts.onState?.(opts.state);
          continue;
        }
        if (err.code === 'network') {
          opts.onState?.(opts.state);
          continue;
        }
      }
      throw err;
    }
  }
  if (minuteSec > 0) throw new Error(minuteMessage(minuteSec));
  if (last?.code === 'timeout') throw new Error(`Gemini 回應逾時（${last.model}）`);
  if (last?.code === 'network') throw new Error('連不到 Gemini，請檢查網路');
  if (last?.code === 'server') throw new Error(`Gemini 服務暫時錯誤（${last.status}）`);
  if (last?.code === 'day') throw new Error(allExhaustedMessage(soonestReset(opts.state, now())));
  throw new Error(opts.purpose === 'image' ? 'Gemini 沒有回傳圖片譯文' : 'Gemini 沒有回傳譯文');
}

function soonestReset(state: QuotaState, now: number): number {
  let reset = 0;
  for (const quota of Object.values(state.models)) {
    if (quota.exhaustedUntil > now && (!reset || quota.exhaustedUntil < reset)) reset = quota.exhaustedUntil;
  }
  return reset || nextPacificMidnight(now);
}
