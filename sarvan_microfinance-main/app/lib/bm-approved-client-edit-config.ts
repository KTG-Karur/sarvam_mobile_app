import { prisma } from '@/app/lib/prisma';

/**
 * Admin kill-switch (singleton row) for whether Branch Manager can view/edit
 * already-APPROVED clients from the Approval Workbench "Edit Client" dialog
 * without restarting the BM -> AM -> QC -> Admin approval workflow. Defaults
 * to true (the behavior BM already had); Admin can flip it off to revert to
 * the stricter behavior where BM can no longer touch an APPROVED client.
 * Mirrors fdo-approved-client-edit-config.ts.
 */

export const DEFAULT_ALLOW_BM_EDIT_APPROVED_CLIENT = true;

// Simple in-process cache (1-minute TTL) — mirrors fdo-approved-client-edit-config.ts.
let _cache: boolean | null = null;
let _cacheExpiry = 0;

export async function getAllowBmEditApprovedClient(): Promise<boolean> {
    const now = Date.now();
    if (_cache !== null && now < _cacheExpiry) return _cache;

    const config = await prisma.bmApprovedClientEditConfig.findFirst({
        select: { enabled: true },
    });

    _cache = config?.enabled ?? DEFAULT_ALLOW_BM_EDIT_APPROVED_CLIENT;
    _cacheExpiry = now + 60_000;
    return _cache;
}

export function invalidateBmApprovedClientEditConfigCache() {
    _cache = null;
    _cacheExpiry = 0;
}
