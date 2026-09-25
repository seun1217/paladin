import { test } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { openDb } from '../core/db.js';
import { Repos } from '../core/repos.js';
import { WebPushNotifier, isAllowedPushEndpoint } from './webpush.js';

const keys = webpush.generateVAPIDKeys();
const quiet = { info() {}, warn() {} };

function setup() {
  const repos = new Repos(openDb(':memory:'));
  repos.ensureUser('u1', 1);
  repos.upsertPushSubscription({ userId: 'u1', endpoint: 'https://push/a', p256dh: 'p', auth: 'a', createdAt: 1 });
  repos.upsertPushSubscription({ userId: 'u1', endpoint: 'https://push/b', p256dh: 'p', auth: 'a', createdAt: 1 });
  return repos;
}

test('sends payload to every subscription with TTL/topic and marks ok', async () => {
  const repos = setup();
  const calls: { endpoint: string; payload: unknown; opts: webpush.RequestOptions }[] = [];
  const n = new WebPushNotifier(repos, { vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey, subject: 'mailto:t@example.com', now: () => 99, logger: quiet,
    sendImpl: async (sub, payload, opts) => { calls.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), opts }); return {}; } });
  const res = await n.send('u1', { title: 'T', body: 'B', url: 'https://app/go/1', tag: 'deal-123-456', imageUrl: 'https://img' });
  assert.deepEqual(res, [{ ok: true }, { ok: true }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.opts.TTL, 6 * 3600);
  assert.equal(calls[0]!.opts.topic, 'deal-123-456');
  assert.deepEqual(calls[0]!.payload, { title: 'T', body: 'B', url: 'https://app/go/1', icon: '/icons/icon-192.png', image: 'https://img', tag: 'deal-123-456' });
  assert.equal(repos.listPushSubscriptions('u1')[0]!.lastOkAt, 99);
  assert.deepEqual(await n.send('nobody', { title: 'T', body: 'B', url: 'u', tag: 't' }), []);
});

test('410/404 removes the subscription; repeated other failures drop it after maxFailures', async () => {
  const repos = setup();
  const gone = Object.assign(new Error('gone'), { statusCode: 410 });
  const flaky = Object.assign(new Error('boom'), { statusCode: 500 });
  const n = new WebPushNotifier(repos, { vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey, subject: 'mailto:t@example.com', maxFailures: 2, logger: quiet,
    sendImpl: async (sub) => { if (sub.endpoint.endsWith('/a')) throw gone; throw flaky; } });
  let res = await n.send('u1', { title: 'T', body: 'B', url: 'u', tag: 't' });
  assert.equal(res.length, 2);
  assert.deepEqual(res[0], { ok: false, gone: true, error: '410 gone' });
  assert.equal(res[1]!.ok, false);
  assert.equal(repos.listPushSubscriptions('u1').length, 1, 'expired subscription removed');
  assert.equal(repos.listPushSubscriptions('u1')[0]!.failCount, 1);
  res = await n.send('u1', { title: 'T', body: 'B', url: 'u', tag: 't' });
  assert.equal(repos.listPushSubscriptions('u1').length, 0, 'dropped after 2 consecutive failures');
});

test('requires VAPID keys', () => {
  const repos = setup();
  assert.throws(() => new WebPushNotifier(repos, { vapidPublicKey: '', vapidPrivateKey: '', subject: 'mailto:x' }));
});

test('isAllowedPushEndpoint accepts real push services and rejects everything else', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/QBx', 'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://push-api.cloud.huawei.com/v1/x']) {
    assert.equal(isAllowedPushEndpoint(ok), true, ok);
  }
  for (const bad of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.io/x', 'https://10.0.0.5:9200/', 'https://[::1]/', 'https://localhost/', 'https://user:pw@fcm.googleapis.com/x', 'not a url', 'https://example.internal/']) {
    assert.equal(isAllowedPushEndpoint(bad), false, bad);
  }
  assert.equal(isAllowedPushEndpoint('https://push.example.org/x', ['push.example.org']), true);
});

test('oversized payload drops the image and trims the body', async () => {
  const repos = setup();
  const payloads: string[] = [];
  const n = new WebPushNotifier(repos, { vapidPublicKey: keys.publicKey, vapidPrivateKey: keys.privateKey, subject: 'mailto:t@example.com', logger: quiet,
    sendImpl: async (_s, payload) => { payloads.push(payload); return {}; } });
  await n.send('u1', { title: 'T', body: 'x'.repeat(5000), url: 'u', tag: 't', imageUrl: 'https://img' });
  assert.ok(Buffer.byteLength(payloads[0]!, 'utf8') <= 3900);
  assert.equal(JSON.parse(payloads[0]!).image, undefined);
});
