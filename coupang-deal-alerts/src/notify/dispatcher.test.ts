import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../core/db.js';
import { Repos } from '../core/repos.js';
import type { DealRecord, NotificationMessage, Notifier, NotifyResult, ProductRecord } from '../core/types.js';
import { Dispatcher, inQuietHours, localHour, quietWindowMs, startOfLocalDay } from './dispatcher.js';

class FakeNotifier implements Notifier {
  sent: { userId: string; message: NotificationMessage }[] = [];
  constructor(readonly channel: 'webpush' | 'telegram', private readonly users: Set<string>, private failFor = new Set<string>()) {}
  async send(userId: string, message: NotificationMessage): Promise<NotifyResult[]> {
    if (!this.users.has(userId)) return [];
    if (this.failFor.has(userId)) return [{ ok: false, gone: false, error: 'boom' }];
    this.sent.push({ userId, message });
    return [{ ok: true }];
  }
}

const product: ProductRecord = { productId: 'p1', coupangCategoryId: 1011, categoryId: 'appliances', subcategoryId: 'appliances.laptop',
  name: 'LG 그램 16', url: 'https://coupang/p1', imageUrl: null, isRocket: true, firstSeenAt: 0, lastSeenAt: 0, lastPrice: 1_000_000, lastRank: 2 };

function setup(now: () => number) {
  const repos = new Repos(openDb(':memory:'));
  repos.upsertProduct(product);
  return repos;
}
function mkDeal(repos: Repos, severity: number, detectedAt: number): DealRecord {
  return repos.insertDeal({ productId: 'p1', categoryId: 'appliances', subcategoryId: 'appliances.laptop', detectedAt,
    price: 700_000, baselinePrice: 1_000_000, discountPct: 0.3, severity, reason: '30일 최저가', rank: 2 });
}

// 2026-01-15 12:00 KST = 03:00 UTC
const NOON_KST = Date.UTC(2026, 0, 15, 3, 0, 0);
// 2026-01-15 23:30 KST = 14:30 UTC
const LATE_KST = Date.UTC(2026, 0, 15, 14, 30, 0);

test('time helpers in Asia/Seoul', () => {
  assert.equal(localHour(NOON_KST, 'Asia/Seoul'), 12);
  assert.equal(localHour(LATE_KST, 'Asia/Seoul'), 23);
  assert.equal(startOfLocalDay(NOON_KST, 'Asia/Seoul'), Date.UTC(2026, 0, 14, 15, 0, 0));
  assert.equal(inQuietHours(LATE_KST, { startHour: 23, endHour: 8 }, 'Asia/Seoul'), true);
  assert.equal(inQuietHours(NOON_KST, { startHour: 23, endHour: 8 }, 'Asia/Seoul'), false);
  assert.equal(inQuietHours(NOON_KST, { startHour: 9, endHour: 18 }, 'Asia/Seoul'), true);
  assert.equal(inQuietHours(NOON_KST, null, 'Asia/Seoul'), false);
});

test('dispatch respects subscription, sensitivity, channels and records notifications', async () => {
  let now = NOON_KST;
  const repos = setup(() => now);
  repos.saveUserPrefs({ userId: 'u-sens', subcategoryIds: ['appliances.laptop'], sensitivity: 'sensitive', dailyCap: 10, quietHours: null }, now);
  repos.saveUserPrefs({ userId: 'u-cons', subcategoryIds: ['appliances.laptop'], sensitivity: 'conservative', dailyCap: 10, quietHours: null }, now);
  repos.saveUserPrefs({ userId: 'u-other', subcategoryIds: ['appliances.tv'], sensitivity: 'sensitive', dailyCap: 10, quietHours: null }, now);
  repos.saveUserPrefs({ userId: 'u-nochan', subcategoryIds: ['appliances.laptop'], sensitivity: 'sensitive', dailyCap: 10, quietHours: null }, now);
  const push = new FakeNotifier('webpush', new Set(['u-sens', 'u-cons']));
  const tg = new FakeNotifier('telegram', new Set(['u-sens']));
  const d = new Dispatcher(repos, [push, tg], { now: () => now, baseUrl: 'https://app', subcategoryName: () => '노트북' });
  const deal = mkDeal(repos, 0.55, now);
  const s = await d.dispatchDeal(deal, product);
  assert.equal(s.candidates, 3);
  assert.equal(s.sent, 1, 'only sensitive user passes severity 0.55');
  assert.equal(s.skipped.sensitivity, 1);
  assert.equal(s.skipped.noChannel, 1);
  assert.equal(push.sent.length, 1);
  assert.equal(tg.sent.length, 1);
  assert.equal(push.sent[0]!.message.title, '[노트북] 평시 대비 30% 할인');
  assert.match(push.sent[0]!.message.body, /LG 그램 16\n700,000원 \(평시 1,000,000원\) · 30일 최저가/);
  assert.equal(push.sent[0]!.message.url, `https://app/go/${deal.id}`);
  assert.equal(repos.hasNotified('u-sens', deal.id, 'webpush'), true);
  assert.equal(repos.hasNotified('u-sens', deal.id, 'telegram'), true);
  // re-dispatch same deal: duplicate, nothing re-sent
  const s2 = await d.dispatchDeal(deal, product);
  assert.equal(s2.sent, 0);
  assert.equal(push.sent.length, 1);
});

