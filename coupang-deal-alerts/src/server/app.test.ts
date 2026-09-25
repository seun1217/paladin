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
  let r = await h.app.inject({ method: 'POST', url: `/api/users/${uid}/push`, payload: { subscription: { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } } } });
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().count, 1);
  r = await h.app.inject({ method: 'POST', url: `/api/users/${uid}/push`, payload: { subscription: { endpoint: 'https://push.example/new', keys: { p256dh: 'k', auth: 'a' } }, oldEndpoint: 'https://push.example/abc' } });
  assert.equal(r.json().count, 1, 'old endpoint replaced');
  r = await h.app.inject({ method: 'GET', url: `/api/users/${uid}/prefs` });
  assert.equal(r.json().channels.webpush, 1);
  assert.equal(r.json().exists, true, 'defaults persisted for push-first user');
  r = await h.app.inject({ method: 'POST', url: `/api/users/${uid}/test-notification` });
  assert.equal(r.statusCode, 200);
  assert.equal(h.notifier.sent.length, 1);
  assert.equal(h.notifier.sent[0]!.message.title, '테스트 알림');
  r = await h.app.inject({ method: 'DELETE', url: `/api/users/${uid}/push`, payload: { endpoint: 'https://push.example/new' } });
  assert.equal(r.json().removed, true);
  r = await h.app.inject({ method: 'POST', url: `/api/users/${uid}/push`, payload: { subscription: { endpoint: 'x' } } });
  assert.equal(r.statusCode, 400);
  await h.app.close();
});

test('end-to-end: sweeps build history, deals appear, subscribed user is notified, /go redirects', async () => {
  const h = await harness();
  const uid = 'user-abcdefgh-9999';
  // subscribe to everything in the first category, sensitive, no quiet hours
  const allSubs = h.classifier.categories.filter((c) => h.catIds.includes(c.coupangCategoryId)).flatMap((c) => c.subcategories.map((s) => s.id));
  await h.app.inject({ method: 'PUT', url: `/api/users/${uid}/prefs`, payload: { subcategoryIds: allSubs, sensitivity: 'sensitive', dailyCap: 0, quietHours: null } });
  await h.app.inject({ method: 'POST', url: `/api/users/${uid}/push`, payload: { subscription: { endpoint: 'https://push.example/e2e', keys: { p256dh: 'k', auth: 'a' } } } });

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
