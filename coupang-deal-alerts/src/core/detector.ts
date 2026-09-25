/**
 * "평시보다 세게 할인" detector: a pure function over a product's own price history.
 *
 * Synthesised from two independent designs (robust plateau baseline + event/step detection):
 *  1. Irregular polls are aggregated into KST daily buckets (median/min price, median rank) over a
 *     45-day window; products re-entering after weeks reuse older buckets in "stale" mode.
 *  2. The REGULAR price R is the Highest Supported Plateau: the highest price level (±2% log band)
 *     supported by ≥4 days and ≥15% of days. Unlike a median it is immune to products that are on
 *     sale most of the time; a Q75 fallback handles drifting prices.
 *  3. The product's USUAL discount depth is the Q90 of daily depths below R, shrunk toward a
 *     category prior while history is short. A deal must beat usual depth by a margin that grows
 *     with the noise of the regular price itself, and by at least 15% absolute (20% cold).
 *  4. Gates: saving ≥ 2,000 KRW; price materially below the product's usual-low level L (Q20 of
 *     daily medians) so "price rose then returned" never alerts; a real STEP vs the recent
 *     plateau so gradual declines never alert.
 *  5. Glitch guard: drops ≥50%, cold or stale history need a second confirming poll within 72h,
 *     unless the popularity rank surged (corroboration).
 *  6. Episode state: the baseline is frozen when an alert fires; one alert per episode, re-alert
 *     only on a material deepening; re-arm after two recovered polls (one after a long gap) or 21 days.
 *  7. Severity 0..1 = how far past the threshold + how rare the price is in the product's history
 *     (+ rank bonus); cold-tier alerts are capped so only 보통/민감 users receive them.
 */
import type { CategoryPrior, DealDecision, Detector, DetectorContext, DetectorOutcome, PriceObservation } from './types.js';

export interface DetectorParams {
  windowDays: number;          // 45
  minDaysCold: number;         // 3  buckets: below this never alert
  minDaysFull: number;         // 7  buckets: full mode
  fullTrustDays: number;       // 21 buckets: own usual depth fully trusted
  maxStaleDays: number;        // 120 days: how far back re-entering products may look
  maxStaleBuckets: number;     // 30
  stalePenalty: number;        // 0.03
  plateauBand: number;         // 0.02 (±2% log band)
  plateauMinDays: number;      // 4
  plateauMinFrac: number;      // 0.15
  fallbackQuantile: number;    // 0.75
  usualDepthQ: number;         // 0.90
  deeperMargin: number;        // 0.05
  minDrop: number;             // 0.15
  minDropCold: number;         // 0.20
  defaultPriorDepth: number;   // 0.10
  minSavingWon: number;        // 2000
  lowLevelQ: number;           // 0.20 -> usual-low level L
  minBelowLow: number;         // 0.05 -> price must be ≥5% below L
  stepFrac: number;            // 0.6 -> step vs recent plateau ≥ 0.6*threshold
  confirmDrop: number;         // 0.50
  confirmTol: number;          // 0.03
  confirmMaxGapMs: number;     // 72h
  rankSurgeDelta: number;      // 15
  rankSurgeTop: number;        // 10
  deepenStep: number;          // 0.08 of baseline
  recoverPolls: number;        // 2
  recoverGapMs: number;        // 12h: one recovered poll is enough after this long a gap
  maxEpisodeDays: number;      // 21
  exceedScale: number;         // 0.25
  coldSeverityCap: number;     // 0.60
}

export const DEFAULT_DETECTOR_PARAMS: DetectorParams = {
  windowDays: 45, minDaysCold: 3, minDaysFull: 7, fullTrustDays: 21, maxStaleDays: 120, maxStaleBuckets: 30, stalePenalty: 0.03,
  plateauBand: 0.02, plateauMinDays: 4, plateauMinFrac: 0.15, fallbackQuantile: 0.75, usualDepthQ: 0.9, deeperMargin: 0.05,
  minDrop: 0.15, minDropCold: 0.20, defaultPriorDepth: 0.10, minSavingWon: 2000, lowLevelQ: 0.20, minBelowLow: 0.05, stepFrac: 0.6,
  confirmDrop: 0.5, confirmTol: 0.03, confirmMaxGapMs: 72 * 3600_000, rankSurgeDelta: 15, rankSurgeTop: 10,
  deepenStep: 0.08, recoverPolls: 2, recoverGapMs: 12 * 3600_000, maxEpisodeDays: 21, exceedScale: 0.25, coldSeverityCap: 0.6,
};

