import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DETECTOR_PARAMS, decide, kstDay, median, plateauPrice, quantile, type AlertState } from './detector.js';
import type { PriceObservation } from './types.js';

const H = 3600_000, D = 24 * H;
const T0 = Date.UTC(2026, 0, 1, 3, 0, 0); // 12:00 KST

/** history for `days` days, one observation every `stepH` hours, price by index */
function hist(days: number, price: number | ((i: number, dayIdx: number) => number), stepH = 6, rank = 30): PriceObservation[] {
  const out: PriceObservation[] = [];
  for (let i = 0; i * stepH < days * 24; i++) {
    const t = T0 + i * stepH * H;
    out.push({ t, price: typeof price === 'function' ? price(i, Math.floor(i * stepH / 24)) : price, rank });
  }
  return out;
}
const after = (h: PriceObservation[], price: number, dtH = 6, rank = 30): PriceObservation => ({ t: h[h.length - 1]!.t + dtH * H, price, rank });
/** run decide over a sequence of extra observations, returning the outcomes */
function run(h: PriceObservation[], seq: { price: number; dtH?: number; rank?: number }[], state: AlertState | null = null) {
  const outs = [];
  let hh = [...h];
  for (const s of seq) {
    const cur = after(hh, s.price, s.dtH ?? 6, s.rank ?? 30);
    const r = decide(hh, cur, state);
    outs.push(r.decision);
    state = r.newState;
    hh = [...hh, cur];
  }
  return { outs, state: state!, hist: hh };
}

test('helpers: median, quantile, kstDay, plateau', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.9), 4.6);
  assert.equal(kstDay(Date.UTC(2026, 0, 1, 14, 59)), kstDay(Date.UTC(2026, 0, 1, 0, 0)), 'same KST day');
  assert.equal(kstDay(Date.UTC(2026, 0, 1, 15, 0)), kstDay(Date.UTC(2026, 0, 1, 0, 0)) + 1, 'KST midnight boundary');
  // 30 days: 20 at 8,000 (sale most of the time), 10 at 10,000 -> plateau picks the HIGHER supported level
  const meds = [...Array(20).fill(8000), ...Array(10).fill(10_000)];
  assert.equal(plateauPrice(meds, DEFAULT_DETECTOR_PARAMS)!.R, 10_000);
  // a 2-day spike is not a plateau
  assert.equal(plateauPrice([...Array(20).fill(8000), 12_000, 12_100], DEFAULT_DETECTOR_PARAMS)!.R, 8000);
});

test('cold start: <3 days never alerts; 3-6 stable days alert only after confirmation and with capped severity', () => {
  let r = decide(hist(1, 100_000), after(hist(1, 100_000), 60_000), null); // 4 polls over 2 KST days
  assert.equal(r.decision.alert, false); assert.match(r.decision.reason, /기록 부족/);
  const h = hist(4, 100_000);
  const { outs } = run(h, [{ price: 70_000 }, { price: 70_000 }]);
  assert.equal(outs[0]!.alert, false); assert.match(outs[0]!.reason, /확인 대기/);
  assert.equal(outs[1]!.alert, true, 'second identical reading confirms in cold mode');
  assert.ok(outs[1]!.severity <= 0.6, 'cold alerts capped so conservative users are not paged');
  assert.match(outs[1]!.reason, /초기 이력/);
  // rank surge corroborates and skips confirmation
  const r2 = decide(h, after(h, 70_000, 6, 3), null);
  assert.equal(r2.decision.alert, true);
  // unstable early history -> no alert
  const noisy = hist(4, (i) => 100_000 + (i % 3) * 8000);
  assert.match(decide(noisy, after(noisy, 60_000), null).decision.reason, /불안정/);
});

test('stable price then 30% drop alerts with new-low severity; small drop does not', () => {
  const h = hist(14, 100_000);
  const r = decide(h, after(h, 70_000), null);
  assert.equal(r.decision.alert, true);
  assert.equal(r.decision.baselinePrice, 100_000);
  assert.ok(Math.abs(r.decision.discountFromBaseline! - 0.3) < 1e-9);
  assert.ok(r.decision.severity >= 0.7, `severity ${r.decision.severity}`);
  assert.match(r.decision.reason, /최저가/);
  assert.equal(r.newState.active, true);
  assert.equal(r.newState.baselinePrice, 100_000);
  const r2 = decide(h, after(h, 88_000), null);
  assert.equal(r2.decision.alert, false); assert.match(r2.decision.reason, /미달/);
});

test('always-on-sale product: plateau baseline + usual depth prevent alerts at its normal sale price', () => {
  // 30 days: on sale at 80,000 for 21 days, regular 100,000 for 9 days
  const h = hist(30, (_i, d) => (d % 10 < 7 ? 80_000 : 100_000));
  let r = decide(h, after(h, 80_000), null);
  assert.equal(r.decision.alert, false, 'normal sale price is usual');
  assert.equal(r.decision.baselinePrice, 100_000, 'regular price is the higher plateau, not the median');
  r = decide(h, after(h, 76_000), null);
  assert.equal(r.decision.alert, false, 'must beat usual depth (20%) + 5% margin');
  r = decide(h, after(h, 70_000), null);
  assert.equal(r.decision.alert, true, '30% beats usual 20% + 5% margin');
  assert.match(r.decision.reason, /평소 할인폭 20%/);
});

