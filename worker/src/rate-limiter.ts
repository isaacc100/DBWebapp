/**
 * Simple in-memory, per-IP rate limiter using a sliding fixed window.
 *
 * NOTE: Cloudflare Workers may run on multiple isolates, so this counter is
 * per-isolate.  For strict rate limiting across all isolates, enable
 * Cloudflare Rate Limiting rules in the dashboard or use a Durable Object.
 */

interface Entry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly store = new Map<string, Entry>();

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Returns true if the request should be allowed, false if rate-limited. */
  allow(key: string): boolean {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now > entry.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (entry.count >= this.limit) {
      return false;
    }

    entry.count++;
    return true;
  }

  /** Remove stale entries (call periodically to avoid memory growth). */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.resetAt) this.store.delete(key);
    }
  }
}
