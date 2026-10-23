// ============================================================
// MASTER DATA CACHE — Redis-backed cache-aside for near-static reference
// lists (Region / Branch / Funder / Center dropdowns) that get re-fetched on
// almost every dashboard page load but change rarely.
// app/lib/cache/master-data-cache.ts
//
// Design: version-counter invalidation, NOT scan+delete —
//   - Each resource has one counter key: cachever:<resource>
//   - A cached entry is stored at master:<resource>:v<version>:<paramsKey>
//   - Writing code calls bumpMasterDataVersion(resource) after a mutation
//     commits; that's a single INCR, so every stale-keyed entry is simply
//     never looked up again (and expires naturally via TTL) instead of
//     having to hunt down and delete every previously-cached param variant.
//   - The version is read BEFORE the DB fetch, not after — if a bump happens
//     concurrently with an in-flight read, the read's result gets stored
//     under the OLD version number, which is orphaned (no future reader
//     will look it up) rather than being mistakenly tagged as current.
//   - Redis unreachable: fail soft — skip caching entirely for that call
//     rather than error out; callers always get a correct DB read.
// ============================================================

import { createHash } from 'crypto';
import redis from '@/app/lib/redis';

const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour safety net alongside explicit bumps

function versionKey(resource: string): string {
  return `cachever:${resource}`;
}

function dataKey(resource: string, version: string, paramsKey: string): string {
  return `master:${resource}:v${version}:${paramsKey}`;
}

/** Deterministic key from a params object — sorts keys (and any array values) recursively so equivalent filters always hash the same regardless of property/array order. */
export function stableParamsKey(params: Record<string, unknown>): string {
  const sorted = sortDeep(params);
  const json = JSON.stringify(sorted);
  return createHash('sha1').update(json).digest('hex');
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return entries.map(([k, v]) => [k, sortDeep(v)]);
  }
  return value;
}

/**
 * Cache-aside read: returns the cached JSON-safe payload for (resource, paramsKey)
 * if present and current, otherwise calls `fetcher`, caches the result, and returns it.
 *
 * `fetcher` must return the exact JSON-safe payload to hand back to the caller
 * (i.e. whatever you'd pass to successResponse) — not raw Prisma rows that later
 * code expects to call Set/Map methods on (Dates/Decimals will come back as
 * plain strings on a cache hit, same as any other JSON API response).
 */
export async function cachedMasterData<T>(
  resource: string,
  paramsKey: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<T> {
  let version: string | null;
  try {
    version = (await redis.get(versionKey(resource))) ?? '0';
  } catch (err) {
    console.error(`[masterDataCache:${resource}] version read failed, bypassing cache:`, (err as Error).message);
    version = null;
  }

  if (version !== null) {
    try {
      const cached = await redis.get(dataKey(resource, version, paramsKey));
      if (cached) return JSON.parse(cached) as T;
    } catch (err) {
      console.error(`[masterDataCache:${resource}] read failed:`, (err as Error).message);
    }
  }

  const fresh = await fetcher();

  if (version !== null) {
    try {
      await redis.set(dataKey(resource, version, paramsKey), JSON.stringify(fresh), 'EX', ttlSeconds);
    } catch (err) {
      console.error(`[masterDataCache:${resource}] write failed (non-fatal):`, (err as Error).message);
    }
  }

  return fresh;
}

/** Call after a mutation to `resource` commits — invalidates every cached param variant for it. */
export async function bumpMasterDataVersion(resource: string): Promise<void> {
  try {
    await redis.incr(versionKey(resource));
  } catch (err) {
    console.error(`[masterDataCache:${resource}] version bump failed:`, (err as Error).message);
  }
}
