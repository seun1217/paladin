/**
 * Coupang Partners Open API client (affiliate API).
 *
 * Auth: HMAC-SHA256 "CEA" scheme.
 *   signed-date  = UTC time formatted as yyMMdd'T'HHmmss'Z'
 *   message      = signed-date + METHOD + path + query   (query WITHOUT the leading '?')
 *   signature    = hex(HMAC_SHA256(secretKey, message))
 *   Authorization: CEA algorithm=HmacSHA256, access-key=<key>, signed-date=<date>, signature=<sig>
 *
 * Only the read endpoints we need are wrapped. The client throttles itself so calls
 * are spaced at least `minSpacingMs` apart and retries transient failures.
 */
import { createHmac } from 'node:crypto';
import type { CategorySnapshot, ProductProvider, ProviderProduct } from '../core/types.js';

export const COUPANG_API_HOST = 'https://api-gateway.coupang.com';
/** Documented prefix. The gateway also accepts the variant without '/v1'; override via COUPANG_API_PREFIX. */
export const DEFAULT_API_PREFIX = '/v2/providers/affiliate_open_api/apis/openapi/v1';

/**
 * Official top-level "best category" ids exposed by the Partners API bestcategories endpoint.
 * NOTE: these are Partners-API-specific codes (not coupang.com displayCategoryCode) and are NOT contiguous.
 */
export const COUPANG_BEST_CATEGORIES: Readonly<Record<number, string>> = {
  1001: '여성패션',
  1002: '남성패션',
  1010: '뷰티',
  1011: '출산/유아동',
  1012: '식품',
  1013: '주방용품',
  1014: '생활용품',
  1015: '홈인테리어',
  1016: '가전디지털',
  1017: '스포츠/레저',
  1018: '자동차용품',
  1019: '도서/음반/DVD',
  1020: '완구/취미',
  1021: '문구/오피스',
  1024: '헬스/건강식품',
  1025: '국내여행',
  1026: '해외여행',
  1029: '반려동물용품',
  1030: '유아동패션',
};

/**
 * Build a stable identity key for a listed item. The same productId can appear more than once in one
 * response with different itemId/vendorItemId (colour/size variants), so we key price history on the
 * variant when the affiliate URL exposes it.
 */
export function productKeyFromUrl(productId: string, productUrl: string): string {
  try {
    const u = new URL(productUrl);
    const vendorItemId = u.searchParams.get('vendorItemId');
    const itemId = u.searchParams.get('itemId');
    if (vendorItemId) return `${productId}-${vendorItemId}`;
    if (itemId) return `${productId}-i${itemId}`;
  } catch { /* not a URL */ }
  return productId;
}

export function formatSignedDate(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export function buildAuthorization(opts: {
  method: string; path: string; query: string; accessKey: string; secretKey: string; date?: Date;
}): { authorization: string; signedDate: string; message: string } {
  const signedDate = formatSignedDate(opts.date ?? new Date());
  const message = signedDate + opts.method.toUpperCase() + opts.path + opts.query;
  const signature = createHmac('sha256', opts.secretKey).update(message).digest('hex');
  return {
    authorization: `CEA algorithm=HmacSHA256, access-key=${opts.accessKey}, signed-date=${signedDate}, signature=${signature}`,
    signedDate,
    message,
  };
}

export interface CoupangClientOptions {
  accessKey: string;
  secretKey: string;
  subId?: string;
  /** minimum spacing between requests (ms). Default 1500. */
  minSpacingMs?: number;
  /** retries on 429/5xx/network errors. Default 2. */
  retries?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  imageSize?: string;
  timeoutMs?: number;
  /** API path prefix; default DEFAULT_API_PREFIX */
  apiPrefix?: string;
}

interface RawBestProduct {
  productId: number | string;
  productName: string;
  productPrice: number;
  productImage?: string;
  productUrl: string;
  categoryName?: string;
  isRocket?: boolean;
  isFreeShipping?: boolean;
  rank?: number;
}
interface RawResponse<T> { rCode: string; rMessage: string; data: T }

/** `data` is an array for bestcategories/goldbox, but an object {landingUrl, productData} for search. */
function normaliseList(raw: unknown): RawBestProduct[] {
  if (Array.isArray(raw)) return raw as RawBestProduct[];
  if (raw && typeof raw === 'object' && Array.isArray((raw as { productData?: unknown }).productData)) {
    return (raw as { productData: RawBestProduct[] }).productData;
  }
  return [];
}

export class CoupangApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly body?: string, public readonly retryable = false) {
    super(message);
    this.name = 'CoupangApiError';
  }
}

/** True when the error indicates the key is rejected or quota-blocked (polling should pause). */
export function isAuthOrQuotaError(e: unknown): boolean {
  return e instanceof CoupangApiError && (e.status === 401 || e.status === 403);
}

