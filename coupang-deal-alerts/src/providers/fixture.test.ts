import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixtureProvider } from './fixture.js';

test('fixture is deterministic for same time and differs across time', async () => {
  let t = Date.UTC(2026, 0, 1);
  const a = new FixtureProvider({ now: () => t, productsPerCategory: 30 });
  const b = new FixtureProvider({ now: () => t, productsPerCategory: 30 });
  const s1 = await a.fetchBestProducts(1011, 20);
  const s2 = await b.fetchBestProducts(1011, 20);
  assert.deepEqual(s1.products, s2.products);
  assert.equal(s1.products.length, 20);
  assert.equal(s1.products[0]!.rank, 1);
  assert.ok(s1.products.every((p) => Number.isInteger(p.price) && p.price >= 100));
  t += 3600_000 * 24 * 3;
  const s3 = await a.fetchBestProducts(1011, 20);
  assert.notDeepEqual(s1.products.map((p) => p.price), s3.products.map((p) => p.price));
});

test('fixture produces deals over a month and stable prices otherwise', () => {
  const t0 = Date.UTC(2026, 0, 1);
  const f = new FixtureProvider({ now: () => t0, productsPerCategory: 40 });
  let dealHours = 0, total = 0;
  for (let i = 0; i < 40; i++) {
    for (let h = 0; h < 24 * 30; h += 6) {
      const { inDeal } = f.priceAt(1007, i, t0 + h * 3600_000);
      if (inDeal) dealHours++;
      total++;
    }
  }
  const frac = dealHours / total;
  assert.ok(frac > 0.02 && frac < 0.3, `deal fraction ${frac}`);
});
