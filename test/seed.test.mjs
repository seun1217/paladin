import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REGIONS, isInKorea } from '../js/regions.js';
import { SPOT_CATEGORIES, EVENT_TYPES } from '../js/taxonomy.js';

const spots = JSON.parse(readFileSync(new URL('../data/seed/spots.seed.json', import.meta.url), 'utf8')).items;
const events = JSON.parse(readFileSync(new URL('../data/seed/events.seed.json', import.meta.url), 'utf8')).items;
const regionCodes = new Set(REGIONS.map((r) => r.code));
const catKeys = new Set(SPOT_CATEGORIES.map((c) => c.key));
const typeKeys = new Set(EVENT_TYPES.map((c) => c.key));

test('시드 관광지 데이터 무결성', () => {
  const ids = new Set();
  for (const s of spots) {
    assert.ok(s.id && !ids.has(s.id), `중복/누락 id: ${s.id}`);
    ids.add(s.id);
    assert.ok(s.title, `${s.id}: 제목 없음`);
    assert.ok(regionCodes.has(s.region), `${s.id}: 지역코드 오류 ${s.region}`);
    assert.ok(catKeys.has(s.category), `${s.id}: 카테고리 오류 ${s.category}`);
    assert.ok(isInKorea(s.lat, s.lng), `${s.id}: 좌표가 한국 범위 밖`);
  }
  assert.ok(spots.length >= 150);
  // 17개 시·도 모두 최소 2곳 이상
  for (const r of REGIONS) assert.ok(spots.filter((s) => s.region === r.code).length >= 2, `${r.name} 관광지 부족`);
});

test('시드 행사 데이터 무결성', () => {
  const ids = new Set();
  for (const e of events) {
    assert.ok(e.id && !ids.has(e.id), `중복/누락 id: ${e.id}`);
    ids.add(e.id);
    assert.ok(regionCodes.has(e.region), `${e.id}: 지역코드 오류`);
    assert.ok(typeKeys.has(e.type), `${e.id}: 유형 오류 ${e.type}`);
    assert.match(e.typicalStart, /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, `${e.id}: typicalStart`);
    assert.match(e.typicalEnd, /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, `${e.id}: typicalEnd`);
    assert.ok(isInKorea(e.lat, e.lng), `${e.id}: 좌표가 한국 범위 밖`);
  }
  assert.ok(events.length >= 60);
  // 열두 달 모두 최소 1건 이상 (기간 필터가 어느 달에도 비지 않도록)
  const months = new Set(events.map((e) => e.typicalStart.slice(0, 2)));
  assert.equal(months.size, 12);
});

test('시·도 경계 GeoJSON 은 17개 시·도를 모두 포함한다', () => {
  const geo = JSON.parse(readFileSync(new URL('../data/geo/korea-provinces.json', import.meta.url), 'utf8'));
  assert.equal(geo.type, 'FeatureCollection');
  assert.equal(geo.features.length, 17);
  const codes = new Set(geo.features.map((f) => f.properties.areaCode));
  for (const r of REGIONS) assert.ok(codes.has(r.code), `${r.name} 경계 누락`);
  for (const f of geo.features) {
    const coords = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of coords) for (const ring of poly) for (const [lng, lat] of ring) assert.ok(isInKorea(lat, lng), `${f.properties.name} 좌표 범위 밖 ${lat},${lng}`);
  }
});
