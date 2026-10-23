import { prisma } from '@/app/lib/prisma';

/**
 * Admin kill-switch (singleton row) for whether the Loan Advance feature
 * (Client.loanAdvance wallet, SAVINGS_COLLECTION / SAVINGS_REFUND
 * transactions, Loan Advance Refund, related reports) is usable anywhere in
 * the project. Defaults to true so existing branches see no change until an
 * Admin explicitly disables it.
 */

export const DEFAULT_LOAN_ADVANCE_ENABLED = true;

// Simple in-process cache (1-minute TTL) — mirrors fdo-approved-client-edit-config.ts.
let _cache: boolean | null = null;
let _cacheExpiry = 0;

export async function getLoanAdvanceEnabled(): Promise<boolean> {
    const now = Date.now();
    if (_cache !== null && now < _cacheExpiry) return _cache;

    const config = await prisma.loanAdvanceConfig.findFirst({
        select: { enabled: true },
    });

    _cache = config?.enabled ?? DEFAULT_LOAN_ADVANCE_ENABLED;
    _cacheExpiry = now + 60_000;
    return _cache;
}

export function invalidateLoanAdvanceConfigCache() {
    _cache = null;
    _cacheExpiry = 0;
}
