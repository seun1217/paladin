import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayKST, addDays, daysBetween, presetRange, weekendRange, eventStatusOf, eventBadge, overlapsPeriod,
  materializeSeedEvent, normalizeTitle, mergeSpots, mergeEvents, applyFilters, defaultFilters, sortItems,
  monthlyEventCounts, nextMonths, filtersToQuery, filtersFromQuery, formatDateRange,
} from '../js/model.js';

test('todayKST는 UTC 기준 시각을 한국 날짜로 변환한다', () => {
  // 2026-09-24 20:00 UTC = 2026-09-25 05:00 KST
  assert.equal(todayKST(Date.UTC(2026, 8, 24, 20, 0)), '2026-09-25');
  assert.equal(todayKST(Date.UTC(2026, 8, 24, 14, 0)), '2026-09-24');
});

test('날짜 산술', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(daysBetween('2026-01-01', '2026-01-31'), 30);
  assert.equal(weekendRange('2026-09-25').from, '2026-09-26'); // 금요일 -> 토요일
  assert.equal(weekendRange('2026-09-27').from, '2026-09-27'); // 일요일 -> 오늘
  assert.deepEqual(presetRange('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(presetRange('nextMonth', '2026-12-10'), { from: '2027-01-01', to: '2027-01-31' });
  assert.deepEqual(presetRange('all', '2026-01-01'), { from: null, to: null });
});

test('행사 상태와 뱃지', () => {
  const ev = { start: '2026-10-01', end: '2026-10-10' };
  assert.equal(eventStatusOf(ev, '2026-09-25'), 'upcoming');
  assert.equal(eventStatusOf(ev, '2026-10-05'), 'ongoing');
  assert.equal(eventStatusOf(ev, '2026-10-11'), 'ended');
  assert.equal(eventBadge(ev, '2026-09-25'), 'D-6');
  assert.equal(eventBadge(ev, '2026-10-10'), '오늘 마지막');
  assert.equal(eventBadge(ev, '2026-10-11'), '종료');
});

test('기간 겹침 판정', () => {
  const ev = { start: '2026-10-01', end: '2026-10-10' };
  assert.equal(overlapsPeriod(ev, '2026-10-10', '2026-10-31'), true);
  assert.equal(overlapsPeriod(ev, '2026-10-11', '2026-10-31'), false);
  assert.equal(overlapsPeriod(ev, null, '2026-09-30'), false);
  assert.equal(overlapsPeriod(ev, null, null), true);
});

test('시드 행사는 오늘 기준 가장 가까운 회차로 구체화된다', () => {
  const seed = { id: 'x', title: '화천산천어축제', typicalStart: '01-10', typicalEnd: '02-01', lat: 38.1, lng: 127.7 };
  let ev = materializeSeedEvent(seed, '2026-09-25');
  assert.equal(ev.start, '2027-01-10');
  ev = materializeSeedEvent(seed, '2026-01-20');
  assert.equal(ev.start, '2026-01-10');
  assert.equal(eventStatusOf(ev, '2026-01-20'), 'ongoing');
  // 연도를 넘기는 축제: 1월에 보면 작년 12월 시작 회차가 진행 중
  const cross = { id: 'y', title: '평창송어축제', typicalStart: '12-20', typicalEnd: '01-31', lat: 37.6, lng: 128.5 };
  ev = materializeSeedEvent(cross, '2027-01-10');
  assert.equal(ev.start, '2026-12-20');
  assert.equal(ev.end, '2027-01-31');
  assert.equal(ev.dateBasis, 'estimated');
  // 30일 유예 후에는 다음 회차
  ev = materializeSeedEvent(cross, '2027-03-15');
  assert.equal(ev.start, '2027-12-20');
});

test('제목 정규화는 회차·연도·괄호를 제거한다', () => {
  assert.equal(normalizeTitle('제29회 보령머드축제 (2026)'), '보령머드축제');
  assert.equal(normalizeTitle('2026 진해군항제'), '진해군항제');
  assert.equal(normalizeTitle('경복궁 [야간개장]'), '경복궁');
});

test('시드 관광지와 TourAPI 관광지 병합', () => {
  const seed = [{ id: 'seed-1', title: '경복궁', category: 'history', lat: 37.5796, lng: 126.977, tags: ['궁궐'] }];
  const live = [
    { id: 'ta-1', kind: 'spot', title: '경복궁', category: 'nature', lat: 37.5797, lng: 126.9769, img: 'x.jpg', tags: [], contentId: '1' },
    { id: 'ta-2', kind: 'spot', title: '경복궁역', category: 'urban', lat: 37.5757, lng: 126.9734, tags: [] },
    { id: 'ta-3', kind: 'spot', title: '경복궁', category: 'history', lat: 35.0, lng: 128.0, tags: [] }, // 너무 멀다
  ];
  const merged = mergeSpots(seed, live);
  assert.equal(merged.length, 3);
  const first = merged[0];
  assert.equal(first.id, 'ta-1');
  assert.equal(first.category, 'history');
  assert.equal(first.featured, true);
  assert.equal(first.img, 'x.jpg');
  assert.deepEqual(first.tags, ['궁궐']);
  assert.ok(merged.some((m) => m.id === 'ta-2'));
  assert.ok(merged.some((m) => m.id === 'ta-3'));
});

test('시드 행사는 공식 데이터에 같은 행사가 있으면 숨겨진다', () => {
  const seed = [{ id: 'seed-ev-1', title: '보령머드축제', lat: 36.31, lng: 126.51, start: '2026-07-24', end: '2026-08-02', tags: ['여름'] }];
  const live = [{ id: 'ta-9', kind: 'event', title: '제29회 보령머드축제', lat: 36.312, lng: 126.514, start: '2026-07-25', end: '2026-08-03', tags: [] }];
  const merged = mergeEvents(seed, live);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'ta-9');
  assert.equal(merged[0].featured, true);
  assert.deepEqual(merged[0].tags, ['여름']);
});

