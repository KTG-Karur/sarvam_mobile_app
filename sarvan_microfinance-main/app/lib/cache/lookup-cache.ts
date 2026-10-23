// ============================================================
// LOOKUP CACHE — Redis-backed cache for immutable third-party reference
// lookups (pincode → district/state, IFSC → bank/branch) that this codebase
// never writes to, so there's nothing to invalidate.
// app/lib/cache/lookup-cache.ts
//
// Unlike master-data-cache.ts (which handles OUR OWN mutable master data and
// needs version-counter invalidation), these are one-way lookups against an
// external API for a key that essentially never changes its answer — so this
// is a flat get/set with a long TTL, no version key at all.
//
// `fetcher` must throw for a genuine miss/failure — cachedLookup does not
// catch it, so nothing gets cached for a failed lookup (a transient network
// blip on a real pincode must not get permanently remembered as "not found").
// ============================================================

import redis from '@/app/lib/redis';

export async function cachedLookup<T>(
  namespace: string,
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number
): Promise<T> {
  const redisKey = `lookup:${namespace}:${key}`;

  try {
    const cached = await redis.get(redisKey);
    if (cached) return JSON.parse(cached) as T;
  } catch (err) {
    console.error(`[lookupCache:${namespace}] read failed, bypassing cache:`, (err as Error).message);
  }

  const fresh = await fetcher();

  try {
    await redis.set(redisKey, JSON.stringify(fresh), 'EX', ttlSeconds);
  } catch (err) {
    console.error(`[lookupCache:${namespace}] write failed (non-fatal):`, (err as Error).message);
  }

  return fresh;
}
