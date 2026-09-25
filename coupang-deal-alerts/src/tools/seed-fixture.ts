/**
 * Seed the database with N days of simulated history from the fixture provider so the demo
 * has baselines and deals immediately. Usage: npm run seed -- [days=21] [stepHours=6]
 */
import path from 'node:path';
import { loadConfig, loadDotEnv } from '../core/config.js';
import { openDb } from '../core/db.js';
import { Repos } from '../core/repos.js';
import { Classifier, loadTaxonomy } from '../core/taxonomy.js';
import { createDetector } from '../core/detector.js';
import { Pipeline } from '../core/pipeline.js';
import { FixtureProvider } from '../providers/fixture.js';

loadDotEnv();
const cfg = loadConfig(path.resolve(process.cwd()));
const days = Number(process.argv[2] ?? 21);
const stepH = Number(process.argv[3] ?? 6);

const repos = new Repos(openDb(cfg.dbPath));
const classifier = new Classifier(loadTaxonomy());
let now = Date.now() - days * 24 * 3600_000;
const provider = new FixtureProvider({ now: () => now, categoryIds: classifier.coupangCategoryIds });
const pipeline = new Pipeline(repos, classifier, createDetector(), null, { logger: { info() {}, warn: console.warn } });

let deals = 0;
const steps = Math.ceil((days * 24) / stepH);
for (let i = 0; i <= steps; i++) {
  for (const cid of classifier.coupangCategoryIds) {
    const snap = await provider.fetchBestProducts(cid, cfg.coupang.limit);
    const r = await pipeline.processSnapshot(snap);
    deals += r.deals.length;
  }
  now += stepH * 3600_000;
  if (i % 8 === 0) process.stdout.write(`\r[seed] ${i}/${steps} steps, ${deals} deals`);
}
repos.setMeta('last_sweep_at', String(Date.now() - cfg.pollIntervalMin * 60_000));
console.log(`\n[seed] done: ${repos.countProducts()} products, ${repos.countObservations()} observations, ${deals} deals -> ${cfg.dbPath}`);
repos.db.close();
