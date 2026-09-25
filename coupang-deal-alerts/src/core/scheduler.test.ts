import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { Repos } from './repos.js';
import { Classifier, loadTaxonomy } from './taxonomy.js';
import { createDetector } from './detector.js';
import { Pipeline } from './pipeline.js';
import { Scheduler } from './scheduler.js';
import { CoupangApiError } from '../providers/coupang-partners.js';
import { FixtureProvider } from '../providers/fixture.js';
import type { CategorySnapshot, ProductProvider } from './types.js';

const quiet = { info() {}, warn() {} };

test('sweep runs all categories, records poll runs, is due on interval', async () => {
  let now = Date.UTC(2026, 0, 1);
  const repos = new Repos(openDb(':memory:'));
  const classifier = new Classifier(loadTaxonomy());
  const ids = classifier.coupangCategoryIds;
  const provider = new FixtureProvider({ now: () => now, categoryIds: ids, productsPerCategory: 10 });
  const pipeline = new Pipeline(repos, classifier, createDetector(), null, { now: () => now, logger: quiet });
  const sleeps: number[] = [];
  const s = new Scheduler(provider, pipeline, repos, { categoryIds: ids, intervalMs: 3600_000, spacingMs: 100, limit: 10, now: () => now, sleep: async (ms) => { sleeps.push(ms); }, logger: quiet });
  await s.tick();
  assert.equal(repos.lastPollRuns().length, ids.length);
  assert.equal(sleeps.length, Math.max(0, ids.length - 1), 'spacing between categories only');
  const first = s.status.lastSweepAt;
  now += 30 * 60_000;
  await s.tick();
  assert.equal(s.status.lastSweepAt, first, 'not due yet');
  now += 31 * 60_000;
  await s.tick();
  assert.notEqual(s.status.lastSweepAt, first, 'due after interval');
  assert.equal(repos.getMeta('last_sweep_at'), String(s.status.lastSweepAt));
});

test('auth/quota error pauses polling (circuit breaker) and persists across restarts', async () => {
  let now = Date.UTC(2026, 0, 1);
  const repos = new Repos(openDb(':memory:'));
  const classifier = new Classifier(loadTaxonomy());
  const ids = classifier.coupangCategoryIds;
  let calls = 0;
  const failing: ProductProvider = { name: 'failing', async fetchBestProducts(): Promise<CategorySnapshot> { calls++; throw new CoupangApiError('HTTP 403', 403, 'quota', false); } };
  const pipeline = new Pipeline(repos, classifier, createDetector(), null, { now: () => now, logger: quiet });
  const s = new Scheduler(failing, pipeline, repos, { categoryIds: ids, intervalMs: 60_000, limit: 10, now: () => now, sleep: async () => {}, logger: quiet, authBackoffMs: 3600_000 });
  await s.tick();
  assert.equal(calls, 1, 'stops after the first 403 instead of hammering every category');
  assert.ok(s.status.pausedUntil !== null);
  assert.match(String(s.status.pauseReason), /403/);
  now += 120_000;
  await s.tick();
  assert.equal(calls, 1, 'paused: no new calls');
  // restart with same DB keeps the pause
  const s2 = new Scheduler(failing, pipeline, repos, { categoryIds: ids, intervalMs: 60_000, limit: 10, now: () => now, sleep: async () => {}, logger: quiet });
  assert.ok(s2.status.pausedUntil !== null);
  now += 3600_000;
  await s.tick();
  assert.equal(calls, 2, 'resumes after backoff');
  s.resume();
  assert.equal(s.status.pausedUntil, null);
});

test('generic errors do not pause; other categories still polled', async () => {
  let now = Date.UTC(2026, 0, 1);
  const repos = new Repos(openDb(':memory:'));
  const classifier = new Classifier(loadTaxonomy());
  const ids = classifier.coupangCategoryIds;
  const fixture = new FixtureProvider({ now: () => now, categoryIds: ids, productsPerCategory: 5 });
  let n = 0;
  const flaky: ProductProvider = { name: 'flaky', async fetchBestProducts(cid, limit) { if (n++ === 0) throw new Error('network'); return fixture.fetchBestProducts(cid, limit); } };
  const pipeline = new Pipeline(repos, classifier, createDetector(), null, { now: () => now, logger: quiet });
  const s = new Scheduler(flaky, pipeline, repos, { categoryIds: ids, intervalMs: 60_000, limit: 5, now: () => now, sleep: async () => {}, logger: quiet });
  const r = await s.sweep();
  assert.equal(r!.categories.length, ids.length);
  assert.equal(r!.categories[0]!.ok, false);
  assert.equal(s.status.pausedUntil, null);
});
