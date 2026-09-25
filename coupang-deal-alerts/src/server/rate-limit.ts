/** Minimal fixed-window rate limiter (in-memory, single process). */
export class RateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();
  private readonly windowMs: number;
  private readonly max: number;
  private readonly now: () => number;
  private lastSweep = 0;

  constructor(opts: { windowMs: number; max: number; now?: () => number }) {
    this.windowMs = opts.windowMs;
    this.max = opts.max;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Returns true if the action is allowed (and counts it). */
  take(key: string): boolean {
    const t = this.now();
    if (t - this.lastSweep > this.windowMs * 10) this.sweep(t);
    const h = this.hits.get(key);
    if (!h || t - h.windowStart >= this.windowMs) {
      this.hits.set(key, { windowStart: t, count: 1 });
      return true;
    }
    if (h.count >= this.max) return false;
    h.count++;
    return true;
  }

  private sweep(t: number): void {
    this.lastSweep = t;
    for (const [k, h] of this.hits) if (t - h.windowStart >= this.windowMs) this.hits.delete(k);
  }
}