test('dedup: persisting deal alerts once, deepening re-alerts, recovery (2 polls) re-arms', () => {
  const h = hist(14, 100_000);
  const { outs, state } = run(h, [{ price: 70_000 }, { price: 70_500 }, { price: 69_000 }, { price: 59_000 }, { price: 99_000 }, { price: 99_000 }, { price: 69_000 }]);
  assert.equal(outs[0]!.alert, true);
  assert.equal(outs[1]!.alert, false); assert.match(outs[1]!.reason, /진행 중/);
  assert.equal(outs[2]!.alert, false, '1% deeper is not material');
  assert.equal(outs[3]!.alert, true, '≥8% of baseline deeper'); assert.match(outs[3]!.reason, /추가 인하/);
  assert.equal(outs[4]!.alert, false, 'first recovered poll only counts');
  assert.equal(outs[5]!.alert, false); assert.match(outs[5]!.reason, /재무장/);
  assert.equal(outs[6]!.alert, true, 'new episode after recovery');
  assert.equal(state.alertCount, 3);
});

test('frozen baseline: a long deal cannot erode its own reference', () => {
  const h = hist(14, 100_000);
  const seq = Array.from({ length: 4 * 15 }, () => ({ price: 70_000 })); // 15 days at the deal price
  const { outs, state, hist: hh } = run(h, seq);
  assert.equal(outs.filter((o) => o.alert).length, 1);
  assert.equal(state.baselinePrice, 100_000);
  // deepening after 15 days is still judged against the frozen 100,000 baseline
  const r = decide(hh, after(hh, 60_000), state);
  assert.equal(r.decision.alert, true);
  assert.equal(r.decision.baselinePrice, 100_000);
});

test('episode expires after 21 days; the deal price has become the new normal', () => {
  const h = hist(14, 100_000);
  const seq = Array.from({ length: 4 * 22 }, () => ({ price: 70_000 }));
  const { outs, state } = run(h, seq);
  assert.equal(outs.filter((o) => o.alert).length, 1);
  assert.equal(state.active, false);
  assert.ok(outs.some((o) => /만료/.test(o.reason)));
});

test('glitch guard: 90% single-sample drop is not alerted; confirmed repeat is', () => {
  const h = hist(14, 100_000);
  let r = run(h, [{ price: 9_000 }, { price: 100_000 }]);
  assert.deepEqual(r.outs.map((o) => o.alert), [false, false]);
  assert.equal(r.state.pending, null, 'pending cleared by a normal price');
  r = run(h, [{ price: 9_000 }, { price: 9_100 }]);
  assert.deepEqual(r.outs.map((o) => o.alert), [false, true]);
  // pending too old (>72h) does not confirm
  r = run(h, [{ price: 9_000 }, { price: 9_000, dtH: 80 }]);
  assert.equal(r.outs[1]!.alert, false);
});

test('single historical outlier day does not distort the plateau baseline', () => {
  const h = hist(14, (i) => (i === 20 ? 10_000 : 100_000));
  const r = decide(h, after(h, 75_000), null);
  assert.equal(r.decision.baselinePrice, 100_000);
  assert.equal(r.decision.alert, true);
});

test('gradually declining price never fires (step rule); price increase then return never fires', () => {
  const h = hist(20, (_i, d) => Math.round(100_000 * Math.pow(0.985, d))); // -1.5%/day
  const last = h[h.length - 1]!.price;
  const r = decide(h, after(h, Math.round(last * 0.985)), null);
  assert.equal(r.decision.alert, false, r.decision.reason);
  // 10,000 for 20 days, 13,000 for 20 days, then back to 10,000
  const h2 = hist(40, (_i, d) => (d < 20 ? 10_000 : 13_000));
  const r2 = decide(h2, after(h2, 10_000), null);
  assert.equal(r2.decision.alert, false, r2.decision.reason);
});

test('minimum saving in won blocks tiny-ticket items; missed polls / irregular spacing still work', () => {
  const h = hist(14, 5_000);
  assert.equal(decide(h, after(h, 3_900), null).decision.alert, false);
  const irregular: PriceObservation[] = [0, 1, 3, 4, 9, 10, 14, 15].map((d) => ({ t: T0 + d * D, price: 50_000, rank: 3 }));
  const r = decide(irregular, { t: T0 + 16 * D, price: 35_000, rank: 3 }, null);
  assert.equal(r.decision.alert, true, r.decision.reason);
});

test('re-entry after weeks uses stale history with a stricter bar and confirmation', () => {
  const h = hist(20, 100_000);
  const gap = 50 * D; // product disappears from the top-100 for 50 days
  const cur = { t: h[h.length - 1]!.t + gap, price: 70_000, rank: 30 };
  let r = decide(h, cur, null);
  assert.equal(r.decision.alert, false); assert.match(r.decision.reason, /확인 대기/);
  const r2 = decide([...h, cur], { t: cur.t + 6 * H, price: 70_000, rank: 30 }, r.newState);
  assert.equal(r2.decision.alert, true);
  assert.equal(r2.decision.baselinePrice, 100_000);
});

test('category prior shrinks the threshold for products with short history', () => {
  const h = hist(8, 100_000); // 8 buckets: own usual depth 0, prior weight 13/21
  const rNoPrior = decide(h, after(h, 78_000), null, DEFAULT_DETECTOR_PARAMS, null);
  assert.equal(rNoPrior.decision.alert, true, 'threshold = max(0.15, 0.062 + 0.05) = 0.15');
  const rPrior = decide(h, after(h, 78_000), null, DEFAULT_DETECTOR_PARAMS, { usualDepthP90: 0.30, sampleSize: 50 });
  assert.equal(rPrior.decision.alert, false, 'category where 30% sales are usual: 22% is not special');
  assert.equal(rNoPrior.newState.ownUsualDepth, 0);
});
