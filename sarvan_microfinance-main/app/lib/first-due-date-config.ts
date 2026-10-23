import { prisma } from '@/app/lib/prisma';

/**
 * Admin-controlled cap (singleton row) on how many days out a loan's First
 * Due Date may be set from the branch working date. Checked at Loan
 * Indexation approval and BM Final Disbursement — ADMIN users are always
 * exempt from the cap regardless of this config. Admin can disable the cap
 * entirely or change the day count from the default 8.
 */

export const DEFAULT_FIRST_DUE_DATE_ENABLED = true;
export const DEFAULT_FIRST_DUE_DATE_MAX_DAYS = 8;

export interface FirstDueDateConfigValue {
    enabled: boolean;
    maxDays: number;
}

// Simple in-process cache (1-minute TTL) — mirrors fdo-approved-client-edit-config.ts.
let _cache: FirstDueDateConfigValue | null = null;
let _cacheExpiry = 0;

export async function getFirstDueDateConfig(): Promise<FirstDueDateConfigValue> {
    const now = Date.now();
    if (_cache !== null && now < _cacheExpiry) return _cache;

    const config = await prisma.firstDueDateConfig.findFirst({
        select: { enabled: true, maxDays: true },
    });

    _cache = {
        enabled: config?.enabled ?? DEFAULT_FIRST_DUE_DATE_ENABLED,
        maxDays: config?.maxDays ?? DEFAULT_FIRST_DUE_DATE_MAX_DAYS,
    };
    _cacheExpiry = now + 60_000;
    return _cache;
}

export function invalidateFirstDueDateConfigCache() {
    _cache = null;
    _cacheExpiry = 0;
}
