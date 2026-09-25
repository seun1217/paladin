import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildAuthorization, CoupangApiError, CoupangPartnersProvider, formatSignedDate, productKeyFromUrl, isAuthOrQuotaError } from './coupang-partners.js';

test('signed date format yyMMddTHHmmssZ in UTC', () => {
  assert.equal(formatSignedDate(new Date(Date.UTC(2026, 8, 25, 3, 4, 5))), '260925T030405Z');
});

test('authorization header composition matches CEA spec', () => {
  const date = new Date(Date.UTC(2026, 8, 25, 3, 4, 5));
  const path = '/v2/providers/affiliate_open_api/apis/openapi/v1/products/bestcategories/1011';
  const query = 'limit=100&imageSize=256x256';
  const { authorization, message } = buildAuthorization({ method: 'GET', path, query, accessKey: 'AK', secretKey: 'SK', date });
  assert.equal(message, '260925T030405Z' + 'GET' + path + query);
  const sig = createHmac('sha256', 'SK').update(message).digest('hex');
  assert.equal(authorization, `CEA algorithm=HmacSHA256, access-key=AK, signed-date=260925T030405Z, signature=${sig}`);
});

test('matches independently verified HMAC test vector', () => {
  const { authorization } = buildAuthorization({
    method: 'GET',
    path: '/v2/providers/affiliate_open_api/apis/openapi/v1/products/bestcategories/1001',
    query: 'limit=20&subId=my-blog', accessKey: 'ACC', secretKey: 'SEC', date: new Date('2026-01-05T15:30:22.123Z'),
  });
  assert.equal(authorization, 'CEA algorithm=HmacSHA256, access-key=ACC, signed-date=260105T153022Z, signature=bf13066a3a85a4f574c76281242e6e75a62d4cb7134981ef43f004e2582b8dd7');
});

test('variant-aware product key', () => {
  const url = 'https://link.coupang.com/re/AFFSDP?lptag=AF9416635&pageKey=4366590940&itemId=5142190462&vendorItemId=72451564031&traceid=x';
  assert.equal(productKeyFromUrl('4366590940', url), '4366590940-72451564031');
  assert.equal(productKeyFromUrl('1', 'https://x/?itemId=9'), '1-i9');
  assert.equal(productKeyFromUrl('1', 'not a url'), '1');
});

test('search-style envelope {productData:[...]} is accepted', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ rCode: '0', rMessage: '', data: { landingUrl: 'x', productData: [
    { productId: 1, productName: 'a', productPrice: 100, productUrl: 'u' } ] } }), { status: 200 })) as typeof fetch;
  const p = new CoupangPartnersProvider({ accessKey: 'AK', secretKey: 'SK', fetchImpl, sleep: async () => {}, now: () => 0 });
  const snap = await p.fetchBestProducts(1016, 10);
  assert.equal(snap.products.length, 1);
});

test('rCode 403 inside HTTP 200 is an auth/quota error and not retried', async () => {
  let n = 0;
  const fetchImpl = (async () => { n++; return new Response(JSON.stringify({ rCode: '403', rMessage: 'quota', data: null }), { status: 200 }); }) as typeof fetch;
  const p = new CoupangPartnersProvider({ accessKey: 'AK', secretKey: 'SK', fetchImpl, sleep: async () => {}, now: () => 0 });
  await assert.rejects(p.fetchBestProducts(1016, 10), (e: unknown) => isAuthOrQuotaError(e));
  assert.equal(n, 1);
});

test('fetchBestProducts maps response, spaces requests and retries 5xx', async () => {
  let now = 1_000_000;
  const calls: { url: string; auth: string }[] = [];
  let failuresLeft = 1;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), auth: String((init!.headers as Record<string, string>).Authorization) });
    if (failuresLeft-- > 0) return new Response('oops', { status: 503 });
    return new Response(JSON.stringify({ rCode: '0', rMessage: '', data: [
      { productId: 123, productName: 'LG 그램', productPrice: 1_490_000, productImage: 'img', productUrl: 'u', categoryName: '가전디지털', isRocket: true, isFreeShipping: true, rank: 1 },
      { productId: 456, productName: 'bad', productPrice: 0, productUrl: 'u' },
      { productId: 789, productName: 'no rank', productPrice: 9900.4, productUrl: 'u' },
    ] }), { status: 200 });
  }) as typeof fetch;
  const sleeps: number[] = [];
  const p = new CoupangPartnersProvider({ accessKey: 'AK', secretKey: 'SK', subId: 'sub', minSpacingMs: 1500, retries: 2,
    fetchImpl, now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } });
  const snap = await p.fetchBestProducts(1011, 100);
  assert.equal(calls.length, 2, 'one retry');
  assert.ok(calls[0]!.url.endsWith('/bestcategories/1011?limit=100&imageSize=256x256&subId=sub'));
  assert.match(calls[0]!.auth, /^CEA algorithm=HmacSHA256, access-key=AK, signed-date=\d{6}T\d{6}Z, signature=[0-9a-f]{64}$/);
  assert.equal(snap.products.length, 2);
  assert.deepEqual(snap.products[0], { productId: '123', productName: 'LG 그램', price: 1_490_000, rank: 1, productUrl: 'u', imageUrl: 'img', isRocket: true, isFreeShipping: true, providerCategoryName: '가전디지털' });
  assert.equal(snap.products[1]!.rank, 3, 'falls back to positional rank');
  assert.equal(snap.products[1]!.price, 9900);
  assert.ok(sleeps.some((s) => s >= 1500), 'spacing enforced between retry attempts');
});

test('non-retryable 4xx surfaces as CoupangApiError without retry', async () => {
  let n = 0;
  const fetchImpl = (async () => { n++; return new Response('{"rCode":"401"}', { status: 401 }); }) as typeof fetch;
  const p = new CoupangPartnersProvider({ accessKey: 'AK', secretKey: 'SK', fetchImpl, sleep: async () => {}, now: () => 0 });
  await assert.rejects(p.fetchBestProducts(1001, 10), (e: unknown) => e instanceof CoupangApiError && e.status === 401);
  assert.equal(n, 1);
});
