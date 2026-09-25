import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { openDb } from '../core/db.js';
import { Repos } from '../core/repos.js';
import { Classifier, loadTaxonomy } from '../core/taxonomy.js';
import { createDetector } from '../core/detector.js';
import { Pipeline } from '../core/pipeline.js';
import { Scheduler } from '../core/scheduler.js';
import { FixtureProvider } from '../providers/fixture.js';
import { Dispatcher } from '../notify/dispatcher.js';
import type { NotificationMessage, Notifier, NotifyResult } from '../core/types.js';
import { buildApp } from './app.js';

class MemoryNotifier implements Notifier {
  readonly channel = 'webpush' as const;
  sent: { userId: string; message: NotificationMessage }[] = [];
  constructor(private readonly repos: Repos) {}
  async send(userId: string, message: NotificationMessage): Promise<NotifyResult[]> {
    if (this.repos.listPushSubscriptions(userId).length === 0) return [];
    this.sent.push({ userId, message });
    return [{ ok: true }];
  }
}

async function harness() {
  let now = Date.UTC(2026, 2, 1, 3, 0, 0); // 12:00 KST
  const repos = new Repos(openDb(':memory:'));
  const classifier = new Classifier(loadTaxonomy());
  const catIds = classifier.coupangCategoryIds.slice(0, 2);
  const provider = new FixtureProvider({ now: () => now, categoryIds: catIds, productsPerCategory: 30 });
  const notifier = new MemoryNotifier(repos);
  const dispatcher = new Dispatcher(repos, [notifier], { now: () => now, baseUrl: 'http://app', subcategoryName: (id) => classifier.subcategoryName(id) });
  const pipeline = new Pipeline(repos, classifier, createDetector(), dispatcher, { now: () => now, logger: { info() {}, warn() {} } });
  const scheduler = new Scheduler(provider, pipeline, repos, { categoryIds: catIds, intervalMs: 3600_000, limit: 30, now: () => now, sleep: async () => {}, logger: { info() {}, warn() {} }, dispatcher });
  const app = await buildApp({ repos, classifier, scheduler, dispatcher, notifiers: [notifier], telegram: null,
    publicDir: path.resolve('public'), vapidPublicKey: 'PUBKEY', adminToken: 'secret', providerMode: 'fixture', baseUrl: 'http://app', now: () => now });
  return { app, repos, classifier, scheduler, notifier, advance: (ms: number) => { now += ms; }, catIds, getNow: () => now };
}

test('static PWA assets and headers', async () => {
  const h = await harness();
  const idx = await h.app.inject({ method: 'GET', url: '/' });
  assert.equal(idx.statusCode, 200);
  assert.match(idx.body, /쿠팡 특가 알리미/);
  const sw = await h.app.inject({ method: 'GET', url: '/sw.js' });
  assert.equal(sw.statusCode, 200);
  assert.equal(sw.headers['cache-control'], 'no-cache');
  const mf = await h.app.inject({ method: 'GET', url: '/manifest.webmanifest' });
  assert.match(String(mf.headers['content-type']), /manifest\+json/);
  await h.app.close();
});

test('config, taxonomy, prefs roundtrip with validation', async () => {
  const h = await harness();
  const cfg = (await h.app.inject({ method: 'GET', url: '/api/config' })).json();
  assert.equal(cfg.vapidPublicKey, 'PUBKEY');
  assert.deepEqual(cfg.channels, ['webpush']);
  assert.match(cfg.disclosure, /쿠팡 파트너스/);
  const tax = (await h.app.inject({ method: 'GET', url: '/api/taxonomy' })).json();
  assert.ok(tax.categories.length >= 1);
  const firstSub = tax.categories[0].subcategories[0].id;

  const uid = 'user-abcdefgh-1234';
  let r = await h.app.inject({ method: 'GET', url: `/api/users/${uid}/prefs` });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().exists, false);
  assert.deepEqual(r.json().prefs.quietHours, { startHour: 23, endHour: 8 });

  r = await h.app.inject({ method: 'PUT', url: `/api/users/${uid}/prefs`, payload: { subcategoryIds: [firstSub, 'nope.x'], sensitivity: 'sensitive', dailyCap: 5, quietHours: null } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().prefs.subcategoryIds, [firstSub]);
  assert.deepEqual(r.json().ignoredSubcategoryIds, ['nope.x']);
  assert.equal(r.json().prefs.quietHours, null);

  r = await h.app.inject({ method: 'PUT', url: `/api/users/${uid}/prefs`, payload: { sensitivity: 'bogus' } });
  assert.equal(r.statusCode, 400, 'schema rejects unknown sensitivity');
  r = await h.app.inject({ method: 'GET', url: `/api/users/bad!id/prefs` });
  assert.equal(r.statusCode, 400);
  await h.app.close();
});