test('per-product cooldown and daily cap', async () => {
  let now = NOON_KST;
  const repos = setup(() => now);
  repos.saveUserPrefs({ userId: 'u', subcategoryIds: ['appliances.laptop'], sensitivity: 'sensitive', dailyCap: 2, quietHours: null }, now);
  const push = new FakeNotifier('webpush', new Set(['u']));
  const d = new Dispatcher(repos, [push], { now: () => now, perProductCooldownMs: 3600_000 });
  await d.dispatchDeal(mkDeal(repos, 0.9, now), product);
  assert.equal(push.sent.length, 1);
  // same product 10 minutes later: cooldown
  now += 10 * 60_000;
  let s = await d.dispatchDeal(mkDeal(repos, 0.95, now), product);
  assert.equal(s.skipped.cooldown, 1);
  // different product hits cap after second send
  const p2 = { ...product, productId: 'p2' };
  repos.upsertProduct(p2);
  const deal2 = repos.insertDeal({ productId: 'p2', categoryId: 'appliances', subcategoryId: 'appliances.laptop', detectedAt: now,
    price: 1, baselinePrice: 2, discountPct: 0.5, severity: 0.9, reason: 'r', rank: 1 });
  s = await d.dispatchDeal(deal2, p2);
  assert.equal(s.sent, 1);
  const p3 = { ...product, productId: 'p3' };
  repos.upsertProduct(p3);
  const deal3 = repos.insertDeal({ productId: 'p3', categoryId: 'appliances', subcategoryId: 'appliances.laptop', detectedAt: now,
    price: 1, baselinePrice: 2, discountPct: 0.5, severity: 0.9, reason: 'r', rank: 1 });
  s = await d.dispatchDeal(deal3, p3);
  assert.equal(s.skipped.dailyCap, 1);
  // next KST day the cap resets
  now = Date.UTC(2026, 0, 16, 3, 0, 0);
  s = await d.dispatchDeal(deal3, p3);
  assert.equal(s.sent, 1);
});

test('quiet hours defer and flush later, expired or no-longer-live deferred are dropped', async () => {
  let now = LATE_KST;
  const repos = setup(() => now);
  // the pipeline records the deal price as the product's last price at detection time
  repos.upsertProduct({ ...product, lastPrice: 700_000 });
  repos.saveUserPrefs({ userId: 'u', subcategoryIds: ['appliances.laptop'], sensitivity: 'sensitive', dailyCap: 0, quietHours: { startHour: 23, endHour: 8 } }, now);
  const push = new FakeNotifier('webpush', new Set(['u']));
  const d = new Dispatcher(repos, [push], { now: () => now, deferredMaxAgeMs: 12 * 3600_000 });
  const deal = mkDeal(repos, 0.9, now);
  const s = await d.dispatchDeal(deal, product);
  assert.equal(s.deferred, 1);
  assert.equal(push.sent.length, 0);
  assert.equal(repos.listDeferred().length, 1);
  // still quiet at 07:00 KST
  now = Date.UTC(2026, 0, 15, 22, 0, 0);
  let f = await d.flushDeferred();
  assert.equal(f.sent, 0);
  assert.equal(repos.listDeferred().length, 1);
  // 08:30 KST -> deliver
  now = Date.UTC(2026, 0, 15, 23, 30, 0);
  f = await d.flushDeferred();
  assert.equal(f.sent, 1);
  assert.equal(repos.listDeferred().length, 0);
  // a deferred deal that is too old is dropped silently
  const old = mkDeal(repos, 0.9, now - 20 * 3600_000);
  repos.deferNotification('u', old.id, now - 20 * 3600_000);
  f = await d.flushDeferred();
  assert.equal(f.sent, 0);
  assert.equal(repos.listDeferred().length, 0);
  // a deal whose price already went back up is not delivered late
  repos.upsertProduct({ ...product, lastPrice: 1_000_000 });
  const gone = mkDeal(repos, 0.9, now - 3600_000);
  repos.deferNotification('u', gone.id, now - 3600_000);
  f = await d.flushDeferred();
  assert.equal(f.sent, 0);
  assert.equal(repos.listDeferred().length, 0);
});

