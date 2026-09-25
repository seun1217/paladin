import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServiceKey, buildUrl, request, fetchAll, normalizeFestival, normalizeSpot, TourApiError, yyyymmdd } from '../js/tourapi.js';

test('서비스 키 정규화: 인코딩 키는 디코딩된다', () => {
  assert.equal(normalizeServiceKey('abc%2Bdef%3D%3D'), 'abc+def==');
  assert.equal(normalizeServiceKey(' raw+key== '), 'raw+key==');
});

test('URL 생성', () => {
  const url = new URL(buildUrl('searchFestival2', { eventStartDate: '20260901', empty: '' }, { key: 'k+1' }));
  assert.equal(url.pathname, '/B551011/KorService2/searchFestival2');
  assert.equal(url.searchParams.get('serviceKey'), 'k+1');
  assert.equal(url.searchParams.get('_type'), 'json');
  assert.equal(url.searchParams.get('eventStartDate'), '20260901');
  assert.equal(url.searchParams.has('empty'), false);
  assert.equal(yyyymmdd('2026-09-01'), '20260901');
});

function fakeFetch(handler) {
  return async (url) => {
    const body = handler(new URL(url));
    return { status: 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
}

test('게이트웨이 XML 오류는 TourApiError 로 변환된다', async () => {
  const fetchImpl = fakeFetch(() => '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>');
  await assert.rejects(() => request('searchFestival2', {}, { key: 'x', fetchImpl }), (e) => e instanceof TourApiError && e.code === 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR');
});

test('빈 결과(items: "")와 단일 항목 응답을 처리한다', async () => {
  const empty = fakeFetch(() => ({ response: { header: { resultCode: '0000', resultMsg: 'OK' }, body: { items: '', numOfRows: 10, pageNo: 1, totalCount: 0 } } }));
  const r = await request('searchFestival2', {}, { key: 'x', fetchImpl: empty });
  assert.deepEqual(r.items, []);
  const single = fakeFetch(() => ({ response: { header: { resultCode: '0000', resultMsg: 'OK' }, body: { items: { item: { contentid: '1', title: 'A' } }, totalCount: 1 } } }));
  const r2 = await request('searchFestival2', {}, { key: 'x', fetchImpl: single });
  assert.equal(r2.items.length, 1);
});

test('fetchAll 은 totalCount 까지 페이지를 순회한다', async () => {
  const pages = {
    1: [{ contentid: '1' }, { contentid: '2' }],
    2: [{ contentid: '3' }, { contentid: '4' }],
    3: [{ contentid: '5' }],
  };
  const calls = [];
  const fetchImpl = fakeFetch((url) => {
    const p = Number(url.searchParams.get('pageNo'));
    calls.push(p);
    return { response: { header: { resultCode: '0000', resultMsg: 'OK' }, body: { items: { item: pages[p] }, numOfRows: 2, pageNo: p, totalCount: 5 } } };
  });
  const all = await fetchAll('areaBasedList2', {}, { key: 'x', fetchImpl, numOfRows: 2 });
  assert.equal(all.length, 5);
  assert.deepEqual(calls, [1, 2, 3]);
  const capped = await fetchAll('areaBasedList2', {}, { key: 'x', fetchImpl, numOfRows: 2, maxItems: 3 });
  assert.equal(capped.length, 3);
});

test('TourAPI 축제 항목 정규화', () => {
  const ev = normalizeFestival({
    contentid: '2674675', contenttypeid: '15', title: '제29회 보령머드축제', addr1: '충청남도 보령시 신흑동', addr2: '',
    areacode: '34', sigungucode: '9', mapx: '126.5141', mapy: '36.3117', eventstartdate: '20260724', eventenddate: '20260802',
    firstimage: 'http://img/a.jpg', firstimage2: 'http://img/a_thumb.jpg', tel: '041-930-0891', cat3: 'A02070100', modifiedtime: '20260601120000',
  });
  assert.equal(ev.id, 'ta-2674675');
  assert.equal(ev.kind, 'event');
  assert.equal(ev.start, '2026-07-24');
  assert.equal(ev.end, '2026-08-02');
  assert.equal(ev.region, 34);
  assert.equal(ev.type, 'festival');
  assert.equal(ev.lat, 36.3117);
  assert.equal(ev.thumb, 'http://img/a_thumb.jpg');
  assert.equal(ev.modified, '2026-06-01');
  assert.equal(normalizeFestival({ contentid: '1', mapx: '', mapy: '' }), null);
});

test('TourAPI 관광지 항목 정규화와 카테고리 추정', () => {
  const sp = normalizeSpot({ contentid: '1', contenttypeid: '12', title: '해운대해수욕장', addr1: '부산광역시 해운대구', mapx: '129.1604', mapy: '35.1587', cat1: 'A01', cat2: 'A0101', cat3: 'A01011200' });
  assert.equal(sp.category, 'beach');
  assert.equal(sp.region, 6); // areacode 가 없으면 주소로 추정
  const cul = normalizeSpot({ contentid: '2', contenttypeid: '14', title: '국립중앙박물관', mapx: '126.98', mapy: '37.52', areacode: '1' });
  assert.equal(cul.category, 'culture');
  const his = normalizeSpot({ contentid: '3', contenttypeid: '12', title: '경복궁', mapx: '126.98', mapy: '37.58', areacode: '1', cat1: 'A02', cat2: 'A0201' });
  assert.equal(his.category, 'history');
});
