import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { Repos } from './repos.js';

function mk() { return new Repos(openDb(':memory:')); }

test('products upsert + observations + prune', () => {
  const r = mk();
  r.upsertProduct({ productId: 'p1', coupangCategoryId: 1011, categoryId: 'appliances', subcategoryId: 'appliances.laptop',
    name: 'LG 그램', url: 'https://x', imageUrl: null, isRocket: true, firstSeenAt: 1, lastSeenAt: 1, lastPrice: 1000, lastRank: 3 });
  r.upsertProduct({ productId: 'p1', coupangCategoryId: 1011, categoryId: 'appliances', subcategoryId: 'appliances.laptop',
    name: 'LG 그램 2', url: 'https://x', imageUrl: 'img', isRocket: false, firstSeenAt: 99, lastSeenAt: 2, lastPrice: 900, lastRank: 2 });
  const p = r.getProduct('p1')!;
  assert.equal(p.firstSeenAt, 1, 'first_seen preserved');
  assert.equal(p.lastPrice, 900);
  assert.equal(p.imageUrl, 'img');
  r.insertObservation('p1', { t: 1, price: 1000, rank: 3 });
  r.insertObservation('p1', { t: 2, price: 900, rank: 2 });
  r.insertObservation('p1', { t: 2, price: 901, rank: 2 }); // replace same t
  assert.deepEqual(r.getObservations('p1'), [{ t: 1, price: 1000, rank: 3 }, { t: 2, price: 901, rank: 2 }]);
  assert.equal(r.pruneObservations(2), 1);
  assert.equal(r.countObservations(), 1);
  assert.deepEqual([...r.countProductsBySubcategory()], [['appliances.laptop', 1]]);
});

test('alert state JSON roundtrip', () => {
  const r = mk();
  assert.equal(r.getAlertState('p1'), null);
  r.setAlertState('p1', { armed: true, lastPrice: 5 }, 10);
  assert.deepEqual(r.getAlertState('p1'), { armed: true, lastPrice: 5 });
});

test('deals list with filters and join', () => {
  const r = mk();
  r.upsertProduct({ productId: 'p1', coupangCategoryId: 1011, categoryId: 'appliances', subcategoryId: 'appliances.laptop',
    name: 'N', url: 'U', imageUrl: null, isRocket: true, firstSeenAt: 1, lastSeenAt: 1, lastPrice: 1000, lastRank: 3 });
  const d = r.insertDeal({ productId: 'p1', categoryId: 'appliances', subcategoryId: 'appliances.laptop', detectedAt: 5,
    price: 700, baselinePrice: 1000, discountPct: 0.3, severity: 0.8, reason: 'r', rank: 3 });
  assert.ok(d.id > 0);
  assert.equal(r.listDeals().length, 1);
  assert.equal(r.listDeals({ subcategoryIds: ['x'] }).length, 0);
  assert.equal(r.listDeals({ subcategoryIds: ['appliances.laptop'], minSeverity: 0.9 }).length, 0);
  const got = r.listDeals({ subcategoryIds: ['appliances.laptop'], sinceT: 5 })[0]!;
  assert.equal(got.productName, 'N');
  assert.equal(got.isRocket, true);
  assert.equal(r.countDealsSince(6), 0);
});

test('user prefs save/replace and subscription lookup', () => {
  const r = mk();
  assert.equal(r.getUserPrefs('u1'), null);
  const saved = r.saveUserPrefs({ userId: 'u1', subcategoryIds: ['a.x', 'a.y', 'a.x'], sensitivity: 'sensitive', dailyCap: 5,
    quietHours: { startHour: 23, endHour: 8 } }, 100);
  assert.deepEqual(saved.subcategoryIds, ['a.x', 'a.y']);
  assert.equal(saved.sensitivity, 'sensitive');
  assert.deepEqual(saved.quietHours, { startHour: 23, endHour: 8 });
  r.saveUserPrefs({ userId: 'u1', subcategoryIds: ['a.y'], sensitivity: 'normal', dailyCap: 0, quietHours: null }, 200);
  const p = r.getUserPrefs('u1')!;
  assert.deepEqual(p.subcategoryIds, ['a.y']);
  assert.equal(p.quietHours, null);
  assert.equal(p.createdAt, 100);
  assert.equal(p.updatedAt, 200);
  assert.equal(r.listUsersForSubcategory('a.x').length, 0);
  assert.equal(r.listUsersForSubcategory('a.y').length, 1);
});

test('push subscriptions and fail counting', () => {
  const r = mk();
  r.upsertPushSubscription({ userId: 'u1', endpoint: 'e1', p256dh: 'k', auth: 'a', createdAt: 1 });
  r.upsertPushSubscription({ userId: 'u1', endpoint: 'e1', p256dh: 'k2', auth: 'a2', createdAt: 2 });
  assert.equal(r.listPushSubscriptions('u1').length, 1);
  assert.equal(r.listPushSubscriptions('u1')[0]!.p256dh, 'k2');
  assert.equal(r.markPushFail('e1'), 1);
  assert.equal(r.markPushFail('e1'), 2);
  r.markPushOk('e1', 50);
  assert.equal(r.listPushSubscriptions('u1')[0]!.failCount, 0);
  assert.equal(r.listPushSubscriptions('u1')[0]!.lastOkAt, 50);
  assert.equal(r.deletePushSubscription('e1'), true);
  assert.equal(r.deletePushSubscription('e1'), false);
});

test('telegram link codes expire and are single use', () => {
  const r = mk();
  r.createTelegramLinkCode('ABC', 'u1', 1000);
  assert.equal(r.consumeTelegramLinkCode('ABC', 1000 + 16 * 60_000), null);
  r.createTelegramLinkCode('DEF', 'u1', 1000);
  assert.equal(r.consumeTelegramLinkCode('DEF', 2000), 'u1');
  assert.equal(r.consumeTelegramLinkCode('DEF', 2000), null);
  r.setTelegramLink('u1', '123', 1);
  assert.equal(r.getTelegramLink('u1')!.chatId, '123');
});

test('notifications dedup and daily count', () => {
  const r = mk();
  assert.equal(r.recordNotification({ userId: 'u1', dealId: 1, productId: 'p1', channel: 'webpush', sentAt: 10, ok: true }), true);
  assert.equal(r.recordNotification({ userId: 'u1', dealId: 1, productId: 'p1', channel: 'webpush', sentAt: 11, ok: true }), false);
  assert.equal(r.recordNotification({ userId: 'u1', dealId: 1, productId: 'p1', channel: 'telegram', sentAt: 12, ok: true }), true);
  assert.equal(r.hasNotified('u1', 1, 'webpush'), true);
  assert.equal(r.countNotificationsSince('u1', 0), 1, 'distinct deals');
  assert.equal(r.lastNotifiedProductAt('u1', 'p1'), 12);
  assert.equal(r.lastNotifiedProductAt('u1', 'zz'), null);
});

test('poll runs latest per category', () => {
  const r = mk();
  const a = r.startPollRun(1011, 1); r.finishPollRun(a, { ok: true, productCount: 100, dealCount: 2 }, 2);
  const b = r.startPollRun(1011, 5); r.finishPollRun(b, { ok: false, productCount: 0, dealCount: 0, error: 'boom' }, 6);
  r.startPollRun(1007, 3);
  const last = r.lastPollRuns();
  assert.equal(last.length, 2);
  const c1011 = last.find((x) => x.coupangCategoryId === 1011)!;
  assert.equal(c1011.ok, false);
  assert.equal(c1011.error, 'boom');
  assert.equal(last.find((x) => x.coupangCategoryId === 1007)!.ok, null);
});
