// ============================================================
// LOAN BALANCE CACHE — Redis-backed cache-aside for the per-loan outstanding
// balance shown on read-only display screens.
// app/lib/cache/loan-balance-cache.ts
//
// Same shape as master-data-cache.ts: a per-loan version counter
// (loanbal:ver:<loanId>) and entries at loanbal:<loanId>:v<version>. A writer
// calls bumpLoanBalance(...) AFTER its $transaction commits; that is one INCR
// per loan, so the stale entry is simply never read again (and expires on TTL
// anyway as a safety net for any writer that forgot to bump).
//
// HARD RULE: display GETs only. Never read this inside approve / foreclosure /
// write-off / disburse logic — a stale cached balance feeding a financial
// write is a real bug. Those paths must compute from the DB.
//
// Redis unreachable: fail soft — compute from the DB, skip caching.
// ============================================================

import redis from '@/app/lib/redis';

const TTL_SECONDS = 60;

const verKey = (loanId: string) => `loanbal:ver:${loanId}`;
const dataKey = (loanId: string, version: string) => `loanbal:${loanId}:v${version}`;

export async function cachedLoanBalance<T>(loanId: string, fetcher: () => Promise<T>): Promise<T> {
  let version: string | null;
  try {
    version = (await redis.get(verKey(loanId))) ?? '0';
  } catch (err) {
    console.error('[loanBalanceCache] version read failed, bypassing cache:', (err as Error).message);
    version = null;
  }

  // Version is read BEFORE the DB fetch so a concurrent bump orphans this
  // result under the old version instead of tagging it as current.
  if (version !== null) {
    try {
      const cached = await redis.get(dataKey(loanId, version));
      if (cached) return JSON.parse(cached) as T;
    } catch (err) {
      console.error('[loanBalanceCache] read failed:', (err as Error).message);
    }
  }

  const fresh = await fetcher();

  if (version !== null) {
    try {
      await redis.set(dataKey(loanId, version), JSON.stringify(fresh), 'EX', TTL_SECONDS);
    } catch (err) {
      console.error('[loanBalanceCache] write failed (non-fatal):', (err as Error).message);
    }
  }
  return fresh;
}

/** Call after the mutation commits (never inside the $transaction). Fire-and-forget safe; never throws. */
export async function bumpLoanBalance(loanIds: string | Array<string | null | undefined>): Promise<void> {
  const ids = (Array.isArray(loanIds) ? loanIds : [loanIds]).filter((id): id is string => !!id);
  if (ids.length === 0) return;
  try {
    const pipeline = redis.pipeline();
    for (const id of new Set(ids)) pipeline.incr(verKey(id));
    await pipeline.exec();
  } catch (err) {
    console.error('[loanBalanceCache] bump failed:', (err as Error).message);
  }
}
