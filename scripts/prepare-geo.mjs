#!/usr/bin/env node
// TopoJSON(시·도 경계) -> GeoJSON 변환. 타일 지도를 불러올 수 없는 환경(오프라인, 콘텐츠 보안 정책)에서
// 벡터 폴백 지도로 사용한다.
//
//   node scripts/prepare-geo.mjs <topojson 파일> [출력 파일]
//
// 원본: https://github.com/southkorea/southkorea-maps (kostat/2018/json/skorea-provinces-2018-topo-simple.json)
//       통계청(KOSTAT) 행정구역 경계, "Free to share or remix".
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGIONS } from '../js/regions.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [,, input, output = resolve(root, 'data/geo/korea-provinces.json')] = process.argv;
if (!input) { console.error('사용법: node scripts/prepare-geo.mjs <topojson> [출력]'); process.exit(2); }
const topo = JSON.parse(readFileSync(input, 'utf8'));
const PRECISION = 4; // 소수점 4자리 ≈ 11m
const MIN_RING_KM2 = 0.4; // 이보다 작은 섬(고리)은 폴백 지도에서 생략해 용량을 줄인다

// 통계청 시·도 코드(2자리) -> TourAPI areaCode
const KOSTAT_TO_AREA = { 11: 1, 21: 6, 22: 4, 23: 2, 24: 5, 25: 3, 26: 7, 29: 8, 31: 31, 32: 32, 33: 33, 34: 34, 35: 37, 36: 38, 37: 35, 38: 36, 39: 39 };

function decodeArc(arc) {
  const { scale = [1, 1], translate = [0, 0] } = topo.transform || {};
  let x = 0; let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx; y += dy;
    return [Number((x * scale[0] + translate[0]).toFixed(PRECISION)), Number((y * scale[1] + translate[1]).toFixed(PRECISION))];
  });
}
const arcs = topo.arcs.map(decodeArc);

function ring(arcIndexes) {
  const pts = [];
  for (const idx of arcIndexes) {
    const a = idx < 0 ? arcs[~idx].slice().reverse() : arcs[idx];
    if (pts.length) pts.push(...a.slice(1)); else pts.push(...a);
  }
  return pts;
}

// 위경도 고리의 대략적인 면적(km²). 위도에 따른 경도 축척을 보정한 신발끈 공식.
function ringAreaKm2(pts) {
  if (pts.length < 4) return 0;
  const lat0 = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110.57;
  let area = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    area += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky);
  }
  return Math.abs(area) / 2;
}

function polygon(rings) {
  const coords = rings.map(ring);
  if (ringAreaKm2(coords[0]) < MIN_RING_KM2) return null; // 외곽 고리가 너무 작으면 생략
  return coords;
}

function geometry(g) {
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: polygon(g.arcs) || g.arcs.map(ring) };
  if (g.type === 'MultiPolygon') {
    const polys = g.arcs.map(polygon).filter(Boolean);
    return { type: 'MultiPolygon', coordinates: polys.length ? polys : g.arcs.map((poly) => poly.map(ring)) };
  }
  throw new Error(`지원하지 않는 형식: ${g.type}`);
}

const object = topo.objects[Object.keys(topo.objects)[0]];
const features = object.geometries.map((g) => {
  const code = String(g.properties?.code ?? g.properties?.CTPRVN_CD ?? '').slice(0, 2);
  const areaCode = KOSTAT_TO_AREA[code] ?? null;
  const region = REGIONS.find((r) => r.code === areaCode);
  return {
    type: 'Feature',
    properties: { code, areaCode, name: region ? region.name : (g.properties?.name || ''), full: region ? region.full : (g.properties?.name || '') },
    geometry: geometry(g),
  };
});

mkdirSync(dirname(output), { recursive: true });
const out = { type: 'FeatureCollection', source: 'KOSTAT 2018 via github.com/southkorea/southkorea-maps', features };
writeFileSync(output, JSON.stringify(out));
console.log(`${features.length} features -> ${output} (${(Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0)} KB)`);
for (const f of features) console.log(' ', f.properties.code, f.properties.areaCode, f.properties.name);
