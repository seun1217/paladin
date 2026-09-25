// 세계 육지(50m) + 지역별 상세 해안선(10m, bbox 클리핑) → data/geo.json
// 사용: node scripts/make-geo.js <node_modules 경로>
// 필요 패키지: world-atlas@2, topojson-client, @geo-maps/earth-coastlines-10m, @turf/bbox-clip
const fs = require('fs'); const path = require('path');
const nm = process.argv[2] || path.join(__dirname, '..', 'node_modules');
const req = (p) => require(path.join(nm, p));
const topo = req('topojson-client');
const { bboxClip } = req('@turf/bbox-clip');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'regions.config.json'), 'utf8'));

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
const roundCoords = (c, d) => Array.isArray(c[0]) ? c.map(x => roundCoords(x, d)) : [round(c[0], d), round(c[1], d)];

// 1) 세계 육지
const land = req('world-atlas/land-50m.json');
const landGeo = topo.feature(land, land.objects.land);
const landFeats = landGeo.type === 'FeatureCollection' ? landGeo.features : [landGeo];
const worldCoords = [];
for (const f of landFeats) { const g = f.geometry; if (g.type === 'Polygon') worldCoords.push(g.coordinates); else if (g.type === 'MultiPolygon') worldCoords.push(...g.coordinates); }
const world = { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: roundCoords(worldCoords, 2) } };

// 2) 지역 상세 해안선
const coast = JSON.parse(fs.readFileSync(path.join(nm, '@geo-maps/earth-coastlines-10m/map.geo.json'), 'utf8'));
const polys = [];
for (const g of coast.geometries) {
  if (g.type === 'Polygon') polys.push(g.coordinates);
  else if (g.type === 'MultiPolygon') for (const p of g.coordinates) polys.push(p);
}
function polyBbox(p) { let a = 180, b = -180, c = 90, d = -90; for (const r of p) for (const [x, y] of r) { if (x < a) a = x; if (x > b) b = x; if (y < c) c = y; if (y > d) d = y; } return [a, c, b, d]; }
const pb = polys.map(polyBbox);
const regions = {};
for (const r of cfg.regions) {
  const [minLat, maxLat, minLng, maxLng] = r.bbox;
  const padY = (maxLat - minLat) * 0.6 + 0.15, padX = (maxLng - minLng) * 0.6 + 0.15;
  const box = [minLng - padX, minLat - padY, maxLng + padX, maxLat + padY]; // [w,s,e,n]
  const out = [];
  polys.forEach((p, i) => {
    const [a, c, b, d] = pb[i];
    if (b < box[0] || a > box[2] || d < box[1] || c > box[3]) return;
    const clipped = bboxClip({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: p } }, box);
    const g = clipped.geometry;
    if (!g) return;
    const cs = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const c2 of cs) if (c2.length && c2[0].length >= 4) out.push(roundCoords(c2, 4));
  });
  regions[r.id] = { bbox: box, geometry: { type: 'MultiPolygon', coordinates: out } };
}
const result = { generatedAt: new Date().toISOString().slice(0, 10), attribution: 'Natural Earth (public domain) via world-atlas and @geo-maps', world, regions };
const outPath = path.join(__dirname, '..', 'data', 'geo.json');
fs.writeFileSync(outPath, JSON.stringify(result));
const sz = fs.statSync(outPath).size;
console.log('wrote', outPath, (sz / 1024).toFixed(0) + 'KB');
for (const id in regions) console.log(id, 'polys', regions[id].geometry.coordinates.length, 'bytes', JSON.stringify(regions[id]).length);
