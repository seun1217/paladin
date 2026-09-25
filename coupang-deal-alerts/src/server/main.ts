import path from 'node:path';
import { loadConfig, loadDotEnv } from '../core/config.js';
import { openDb } from '../core/db.js';
import { Repos } from '../core/repos.js';
import { Classifier, loadTaxonomy } from '../core/taxonomy.js';
import { createDetector } from '../core/detector.js';
import { Pipeline } from '../core/pipeline.js';
import { Scheduler } from '../core/scheduler.js';
import { FixtureProvider } from '../providers/fixture.js';
import { CoupangPartnersProvider } from '../providers/coupang-partners.js';
import { WebPushNotifier } from '../notify/webpush.js';
import { TelegramNotifier } from '../notify/telegram.js';
import { Dispatcher } from '../notify/dispatcher.js';
import type { Notifier, ProductProvider } from '../core/types.js';
import { buildApp } from './app.js';

loadDotEnv();
process.on('unhandledRejection', (e) => console.error('[main] unhandled rejection:', e));
const root = path.resolve(process.cwd());
const cfg = loadConfig(root);

const repos = new Repos(openDb(cfg.dbPath));
const classifier = new Classifier(loadTaxonomy());

const provider: ProductProvider = cfg.providerMode === 'coupang'
  ? new CoupangPartnersProvider({ accessKey: cfg.coupang.accessKey, secretKey: cfg.coupang.secretKey, subId: cfg.coupang.subId,
      minSpacingMs: cfg.minRequestSpacingMs, apiPrefix: process.env.COUPANG_API_PREFIX })
  : new FixtureProvider({ categoryIds: classifier.coupangCategoryIds });

const notifiers: Notifier[] = [];
let telegram: TelegramNotifier | null = null;
if (cfg.vapid.publicKey && cfg.vapid.privateKey) {
  notifiers.push(new WebPushNotifier(repos, { vapidPublicKey: cfg.vapid.publicKey, vapidPrivateKey: cfg.vapid.privateKey, subject: cfg.vapid.subject }));
} else {
  console.warn('[main] VAPID keys not set: web push disabled. Run `npm run vapid` and put the keys in .env');
}
if (cfg.telegramBotToken) {
  telegram = new TelegramNotifier(repos, { botToken: cfg.telegramBotToken });
  notifiers.push(telegram);
}

const dispatcher = new Dispatcher(repos, notifiers, { timeZone: cfg.timeZone, baseUrl: cfg.baseUrl, subcategoryName: (id) => classifier.subcategoryName(id) });
const detector = createDetector();
const pipeline = new Pipeline(repos, classifier, detector, dispatcher);

// Travel categories exist in the API but produce no meaningful "usual price"; poll only what the taxonomy lists.
const categoryIds = classifier.coupangCategoryIds;
const scheduler = cfg.schedulerEnabled
  ? new Scheduler(provider, pipeline, repos, {
      categoryIds,
      intervalMs: cfg.pollIntervalMin * 60_000,
      spacingMs: cfg.providerMode === 'coupang' ? Math.max(3000, cfg.minRequestSpacingMs) : 0,
      limit: cfg.coupang.limit,
      dispatcher,
      onTick: telegram ? async () => { await telegram!.pollUpdates(); } : undefined,
    })
  : null;

const app = await buildApp({
  repos, classifier, scheduler, dispatcher, notifiers, telegram,
  publicDir: cfg.publicDir, vapidPublicKey: cfg.vapid.publicKey, adminToken: cfg.adminToken,
  providerMode: cfg.providerMode, baseUrl: cfg.baseUrl, logger: true,
  trustProxy: cfg.trustProxy, pushEndpointHosts: cfg.pushEndpointHosts,
});

await app.listen({ port: cfg.port, host: cfg.host });
console.log(`[main] listening on http://${cfg.host}:${cfg.port} provider=${provider.name} channels=${notifiers.map((n) => n.channel).join(',') || 'none'}`);
scheduler?.start();

const shutdown = async (sig: string) => {
  console.log(`[main] ${sig}: shutting down`);
  scheduler?.stop();
  await app.close();
  repos.db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
