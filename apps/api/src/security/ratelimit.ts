/** Fixed-window in-memory limiter. Good for a single API process; use a shared store when scaling out. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>()

  constructor(private readonly enabled = true) {}

  /** Returns seconds until retry when the limit is exceeded, otherwise null. */
  check(key: string, limit: number, windowMs: number, now = Date.now()): number | null {
    if (!this.enabled) return null
    const entry = this.hits.get(key)
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs })
      this.sweep(now)
      return null
    }
    entry.count += 1
    return entry.count > limit ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) : null
  }

  private sweep(now: number): void {
    if (this.hits.size < 5000) return
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k)
  }
}
