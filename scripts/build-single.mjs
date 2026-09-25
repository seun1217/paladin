// 단일 HTML 파일 빌드: CSS, JS(ES 모듈 -> 인라인), Leaflet, 데이터를 모두 한 파일에 넣는다.
// 결과: dist/korea-tourism-map.html  (서버 없이 더블클릭으로 열 수 있고, 아티팩트/사내 공유용)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// ES 모듈들을 하나의 스크립트로 묶는다 (의존성 순서대로, import/export 문 제거).
// 각 모듈은 로컬 스코프를 갖지 않고 하나의 모듈 스코프를 공유하므로 이름 충돌이 없어야 한다.
const ORDER = ['js/regions.js', 'js/taxonomy.js', 'js/model.js', 'js/tourapi.js', 'js/data.js', 'js/map.js', 'js/ui.js', 'js/app.js'];
function stripModuleSyntax(src) {
  return src
    .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, '')
    .replace(/^export\s+(const|let|var|function|class|async function)\s/gm, '$1 ')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '');
}
const bundled = ORDER.map((p) => `// ---- ${p} ----\n${stripModuleSyntax(read(p))}`).join('\n');

const data = {
  seedSpots: JSON.parse(read('data/seed/spots.seed.json')),
  seedEvents: JSON.parse(read('data/seed/events.seed.json')),
  spots: JSON.parse(read('data/spots.json')),
  events: JSON.parse(read('data/events.json')),
  meta: JSON.parse(read('data/meta.json')),
  geo: JSON.parse(read('data/geo/korea-provinces.json')),
};
const dataScript = `window.__KTM_INLINE_DATA__ = ${JSON.stringify(data).replace(/<\/script/gi, '<\\/script')};`;

let html = read('index.html');
const inlineCss = [read('vendor/leaflet/leaflet.css'), read('vendor/leaflet.markercluster/MarkerCluster.css'), read('css/style.css')].join('\n');
html = html
  .replace(/<link rel="stylesheet" href="vendor\/leaflet\/leaflet.css">\s*/g, '')
  .replace(/<link rel="stylesheet" href="vendor\/leaflet.markercluster\/MarkerCluster.css">\s*/g, '')
  .replace('<link rel="stylesheet" href="css/style.css">', `<style>\n${inlineCss}\n</style>`)
  .replace('<script src="vendor/leaflet/leaflet.js"></script>', `<script>\n${read('vendor/leaflet/leaflet.js')}\n</script>`)
  .replace('<script src="vendor/leaflet.markercluster/leaflet.markercluster.js"></script>', `<script>\n${read('vendor/leaflet.markercluster/leaflet.markercluster.js')}\n</script>`)
  .replace('<script type="module" src="js/app.js"></script>', `<script>\n${dataScript}\n</script>\n<script type="module">\n${bundled}\n</script>`);

mkdirSync(resolve(root, 'dist'), { recursive: true });
const artifact = process.argv.includes('--artifact');
let out = resolve(root, 'dist/korea-tourism-map.html');
if (artifact) {
  // 문서 골격(doctype/html/head/body)을 제공하는 호스트에 넣기 위한 본문 전용 변형: <title> 과 <style> 을 맨 앞에 둔다.
  const title = /<title>[\s\S]*?<\/title>/.exec(html)[0];
  const style = /<style>[\s\S]*?<\/style>/.exec(html)[0];
  const body = /<body>([\s\S]*)<\/body>/.exec(html)[1];
  html = `${title}\n${style}\n${body}`;
  out = resolve(root, 'dist/korea-tourism-map.artifact.html');
}
writeFileSync(out, html);
console.log(`built ${out} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
