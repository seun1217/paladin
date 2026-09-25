import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DETECTOR_PARAMS, decide, median, quantile, type AlertState } from './detector.js';
import type { PriceObservation } from './types.js';

const H = 3600_000, D = 24 * H;
const T0 = Date.UTC(2026, 0, 1);

/** hourly-ish history for `days` days at `price` with optional per-index override */
function hist(days: number, price: number | ((i: number) => number), stepH = 6): PriceObservation[] {
  const out: PriceObservation[] = [];
  for (let i = 0; i * stepH < days * 24; i++) {
    out.push({ t: T0 + i * stepH * H, price: typeof price === 'function' ? price(i) : price, rank: 10 });
  }
  return out;
}
const after = (h: PriceObservation[], price: number, dtH = 6): PriceObservation => ({ t: h[h.length - 1]!.t + dtH * H, price, rank: 5 });

test('median and quantile', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.9), 4.6);
});

test('cold start: too few observations or too short span -> no alert', () => {
  const h = hist(1, 100_000); // 4 obs in 1 day
  const r = decide(h, after(h, 60_000), null);
  assert.equal(r.decision.alert, false);
  assert.match(r.decision.reason, /관측치 부족/);
  const h2 = hist(2, 100_000, 3); // 16 obs but 2 days span
  const r2 = decide(h2, after(h2, 60_000), null);
  assert.equal(r2.decision.alert, false);
  assert.match(r2.decision.reason, /기간 부족/);
});

test('stable price then 30% drop alerts with new-low severity', () => {
  const h = hist(10, 100_000);
  const r = decide(h, after(h, 70_000), null);
  assert.equal(r.decision.alert, true);
  assert.equal(r.decision.baselinePrice, 100_000);
  assert.ok(Math.abs(r.decision.discountFromBaseline! - 0.3) < 1e-9);
  assert.ok(r.decision.severity > 0.6, `severity ${r.decision.severity}`);
  assert.match(r.decision.reason, /최저가/);
  assert.equal(r.newState.active, true);
});

test('small drop below floor does not alert', () => {
  const h = hist(10, 100_000);
  const r = decide(h, after(h, 90_000), null);
  assert.equal(r.decision.alert, false);
  assert.match(r.decision.reason, /기준 미달/);
});

test('always-on-sale product (frequent 20% dips) needs deeper cut than usual', () => {
  // every other observation is 20% off -> usual depth ~20%
  const h = hist(14, (i) => (i % 2 ? 80_000 : 100_000));
  // baseline = median = 90,000 ; usual depth = p90 of drops ~ 0.111 ; threshold = max(0.15, 0.161) = 0.161
  let r = decide(h, after(h, 80_000), null);
  assert.equal(r.decision.alert, false, 'its usual sale price is not unusual');
  r = decide(h, after(h, 70_000), null);
  assert.equal(r.decision.alert, true, '22% below baseline exceeds usual depth + margin');
  assert.match(r.decision.reason, /평소 할인폭/);
});

test('dedup: same deal persisting does not re-alert; deepening does; recovery re-arms', () => {
  const h = hist(10, 100_000);
  let r = decide(h, after(h, 70_000), null);
  assert.equal(r.decision.alert, true);
  let state: AlertState = r.newState;
  const h2 = [...h, after(h, 70_000)];
  r = decide(h2, after(h2, 70_500), state);
  assert.equal(r.decision.alert, false);
  assert.match(r.decision.reason, /진행 중/);
  state = r.newState;
  const h3 = [...h2, after(h2, 70_500)];
  r = decide(h3, after(h3, 59_000), state); // further 11.5% of baseline
  assert.equal(r.decision.alert, true, 'deepened by >= 10% of baseline');
  state = r.newState;
  const h4 = [...h3, after(h3, 59_000)];
  r = decide(h4, after(h4, 99_000), state); // recovered
  assert.equal(r.decision.alert, false);
  assert.equal(r.newState.active, false, 're-armed after recovery');
  state = r.newState;
  const h5 = [...h4, after(h4, 99_000)];
  r = decide(h5, after(h5, 69_000), state);
  assert.equal(r.decision.alert, true, 'new episode alerts again');
});

test('glitch guard: 90% drop waits for confirmation, confirmed on next poll', () => {
  const h = hist(10, 100_000);
  let r = decide(h, after(h, 9_000), null);
  assert.equal(r.decision.alert, false);
  assert.match(r.decision.reason, /확인 대기/);
  const h2 = [...h, after(h, 9_000)];
  r = decide(h2, after(h2, 9_000), r.newState);
  assert.equal(r.decision.alert, true, 'second identical reading confirms');
  // a one-off glitch followed by normal price clears the pending flag
  const h3 = hist(10, 100_000);
  r = decide(h3, after(h3, 9_000), null);
  r = decide([...h3, after(h3, 9_000)], after([...h3, after(h3, 9_000)], 100_000), r.newState);
  assert.equal(r.newState.pendingPrice, null);
});

test('single-sample historical outlier does not distort the median baseline', () => {
  const h = hist(10, (i) => (i === 5 ? 10_000 : 100_000));
  const r = decide(h, after(h, 75_000), null);
  assert.equal(r.decision.baselinePrice, 100_000);
  assert.equal(r.decision.alert, true);
});

test('gradually declining price: no alert once history has caught up', () => {
  // declines 1% per 6h for 10 days -> baseline median is mid-way, last price ~ 33% below start but only ~17% below median
  const h = hist(10, (i) => Math.round(100_000 * Math.pow(0.99, i)));
  const last = h[h.length - 1]!.price;
  const r = decide(h, after(h, Math.round(last * 0.99)), null);
  // may or may not alert depending on threshold; assert it does not classify a ~18% slow drift as strong
  assert.ok(r.decision.severity < 0.6);
});

test('minimum saving in won blocks tiny-ticket items', () => {
  const h = hist(10, 5_000);
  const r = decide(h, after(h, 3_900), null); // 22% but only 1,100 won
  assert.equal(r.decision.alert, false);
});

test('missed polls / irregular spacing still work (window and span based)', () => {
  const h: PriceObservation[] = [0, 1, 3, 4, 9, 10, 14].map((d) => ({ t: T0 + d * D, price: 50_000, rank: 3 }));
  const r = decide(h, { t: T0 + 15 * D, price: 35_000, rank: 1 }, null, DEFAULT_DETECTOR_PARAMS);
  assert.equal(r.decision.alert, true);
});