const items = [
  { id: 's1', kind: 'spot', title: '경복궁', region: 1, category: 'history', lat: 37.58, lng: 126.98, tags: ['궁궐'], featured: true },
  { id: 's2', kind: 'spot', title: '해운대해수욕장', region: 6, category: 'beach', lat: 35.16, lng: 129.16, tags: ['해변'], featured: false },
  { id: 'e1', kind: 'event', title: '서울세계불꽃축제', region: 1, type: 'festival', lat: 37.53, lng: 126.93, start: '2026-10-03', end: '2026-10-03', tags: ['불꽃'], featured: true },
  { id: 'e2', kind: 'event', title: '부산불꽃축제', region: 6, type: 'festival', lat: 35.15, lng: 129.12, start: '2026-11-07', end: '2026-11-07', tags: ['불꽃'], featured: true },
  { id: 'e3', kind: 'event', title: '지난 행사', region: 6, type: 'music', lat: 35.15, lng: 129.12, start: '2026-08-01', end: '2026-08-02', tags: [], featured: false },
];
const today = '2026-09-25';

test('필터: 기본값은 오늘부터 90일', () => {
  const f = defaultFilters(today);
  const out = applyFilters(items, f, { today });
  assert.deepEqual(out.map((i) => i.id), ['s1', 's2', 'e1', 'e2']);
});

test('필터: 지역·종류·기간·검색·태그·상태', () => {
  let f = { ...defaultFilters(today), regions: [6] };
  assert.deepEqual(applyFilters(items, f, { today }).map((i) => i.id), ['s2', 'e2']);
  f = { ...defaultFilters(today), kinds: ['event'], from: '2026-10-01', to: '2026-10-31' };
  assert.deepEqual(applyFilters(items, f, { today }).map((i) => i.id), ['e1']);
  f = { ...defaultFilters(today), q: '불꽃' };
  assert.deepEqual(applyFilters(items, f, { today }).map((i) => i.id), ['e1', 'e2']);
  f = { ...defaultFilters(today), tags: ['해변'] };
  assert.deepEqual(applyFilters(items, f, { today }).map((i) => i.id), ['s2']);
  f = { ...defaultFilters(today), from: null, to: null, statuses: ['ended'] };
  assert.deepEqual(applyFilters(items, f, { today }).map((i) => i.id), ['s1', 's2', 'e3']);
  f = { ...defaultFilters(today), featuredOnly: true };
  assert.deepEqual(applyFilters(items, f, { today }).map((i) => i.id), ['s1', 'e1', 'e2']);
  f = { ...defaultFilters(today), near: { lat: 37.57, lng: 126.98, km: 10 } };
  assert.deepEqual(applyFilters(items, f, { today }).map((i) => i.id), ['s1', 'e1']);
  f = { ...defaultFilters(today), favoritesOnly: true };
  assert.deepEqual(applyFilters(items, f, { today, favorites: new Set(['s2']) }).map((i) => i.id), ['s2']);
});

test('정렬: 날짜순은 행사를 먼저, 진행 중 > 예정 > 종료', () => {
  const sorted = sortItems(items, 'date', { today: '2026-10-03' });
  assert.deepEqual(sorted.map((i) => i.id).slice(0, 3), ['e1', 'e2', 'e3']);
  const byTitle = sortItems(items, 'title', { today });
  assert.equal(byTitle[0].title, '경복궁');
});

test('다음 12개월 구간과 월별 행사 수', () => {
  const months = nextMonths('2026-09-25', 12);
  assert.equal(months.length, 12);
  assert.deepEqual(months[0], { year: 2026, month: 9, from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(months[4], { year: 2027, month: 1, from: '2027-01-01', to: '2027-01-31' });
  const counts = monthlyEventCounts(items, months);
  assert.equal(counts[1], 1); // 2026-10
  assert.equal(counts[2], 1); // 2026-11
  assert.equal(counts[0], 0); // 2026-09
  assert.equal(monthlyEventCounts(items, nextMonths('2026-08-01', 1))[0], 1); // 2026-08 지난 행사
});

test('필터 <-> URL 왕복', () => {
  const f = { ...defaultFilters(today), regions: [1, 39], q: '벚꽃', from: '2027-03-01', to: '2027-04-30', tags: ['봄'], featuredOnly: true };
  const q = filtersToQuery(f, today);
  const back = filtersFromQuery(q, today);
  assert.deepEqual(back, f);
  assert.equal(filtersToQuery(defaultFilters(today), today), '');
  const preset = filtersFromQuery('p=month', today);
  assert.equal(preset.from, '2026-09-01');
  assert.equal(preset.to, '2026-09-30');
});

test('날짜 범위 표시', () => {
  assert.equal(formatDateRange('2026-10-03', '2026-10-03'), '2026.10.03');
  assert.equal(formatDateRange('2026-10-01', '2026-10-10'), '2026.10.01 ~ 10.10');
  assert.equal(formatDateRange('2026-12-20', '2027-01-31'), '2026.12.20 ~ 2027.01.31');
});
