// 데이터 검증: 스키마 필수값, ID 중복, 좌표 bbox, 날짜 형식/순서, 만료 프로모션 경고
// 사용: node validate.js [--strict]   (strict: 경고도 실패 처리)
const fs = require('fs'); const path = require('path');
const root = __dirname; const strict = process.argv.includes('--strict');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'babymoon.json'), 'utf8'));
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'data', 'regions.config.json'), 'utf8'));
const bbox = Object.fromEntries(cfg.regions.map(r => [r.id, r.bbox]));
const errors = [], warns = [];
const err = m => errors.push(m), warn = m => warns.push(m);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const today = data.meta && data.meta.updatedAt;
if (!data.meta || !isDate(data.meta.updatedAt)) err('meta.updatedAt 누락 또는 형식 오류');
const ids = new Set(); const dup = id => { if (ids.has(id)) err('ID 중복: ' + id); ids.add(id); };
const regionIds = new Set();
for (const r of data.regions || []) {
  dup(r.id); regionIds.add(r.id);
  for (const k of ['name', 'nameEn', 'country', 'countryCode', 'lat', 'lng', 'flightHours', 'directFlight', 'timeDiffHours', 'visa', 'zika', 'zikaNote', 'bestMonths', 'rainyMonths', 'currency', 'budgetLevel', 'medicalNote', 'summary', 'tips']) if (r[k] === undefined || r[k] === null || r[k] === '') err(`region ${r.id}: ${k} 누락`);
  if (!['none', 'low', 'moderate', 'high', 'unknown'].includes(r.zika)) err(`region ${r.id}: zika 값 오류 ${r.zika}`);
  if (!(r.budgetLevel >= 1 && r.budgetLevel <= 4)) err(`region ${r.id}: budgetLevel 범위 오류`);
  if (!bbox[r.id]) warn(`region ${r.id}: regions.config.json에 bbox 없음`);
}
const inBox = (id, lat, lng) => { const b = bbox[id]; return !b || (lat >= b[0] && lat <= b[1] && lng >= b[2] && lng <= b[3]); };
const placeIds = new Set();
for (const p of data.places || []) {
  dup(p.id); placeIds.add(p.id);
  if (!regionIds.has(p.regionId)) err(`place ${p.id}: regionId 불명 ${p.regionId}`);
  if (!['resort', 'hotel', 'attraction', 'spa', 'dining', 'medical'].includes(p.type)) err(`place ${p.id}: type 오류 ${p.type}`);
  for (const k of ['name', 'nameEn', 'lat', 'lng', 'description', 'confidence']) if (p[k] === undefined || p[k] === '') err(`place ${p.id}: ${k} 누락`);
  if (typeof p.lat !== 'number' || typeof p.lng !== 'number') err(`place ${p.id}: 좌표 숫자 아님`);
  else if (!inBox(p.regionId, p.lat, p.lng)) err(`place ${p.id} (${p.name}): 좌표 ${p.lat},${p.lng} 가 ${p.regionId} bbox 밖`);
  if (p.priceLevel != null && !(p.priceLevel >= 1 && p.priceLevel <= 4)) err(`place ${p.id}: priceLevel 범위 오류`);
  if (!p.url) warn(`place ${p.id} (${p.name}): url 없음`);
}
for (const e of data.events || []) {
  dup(e.id);
  if (!regionIds.has(e.regionId)) err(`event ${e.id}: regionId 불명`);
  for (const k of ['name', 'start', 'end', 'lat', 'lng', 'description', 'url', 'confidence']) if (e[k] === undefined || e[k] === '') err(`event ${e.id}: ${k} 누락`);
  if (!isDate(e.start) || !isDate(e.end)) err(`event ${e.id}: 날짜 형식 오류`); else if (e.start > e.end) err(`event ${e.id}: start > end`);
  if (typeof e.lat === 'number' && !inBox(e.regionId, e.lat, e.lng)) err(`event ${e.id} (${e.name}): 좌표가 bbox 밖`);
  if (today && e.end < today) warn(`event ${e.id} (${e.name}): 이미 종료됨 (${e.end})`);
}
for (const m of data.promotions || []) {
  dup(m.id);
  if (!regionIds.has(m.regionId)) err(`promo ${m.id}: regionId 불명`);
  for (const k of ['title', 'provider', 'providerName', 'summary', 'url', 'confidence']) if (m[k] === undefined || m[k] === '') err(`promo ${m.id}: ${k} 누락`);
  for (const k of ['bookStart', 'bookEnd', 'travelStart', 'travelEnd']) if (m[k] != null && !isDate(m[k])) err(`promo ${m.id}: ${k} 날짜 형식 오류`);
  if (m.placeId && !placeIds.has(m.placeId)) err(`promo ${m.id}: placeId 불명 ${m.placeId}`);
  if (today && m.bookEnd && m.bookEnd < today) warn(`promo ${m.id} (${m.title}): 예약 마감 지남 (${m.bookEnd})`);
  if (today && m.travelEnd && m.travelEnd < today) warn(`promo ${m.id} (${m.title}): 여행 기간 종료 (${m.travelEnd})`);
}
const stats = {}; for (const r of data.regions) stats[r.id] = { resorts: 0, attractions: 0, medical: 0, events: 0, promos: 0 };
for (const p of data.places) { const s = stats[p.regionId]; if (!s) continue; if (p.type === 'resort' || p.type === 'hotel') s.resorts++; else if (p.type === 'medical') s.medical++; else s.attractions++; }
for (const e of data.events) if (stats[e.regionId]) stats[e.regionId].events++;
for (const m of data.promotions) if (stats[m.regionId]) stats[m.regionId].promos++;
console.table(stats);
console.log(`regions ${data.regions.length}, places ${data.places.length}, events ${data.events.length}, promotions ${data.promotions.length}`);
warns.forEach(w => console.log('WARN', w)); errors.forEach(e => console.log('ERROR', e));
console.log(`${errors.length} errors, ${warns.length} warnings`);
process.exit(errors.length || (strict && warns.length) ? 1 : 0);