test('long quiet windows (>12h) keep deferred deals until the window ends', async () => {
  // quiet 18:00 -> 09:00 (15h). Deal detected 19:30 KST, flushed at 09:10 KST next day (13.7h later)
  let now = Date.UTC(2026, 0, 15, 10, 30, 0); // 19:30 KST
  const repos = setup(() => now);
  repos.upsertProduct({ ...product, lastPrice: 700_000 });
  repos.saveUserPrefs({ userId: 'u', subcategoryIds: ['appliances.laptop'], sensitivity: 'sensitive', dailyCap: 0, quietHours: { startHour: 18, endHour: 9 } }, now);
  const push = new FakeNotifier('webpush', new Set(['u']));
  const d = new Dispatcher(repos, [push], { now: () => now });
  const deal = mkDeal(repos, 0.9, now);
  assert.equal((await d.dispatchDeal(deal, product)).deferred, 1);
  now = Date.UTC(2026, 0, 16, 0, 10, 0); // 09:10 KST next day
  const f = await d.flushDeferred();
  assert.equal(f.sent, 1);
  assert.equal(quietWindowMs({ startHour: 18, endHour: 9 }), 15 * 3600_000);
  assert.equal(quietWindowMs({ startHour: 9, endHour: 18 }), 9 * 3600_000);
  assert.equal(quietWindowMs(null), 0);
});

test('dispatchDeal and flushDeferred are serialised (no interleaved cap checks)', async () => {
  const now = NOON_KST;
  const repos = setup(() => now);
  repos.upsertProduct({ ...product, lastPrice: 700_000 });
  repos.saveUserPrefs({ userId: 'u', subcategoryIds: ['appliances.laptop'], sensitivity: 'sensitive', dailyCap: 1, quietHours: null }, now);
  let inFlight = 0, maxInFlight = 0;
  const slow: Notifier = { channel: 'webpush', async send(userId) {
    if (!repos.listPushSubscriptions(userId).length && userId !== 'u') return [];
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 20));
    inFlight--; return [{ ok: true }];
  } };
  const d = new Dispatcher(repos, [slow], { now: () => now });
  const p2 = { ...product, productId: 'p2', lastPrice: 1 }; repos.upsertProduct(p2);
  const d1 = mkDeal(repos, 0.9, now);
  const d2 = repos.insertDeal({ productId: 'p2', categoryId: 'appliances', subcategoryId: 'appliances.laptop', detectedAt: now, price: 1, baselinePrice: 2, discountPct: 0.5, severity: 0.9, reason: 'r', rank: 1 });
  const [a, b] = await Promise.all([d.dispatchDeal(d1, product), d.dispatchDeal(d2, p2)]);
  assert.equal(maxInFlight, 1, 'sends never overlap');
  assert.equal(a.sent + b.sent, 1, 'daily cap of 1 honoured even for concurrent dispatches');
  assert.equal(a.skipped.dailyCap + b.skipped.dailyCap, 1);
});

test('channel failure is recorded and does not count towards dedup success', async () => {
  const now = NOON_KST;
  const repos = setup(() => now);
  repos.saveUserPrefs({ userId: 'u', subcategoryIds: ['appliances.laptop'], sensitivity: 'sensitive', dailyCap: 5, quietHours: null }, now);
  const push = new FakeNotifier('webpush', new Set(['u']), new Set(['u']));
  const d = new Dispatcher(repos, [push], { now: () => now, logger: { warn() {}, info() {} } });
  const deal = mkDeal(repos, 0.9, now);
  const s = await d.dispatchDeal(deal, product);
  assert.equal(s.sent, 0);
  assert.equal(s.skipped.duplicate, 1);
  assert.equal(repos.countNotificationsSince('u', 0), 0, 'failed sends do not consume the daily cap');
});
