/**
 * Shared domain types for coupang-deal-alerts.
 *
 * Terminology
 *  - Category      : Coupang Partners top-level "best category" (e.g. 1011 가전디지털)
 *  - Subcategory   : our curated fine-grained bucket under a Category (e.g. appliances.laptop 노트북).
 *                    Users subscribe at this level.
 *  - Snapshot      : one poll result for one Category (list of ranked products with current price)
 *  - Observation   : one (product, time, price, rank) row persisted from a snapshot
 *  - Deal          : a detected "discounted more heavily than usual" event for a product
 */

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export interface Subcategory {
  /** stable ascii id, e.g. "appliances.laptop" */
  id: string;
  /** Korean display name, e.g. "노트북" */
  name: string;
  /** keywords matched (case-insensitive, whitespace-insensitive) against product title */
  keywords: string[];
  /** if any of these match, this subcategory is skipped for the product */
  excludeKeywords?: string[];
}

export interface Category {
  /** stable ascii id, e.g. "appliances" */
  id: string;
  /** Korean display name, e.g. "가전디지털" */
  name: string;
  /** Coupang Partners bestcategories categoryId, e.g. 1011 */
  coupangCategoryId: number;
  subcategories: Subcategory[];
}

export interface Taxonomy {
  categories: Category[];
}

// ---------------------------------------------------------------------------
// Products & price observations
// ---------------------------------------------------------------------------

/** A single product as returned by a provider poll. */
export interface ProviderProduct {
  productId: string;
  productName: string;
  /** current sale price in KRW (integer) */
  price: number;
  /** 1-based popularity rank within the polled category (1 = most popular) */
  rank: number;
  productUrl: string;
  imageUrl?: string;
  isRocket?: boolean;
  isFreeShipping?: boolean;
  /** category name as reported by the provider (may be top-level or leaf) */
  providerCategoryName?: string;
}

export interface CategorySnapshot {
  coupangCategoryId: number;
  /** epoch milliseconds when the poll happened */
  polledAt: number;
  products: ProviderProduct[];
}

export interface PriceObservation {
  /** epoch milliseconds */
  t: number;
  price: number;
  rank: number;
}

export interface ProductRecord {
  productId: string;
  coupangCategoryId: number;
  categoryId: string;
  subcategoryId: string;
  name: string;
  url: string;
  imageUrl: string | null;
  isRocket: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  lastPrice: number;
  lastRank: number;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export type Sensitivity = 'conservative' | 'normal' | 'sensitive';

export interface DealDecision {
  alert: boolean;
  /** 0..1, how unusual/deep this discount is; used for user sensitivity filtering */
  severity: number;
  /** human readable reason (Korean), e.g. "평시 대비 32% 할인 (최근 30일 최저가)" */
  reason: string;
  /** baseline ("usual") price the discount is measured against, if computable */
  baselinePrice: number | null;
  /** fraction 0..1 discount vs baseline, if computable */
  discountFromBaseline: number | null;
}

export interface CategoryPrior {
  /** typical "usual discount depth" (p90 of daily depth) across products of this category, 0..1 */
  usualDepthP90: number;
  /** number of products the prior was computed from */
  sampleSize: number;
}

export interface DetectorContext {
  productId: string;
  categoryId: string;
  subcategoryId: string;
  /** epoch ms of the current poll */
  now: number;
  /** category-level prior computed by the pipeline (outside the pure function); optional */
  categoryPrior?: CategoryPrior | null;
}

export interface DetectorOutcome<S = unknown> {
  decision: DealDecision;
  /** state to persist for this product (opaque to the pipeline) */
  newState: S;
}

export interface Detector<S = unknown> {
  /** how far back (ms) the pipeline should load observations for decide() */
  readonly historyWindowMs: number;
  decide(history: PriceObservation[], current: PriceObservation, state: S | null, ctx: DetectorContext): DetectorOutcome<S>;
}

export interface DealRecord {
  id: number;
  productId: string;
  categoryId: string;
  subcategoryId: string;
  detectedAt: number;
  price: number;
  baselinePrice: number;
  discountPct: number;
  severity: number;
  reason: string;
  rank: number;
}

// ---------------------------------------------------------------------------
// Users, preferences, channels
// ---------------------------------------------------------------------------

export interface UserPrefs {
  userId: string;
  /** subcategory ids the user wants alerts for */
  subcategoryIds: string[];
  sensitivity: Sensitivity;
  /** max notifications per calendar day (KST). 0 = unlimited */
  dailyCap: number;
  /** quiet hours in KST, e.g. start 23, end 8 means no pushes between 23:00 and 08:00. null = none */
  quietHours: { startHour: number; endHour: number } | null;
  createdAt: number;
  updatedAt: number;
}

export interface PushSubscriptionRecord {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: number;
  lastOkAt: number | null;
  failCount: number;
}

export interface TelegramLinkRecord {
  userId: string;
  chatId: string;
  createdAt: number;
}

export interface NotificationMessage {
  title: string;
  body: string;
  url: string;
  imageUrl?: string;
  /** unique tag to collapse duplicate notifications on the device */
  tag: string;
}

// ---------------------------------------------------------------------------
// Provider & notifier interfaces
// ---------------------------------------------------------------------------

export interface ProductProvider {
  readonly name: string;
  /** Fetch the current best/popular products for one top-level category. */
  fetchBestProducts(coupangCategoryId: number, limit: number): Promise<CategorySnapshot>;
}

export type NotifyResult =
  | { ok: true }
  | { ok: false; gone: boolean; error: string };

export interface Notifier {
  readonly channel: 'webpush' | 'telegram';
  send(userId: string, message: NotificationMessage): Promise<NotifyResult[]>;
}
