import type { Db } from './db.js';
import { transaction } from './db.js';
import type {
  DealRecord,
  PriceObservation,
  ProductRecord,
  PushSubscriptionRecord,
  Sensitivity,
  TelegramLinkRecord,
  UserPrefs,
} from './types.js';

const SENSITIVITIES: Sensitivity[] = ['conservative', 'normal', 'sensitive'];

export function isSensitivity(v: unknown): v is Sensitivity {
  return typeof v === 'string' && (SENSITIVITIES as string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

interface ProductRow {
  product_id: string; coupang_category_id: number; category_id: string; subcategory_id: string;
  name: string; url: string; image_url: string | null; is_rocket: number;
  first_seen_at: number; last_seen_at: number; last_price: number; last_rank: number;
}
function mapProduct(r: ProductRow): ProductRecord {
  return {
    productId: r.product_id,
    coupangCategoryId: r.coupang_category_id,
    categoryId: r.category_id,
    subcategoryId: r.subcategory_id,
    name: r.name,
    url: r.url,
    imageUrl: r.image_url,
    isRocket: r.is_rocket === 1,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    lastPrice: r.last_price,
    lastRank: r.last_rank,
  };
}

interface DealRow {
  id: number; product_id: string; category_id: string; subcategory_id: string; detected_at: number;
  price: number; baseline_price: number; discount_pct: number; severity: number; reason: string; rank: number;
}
function mapDeal(r: DealRow): DealRecord {
  return {
    id: r.id,
    productId: r.product_id,
    categoryId: r.category_id,
    subcategoryId: r.subcategory_id,
    detectedAt: r.detected_at,
    price: r.price,
    baselinePrice: r.baseline_price,
    discountPct: r.discount_pct,
    severity: r.severity,
    reason: r.reason,
    rank: r.rank,
  };
}

interface UserRow {
  user_id: string; sensitivity: string; daily_cap: number; quiet_start: number | null; quiet_end: number | null;
  created_at: number; updated_at: number;
}

interface PushRow {
  endpoint: string; user_id: string; p256dh: string; auth: string; created_at: number;
  last_ok_at: number | null; fail_count: number;
}
function mapPush(r: PushRow): PushSubscriptionRecord {
  return {
    userId: r.user_id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth,
    createdAt: r.created_at, lastOkAt: r.last_ok_at, failCount: r.fail_count,
  };
}

export interface DealWithProduct extends DealRecord {
  productName: string;
  productUrl: string;
  imageUrl: string | null;
  isRocket: boolean;
  categoryName?: string;
  subcategoryName?: string;
}

export interface PollRunSummary {
  coupangCategoryId: number;
  startedAt: number;
  finishedAt: number | null;
  ok: boolean | null;
  productCount: number | null;
  dealCount: number | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

export class Repos {
  constructor(public readonly db: Db) {}

  tx<T>(fn: () => T): T {
    return transaction(this.db, fn);
  }

  // ----- meta -----
  getMeta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? r.value : null;
  }
  setMeta(key: string, value: string): void {
    this.db.prepare(`INSERT INTO meta(key, value) VALUES(?, ?)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
  }

  // ----- products -----
  upsertProduct(p: ProductRecord): void {
    this.db.prepare(`
      INSERT INTO products(product_id, coupang_category_id, category_id, subcategory_id, name, url, image_url,
                           is_rocket, first_seen_at, last_seen_at, last_price, last_rank)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_id) DO UPDATE SET
        coupang_category_id = excluded.coupang_category_id,
        category_id    = excluded.category_id,
        subcategory_id = excluded.subcategory_id,
        name           = excluded.name,
        url            = excluded.url,
        image_url      = COALESCE(excluded.image_url, products.image_url),
        is_rocket      = excluded.is_rocket,
        last_seen_at   = excluded.last_seen_at,
        last_price     = excluded.last_price,
        last_rank      = excluded.last_rank
    `).run(
      p.productId, p.coupangCategoryId, p.categoryId, p.subcategoryId, p.name, p.url, p.imageUrl,
      p.isRocket ? 1 : 0, p.firstSeenAt, p.lastSeenAt, p.lastPrice, p.lastRank,
    );
  }

  getProduct(productId: string): ProductRecord | null {
    const r = this.db.prepare('SELECT * FROM products WHERE product_id = ?').get(productId) as ProductRow | undefined;
    return r ? mapProduct(r) : null;
  }

  countProductsBySubcategory(): Map<string, number> {
    const rows = this.db.prepare('SELECT subcategory_id, COUNT(*) AS n FROM products GROUP BY subcategory_id')
      .all() as { subcategory_id: string; n: number }[];
    return new Map(rows.map((r) => [r.subcategory_id, r.n]));
  }

  countProducts(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n;
  }

  // ----- observations -----
  insertObservation(productId: string, obs: PriceObservation): void {
    this.db.prepare(`INSERT OR REPLACE INTO observations(product_id, t, price, rank) VALUES(?, ?, ?, ?)`)
      .run(productId, obs.t, obs.price, obs.rank);
  }

  /** Ascending by time. `sinceT` inclusive lower bound (epoch ms). */
  getObservations(productId: string, sinceT = 0, limit = 5000): PriceObservation[] {
    const rows = this.db.prepare(
      `SELECT t, price, rank FROM observations WHERE product_id = ? AND t >= ? ORDER BY t ASC LIMIT ?`,
    ).all(productId, sinceT, limit) as unknown as PriceObservation[];
    // node:sqlite returns null-prototype objects; normalise to plain objects
    return rows.map((r) => ({ t: Number(r.t), price: Number(r.price), rank: Number(r.rank) }));
  }

  /** Delete observations older than `beforeT` (retention). Returns rows removed. */
  pruneObservations(beforeT: number): number {
    const res = this.db.prepare('DELETE FROM observations WHERE t < ?').run(beforeT);
    return Number(res.changes);
  }

  countObservations(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM observations').get() as { n: number }).n;
  }

  // ----- alert state (opaque JSON per product) -----
  getAlertState<T>(productId: string): T | null {
    const r = this.db.prepare('SELECT state_json FROM alert_state WHERE product_id = ?').get(productId) as
      | { state_json: string } | undefined;
    if (!r) return null;
    try { return JSON.parse(r.state_json) as T; } catch { return null; }
  }
  setAlertState(productId: string, state: unknown, now: number): void {
    this.db.prepare(`INSERT INTO alert_state(product_id, state_json, updated_at) VALUES(?, ?, ?)
                     ON CONFLICT(product_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`)
      .run(productId, JSON.stringify(state), now);
  }

  // ----- deals -----
  insertDeal(d: Omit<DealRecord, 'id'>): DealRecord {
    const res = this.db.prepare(`
      INSERT INTO deals(product_id, category_id, subcategory_id, detected_at, price, baseline_price,
                        discount_pct, severity, reason, rank)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      d.productId, d.categoryId, d.subcategoryId, d.detectedAt, d.price, d.baselinePrice,
      d.discountPct, d.severity, d.reason, d.rank,
    );
    return { id: Number(res.lastInsertRowid), ...d };
  }

  getDeal(id: number): DealRecord | null {
    const r = this.db.prepare('SELECT * FROM deals WHERE id = ?').get(id) as DealRow | undefined;
    return r ? mapDeal(r) : null;
  }

  /**
   * Recent deals joined with product info. Optional filter by subcategory ids.
   * Ordered newest first.
   */
  listDeals(opts: { subcategoryIds?: string[]; sinceT?: number; limit?: number; minSeverity?: number } = {}): DealWithProduct[] {
    const params: (string | number)[] = [];
    let where = 'WHERE 1=1';
    if (opts.subcategoryIds && opts.subcategoryIds.length > 0) {
      where += ` AND d.subcategory_id IN (${opts.subcategoryIds.map(() => '?').join(',')})`;
      params.push(...opts.subcategoryIds);
    }
    if (opts.sinceT !== undefined) { where += ' AND d.detected_at >= ?'; params.push(opts.sinceT); }
    if (opts.minSeverity !== undefined) { where += ' AND d.severity >= ?'; params.push(opts.minSeverity); }
    const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
    params.push(limit);
    const rows = this.db.prepare(`
      SELECT d.*, p.name AS product_name, p.url AS product_url, p.image_url AS p_image_url, p.is_rocket AS p_is_rocket
      FROM deals d JOIN products p ON p.product_id = d.product_id
      ${where}
      ORDER BY d.detected_at DESC, d.id DESC
      LIMIT ?`).all(...params) as unknown as (DealRow & { product_name: string; product_url: string; p_image_url: string | null; p_is_rocket: number })[];
    return rows.map((r) => ({
      ...mapDeal(r),
      productName: r.product_name,
      productUrl: r.product_url,
      imageUrl: r.p_image_url,
      isRocket: r.p_is_rocket === 1,
    }));
  }

  countDealsSince(sinceT: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM deals WHERE detected_at >= ?').get(sinceT) as { n: number }).n;
  }

  // ----- users & prefs -----
  ensureUser(userId: string, now: number): void {
    this.db.prepare(`INSERT OR IGNORE INTO users(user_id, created_at, updated_at) VALUES(?, ?, ?)`).run(userId, now, now);
  }

  getUserPrefs(userId: string): UserPrefs | null {
    const u = this.db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId) as UserRow | undefined;
    if (!u) return null;
    const subs = this.db.prepare('SELECT subcategory_id FROM user_subcategories WHERE user_id = ? ORDER BY subcategory_id')
      .all(userId) as { subcategory_id: string }[];
    return {
      userId: u.user_id,
      subcategoryIds: subs.map((s) => s.subcategory_id),
      sensitivity: isSensitivity(u.sensitivity) ? u.sensitivity : 'normal',
      dailyCap: u.daily_cap,
      quietHours: u.quiet_start !== null && u.quiet_end !== null ? { startHour: u.quiet_start, endHour: u.quiet_end } : null,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    };
  }

  /** Replace the full preference set for a user (idempotent). */
  saveUserPrefs(prefs: Omit<UserPrefs, 'createdAt' | 'updatedAt'>, now: number): UserPrefs {
    return this.tx(() => {
      this.ensureUser(prefs.userId, now);
      this.db.prepare(`UPDATE users SET sensitivity = ?, daily_cap = ?, quiet_start = ?, quiet_end = ?, updated_at = ?
                       WHERE user_id = ?`).run(
        prefs.sensitivity, prefs.dailyCap,
        prefs.quietHours ? prefs.quietHours.startHour : null,
        prefs.quietHours ? prefs.quietHours.endHour : null,
        now, prefs.userId,
      );
      this.db.prepare('DELETE FROM user_subcategories WHERE user_id = ?').run(prefs.userId);
      const ins = this.db.prepare('INSERT OR IGNORE INTO user_subcategories(user_id, subcategory_id) VALUES(?, ?)');
      for (const id of new Set(prefs.subcategoryIds)) ins.run(prefs.userId, id);
      return this.getUserPrefs(prefs.userId)!;
    });
  }

  /** Users subscribed to a subcategory, with their prefs. */
  listUsersForSubcategory(subcategoryId: string): UserPrefs[] {
    const ids = this.db.prepare('SELECT user_id FROM user_subcategories WHERE subcategory_id = ?')
      .all(subcategoryId) as { user_id: string }[];
    const out: UserPrefs[] = [];
    for (const { user_id } of ids) {
      const p = this.getUserPrefs(user_id);
      if (p) out.push(p);
    }
    return out;
  }

  countUsers(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  // ----- push subscriptions -----
  upsertPushSubscription(s: Omit<PushSubscriptionRecord, 'lastOkAt' | 'failCount'>): void {
    this.db.prepare(`
      INSERT INTO push_subscriptions(endpoint, user_id, p256dh, auth, created_at, last_ok_at, fail_count)
      VALUES(?, ?, ?, ?, ?, NULL, 0)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
        auth = excluded.auth, fail_count = 0`).run(s.endpoint, s.userId, s.p256dh, s.auth, s.createdAt);
  }
  deletePushSubscription(endpoint: string): boolean {
    return Number(this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint).changes) > 0;
  }
  listPushSubscriptions(userId: string): PushSubscriptionRecord[] {
    return (this.db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId) as unknown as PushRow[]).map(mapPush);
  }
  markPushOk(endpoint: string, now: number): void {
    this.db.prepare('UPDATE push_subscriptions SET last_ok_at = ?, fail_count = 0 WHERE endpoint = ?').run(now, endpoint);
  }
  markPushFail(endpoint: string): number {
    this.db.prepare('UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE endpoint = ?').run(endpoint);
    const r = this.db.prepare('SELECT fail_count FROM push_subscriptions WHERE endpoint = ?').get(endpoint) as { fail_count: number } | undefined;
    return r ? r.fail_count : 0;
  }
  countPushSubscriptions(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as { n: number }).n;
  }

  // ----- telegram -----
  setTelegramLink(userId: string, chatId: string, now: number): void {
    this.db.prepare(`INSERT INTO telegram_links(user_id, chat_id, created_at) VALUES(?, ?, ?)
                     ON CONFLICT(user_id) DO UPDATE SET chat_id = excluded.chat_id`).run(userId, chatId, now);
  }
  getTelegramLink(userId: string): TelegramLinkRecord | null {
    const r = this.db.prepare('SELECT * FROM telegram_links WHERE user_id = ?').get(userId) as
      | { user_id: string; chat_id: string; created_at: number } | undefined;
    return r ? { userId: r.user_id, chatId: r.chat_id, createdAt: r.created_at } : null;
  }
  deleteTelegramLink(userId: string): boolean {
    return Number(this.db.prepare('DELETE FROM telegram_links WHERE user_id = ?').run(userId).changes) > 0;
  }
  createTelegramLinkCode(code: string, userId: string, now: number): void {
    this.db.prepare('DELETE FROM telegram_link_codes WHERE user_id = ?').run(userId);
    this.db.prepare('INSERT INTO telegram_link_codes(code, user_id, created_at) VALUES(?, ?, ?)').run(code, userId, now);
  }
  /** Consume a link code; returns the userId or null if unknown/expired. */
  consumeTelegramLinkCode(code: string, now: number, maxAgeMs = 15 * 60_000): string | null {
    const r = this.db.prepare('SELECT user_id, created_at FROM telegram_link_codes WHERE code = ?').get(code) as
      | { user_id: string; created_at: number } | undefined;
    if (!r) return null;
    this.db.prepare('DELETE FROM telegram_link_codes WHERE code = ?').run(code);
    if (now - r.created_at > maxAgeMs) return null;
    return r.user_id;
  }

  // ----- notifications log -----
  /** Returns false if this (user, deal, channel) was already recorded. */
  recordNotification(n: { userId: string; dealId: number; productId: string; channel: string; sentAt: number; ok: boolean; error?: string | null }): boolean {
    const res = this.db.prepare(`INSERT OR IGNORE INTO notifications(user_id, deal_id, product_id, channel, sent_at, ok, error)
                                 VALUES(?, ?, ?, ?, ?, ?, ?)`)
      .run(n.userId, n.dealId, n.productId, n.channel, n.sentAt, n.ok ? 1 : 0, n.error ?? null);
    return Number(res.changes) > 0;
  }
  hasNotified(userId: string, dealId: number, channel: string): boolean {
    const r = this.db.prepare('SELECT 1 AS x FROM notifications WHERE user_id = ? AND deal_id = ? AND channel = ?')
      .get(userId, dealId, channel);
    return r !== undefined;
  }
  countNotificationsSince(userId: string, sinceT: number): number {
    return (this.db.prepare('SELECT COUNT(DISTINCT deal_id) AS n FROM notifications WHERE user_id = ? AND sent_at >= ? AND ok = 1')
      .get(userId, sinceT) as { n: number }).n;
  }
  /** Last time this user was notified about this product (any channel), or null. */
  lastNotifiedProductAt(userId: string, productId: string): number | null {
    const r = this.db.prepare('SELECT MAX(sent_at) AS t FROM notifications WHERE user_id = ? AND product_id = ? AND ok = 1')
      .get(userId, productId) as { t: number | null };
    return r.t;
  }

  // ----- deferred notifications (quiet hours) -----
  deferNotification(userId: string, dealId: number, now: number): void {
    this.db.prepare('INSERT OR IGNORE INTO deferred_notifications(user_id, deal_id, created_at) VALUES(?, ?, ?)').run(userId, dealId, now);
  }
  listDeferred(): { userId: string; dealId: number; createdAt: number }[] {
    const rows = this.db.prepare('SELECT user_id, deal_id, created_at FROM deferred_notifications ORDER BY created_at ASC')
      .all() as unknown as { user_id: string; deal_id: number; created_at: number }[];
    return rows.map((r) => ({ userId: r.user_id, dealId: Number(r.deal_id), createdAt: Number(r.created_at) }));
  }
  deleteDeferred(userId: string, dealId: number): void {
    this.db.prepare('DELETE FROM deferred_notifications WHERE user_id = ? AND deal_id = ?').run(userId, dealId);
  }

  // ----- poll runs -----
  startPollRun(coupangCategoryId: number, now: number): number {
    const res = this.db.prepare('INSERT INTO poll_runs(coupang_category_id, started_at) VALUES(?, ?)').run(coupangCategoryId, now);
    return Number(res.lastInsertRowid);
  }
  finishPollRun(id: number, r: { ok: boolean; productCount: number; dealCount: number; error?: string | null }, now: number): void {
    this.db.prepare('UPDATE poll_runs SET finished_at = ?, ok = ?, product_count = ?, deal_count = ?, error = ? WHERE id = ?')
      .run(now, r.ok ? 1 : 0, r.productCount, r.dealCount, r.error ?? null, id);
  }
  lastPollRuns(): PollRunSummary[] {
    const rows = this.db.prepare(`
      SELECT pr.* FROM poll_runs pr
      JOIN (SELECT coupang_category_id, MAX(started_at) AS m FROM poll_runs GROUP BY coupang_category_id) x
        ON x.coupang_category_id = pr.coupang_category_id AND x.m = pr.started_at
      ORDER BY pr.coupang_category_id`).all() as {
        coupang_category_id: number; started_at: number; finished_at: number | null; ok: number | null;
        product_count: number | null; deal_count: number | null; error: string | null;
      }[];
    return rows.map((r) => ({
      coupangCategoryId: r.coupang_category_id, startedAt: r.started_at, finishedAt: r.finished_at,
      ok: r.ok === null ? null : r.ok === 1, productCount: r.product_count, dealCount: r.deal_count, error: r.error,
    }));
  }
  prunePollRuns(beforeT: number): number {
    return Number(this.db.prepare('DELETE FROM poll_runs WHERE started_at < ?').run(beforeT).changes);
  }
}
