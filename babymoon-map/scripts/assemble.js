// 지역별 검증 JSON(verified/*.json) → data/babymoon.json 병합
// 사용: node scripts/assemble.js <verifiedDir> [updatedAt=YYYY-MM-DD]
// - 각 파일: { region, places, events, promotions } (workflow 검증 단계 출력)
// - 기존 data/babymoon.json 과 비교해 새 항목에 addedAt 을 찍고, 기존 항목의 addedAt 은 유지
// - 파일이 없는 지역은 기존 데이터를 그대로 유지(부분 업데이트 가능)
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const dir = process.argv[2]; if (!dir) { console.error('usage: node scripts/assemble.js <verifiedDir> [updatedAt]'); process.exit(2); }
const today = process.argv[3] || new Date().toISOString().slice(0, 10);
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'data', 'regions.config.json'), 'utf8'));
const order = cfg.regions.map(r => r.id);
const prevPath = path.join(root, 'data', 'babymoon.json');
const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, 'utf8')) : { regions: [], places: [], events: [], promotions: [], meta: {} };
const prevById = {}; [...prev.places, ...prev.events, ...prev.promotions].forEach(x => prevById[x.id] = x);
const prevRegion = Object.fromEntries(prev.regions.map(r => [r.id, r]));
const regionUpdated = Object.assign({}, prev.meta.regionUpdated || {});
const clean = s => typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : s;
const out = { meta: {}, regions: [], places: [], events: [], promotions: [] };
const seen = new Set(); let loaded = 0, kept = 0;
for (const id of order) {
  const f = path.join(dir, id + '.json');
  if (!fs.existsSync(f)) {
    if (prevRegion[id]) { out.regions.push(prevRegion[id]); for (const k of ['places', 'events', 'promotions']) out[k].push(...prev[k].filter(x => x.regionId === id)); kept++; }
    else console.warn('WARN 지역 파일 없음(건너뜀):', id);
    continue;
  }
  let d; try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.warn('WARN JSON 파싱 실패:', f, e.message); continue; }
  if (!d.region || !Array.isArray(d.places)) { console.warn('WARN 형식 오류:', f); continue; }
  loaded++; regionUpdated[id] = today;
  const r = d.region; r.id = id; out.regions.push(r);
  const push = (arr, kind) => {
    for (const it of arr || []) {
      if (!it || !it.id || seen.has(it.id)) { if (it && it.id) console.warn('WARN ID 중복 제거:', it.id); continue; }
      seen.add(it.id); it.regionId = id;
      for (const k in it) it[k] = clean(it[k]);
      if (kind === 'places') { it.tags = it.tags || []; it.babymoon = it.babymoon || []; }
      const old = prevById[it.id];
      it.addedAt = old && old.addedAt ? old.addedAt : today;
      it.updatedAt = today;
      out[kind].push(it);
    }
  };
  push(d.places, 'places'); push(d.events, 'events'); push(d.promotions, 'promotions');
}
out.meta = { updatedAt: today, version: (prev.meta.version || 0) + 1, origin: 'ICN', regionUpdated, note: '태교여행 지도 데이터. 검증 워크플로우 결과를 assemble.js 로 병합. 프로모션·행사는 예약 전 출처 재확인 필요.' };
fs.writeFileSync(prevPath, JSON.stringify(out, null, 1));
console.log(`assembled: ${loaded} regions loaded, ${kept} kept from previous, places ${out.places.length}, events ${out.events.length}, promotions ${out.promotions.length} → data/babymoon.json`);
