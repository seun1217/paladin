// SVG -> PNG 렌더러 (Playwright + Chromium). 사용법: node src/render.mjs [scale]
// 기본 scale=1 → 360x360 (카카오 멈춰있는 이모티콘 규격), scale=3 → 1080x1080 (미리보기용)
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// 사용법: node src/render.mjs [scale] [svgDir] [outDir] [canvas]
const scale = Number(process.argv[2] || 1);
const svgDir = join(root, process.argv[3] || 'svg');
const outDir = join(root, process.argv[4] || (scale === 1 ? 'png' : `png@${scale}x`));
const canvas = Number(process.argv[5] || 360);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: canvas, height: canvas }, deviceScaleFactor: scale });
const files = readdirSync(svgDir).filter((f) => f.endsWith('.svg')).sort();
for (const file of files) {
  const svg = readFileSync(join(svgDir, file), 'utf8');
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  const out = join(outDir, basename(file, '.svg') + '.png');
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: canvas, height: canvas } });
  console.log('rendered', out);
}
await browser.close();
