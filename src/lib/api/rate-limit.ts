import "server-only";

/**
 * RATE LIMIT — abstraction plus an in-memory implementation.
 *
 * No external dependency and no external service: the interface is the point,
 * so that swapping in a shared store later is one function, and the in-memory
 * limiter is a real (if narrow) implementation rather than a simulation.
 *
 * WHAT THIS ACTUALLY PROTECTS AGAINST, stated plainly so nobody over-trusts it:
 * a single runaway client on a single server instance. Counters live in process
 * memory, so they reset on deploy and are NOT shared across instances — on a
 * multi-instance deployment the effective limit is the configured limit times
 * the instance count.
 *
 * It is therefore a guard against accidental spend (a retry loop burning
 * Anthropic credits and Edge Function invocations), not a defence against a
 * distributed attacker.
 * Real abuse protection arrives with authentication and a shared store; the
 * interface below is what that swap targets.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Requests still available in the current window. */
  remaining: number;
  /** Seconds until the window resets. Sent as Retry-After when blocked. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  readonly name: string;
  /** True when limits are shared across server instances. */
  readonly distributed: boolean;
  check(key: string, rule: RateLimitRule): RateLimitDecision;
}

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  windowSeconds: number;
}

/**
 * Per-route budgets. Chat and upload are the expensive paths — each one spends
 * real money at an external vendor — so they are tighter than search.
 */
export const RATE_LIMITS = {
  chat: { limit: 30, windowSeconds: 60 },
  upload: { limit: 10, windowSeconds: 60 },
  search: { limit: 60, windowSeconds: 60 },
  reindex: { limit: 10, windowSeconds: 60 },
  mutate: { limit: 30, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitedRoute = keyof typeof RATE_LIMITS;

interface Bucket {
  count: number;
  resetAt: number;
}

/** Fixed-window counter. Simple, allocation-light, and adequate for the goal. */
export class InMemoryRateLimiter implements RateLimiter {
  readonly name = "In-memory fixed window (per server instance)";
  readonly distributed = false;

  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;

  /** `now` is injectable so window expiry is testable without waiting. */
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  check(key: string, rule: RateLimitRule): RateLimitDecision {
    const now = this.now();
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + rule.windowSeconds * 1000 });
      this.sweep(now);
      return {
        allowed: true,
        remaining: rule.limit - 1,
        retryAfterSeconds: rule.windowSeconds,
      };
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

    if (existing.count >= rule.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: rule.limit - existing.count,
      retryAfterSeconds,
    };
  }

  /** Drops expired buckets so a long-lived process does not grow unbounded. */
  private sweep(now: number): void {
    if (this.buckets.size < 512) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  /** Test seam. */
  reset(): void {
    this.buckets.clear();
  }
}

let limiter: RateLimiter = new InMemoryRateLimiter();

export function getRateLimiter(): RateLimiter {
  return limiter;
}

/** Swap seam for a shared-store limiter once one exists. */
export function __setRateLimiter(next: RateLimiter): void {
  limiter = next;
}

/**
 * Identifies the caller for limiting purposes.
 *
 * Best-effort by design: without authentication there is no trustworthy
 * identifier, and forwarded-for headers are client-controlled. This is honest
 * about being a courtesy bucket, not an identity. Once authentication ships,
 * key on the authenticated subject instead.
 */
export function rateLimitKey(request: Request, route: RateLimitedRoute): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return `${route}:${forwarded || realIp || "unknown"}`;
}
