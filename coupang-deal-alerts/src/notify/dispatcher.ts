import type { Repos } from '../core/repos.js';
import type { DealRecord, NotificationMessage, Notifier, ProductRecord, Sensitivity, UserPrefs } from '../core/types.js';

export interface DispatcherOptions {
  /** minimum deal severity per sensitivity level */
  severityThresholds?: Record<Sensitivity, number>;
  /** do not notify the same user about the same product within this window (ms). Default 24h */
  perProductCooldownMs?: number;
  /** deals older than this are not delivered when flushing deferred (quiet hours) items. Default 12h */
  deferredMaxAgeMs?: number;
  timeZone?: string;
  now?: () => number;
  baseUrl?: string;
  logger?: { warn: (msg: string, ...a: unknown[]) => void; info: (msg: string, ...a: unknown[]) => void };
  /** resolves display names for the notification text */
  subcategoryName?: (id: string) => string | undefined;
}

export const DEFAULT_SEVERITY_THRESHOLDS: Record<Sensitivity, number> = {
  conservative: 0.7,
  normal: 0.5,
  sensitive: 0.3,
};

export interface DispatchSummary {
  candidates: number;
  sent: number;
  deferred: number;
  skipped: { sensitivity: number; dailyCap: number; cooldown: number; noChannel: number; duplicate: number };
}

/** Local hour (0-23) in the configured time zone. */
export function localHour(t: number, timeZone: string): number {
  const s = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).format(new Date(t));
  const h = Number(s);
  return h === 24 ? 0 : h;
}

/** Epoch ms of local midnight (start of day) in the time zone for the day containing t. */
export function startOfLocalDay(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(t));
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? '0');
  const hour = get('hour') % 24;
  const elapsed = ((hour * 60 + get('minute')) * 60 + get('second')) * 1000 + (t % 1000);
  return t - elapsed;
}

export function inQuietHours(t: number, q: { startHour: number; endHour: number } | null, timeZone: string): boolean {
  if (!q || q.startHour === q.endHour) return false;
  const h = localHour(t, timeZone);
  return q.startHour < q.endHour ? h >= q.startHour && h < q.endHour : h >= q.startHour || h < q.endHour;
}

