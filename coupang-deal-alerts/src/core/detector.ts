/**
 * "평시보다 세게 할인" detector: a pure function over a product's own price history.
 *
 * Baseline ("usual" price)  : median of observed prices in the trailing window (robust to short sales).
 * Usual discount depth      : distribution of historical drops below the baseline; the p90 of that
 *                             distribution is what this product "normally" does. A current drop must
 *                             exceed BOTH an absolute floor and (usual depth + margin) to count as unusual.
 * Glitch guard              : implausibly deep drops (> maxPlausibleDrop) need a second confirming poll.
 * Dedup / re-arm            : one alert per deal episode; re-alert only if the price deepens by
 *                             `deepenStep` of baseline; re-arm after the price recovers or after `episodeMaxMs`.
 * Cold start                : no alert until `minObservations` spanning `minSpanMs`.
 *
 * NOTE: this initial implementation is refined by the design synthesis; params are tunable.
 */
import type { DealDecision, Detector, DetectorContext, DetectorOutcome, PriceObservation } from './types.js';

export interface DetectorParams {
  /** trailing window used for the baseline (ms). Default 30 days */
  windowMs: number;
  /** minimum number of prior observations. Default 6 */
  minObservations: number;
  /** the prior observations must span at least this long (ms). Default 3 days */
  minSpanMs: number;
  /** absolute floor for the drop vs baseline. Default 0.15 (15%) */
  minDrop: number;
  /** margin above the product's usual discount depth (p90 of historical drops). Default 0.05 */
  marginOverUsual: number;
  /** drop considered a strong deal for severity scaling. Default 0.45 */
  strongDrop: number;
  /** drops deeper than this need confirmation by the next poll (price glitch guard). Default 0.7 */
  maxPlausibleDrop: number;
  /** re-alert while active only if price falls a further fraction of baseline. Default 0.10 */
  deepenStep: number;
  /** episode ends when price recovers above baseline*(1 - recoverFraction*minDrop). Default 0.5 */
  recoverFraction: number;
  /** episode also ends after this long (ms). Default 7 days */
  episodeMaxMs: number;
  /** minimum absolute saving in KRW. Default 2000 */
  minSavingWon: number;
}

export const DEFAULT_DETECTOR_PARAMS: DetectorParams = {
  windowMs: 30 * 24 * 3600_000,
  minObservations: 6,
  minSpanMs: 3 * 24 * 3600_000,
  minDrop: 0.15,
  marginOverUsual: 0.05,
  strongDrop: 0.45,
  maxPlausibleDrop: 0.7,
  deepenStep: 0.10,
  recoverFraction: 0.5,
  episodeMaxMs: 7 * 24 * 3600_000,
  minSavingWon: 2000,
};

export interface AlertState {
  /** an alert episode is active (already notified) */
  active: boolean;
  /** price at which the last alert fired */
  alertedPrice: number | null;
  alertedAt: number | null;
  /** baseline used for the last alert */
  alertedBaseline: number | null;
  /** a suspiciously deep drop awaiting confirmation */
  pendingPrice: number | null;
  pendingAt: number | null;
}

const EMPTY_STATE: AlertState = { active: false, alertedPrice: null, alertedAt: null, alertedBaseline: null, pendingPrice: null, pendingAt: null };

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

export function decide(
  history: PriceObservation[],
  current: PriceObservation,
  prev: AlertState | null,
  params: DetectorParams = DEFAULT_DETECTOR_PARAMS,
): DetectorOutcome<AlertState> {
  const state: AlertState = { ...EMPTY_STATE, ...(prev ?? {}) };
  const no = (reason: string, baseline: number | null = null, drop: number | null = null): DetectorOutcome<AlertState> => ({
    decision: { alert: false, severity: 0, reason, baselinePrice: baseline, discountFromBaseline: drop },
    newState: state,
  });

  if (!(current.price > 0)) return no('가격 정보 없음');
  const win = history.filter((h) => h.t >= current.t - params.windowMs && h.t < current.t && h.price > 0);
  if (win.length < params.minObservations) return no(`관측치 부족 (${win.length}/${params.minObservations})`);
  const span = win[win.length - 1]!.t - win[0]!.t;
  if (span < params.minSpanMs) return no('관측 기간 부족');

  const prices = win.map((w) => w.price);
  const baseline = median(prices);
  if (!(baseline > 0)) return no('기준가 계산 불가');
  const drop = (baseline - current.price) / baseline;

  // usual discount depth for THIS product: p90 of historical drops below the baseline
  const histDrops = prices.map((p) => Math.max(0, (baseline - p) / baseline));
  const usualDepth = quantile(histDrops, 0.9);
  const threshold = Math.max(params.minDrop, usualDepth + params.marginOverUsual);
  const saving = baseline - current.price;

  // ---- episode bookkeeping: recovery / expiry ----
  if (state.active) {
    const recovered = current.price >= baseline * (1 - params.recoverFraction * params.minDrop);
    const expired = state.alertedAt !== null && current.t - state.alertedAt > params.episodeMaxMs;
    if (recovered || expired) {
      state.active = false; state.alertedPrice = null; state.alertedAt = null; state.alertedBaseline = null;
    }
  }

  if (drop < threshold || saving < params.minSavingWon) {
    state.pendingPrice = null; state.pendingAt = null;
    return no(drop > 0 ? `평시 대비 ${Math.round(drop * 100)}% (기준 미달)` : '할인 아님', baseline, drop);
  }

  // ---- glitch guard: implausible drop must repeat on the next poll ----
  if (drop > params.maxPlausibleDrop) {
    if (state.pendingPrice === null || Math.abs(state.pendingPrice - current.price) / baseline > 0.02) {
      state.pendingPrice = current.price; state.pendingAt = current.t;
      return no('비정상적으로 큰 하락, 다음 관측에서 확인 대기', baseline, drop);
    }
  }
  state.pendingPrice = null; state.pendingAt = null;

  // ---- dedup within an active episode ----
  if (state.active && state.alertedPrice !== null) {
    const deepened = (state.alertedPrice - current.price) / baseline >= params.deepenStep;
    if (!deepened) return no('이미 알림 보낸 특가 진행 중', baseline, drop);
  }

  // ---- severity: how far past the threshold, scaled to strongDrop, plus new-low bonus ----
  const minWin = Math.min(...prices);
  const isNewLow = current.price < minWin;
  const excess = clamp01((drop - threshold) / Math.max(0.05, params.strongDrop - threshold));
  const severity = clamp01(0.35 + 0.5 * excess + (isNewLow ? 0.15 : 0));
  const days = Math.max(1, Math.round(span / 86_400_000));
  const reason = `${isNewLow ? `최근 ${days}일 최저가, ` : ''}평시 대비 ${Math.round(drop * 100)}% 할인`
    + (usualDepth >= 0.05 ? ` (평소 할인폭 ${Math.round(usualDepth * 100)}%)` : '');

  state.active = true; state.alertedPrice = current.price; state.alertedAt = current.t; state.alertedBaseline = baseline;
  const decision: DealDecision = { alert: true, severity, reason, baselinePrice: baseline, discountFromBaseline: drop };
  return { decision, newState: state };
}

export function createDetector(params: Partial<DetectorParams> = {}): Detector<AlertState> {
  const p: DetectorParams = { ...DEFAULT_DETECTOR_PARAMS, ...params };
  return {
    historyWindowMs: p.windowMs,
    decide(history: PriceObservation[], current: PriceObservation, state: AlertState | null, _ctx: DetectorContext) {
      return decide(history, current, state, p);
    },
  };
}
