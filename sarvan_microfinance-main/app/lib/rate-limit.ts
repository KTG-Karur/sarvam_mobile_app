// ============================================================
// RATE LIMITING — Redis-backed fixed-window limiter
// app/lib/rate-limit.ts
//
// For the app's one genuinely public, unauthenticated surface (the HR
// onboarding link, app/api/public/hr-onboarding/[token]) — every other route
// is naturally throttled by requiring a valid session, but a public link has
// no such gate, so it's the one place a burst of automated hits (1000+
// requests) could hammer the DB directly.
//
// Backed by Redis (not in-memory) so the limit is shared across every pm2
// cluster worker — an in-memory counter only throttles within the one worker
// that happened to receive the request, so a limit of N per window is
// actually N * workerCount under a load balancer.
//
// Redis unreachable: fail open (allow the request) rather than lock out real
// onboarding users over a Redis hiccup — this endpoint is rate-limited as a
// courtesy backstop, not a hard security boundary.
// ============================================================

import redis from '@/app/lib/redis';

class RateLimiter {
  /** Returns true if `key` is still within its limit for this call, and records the hit. */
  async check(key: string, limit: number, windowMs: number): Promise<boolean> {
    try {
      const redisKey = `ratelimit:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) {
        // Only the request that created the counter sets its expiry —
        // avoids resetting the window on every subsequent hit.
        await redis.pexpire(redisKey, windowMs);
      }
      return count <= limit;
    } catch (err) {
      console.error('[rateLimiter] check failed, failing open:', (err as Error).message);
      return true;
    }
  }
}

export const rateLimiter = new RateLimiter();

/** Best-effort client IP from standard proxy headers — same convention as app/api/approvals/[instanceId]/route.ts. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}