export function formatWon(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

export function buildMessage(deal: DealRecord, product: ProductRecord, subcategoryName: string | undefined, baseUrl: string | undefined): NotificationMessage {
  const pct = Math.round(deal.discountPct * 100);
  const title = `${subcategoryName ? `[${subcategoryName}] ` : ''}평시 대비 ${pct}% 할인`;
  const body = `${product.name}\n${formatWon(deal.price)} (평시 ${formatWon(deal.baselinePrice)}) · ${deal.reason}`;
  const url = baseUrl ? `${baseUrl}/open?deal=${deal.id}` : product.url;
  return { title, body, url, imageUrl: product.imageUrl ?? undefined, tag: `deal-${deal.productId}` };
}

/**
 * Routes newly detected deals to interested users through the configured channels,
 * applying per-user sensitivity, daily cap, quiet hours (deferral) and per-product cooldown.
 */
export class Dispatcher {
  private readonly thresholds: Record<Sensitivity, number>;
  private readonly cooldownMs: number;
  private readonly deferredMaxAgeMs: number;
  private readonly tz: string;
  private readonly now: () => number;
  private readonly log: NonNullable<DispatcherOptions['logger']>;

  constructor(private readonly repos: Repos, private readonly notifiers: Notifier[], private readonly opts: DispatcherOptions = {}) {
    this.thresholds = opts.severityThresholds ?? DEFAULT_SEVERITY_THRESHOLDS;
    this.cooldownMs = opts.perProductCooldownMs ?? 24 * 3600_000;
    this.deferredMaxAgeMs = opts.deferredMaxAgeMs ?? 12 * 3600_000;
    this.tz = opts.timeZone ?? 'Asia/Seoul';
    this.now = opts.now ?? (() => Date.now());
    this.log = opts.logger ?? console;
  }

  get channels(): string[] { return this.notifiers.map((n) => n.channel); }

  /** Deliver one deal to every eligible subscriber. */
  async dispatchDeal(deal: DealRecord, product: ProductRecord): Promise<DispatchSummary> {
    const summary: DispatchSummary = { candidates: 0, sent: 0, deferred: 0, skipped: { sensitivity: 0, dailyCap: 0, cooldown: 0, noChannel: 0, duplicate: 0 } };
    const users = this.repos.listUsersForSubcategory(deal.subcategoryId);
    summary.candidates = users.length;
    for (const u of users) {
      const r = await this.deliverToUser(u, deal, product, /*fromDeferred*/ false);
      this.bump(summary, r);
    }
    return summary;
  }

  /** Send deals that were held back by quiet hours, now that they may be allowed. */
  async flushDeferred(): Promise<DispatchSummary> {
    const summary: DispatchSummary = { candidates: 0, sent: 0, deferred: 0, skipped: { sensitivity: 0, dailyCap: 0, cooldown: 0, noChannel: 0, duplicate: 0 } };
    const now = this.now();
    for (const d of this.repos.listDeferred()) {
      const prefs = this.repos.getUserPrefs(d.userId);
      const deal = this.repos.getDeal(d.dealId);
      const product = deal ? this.repos.getProduct(deal.productId) : null;
      if (!prefs || !deal || !product || now - deal.detectedAt > this.deferredMaxAgeMs || !prefs.subcategoryIds.includes(deal.subcategoryId)) {
        this.repos.deleteDeferred(d.userId, d.dealId);
        continue;
      }
      if (inQuietHours(now, prefs.quietHours, this.tz)) continue; // still quiet, keep waiting
      summary.candidates++;
      const r = await this.deliverToUser(prefs, deal, product, true);
      if (r !== 'deferred') this.repos.deleteDeferred(d.userId, d.dealId);
      this.bump(summary, r);
    }
    return summary;
  }

  private bump(s: DispatchSummary, r: DeliverResult): void {
    if (r === 'sent') s.sent++;
    else if (r === 'deferred') s.deferred++;
    else s.skipped[r]++;
  }

  private async deliverToUser(u: UserPrefs, deal: DealRecord, product: ProductRecord, fromDeferred: boolean): Promise<DeliverResult> {
    const now = this.now();
    if (deal.severity < (this.thresholds[u.sensitivity] ?? this.thresholds.normal)) return 'sensitivity';
    const last = this.repos.lastNotifiedProductAt(u.userId, deal.productId);
    if (last !== null && now - last < this.cooldownMs) return 'cooldown';
    if (u.dailyCap > 0 && this.repos.countNotificationsSince(u.userId, startOfLocalDay(now, this.tz)) >= u.dailyCap) return 'dailyCap';
    if (inQuietHours(now, u.quietHours, this.tz)) {
      if (!fromDeferred) this.repos.deferNotification(u.userId, deal.id, now);
      return 'deferred';
    }
    const message = buildMessage(deal, product, this.opts.subcategoryName?.(deal.subcategoryId), this.opts.baseUrl);
    let anyOk = false;
    let anyChannel = false;
    for (const n of this.notifiers) {
      if (this.repos.hasNotified(u.userId, deal.id, n.channel)) { anyChannel = true; continue; }
      const results = await n.send(u.userId, message);
      if (results.length === 0) continue; // user has no endpoint on this channel
      anyChannel = true;
      const ok = results.some((r) => r.ok);
      const err = results.filter((r) => !r.ok).map((r) => (r as { error: string }).error).join('; ') || null;
      this.repos.recordNotification({ userId: u.userId, dealId: deal.id, productId: deal.productId, channel: n.channel, sentAt: now, ok, error: err });
      if (ok) anyOk = true;
      else this.log.warn(`[dispatch] ${n.channel} failed for user ${u.userId}: ${err}`);
    }
    if (!anyChannel) return 'noChannel';
    return anyOk ? 'sent' : 'duplicate';
  }
}

type DeliverResult = 'sent' | 'deferred' | 'sensitivity' | 'dailyCap' | 'cooldown' | 'noChannel' | 'duplicate';