export interface AlertState {
  active: boolean;
  episodeStartT: number | null;
  /** frozen regular price / threshold / usual depth for the active episode */
  baselinePrice: number | null;
  thresholdAtStart: number | null;
  usualAtStart: number | null;
  lastAlertPrice: number | null;
  lastAlertT: number | null;
  alertCount: number;
  recoverStreak: number;
  pending: { price: number; t: number } | null;
  lastObsT: number | null;
  /** the product's own usual depth (full mode only); used by the pipeline to build category priors */
  ownUsualDepth: number | null;
}

const EMPTY: AlertState = { active: false, episodeStartT: null, baselinePrice: null, thresholdAtStart: null, usualAtStart: null,
  lastAlertPrice: null, lastAlertT: null, alertCount: 0, recoverStreak: 0, pending: null, lastObsT: null, ownUsualDepth: null };

const DAY = 86_400_000;
const KST_OFFSET = 9 * 3600_000;

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
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const kstDay = (t: number) => Math.floor((t + KST_OFFSET) / DAY);
const eqTol = (p: number) => Math.max(100, 0.005 * p);

interface Bucket { day: number; t: number; median: number; min: number; rank: number }

function bucketize(obs: PriceObservation[]): Bucket[] {
  const by = new Map<number, PriceObservation[]>();
  for (const o of obs) { const d = kstDay(o.t); (by.get(d) ?? by.set(d, []).get(d)!).push(o); }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([day, os]) => ({
    day, t: Math.max(...os.map((o) => o.t)), median: median(os.map((o) => o.price)), min: Math.min(...os.map((o) => o.price)), rank: median(os.map((o) => o.rank)),
  }));
}

/** Highest Supported Plateau regular price; null when no plateau qualifies. */
export function plateauPrice(medians: number[], p: DetectorParams): { R: number; band: number[] } | null {
  const desc = [...medians].sort((a, b) => b - a);
  const lim = Math.log(1 + p.plateauBand);
  const need = Math.max(p.plateauMinDays, Math.ceil(p.plateauMinFrac * medians.length));
  for (const c of desc) {
    const band = medians.filter((x) => Math.abs(Math.log(x / c)) <= lim);
    if (band.length >= need) return { R: median(band), band };
  }
  return null;
}

