import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { randomBytes } from 'node:crypto';
import type { Repos } from '../core/repos.js';
import { isSensitivity } from '../core/repos.js';
import type { Classifier } from '../core/taxonomy.js';
import type { Scheduler } from '../core/scheduler.js';
import { DEFAULT_SEVERITY_THRESHOLDS, type Dispatcher } from '../notify/dispatcher.js';
import type { Notifier, Sensitivity, UserPrefs } from '../core/types.js';
import type { TelegramNotifier } from '../notify/telegram.js';

export interface AppDeps {
  repos: Repos;
  classifier: Classifier;
  scheduler: Scheduler | null;
  dispatcher: Dispatcher | null;
  notifiers: Notifier[];
  telegram: TelegramNotifier | null;
  publicDir: string;
  vapidPublicKey: string;
  adminToken: string;
  providerMode: string;
  baseUrl: string;
  now?: () => number;
  logger?: boolean;
}

const USER_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const userParams = { type: 'object', required: ['userId'], properties: { userId: { type: 'string', pattern: USER_ID_RE.source } } } as const;

const prefsBody = {
  type: 'object',
  properties: {
    subcategoryIds: { type: 'array', maxItems: 1000, items: { type: 'string', maxLength: 80 } },
    sensitivity: { type: 'string', enum: ['conservative', 'normal', 'sensitive'] },
    dailyCap: { type: 'integer', minimum: 0, maximum: 500 },
    quietHours: {
      anyOf: [
        { type: 'null' },
        { type: 'object', required: ['startHour', 'endHour'], properties: {
          startHour: { type: 'integer', minimum: 0, maximum: 23 }, endHour: { type: 'integer', minimum: 0, maximum: 23 } } },
      ],
    },
  },
} as const;

const pushBody = {
  type: 'object', required: ['subscription'],
  properties: {
    subscription: {
      type: 'object', required: ['endpoint', 'keys'],
      properties: {
        endpoint: { type: 'string', minLength: 10, maxLength: 2048 },
        expirationTime: { type: ['number', 'null'] },
        keys: { type: 'object', required: ['p256dh', 'auth'], properties: { p256dh: { type: 'string', maxLength: 256 }, auth: { type: 'string', maxLength: 128 } } },
      },
    },
    oldEndpoint: { type: ['string', 'null'], maxLength: 2048 },
  },
} as const;

interface PrefsBodyT { subcategoryIds?: string[]; sensitivity?: Sensitivity; dailyCap?: number; quietHours?: { startHour: number; endHour: number } | null }
interface PushBodyT { subscription: { endpoint: string; expirationTime?: number | null; keys: { p256dh: string; auth: string } }; oldEndpoint?: string | null }