test('push subscription lifecycle and test notification', async () => {
  const h = await harness();
  const uid = 'user-abcdefgh-5678';
  let r = await h.app.inject({ method: 'POST', url: `/api/users/${uid}/push`, payload: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'k', auth: 'a' } } } });
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().count, 1);
  r = await h.app.inject({ method: 'POST', url: `/api/users/${uid}/push`, payload: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys: { p256dh: 'k', auth: 'a' } }, oldEndpoint: 'https://fcm.googleapis.com/fcm/send/abc' } });
  assert.equal(r.json().count, 1, 'old endpoint replaced');
  r = await h.app.inject({ method: 'GET', url: `/api/users/${uid}/prefs` });
  assert.equal(r.json().channels.webpush, 1);
  assert.equal(r.json().exists, true, 'defaults persisted for push-first user');
  r = await h.app.inject({ method: 'POST', url: `/api/users/${uid}/test-notification` });
  assert.equal(r.statusCode, 200);
  assert.equal(h.notifier.sent.length, 1);
  assert.equal(h.notifier.sent[0]!.message.title, '테스트 알림');
  r = await h.app.inject({ method: 'DELETE', url: `/api/users/${uid}/push`, payload: { endpoint: 'https://fcm.googleapis.com/fcm/send/new' } });
  assert.equal(r.json().removed, true);
  r = await h.app.inject({ method: 'POST', url: `/api/users/${uid}/push`, payload: { subscription: { endpoint: 'x' } } });
  assert.equal(r.statusCode, 400);
  // SSRF guard: only real push services are accepted as endpoints
  for (const bad of ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest', 'https://localhost:9200/', 'https://internal.corp.example/push', 'https://fcm.googleapis.com.evil.io/x']) {
    r = await h.app.inject({ method: 'POST', url: `/api/users/${uid}/push`, payload: { subscription: { endpoint: bad, keys: { p256dh: 'k', auth: 'a' } } } });
    assert.equal(r.statusCode, 400, bad);
    assert.equal(r.json().code, 'endpoint_not_allowed');
  }
  // ownership: another user cannot steal or delete this user's endpoint
  await h.app.inject({ method: 'POST', url: `/api/users/${uid}/push`, payload: { subscription: { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/own', keys: { p256dh: 'k', auth: 'a' } } } });
  r = await h.app.inject({ method: 'POST', url: `/api/users/other-user-000001/push`, payload: { subscription: { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/own', keys: { p256dh: 'k', auth: 'a' } } } });
  assert.equal(r.statusCode, 409);
  r = await h.app.inject({ method: 'POST', url: `/api/users/other-user-000001/push`, payload: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/other', keys: { p256dh: 'k', auth: 'a' } }, oldEndpoint: 'https://updates.push.services.mozilla.com/wpush/v2/own' } });
  assert.equal(r.statusCode, 201);
  assert.equal(h.repos.listPushSubscriptions(uid).length, 1, 'oldEndpoint of another user is ignored');
  // device cap
  for (let i = 0; i < 12; i++) {
    r = await h.app.inject({ method: 'POST', url: `/api/users/cap-user-00000001/push`, payload: { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/cap${i}`, keys: { p256dh: 'k', auth: 'a' } } } });
  }
  assert.equal(r!.statusCode, 409);
  assert.equal(h.repos.listPushSubscriptions('cap-user-00000001').length, 10);
  await h.app.close();
});

test('body-less JSON POST/DELETE are accepted; malformed JSON is 400', async () => {
  const h = await harness();
  const uid = 'user-abcdefgh-nobody';
  let r = await h.app.inject({ method: 'POST', url: `/api/users/${uid}/test-notification`, headers: { 'content-type': 'application/json' } });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().ok, false, 'no channel registered yet');
  r = await h.app.inject({ method: 'DELETE', url: `/api/users/${uid}/telegram`, headers: { 'content-type': 'application/json' } });
  assert.equal(r.statusCode, 200);
  r = await h.app.inject({ method: 'PUT', url: `/api/users/${uid}/prefs`, headers: { 'content-type': 'application/json' }, payload: '{not json' });
  assert.equal(r.statusCode, 400);
  await h.app.close();
});

test('rate limits: test-notification throttled per user', async () => {
  const h = await harness();
  const uid = 'user-abcdefgh-limit';
  await h.app.inject({ method: 'POST', url: `/api/users/${uid}/push`, payload: { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/l', keys: { p256dh: 'k', auth: 'a' } } } });
  const codes: number[] = [];
  for (let i = 0; i < 5; i++) codes.push((await h.app.inject({ method: 'POST', url: `/api/users/${uid}/test-notification` })).statusCode);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  assert.equal(h.notifier.sent.length, 3);
  h.advance(61_000);
  assert.equal((await h.app.inject({ method: 'POST', url: `/api/users/${uid}/test-notification` })).statusCode, 200);
  await h.app.close();
});

test('deals querystring validation and status sanitisation', async () => {
  const h = await harness();
  let r = await h.app.inject({ method: 'GET', url: '/api/deals?subcategoryIds=a&subcategoryIds=b' });
  assert.equal(r.statusCode, 400, 'repeated key becomes array -> schema 400, not 500');
  r = await h.app.inject({ method: 'GET', url: '/api/deals?limit=9999' });
  assert.equal(r.statusCode, 400);
  r = await h.app.inject({ method: 'GET', url: '/api/deals?limit=5&minSeverity=0.2&since=0' });
  assert.equal(r.statusCode, 200);
  const anon = (await h.app.inject({ method: 'GET', url: '/api/status' })).json();
  assert.equal(anon.counts.users, undefined);
  assert.equal(anon.scheduler.pauseReason, undefined);
  const admin = (await h.app.inject({ method: 'GET', url: '/api/status', headers: { 'x-admin-token': 'secret' } })).json();
  assert.equal(typeof admin.counts.users, 'number');
  r = await h.app.inject({ method: 'POST', url: '/api/admin/sweep', headers: { 'x-admin-token': 'secret' }, payload: { categoryIds: 5 } });
  assert.equal(r.statusCode, 400);
  r = await h.app.inject({ method: 'POST', url: '/api/admin/sweep', headers: { 'x-admin-token': 'secret' }, payload: { categoryIds: [999999] } });
  assert.equal(r.statusCode, 400, 'unknown category id rejected');
  h.scheduler.pause(3600_000, 'HTTP 403');
  r = await h.app.inject({ method: 'POST', url: '/api/admin/sweep', headers: { 'x-admin-token': 'secret' } });
  assert.equal(r.statusCode, 409);
  r = await h.app.inject({ method: 'POST', url: '/api/admin/sweep', headers: { 'x-admin-token': 'secret' }, payload: { force: true } });
  assert.equal(r.statusCode, 200);
  assert.equal(h.scheduler.status.pausedUntil, null);
  await h.app.close();
});

test('redactUserId hides ids in logged urls', async () => {
  const { redactUserId } = await import('./app.js');
  assert.equal(redactUserId('/api/users/abcdefgh-1234/prefs?x=1'), '/api/users/***/prefs?x=1');
  assert.equal(redactUserId('/api/deals'), '/api/deals');
});

test('end-to-end: sweeps build history, deals appear, subscribed user is notified, /go redirects', async () => {
  const h = await harness();
  const uid = 'user-abcdefgh-9999';
  // subscribe to everything in the first category, sensitive, no quiet hours
  const allSubs = h.classifier.categories.filter((c) => h.catIds.includes(c.coupangCategoryId)).flatMap((c) => c.subcategories.map((s) => s.id));
  await h.app.inject({ method: 'PUT', url: `/api/users/${uid}/prefs`, payload: { subcategoryIds: allSubs, sensitivity: 'sensitive', dailyCap: 0, quietHours: null } });
  await h.app.inject({ method: 'POST', url: `/api/users/${uid}/push`, payload: { subscription: { endpoint: 'https://web.push.apple.com/QBx-e2e', keys: { p256dh: 'k', auth: 'a' } } } });

  // 21 days of 6-hourly sweeps
  for (let i = 0; i < 21 * 4; i++) { await h.scheduler.sweep(); h.advance(6 * 3600_000); }
  const status = (await h.app.inject({ method: 'GET', url: '/api/status' })).json();
  assert.ok(status.counts.products > 0);
  assert.ok(status.counts.observations > 1000);
  assert.equal(status.lastPolls.length, h.catIds.length);
  assert.ok(status.lastPolls.every((p: { ok: boolean }) => p.ok));

  const deals = (await h.app.inject({ method: 'GET', url: `/api/deals?limit=200&since=0` })).json().deals;
  assert.ok(deals.length > 0, 'fixture should produce some deals over 3 weeks');
  assert.ok(deals.every((d: { discountPct: number }) => d.discountPct >= 0.15));
  assert.ok(deals[0].subcategoryName && deals[0].categoryName);
  assert.ok(h.notifier.sent.length > 0, 'subscribed user got notified');
  assert.match(h.notifier.sent[0]!.message.title, /평시 대비 \d+% 할인/);
  const clickThrough = await h.app.inject({ method: 'GET', url: new URL(h.notifier.sent[0]!.message.url).pathname });
  assert.equal(clickThrough.statusCode, 302, 'notification click URL must resolve');
  assert.match(String(clickThrough.headers.location), /coupang\.com/);

  const mine = (await h.app.inject({ method: 'GET', url: `/api/users/${uid}/deals` })).json().deals;
  assert.ok(mine.length > 0);

  const go = await h.app.inject({ method: 'GET', url: `/go/${deals[0].id}` });
  assert.equal(go.statusCode, 302);
  assert.match(String(go.headers.location), /^https:\/\/www\.coupang\.com\/vp\/products\//);
  const bad = await h.app.inject({ method: 'GET', url: `/go/999999` });
  assert.equal(bad.headers.location, '/');

  const hist = (await h.app.inject({ method: 'GET', url: `/api/products/${deals[0].productId}/history` })).json();
  assert.ok(hist.observations.length > 10);

  // admin sweep auth
  assert.equal((await h.app.inject({ method: 'POST', url: '/api/admin/sweep' })).statusCode, 401);
  const adm = await h.app.inject({ method: 'POST', url: '/api/admin/sweep', headers: { 'x-admin-token': 'secret' }, payload: { categoryIds: [h.catIds[0]] } });
  assert.equal(adm.statusCode, 200);
  assert.equal(adm.json().result.categories.length, 1);
  await h.app.close();
});
