import type { Repos } from './repos.js';
import type { Pipeline } from './pipeline.js';
import type { ProductProvider } from './types.js';
import type { Dispatcher } from '../notify/dispatcher.js';
import { isAuthOrQuotaError } from '../providers/coupang-partners.js';

export interface SchedulerOptions {
  /** coupang category ids to sweep, in order */
  categoryIds: number[];
  /** full sweep interval in ms */
  intervalMs: number;
  /** spacing between category polls within a sweep, ms */
  spacingMs?: number;
  /** products per category */
  limit: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: { warn: (msg: string, ...a: unknown[]) => void; info: (msg: string, ...a: unknown[]) => void };
  /** optional hook run at the start of each tick (e.g. telegram link polling) */
  onTick?: () => Promise<void>;
  /** run deferred flush every tick */
  dispatcher?: Dispatcher | null;
  /** tick period for the timer loop (ms). Default 60s */
  tickMs?: number;
  /** after an auth/quota error (401/403) pause polling for this long. Default 24h */
  authBackoffMs?: number;
}

export interface SweepResult {
  startedAt: number;
  finishedAt: number;
  categories: { coupangCategoryId: number; ok: boolean; products: number; deals: number; error?: string }[];
}

/**
 * Drives periodic sweeps: for each category, poll the provider and feed the pipeline.
 * A single timer tick checks whether a sweep is due, flushes deferred notifications and
 * runs any tick hooks. Sweeps never overlap.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;
  private lastSweepAt: number | null = null;
  private lastResult: SweepResult | null = null;
  /** when set, polling is paused until this time (auth/quota circuit breaker) */
  private pausedUntil: number | null = null;
  private pauseReason: string | null = null;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: NonNullable<SchedulerOptions['logger']>;

  constructor(
    private readonly provider: ProductProvider,
    private readonly pipeline: Pipeline,
    private readonly repos: Repos,
    private readonly opts: SchedulerOptions,
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = opts.logger ?? console;
    const meta = repos.getMeta('last_sweep_at');
    if (meta) this.lastSweepAt = Number(meta);
    const paused = repos.getMeta('paused_until');
    if (paused && Number(paused) > this.now()) { this.pausedUntil = Number(paused); this.pauseReason = repos.getMeta('pause_reason'); }
  }

  get status() {
    return {
      running: this.timer !== null,
      sweeping: this.sweeping,
      lastSweepAt: this.lastSweepAt,
      nextSweepAt: this.lastSweepAt === null ? this.now() : this.lastSweepAt + this.opts.intervalMs,
      intervalMs: this.opts.intervalMs,
      lastResult: this.lastResult,
      provider: this.provider.name,
      pausedUntil: this.pausedUntil !== null && this.pausedUntil > this.now() ? this.pausedUntil : null,
      pauseReason: this.pausedUntil !== null && this.pausedUntil > this.now() ? this.pauseReason : null,
    };
  }

  start(): void {
    if (this.timer) return;
    const tickMs = this.opts.tickMs ?? 60_000;
    this.timer = setInterval(() => { void this.tick(); }, tickMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    try { await this.opts.onTick?.(); } catch (e) { this.log.warn(`[scheduler] tick hook failed: ${(e as Error).message}`); }
    try { await this.opts.dispatcher?.flushDeferred(); } catch (e) { this.log.warn(`[scheduler] flushDeferred failed: ${(e as Error).message}`); }
    if (this.pausedUntil !== null && this.now() < this.pausedUntil) return;
    const due = this.lastSweepAt === null || this.now() - this.lastSweepAt >= this.opts.intervalMs;
    if (due && !this.sweeping) await this.sweep();
  }

  /** Pause polling (circuit breaker). Persisted so restarts do not hammer a blocked key. */
  pause(ms: number, reason: string): void {
    this.pausedUntil = this.now() + ms;
    this.pauseReason = reason;
    this.repos.setMeta('paused_until', String(this.pausedUntil));
    this.repos.setMeta('pause_reason', reason);
    this.log.warn(`[scheduler] polling paused for ${Math.round(ms / 60_000)} min: ${reason}`);
  }

  resume(): void {
    this.pausedUntil = null; this.pauseReason = null;
    this.repos.setMeta('paused_until', '0');
  }

  /** Run one full sweep now (no-op if one is in progress). */
  async sweep(categoryIds: number[] = this.opts.categoryIds): Promise<SweepResult | null> {
    if (this.sweeping) return null;
    this.sweeping = true;
    const startedAt = this.now();
    this.lastSweepAt = startedAt;
    this.repos.setMeta('last_sweep_at', String(startedAt));
    const result: SweepResult = { startedAt, finishedAt: startedAt, categories: [] };
    try {
      let first = true;
      for (const cid of categoryIds) {
        if (!first && this.opts.spacingMs) await this.sleep(this.opts.spacingMs);
        first = false;
        const runId = this.repos.startPollRun(cid, this.now());
        try {
          const snap = await this.provider.fetchBestProducts(cid, this.opts.limit);
          const r = await this.pipeline.processSnapshot(snap);
          this.repos.finishPollRun(runId, { ok: true, productCount: r.products, dealCount: r.deals.length }, this.now());
          result.categories.push({ coupangCategoryId: cid, ok: true, products: r.products, deals: r.deals.length });
          if (r.deals.length) this.log.info(`[scheduler] category ${cid}: ${r.products} products, ${r.deals.length} deals, ${r.notified} notifications`);
        } catch (e) {
          const msg = (e as Error).message ?? String(e);
          this.repos.finishPollRun(runId, { ok: false, productCount: 0, dealCount: 0, error: msg }, this.now());
          result.categories.push({ coupangCategoryId: cid, ok: false, products: 0, deals: 0, error: msg });
          this.log.warn(`[scheduler] category ${cid} failed: ${msg}`);
          if (isAuthOrQuotaError(e)) {
            // A rejected key or quota block must not be retried blindly: repeated 403s can escalate to a ban.
            this.pause(this.opts.authBackoffMs ?? 24 * 3600_000, msg);
            break;
          }
        }
      }
      try { this.pipeline.prune(); } catch (e) { this.log.warn(`[scheduler] prune failed: ${(e as Error).message}`); }
    } finally {
      result.finishedAt = this.now();
      this.lastResult = result;
      this.sweeping = false;
    }
    return result;
  }
}