export function decide(
  history: PriceObservation[],
  current: PriceObservation,
  prev: AlertState | null,
  params: DetectorParams = DEFAULT_DETECTOR_PARAMS,
  prior: CategoryPrior | null = null,
): DetectorOutcome<AlertState> {
  const P = params;
  const st: AlertState = { ...EMPTY, ...(prev ?? {}) };
  const price = current.price;
  const gapSinceLast = st.lastObsT !== null ? current.t - st.lastObsT : null;
  st.lastObsT = current.t;
  const no = (reason: string, baseline: number | null = null, drop: number | null = null): DetectorOutcome<AlertState> =>
    ({ decision: { alert: false, severity: 0, reason, baselinePrice: baseline, discountFromBaseline: drop }, newState: st });
  if (!(price > 0)) return no('가격 정보 없음');

  // ---- 1. window + buckets (episode days are excluded from baseline estimation) ----
  const valid = history.filter((h) => h.t < current.t && h.price > 0);
  let inWin = valid.filter((h) => current.t - h.t <= P.windowDays * DAY);
  let stale = false;
  if (bucketize(inWin).length < P.minDaysFull) {
    const ext = valid.filter((h) => current.t - h.t <= P.maxStaleDays * DAY);
    const extB = bucketize(ext);
    if (extB.length > bucketize(inWin).length) {
      const keepDays = new Set(extB.slice(-P.maxStaleBuckets).map((b) => b.day));
      inWin = ext.filter((h) => keepDays.has(kstDay(h.t)));
      stale = extB.length >= P.minDaysFull && bucketize(valid.filter((h) => current.t - h.t <= P.windowDays * DAY)).length < P.minDaysFull;
    }
  }
  const allBuckets = bucketize(inWin);
  const baseBuckets = st.active && st.episodeStartT !== null ? allBuckets.filter((b) => b.t < st.episodeStartT!) : allBuckets;
  const n = baseBuckets.length;
  if (n < P.minDaysCold) { st.pending = null; return no(`가격 기록 부족 (${n}/${P.minDaysCold}일)`); }
  const cold = n < P.minDaysFull;
  const medians = baseBuckets.map((b) => b.median);

  // ---- 2. regular price R, noise margin, usual depth (frozen while an episode is active) ----
  let R: number, marginEff: number, usual: number, own: number | null = null;
  if (st.active && st.baselinePrice !== null && st.usualAtStart !== null && st.thresholdAtStart !== null) {
    R = st.baselinePrice; usual = st.usualAtStart; marginEff = Math.max(P.deeperMargin, st.thresholdAtStart - usual);
  } else if (cold) {
    const top3 = [...medians].sort((a, b) => b - a).slice(0, 3);
    R = median(top3);
    // cold: previous days must form one stable level, otherwise the history is too noisy to judge
    if (medians.some((m) => Math.abs(Math.log(m / R)) > Math.log(1.03))) { st.pending = null; return no('초기 가격 이력 불안정', R, 1 - price / R); }
    marginEff = P.deeperMargin;
    usual = prior?.usualDepthP90 ?? P.defaultPriorDepth;
  } else {
    const plat = plateauPrice(medians, P);
    let band: number[];
    if (plat) { R = plat.R; band = plat.band; } else { R = quantile(medians, P.fallbackQuantile); band = medians.filter((m) => Math.abs(Math.log(m / R)) <= Math.log(1 + P.plateauBand)); }
    const logs = band.map((x) => Math.log(x)); const lm = median(logs);
    const sigma = band.length >= 3 ? 1.4826 * median(logs.map((x) => Math.abs(x - lm))) : 0;
    marginEff = Math.max(P.deeperMargin, 2 * sigma);
    own = quantile(medians.map((m) => Math.max(0, 1 - m / R)), P.usualDepthQ);
    const pr = prior?.usualDepthP90 ?? P.defaultPriorDepth;
    usual = n >= P.fullTrustDays ? own : (n * own + (P.fullTrustDays - n) * pr) / P.fullTrustDays;
  }
  if (own !== null) st.ownUsualDepth = own;
  const threshold = st.active && st.thresholdAtStart !== null ? st.thresholdAtStart
    : Math.max(cold ? P.minDropCold : P.minDrop, usual + marginEff) + (stale ? P.stalePenalty : 0);
  const drop = 1 - price / R;
  const saving = R - price;

  // ---- 3. episode bookkeeping: deepening / recovery / expiry ----
  if (st.active) {
    const recovered = drop <= 0.5 * threshold;
    const expired = st.episodeStartT !== null && current.t - st.episodeStartT > P.maxEpisodeDays * DAY;
    if (recovered) st.recoverStreak++; else st.recoverStreak = 0;
    const longGap = gapSinceLast !== null && gapSinceLast >= P.recoverGapMs;
    if (expired || (recovered && (st.recoverStreak >= P.recoverPolls || longGap))) {
      Object.assign(st, { active: false, episodeStartT: null, baselinePrice: null, thresholdAtStart: null, usualAtStart: null, lastAlertPrice: null, lastAlertT: null, recoverStreak: 0, pending: null });
      return no(expired ? '특가 에피소드 종료 (기간 만료)' : '가격 회복, 재무장', R, drop);
    }
    if (st.lastAlertPrice !== null) {
      const deepened = st.lastAlertPrice - price >= Math.max(P.deepenStep * R, P.minSavingWon);
      if (!deepened) return no('이미 알림 보낸 특가 진행 중', R, drop);
      const severity = Math.min(cold ? P.coldSeverityCap : 1, clamp01(0.30 + 0.45 * clamp01((drop - threshold) / P.exceedScale) + 0.25));
      st.lastAlertPrice = price; st.lastAlertT = current.t; st.alertCount++;
      return { decision: { alert: true, severity, reason: `추가 인하: 평시 대비 ${Math.round(drop * 100)}% 할인 (기준가 ${fmt(R)})`, baselinePrice: R, discountFromBaseline: drop }, newState: st };
    }
  }

  // ---- 4. gates for a new event ----
  if (drop < threshold || saving < P.minSavingWon) {
    st.pending = null;
    return no(drop > 0 ? `평시 대비 ${Math.round(drop * 100)}% (기준 ${Math.round(threshold * 100)}% 미달)` : '할인 아님', R, drop);
  }
  const L = quantile(medians, P.lowLevelQ); // usual-low level
  if ((L - price) / L < P.minBelowLow) { st.pending = null; return no('평소에도 자주 보이는 가격대', R, drop); }
  const before = baseBuckets.filter((b) => b.day < kstDay(current.t)).slice(-3);
  if (before.length > 0) {
    const recentRef = median(before.map((b) => b.median));
    if ((recentRef - price) / recentRef < P.stepFrac * threshold) { st.pending = null; return no('점진적 하락 (급락 아님)', R, drop); }
  }

  // ---- 5. glitch guard / confirmation (rank surge corroborates) ----
  const medRank = median(baseBuckets.map((b) => b.rank));
  const rankSurge = Number.isFinite(medRank) && ((medRank - current.rank >= P.rankSurgeDelta) || (current.rank <= P.rankSurgeTop && medRank > 20));
  const needConfirm = (drop >= P.confirmDrop || cold || stale) && !rankSurge;
  if (needConfirm) {
    const pend = st.pending;
    const confirmed = pend !== null && current.t - pend.t <= P.confirmMaxGapMs && Math.abs(pend.price - price) <= Math.max(eqTol(price), P.confirmTol * R);
    if (!confirmed) { st.pending = { price, t: current.t }; return no('큰 하락, 다음 관측에서 확인 대기', R, drop); }
  }
  st.pending = null;

  // ---- 6. severity + alert ----
  const tol = eqTol(price);
  const lowTail = baseBuckets.filter((b) => b.min <= price + tol).length / n;
  const newLow = lowTail === 0;
  const s1 = clamp01((drop - threshold) / P.exceedScale);
  const s2 = newLow ? 1 : clamp01(1 - lowTail / 0.10);
  let severity = clamp01(0.30 + 0.45 * s1 + 0.25 * s2 + (rankSurge ? 0.05 : 0));
  if (cold) severity = Math.min(severity, P.coldSeverityCap);
  const days = Math.max(1, Math.round((current.t - baseBuckets[0]!.t) / DAY));
  const reason = `평시 대비 ${Math.round(drop * 100)}% 할인 (기준가 ${fmt(R)}${usual >= 0.05 ? `, 평소 할인폭 ${Math.round(usual * 100)}%` : ''})`
    + (newLow ? `, 최근 ${days}일 최저가` : '') + (cold ? ' · 초기 이력 기준' : '');
  Object.assign(st, { active: true, episodeStartT: current.t, baselinePrice: R, thresholdAtStart: threshold, usualAtStart: usual,
    lastAlertPrice: price, lastAlertT: current.t, alertCount: st.alertCount + 1, recoverStreak: 0 });
  const decision: DealDecision = { alert: true, severity, reason, baselinePrice: R, discountFromBaseline: drop };
  return { decision, newState: st };
}

function fmt(n: number): string { return `${Math.round(n).toLocaleString('ko-KR')}원`; }

export function createDetector(params: Partial<DetectorParams> = {}): Detector<AlertState> {
  const p: DetectorParams = { ...DEFAULT_DETECTOR_PARAMS, ...params };
  return {
    historyWindowMs: p.maxStaleDays * DAY,
    decide(history: PriceObservation[], current: PriceObservation, state: AlertState | null, ctx: DetectorContext) {
      return decide(history, current, state, p, ctx.categoryPrior ?? null);
    },
  };
}