export class CoupangPartnersProvider implements ProductProvider {
  readonly name = 'coupang-partners';
  private readonly o: Required<Omit<CoupangClientOptions, 'subId' | 'apiPrefix'>> & { subId: string; apiPrefix: string };
  private lastRequestAt = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(opts: CoupangClientOptions) {
    if (!opts.accessKey || !opts.secretKey) throw new Error('Coupang access/secret key required');
    this.o = {
      accessKey: opts.accessKey,
      secretKey: opts.secretKey,
      subId: opts.subId ?? '',
      minSpacingMs: opts.minSpacingMs ?? 1500,
      retries: opts.retries ?? 2,
      fetchImpl: opts.fetchImpl ?? fetch,
      now: opts.now ?? (() => Date.now()),
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      imageSize: opts.imageSize ?? '256x256',
      timeoutMs: opts.timeoutMs ?? 15_000,
      apiPrefix: (opts.apiPrefix ?? DEFAULT_API_PREFIX).replace(/\/$/, ''),
    };
  }

  /** Serialise requests and enforce spacing (simple token-less rate limiter). */
  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      const wait = this.lastRequestAt + this.o.minSpacingMs - this.o.now();
      if (wait > 0) await this.o.sleep(wait);
      this.lastRequestAt = this.o.now();
      return fn();
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private async request<T>(method: 'GET', path: string, query: string): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.schedule(() => this.doRequest<T>(method, path, query));
      } catch (e) {
        const retryable = e instanceof CoupangApiError ? e.retryable : true;
        if (!retryable || attempt >= this.o.retries) throw e;
        attempt++;
        await this.o.sleep(Math.min(30_000, 1000 * 2 ** attempt));
      }
    }
  }

  private async doRequest<T>(method: 'GET', path: string, query: string): Promise<T> {
    const { authorization } = buildAuthorization({
      method, path, query, accessKey: this.o.accessKey, secretKey: this.o.secretKey, date: new Date(this.o.now()),
    });
    const url = `${COUPANG_API_HOST}${path}${query ? `?${query}` : ''}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
    let res: Response;
    try {
      res = await this.o.fetchImpl(url, {
        method,
        headers: { Authorization: authorization, 'Content-Type': 'application/json;charset=UTF-8' },
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new CoupangApiError(`network error: ${(e as Error).message}`, 0, undefined, true);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new CoupangApiError(`HTTP ${res.status} from Coupang API`, res.status, text.slice(0, 500), retryable);
    }
    let json: RawResponse<T>;
    try { json = JSON.parse(text) as RawResponse<T>; } catch {
      throw new CoupangApiError('invalid JSON from Coupang API', res.status, text.slice(0, 500), true);
    }
    if (json.rCode !== undefined && String(json.rCode) !== '0' && String(json.rCode) !== '200') {
      const code = String(json.rCode);
      // 401/403 as rCode usually mean auth failure or quota block: never retry blindly
      throw new CoupangApiError(`Coupang API rCode=${code}: ${json.rMessage}`, code === '403' ? 403 : code === '401' ? 401 : res.status, text.slice(0, 500), false);
    }
    return json.data;
  }

  async fetchBestProducts(coupangCategoryId: number, limit: number): Promise<CategorySnapshot> {
    const params = new URLSearchParams();
    params.set('limit', String(Math.min(100, Math.max(1, limit))));
    params.set('imageSize', this.o.imageSize);
    if (this.o.subId) params.set('subId', this.o.subId);
    const query = params.toString();
    const path = `${this.o.apiPrefix}/products/bestcategories/${coupangCategoryId}`;
    const polledAt = this.o.now();
    const raw = await this.request<RawBestProduct[] | { productData?: RawBestProduct[] }>('GET', path, query);
    const list = normaliseList(raw);
    const products: ProviderProduct[] = list
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r && r.productId !== undefined && Number.isFinite(Number(r.productPrice)) && Number(r.productPrice) > 0)
      .map(({ r, i }) => ({
        productId: productKeyFromUrl(String(r.productId), String(r.productUrl ?? '')),
        productName: String(r.productName ?? ''),
        price: Math.round(Number(r.productPrice)),
        rank: Number.isFinite(Number(r.rank)) && Number(r.rank) > 0 ? Number(r.rank) : i + 1,
        productUrl: String(r.productUrl ?? ''),
        imageUrl: r.productImage ? String(r.productImage) : undefined,
        isRocket: Boolean(r.isRocket),
        isFreeShipping: Boolean(r.isFreeShipping),
        providerCategoryName: r.categoryName ? String(r.categoryName) : undefined,
      }));
    return { coupangCategoryId, polledAt, products };
  }

  /** 골드박스 (daily deals). Not used by the pipeline yet, exposed for future use. */
  async fetchGoldbox(): Promise<ProviderProduct[]> {
    const params = new URLSearchParams();
    params.set('imageSize', this.o.imageSize);
    if (this.o.subId) params.set('subId', this.o.subId);
    const raw = await this.request<RawBestProduct[] | { productData?: RawBestProduct[] }>('GET', `${this.o.apiPrefix}/products/goldbox`, params.toString());
    return normaliseList(raw).map((r, i) => ({
      productId: productKeyFromUrl(String(r.productId), String(r.productUrl ?? '')), productName: String(r.productName ?? ''), price: Math.round(Number(r.productPrice)),
      rank: i + 1, productUrl: String(r.productUrl ?? ''), imageUrl: r.productImage, isRocket: Boolean(r.isRocket),
      isFreeShipping: Boolean(r.isFreeShipping), providerCategoryName: r.categoryName,
    }));
  }
}
