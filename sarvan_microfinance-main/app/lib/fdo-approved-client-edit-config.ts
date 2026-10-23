import { prisma } from '@/app/lib/prisma';

/**
 * Admin kill-switch (singleton row) for whether FDO can view/edit already-
 * APPROVED clients from the Member Update page without restarting the
 * BM -> AM -> QC -> Admin approval workflow. Defaults to true (the behavior
 * shipped 2026-08-13); Admin can flip it off to revert to the older, stricter
 * behavior where FDO never sees or touches an APPROVED client.
 */

export const DEFAULT_ALLOW_FDO_EDIT_APPROVED_CLIENT = true;

// Simple in-process cache (1-minute TTL) — mirrors group-assignment-config.ts.
let _cache: boolean | null = null;
let _cacheExpiry = 0;

export async function getAllowFdoEditApprovedClient(): Promise<boolean> {
    const now = Date.now();
    if (_cache !== null && now < _cacheExpiry) return _cache;

    const config = await prisma.fdoApprovedClientEditConfig.findFirst({
        select: { enabled: true },
    });

    _cache = config?.enabled ?? DEFAULT_ALLOW_FDO_EDIT_APPROVED_CLIENT;
    _cacheExpiry = now + 60_000;
    return _cache;
}

export function invalidateFdoApprovedClientEditConfigCache() {
    _cache = null;
    _cacheExpiry = 0;
}
