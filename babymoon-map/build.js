// 템플릿(src/index.html) + 데이터(data/babymoon.json, data/geo.json) + Leaflet CSS → index.html (단일 파일)
// 사용: node build.js
const fs = require('fs'); const path = require('path');
const root = __dirname;
const tpl = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'babymoon.json'), 'utf8'));
const geo = JSON.parse(fs.readFileSync(path.join(root, 'data', 'geo.json'), 'utf8'));
const css = fs.readFileSync(path.join(root, 'vendor', 'leaflet.css'), 'utf8').replace(/url\(images\/[^)]*\)/g, 'none');
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const safe = o => JSON.stringify(o).split('</').join('<\\/').split(LS).join('\\u2028').split(PS).join('\\u2029');
const out = tpl.replace('/*__LEAFLET_CSS__*/', css).replace('"__DATA_JSON__"', safe(data)).replace('"__GEO_JSON__"', safe(geo));
fs.writeFileSync(path.join(root, 'index.html'), out);
console.log('built index.html', (out.length / 1024).toFixed(0) + 'KB', '| regions', data.regions.length, '| places', data.places.length, '| events', data.events.length, '| promotions', data.promotions.length, '| updatedAt', data.meta.updatedAt);
