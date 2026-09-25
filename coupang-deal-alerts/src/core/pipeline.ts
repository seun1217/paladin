import type { Repos } from './repos.js';
import type { Classifier } from './taxonomy.js';
import type { Dispatcher } from '../notify/dispatcher.js';
import type { CategoryPrior, CategorySnapshot, DealRecord, Detector, ProductRecord } from './types.js';

export interface PipelineOptions {
  now?: () => number;
  logger?: { warn: (msg: string, ...a: unknown[]) => void; info: (msg: string, ...a: unknown[]) => void };
  /** keep observations for this long. Default 120 days */
  retentionMs?: number;
  /** only consider items ranked at or above this for alerts (1 = top). Default 100 */
  maxRankForAlert?: number;
}

export interface SnapshotResult {
  coupangCategoryId: number;
  products: number;
  newProducts: number;
  deals: DealRecord[];
  notified: number;
}

/**
 * Turns one provider snapshot into persisted observations, runs the detector on
 * each product and dispatches deals. All DB writes for the snapshot happen in one
 * transaction; notifications go out afterwards (network I/O outside the tx).
 */
export class Pipeline {
  private readonly now: () => number;
  private readonly log: NonNullable<PipelineOptions['logger']>;
  private readonly retentionMs: number;
  private readonly maxRankForAlert: number;

  constructor(
    private readonly repos: Repos,
    private readonly classifier: Classifier,
    private readonly detector: Detector,
    private readonly dispatcher: Dispatcher | null,
    opts: PipelineOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.log = opts.logger ?? console;
    this.retentionMs = opts.retentionMs ?? 120 * 24 * 3600_000;
    this.maxRankForAlert = opts.maxRankForAlert ?? 100;
  }

  async processSnapshot(snapshot: CategorySnapshot): Promise<SnapshotResult> {
    const category = this.classifier.categoryForCoupangId(snapshot.coupangCategoryId);
    if (!category) throw new Error(`unknown coupang category ${snapshot.coupangCategoryId}`);
    const t = snapshot.polledAt;
    const deals: { deal: DealRecord; product: ProductRecord }[] = [];
    let newProducts = 0;

    const prior = this.loadPrior(category.id);
    const ownDepths: number[] = [];
    this.repos.tx(() => {
      const seen = new Set<string>();
      for (const p of snapshot.products) {
        if (!p.productId || seen.has(p.productId)) continue;
        seen.add(p.productId);
        const sub = this.classifier.classify(category.id, p.productName, p.providerCategoryName);
        const existing = this.repos.getProduct(p.productId);
        if (!existing) newProducts++;
        const record: ProductRecord = {
          productId: p.productId,
          coupangCategoryId: snapshot.coupangCategoryId,
          categoryId: category.id,
          subcategoryId: sub.id,
          name: p.productName,
          url: p.productUrl,
          imageUrl: p.imageUrl ?? null,
          isRocket: Boolean(p.isRocket),
          firstSeenAt: existing?.firstSeenAt ?? t,
          lastSeenAt: t,
          lastPrice: p.price,
          lastRank: p.rank,
        };
        this.repos.upsertProduct(record);

        // history BEFORE this observation
        const history = this.repos.getObservations(p.productId, t - this.detector.historyWindowMs).filter((o) => o.t < t);
        const current = { t, price: p.price, rank: p.rank };
        this.repos.insertObservation(p.productId, current);

        const state = this.repos.getAlertState<unknown>(p.productId);
        let outcome;
        try {
          outcome = this.detector.decide(history, current, state, { productId: p.productId, categoryId: category.id, subcategoryId: sub.id, now: t, categoryPrior: prior });
        } catch (e) {
          this.log.warn(`[pipeline] detector failed for ${p.productId}: ${(e as Error).message}`);
          continue;
        }
        this.repos.setAlertState(p.productId, outcome.newState, t);
        const od = (outcome.newState as { ownUsualDepth?: unknown } | null)?.ownUsualDepth;
        if (typeof od === 'number' && Number.isFinite(od)) ownDepths.push(od);
        const d = outcome.decision;
        if (d.alert && p.rank <= this.maxRankForAlert && d.baselinePrice !== null && d.discountFromBaseline !== null) {
          const deal = this.repos.insertDeal({
            productId: p.productId, categoryId: category.id, subcategoryId: sub.id, detectedAt: t,
            price: p.price, baselinePrice: Math.round(d.baselinePrice), discountPct: d.discountFromBaseline,
            severity: d.severity, reason: d.reason, rank: p.rank,
          });
          deals.push({ deal, product: record });
        }
      }
    });

    this.savePrior(category.id, ownDepths);

    let notified = 0;
    if (this.dispatcher) {
      for (const { deal, product } of deals) {
        try {
          const s = await this.dispatcher.dispatchDeal(deal, product);
          notified += s.sent;
        } catch (e) {
          this.log.warn(`[pipeline] dispatch failed for deal ${deal.id}: ${(e as Error).message}`);
        }
      }
    }
    return { coupangCategoryId: snapshot.coupangCategoryId, products: snapshot.products.length, newProducts, deals: deals.map((d) => d.deal), notified };
  }

  /** Category prior = median of the "usual discount depth" of products with enough history in this category. */
  private loadPrior(categoryId: string): CategoryPrior | null {
    const raw = this.repos.getMeta(`prior:${categoryId}`);
    if (!raw) return null;
    try {
      const j = JSON.parse(raw) as CategoryPrior;
      return Number.isFinite(j.usualDepthP90) && j.sampleSize >= 5 ? j : null;
    } catch { return null; }
  }
  private savePrior(categoryId: string, ownDepths: number[]): void {
    if (ownDepths.length < 5) return;
    const sorted = [...ownDepths].sort((a, b) => a - b);
    const m = sorted.length >> 1;
    const med = sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
    const prior: CategoryPrior = { usualDepthP90: Math.min(0.5, Math.max(0, med)), sampleSize: ownDepths.length };
    try { this.repos.setMeta(`prior:${categoryId}`, JSON.stringify(prior)); } catch (e) { this.log.warn(`[pipeline] savePrior failed: ${(e as Error).message}`); }
  }

  /** Housekeeping: prune old observations and poll runs. */
  prune(): { observations: number; pollRuns: number } {
    const cutoff = this.now() - this.retentionMs;
    return { observations: this.repos.pruneObservations(cutoff), pollRuns: this.repos.prunePollRuns(cutoff) };
  }
}
