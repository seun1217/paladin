// node_modules에 설치된 Leaflet / MarkerCluster 배포 파일을 vendor/ 로 복사한다.
// 앱은 CDN 없이 vendor/ 만으로 동작한다 (오프라인·사내망 환경 대비).
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  ['node_modules/leaflet/dist/leaflet.js', 'vendor/leaflet/leaflet.js'],
  ['node_modules/leaflet/dist/leaflet.css', 'vendor/leaflet/leaflet.css'],
  ['node_modules/leaflet/dist/images', 'vendor/leaflet/images'],
  ['node_modules/leaflet/LICENSE', 'vendor/leaflet/LICENSE'],
  ['node_modules/leaflet.markercluster/dist/leaflet.markercluster.js', 'vendor/leaflet.markercluster/leaflet.markercluster.js'],
  ['node_modules/leaflet.markercluster/dist/MarkerCluster.css', 'vendor/leaflet.markercluster/MarkerCluster.css'],
  ['node_modules/leaflet.markercluster/dist/MarkerCluster.Default.css', 'vendor/leaflet.markercluster/MarkerCluster.Default.css'],
  ['node_modules/leaflet.markercluster/MIT-LICENCE.txt', 'vendor/leaflet.markercluster/MIT-LICENCE.txt'],
];

for (const [from, to] of targets) {
  const src = resolve(root, from);
  const dst = resolve(root, to);
  if (!existsSync(src)) {
    console.warn(`skip (missing): ${from}`);
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log(`copied ${from} -> ${to}`);
}
