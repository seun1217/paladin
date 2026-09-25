// 단일 SVG를 PNG로 렌더링: node src/render_one.mjs <in.svg> <out.png> <width> <height> [scale]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const [inp, out, w, h, scale = '1'] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: Number(scale) });
await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${readFileSync(inp, 'utf8')}</body></html>`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: Number(w), height: Number(h) } });
await browser.close();
console.log('rendered', out);