function defaultPrefs(userId: string, now: number): UserPrefs {
  return { userId, subcategoryIds: [], sensitivity: 'normal', dailyCap: 10, quietHours: { startHour: 23, endHour: 8 }, createdAt: now, updatedAt: now };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const now = deps.now ?? (() => Date.now());
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 64 * 1024, trustProxy: true });
  const { repos, classifier } = deps;

  await app.register(fastifyStatic, {
    root: deps.publicDir,
    prefix: '/',
    index: ['index.html'],
    cacheControl: false, // we set Cache-Control ourselves below
    setHeaders(res, filePath) {
      if (filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Service-Worker-Allowed', '/');
      } else if (filePath.endsWith('.webmanifest')) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
      } else if (/\.(html|js|css)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    },
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  });

  // ------------------------------------------------------------------ meta
  app.get('/api/health', async () => ({ ok: true, time: now() }));

  app.get('/api/config', async () => ({
    vapidPublicKey: deps.vapidPublicKey || null,
    channels: deps.notifiers.map((n) => n.channel),
    providerMode: deps.providerMode,
    telegramBotUsername: deps.telegram ? await deps.telegram.getBotUsername() : null,
    disclosure: '이 서비스는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받을 수 있습니다.',
  }));

  app.get('/api/status', async () => {
    const dayAgo = now() - 24 * 3600_000;
    return {
      providerMode: deps.providerMode,
      scheduler: deps.scheduler ? deps.scheduler.status : null,
      lastPolls: repos.lastPollRuns(),
      counts: {
        products: repos.countProducts(),
        observations: repos.countObservations(),
        users: repos.countUsers(),
        pushSubscriptions: repos.countPushSubscriptions(),
        dealsLast24h: repos.countDealsSince(dayAgo),
      },
    };
  });

  // ------------------------------------------------------------------ taxonomy
  app.get('/api/taxonomy', async () => {
    const counts = repos.countProductsBySubcategory();
    const weekAgo = now() - 7 * 24 * 3600_000;
    const dealCounts = new Map<string, number>();
    for (const d of repos.listDeals({ sinceT: weekAgo, limit: 500 })) dealCounts.set(d.subcategoryId, (dealCounts.get(d.subcategoryId) ?? 0) + 1);
    return {
      categories: classifier.categories.map((c) => ({
        id: c.id,
        name: c.name,
        coupangCategoryId: c.coupangCategoryId,
        subcategories: c.subcategories.map((s) => ({
          id: s.id, name: s.name, productCount: counts.get(s.id) ?? 0, dealsLast7d: dealCounts.get(s.id) ?? 0,
        })),
      })),
    };
  });

  // ------------------------------------------------------------------ prefs
  app.get<{ Params: { userId: string } }>('/api/users/:userId/prefs', { schema: { params: userParams } }, async (req) => {
    const p = repos.getUserPrefs(req.params.userId);
    const prefs = p ?? defaultPrefs(req.params.userId, now());
    return {
      exists: p !== null,
      prefs,
      channels: {
        webpush: repos.listPushSubscriptions(req.params.userId).length,
        telegram: repos.getTelegramLink(req.params.userId) !== null,
      },
    };
  });

  app.put<{ Params: { userId: string }; Body: PrefsBodyT }>('/api/users/:userId/prefs', { schema: { params: userParams, body: prefsBody } }, async (req, reply) => {
    const t = now();
    const existing = repos.getUserPrefs(req.params.userId) ?? defaultPrefs(req.params.userId, t);
    const body = req.body ?? {};
    const subcategoryIds = (body.subcategoryIds ?? existing.subcategoryIds).filter((id) => classifier.hasSubcategory(id));
    const unknown = (body.subcategoryIds ?? []).filter((id) => !classifier.hasSubcategory(id));
    const sensitivity = body.sensitivity && isSensitivity(body.sensitivity) ? body.sensitivity : existing.sensitivity;
    const dailyCap = body.dailyCap ?? existing.dailyCap;
    const quietHours = body.quietHours === undefined ? existing.quietHours : body.quietHours;
    const saved = repos.saveUserPrefs({ userId: req.params.userId, subcategoryIds, sensitivity, dailyCap, quietHours }, t);
    return reply.send({ prefs: saved, ignoredSubcategoryIds: unknown });
  });

  // ------------------------------------------------------------------ push subscriptions
  app.post<{ Params: { userId: string }; Body: PushBodyT }>('/api/users/:userId/push', { schema: { params: userParams, body: pushBody } }, async (req, reply) => {
    const t = now();
    const { subscription, oldEndpoint } = req.body;
    repos.ensureUser(req.params.userId, t);
    if (!repos.getUserPrefs(req.params.userId)?.updatedAt) {
      // brand new user via push first: persist defaults so quiet hours etc. exist
      const d = defaultPrefs(req.params.userId, t);
      repos.saveUserPrefs({ userId: d.userId, subcategoryIds: d.subcategoryIds, sensitivity: d.sensitivity, dailyCap: d.dailyCap, quietHours: d.quietHours }, t);
    }
    if (oldEndpoint && oldEndpoint !== subscription.endpoint) repos.deletePushSubscription(oldEndpoint);
    repos.upsertPushSubscription({ userId: req.params.userId, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, createdAt: t });
    return reply.code(201).send({ ok: true, count: repos.listPushSubscriptions(req.params.userId).length });
  });

  app.delete<{ Params: { userId: string }; Body: { endpoint?: string } }>('/api/users/:userId/push', {
    schema: { params: userParams, body: { type: 'object', required: ['endpoint'], properties: { endpoint: { type: 'string', maxLength: 2048 } } } },
  }, async (req) => {
    const subs = repos.listPushSubscriptions(req.params.userId);
    const target = subs.find((s) => s.endpoint === req.body.endpoint);
    if (target) repos.deletePushSubscription(target.endpoint);
    return { ok: true, removed: Boolean(target) };
  });

  app.post<{ Params: { userId: string } }>('/api/users/:userId/test-notification', { schema: { params: userParams } }, async (req, reply) => {
    if (deps.notifiers.length === 0) return reply.code(503).send({ error: '알림 채널이 설정되지 않았습니다 (VAPID 키 또는 텔레그램 토큰 필요).' });
    const results: Record<string, unknown> = {};
    for (const n of deps.notifiers) {
      results[n.channel] = await n.send(req.params.userId, {
        title: '테스트 알림',
        body: '알림이 정상적으로 설정되었습니다. 선택한 세부 카테고리에서 평시보다 큰 할인이 감지되면 알려드립니다.',
        url: `${deps.baseUrl}/`,
        tag: 'test',
      });
    }
    return { ok: true, results };
  });

  // ------------------------------------------------------------------ telegram
  app.post<{ Params: { userId: string } }>('/api/users/:userId/telegram/link-code', { schema: { params: userParams } }, async (req, reply) => {
    if (!deps.telegram) return reply.code(503).send({ error: '텔레그램 채널이 설정되지 않았습니다.' });
    const t = now();
    repos.ensureUser(req.params.userId, t);
    const code = randomBytes(4).toString('hex').toUpperCase();
    repos.createTelegramLinkCode(code, req.params.userId, t);
    const bot = await deps.telegram.getBotUsername();
    return { code, botUsername: bot, url: bot ? `https://t.me/${bot}?start=${code}` : null, expiresInSec: 15 * 60 };
  });

  app.delete<{ Params: { userId: string } }>('/api/users/:userId/telegram', { schema: { params: userParams } }, async (req) => ({
    ok: true, removed: repos.deleteTelegramLink(req.params.userId),
  }));

  // ------------------------------------------------------------------ deals
  app.get<{ Querystring: { subcategoryIds?: string; since?: string; limit?: string; minSeverity?: string } }>('/api/deals', async (req) => {
    const q = req.query;
    const subcategoryIds = q.subcategoryIds ? q.subcategoryIds.split(',').filter((s) => classifier.hasSubcategory(s)) : undefined;
    const sinceT = q.since ? Number(q.since) : now() - 7 * 24 * 3600_000;
    const limit = q.limit ? Math.min(200, Math.max(1, Number(q.limit) || 50)) : 50;
    const minSeverity = q.minSeverity ? Number(q.minSeverity) : undefined;
    if (subcategoryIds && subcategoryIds.length === 0) return { deals: [] };
    return { deals: decorate(repos.listDeals({ subcategoryIds, sinceT: Number.isFinite(sinceT) ? sinceT : undefined, limit, minSeverity })) };
  });

  /** Deals matching the user's subscribed sub-categories AND their sensitivity threshold (what they would be notified about). */
  app.get<{ Params: { userId: string }; Querystring: { limit?: string } }>('/api/users/:userId/deals', { schema: { params: userParams } }, async (req) => {
    const prefs = repos.getUserPrefs(req.params.userId);
    if (!prefs || prefs.subcategoryIds.length === 0) return { deals: [], reason: 'no-subcategories' };
    const limit = req.query.limit ? Math.min(200, Math.max(1, Number(req.query.limit) || 50)) : 50;
    const minSeverity = DEFAULT_SEVERITY_THRESHOLDS[prefs.sensitivity];
    return { deals: decorate(repos.listDeals({ subcategoryIds: prefs.subcategoryIds, sinceT: now() - 7 * 24 * 3600_000, limit, minSeverity })), minSeverity };
  });

  app.get<{ Params: { productId: string } }>('/api/products/:productId/history', {
    schema: { params: { type: 'object', required: ['productId'], properties: { productId: { type: 'string', maxLength: 64 } } } },
  }, async (req, reply) => {
    const p = repos.getProduct(req.params.productId);
    if (!p) return reply.code(404).send({ error: 'not found' });
    const obs = repos.getObservations(req.params.productId, now() - 60 * 24 * 3600_000);
    return { product: { ...p, subcategoryName: classifier.subcategoryName(p.subcategoryId) }, observations: obs };
  });

  /** Same-origin click-through: lets the service worker focus our window, then hop to Coupang. */
  app.get<{ Params: { dealId: string } }>('/go/:dealId', async (req, reply) => {
    const id = Number(req.params.dealId);
    const deal = Number.isInteger(id) ? repos.getDeal(id) : null;
    const product = deal ? repos.getProduct(deal.productId) : null;
    if (!product || !/^https?:\/\//.test(product.url)) return reply.redirect('/', 302);
    return reply.redirect(product.url, 302);
  });

  // ------------------------------------------------------------------ admin
  app.post<{ Body: { categoryIds?: number[] } | null }>('/api/admin/sweep', async (req, reply) => {
    if (!deps.adminToken || req.headers['x-admin-token'] !== deps.adminToken) return reply.code(401).send({ error: 'unauthorized' });
    if (!deps.scheduler) return reply.code(503).send({ error: 'scheduler disabled' });
    const ids = req.body?.categoryIds?.filter((n) => Number.isInteger(n));
    const r = await deps.scheduler.sweep(ids && ids.length ? ids : undefined);
    return { ok: true, result: r, note: r === null ? 'sweep already in progress' : undefined };
  });

  function decorate<T extends { subcategoryId: string; categoryId: string }>(deals: T[]) {
    return deals.map((d) => ({ ...d, subcategoryName: classifier.subcategoryName(d.subcategoryId), categoryName: classifier.category(d.categoryId)?.name }));
  }

  return app;
}
