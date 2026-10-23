import { prisma } from '@/app/lib/prisma';

/**
 * Admin-configurable "Maximum Members Per Group" used by automatic group
 * assignment. Singleton row in group_assignment_config; defaults to 5 when
 * no row exists. Changing it affects only future assignments.
 */

export const DEFAULT_MAX_MEMBERS_PER_GROUP = 5;
export const MIN_MAX_MEMBERS_PER_GROUP = 1;
export const MAX_MAX_MEMBERS_PER_GROUP = 100;

// Simple in-process cache (1-minute TTL) — mirrors workflow-config.ts.
let _cache: number | null = null;
let _cacheExpiry = 0;

export async function getMaxMembersPerGroup(): Promise<number> {
    const now = Date.now();
    if (_cache !== null && now < _cacheExpiry) return _cache;

    const config = await prisma.groupAssignmentConfig.findFirst({
        select: { maxMembersPerGroup: true },
    });

    const value = config?.maxMembersPerGroup ?? DEFAULT_MAX_MEMBERS_PER_GROUP;
    _cache = Math.min(
        MAX_MAX_MEMBERS_PER_GROUP,
        Math.max(MIN_MAX_MEMBERS_PER_GROUP, value)
    );
    _cacheExpiry = now + 60_000;
    return _cache;
}

export function invalidateGroupAssignmentConfigCache() {
    _cache = null;
    _cacheExpiry = 0;
}
